import { Router } from 'express';
import {
  authMiddleware,
  requireRoles,
} from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  createCreditNoteSchema,
  listCreditNotesSchema,
} from './credit-notes.dto.js';
import * as svc from './credit-notes.service.js';

export const creditNotesRouter = Router();
creditNotesRouter.use(authMiddleware);

creditNotesRouter.get(
  '/',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ query: listCreditNotesSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.listCreditNotes({
      clientId: req.query.clientId as string | undefined,
      orderId: req.query.orderId as string | undefined,
      status: req.query.status as 'draft' | 'issued' | 'cancelled' | undefined,
    });
    res.json(result);
  }),
);

creditNotesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const note = await svc.getCreditNote(req.params.id as string);
    res.json(note);
  }),
);

creditNotesRouter.post(
  '/',
  requireRoles('admin', 'manager'),
  validate({ body: createCreditNoteSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const note = await svc.createCreditNote(req.user.id, req.body);
    res.status(201).json(note);
  }),
);

creditNotesRouter.post(
  '/:id/issue',
  requireRoles('admin', 'manager'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const note = await svc.issueCreditNote(req.user.id, req.params.id as string);
    res.json(note);
  }),
);

creditNotesRouter.post(
  '/:id/cancel',
  requireRoles('admin', 'manager'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const note = await svc.cancelCreditNote(req.user.id, req.params.id as string);
    res.json(note);
  }),
);
