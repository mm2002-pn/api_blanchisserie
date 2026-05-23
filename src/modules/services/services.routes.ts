import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  createServiceSchema,
  listServicesSchema,
  updateServiceSchema,
} from './services.dto.js';
import * as svc from './services.service.js';

export const servicesRouter = Router();
servicesRouter.use(authMiddleware);

servicesRouter.get(
  '/',
  validate({ query: listServicesSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.listServices({
      isActive:
        typeof req.query.isActive === 'undefined'
          ? undefined
          : Boolean(req.query.isActive),
      search: req.query.search as string | undefined,
    });
    res.json(result);
  }),
);

servicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = await svc.getService(req.params.id as string);
    res.json(service);
  }),
);

servicesRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createServiceSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const service = await svc.createService(req.user.id, req.body);
    res.status(201).json(service);
  }),
);

servicesRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updateServiceSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const service = await svc.updateService(
      req.user.id,
      req.params.id as string,
      req.body,
    );
    res.json(service);
  }),
);
