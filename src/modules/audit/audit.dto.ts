import { z } from 'zod';

export const listAuditLogsSchema = z.object({
  entity: z.string().min(1).max(60).optional(),
  entityId: z.string().optional(),
  actorId: z.string().optional(),
  action: z
    .enum([
      'create',
      'update',
      'delete',
      'login',
      'logout',
      'permission',
      'scan',
      'weigh',
      'sign',
      'print',
      'ai_suggest',
      'ai_validate',
    ])
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export type ListAuditLogsDto = z.infer<typeof listAuditLogsSchema>;
