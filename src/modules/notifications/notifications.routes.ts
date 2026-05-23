import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  enqueueNotificationSchema,
  listNotificationsSchema,
  processQueueSchema,
} from './notifications.dto.js';
import * as svc from './notifications.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(authMiddleware);

notificationsRouter.get(
  '/',
  requireRoles('admin', 'manager'),
  validate({ query: listNotificationsSchema }),
  asyncHandler(async (req, res) => {
    const q = req.validated?.query as {
      status?: 'queued' | 'sent' | 'failed';
      channel?: 'email' | 'push' | 'sms';
      recipientUserId?: string;
      page: number;
      pageSize: number;
    };
    const result = await svc.listNotifications(q);
    res.json(result);
  }),
);

notificationsRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: enqueueNotificationSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const notif = await svc.enqueue(req.body);
    res.status(201).json(notif);
  }),
);

notificationsRouter.post(
  '/process',
  requireRoles('admin', 'manager'),
  validate({ body: processQueueSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const limit = (req.body as { limit?: number }).limit ?? 50;
    const result = await svc.processQueue(limit);
    res.json(result);
  }),
);

notificationsRouter.post(
  '/test',
  requireRoles('admin'),
  validate({ body: enqueueNotificationSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const notif = await svc.notifyImmediate(req.body);
    res.status(201).json(notif);
  }),
);
