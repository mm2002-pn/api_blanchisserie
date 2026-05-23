import { createWriteStream } from 'node:fs';
import type { CreditNote } from '@prisma/client';
import {
  docPaths,
  drawClientBlock,
  drawFooter,
  drawHeader,
  drawMetaBlock,
  fcfa,
  fmtDate,
  newPdfDocument,
  type PdfCompanyInfo,
} from './pdf.shared.js';

type CreditNoteForPdf = CreditNote & {
  client: { name: string; address: string; city: string; email: string | null; phone: string | null; ninea: string | null };
  orderNumber?: string | null;
  invoiceNumber?: string | null;
};

/** Génère le PDF d'un Avoir (AV-YYYY-NNN). */
export async function renderAvoirPdf(opts: {
  creditNote: CreditNoteForPdf;
  company: PdfCompanyInfo;
}): Promise<{ filePath: string; publicUrl: string }> {
  const { creditNote, company } = opts;
  const { filePath, publicUrl } = docPaths('avoir', `${creditNote.number}.pdf`);

  await new Promise<void>((resolve, reject) => {
    const doc = newPdfDocument();
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', () => resolve());
    stream.on('error', reject);

    drawHeader(doc, {
      company,
      title: 'Avoir',
      docNumber: creditNote.number,
      issuedAt: creditNote.issuedAt ?? creditNote.createdAt,
    });

    drawClientBlock(doc, {
      name: creditNote.client.name,
      address: creditNote.client.address,
      city: creditNote.client.city,
      email: creditNote.client.email,
      phone: creditNote.client.phone,
      ninea: creditNote.client.ninea,
    });

    const metaRows: Array<[string, string]> = [
      ['Date émission', fmtDate(creditNote.issuedAt ?? creditNote.createdAt)],
      ['Statut', String(creditNote.status).toUpperCase()],
    ];
    if (creditNote.orderNumber) metaRows.push(['Commande', creditNote.orderNumber]);
    if (creditNote.invoiceNumber) metaRows.push(['Facture', creditNote.invoiceNumber]);
    drawMetaBlock(doc, metaRows);

    // Motif
    const y0 = 280;
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#666')
      .text('MOTIF', 50, y0);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#222')
      .text(creditNote.reason, 50, y0 + 14, { width: 510 });

    // Montant
    const y1 = y0 + 80;
    doc
      .moveTo(330, y1)
      .lineTo(540, y1)
      .lineWidth(0.5)
      .strokeColor('#ccc')
      .stroke();
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#111')
      .text(`Montant de l'avoir : ${fcfa(Number(creditNote.amountFcfa))}`, 330, y1 + 12, {
        width: 210,
        align: 'right',
      });

    drawFooter(doc, company);
    doc.end();
  });

  return { filePath, publicUrl };
}
