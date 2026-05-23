import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { completeBatchSchema } from './batches.dto.js';
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

// GET /batches/waiting-counts — items en attente par stage post-lavage
batchesRouter.get(
  '/waiting-counts',
  asyncHandler(async (_req, res) => {
    const counts = await svc.countWaitingItemsByStage();
    res.json(counts);
  }),
);

// POST /batches/create-stage-batches — crée les batches pour un stage donné
// Body : { stage: 'sechage' | 'calandrage' | 'repassage' | 'finition' }
batchesRouter.post(
  '/create-stage-batches',
  requireRoles('supervisor', 'manager', 'admin'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const { stage } = req.body as {
      stage: 'sechage' | 'calandrage' | 'repassage' | 'finition';
    };
    const result = await svc.createStageBatches(req.user.id, stage);
    res.status(201).json(result);
  }),
);

// POST /batches/suggest-stage — propose un plan pour un stage post-lavage
// (renvoie la proposition sans persister, pour permettre l'édition manuelle)
// Body : { stage }
batchesRouter.post(
  '/suggest-stage',
  requireRoles('supervisor', 'manager', 'admin'),
  asyncHandler(async (req, res) => {
    const { stage } = req.body as {
      stage: 'sechage' | 'calandrage' | 'repassage' | 'finition';
    };
    const proposal = await svc.suggestStageBatches(stage);
    res.json(proposal);
  }),
);

// POST /batches/persist-stage — persiste une proposition de stage (éditée ou non)
// Body : { proposal: StageProposal }
batchesRouter.post(
  '/persist-stage',
  requireRoles('supervisor', 'manager', 'admin'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const { proposal } = req.body as {
      proposal: Awaited<ReturnType<typeof svc.suggestStageBatches>>;
    };
    const result = await svc.persistStageProposal(req.user.id, proposal);
    res.status(201).json(result);
  }),
);

// POST /batches/suggest — bin-packing
// Body optionnel : { orderIds: string[], useAi: boolean }
batchesRouter.post(
  '/suggest',
  requireRoles('supervisor', 'manager', 'admin'),
  asyncHandler(async (req, res) => {
    const { orderIds, useAi } = req.body as { orderIds?: string[]; useAi?: boolean };
    const proposal = await svc.suggestNewBatches(orderIds, useAi !== false);
    res.json(proposal);
  }),
);

// POST /batches/persist
// Body :
//  - { proposal }         → persiste la proposition fournie (validée par humain)
//  - { orderIds, useAi }  → re-calcule la proposition puis persiste (raccourci)
batchesRouter.post(
  '/persist',
  requireRoles('supervisor', 'manager', 'admin'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const body = req.body as {
      proposal?: Awaited<ReturnType<typeof svc.suggestNewBatches>>;
      orderIds?: string[];
      useAi?: boolean;
    };
    const proposal =
      body.proposal ??
      (await svc.suggestNewBatches(body.orderIds, body.useAi !== false));
    const created = await svc.persistBatches(req.user.id, proposal);
    res.status(201).json({
      items: created,
      count: created.length,
      meta: proposal.meta,
      source: proposal.source,
    });
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

// POST /batches/:id/complete
batchesRouter.post(
  '/:id/complete',
  requireRoles('supervisor', 'operator', 'admin'),
  validate({ body: completeBatchSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const batch = await svc.completeBatch(
      req.params.id as string,
      req.user.id,
      req.body,
    );
    res.json(batch);
  }),
);
