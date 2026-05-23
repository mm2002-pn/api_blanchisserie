import { z } from 'zod';

export const listVehiclesSchema = z.object({
  status: z.enum(['available', 'in_route', 'maintenance', 'out_of_service']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export const createVehicleSchema = z.object({
  matricule: z.string().min(2).max(20),
  brand: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  capacityKg: z.number().int().positive().max(20_000),
  fuelLevel: z.number().int().min(0).max(100).default(100),
  status: z
    .enum(['available', 'in_route', 'maintenance', 'out_of_service'])
    .default('available'),
  enrolledDriverId: z.string().nullable().optional(),
  enrolledPdaId: z.string().nullable().optional(),
});

export const updateVehicleSchema = createVehicleSchema.partial();

/** Enrolle un chauffeur + un PDA sur un vehicule (crew binding).
 *  startsAt / endsAt optionnels : defaults a now() pour startsAt, null pour endsAt. */
export const enrollVehicleSchema = z.object({
  driverId: z.string().nullable(),
  pdaId: z.string().nullable(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).optional(),
});

export const setVehicleStatusSchema = z.object({
  status: z.enum(['available', 'in_route', 'maintenance', 'out_of_service']),
  reason: z.string().max(500).optional(),
});

export const recordMaintenanceSchema = z.object({
  notes: z.string().min(3).max(1000),
  fuelLevel: z.number().int().min(0).max(100).optional(),
  performedAt: z.string().datetime().optional(),
});

export type ListVehiclesDto = z.infer<typeof listVehiclesSchema>;
export type CreateVehicleDto = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleDto = z.infer<typeof updateVehicleSchema>;
export type SetVehicleStatusDto = z.infer<typeof setVehicleStatusSchema>;
export type RecordMaintenanceDto = z.infer<typeof recordMaintenanceSchema>;
export type EnrollVehicleDto = z.infer<typeof enrollVehicleSchema>;
