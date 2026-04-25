import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  cancelOrderCtrl,
  collectOrderCtrl,
  createOrderCtrl,
  getOrderCtrl,
  listOrdersCtrl,
  receiveOrderCtrl,
} from './orders.controller.js';
import {
  cancelOrderSchema,
  collectOrderSchema,
  createOrderSchema,
  receiveOrderSchema,
} from './orders.dto.js';

export const ordersRouter = Router();

ordersRouter.use(authMiddleware);

ordersRouter.get('/', listOrdersCtrl);
ordersRouter.get('/:id', getOrderCtrl);
ordersRouter.post(
  '/',
  requireRoles('hotel', 'admin', 'manager', 'operator'),
  validate({ body: createOrderSchema }),
  createOrderCtrl,
);
ordersRouter.post(
  '/:id/collect',
  requireRoles('driver', 'admin', 'manager'),
  validate({ body: collectOrderSchema }),
  collectOrderCtrl,
);
ordersRouter.post(
  '/:id/receive',
  requireRoles('operator', 'supervisor', 'admin', 'manager'),
  validate({ body: receiveOrderSchema }),
  receiveOrderCtrl,
);
ordersRouter.post(
  '/:id/cancel',
  requireRoles('admin', 'manager'),
  validate({ body: cancelOrderSchema }),
  cancelOrderCtrl,
);
