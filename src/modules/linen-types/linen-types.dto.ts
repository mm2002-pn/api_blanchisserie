import { z } from 'zod';

export const linenCategoryEnum = z.enum(['LP', 'LF', 'NAE']);
export const billingModeEnum = z.enum(['weight', 'piece']);

export const createLinenTypeSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  category: linenCategoryEnum,
  averageWeight: z.number().int().nonnegative(), // grammes
  billingMode: billingModeEnum,
  unitPrice: z.number().nonnegative(),
  treatmentMinutes: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional(),
  imageUrl: z.string().min(1).max(500).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateLinenTypeSchema = createLinenTypeSchema.partial();

export const listLinenTypesSchema = z.object({
  category: linenCategoryEnum.optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
});
