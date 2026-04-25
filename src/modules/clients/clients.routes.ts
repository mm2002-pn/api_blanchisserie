import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  createClientSchema,
  listClientsSchema,
  updateClientSchema,
} from './clients.dto.js';
import * as svc from './clients.service.js';

export const clientsRouter = Router();
clientsRouter.use(authMiddleware);

clientsRouter.get(
  '/',
  requireRoles('admin', 'manager', 'supervisor', 'operator'),
  validate({ query: listClientsSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.listClients({
      type: req.query.type as string | undefined,
      search: req.query.search as string | undefined,
      isActive:
        typeof req.query.isActive === 'undefined'
          ? undefined
          : Boolean(req.query.isActive),
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
    });
    res.json(result);
  }),
);

clientsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    if (req.user.role === 'hotel' && req.user.clientId !== req.params.id) {
      throw new UnauthorizedError('Cannot access another client');
    }
    const client = await svc.getClient(req.params.id as string);
    res.json(client);
  }),
);

clientsRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createClientSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const client = await svc.createClient(req.user.id, req.body);
    res.status(201).json(client);
  }),
);

clientsRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updateClientSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const client = await svc.updateClient(req.user.id, req.params.id as string, req.body);
    res.json(client);
  }),
);
