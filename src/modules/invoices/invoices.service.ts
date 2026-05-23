import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../utils/errors.js';
import * as notif from '../notifications/notifications.service.js';
import { broadcastInvoiceEvent } from '../../realtime/emitter.js';
import type { GenerateInvoicesDto, RecordPaymentDto } from './invoices.dto.js';
import { renderInvoicePdf } from './invoices.pdf.js';

const DEFAULT_TAX_RATE = 0.18;
const DEFAULT_DUE_DAYS = 30;

function generateInvoiceNumber(): string {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `FACT-${yyyymm}-${seq}`;
}

/* ════════════ LISTING ════════════ */

export async function listInvoices(opts: {
  status?: string;
  clientId?: string;
  search?: string;
  page: number;
  pageSize: number;
  scopeClientId?: string;
}) {
  const where: Prisma.InvoiceWhereInput = {
    ...(opts.scopeClientId ? { clientId: opts.scopeClientId } : {}),
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
    ...(opts.status ? { status: opts.status as Prisma.EnumInvoiceStatusFilter } : {}),
    ...(opts.search
      ? {
          OR: [
            { invoiceNumber: { contains: opts.search, mode: 'insensitive' } },
            { client: { name: { contains: opts.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.invoice.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, type: true } },
      },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      orderBy: { invoiceDate: 'desc' },
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: opts.page,
      pageSize: opts.pageSize,
      total,
      totalPages: Math.ceil(total / opts.pageSize),
    },
  };
}

export async function getInvoice(id: string, scopeClientId?: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      tariff: { select: { id: true, code: true, name: true, type: true } },
      lines: { include: { order: { select: { orderNumber: true } } } },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice not found');
  if (scopeClientId && invoice.clientId !== scopeClientId) {
    throw new NotFoundError('Invoice not found');
  }
  return invoice;
}

/* ════════════ GÉNÉRATION AUTO ════════════
 *
 * Pour chaque client (ou un seul si clientId fourni) :
 *  1. Récupère toutes les commandes "delivered" non encore facturées dans la période
 *  2. Calcule le montant total selon le tarif du client (ou tarif par défaut)
 *  3. Crée la facture + lignes en transaction Serializable
 *  4. Marque les commandes comme "invoiced"
 */

export async function generateInvoicesForPeriod(actorId: string, dto: GenerateInvoicesDto) {
  const periodStart = new Date(dto.periodStart);
  const periodEnd = new Date(dto.periodEnd);
  const taxRate = dto.taxRate ?? DEFAULT_TAX_RATE;

  if (periodStart >= periodEnd) {
    throw new BadRequestError('periodStart must be before periodEnd');
  }

  // Lecture en dehors de la grosse transaction (read-only)
  const clientsToBill = await prisma.client.findMany({
    where: {
      isActive: true,
      ...(dto.clientId ? { id: dto.clientId } : {}),
      orders: {
        some: {
          deliveredAt: { gte: periodStart, lte: periodEnd },
          status: { in: ['delivered'] },
          invoiceLines: { none: {} }, // pas encore facturées
        },
      },
    },
    include: {
      tariff: { include: { items: true } },
    },
  });

  if (clientsToBill.length === 0) {
    return { invoicesCreated: 0, invoices: [] };
  }

  const defaultTariff = await prisma.tariff.findFirst({
    where: { isDefault: true, isActive: true },
    include: { items: true },
  });

  const created: string[] = [];

  for (const client of clientsToBill) {
    try {
      const inv = await generateOneInvoice({
        actorId,
        client,
        defaultTariff,
        periodStart,
        periodEnd,
        taxRate,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      });
      if (inv) {
        created.push(inv.id);
        broadcastInvoiceEvent('invoice:generated', {
          at: new Date().toISOString(),
          actorId,
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          clientId: inv.clientId,
          status: inv.status,
        });
      }
    } catch (err) {
      logger.error({ err, clientId: client.id }, 'Invoice generation failed for client');
    }
  }

  return { invoicesCreated: created.length, invoices: created };
}

async function generateOneInvoice(args: {
  actorId: string;
  client: { id: string; name: string; tariffId: string | null; tariff: any };
  defaultTariff: any;
  periodStart: Date;
  periodEnd: Date;
  taxRate: number;
  dueDate?: Date;
}) {
  const tariff = args.client.tariff ?? args.defaultTariff;

  return prisma.$transaction(
    async (tx) => {
      // Re-read intra-tx + lock pessimiste virtuel via SELECT then UPDATE
      const orders = await tx.order.findMany({
        where: {
          clientId: args.client.id,
          deliveredAt: { gte: args.periodStart, lte: args.periodEnd },
          status: 'delivered',
          invoiceLines: { none: {} },
        },
        include: {
          triage: { include: { items: { include: { linenType: true } } } },
        },
      });

      if (orders.length === 0) return null;

      // Calcul des lignes
      const lines: {
        orderId: string;
        linenTypeId: string | null;
        description: string;
        quantity: number;
        weight: number | null;
        unitPriceFcfa: Prisma.Decimal;
        totalFcfa: Prisma.Decimal;
      }[] = [];

      for (const order of orders) {
        if (!order.triage) {
          // Pas de triage → ligne forfaitaire au poids reçu
          const kg = order.receivedWeight ? order.receivedWeight / 1000 : 0;
          const pricePerKg =
            tariff?.items?.[0]?.pricePerKg ?? new Prisma.Decimal(800); // fallback
          lines.push({
            orderId: order.id,
            linenTypeId: null,
            description: `Commande ${order.orderNumber} (forfait poids)`,
            quantity: Math.ceil(kg),
            weight: order.receivedWeight,
            unitPriceFcfa: new Prisma.Decimal(pricePerKg),
            totalFcfa: new Prisma.Decimal(pricePerKg).mul(kg),
          });
          continue;
        }

        for (const triageItem of order.triage.items) {
          const tariffItem = tariff?.items?.find(
            (i: any) => i.linenTypeCode === triageItem.linenType.code,
          );
          const billingMode = triageItem.linenType.billingMode;
          const linenType = triageItem.linenType;

          let unitPrice: Prisma.Decimal;
          let qty: number;
          let totalPrice: Prisma.Decimal;

          if (billingMode === 'piece') {
            unitPrice = tariffItem?.pricePerPiece
              ? new Prisma.Decimal(tariffItem.pricePerPiece)
              : new Prisma.Decimal(linenType.unitPrice);
            qty = triageItem.pieces;
            totalPrice = unitPrice.mul(qty);
          } else {
            // weight (kg)
            unitPrice = tariffItem?.pricePerKg
              ? new Prisma.Decimal(tariffItem.pricePerKg)
              : new Prisma.Decimal(linenType.unitPrice);
            const kg = triageItem.weight / 1000;
            qty = triageItem.pieces;
            totalPrice = unitPrice.mul(kg);
          }

          lines.push({
            orderId: order.id,
            linenTypeId: triageItem.linenTypeId,
            description: `${order.orderNumber} · ${linenType.name}`,
            quantity: qty,
            weight: triageItem.weight,
            unitPriceFcfa: unitPrice,
            totalFcfa: totalPrice,
          });
        }
      }

      const subtotal = lines.reduce(
        (sum, l) => sum.add(l.totalFcfa),
        new Prisma.Decimal(0),
      );

      // Forfait : si le tarif est de type forfait, utilise le prix mensuel
      let total = subtotal;
      if (tariff?.type === 'forfait' && tariff.monthlyPriceFcfa) {
        const totalKg = orders.reduce((s, o) => s + (o.receivedWeight ?? 0) / 1000, 0);
        const limitKg = tariff.monthlyKgLimit ?? 0;
        const overage = Math.max(0, totalKg - limitKg);
        const overageAmount = new Prisma.Decimal(tariff.overagePerKgFcfa ?? 0).mul(overage);
        total = new Prisma.Decimal(tariff.monthlyPriceFcfa).add(overageAmount);
      }

      const taxAmount = total.mul(args.taxRate);
      const totalTtc = total.add(taxAmount);

      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: generateInvoiceNumber(),
          clientId: args.client.id,
          tariffId: tariff?.id ?? null,
          periodStart: args.periodStart,
          periodEnd: args.periodEnd,
          dueDate:
            args.dueDate ??
            new Date(args.periodEnd.getTime() + DEFAULT_DUE_DAYS * 86_400_000),
          subtotalFcfa: total,
          taxRate: new Prisma.Decimal(args.taxRate),
          taxAmountFcfa: taxAmount,
          totalFcfa: totalTtc,
          status: 'pending',
          lines: { create: lines },
        },
      });

      // Marque les commandes comme facturées
      await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { status: 'invoiced', version: { increment: 1 } },
      });

      await tx.auditLog.create({
        data: {
          actorId: args.actorId,
          action: 'create',
          entity: 'invoice',
          entityId: invoice.id,
          payload: {
            invoiceNumber: invoice.invoiceNumber,
            clientId: args.client.id,
            ordersCount: orders.length,
            totalFcfa: totalTtc.toFixed(2),
          },
        },
      });

      return invoice;
    },
    { isolationLevel: 'Serializable', timeout: 30000 },
  );
}

/* ════════════ PAIEMENT ════════════ */

export async function recordPayment(
  invoiceId: string,
  actorId: string,
  dto: RecordPaymentDto,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundError('Invoice not found');

    if (invoice.version !== dto.expectedVersion) {
      throw new ConflictError('Invoice modified concurrently');
    }
    if (invoice.status === 'paid') {
      throw new BadRequestError('Invoice already paid');
    }
    if (invoice.status === 'cancelled') {
      throw new BadRequestError('Cannot pay a cancelled invoice');
    }

    const newPaid = new Prisma.Decimal(invoice.paidAmountFcfa ?? 0).add(dto.amount);
    const fullyPaid = newPaid.gte(invoice.totalFcfa);

    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmountFcfa: newPaid,
        paymentMethod: dto.method,
        paidDate: fullyPaid
          ? dto.paidDate
            ? new Date(dto.paidDate)
            : new Date()
          : null,
        status: fullyPaid ? 'paid' : 'pending',
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'invoice',
        entityId: invoiceId,
        payload: {
          event: 'payment',
          amount: dto.amount,
          method: dto.method,
          fullyPaid,
          reference: dto.reference,
        },
      },
    });

    return updated;
  });

  if (updated.status === 'paid') {
    broadcastInvoiceEvent('invoice:paid', {
      at: new Date().toISOString(),
      actorId,
      invoiceId: updated.id,
      invoiceNumber: updated.invoiceNumber,
      clientId: updated.clientId,
      status: updated.status,
    });
  }

  return updated;
}

/* ════════════ CANCEL ════════════ */

export async function cancelInvoice(
  invoiceId: string,
  actorId: string,
  reason: string,
  expectedVersion: number,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundError('Invoice not found');
    if (invoice.version !== expectedVersion) {
      throw new ConflictError('Invoice modified concurrently');
    }
    if (invoice.status === 'paid') {
      throw new BadRequestError('Cannot cancel a paid invoice');
    }

    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'cancelled',
        notes: reason,
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'invoice',
        entityId: invoiceId,
        payload: { event: 'cancel', reason },
      },
    });

    return updated;
  });

  broadcastInvoiceEvent('invoice:cancelled', {
    at: new Date().toISOString(),
    actorId,
    invoiceId: updated.id,
    invoiceNumber: updated.invoiceNumber,
    clientId: updated.clientId,
    status: updated.status,
  });

  return updated;
}

/** Marque comme overdue les factures dont la dueDate est passée. */
export async function markOverdueInvoices() {
  const result = await prisma.invoice.updateMany({
    where: {
      status: 'pending',
      dueDate: { lt: new Date() },
    },
    data: { status: 'overdue' },
  });
  return { updated: result.count };
}

/* ════════════ PDF ════════════ */

/**
 * (Re)génère le PDF d'une facture, l'écrit sur disque et persiste `pdfUrl`.
 * Si déjà généré et `force=false`, renvoie l'URL existante sans régénérer.
 */
export async function generateInvoicePdf(
  invoiceId: string,
  actorId: string,
  force = false,
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: true,
      tariff: { select: { code: true, name: true, type: true } },
      lines: { include: { order: { select: { orderNumber: true } } } },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice not found');

  if (invoice.pdfUrl && !force) {
    return { pdfUrl: invoice.pdfUrl, regenerated: false };
  }

  const { publicUrl } = await renderInvoicePdf(invoice);

  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoiceId },
      data: { pdfUrl: publicUrl },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: 'print',
        entity: 'invoice',
        entityId: invoiceId,
        payload: { event: 'pdf_generated', force },
      },
    }),
  ]);

  logger.info({ invoiceId, publicUrl, force }, 'Invoice PDF generated');
  return { pdfUrl: publicUrl, regenerated: true };
}

/* ════════════ MAIL ════════════ */

/**
 * Envoie la facture par email au contact du client. Génère le PDF si absent.
 * Retourne `{ notificationId, recipientEmail, pdfUrl }`.
 */
export async function mailInvoice(invoiceId: string, actorId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: { select: { name: true, email: true } } },
  });
  if (!invoice) throw new NotFoundError('Invoice not found');
  if (!invoice.client.email) {
    throw new BadRequestError('Client has no email address on file');
  }
  if (invoice.status === 'cancelled') {
    throw new BadRequestError('Cannot email a cancelled invoice');
  }

  const { pdfUrl } = invoice.pdfUrl
    ? { pdfUrl: invoice.pdfUrl }
    : await generateInvoicePdf(invoiceId, actorId, false);

  const subject = `Facture ${invoice.invoiceNumber} — Blanchisserie SN`;
  const body = [
    `Bonjour ${invoice.client.name},`,
    '',
    `Veuillez trouver ci-joint la facture ${invoice.invoiceNumber} d'un montant de ${Number(
      invoice.totalFcfa,
    ).toLocaleString('fr-FR')} FCFA, à régler avant le ${invoice.dueDate.toLocaleDateString('fr-FR')}.`,
    '',
    'Pour toute question, vous pouvez répondre à ce message.',
    '',
    'Cordialement,',
    'Blanchisserie SN',
  ].join('\n');

  const notification = await notif.notifyImmediate({
    channel: 'email',
    recipientEmail: invoice.client.email,
    subject,
    body,
    metadata: {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, path: pdfUrl }],
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'update',
      entity: 'invoice',
      entityId: invoiceId,
      payload: {
        event: 'email_sent',
        recipientEmail: invoice.client.email,
        notificationId: notification?.id,
        status: notification?.status,
      },
    },
  });

  return {
    notificationId: notification?.id,
    status: notification?.status,
    recipientEmail: invoice.client.email,
    pdfUrl,
  };
}
