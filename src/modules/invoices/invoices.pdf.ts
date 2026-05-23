import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';

/**
 * Génération PDF d'une facture. Sortie sur disque dans
 * `<UPLOAD_DIR>/invoices/<invoiceId>.pdf`.
 *
 * Le rendu est volontairement sobre (pas de logo dépendant) pour rester
 * autonome. Les polices Helvetica embarquées dans pdfkit suffisent.
 */

type InvoiceWithRelations = Prisma.InvoiceGetPayload<{
  include: {
    client: true;
    tariff: { select: { code: true; name: true; type: true } };
    lines: { include: { order: { select: { orderNumber: true } } } };
  };
}>;

const INVOICE_DIR = path.join(env.UPLOAD_DIR, 'invoices');

function ensureDir() {
  if (!existsSync(INVOICE_DIR)) mkdirSync(INVOICE_DIR, { recursive: true });
}

function fcfa(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return '0 FCFA';
  const n = typeof value === 'object' ? Number(value.toString()) : Number(value);
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`;
}

function fmtDate(d: Date | null | undefined) {
  if (!d) return '—';
  return d.toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export async function renderInvoicePdf(invoice: InvoiceWithRelations): Promise<{
  filePath: string;
  publicUrl: string;
}> {
  ensureDir();
  const filename = `${invoice.id}.pdf`;
  const filePath = path.join(INVOICE_DIR, filename);
  const publicUrl = `/uploads/invoices/${filename}`;

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', () => resolve());
    stream.on('error', reject);

    /* ── HEADER ───────────────────────────────────────────────────── */
    doc.fontSize(20).font('Helvetica-Bold').text('BLANCHISSERIE SN', { align: 'left' });
    doc
      .fontSize(9)
      .font('Helvetica')
      .text('Dakar, Sénégal', { align: 'left' })
      .text('contact@blanchisserie.sn', { align: 'left' });

    doc
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('FACTURE', 400, 50, { align: 'right' });
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(invoice.invoiceNumber, 400, 78, { align: 'right' });

    doc.moveDown(2);

    /* ── INFOS FACTURE / CLIENT ───────────────────────────────────── */
    const infoTop = 130;
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Facturé à', 50, infoTop)
      .font('Helvetica')
      .text(invoice.client.name, 50, infoTop + 14)
      .text(invoice.client.address, 50, infoTop + 28)
      .text(invoice.client.city, 50, infoTop + 42);
    if (invoice.client.email) {
      doc.text(invoice.client.email, 50, infoTop + 56);
    }
    if (invoice.client.ninea) {
      doc.text(`NINEA: ${invoice.client.ninea}`, 50, infoTop + 70);
    }

    doc
      .font('Helvetica-Bold')
      .text('Date facture', 350, infoTop)
      .font('Helvetica')
      .text(fmtDate(invoice.invoiceDate), 450, infoTop)
      .font('Helvetica-Bold')
      .text("Date d'échéance", 350, infoTop + 14)
      .font('Helvetica')
      .text(fmtDate(invoice.dueDate), 450, infoTop + 14)
      .font('Helvetica-Bold')
      .text('Période', 350, infoTop + 28)
      .font('Helvetica')
      .text(
        `${fmtDate(invoice.periodStart)} → ${fmtDate(invoice.periodEnd)}`,
        450,
        infoTop + 28,
        { width: 130 },
      );
    if (invoice.tariff) {
      doc
        .font('Helvetica-Bold')
        .text('Tarif', 350, infoTop + 56)
        .font('Helvetica')
        .text(`${invoice.tariff.code} (${invoice.tariff.type})`, 450, infoTop + 56);
    }

    /* ── TABLEAU LIGNES ───────────────────────────────────────────── */
    const tableTop = 240;
    const cols = {
      desc: 50,
      qty: 320,
      unit: 380,
      total: 470,
    };
    const colWidth = {
      desc: 260,
      qty: 50,
      unit: 80,
      total: 80,
    };

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Description', cols.desc, tableTop)
      .text('Qté', cols.qty, tableTop, { width: colWidth.qty, align: 'right' })
      .text('PU', cols.unit, tableTop, { width: colWidth.unit, align: 'right' })
      .text('Total', cols.total, tableTop, { width: colWidth.total, align: 'right' });

    doc
      .moveTo(50, tableTop + 14)
      .lineTo(550, tableTop + 14)
      .lineWidth(0.5)
      .stroke();

    let y = tableTop + 22;
    doc.font('Helvetica').fontSize(9);
    for (const line of invoice.lines) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      const desc = line.order
        ? `${line.description} · ${line.order.orderNumber}`
        : line.description;
      doc
        .text(desc, cols.desc, y, { width: colWidth.desc })
        .text(String(line.quantity), cols.qty, y, {
          width: colWidth.qty,
          align: 'right',
        })
        .text(fcfa(line.unitPriceFcfa), cols.unit, y, {
          width: colWidth.unit,
          align: 'right',
        })
        .text(fcfa(line.totalFcfa), cols.total, y, {
          width: colWidth.total,
          align: 'right',
        });
      y += 20;
    }

    /* ── TOTAUX ───────────────────────────────────────────────────── */
    y += 10;
    doc
      .moveTo(330, y)
      .lineTo(550, y)
      .lineWidth(0.5)
      .stroke();
    y += 8;

    const totalRow = (label: string, value: string, bold = false) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(10)
        .text(label, 330, y, { width: 140, align: 'right' })
        .text(value, 470, y, { width: 80, align: 'right' });
      y += 16;
    };

    totalRow('Sous-total HT', fcfa(invoice.subtotalFcfa));
    totalRow(
      `TVA (${(Number(invoice.taxRate) * 100).toFixed(0)}%)`,
      fcfa(invoice.taxAmountFcfa),
    );
    totalRow('Total TTC', fcfa(invoice.totalFcfa), true);

    if (invoice.paidAmountFcfa) {
      totalRow('Payé', fcfa(invoice.paidAmountFcfa));
      const remaining = Number(invoice.totalFcfa) - Number(invoice.paidAmountFcfa);
      totalRow('Restant dû', fcfa(remaining), true);
    }

    /* ── STATUS BADGE ─────────────────────────────────────────────── */
    y += 14;
    const statusLabels: Record<string, string> = {
      draft: 'BROUILLON',
      pending: 'EN ATTENTE DE PAIEMENT',
      paid: 'PAYÉE',
      overdue: 'EN RETARD',
      cancelled: 'ANNULÉE',
    };
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#444')
      .text(`Statut: ${statusLabels[invoice.status] ?? invoice.status}`, 50, y)
      .fillColor('black');

    /* ── FOOTER ───────────────────────────────────────────────────── */
    if (invoice.notes) {
      doc.moveDown(1).font('Helvetica-Oblique').fontSize(9).text(invoice.notes);
    }

    doc
      .fontSize(8)
      .font('Helvetica')
      .text(
        'Conditions: paiement sous 30 jours. Au-delà, pénalités de retard de 1.5% par mois conformément à la loi sénégalaise.',
        50,
        770,
        { width: 500, align: 'center' },
      );

    doc.end();
  });

  return { filePath, publicUrl };
}
