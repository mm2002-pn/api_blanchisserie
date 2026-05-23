import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { env } from '../../../config/env.js';

/**
 * Briques partagées pour la génération de PDF :
 *  - ensureDocDir, buildPath, publicUrl
 *  - drawHeader (logo + raison sociale + n° doc + date)
 *  - drawClientBlock
 *  - drawItemsTable (générique)
 *  - drawFooter (mentions légales + RIB)
 *  - drawSignature
 */

export interface PdfCompanyInfo {
  companyName: string;
  legalForm?: string | null;
  ninea?: string | null;
  rcNumber?: string | null;
  address: string;
  city: string;
  postalCode?: string | null;
  country: string;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  legalMentions?: string | null;
  paymentTerms: string;
  bankName?: string | null;
  bankAccount?: string | null;
  bankSwift?: string | null;
}

export interface PdfClientInfo {
  name: string;
  address?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  ninea?: string | null;
}

const DOCS_ROOT = path.join(env.UPLOAD_DIR, 'documents');

export function ensureDocDir(subdir: string): string {
  const dir = path.join(DOCS_ROOT, subdir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function docPaths(subdir: string, filename: string) {
  const dir = ensureDocDir(subdir);
  return {
    filePath: path.join(dir, filename),
    publicUrl: `/uploads/documents/${subdir}/${filename}`,
  };
}

export function fcfa(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '0 FCFA';
  const v = typeof n === 'string' ? Number(n) : n;
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`;
}

export function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Header standard : nom entreprise à gauche, titre + n° doc à droite. */
export function drawHeader(
  doc: PDFKit.PDFDocument,
  opts: {
    company: PdfCompanyInfo;
    title: string;
    docNumber: string;
    issuedAt: Date;
  },
) {
  const { company, title, docNumber, issuedAt } = opts;

  // Logo (si présent et que le fichier existe sur disque)
  if (company.logoUrl) {
    const logoPath = resolveLocalAsset(company.logoUrl);
    if (logoPath && existsSync(logoPath)) {
      try {
        doc.image(logoPath, 50, 45, { fit: [120, 60] });
      } catch {
        /* image invalide → fallback texte */
      }
    }
  }

  // Bloc identité entreprise (gauche) — largeur réduite pour éviter chevauchement
  const topY = 50;
  doc
    .fontSize(16)
    .font('Helvetica-Bold')
    .fillColor('#222')
    .text(company.companyName, 180, topY, { width: 170 });
  doc.fontSize(9).font('Helvetica').fillColor('#555');
  const lines: string[] = [];
  lines.push(`${company.address}${company.city ? `, ${company.city}` : ''}`);
  if (company.phone) lines.push(`Tél. ${company.phone}`);
  if (company.email) lines.push(company.email);
  if (company.ninea) lines.push(`NINEA : ${company.ninea}`);
  if (company.rcNumber) lines.push(`RC : ${company.rcNumber}`);
  doc.text(lines.join(' · '), 180, topY + 20, { width: 170 });

  // Titre + numéro (droite) — largeur élargie pour fit "BON DE COLLECTE" sur 1 ligne,
  // hauteur réelle mesurée pour empiler proprement docNumber & date.
  const rightX = 360;
  const rightW = 200;
  const titleUpper = title.toUpperCase();
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#111');
  const titleHeight = doc.heightOfString(titleUpper, { width: rightW, align: 'right' });
  doc.text(titleUpper, rightX, topY, { width: rightW, align: 'right' });

  const numberY = topY + titleHeight + 6;
  doc
    .fontSize(11)
    .font('Helvetica')
    .fillColor('#333')
    .text(docNumber, rightX, numberY, { width: rightW, align: 'right' });

  const numberHeight = doc.heightOfString(docNumber, { width: rightW, align: 'right' });
  doc
    .fontSize(9)
    .fillColor('#666')
    .text(`Émis le ${fmtDate(issuedAt)}`, rightX, numberY + numberHeight + 2, {
      width: rightW,
      align: 'right',
    });

  // Séparateur
  doc
    .moveTo(50, 120)
    .lineTo(560, 120)
    .lineWidth(0.5)
    .strokeColor('#ccc')
    .stroke();

  doc.fillColor('black');
}

/** Bloc "destinataire" client (gauche) avec adresse. */
export function drawClientBlock(
  doc: PDFKit.PDFDocument,
  client: PdfClientInfo,
  y = 140,
) {
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#666')
    .text('CLIENT', 50, y);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text(client.name, 50, y + 13);
  doc.fontSize(9).font('Helvetica').fillColor('#333');
  let cy = y + 30;
  if (client.address) {
    doc.text(client.address, 50, cy, { width: 240 });
    cy += 12;
  }
  if (client.city) {
    doc.text(client.city, 50, cy);
    cy += 12;
  }
  if (client.phone) {
    doc.text(`Tél. ${client.phone}`, 50, cy);
    cy += 12;
  }
  if (client.email) {
    doc.text(client.email, 50, cy);
    cy += 12;
  }
  if (client.ninea) {
    doc.text(`NINEA : ${client.ninea}`, 50, cy);
    cy += 12;
  }
  return cy;
}

/** Bloc "méta" droite : date, n° commande, etc. */
export function drawMetaBlock(
  doc: PDFKit.PDFDocument,
  rows: Array<[label: string, value: string]>,
  y = 140,
) {
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#666').text('DÉTAILS', 380, y);
  let cy = y + 13;
  for (const [label, value] of rows) {
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#333')
      .text(label, 380, cy, { width: 80 });
    doc.font('Helvetica').fillColor('#111').text(value, 460, cy, { width: 100 });
    cy += 13;
  }
  return cy;
}

interface TableColumn<Row> {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  render: (row: Row) => string;
}

/** Tableau générique d'items. Retourne le y final. */
export function drawItemsTable<Row>(
  doc: PDFKit.PDFDocument,
  rows: Row[],
  columns: TableColumn<Row>[],
  startY: number,
): number {
  const startX = 50;
  let y = startY;

  // Header
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#222');
  let x = startX;
  for (const col of columns) {
    doc.text(col.header, x, y, { width: col.width, align: col.align ?? 'left' });
    x += col.width;
  }
  y += 14;
  doc.moveTo(startX, y).lineTo(startX + columns.reduce((s, c) => s + c.width, 0), y).lineWidth(0.5).strokeColor('#ccc').stroke();
  y += 6;

  // Rows
  doc.fontSize(9).font('Helvetica').fillColor('#222');
  for (const row of rows) {
    if (y > 720) {
      doc.addPage();
      y = 50;
    }
    x = startX;
    for (const col of columns) {
      doc.text(col.render(row), x, y, { width: col.width, align: col.align ?? 'left' });
      x += col.width;
    }
    y += 16;
  }

  return y;
}

/** Bloc signatures (image base64 ou URL locale + nom signataire). */
export function drawSignature(
  doc: PDFKit.PDFDocument,
  opts: {
    label: string;
    signatureUrl?: string | null;
    recipientName?: string | null;
    x: number;
    y: number;
  },
) {
  const { label, signatureUrl, recipientName, x, y } = opts;
  const w = 200;
  const h = 60;
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#666')
    .text(label.toUpperCase(), x, y);
  doc.rect(x, y + 12, w, h).lineWidth(0.5).strokeColor('#ccc').stroke();
  if (signatureUrl) {
    const localPath = resolveLocalAsset(signatureUrl);
    if (localPath && existsSync(localPath)) {
      try {
        doc.image(localPath, x + 2, y + 14, { fit: [w - 4, h - 4] });
      } catch {
        /* ignore */
      }
    }
  }
  if (recipientName) {
    doc
      .fontSize(8)
      .font('Helvetica-Oblique')
      .fillColor('#444')
      .text(recipientName, x, y + h + 16, { width: w });
  }
  doc.fillColor('black');
}

/** Footer : mentions légales + RIB. */
export function drawFooter(doc: PDFKit.PDFDocument, company: PdfCompanyInfo) {
  const y = 760;
  doc.moveTo(50, y).lineTo(560, y).lineWidth(0.3).strokeColor('#ccc').stroke();
  doc.fontSize(7).font('Helvetica').fillColor('#666');
  const bits: string[] = [];
  if (company.bankName) {
    bits.push(`Banque : ${company.bankName}`);
  }
  if (company.bankAccount) bits.push(`RIB : ${company.bankAccount}`);
  if (company.bankSwift) bits.push(`SWIFT : ${company.bankSwift}`);
  if (bits.length > 0) {
    doc.text(bits.join(' · '), 50, y + 5, { width: 510, align: 'center' });
  }
  if (company.legalMentions) {
    doc.text(company.legalMentions, 50, y + 17, { width: 510, align: 'center' });
  }
  doc.fillColor('black');
}

/** Résout une URL d'asset (/uploads/...) en chemin local sur disque. */
function resolveLocalAsset(url: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return null; // pas de fetch réseau ici
  // L'URL publique est `/uploads/<subpath>` → fichier sur disque dans env.UPLOAD_DIR/<subpath>
  const prefix = '/uploads/';
  if (url.startsWith(prefix)) {
    return path.join(env.UPLOAD_DIR, url.slice(prefix.length));
  }
  return null;
}

/** Helper : crée un PDFDocument standard pré-configuré. */
export function newPdfDocument(): PDFKit.PDFDocument {
  return new PDFDocument({ size: 'A4', margin: 50 });
}
