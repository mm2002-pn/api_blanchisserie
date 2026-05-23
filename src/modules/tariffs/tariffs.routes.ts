import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  createTariffSchema,
  listTariffsSchema,
  updateTariffSchema,
} from './tariffs.dto.js';
import * as svc from './tariffs.service.js';

export const tariffsRouter = Router();
tariffsRouter.use(authMiddleware);

tariffsRouter.get(
  '/',
  validate({ query: listTariffsSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.listTariffs({
      type: req.query.type as string | undefined,
      isActive:
        typeof req.query.isActive === 'undefined'
          ? undefined
          : Boolean(req.query.isActive),
      search: req.query.search as string | undefined,
    });
    res.json(result);
  }),
);

/** Tarif applicable au client : assigné ou défaut. Scope hotel = soi-même. */
tariffsRouter.get(
  '/applicable/:clientId',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    if (req.user.role === 'hotel' && req.user.clientId !== req.params.clientId) {
      throw new UnauthorizedError('Cannot access another client tariff');
    }
    const tariff = await svc.getApplicableTariff(req.params.clientId as string);
    res.json(tariff);
  }),
);

tariffsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tariff = await svc.getTariff(req.params.id as string);
    res.json(tariff);
  }),
);

tariffsRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createTariffSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const tariff = await svc.createTariff(req.user.id, req.body);
    res.status(201).json(tariff);
  }),
);

tariffsRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updateTariffSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const tariff = await svc.updateTariff(
      req.user.id,
      req.params.id as string,
      req.body,
    );
    res.json(tariff);
  }),
);
