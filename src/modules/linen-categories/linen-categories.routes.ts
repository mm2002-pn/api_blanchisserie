import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  listLinenCategoriesSchema,
  updateLinenCategorySchema,
  upsertLinenCategorySchema,
} from './linen-categories.dto.js';
import * as svc from './linen-categories.service.js';

export const linenCategoriesRouter = Router();
linenCategoriesRouter.use(authMiddleware);

linenCategoriesRouter.get(
  '/',
  validate({ query: listLinenCategoriesSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.listLinenCategories({
      isActive:
        typeof req.query.isActive === 'undefined'
          ? undefined
          : req.query.isActive === 'true',
    });
    res.json(result);
  }),
);

linenCategoriesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const cat = await svc.getLinenCategory(req.params.id as string);
    res.json(cat);
  }),
);

linenCategoriesRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: upsertLinenCategorySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const cat = await svc.upsertLinenCategory(req.user.id, req.body);
    res.status(201).json(cat);
  }),
);

linenCategoriesRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updateLinenCategorySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const cat = await svc.updateLinenCategory(
      req.user.id,
      req.params.id as string,
      req.body,
    );
    res.json(cat);
  }),
);
