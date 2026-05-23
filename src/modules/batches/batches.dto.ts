import { z } from 'zod';

export const completeBatchSchema = z.object({
  actualWaterL: z.number().int().nonnegative().optional(),
  actualEnergyKwh: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});

export type CompleteBatchDto = z.infer<typeof completeBatchSchema>;
