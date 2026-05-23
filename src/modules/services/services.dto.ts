import { z } from 'zod';

export const createServiceSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().default(true),
});

export const updateServiceSchema = createServiceSchema.partial();

export const listServicesSchema = z.object({
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export type ListServicesDto = z.infer<typeof listServicesSchema>;
