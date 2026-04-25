import { z } from 'zod';

export const linenCategoryEnum = z.enum(['LP', 'LF', 'NAE']);

export const createWashProgramSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  temperature: z.number().int().min(0).max(95),
  durationMin: z.number().int().positive(),
  spinSpeed: z.number().int().min(0),
  waterLiters: z.number().int().min(0),
  detergentType: z.string().min(1).max(80),
  suitable: z.array(linenCategoryEnum).min(1),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
});

export const updateWashProgramSchema = createWashProgramSchema.partial();

export const listWashProgramsSchema = z.object({
  category: linenCategoryEnum.optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
});
