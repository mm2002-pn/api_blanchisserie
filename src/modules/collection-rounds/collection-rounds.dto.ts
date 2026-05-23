import { z } from 'zod';

const ROUND_STATUS = z.enum(['planned', 'in_progress', 'completed', 'cancelled']);
export const ROUND_TYPE = z.enum(['collect', 'delivery']);

export const listCollectionRoundsSchema = z.object({
  type: ROUND_TYPE.optional(),
  status: ROUND_STATUS.optional(),
  vehicleId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export const createCollectionRoundSchema = z.object({
  type: ROUND_TYPE.default('collect'),
  vehicleId: z.string().min(1),
  plannedAt: z.string().datetime(),
  orderIds: z.array(z.string().min(1)).min(1, 'Au moins une commande requise'),
  notes: z.string().max(500).optional(),
});

export const updateCollectionRoundSchema = z.object({
  vehicleId: z.string().optional(),
  plannedAt: z.string().datetime().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const addOrdersToRoundSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1),
});

export const removeOrderFromRoundSchema = z.object({
  orderId: z.string().min(1),
});

export const cancelRoundSchema = z.object({
  reason: z.string().min(3).max(500),
});

export const unloadRoundSchema = z.object({
  signatureUrl: z.string().min(1).max(500),
  recipientName: z.string().max(120).optional(),
});

export type ListCollectionRoundsDto = z.infer<typeof listCollectionRoundsSchema>;
export type CreateCollectionRoundDto = z.infer<typeof createCollectionRoundSchema>;
export type UpdateCollectionRoundDto = z.infer<typeof updateCollectionRoundSchema>;
export type AddOrdersToRoundDto = z.infer<typeof addOrdersToRoundSchema>;
export type RemoveOrderFromRoundDto = z.infer<typeof removeOrderFromRoundSchema>;
export type CancelRoundDto = z.infer<typeof cancelRoundSchema>;
export type UnloadRoundDto = z.infer<typeof unloadRoundSchema>;
