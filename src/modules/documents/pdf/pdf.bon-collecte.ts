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
  fmtDate,
  fmtDateTime,
  newPdfDocument,
  type PdfCompanyInfo,
} from './pdf.shared.js';

type OrderForBCol = Prisma.OrderGetPayload<{
  include: { client: true; collectionDriver: true; collectionVehicle: true };
}>;

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

/** Génère le PDF du Bon de Collecte (BCOL-YYYY-NNN). */
export async function renderBonCollectePdf(opts: {
  order: OrderForBCol;
  docNumber: string;
  company: PdfCompanyInfo;
  linenTypes: LinenTypeMeta[];
}): Promise<{ filePath: string; publicUrl: string }> {
  const { order, docNumber, company, linenTypes } = opts;
  const { filePath, publicUrl } = docPaths('bon-collecte', `${docNumber}.pdf`);
  const estimated = (order.estimatedItems as unknown as EstimatedItem[]) ?? [];
  const driver = (order.driverItems as unknown as CountedItem[] | null) ?? [];
  const byCode = new Map(linenTypes.map((lt) => [lt.code, lt]));
  const estByType = new Map(estimated.map((it) => [it.type, it.quantity]));
  const driverByType = new Map(driver.map((it) => [it.type, it.quantity]));
  const allTypes = Array.from(
    new Set<string>([...estByType.keys(), ...driverByType.keys()]),
  );

  await new Promise<void>((resolve, reject) => {
    const doc = newPdfDocument();
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', () => resolve());
    stream.on('error', reject);

    drawHeader(doc, {
      company,
      title: 'Bon de Collecte',
      docNumber,
      issuedAt: order.collectedAt ?? order.createdAt,
    });

    drawClientBlock(doc, {
      name: order.client.name,
      address: order.client.address,
      city: order.client.city,
      email: order.client.email,
      phone: order.client.phone,
      ninea: order.client.ninea,
    });

    const driverName = order.collectionDriver
      ? `${order.collectionDriver.firstName} ${order.collectionDriver.lastName}`
      : '—';
    const vehicle = order.collectionVehicle
      ? `${order.collectionVehicle.matricule}`
      : '—';
    drawMetaBlock(doc, [
      ['N° commande', order.orderNumber],
      ['Date collecte', fmtDateTime(order.collectedAt)],
      ['Chauffeur', driverName],
      ['Véhicule', vehicle],
    ]);

    // Tableau comparatif annoncé / collecté
    const rows = allTypes.map((type) => {
      const meta = byCode.get(type);
      const announced = estByType.get(type) ?? 0;
      const collected = driverByType.get(type) ?? 0;
      const diff = collected - announced;
      return {
        name: meta?.name ?? type,
        announced,
        collected,
        diff,
      };
    });

    const tableY = drawItemsTable(
      doc,
      rows,
      [
        { header: 'Article', width: 280, render: (r) => r.name },
        { header: 'Annoncé', width: 70, align: 'right', render: (r) => String(r.announced) },
        { header: 'Collecté', width: 70, align: 'right', render: (r) => String(r.collected) },
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
    const totalAnnounced = rows.reduce((s, r) => s + r.announced, 0);
    const totalCollected = rows.reduce((s, r) => s + r.collected, 0);
    const estimatedKg =
      order.estimatedWeight != null ? order.estimatedWeight / 1000 : null;
    const driverKg =
      order.driverWeight != null ? order.driverWeight / 1000 : null;
    // On considère "pesée chauffeur réelle" si elle s'écarte de l'annoncé d'au
    // moins 100 g (sinon le champ a juste été recopié depuis l'estimation).
    const hasDriverWeighed =
      estimatedKg != null && driverKg != null
        ? Math.abs(driverKg - estimatedKg) > 0.1
        : driverKg != null && estimatedKg == null;

    let y = tableY + 8;
    doc.moveTo(330, y).lineTo(540, y).lineWidth(0.5).strokeColor('#ccc').stroke();
    y += 8;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#222');
    doc.text(
      `Total pièces collectées : ${totalCollected} (annoncé ${totalAnnounced})`,
      330,
      y,
      { width: 210, align: 'right' },
    );
    y += 14;
    if (estimatedKg != null) {
      doc.text(
        `Poids annoncé : ${estimatedKg.toFixed(2).replace('.', ',')} kg`,
        330,
        y,
        { width: 210, align: 'right' },
      );
      y += 14;
    }
    if (hasDriverWeighed && driverKg != null) {
      doc.text(
        `Poids pesé chauffeur : ${driverKg.toFixed(2).replace('.', ',')} kg`,
        330,
        y,
        { width: 210, align: 'right' },
      );
      y += 14;
    }

    // Signature client
    y += 20;
    drawSignature(doc, {
      label: 'Signature client',
      signatureUrl: order.collectionSignatureUrl,
      recipientName: order.collectionRecipientName,
      x: 50,
      y,
    });

    drawFooter(doc, company);
    doc.end();
  });

  return { filePath, publicUrl };
}
