import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  cancelInvoiceSchema,
  generateInvoicesSchema,
  listInvoicesSchema,
  recordPaymentSchema,
} from './invoices.dto.js';
import * as svc from './invoices.service.js';

export const invoicesRouter = Router();
invoicesRouter.use(authMiddleware);

invoicesRouter.get(
  '/',
  validate({ query: listInvoicesSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const q = req.validated?.query as {
      status?: string;
      clientId?: string;
      search?: string;
      page: number;
      pageSize: number;
    };

    const scopeClientId =
      req.user.role === 'hotel' ? req.user.clientId ?? '__none__' : undefined;

    const result = await svc.listInvoices({
      status: q.status,
      clientId: q.clientId,
      search: q.search,
      page: q.page,
      pageSize: q.pageSize,
      scopeClientId: scopeClientId ?? undefined,
    });
    res.json(result);
  }),
);

invoicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const scopeClientId =
      req.user.role === 'hotel' ? req.user.clientId ?? '__none__' : undefined;
    const invoice = await svc.getInvoice(req.params.id as string, scopeClientId ?? undefined);
    res.json(invoice);
  }),
);

invoicesRouter.post(
  '/generate',
  requireRoles('admin', 'manager'),
  validate({ body: generateInvoicesSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await svc.generateInvoicesForPeriod(req.user.id, req.body);
    res.status(201).json(result);
  }),
);

invoicesRouter.post(
  '/:id/payments',
  requireRoles('admin', 'manager'),
  validate({ body: recordPaymentSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const updated = await svc.recordPayment(req.params.id as string, req.user.id, req.body);
    res.json(updated);
  }),
);

invoicesRouter.post(
  '/:id/cancel',
  requireRoles('admin'),
  validate({ body: cancelInvoiceSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const { reason, expectedVersion } = req.body as {
      reason: string;
      expectedVersion: number;
    };
    const updated = await svc.cancelInvoice(
      req.params.id as string,
      req.user.id,
      reason,
      expectedVersion,
    );
    res.json(updated);
  }),
);

invoicesRouter.post(
  '/mark-overdue',
  requireRoles('admin', 'manager'),
  asyncHandler(async (_req, res) => {
    const result = await svc.markOverdueInvoices();
    res.json(result);
  }),
);

invoicesRouter.post(
  '/:id/pdf',
  requireRoles('admin', 'manager'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const force = req.query.force === 'true';
    const result = await svc.generateInvoicePdf(
      req.params.id as string,
      req.user.id,
      force,
    );
    res.json(result);
  }),
);

invoicesRouter.post(
  '/:id/email',
  requireRoles('admin', 'manager'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await svc.mailInvoice(req.params.id as string, req.user.id);
    res.json(result);
  }),
);
