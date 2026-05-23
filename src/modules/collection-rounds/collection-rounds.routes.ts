import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  addOrdersToRoundSchema,
  cancelRoundSchema,
  createCollectionRoundSchema,
  listCollectionRoundsSchema,
  removeOrderFromRoundSchema,
  unloadRoundSchema,
  updateCollectionRoundSchema,
  type ListCollectionRoundsDto,
} from './collection-rounds.dto.js';
import * as svc from './collection-rounds.service.js';

export const collectionRoundsRouter = Router();
collectionRoundsRouter.use(authMiddleware);

collectionRoundsRouter.get(
  '/',
  validate({ query: listCollectionRoundsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const q = req.validated?.query as ListCollectionRoundsDto;
    // Le chauffeur ne voit que SES tournées (via vehicle.enrolledDriverId).
    const driverScopeId = req.user.role === 'driver' ? req.user.id : undefined;
    const result = await svc.listCollectionRounds(q, { driverScopeId });
    res.json(result);
  }),
);

collectionRoundsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const round = await svc.getCollectionRound(req.params.id as string);
    res.json(round);
  }),
);

collectionRoundsRouter.post(
  '/',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ body: createCollectionRoundSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const round = await svc.createCollectionRound(req.user.id, req.body);
    res.status(201).json(round);
  }),
);

collectionRoundsRouter.patch(
  '/:id',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ body: updateCollectionRoundSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const round = await svc.updateCollectionRound(
      req.user.id,
      req.params.id as string,
      req.body,
    );
    res.json(round);
  }),
);

collectionRoundsRouter.post(
  '/:id/orders/add',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ body: addOrdersToRoundSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const round = await svc.addOrdersToRound(req.user.id, req.params.id as string, req.body);
    res.json(round);
  }),
);

collectionRoundsRouter.post(
  '/:id/orders/remove',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ body: removeOrderFromRoundSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const round = await svc.removeOrderFromRound(
      req.user.id,
      req.params.id as string,
      req.body,
    );
    res.json(round);
  }),
);

collectionRoundsRouter.post(
  '/:id/start',
  // Le chauffeur peut démarrer SA tournée — le service vérifie que c'est bien
  // lui l'enrolledDriver du véhicule. Admin/manager/supervisor également.
  requireRoles('admin', 'manager', 'supervisor', 'driver'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const round = await svc.startCollectionRound(
      req.user.id,
      req.params.id as string,
      { driverScopeId: req.user.role === 'driver' ? req.user.id : undefined },
    );
    res.json(round);
  }),
);

collectionRoundsRouter.post(
  '/:id/unload',
  // Le chauffeur peut décharger SA tournée. Admin/manager/supervisor également.
  requireRoles('admin', 'manager', 'supervisor', 'driver'),
  validate({ body: unloadRoundSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const round = await svc.unloadCollectionRound(
      req.user.id,
      req.params.id as string,
      req.body,
      { driverScopeId: req.user.role === 'driver' ? req.user.id : undefined },
    );
    res.json(round);
  }),
);

collectionRoundsRouter.post(
  '/:id/cancel',
  requireRoles('admin', 'manager'),
  validate({ body: cancelRoundSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const round = await svc.cancelCollectionRound(
      req.user.id,
      req.params.id as string,
      req.body,
    );
    res.json(round);
  }),
);
