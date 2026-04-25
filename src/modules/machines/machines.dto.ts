import { z } from 'zod';

export const machineKindEnum = z.enum([
  'laveuse',
  'secheuse',
  'calandre',
  'presse',
  'secheuse_repasseuse',
]);

export const machineStatusEnum = z.enum(['active', 'maintenance', 'hors_service']);

export const createMachineSchema = z.object({
  reference: z.string().min(1).max(40),
  brand: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  kind: machineKindEnum,
  capacityKg: z.number().int().positive(),
  location: z.string().min(1).max(120),
  status: machineStatusEnum.default('active'),
});

export const updateMachineSchema = createMachineSchema.partial().extend({
  lastMaintenanceAt: z.string().datetime().optional(),
  nextMaintenanceAt: z.string().datetime().optional(),
});

export const listMachinesSchema = z.object({
  kind: machineKindEnum.optional(),
  status: machineStatusEnum.optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});
