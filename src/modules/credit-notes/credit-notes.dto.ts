import { z } from 'zod';

export const createCreditNoteSchema = z.object({
  clientId: z.string().min(1),
  orderId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
  reason: z.string().min(3).max(2000),
  amountFcfa: z.number().nonnegative(),
});

export const updateCreditNoteSchema = z.object({
  reason: z.string().min(3).max(2000).optional(),
  amountFcfa: z.number().nonnegative().optional(),
});

export const listCreditNotesSchema = z.object({
  clientId: z.string().optional(),
  orderId: z.string().optional(),
  status: z.enum(['draft', 'issued', 'cancelled']).optional(),
});
