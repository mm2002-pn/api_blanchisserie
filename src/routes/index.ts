import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.js';
import { batchesRouter } from '../modules/batches/batches.routes.js';
import { clientsRouter } from '../modules/clients/clients.routes.js';
import { ordersRouter } from '../modules/orders/orders.routes.js';
import { triageRouter } from '../modules/triage/triage.routes.js';

export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'Blanchisserie SN API',
    version: 'v1',
    endpoints: [
      'POST   /auth/login',
      'POST   /auth/refresh',
      'POST   /auth/logout',
      'GET    /auth/me',
      'POST   /auth/change-password',
      'GET    /clients',
      'POST   /clients',
      'GET    /clients/:id',
      'PATCH  /clients/:id',
      'GET    /orders',
      'POST   /orders',
      'GET    /orders/:id',
      'POST   /orders/:id/collect',
      'POST   /orders/:id/receive',
      'POST   /orders/:id/cancel',
      'POST   /triage/orders/:orderId',
      'POST   /triage/orders/:orderId/labels/print',
      'GET    /triage/orders/:orderId/tags',
      'GET    /batches',
      'POST   /batches/suggest',
      'POST   /batches/persist',
      'POST   /batches/:id/start',
    ],
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/clients', clientsRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/triage', triageRouter);
apiRouter.use('/batches', batchesRouter);
