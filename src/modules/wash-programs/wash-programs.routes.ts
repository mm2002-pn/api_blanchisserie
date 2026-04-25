import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  createWashProgramSchema,
  listWashProgramsSchema,
  updateWashProgramSchema,
} from './wash-programs.dto.js';
import * as svc from './wash-programs.service.js';

export const washProgramsRouter = Router();
washProgramsRouter.use(authMiddleware);

washProgramsRouter.get(
  '/',
  validate({ query: listWashProgramsSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.listWashPrograms({
      category: req.query.category as string | undefined,
      isActive:
        typeof req.query.isActive === 'undefined'
          ? undefined
          : Boolean(req.query.isActive),
      search: req.query.search as string | undefined,
    });
    res.json(result);
  }),
);

washProgramsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const program = await svc.getWashProgram(req.params.id as string);
    res.json(program);
  }),
);

washProgramsRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createWashProgramSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const program = await svc.createWashProgram(req.user.id, req.body);
    res.status(201).json(program);
  }),
);

washProgramsRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updateWashProgramSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const program = await svc.updateWashProgram(
      req.user.id,
      req.params.id as string,
      req.body,
    );
    res.json(program);
  }),
);
