import { createWriteStream } from 'node:fs';
import type { Prisma } from '@prisma/client';
import {
  docPaths,
  drawClientBlock,
  drawFooter,
  drawHeader,
  drawItemsTable,
  drawMetaBlock,
  fmtDateTime,
  newPdfDocument,
  type PdfCompanyInfo,
} from './pdf.shared.js';

type OrderForBT = Prisma.OrderGetPayload<{ include: { client: true } }>;

interface EstimatedItem {
  category: string;
  type: string;
  quantity: number;
}
interface CountedItem {
  type: string;
  quantity: number;
}
interface LinenTypeMeta {
  code: string;
  name: string;
  averageWeight: number;
}

/** Génère le PDF du Bordereau de Triage (BT-YYYY-NNN). Document interne. */
export async function renderBordereauTriagePdf(opts: {
  order: OrderForBT;
  docNumber: string;
  company: PdfCompanyInfo;
  linenTypes: LinenTypeMeta[];
}): Promise<{ filePath: string; publicUrl: string }> {
  const { order, docNumber, company, linenTypes } = opts;
  const { filePath, publicUrl } = docPaths('bordereau-triage', `${docNumber}.pdf`);
  const estimated = (order.estimatedItems as unknown as EstimatedItem[]) ?? [];
  const driver = (order.driverItems as unknown as CountedItem[] | null) ?? [];
  const received = (order.receivedItems as unknown as CountedItem[] | null) ?? [];
  const byCode = new Map(linenTypes.map((lt) => [lt.code, lt]));
  const estMap = new Map(estimated.map((it) => [it.type, it.quantity]));
  const driverMap = new Map(driver.map((it) => [it.type, it.quantity]));
  const recvMap = new Map(received.map((it) => [it.type, it.quantity]));
  const allTypes = Array.from(
    new Set<string>([...estMap.keys(), ...driverMap.keys(), ...recvMap.keys()]),
  );

  await new Promise<void>((resolve, reject) => {
    const doc = newPdfDocument();
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', () => resolve());
    stream.on('error', reject);

    drawHeader(doc, {
      company,
      title: 'Bordereau de Triage',
      docNumber,
      issuedAt: order.triagedAt ?? order.receivedAt ?? new Date(),
    });

    drawClientBlock(doc, {
      name: order.client.name,
      address: order.client.address,
      city: order.client.city,
    });

    drawMetaBlock(doc, [
      ['N° commande', order.orderNumber],
      ['Réception', fmtDateTime(order.receivedAt)],
      ['Triage', fmtDateTime(order.triagedAt)],
    ]);

    // Tableau comparatif complet (3 colonnes de quantités + écart)
    const rows = allTypes.map((type) => {
      const meta = byCode.get(type);
      const announced = estMap.get(type) ?? 0;
      const collected = driverMap.get(type) ?? 0;
      const triaged = recvMap.get(type) ?? 0;
      return {
        name: meta?.name ?? type,
        announced,
        collected,
        triaged,
        diff: triaged - announced,
      };
    });

    const tableY = drawItemsTable(
      doc,
      rows,
      [
        { header: 'Article', width: 200, render: (r) => r.name },
        { header: 'Annoncé', width: 70, align: 'right', render: (r) => String(r.announced) },
        { header: 'Chauffeur', width: 70, align: 'right', render: (r) => String(r.collected) },
        { header: 'Atelier', width: 70, align: 'right', render: (r) => String(r.triaged) },
        {
          header: 'Écart',
          width: 70,
          align: 'right',
          render: (r) => (r.diff > 0 ? `+${r.diff}` : String(r.diff)),
        },
      ],
      280,
    );

    // Totaux
    const totalTriaged = rows.reduce((s, r) => s + r.triaged, 0);
    const receivedKg =
      order.receivedWeight != null ? order.receivedWeight / 1000 : null;
    let y = tableY + 8;
    doc.moveTo(330, y).lineTo(540, y).lineWidth(0.5).strokeColor('#ccc').stroke();
    y += 8;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#222');
    doc.text(`Total pièces triées : ${totalTriaged}`, 330, y, {
      width: 210,
      align: 'right',
    });
    y += 14;
    if (receivedKg != null) {
      doc.text(
        `Poids officiel atelier : ${receivedKg.toFixed(2).replace('.', ',')} kg`,
        330,
        y,
        { width: 210, align: 'right' },
      );
      y += 14;
    }
    if (order.weightDeviation != null) {
      doc
        .fontSize(9)
        .font('Helvetica-Oblique')
        .fillColor('#666')
        .text(
          `Écart poids vs estimation : ${order.weightDeviation.toFixed(1)}%`,
          330,
          y,
          { width: 210, align: 'right' },
        );
    }

    drawFooter(doc, company);
    doc.end();
  });

  return { filePath, publicUrl };
}
