import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  cancelOrderCtrl,
  collectOrderCtrl,
  confirmOrderCtrl,
  createOrderCtrl,
  deliverOrderCtrl,
  getOrderCtrl,
  listOrdersCtrl,
  markOrderReadyCtrl,
  receiveOrderCtrl,
  scheduleDeliveryCtrl,
  startDeliveryCtrl,
  updateOrderCtrl,
} from './orders.controller.js';
import {
  cancelOrderSchema,
  collectOrderSchema,
  confirmOrderSchema,
  createOrderSchema,
  deliverOrderSchema,
  markOrderReadySchema,
  receiveOrderSchema,
  scheduleDeliverySchema,
  startDeliverySchema,
  updateOrderSchema,
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
ordersRouter.patch(
  '/:id',
  requireRoles('hotel', 'admin', 'manager'),
  validate({ body: updateOrderSchema }),
  updateOrderCtrl,
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
ordersRouter.post(
  '/:id/confirm',
  requireRoles('admin', 'manager'),
  validate({ body: confirmOrderSchema }),
  confirmOrderCtrl,
);
ordersRouter.post(
  '/:id/ready',
  requireRoles('supervisor', 'manager', 'admin'),
  validate({ body: markOrderReadySchema }),
  markOrderReadyCtrl,
);
ordersRouter.post(
  '/:id/schedule-delivery',
  requireRoles('admin', 'manager'),
  validate({ body: scheduleDeliverySchema }),
  scheduleDeliveryCtrl,
);
ordersRouter.post(
  '/:id/start-delivery',
  requireRoles('driver', 'admin', 'manager'),
  validate({ body: startDeliverySchema }),
  startDeliveryCtrl,
);
ordersRouter.post(
  '/:id/deliver',
  requireRoles('driver', 'admin', 'manager'),
  validate({ body: deliverOrderSchema }),
  deliverOrderCtrl,
);
