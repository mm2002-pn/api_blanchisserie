import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { registerPushTokenSchema } from './push-tokens.dto.js';
import * as svc from './push-tokens.service.js';

export const pushTokensRouter = Router();
pushTokensRouter.use(authMiddleware);

/** POST /push-tokens — enregistre/réactive un token Expo pour le user courant. */
pushTokensRouter.post(
  '/',
  validate({ body: registerPushTokenSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const token = await svc.registerToken(req.user.id, req.body);
    res.status(201).json(token);
  }),
);

/** GET /push-tokens/me — liste les tokens du user courant (debug / déconnexion d'autres devices). */
pushTokensRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const items = await svc.listMyTokens(req.user.id);
    res.json({ items });
  }),
);

/** DELETE /push-tokens/:id — désactive un token (logout sur ce device). */
pushTokensRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const updated = await svc.unregisterToken(req.user.id, req.params.id as string);
    res.json(updated);
  }),
);
