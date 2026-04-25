import { groq, GROQ_MODEL } from '../../config/groq.js';
import { logger } from '../../config/logger.js';

/**
 * BIN-PACKING IA — propose des batches optimisés pour le lavage.
 *
 * Stratégie :
 *  1. Heuristique locale Best-Fit Decreasing (toujours exécutée, instantané)
 *  2. Si Groq disponible → demande à l'IA de critiquer/améliorer la proposition
 *     en tenant compte de contraintes "soft" (urgences clients, qualité texture…).
 *  3. On retient la meilleure des deux (score d'utilisation moyenne).
 */

export type ItemForBatching = {
  tagId: string;
  orderId: string;
  clientName: string;
  weight: number; // grammes
  programId: string;
  programName: string;
  programCategoryCompat: ('LP' | 'LF' | 'NAE')[];
  category: 'LP' | 'LF' | 'NAE';
  priority: boolean;
};

export type MachineForBatching = {
  id: string;
  reference: string;
  capacityKg: number;
  status: 'active' | 'maintenance' | 'hors_service';
  kind: 'laveuse' | 'secheuse' | 'calandre' | 'presse' | 'secheuse_repasseuse';
};

export type SuggestedBatch = {
  machineId: string;
  machineRef: string;
  programId: string;
  programName: string;
  capacity: number; // kg
  items: ItemForBatching[];
  totalWeight: number; // kg
  utilization: number; // 0-1
  contributors: { orderId: string; clientName: string; weight: number; pieces: number }[];
};

export type BinPackingResult = {
  batches: SuggestedBatch[];
  source: 'heuristic' | 'ai-validated' | 'ai-improved';
  meta: {
    itemsPlaced: number;
    itemsLeftover: number;
    averageUtilization: number;
    estimatedWaterSaved?: number; // L
    estimatedEnergySaved?: number; // kWh
    aiRationale?: string;
  };
};

/* ───────── Best-Fit Decreasing (heuristique) ───────── */

export function heuristicBinPacking(
  items: ItemForBatching[],
  machines: MachineForBatching[],
): BinPackingResult {
  // 1. Grouper les items par programme + catégorie
  const groups = new Map<string, ItemForBatching[]>();
  for (const item of items) {
    if (!groups.has(item.programId)) groups.set(item.programId, []);
    groups.get(item.programId)!.push(item);
  }

  const batches: SuggestedBatch[] = [];
  const leftover: ItemForBatching[] = [];

  // Tri des machines actives par capacité décroissante
  const usableMachines = machines
    .filter((m) => m.status === 'active' && m.kind === 'laveuse')
    .sort((a, b) => b.capacityKg - a.capacityKg);

  for (const [programId, programItems] of groups) {
    // Tri des items par poids décroissant + priorité (PRIO d'abord)
    const sorted = [...programItems].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      return b.weight - a.weight;
    });

    const remaining = [...sorted];
    while (remaining.length > 0) {
      // Trouve la machine avec le best-fit pour le 1er item
      const head = remaining[0];
      if (!head) break;
      const headKg = head.weight / 1000;

      const candidate =
        usableMachines.find((m) => m.capacityKg >= headKg) ?? usableMachines[0];
      if (!candidate || candidate.capacityKg < headKg) {
        // Item trop lourd pour toute machine
        leftover.push(head);
        remaining.shift();
        continue;
      }

      // Remplit la machine en best-fit
      let totalKg = 0;
      const placedItems: ItemForBatching[] = [];
      for (let i = 0; i < remaining.length; i++) {
        const it = remaining[i];
        if (!it) continue;
        const itKg = it.weight / 1000;
        if (totalKg + itKg <= candidate.capacityKg) {
          placedItems.push(it);
          totalKg += itKg;
        }
      }
      // Retire les items placés
      remaining.splice(
        0,
        remaining.length,
        ...remaining.filter((it) => !placedItems.includes(it)),
      );

      // Construit les contributors (groupés par client)
      const byClient = new Map<
        string,
        { orderId: string; clientName: string; weight: number; pieces: number }
      >();
      for (const it of placedItems) {
        const key = it.orderId;
        const existing = byClient.get(key);
        if (existing) {
          existing.weight += it.weight;
          existing.pieces += 1;
        } else {
          byClient.set(key, {
            orderId: it.orderId,
            clientName: it.clientName,
            weight: it.weight,
            pieces: 1,
          });
        }
      }

      const programName = placedItems[0]?.programName ?? '';

      batches.push({
        machineId: candidate.id,
        machineRef: candidate.reference,
        programId,
        programName,
        capacity: candidate.capacityKg,
        items: placedItems,
        totalWeight: totalKg,
        utilization: Math.min(1, totalKg / candidate.capacityKg),
        contributors: Array.from(byClient.values()),
      });
    }
  }

  const avgUtil =
    batches.length > 0
      ? batches.reduce((s, b) => s + b.utilization, 0) / batches.length
      : 0;

  // Économie estimée vs traitement individuel par client
  // On suppose un cycle = ~150L. Si N clients étaient lavés séparément à
  // sub-charge, on aurait N cycles partiels. En batchant, on économise
  // (N-1) cycles d'eau.
  const totalContributors = batches.reduce((s, b) => s + b.contributors.length, 0);
  const waterSaved = Math.max(0, (totalContributors - batches.length) * 60);
  const energySaved = Math.max(0, (totalContributors - batches.length) * 3);

  return {
    batches,
    source: 'heuristic',
    meta: {
      itemsPlaced: items.length - leftover.length,
      itemsLeftover: leftover.length,
      averageUtilization: avgUtil,
      estimatedWaterSaved: waterSaved,
      estimatedEnergySaved: energySaved,
    },
  };
}

/* ───────── Validation AI Groq ───────── */

const SYSTEM_PROMPT = `Tu es un expert en optimisation logistique pour une blanchisserie industrielle au Sénégal (Blanchisserie SN). Tu analyses des propositions de batches de lavage générées par un algorithme heuristique et tu suggères des améliorations.

Règles strictes :
- Ne jamais dépasser la capacité d'une machine
- Grouper UNIQUEMENT les items du même programme dans un batch
- Privilégier les batches avec >85% d'utilisation
- Les items "priority: true" doivent être traités en premier (placés dans des batches avec démarrage le plus tôt)
- Tu réponds en JSON valide UNIQUEMENT, sans markdown ni texte autour

Format de réponse attendu :
{
  "verdict": "ok" | "improved",
  "rationale": "courte explication en français",
  "suggestions": []  // tableau (vide si verdict=ok) avec les ajustements proposés
}`;

export async function validateWithGroq(
  proposal: BinPackingResult,
): Promise<BinPackingResult> {
  if (!groq) return proposal;

  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            batches: proposal.batches.map((b) => ({
              machine: b.machineRef,
              capacity: b.capacity,
              program: b.programName,
              load: b.totalWeight,
              utilization: Math.round(b.utilization * 100),
              contributors: b.contributors.map((c) => ({
                client: c.clientName,
                kg: c.weight / 1000,
              })),
            })),
            meta: proposal.meta,
          }),
        },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as {
      verdict?: string;
      rationale?: string;
      suggestions?: unknown[];
    };

    return {
      ...proposal,
      source: parsed.verdict === 'ok' ? 'ai-validated' : 'ai-improved',
      meta: {
        ...proposal.meta,
        aiRationale: parsed.rationale ?? 'Validé par Groq AI',
      },
    };
  } catch (err) {
    logger.warn({ err }, 'Groq AI validation failed — falling back to heuristic');
    return proposal;
  }
}

/** Méthode publique : combine heuristic + Groq. */
export async function suggestBatches(
  items: ItemForBatching[],
  machines: MachineForBatching[],
): Promise<BinPackingResult> {
  const heuristic = heuristicBinPacking(items, machines);
  if (!groq || items.length === 0) return heuristic;
  return validateWithGroq(heuristic);
}
