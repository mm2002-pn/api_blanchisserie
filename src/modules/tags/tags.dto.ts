import { z } from 'zod';

const TAG_STATES = [
  'triaged',
  'in_lavage',
  'in_sechage',
  'in_calandrage',
  'in_repassage',
  'in_finition',
  'done',
  'lost',
] as const;

export const tagStateSchema = z.enum(TAG_STATES);

export const scanTagSchema = z.object({
  station: z.string().min(1).max(60),
  nextState: tagStateSchema.optional(),
  batchId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  geoLat: z.number().optional(),
  geoLng: z.number().optional(),
});

export const bulkScanSchema = z.object({
  tags: z.array(z.string().min(1).max(60)).min(1).max(200),
  station: z.string().min(1).max(60),
  nextState: tagStateSchema.optional(),
  batchId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const listTagsSchema = z.object({
  orderId: z.string().optional(),
  state: tagStateSchema.optional(),
  batchId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export const markLostSchema = z.object({
  reason: z.string().min(3).max(500),
});

export type ScanTagDto = z.infer<typeof scanTagSchema>;
export type BulkScanDto = z.infer<typeof bulkScanSchema>;
export type ListTagsDto = z.infer<typeof listTagsSchema>;
export type TagState = z.infer<typeof tagStateSchema>;
