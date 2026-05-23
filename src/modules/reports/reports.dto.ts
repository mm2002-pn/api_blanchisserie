import { z } from 'zod';

export const periodSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const clientReportSchema = z.object({
  clientId: z.string(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type PeriodDto = z.infer<typeof periodSchema>;
export type ClientReportDto = z.infer<typeof clientReportSchema>;
