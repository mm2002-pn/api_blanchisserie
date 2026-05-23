import { z } from 'zod';

export const generateInvoicesSchema = z.object({
  /** Période de facturation */
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  /** Optionnel : facturer un seul client */
  clientId: z.string().optional(),
  /** Date d'échéance (par défaut periodEnd + 30j) */
  dueDate: z.string().datetime().optional(),
  /** Taux de TVA (par défaut 0.18 = 18%) */
  taxRate: z.number().min(0).max(1).default(0.18),
});

export const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(['cash', 'orange_money', 'wave', 'virement', 'cheque']),
  paidDate: z.string().datetime().optional(),
  reference: z.string().max(120).optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const cancelInvoiceSchema = z.object({
  reason: z.string().min(3).max(500),
  expectedVersion: z.number().int().nonnegative(),
});

export const listInvoicesSchema = z.object({
  status: z.enum(['draft', 'pending', 'paid', 'overdue', 'cancelled']).optional(),
  clientId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

export type GenerateInvoicesDto = z.infer<typeof generateInvoicesSchema>;
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;
