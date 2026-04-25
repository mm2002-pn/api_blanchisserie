import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.js';
import { batchesRouter } from '../modules/batches/batches.routes.js';
import { clientsRouter } from '../modules/clients/clients.routes.js';
import { linenTypesRouter } from '../modules/linen-types/linen-types.routes.js';
import { machinesRouter } from '../modules/machines/machines.routes.js';
import { ordersRouter } from '../modules/orders/orders.routes.js';
import { triageRouter } from '../modules/triage/triage.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { washProgramsRouter } from '../modules/wash-programs/wash-programs.routes.js';

export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'Blanchisserie SN API',
    version: 'v1',
    modules: [
      'auth',
      'users',
      'clients',
      'orders',
      'triage',
      'batches',
      'machines',
      'wash-programs',
      'linen-types',
    ],
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/clients', clientsRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/triage', triageRouter);
apiRouter.use('/batches', batchesRouter);
apiRouter.use('/machines', machinesRouter);
apiRouter.use('/wash-programs', washProgramsRouter);
apiRouter.use('/linen-types', linenTypesRouter);
