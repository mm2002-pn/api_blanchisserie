import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  createVehicleSchema,
  enrollVehicleSchema,
  listVehiclesSchema,
  recordMaintenanceSchema,
  setVehicleStatusSchema,
  updateVehicleSchema,
  type ListVehiclesDto,
} from './vehicles.dto.js';
import * as svc from './vehicles.service.js';

export const vehiclesRouter = Router();
vehiclesRouter.use(authMiddleware);

vehiclesRouter.get(
  '/',
  validate({ query: listVehiclesSchema }),
  asyncHandler(async (req, res) => {
    const q = req.validated?.query as ListVehiclesDto;
    const result = await svc.listVehicles(q);
    res.json(result);
  }),
);

vehiclesRouter.get(
  '/overview',
  requireRoles('admin', 'manager', 'supervisor'),
  asyncHandler(async (_req, res) => {
    const result = await svc.getFleetOverview();
    res.json(result);
  }),
);

vehiclesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const v = await svc.getVehicle(req.params.id as string);
    res.json(v);
  }),
);

vehiclesRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createVehicleSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const v = await svc.createVehicle(req.user.id, req.body);
    res.status(201).json(v);
  }),
);

vehiclesRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updateVehicleSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const v = await svc.updateVehicle(req.user.id, req.params.id as string, req.body);
    res.json(v);
  }),
);

vehiclesRouter.post(
  '/:id/status',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ body: setVehicleStatusSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const v = await svc.setVehicleStatus(req.user.id, req.params.id as string, req.body);
    res.json(v);
  }),
);

vehiclesRouter.post(
  '/:id/maintenance',
  requireRoles('admin', 'manager'),
  validate({ body: recordMaintenanceSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const v = await svc.recordMaintenance(req.user.id, req.params.id as string, req.body);
    res.json(v);
  }),
);

/** Enrolle un crew (chauffeur + PDA) sur le vehicule. */
vehiclesRouter.post(
  '/:id/enroll',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ body: enrollVehicleSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const v = await svc.enrollVehicle(req.user.id, req.params.id as string, req.body);
    res.json(v);
  }),
);

/** Historique des enrollements d'un vehicule. */
vehiclesRouter.get(
  '/:id/enrollments',
  asyncHandler(async (req, res) => {
    const history = await svc.getVehicleEnrollmentHistory(req.params.id as string);
    res.json(history);
  }),
);
