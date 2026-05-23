import { z } from 'zod';

const categoryCodeSchema = z.enum(['LP', 'LF', 'NAE']);

export const upsertLinenCategorySchema = z.object({
  code: categoryCodeSchema,
  label: z.string().min(1).max(80),
  emoji: z.string().max(8).optional().nullable(),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});

export const updateLinenCategorySchema = z.object({
  label: z.string().min(1).max(80).optional(),
  emoji: z.string().max(8).optional().nullable(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

export const listLinenCategoriesSchema = z.object({
  isActive: z.coerce.boolean().optional(),
});
