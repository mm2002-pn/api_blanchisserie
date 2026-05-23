import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { listAuditLogsSchema, type ListAuditLogsDto } from './audit.dto.js';
import * as svc from './audit.service.js';

export const auditRouter = Router();
auditRouter.use(authMiddleware);

auditRouter.get(
  '/',
  requireRoles('admin', 'manager'),
  validate({ query: listAuditLogsSchema }),
  asyncHandler(async (req, res) => {
    const q = req.validated?.query as ListAuditLogsDto;
    const result = await svc.listAuditLogs(q);
    res.json(result);
  }),
);

auditRouter.get(
  '/:entity/:entityId',
  requireRoles('admin', 'manager', 'supervisor'),
  asyncHandler(async (req, res) => {
    const trail = await svc.getAuditTrail(
      req.params.entity as string,
      req.params.entityId as string,
    );
    res.json(trail);
  }),
);
