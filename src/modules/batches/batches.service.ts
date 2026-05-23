import { nanoid } from 'nanoid';
import { prisma } from '../../config/prisma.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../utils/errors.js';
import { broadcastBatchEvent } from '../../realtime/emitter.js';
import {
  suggestBatches as aiSuggest,
  type ItemForBatching,
  type MachineForBatching,
} from '../ai/bin-packing.service.js';
import type { CompleteBatchDto } from './batches.dto.js';

/**
 * Récupère le pool d'items en attente de lavage et appelle le bin-packing.
 *
 * @param orderIds optionnel — restreint le pool à ces commandes
 * @param useAi    optionnel (défaut true) — si false, heuristique uniquement
 *                 (pas d'appel Groq, instantané)
 */
export async function suggestNewBatches(orderIds?: string[], useAi: boolean = true) {
  // 1. Pool d'items "triaged" pas encore affectés à un batch.
  // - Pas de `take` arbitraire (anciennement 500 → tronquait silencieusement
  //   les lancements multi-commandes et faisait disparaître des clients).
  // - `orderBy` stable pour rendre la proposition reproductible.
  const tags = await prisma.itemTag.findMany({
    where: {
      state: 'triaged',
      currentBatchId: null,
      ...(orderIds && orderIds.length > 0 ? { orderId: { in: orderIds } } : {}),
    },
    include: {
      order: { include: { client: { select: { name: true } } } },
      linenType: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 10_000, // garde-fou (10k items = bien au-delà d'une journée réaliste)
  });

  if (tags.length === 0) {
    return { batches: [], source: 'heuristic' as const, meta: { itemsPlaced: 0, itemsLeftover: 0, averageUtilization: 0 } };
  }

  // 2. Programmes compatibles par catégorie
  const programs = await prisma.washingProgram.findMany({ where: { isActive: true } });

  // Pour cette V1, on prend le 1er programme compatible avec la catégorie de l'item
  const items: ItemForBatching[] = tags.flatMap((tag) => {
    const compatProgram = programs.find((p) => p.suitable.includes(tag.linenType.category));
    if (!compatProgram) return [];
    return [
      {
        tagId: tag.id,
        orderId: tag.orderId,
        clientName: tag.order.client.name,
        weight: tag.weight,
        programId: compatProgram.id,
        programName: compatProgram.name,
        programCategoryCompat: compatProgram.suitable,
        category: tag.linenType.category,
        priority: false,
        linenTypeCode: tag.linenType.code,
        linenTypeName: tag.linenType.name,
      },
    ];
  });

  // 3. Machines disponibles
  const machinesData = await prisma.machine.findMany({
    where: { status: 'active', kind: 'laveuse' },
  });
  const machines: MachineForBatching[] = machinesData.map((m) => ({
    id: m.id,
    reference: m.reference,
    capacityKg: m.capacityKg,
    status: m.status,
    kind: m.kind,
  }));

  // 4. Bin-packing : heuristique + IA optionnelle
  return aiSuggest(items, machines, { useAi });
}

/**
 * Persiste les batches suggérés (transaction). Les ItemTags sont assignés
 * et passent à state=in_lavage.
 */
export async function persistBatches(
  actorUserId: string,
  proposal: Awaited<ReturnType<typeof suggestNewBatches>>,
) {
  if (proposal.batches.length === 0) return [];

  return prisma.$transaction(
    async (tx) => {
      const created = [];

      for (const b of proposal.batches) {
        const code = `B-${nanoid(6).toUpperCase()}`;
        const program = await tx.washingProgram.findUnique({ where: { id: b.programId } });
        if (!program) {
          throw new BadRequestError(`Program ${b.programId} not found`);
        }

        const batch = await tx.batch.create({
          data: {
            code,
            stage: 'lavage',
            status: 'suggested',
            machineId: b.machineId,
            programId: b.programId,
            capacity: b.capacity,
            currentLoad: Math.round(b.totalWeight * 1000), // grammes
            utilization: b.utilization,
            estimatedDurationMin: program.durationMin,
            suggestedByAi: proposal.source !== 'heuristic',
            aiScore: b.utilization,
            aiRationale: proposal.meta.aiRationale,
            contributors: {
              create: b.contributors.map((c) => ({
                orderId: c.orderId,
                pieces: c.pieces,
                weight: c.weight,
              })),
            },
          },
          include: { contributors: true },
        });

        // Affecte les tags au batch
        await tx.itemTag.updateMany({
          where: { id: { in: b.items.map((i) => i.tagId) } },
          data: { currentBatchId: batch.id, state: 'in_lavage' },
        });

        await tx.auditLog.create({
          data: {
            actorId: actorUserId,
            action: 'ai_suggest',
            entity: 'batch',
            entityId: batch.id,
            payload: {
              source: proposal.source,
              utilization: b.utilization,
              contributorsCount: b.contributors.length,
            },
          },
        });

        created.push(batch);
      }

      // Met à jour le statut des commandes affectées : triaged → in_production
      const affectedOrderIds = [
        ...new Set(
          proposal.batches.flatMap((b) => b.contributors.map((c) => c.orderId)),
        ),
      ];
      if (affectedOrderIds.length > 0) {
        await tx.order.updateMany({
          where: {
            id: { in: affectedOrderIds },
            status: 'triaged',
          },
          data: {
            status: 'in_production',
            workflowState: 'LAVAGE_IN_PROGRESS',
            version: { increment: 1 },
          },
        });
      }

      return created;
    },
    { isolationLevel: 'Serializable', timeout: 30000 },
  );
}

/* ════════════ MULTI-STAGE BATCH CREATION ════════════ */

/** Mapping stage → ItemTag state d'attente */
const STAGE_TO_WAITING_STATE: Record<
  'sechage' | 'calandrage' | 'repassage' | 'finition',
  'in_sechage' | 'in_calandrage' | 'in_repassage' | 'in_finition'
> = {
  sechage: 'in_sechage',
  calandrage: 'in_calandrage',
  repassage: 'in_repassage',
  finition: 'in_finition',
};

/** Mapping stage → kind de machine */
const STAGE_TO_MACHINE_KIND: Record<
  'sechage' | 'calandrage' | 'repassage' | 'finition',
  'secheuse' | 'secheuse_repasseuse' | 'calandre' | 'presse' | null
> = {
  sechage: 'secheuse',
  calandrage: 'calandre',
  repassage: 'presse',
  finition: null, // pliage manuel, pas de machine
};

/**
 * Compte les items en attente pour chaque stage post-lavage (utile pour
 * afficher des compteurs dans l'UI).
 */
export async function countWaitingItemsByStage() {
  const results: Record<string, number> = {};
  for (const [stage, state] of Object.entries(STAGE_TO_WAITING_STATE)) {
    results[stage] = await prisma.itemTag.count({
      where: { state, currentBatchId: null },
    });
  }
  return results;
}

type StageName = 'sechage' | 'calandrage' | 'repassage' | 'finition';

interface StageProposalItem {
  tagId: string;
  orderId: string;
  clientName?: string;
  weight: number; // grammes
  linenTypeCode?: string;
  linenTypeName?: string;
}

interface StageProposalBatch {
  machineId: string;
  machineRef?: string;
  programId: string; // string vide pour stages sans programme
  programName?: string;
  capacity: number; // kg
  totalWeight: number; // kg
  utilization: number;
  contributors: { orderId: string; clientName: string; pieces: number; weight: number }[];
  items: StageProposalItem[];
}

interface StageProposal {
  source: 'heuristic-stage';
  stage: StageName;
  finalized?: boolean; // true pour finition (sans machine)
  batches: StageProposalBatch[];
  meta: {
    itemsPlaced: number;
    itemsLeftover: number;
    averageUtilization: number;
    aiRationale?: string;
  };
}

/** Construit une proposition de batches pour un stage post-lavage sans
 *  persister. Retourne la même shape que l'IA pour pouvoir être éditée
 *  côté front. */
export async function suggestStageBatches(stage: StageName): Promise<StageProposal> {
  const waitingState = STAGE_TO_WAITING_STATE[stage];
  const machineKind = STAGE_TO_MACHINE_KIND[stage];

  const tags = await prisma.itemTag.findMany({
    where: { state: waitingState, currentBatchId: null },
    include: {
      order: { include: { client: { select: { name: true } } } },
      linenType: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 10_000, // garde-fou — même raison qu'au lavage
  });

  if (tags.length === 0) {
    return {
      source: 'heuristic-stage',
      stage,
      batches: [],
      meta: { itemsPlaced: 0, itemsLeftover: 0, averageUtilization: 0 },
    };
  }

  // Cas finition : pas de machine, un "batch virtuel" qui regroupe tout
  if (!machineKind) {
    const items: StageProposalItem[] = tags.map((t) => ({
      tagId: t.id,
      orderId: t.orderId,
      clientName: t.order.client.name,
      weight: t.weight,
      linenTypeCode: t.linenType.code,
      linenTypeName: t.linenType.name,
    }));
    const contribMap = new Map<string, { orderId: string; clientName: string; pieces: number; weight: number }>();
    for (const it of items) {
      const e = contribMap.get(it.orderId) ?? {
        orderId: it.orderId,
        clientName: it.clientName ?? '—',
        pieces: 0,
        weight: 0,
      };
      e.pieces += 1;
      e.weight += it.weight;
      contribMap.set(it.orderId, e);
    }
    const totalKg = items.reduce((s, it) => s + it.weight, 0) / 1000;
    return {
      source: 'heuristic-stage',
      stage,
      finalized: true,
      batches: [
        {
          machineId: '',
          machineRef: 'Pliage manuel',
          programId: '',
          programName: 'Finition',
          capacity: Math.max(totalKg, 1),
          totalWeight: totalKg,
          utilization: 1,
          contributors: Array.from(contribMap.values()),
          items,
        },
      ],
      meta: {
        itemsPlaced: items.length,
        itemsLeftover: 0,
        averageUtilization: 1,
        aiRationale: 'Finition sans machine — pliage et mise en sachet.',
      },
    };
  }

  // Pour le repassage, on accepte aussi les sécheuses-repasseuses (combo).
  const machineFilter =
    stage === 'sechage'
      ? [{ kind: 'secheuse' as const }, { kind: 'secheuse_repasseuse' as const }]
      : stage === 'repassage'
        ? [{ kind: 'presse' as const }, { kind: 'secheuse_repasseuse' as const }]
        : [{ kind: machineKind }];

  const machines = await prisma.machine.findMany({
    where: { status: 'active', OR: machineFilter },
  });

  if (machines.length === 0) {
    throw new BadRequestError(
      `Aucune machine ${machineKind} active disponible pour le ${stage}.`,
    );
  }

  // Bin-packing Best-Fit Decreasing
  const sortedTags = [...tags].sort((a, b) => b.weight - a.weight);
  const sortedMachines = [...machines].sort((a, b) => b.capacityKg - a.capacityKg);
  const plans: { machineId: string; machineRef: string; capacity: number; tags: typeof tags }[] = [];

  for (const tag of sortedTags) {
    let bestIdx = -1;
    let bestRemaining = Infinity;
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      if (!plan) continue;
      const used = plan.tags.reduce((s, t) => s + t.weight, 0);
      const remaining = plan.capacity * 1000 - used;
      if (tag.weight <= remaining && remaining - tag.weight < bestRemaining) {
        bestIdx = i;
        bestRemaining = remaining - tag.weight;
      }
    }
    const bestPlan = bestIdx >= 0 ? plans[bestIdx] : undefined;
    if (bestPlan) {
      bestPlan.tags.push(tag);
    } else {
      const machineIdx = plans.length % sortedMachines.length;
      const machine = sortedMachines[machineIdx];
      if (machine && tag.weight <= machine.capacityKg * 1000) {
        plans.push({
          machineId: machine.id,
          machineRef: `${machine.brand} ${machine.model} · ${machine.reference}`,
          capacity: machine.capacityKg,
          tags: [tag],
        });
      }
    }
  }

  const batches: StageProposalBatch[] = plans.map((plan) => {
    const items: StageProposalItem[] = plan.tags.map((t) => ({
      tagId: t.id,
      orderId: t.orderId,
      clientName: t.order.client.name,
      weight: t.weight,
      linenTypeCode: t.linenType.code,
      linenTypeName: t.linenType.name,
    }));
    const contribMap = new Map<string, { orderId: string; clientName: string; pieces: number; weight: number }>();
    for (const it of items) {
      const e = contribMap.get(it.orderId) ?? {
        orderId: it.orderId,
        clientName: it.clientName ?? '—',
        pieces: 0,
        weight: 0,
      };
      e.pieces += 1;
      e.weight += it.weight;
      contribMap.set(it.orderId, e);
    }
    const totalG = items.reduce((s, it) => s + it.weight, 0);
    return {
      machineId: plan.machineId,
      machineRef: plan.machineRef,
      programId: '',
      capacity: plan.capacity,
      totalWeight: totalG / 1000,
      utilization: totalG / (plan.capacity * 1000),
      contributors: Array.from(contribMap.values()),
      items,
    };
  });

  const placed = batches.reduce((s, b) => s + b.items.length, 0);
  const avgUtil =
    batches.length > 0
      ? batches.reduce((s, b) => s + b.utilization, 0) / batches.length
      : 0;

  return {
    source: 'heuristic-stage',
    stage,
    batches,
    meta: {
      itemsPlaced: placed,
      itemsLeftover: tags.length - placed,
      averageUtilization: avgUtil,
    },
  };
}

/** Persiste une proposition (potentiellement éditée par l'humain) pour un
 *  stage post-lavage. Identique au comportement de createStageBatches mais
 *  prend la liste de batches en entrée. */
export async function persistStageProposal(
  actorUserId: string,
  proposal: StageProposal,
) {
  const stage = proposal.stage;

  // Cas finition : pas de batches à créer, on passe les items à `done`
  if (proposal.finalized) {
    const tagIds = proposal.batches.flatMap((b) => b.items.map((i) => i.tagId));
    if (tagIds.length === 0) return { batches: [], itemsPlaced: 0, finalized: true };
    return prisma.$transaction(async (tx) => {
      await tx.itemTag.updateMany({
        where: { id: { in: tagIds } },
        data: { state: 'done', finishedAt: new Date(), currentBatchId: null },
      });
      const orderIds = [
        ...new Set(
          proposal.batches.flatMap((b) => b.items.map((i) => i.orderId)),
        ),
      ];
      for (const orderId of orderIds) {
        const remaining = await tx.itemTag.count({
          where: { orderId, state: { notIn: ['done', 'lost'] } },
        });
        if (remaining === 0) {
          await tx.order.update({
            where: { id: orderId },
            data: {
              workflowState: 'FINITION_COMPLETED',
              status: 'ready',
              version: { increment: 1 },
            },
          });
        }
      }
      return { batches: [], itemsPlaced: tagIds.length, finalized: true };
    });
  }

  return prisma.$transaction(
    async (tx) => {
      const created = [];
      for (const b of proposal.batches) {
        if (b.items.length === 0) continue;
        if (!b.machineId) {
          throw new BadRequestError(
            'Un batch sans machine ne peut être persisté pour ce stage.',
          );
        }
        const code = `B-${nanoid(6).toUpperCase()}`;
        const totalG = b.items.reduce((s, it) => s + it.weight, 0);

        const byOrder = new Map<string, { pieces: number; weight: number }>();
        for (const it of b.items) {
          const e = byOrder.get(it.orderId) ?? { pieces: 0, weight: 0 };
          e.pieces += 1;
          e.weight += it.weight;
          byOrder.set(it.orderId, e);
        }

        const batch = await tx.batch.create({
          data: {
            code,
            stage,
            status: 'validated',
            machineId: b.machineId,
            programId: null,
            capacity: b.capacity,
            currentLoad: totalG,
            utilization: totalG / (b.capacity * 1000),
            estimatedDurationMin: 60,
            suggestedByAi: false,
            contributors: {
              create: Array.from(byOrder.entries()).map(([orderId, v]) => ({
                orderId,
                pieces: v.pieces,
                weight: v.weight,
              })),
            },
          },
        });

        await tx.itemTag.updateMany({
          where: { id: { in: b.items.map((i) => i.tagId) } },
          data: { currentBatchId: batch.id },
        });

        await tx.auditLog.create({
          data: {
            actorId: actorUserId,
            action: 'create',
            entity: 'batch',
            entityId: batch.id,
            payload: { stage, itemsCount: b.items.length, edited: true },
          },
        });

        created.push(batch);
      }

      return {
        batches: created,
        itemsPlaced: created.reduce(
          (s, b) =>
            s +
            ((proposal.batches.find((p) => p.machineId === b.machineId)?.items
              .length ?? 0) || 0),
          0,
        ),
      };
    },
    { isolationLevel: 'Serializable', timeout: 20_000 },
  );
}

/**
 * Crée des batches pour un stage post-lavage (sechage, calandrage, repassage,
 * finition). Récupère les items en attente, les groupe en batches selon les
 * machines compatibles, persiste en DB.
 */
export async function createStageBatches(
  actorUserId: string,
  stage: 'sechage' | 'calandrage' | 'repassage' | 'finition',
) {
  const waitingState = STAGE_TO_WAITING_STATE[stage];
  const machineKind = STAGE_TO_MACHINE_KIND[stage];

  // 1. Récupère les items en attente
  const tags = await prisma.itemTag.findMany({
    where: { state: waitingState, currentBatchId: null },
    include: { order: { include: { client: { select: { name: true } } } }, linenType: true },
    take: 500,
  });

  if (tags.length === 0) {
    return { batches: [], itemsPlaced: 0 };
  }

  // 2. Pour finition (pas de machine) : 1 seul "batch virtuel" qui passe les items en `done`
  if (!machineKind) {
    return prisma.$transaction(async (tx) => {
      // Pas de batch créé pour la finition — items passent directement à `done`
      await tx.itemTag.updateMany({
        where: { id: { in: tags.map((t) => t.id) } },
        data: { state: 'done', finishedAt: new Date(), currentBatchId: null },
      });
      // Met à jour les commandes dont tous les items sont done
      const orderIds = [...new Set(tags.map((t) => t.orderId))];
      for (const orderId of orderIds) {
        const remaining = await tx.itemTag.count({
          where: { orderId, state: { notIn: ['done', 'lost'] } },
        });
        if (remaining === 0) {
          await tx.order.update({
            where: { id: orderId },
            data: { workflowState: 'FINITION_COMPLETED', status: 'ready', version: { increment: 1 } },
          });
        }
      }
      return { batches: [], itemsPlaced: tags.length, finalized: true };
    });
  }

  // 3. Récupère les machines compatibles
  const machines = await prisma.machine.findMany({
    where: {
      status: 'active',
      OR:
        stage === 'sechage'
          ? [{ kind: 'secheuse' }, { kind: 'secheuse_repasseuse' }]
          : [{ kind: machineKind }],
    },
  });

  if (machines.length === 0) {
    throw new BadRequestError(`Aucune machine ${machineKind} active disponible`);
  }

  // 4. Bin-packing simple : Best-Fit Decreasing par capacité
  const sortedTags = [...tags].sort((a, b) => b.weight - a.weight);
  const sortedMachines = [...machines].sort((a, b) => b.capacityKg - a.capacityKg);
  const batchPlans: { machineId: string; capacity: number; tags: typeof tags }[] = [];

  for (const tag of sortedTags) {
    // Trouve le batch existant qui peut accueillir l'item avec le moins d'espace résiduel
    let bestIdx = -1;
    let bestRemaining = Infinity;
    for (let i = 0; i < batchPlans.length; i++) {
      const plan = batchPlans[i];
      if (!plan) continue;
      const used = plan.tags.reduce((s, t) => s + t.weight, 0);
      const remaining = plan.capacity * 1000 - used;
      if (tag.weight <= remaining && remaining - tag.weight < bestRemaining) {
        bestIdx = i;
        bestRemaining = remaining - tag.weight;
      }
    }
    const bestPlan = bestIdx >= 0 ? batchPlans[bestIdx] : undefined;
    if (bestPlan) {
      bestPlan.tags.push(tag);
    } else {
      // Crée un nouveau batch sur la prochaine machine dispo
      const machineIdx = batchPlans.length % sortedMachines.length;
      const machine = sortedMachines[machineIdx];
      if (machine && tag.weight <= machine.capacityKg * 1000) {
        batchPlans.push({ machineId: machine.id, capacity: machine.capacityKg, tags: [tag] });
      }
    }
  }

  // 5. Persiste les batches
  return prisma.$transaction(
    async (tx) => {
      const created = [];

      for (const plan of batchPlans) {
        const code = `B-${nanoid(6).toUpperCase()}`;
        const totalWeight = plan.tags.reduce((s, t) => s + t.weight, 0);
        const utilization = totalWeight / (plan.capacity * 1000);

        // Group tags by orderId pour les contributors
        const byOrder = new Map<string, { pieces: number; weight: number }>();
        for (const tag of plan.tags) {
          const e = byOrder.get(tag.orderId) ?? { pieces: 0, weight: 0 };
          e.pieces += 1;
          e.weight += tag.weight;
          byOrder.set(tag.orderId, e);
        }

        const batch = await tx.batch.create({
          data: {
            code,
            stage,
            status: 'validated',
            machineId: plan.machineId,
            programId: null,
            capacity: plan.capacity,
            currentLoad: totalWeight,
            utilization,
            estimatedDurationMin: 60, // estimation par défaut, à raffiner par programme
            suggestedByAi: false,
            contributors: {
              create: Array.from(byOrder.entries()).map(([orderId, v]) => ({
                orderId,
                pieces: v.pieces,
                weight: v.weight,
              })),
            },
          },
        });

        // Affecte les tags au batch (state inchangé, juste currentBatchId)
        await tx.itemTag.updateMany({
          where: { id: { in: plan.tags.map((t) => t.id) } },
          data: { currentBatchId: batch.id },
        });

        await tx.auditLog.create({
          data: {
            actorId: actorUserId,
            action: 'create',
            entity: 'batch',
            entityId: batch.id,
            payload: { stage, itemsCount: plan.tags.length },
          },
        });

        created.push(batch);
      }

      return { batches: created, itemsPlaced: tags.length };
    },
    { isolationLevel: 'Serializable', timeout: 20_000 },
  );
}

/** Liste tous les batches du Kanban (par stage). */
export async function listBatches(stage?: string) {
  const where = stage ? { stage: stage as 'lavage' | 'sechage' | 'calandrage' | 'repassage' | 'finition' } : {};
  return prisma.batch.findMany({
    where,
    include: {
      contributors: {
        include: {
          order: {
            select: {
              orderNumber: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
      },
      machine: { select: { reference: true, brand: true, model: true } },
      program: { select: { code: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/** Démarre un batch (validated → in_progress). */
export async function startBatch(batchId: string, actorUserId: string) {
  const updated = await prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundError('Batch not found');
    if (batch.status === 'in_progress' || batch.status === 'completed') {
      throw new ConflictError(`Cannot start batch in state ${batch.status}`);
    }

    const result = await tx.batch.update({
      where: { id: batchId },
      data: {
        status: 'in_progress',
        startedAt: new Date(),
        estimatedEndAt: new Date(Date.now() + batch.estimatedDurationMin * 60 * 1000),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'update',
        entity: 'batch',
        entityId: batchId,
        payload: { event: 'start' },
      },
    });

    return result;
  });

  broadcastBatchEvent('batch:started', {
    at: new Date().toISOString(),
    actorId: actorUserId,
    batchId: updated.id,
    code: updated.code,
    stage: updated.stage,
    status: updated.status,
  });

  return updated;
}

/**
 * Termine un batch (in_progress → completed). Avance les ItemTags affectés
 * vers le state suivant dans le pipeline du LinenType.
 *
 * Le pipeline est stocké par-type dans `linenType.pipeline` (ex: ['lavage',
 * 'calandrage'] pour un drap, ['lavage', 'sechage', 'finition'] pour un
 * sweat-shirt). On cherche le stage courant dans le tableau et on prend
 * le suivant ; si c'est le dernier → 'done'.
 *
 * Fallback legacy (pipeline vide ou data corrompue) : routage par catégorie.
 */
type TagNextState =
  | 'in_sechage'
  | 'in_calandrage'
  | 'in_repassage'
  | 'in_finition'
  | 'done';

type Stage = 'lavage' | 'sechage' | 'calandrage' | 'repassage' | 'finition';

const STAGE_TO_TAG_STATE: Record<Stage, Exclude<TagNextState, 'done'>> = {
  lavage: 'in_sechage', // lavage est un cas particulier (lui-même n'est pas un waiting state)
  sechage: 'in_sechage',
  calandrage: 'in_calandrage',
  repassage: 'in_repassage',
  finition: 'in_finition',
};

const LEGACY_POST_SECHAGE_BY_CATEGORY: Record<'LP' | 'LF' | 'NAE', TagNextState> = {
  LP: 'in_calandrage',
  LF: 'in_repassage',
  NAE: 'in_finition',
};

function nextTagStateFor(
  stage: Stage,
  pipeline: string[] | null | undefined,
  legacyCategory: 'LP' | 'LF' | 'NAE',
): TagNextState {
  // Pas de pipeline configuré → fallback comportement historique
  if (!pipeline || pipeline.length === 0) {
    switch (stage) {
      case 'lavage':
        return 'in_sechage';
      case 'sechage':
        return LEGACY_POST_SECHAGE_BY_CATEGORY[legacyCategory];
      case 'calandrage':
      case 'repassage':
        return 'in_finition';
      case 'finition':
        return 'done';
    }
  }
  // Pipeline défini : prend la prochaine étape dans le tableau
  const idx = pipeline.indexOf(stage);
  if (idx === -1) {
    // Stage hors pipeline (data error) → on considère terminé
    return 'done';
  }
  const next = pipeline[idx + 1];
  if (!next) return 'done';
  const nextStage = next as Stage;
  return STAGE_TO_TAG_STATE[nextStage] ?? 'done';
}

export async function completeBatch(
  batchId: string,
  actorUserId: string,
  dto: CompleteBatchDto,
) {
  const updated = await prisma.$transaction(
    async (tx) => {
      const batch = await tx.batch.findUnique({
        where: { id: batchId },
        include: {
          itemTags: {
            select: {
              id: true,
              orderId: true,
              linenType: { select: { category: true, pipeline: true } },
            },
          },
        },
      });
      if (!batch) throw new NotFoundError('Batch not found');
      if (batch.status !== 'in_progress') {
        throw new ConflictError(`Cannot complete batch in state ${batch.status}`);
      }

      const now = new Date();

      const result = await tx.batch.update({
        where: { id: batchId },
        data: {
          status: 'completed',
          completedAt: now,
          ...(dto.actualWaterL !== undefined ? { actualWaterL: dto.actualWaterL } : {}),
          ...(dto.actualEnergyKwh !== undefined
            ? { actualEnergyKwh: dto.actualEnergyKwh }
            : {}),
        },
      });

      // Route chaque tag selon le pipeline par-type défini sur le LinenType.
      // Permet par exemple : drap (LP) → calandrage / serviette éponge (LP) → sechage+finition.
      const buckets = new Map<TagNextState, string[]>();
      for (const t of batch.itemTags) {
        const cat = t.linenType.category as 'LP' | 'LF' | 'NAE';
        const next = nextTagStateFor(
          batch.stage as Stage,
          t.linenType.pipeline as string[] | null,
          cat,
        );
        if (!buckets.has(next)) buckets.set(next, []);
        buckets.get(next)!.push(t.id);
      }

      for (const [nextState, tagIds] of buckets) {
        await tx.itemTag.updateMany({
          where: { id: { in: tagIds } },
          data: {
            state: nextState,
            currentBatchId: null,
            scannedAt: now,
            ...(nextState === 'done' ? { finishedAt: now } : {}),
          },
        });
      }

      // Si tous les tags d'une commande sont "done", la commande passe en
      // FINITION_COMPLETED → markOrderReady devient possible.
      const wentToDone = buckets.has('done');
      if (wentToDone) {
        const doneTagIds = buckets.get('done') ?? [];
        const affectedOrderIds = [
          ...new Set(
            batch.itemTags
              .filter((t) => doneTagIds.includes(t.id))
              .map((t) => t.orderId),
          ),
        ];
        for (const orderId of affectedOrderIds) {
          const remaining = await tx.itemTag.count({
            where: { orderId, state: { notIn: ['done', 'lost'] } },
          });
          if (remaining === 0) {
            await tx.order.update({
              where: { id: orderId },
              data: { workflowState: 'FINITION_COMPLETED' },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          action: 'update',
          entity: 'batch',
          entityId: batchId,
          payload: {
            event: 'complete',
            stage: batch.stage,
            tagsAdvanced: batch.itemTags.length,
            routing: Object.fromEntries(
              Array.from(buckets.entries()).map(([k, v]) => [k, v.length]),
            ),
            actualWaterL: dto.actualWaterL,
            actualEnergyKwh: dto.actualEnergyKwh,
            notes: dto.notes,
          },
        },
      });

      return result;
    },
    { isolationLevel: 'Serializable', timeout: 20_000 },
  );

  broadcastBatchEvent('batch:completed', {
    at: new Date().toISOString(),
    actorId: actorUserId,
    batchId: updated.id,
    code: updated.code,
    stage: updated.stage,
    status: updated.status,
  });

  return updated;
}
