import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { ForbiddenError, UnauthorizedError } from '../../utils/errors.js';
import {
  createUserSchema,
  listUsersSchema,
  resetPasswordAdminSchema,
  updateUserSchema,
} from './users.dto.js';
import * as svc from './users.service.js';

export const usersRouter = Router();
usersRouter.use(authMiddleware);

usersRouter.get(
  '/',
  requireRoles('admin', 'manager'),
  validate({ query: listUsersSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.listUsers({
      role: req.query.role as string | undefined,
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

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    // Un user peut lire son propre profil ; sinon admin/manager
    if (req.user.id !== req.params.id && !['admin', 'manager'].includes(req.user.role)) {
      throw new ForbiddenError();
    }
    const user = await svc.getUser(req.params.id as string);
    res.json(user);
  }),
);

usersRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const user = await svc.createUser(req.user.id, req.body);
    res.status(201).json(user);
  }),
);

usersRouter.patch(
  '/:id',
  requireRoles('admin', 'manager'),
  validate({ body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const user = await svc.updateUser(req.user.id, req.params.id as string, req.body);
    res.json(user);
  }),
);

usersRouter.post(
  '/:id/reset-password',
  requireRoles('admin'),
  validate({ body: resetPasswordAdminSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    await svc.adminResetPassword(
      req.user.id,
      req.params.id as string,
      req.body.newPassword,
    );
    res.json({ ok: true });
  }),
);

usersRouter.delete(
  '/:id',
  requireRoles('admin'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    if (req.user.id === req.params.id) {
      throw new ForbiddenError('Cannot deactivate yourself');
    }
    const user = await svc.deactivateUser(req.user.id, req.params.id as string);
    res.json(user);
  }),
);
