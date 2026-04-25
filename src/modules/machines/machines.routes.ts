import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  createMachineSchema,
  listMachinesSchema,
  updateMachineSchema,
} from './machines.dto.js';
import * as svc from './machines.service.js';

export const machinesRouter = Router();
machinesRouter.use(authMiddleware);

machinesRouter.get(
  '/',
  validate({ query: listMachinesSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.listMachines({
      kind: req.query.kind as string | undefined,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
    });
    res.json(result);
  }),
);

machinesRouter.get(
  '/capacity-overview',
  asyncHandler(async (_req, res) => {
    const overview = await svc.getCapacityOverview();
    res.json(overview);
  }),
);

machinesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const machine = await svc.getMachine(req.params.id as string);
    res.json(machine);
  }),
);

machinesRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createMachineSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const machine = await svc.createMachine(req.user.id, req.body);
    res.status(201).json(machine);
  }),
);

machinesRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updateMachineSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const machine = await svc.updateMachine(
      req.user.id,
      req.params.id as string,
      req.body,
    );
    res.json(machine);
  }),
);
