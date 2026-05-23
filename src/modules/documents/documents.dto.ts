import { z } from 'zod';

export const updateCompanySettingsSchema = z.object({
  companyName: z.string().min(1).max(120).optional(),
  legalForm: z.string().max(40).nullable().optional(),
  ninea: z.string().max(40).nullable().optional(),
  rcNumber: z.string().max(40).nullable().optional(),
  address: z.string().min(1).max(200).optional(),
  city: z.string().min(1).max(80).optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().max(80).optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  logoUrl: z.string().max(500).nullable().optional(),
  vatRate: z.number().min(0).max(1).optional(),
  bankName: z.string().max(80).nullable().optional(),
  bankAccount: z.string().max(80).nullable().optional(),
  bankSwift: z.string().max(40).nullable().optional(),
  legalMentions: z.string().max(2000).nullable().optional(),
  paymentTerms: z.string().max(200).optional(),
});

export const listDeliveriesSchema = z.object({
  orderId: z.string().optional(),
  type: z
    .enum([
      'BON_COMMANDE',
      'BON_COLLECTE',
      'BORDEREAU_TRIAGE',
      'BON_LIVRAISON',
      'FACTURE',
      'AVOIR',
    ])
    .optional(),
  status: z.enum(['pending', 'sent', 'failed']).optional(),
});
