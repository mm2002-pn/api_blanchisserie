import { z } from 'zod';

export const roleEnum = z.enum([
  'admin',
  'manager',
  'supervisor',
  'operator',
  'driver',
  'hotel',
]);

export const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z
    .string()
    .min(8, 'Au moins 8 caractères')
    .max(200)
    .regex(/[A-Z]/, 'Doit contenir une majuscule')
    .regex(/[a-z]/, 'Doit contenir une minuscule')
    .regex(/[0-9]/, 'Doit contenir un chiffre'),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  phone: z.string().max(40).optional(),
  role: roleEnum,
  clientId: z.string().optional(),
});

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional(),
  role: roleEnum.optional(),
  clientId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const resetPasswordAdminSchema = z.object({
  newPassword: z.string().min(8).max(200),
});

export const setDriverStatusSchema = z.object({
  driverStatus: z.enum(['available', 'on_route', 'off_duty', 'unavailable']),
});

export const listUsersSchema = z.object({
  role: roleEnum.optional(),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});
