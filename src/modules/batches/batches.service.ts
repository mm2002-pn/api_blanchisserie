import { nanoid } from 'nanoid';
import { prisma } from '../../config/prisma.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../utils/errors.js';
import {
  suggestBatches as aiSuggest,
  type ItemForBatching,
  type MachineForBatching,
} from '../ai/bin-packing.service.js';

/**
 * Récupère le pool d'items en attente de lavage et appelle le bin-packing IA.
 * Les batches retournés sont en mémoire (pas encore persistés).
 */
export async function suggestNewBatches() {
  // 1. Pool d'items "triaged" pas encore affectés à un batch
  const tags = await prisma.itemTag.findMany({
    where: { state: 'triaged', currentBatchId: null },
    include: {
      order: { include: { client: { select: { name: true } } } },
      linenType: true,
    },
    take: 500,
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

  // 4. Bin-packing IA
  return aiSuggest(items, machines);
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

      return created;
    },
    { isolationLevel: 'Serializable', timeout: 30000 },
  );
}

/** Liste tous les batches du Kanban (par stage). */
export async function listBatches(stage?: string) {
  const where = stage ? { stage: stage as 'lavage' | 'sechage' | 'calandrage' | 'repassage' | 'finition' } : {};
  return prisma.batch.findMany({
    where,
    include: {
      contributors: { include: { } },
      machine: { select: { reference: true, brand: true, model: true } },
      program: { select: { code: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/** Démarre un batch (validated → in_progress). */
export async function startBatch(batchId: string, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundError('Batch not found');
    if (batch.status === 'in_progress' || batch.status === 'completed') {
      throw new ConflictError(`Cannot start batch in state ${batch.status}`);
    }

    const updated = await tx.batch.update({
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

    return updated;
  });
}
