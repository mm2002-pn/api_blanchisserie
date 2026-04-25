import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import * as svc from './batches.service.js';

export const batchesRouter = Router();
batchesRouter.use(authMiddleware);

// GET /batches?stage=lavage
batchesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await svc.listBatches(req.query.stage as string | undefined);
    res.json({ items });
  }),
);

// POST /batches/suggest — IA bin-packing (lecture seule, pas de DB write)
batchesRouter.post(
  '/suggest',
  requireRoles('supervisor', 'manager', 'admin'),
  asyncHandler(async (_req, res) => {
    const proposal = await svc.suggestNewBatches();
    res.json(proposal);
  }),
);

// POST /batches/persist — créé les batches en DB depuis la proposition validée
batchesRouter.post(
  '/persist',
  requireRoles('supervisor', 'manager', 'admin'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const proposal = await svc.suggestNewBatches();
    const created = await svc.persistBatches(req.user.id, proposal);
    res.status(201).json({ items: created, count: created.length });
  }),
);

// POST /batches/:id/start
batchesRouter.post(
  '/:id/start',
  requireRoles('supervisor', 'operator', 'admin'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const batch = await svc.startBatch(req.params.id as string, req.user.id);
    res.json(batch);
  }),
);
