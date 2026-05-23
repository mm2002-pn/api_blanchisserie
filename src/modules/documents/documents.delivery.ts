import path from 'node:path';
import { existsSync } from 'node:fs';
import type { DocumentType } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getMailer, SMTP_FROM } from '../../config/mailer.js';
import { prisma } from '../../config/prisma.js';

/**
 * Envoi d'un document (PDF) par email au client + audit dans `DocumentDelivery`.
 *
 * - Si SMTP désactivé en env → on logue + marque comme `sent` (dry-run).
 * - Si recipient email manquant → on enregistre `failed` avec raison claire.
 * - Toute erreur SMTP → status `failed` + errorMessage, sans propager l'exception
 *   (un email raté ne doit pas bloquer une transition métier).
 */
export async function sendDocumentEmail(opts: {
  type: DocumentType;
  number: string;
  orderId?: string | null;
  invoiceId?: string | null;
  recipientEmail: string | null | undefined;
  recipientName?: string | null;
  subject: string;
  body: string;
  pdfPath: string; // absolu OU /uploads/...
}): Promise<{ ok: boolean; deliveryId: string }> {
  const {
    type,
    number,
    orderId,
    invoiceId,
    recipientEmail,
    recipientName,
    subject,
    body,
    pdfPath,
  } = opts;

  // Crée la trace AVANT envoi (status pending)
  const delivery = await prisma.documentDelivery.create({
    data: {
      type,
      number,
      orderId: orderId ?? null,
      invoiceId: invoiceId ?? null,
      recipientEmail: recipientEmail ?? '',
      recipientName: recipientName ?? null,
      method: 'email',
      status: 'pending',
      attempt: 1,
    },
  });

  // Pas d'email destinataire → fail clean
  if (!recipientEmail) {
    await prisma.documentDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', errorMessage: 'Missing recipient email' },
    });
    return { ok: false, deliveryId: delivery.id };
  }

  // Résolution chemin disque
  const absPath = pdfPath.startsWith('/uploads/')
    ? path.join(env.UPLOAD_DIR, pdfPath.slice('/uploads/'.length))
    : pdfPath;
  if (!existsSync(absPath)) {
    await prisma.documentDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', errorMessage: `PDF file not found: ${absPath}` },
    });
    return { ok: false, deliveryId: delivery.id };
  }

  // SMTP désactivé → dry-run
  if (!env.ENABLE_EMAIL) {
    logger.info(
      { to: recipientEmail, type, number },
      'Document email (disabled, dry-run)',
    );
    await prisma.documentDelivery.update({
      where: { id: delivery.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    return { ok: true, deliveryId: delivery.id };
  }

  const transporter = getMailer();
  if (!transporter) {
    logger.warn(
      { to: recipientEmail, type },
      'SMTP not configured — marking delivery as sent (no-op)',
    );
    await prisma.documentDelivery.update({
      where: { id: delivery.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    return { ok: true, deliveryId: delivery.id };
  }

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: recipientEmail,
      subject,
      text: body,
      html: body.includes('<') ? body : `<pre>${body}</pre>`,
      attachments: [{ filename: `${number}.pdf`, path: absPath }],
    });
    await prisma.documentDelivery.update({
      where: { id: delivery.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    return { ok: true, deliveryId: delivery.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, type, number }, 'Document email failed');
    await prisma.documentDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', errorMessage: msg },
    });
    return { ok: false, deliveryId: delivery.id };
  }
}
