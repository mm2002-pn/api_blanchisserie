import { z } from 'zod';

const linenItemSchema = z.object({
  category: z.enum(['LP', 'LF', 'NAE']),
  type: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const createOrderSchema = z.object({
  estimatedItems: z.array(linenItemSchema).min(1),
  collectionDate: z.string().datetime(),
  instructions: z.string().max(2000).optional(),
});

export const listOrdersSchema = z.object({
  status: z.string().optional(),
  clientId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});

export const collectOrderSchema = z.object({
  driverWeight: z.number().int().positive(),
  driverPieces: z.number().int().positive(),
  visualEstimation: z.enum(['S', 'M', 'L', 'XL']).optional(),
  collectionPhotos: z.array(z.string().url()).max(10).default([]),
  signatureUrl: z.string().url().optional(),
  recipientName: z.string().max(120).optional(),
  geoLat: z.number().optional(),
  geoLng: z.number().optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const receiveOrderSchema = z.object({
  receivedWeight: z.number().int().positive(),
  receivedPieces: z.number().int().positive(),
  acceptDeviation: z.boolean().default(false),
  expectedVersion: z.number().int().nonnegative(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().min(3).max(500),
  expectedVersion: z.number().int().nonnegative(),
});

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type CollectOrderDto = z.infer<typeof collectOrderSchema>;
export type ReceiveOrderDto = z.infer<typeof receiveOrderSchema>;
