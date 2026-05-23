import { Router } from 'express';
import { auditRouter } from '../modules/audit/audit.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { batchesRouter } from '../modules/batches/batches.routes.js';
import { clientsRouter } from '../modules/clients/clients.routes.js';
import { collectionRoundsRouter } from '../modules/collection-rounds/collection-rounds.routes.js';
import { creditNotesRouter } from '../modules/credit-notes/credit-notes.routes.js';
import { documentsRouter } from '../modules/documents/documents.routes.js';
import { invoicesRouter } from '../modules/invoices/invoices.routes.js';
import { linenCategoriesRouter } from '../modules/linen-categories/linen-categories.routes.js';
import { linenTypesRouter } from '../modules/linen-types/linen-types.routes.js';
import { machinesRouter } from '../modules/machines/machines.routes.js';
import { pdasRouter } from '../modules/pdas/pdas.routes.js';
import { notificationsRouter } from '../modules/notifications/notifications.routes.js';
import { ordersRouter } from '../modules/orders/orders.routes.js';
import { pushTokensRouter } from '../modules/push-tokens/push-tokens.routes.js';
import { reportsRouter } from '../modules/reports/reports.routes.js';
import { servicesRouter } from '../modules/services/services.routes.js';
import { tagsRouter } from '../modules/tags/tags.routes.js';
import { tariffsRouter } from '../modules/tariffs/tariffs.routes.js';
import { triageRouter } from '../modules/triage/triage.routes.js';
import { uploadsRouter } from '../modules/uploads/uploads.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { vehiclesRouter } from '../modules/vehicles/vehicles.routes.js';
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
      'linen-categories',
      'linen-types',
      'services',
      'tariffs',
      'invoices',
      'documents',
      'credit-notes',
      'notifications',
      'reports',
      'audit',
      'vehicles',
      'pdas',
      'uploads',
      'tags',
      'push-tokens',
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
apiRouter.use('/linen-categories', linenCategoriesRouter);
apiRouter.use('/linen-types', linenTypesRouter);
apiRouter.use('/services', servicesRouter);
apiRouter.use('/tariffs', tariffsRouter);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/documents', documentsRouter);
apiRouter.use('/credit-notes', creditNotesRouter);
apiRouter.use('/collection-rounds', collectionRoundsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/vehicles', vehiclesRouter);
apiRouter.use('/pdas', pdasRouter);
apiRouter.use('/uploads', uploadsRouter);
apiRouter.use('/tags', tagsRouter);
apiRouter.use('/push-tokens', pushTokensRouter);
