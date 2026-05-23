import { z } from 'zod';

export const tariffTypeEnum = z.enum([
  'standard',
  'premium',
  'forfait',
  'segment',
  'service',
]);

export const billingModeEnum = z.enum(['weight', 'piece']);

const tariffItemSchema = z.object({
  linenTypeCode: z.string().min(1).max(40),
  linenTypeName: z.string().min(1).max(120),
  pricePerKg: z.number().nonnegative().nullable().optional(),
  pricePerPiece: z.number().nonnegative().nullable().optional(),
  billingMode: billingModeEnum,
});

export const createTariffSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  type: tariffTypeEnum,
  description: z.string().max(500).optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().optional(),

  // Forfait fields
  monthlyPriceFcfa: z.number().nonnegative().optional(),
  monthlyKgLimit: z.number().int().nonnegative().optional(),
  overagePerKgFcfa: z.number().nonnegative().optional(),

  applicableClientTypes: z
    .array(
      z.enum([
        'hotel_5_etoiles',
        'hotel_4_etoiles',
        'hotel_3_etoiles',
        'restaurant',
        'autre',
      ]),
    )
    .default([]),

  items: z.array(tariffItemSchema).default([]),
});

export const updateTariffSchema = createTariffSchema.partial();

export const listTariffsSchema = z.object({
  type: tariffTypeEnum.optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
});
