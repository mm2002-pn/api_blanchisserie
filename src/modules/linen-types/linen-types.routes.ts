import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  createLinenTypeSchema,
  listLinenTypesSchema,
  updateLinenTypeSchema,
} from './linen-types.dto.js';
import * as svc from './linen-types.service.js';

export const linenTypesRouter = Router();
linenTypesRouter.use(authMiddleware);

linenTypesRouter.get(
  '/',
  validate({ query: listLinenTypesSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.listLinenTypes({
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

linenTypesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const linen = await svc.getLinenType(req.params.id as string);
    res.json(linen);
  }),
);

linenTypesRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createLinenTypeSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const linen = await svc.createLinenType(req.user.id, req.body);
    res.status(201).json(linen);
  }),
);

linenTypesRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updateLinenTypeSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const linen = await svc.updateLinenType(
      req.user.id,
      req.params.id as string,
      req.body,
    );
    res.json(linen);
  }),
);
