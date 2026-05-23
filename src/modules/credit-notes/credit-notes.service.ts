import { prisma } from '../../config/prisma.js';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';
import {
  getCompanySettings,
  nextDocumentNumber,
} from '../documents/documents.service.js';
import { renderAvoirPdf } from '../documents/pdf/pdf.avoir.js';
import type { PdfCompanyInfo } from '../documents/pdf/pdf.shared.js';

function toCompanyInfo(c: Awaited<ReturnType<typeof getCompanySettings>>): PdfCompanyInfo {
  return {
    companyName: c.companyName,
    legalForm: c.legalForm,
    ninea: c.ninea,
    rcNumber: c.rcNumber,
    address: c.address,
    city: c.city,
    postalCode: c.postalCode,
    country: c.country,
    phone: c.phone,
    email: c.email,
    logoUrl: c.logoUrl,
    legalMentions: c.legalMentions,
    paymentTerms: c.paymentTerms,
    bankName: c.bankName,
    bankAccount: c.bankAccount,
    bankSwift: c.bankSwift,
  };
}

export async function createCreditNote(
  actorId: string,
  dto: {
    clientId: string;
    orderId?: string | null;
    invoiceId?: string | null;
    reason: string;
    amountFcfa: number;
  },
) {
  const client = await prisma.client.findUnique({ where: { id: dto.clientId } });
  if (!client) throw new NotFoundError('Client not found');

  const number = await nextDocumentNumber('AVOIR');
  const note = await prisma.creditNote.create({
    data: {
      number,
      clientId: dto.clientId,
      orderId: dto.orderId ?? null,
      invoiceId: dto.invoiceId ?? null,
      reason: dto.reason,
      amountFcfa: dto.amountFcfa,
      status: 'draft',
      createdById: actorId,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'create',
      entity: 'credit_note',
      entityId: note.id,
      payload: { number, amountFcfa: dto.amountFcfa, clientId: dto.clientId },
    },
  });
  return note;
}

export async function listCreditNotes(opts: {
  clientId?: string;
  orderId?: string;
  status?: 'draft' | 'issued' | 'cancelled';
}) {
  const items = await prisma.creditNote.findMany({
    where: {
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
      ...(opts.orderId ? { orderId: opts.orderId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { client: { select: { name: true } } },
  });
  return { items, count: items.length };
}

export async function getCreditNote(id: string) {
  const note = await prisma.creditNote.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!note) throw new NotFoundError('Credit note not found');
  return note;
}

/** Émet l'avoir : passe en `issued`, génère le PDF, stocke l'URL. */
export async function issueCreditNote(actorId: string, id: string) {
  const note = await prisma.creditNote.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!note) throw new NotFoundError('Credit note not found');
  if (note.status !== 'draft') {
    throw new BadRequestError(`Cannot issue credit note in status ${note.status}`);
  }

  // Récupère numéros associés (commande / facture) pour le PDF
  const [order, invoice] = await Promise.all([
    note.orderId
      ? prisma.order.findUnique({
          where: { id: note.orderId },
          select: { orderNumber: true },
        })
      : null,
    note.invoiceId
      ? prisma.invoice.findUnique({
          where: { id: note.invoiceId },
          select: { invoiceNumber: true },
        })
      : null,
  ]);

  const company = await getCompanySettings();
  const { publicUrl } = await renderAvoirPdf({
    creditNote: {
      ...note,
      client: {
        name: note.client.name,
        address: note.client.address,
        city: note.client.city,
        email: note.client.email,
        phone: note.client.phone,
        ninea: note.client.ninea,
      },
      orderNumber: order?.orderNumber ?? null,
      invoiceNumber: invoice?.invoiceNumber ?? null,
    },
    company: toCompanyInfo(company),
  });

  const issuedAt = new Date();
  const updated = await prisma.creditNote.update({
    where: { id },
    data: { status: 'issued', issuedAt, pdfUrl: publicUrl },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'update',
      entity: 'credit_note',
      entityId: id,
      payload: { event: 'issued', number: note.number },
    },
  });
  return updated;
}

export async function cancelCreditNote(actorId: string, id: string) {
  const note = await prisma.creditNote.findUnique({ where: { id } });
  if (!note) throw new NotFoundError('Credit note not found');
  if (note.status === 'cancelled') return note;
  const updated = await prisma.creditNote.update({
    where: { id },
    data: { status: 'cancelled' },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'update',
      entity: 'credit_note',
      entityId: id,
      payload: { event: 'cancelled', number: note.number },
    },
  });
  return updated;
}
