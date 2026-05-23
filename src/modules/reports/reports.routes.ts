import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { clientReportSchema, periodSchema, type ClientReportDto, type PeriodDto } from './reports.dto.js';
import * as svc from './reports.service.js';

export const reportsRouter = Router();
reportsRouter.use(authMiddleware);

reportsRouter.get(
  '/dashboard',
  requireRoles('admin', 'manager', 'supervisor'),
  asyncHandler(async (_req, res) => {
    const result = await svc.dashboardSummary();
    res.json(result);
  }),
);

reportsRouter.get(
  '/production',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ query: periodSchema }),
  asyncHandler(async (req, res) => {
    const q = req.validated?.query as PeriodDto;
    const result = await svc.productionReport(q);
    res.json(result);
  }),
);

reportsRouter.get(
  '/revenue',
  requireRoles('admin', 'manager'),
  validate({ query: periodSchema }),
  asyncHandler(async (req, res) => {
    const q = req.validated?.query as PeriodDto;
    const result = await svc.revenueReport(q);
    res.json(result);
  }),
);

reportsRouter.get(
  '/clients/:clientId',
  requireRoles('admin', 'manager'),
  validate({ query: periodSchema }),
  asyncHandler(async (req, res) => {
    const q = req.validated?.query as PeriodDto;
    const dto: ClientReportDto = clientReportSchema.parse({
      clientId: req.params.clientId as string,
      from: q.from,
      to: q.to,
    });
    const result = await svc.clientReport(dto);
    res.json(result);
  }),
);
