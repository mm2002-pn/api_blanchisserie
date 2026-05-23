import { createWriteStream } from 'node:fs';
import type { Prisma } from '@prisma/client';
import {
  docPaths,
  drawClientBlock,
  drawFooter,
  drawHeader,
  drawItemsTable,
  drawMetaBlock,
  fmtDate,
  newPdfDocument,
  type PdfCompanyInfo,
} from './pdf.shared.js';

type OrderForBC = Prisma.OrderGetPayload<{ include: { client: true } }>;

interface EstimatedItem {
  category: string;
  type: string;
  quantity: number;
}

interface LinenTypeMeta {
  code: string;
  name: string;
  averageWeight: number; // grammes
}

/** Génère le PDF du Bon de Commande (CMD-YYYY-NNN). */
export async function renderBonCommandePdf(opts: {
  order: OrderForBC;
  docNumber: string;
  company: PdfCompanyInfo;
  linenTypes: LinenTypeMeta[];
  categoryLabels: Record<string, string>;
}): Promise<{ filePath: string; publicUrl: string }> {
  const { order, docNumber, company, linenTypes, categoryLabels } = opts;
  const { filePath, publicUrl } = docPaths('bon-commande', `${docNumber}.pdf`);
  const items = (order.estimatedItems as unknown as EstimatedItem[]) ?? [];
  const byCode = new Map(linenTypes.map((lt) => [lt.code, lt]));

  await new Promise<void>((resolve, reject) => {
    const doc = newPdfDocument();
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', () => resolve());
    stream.on('error', reject);

    drawHeader(doc, {
      company,
      title: 'Bon de Commande',
      docNumber,
      issuedAt: order.createdAt,
    });

    drawClientBlock(doc, {
      name: order.client.name,
      address: order.client.address,
      city: order.client.city,
      email: order.client.email,
      phone: order.client.phone,
      ninea: order.client.ninea,
    });

    drawMetaBlock(doc, [
      ['N° commande', order.orderNumber],
      ['Date collecte', fmtDate(order.collectionDate)],
      ['Statut', 'Confirmée'],
    ]);

    // Tableau items
    const rows = items.map((it) => {
      const meta = byCode.get(it.type);
      const unitWeightG = meta?.averageWeight ?? 0;
      return {
        category: categoryLabels[it.category] ?? it.category,
        name: meta?.name ?? it.type,
        qty: it.quantity,
        unitKg: unitWeightG / 1000,
        totalKg: (unitWeightG * it.quantity) / 1000,
      };
    });

    const tableY = drawItemsTable(
      doc,
      rows,
      [
        { header: 'Catégorie', width: 110, render: (r) => r.category },
        { header: 'Article', width: 220, render: (r) => r.name },
        { header: 'Qté', width: 50, align: 'right', render: (r) => String(r.qty) },
        {
          header: 'Poids unit. (kg)',
          width: 80,
          align: 'right',
          render: (r) => r.unitKg.toFixed(2).replace('.', ','),
        },
        {
          header: 'Poids total (kg)',
          width: 80,
          align: 'right',
          render: (r) => r.totalKg.toFixed(2).replace('.', ','),
        },
      ],
      280,
    );

    // Totaux
    const totalPieces = rows.reduce((s, r) => s + r.qty, 0);
    const totalKg = rows.reduce((s, r) => s + r.totalKg, 0);
    let y = tableY + 8;
    doc.moveTo(330, y).lineTo(540, y).lineWidth(0.5).strokeColor('#ccc').stroke();
    y += 8;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#222');
    doc.text(`Total pièces : ${totalPieces}`, 330, y, { width: 210, align: 'right' });
    y += 14;
    doc.text(
      `Poids total estimé : ${totalKg.toFixed(2).replace('.', ',')} kg`,
      330,
      y,
      { width: 210, align: 'right' },
    );

    // Instructions
    if (order.instructions) {
      y += 30;
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#666')
        .text('INSTRUCTIONS', 50, y);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#222')
        .text(order.instructions, 50, y + 12, { width: 510 });
    }

    drawFooter(doc, company);
    doc.end();
  });

  return { filePath, publicUrl };
}
