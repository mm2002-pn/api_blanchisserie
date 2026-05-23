import path from 'node:path';
import { Router } from 'express';
import {
  authMiddleware,
  requireRoles,
} from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../utils/errors.js';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import {
  generateBonCollecte,
  generateBonCommande,
  generateBonLivraison,
  generateBordereauTriage,
} from './documents.generator.js';
import {
  getCompanySettings,
  updateCompanySettings,
} from './documents.service.js';
import {
  listDeliveriesSchema,
  updateCompanySettingsSchema,
} from './documents.dto.js';

export const documentsRouter = Router();
documentsRouter.use(authMiddleware);

/* ─── COMPANY SETTINGS ─────────────────────────────────────────── */

documentsRouter.get(
  '/company-settings',
  asyncHandler(async (_req, res) => {
    const settings = await getCompanySettings();
    res.json(settings);
  }),
);

documentsRouter.patch(
  '/company-settings',
  requireRoles('admin', 'manager'),
  validate({ body: updateCompanySettingsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const settings = await updateCompanySettings(req.user.id, req.body);
    res.json(settings);
  }),
);

/* ─── ORDER DOCUMENTS (génère + renvoie le PDF) ───────────────── */

async function checkOrderAccess(orderId: string, user: { role: string; clientId?: string | null }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, clientId: true },
  });
  if (!order) throw new NotFoundError('Order not found');
  if (user.role === 'hotel' && order.clientId !== user.clientId) {
    throw new ForbiddenError('Cannot access another client order');
  }
  return order;
}

function sendPdfFile(res: Parameters<Parameters<typeof documentsRouter.get>[1]>[1], pdfPath: string, downloadName: string) {
  const abs = pdfPath.startsWith('/uploads/')
    ? path.join(env.UPLOAD_DIR, pdfPath.slice('/uploads/'.length))
    : pdfPath;
  res.download(abs, downloadName);
}

documentsRouter.get(
  '/orders/:id/bon-commande.pdf',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    await checkOrderAccess(req.params.id as string, req.user);
    const doc = await generateBonCommande(req.params.id as string);
    sendPdfFile(res, doc.filePath, `${doc.number}.pdf`);
  }),
);

documentsRouter.get(
  '/orders/:id/bon-collecte.pdf',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    await checkOrderAccess(req.params.id as string, req.user);
    const doc = await generateBonCollecte(req.params.id as string);
    sendPdfFile(res, doc.filePath, `${doc.number}.pdf`);
  }),
);

documentsRouter.get(
  '/orders/:id/bordereau-triage.pdf',
  requireRoles('admin', 'manager', 'supervisor', 'operator'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    await checkOrderAccess(req.params.id as string, req.user);
    const doc = await generateBordereauTriage(req.params.id as string);
    sendPdfFile(res, doc.filePath, `${doc.number}.pdf`);
  }),
);

documentsRouter.get(
  '/orders/:id/bon-livraison.pdf',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    await checkOrderAccess(req.params.id as string, req.user);
    const doc = await generateBonLivraison(req.params.id as string);
    sendPdfFile(res, doc.filePath, `${doc.number}.pdf`);
  }),
);

/* ─── HISTORIQUE D'ENVOI ───────────────────────────────────────── */

documentsRouter.get(
  '/deliveries',
  requireRoles('admin', 'manager', 'supervisor'),
  validate({ query: listDeliveriesSchema }),
  asyncHandler(async (req, res) => {
    const items = await prisma.documentDelivery.findMany({
      where: {
        ...(req.query.orderId ? { orderId: req.query.orderId as string } : {}),
        ...(req.query.type
          ? { type: req.query.type as 'BON_COMMANDE' | 'BON_COLLECTE' | 'BORDEREAU_TRIAGE' | 'BON_LIVRAISON' | 'FACTURE' | 'AVOIR' }
          : {}),
        ...(req.query.status
          ? { status: req.query.status as 'pending' | 'sent' | 'failed' }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ items, count: items.length });
  }),
);
