import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { createTriageSchema, printLabelsSchema } from './triage.dto.js';
import * as svc from './triage.service.js';

export const triageRouter = Router();
triageRouter.use(authMiddleware);

triageRouter.post(
  '/orders/:orderId',
  requireRoles('operator', 'supervisor', 'admin', 'manager'),
  validate({ body: createTriageSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await svc.createTriage(
      req.params.orderId as string,
      req.user.id,
      req.body,
    );
    res.status(201).json(result);
  }),
);

triageRouter.post(
  '/orders/:orderId/labels/print',
  requireRoles('operator', 'supervisor', 'admin', 'manager'),
  validate({ body: printLabelsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const triage = await svc.markLabelsPrinted(
      req.params.orderId as string,
      req.user.id,
      req.body.printerStation,
    );
    res.json(triage);
  }),
);

triageRouter.get(
  '/orders/:orderId/tags',
  asyncHandler(async (req, res) => {
    const tags = await svc.listOrderTags(req.params.orderId as string);
    res.json({ items: tags });
  }),
);
