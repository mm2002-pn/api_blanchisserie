import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  createPdaSchema,
  listPdasSchema,
  setPdaStatusSchema,
  updatePdaSchema,
  type ListPdasDto,
} from './pdas.dto.js';
import * as svc from './pdas.service.js';

export const pdasRouter = Router();
pdasRouter.use(authMiddleware);

pdasRouter.get(
  '/',
  validate({ query: listPdasSchema }),
  asyncHandler(async (req, res) => {
    const q = req.validated?.query as ListPdasDto;
    const result = await svc.listPdas(q);
    res.json(result);
  }),
);

pdasRouter.get(
  '/overview',
  requireRoles('admin', 'manager', 'supervisor'),
  asyncHandler(async (_req, res) => {
    const result = await svc.getPdaOverview();
    res.json(result);
  }),
);

pdasRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const v = await svc.getPda(req.params.id as string);
    res.json(v);
  }),
);

pdasRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createPdaSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const v = await svc.createPda(req.user.id, req.body);
    res.status(201).json(v);
  }),
);

pdasRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updatePdaSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const v = await svc.updatePda(req.user.id, req.params.id as string, req.body);
    res.json(v);
  }),
);

pdasRouter.post(
  '/:id/status',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ body: setPdaStatusSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const v = await svc.setPdaStatus(req.user.id, req.params.id as string, req.body);
    res.json(v);
  }),
);

