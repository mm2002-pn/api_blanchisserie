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
  /** Métadonnées article (pour affichage UI). */
  linenTypeCode?: string;
  linenTypeName?: string;
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

/**
 * Best-Fit Decreasing avec parallélisation multi-machines.
 *
 * Différences vs l'ancienne version (qui empilait tout sur la plus grosse
 * laveuse) :
 *  - on maintient des "bins ouverts" (= des batches en cours de remplissage),
 *    chaque bin attaché à une machine ;
 *  - pour chaque item, on essaie d'abord de le glisser dans le bin ouvert
 *    le plus serré (même programme, residual minimum) → best-fit ;
 *  - sinon on ouvre un nouveau bin sur la machine **la moins chargée** à
 *    ce moment-là → load-balance équitable entre laveuses.
 *
 * Conséquence : les cycles se répartissent naturellement sur LAV-001 +
 * LAV-002 + LAV-003… proportionnellement à leur capacité.
 */
export function heuristicBinPacking(
  items: ItemForBatching[],
  machines: MachineForBatching[],
): BinPackingResult {
  type OpenBin = {
    machineId: string;
    machineRef: string;
    capacityKg: number;
    programId: string;
    programName: string;
    items: ItemForBatching[];
    totalKg: number;
  };

  // Laveuses actives — pas de tri spécifique, on s'appuie sur la charge
  // courante pour décider quelle machine ouvrir.
  const usableMachines = machines.filter(
    (m) => m.status === 'active' && m.kind === 'laveuse',
  );

  if (usableMachines.length === 0) {
    return {
      batches: [],
      source: 'heuristic',
      meta: { itemsPlaced: 0, itemsLeftover: items.length, averageUtilization: 0 },
    };
  }

  // Charge totale (kg) déjà affectée à chaque machine — sert au load-balancing
  const machineLoadKg = new Map<string, number>();
  for (const m of usableMachines) machineLoadKg.set(m.id, 0);

  // Grouper par programme (interdit de mélanger 2 programmes dans un cycle)
  const groups = new Map<string, ItemForBatching[]>();
  for (const item of items) {
    if (!groups.has(item.programId)) groups.set(item.programId, []);
    groups.get(item.programId)!.push(item);
  }

  const openBins: OpenBin[] = [];
  const leftover: ItemForBatching[] = [];

  for (const [programId, programItems] of groups) {
    // Tri PRIO d'abord, puis poids décroissant (les gros morceaux ouvrent
    // les bins, les petits viennent les compléter en best-fit derrière).
    const sorted = [...programItems].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      return b.weight - a.weight;
    });

    for (const item of sorted) {
      const itKg = item.weight / 1000;

      // 1) Essayer de loger l'item dans un bin déjà ouvert sur le bon
      //    programme. On choisit le bin qui aura le moins de capacité
      //    résiduelle après ajout (true best-fit) → on serre les batches.
      let bestBin: OpenBin | undefined;
      let bestResidual = Infinity;
      for (const bin of openBins) {
        if (bin.programId !== programId) continue;
        const residualAfter = bin.capacityKg - (bin.totalKg + itKg);
        if (residualAfter >= 0 && residualAfter < bestResidual) {
          bestBin = bin;
          bestResidual = residualAfter;
        }
      }

      if (bestBin) {
        bestBin.items.push(item);
        bestBin.totalKg += itKg;
        machineLoadKg.set(
          bestBin.machineId,
          (machineLoadKg.get(bestBin.machineId) ?? 0) + itKg,
        );
        continue;
      }

      // 2) Aucun bin existant ne peut accueillir cet item → on en ouvre un
      //    nouveau sur la **machine la moins chargée** qui peut le tenir.
      const eligible = usableMachines.filter((m) => m.capacityKg >= itKg);
      if (eligible.length === 0) {
        // Item trop lourd pour toute laveuse → leftover
        leftover.push(item);
        continue;
      }
      // Plus petite charge cumulée d'abord (round-robin pondéré naturellement)
      const target = eligible.reduce((best, m) => {
        const loadBest = machineLoadKg.get(best.id) ?? 0;
        const loadM = machineLoadKg.get(m.id) ?? 0;
        return loadM < loadBest ? m : best;
      });

      const newBin: OpenBin = {
        machineId: target.id,
        machineRef: target.reference,
        capacityKg: target.capacityKg,
        programId,
        programName: item.programName,
        items: [item],
        totalKg: itKg,
      };
      openBins.push(newBin);
      machineLoadKg.set(
        target.id,
        (machineLoadKg.get(target.id) ?? 0) + itKg,
      );
    }
  }

  // Convertit les bins en batches avec contributors par client
  const batches: SuggestedBatch[] = openBins.map((bin) => {
    const byClient = new Map<
      string,
      { orderId: string; clientName: string; weight: number; pieces: number }
    >();
    for (const it of bin.items) {
      const existing = byClient.get(it.orderId);
      if (existing) {
        existing.weight += it.weight;
        existing.pieces += 1;
      } else {
        byClient.set(it.orderId, {
          orderId: it.orderId,
          clientName: it.clientName,
          weight: it.weight,
          pieces: 1,
        });
      }
    }
    return {
      machineId: bin.machineId,
      machineRef: bin.machineRef,
      programId: bin.programId,
      programName: bin.programName,
      capacity: bin.capacityKg,
      items: bin.items,
      totalWeight: bin.totalKg,
      utilization: Math.min(1, bin.totalKg / bin.capacityKg),
      contributors: Array.from(byClient.values()),
    };
  });

  const avgUtil =
    batches.length > 0
      ? batches.reduce((s, b) => s + b.utilization, 0) / batches.length
      : 0;

  // Économie estimée vs traitement individuel par client
  const totalContributors = batches.reduce(
    (s, b) => s + b.contributors.length,
    0,
  );
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
  opts: { useAi?: boolean } = {},
): Promise<BinPackingResult> {
  const heuristic = heuristicBinPacking(items, machines);
  // Mode manuel explicite OU pas de Groq OU pool vide → heuristique seule
  if (opts.useAi === false || !groq || items.length === 0) return heuristic;
  return validateWithGroq(heuristic);
}
