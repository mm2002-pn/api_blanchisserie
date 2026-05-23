import { z } from 'zod';

const PDA_STATUS = z.enum([
  'available',
  'in_use',
  'maintenance',
  'out_of_service',
]);

export const listPdasSchema = z.object({
  status: PDA_STATUS.optional(),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export const createPdaSchema = z.object({
  reference: z.string().min(2).max(50),
  brand: z.string().max(60).nullable().optional(),
  model: z.string().max(60).nullable().optional(),
  status: PDA_STATUS.default('available'),
  batteryLevel: z.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updatePdaSchema = createPdaSchema.partial();

export const setPdaStatusSchema = z.object({
  status: PDA_STATUS,
  reason: z.string().max(500).optional(),
});

export type ListPdasDto = z.infer<typeof listPdasSchema>;
export type CreatePdaDto = z.infer<typeof createPdaSchema>;
export type UpdatePdaDto = z.infer<typeof updatePdaSchema>;
export type SetPdaStatusDto = z.infer<typeof setPdaStatusSchema>;
