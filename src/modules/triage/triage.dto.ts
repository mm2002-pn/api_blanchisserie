import { z } from 'zod';

export const createTriageSchema = z.object({
  expectedOrderVersion: z.number().int().nonnegative(),
  items: z
    .array(
      z.object({
        linenTypeId: z.string().min(1),
        pieces: z.number().int().positive(),
        weight: z.number().int().nonnegative(), // grammes
      }),
    )
    .min(1),
  /**
   * Si true, ignore le contrôle d'écart 5% et accepte le triage tel quel.
   * Réservé aux superviseurs.
   */
  acceptDeviation: z.boolean().default(false),
});

export const printLabelsSchema = z.object({
  /** Optionnel : si fourni, l'opérateur a vérifié l'impression sur l'imprimante xx */
  printerStation: z.string().max(60).optional(),
});

export type CreateTriageDto = z.infer<typeof createTriageSchema>;
