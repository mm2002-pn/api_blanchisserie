import { z } from 'zod';

export const clientTypeEnum = z.enum([
  'hotel_5_etoiles',
  'hotel_4_etoiles',
  'hotel_3_etoiles',
  'restaurant',
  'autre',
]);

export const createClientSchema = z.object({
  name: z.string().min(2).max(200),
  type: clientTypeEnum,
  address: z.string().min(2).max(500),
  city: z.string().max(120).default('Dakar'),
  contactPerson: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
  ninea: z.string().max(40).optional(),
  geoLat: z.number().optional(),
  geoLng: z.number().optional(),
  tariffId: z.string().optional(),
});

export const updateClientSchema = createClientSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const listClientsSchema = z.object({
  type: clientTypeEnum.optional(),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
