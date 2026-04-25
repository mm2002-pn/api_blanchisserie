import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { strictLimiter } from '../../middleware/rate-limit.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  changePasswordCtrl,
  loginCtrl,
  logoutCtrl,
  meCtrl,
  refreshCtrl,
} from './auth.controller.js';
import { changePasswordSchema, loginSchema, refreshSchema } from './auth.dto.js';

export const authRouter = Router();

authRouter.post('/login', strictLimiter, validate({ body: loginSchema }), loginCtrl);
authRouter.post('/refresh', validate({ body: refreshSchema }), refreshCtrl);
authRouter.post('/logout', validate({ body: refreshSchema }), logoutCtrl);
authRouter.get('/me', authMiddleware, meCtrl);
authRouter.post(
  '/change-password',
  authMiddleware,
  validate({ body: changePasswordSchema }),
  changePasswordCtrl,
);
