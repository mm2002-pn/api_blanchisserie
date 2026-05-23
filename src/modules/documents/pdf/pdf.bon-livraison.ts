import { createWriteStream } from 'node:fs';
import type { Prisma } from '@prisma/client';
import {
  docPaths,
  drawClientBlock,
  drawFooter,
  drawHeader,
  drawItemsTable,
  drawMetaBlock,
  drawSignature,
  fmtDateTime,
  newPdfDocument,
  type PdfCompanyInfo,
} from './pdf.shared.js';

type OrderForBL = Prisma.OrderGetPayload<{
  include: { client: true; deliveryDriver: true; deliveryVehicle: true };
}>;

interface CountedItem {
  type: string;
  quantity: number;
}
interface LinenTypeMeta {
  code: string;
  name: string;
}

/** Génère le PDF du Bon de Livraison (BL-YYYY-NNN). */
export async function renderBonLivraisonPdf(opts: {
  order: OrderForBL;
  docNumber: string;
  company: PdfCompanyInfo;
  linenTypes: LinenTypeMeta[];
}): Promise<{ filePath: string; publicUrl: string }> {
  const { order, docNumber, company, linenTypes } = opts;
  const { filePath, publicUrl } = docPaths('bon-livraison', `${docNumber}.pdf`);
  const received = (order.receivedItems as unknown as CountedItem[] | null) ?? [];
  const byCode = new Map(linenTypes.map((lt) => [lt.code, lt]));

  await new Promise<void>((resolve, reject) => {
    const doc = newPdfDocument();
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', () => resolve());
    stream.on('error', reject);

    drawHeader(doc, {
      company,
      title: 'Bon de Livraison',
      docNumber,
      issuedAt: order.deliveredAt ?? new Date(),
    });

    drawClientBlock(doc, {
      name: order.client.name,
      address: order.client.address,
      city: order.client.city,
      email: order.client.email,
      phone: order.client.phone,
      ninea: order.client.ninea,
    });

    const driverName = order.deliveryDriver
      ? `${order.deliveryDriver.firstName} ${order.deliveryDriver.lastName}`
      : '—';
    const vehicle = order.deliveryVehicle ? order.deliveryVehicle.matricule : '—';
    drawMetaBlock(doc, [
      ['N° commande', order.orderNumber],
      ['Date livraison', fmtDateTime(order.deliveredAt)],
      ['Chauffeur', driverName],
      ['Véhicule', vehicle],
    ]);

    // Tableau items livrés
    const rows = received.map((it) => ({
      name: byCode.get(it.type)?.name ?? it.type,
      qty: it.quantity,
    }));

    const tableY = drawItemsTable(
      doc,
      rows,
      [
        { header: 'Article', width: 380, render: (r) => r.name },
        { header: 'Quantité livrée', width: 110, align: 'right', render: (r) => String(r.qty) },
      ],
      280,
    );

    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const totalKg =
      order.receivedWeight != null ? order.receivedWeight / 1000 : null;
    let y = tableY + 8;
    doc.moveTo(330, y).lineTo(540, y).lineWidth(0.5).strokeColor('#ccc').stroke();
    y += 8;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#222');
    doc.text(`Total pièces : ${totalQty}`, 330, y, { width: 210, align: 'right' });
    y += 14;
    if (totalKg != null) {
      doc.text(
        `Poids total : ${totalKg.toFixed(2).replace('.', ',')} kg`,
        330,
        y,
        { width: 210, align: 'right' },
      );
      y += 14;
    }

    // Signature destinataire
    y += 20;
    drawSignature(doc, {
      label: 'Signature destinataire',
      signatureUrl: order.deliverySignatureUrl,
      recipientName: order.deliveryRecipientName,
      x: 50,
      y,
    });

    drawFooter(doc, company);
    doc.end();
  });

  return { filePath, publicUrl };
}
