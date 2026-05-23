import type { DocumentType } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { NotFoundError } from '../../utils/errors.js';
import { getCompanySettings, nextDocumentNumber } from './documents.service.js';
import { sendDocumentEmail } from './documents.delivery.js';
import { renderBonCommandePdf } from './pdf/pdf.bon-commande.js';
import { renderBonCollectePdf } from './pdf/pdf.bon-collecte.js';
import { renderBordereauTriagePdf } from './pdf/pdf.bordereau-triage.js';
import { renderBonLivraisonPdf } from './pdf/pdf.bon-livraison.js';
import type { PdfCompanyInfo } from './pdf/pdf.shared.js';

/**
 * Orchestrateurs de génération PDF pour chaque type de document.
 *
 * Pattern :
 *  - Charge l'order avec ses relations
 *  - Charge le catalogue (LinenType + LinenCategoryConfig) une fois
 *  - Génère un n° unique via DocumentSequence
 *  - Rend le PDF sur disque
 *  - Retourne { number, filePath, publicUrl }
 *
 * Les helpers `*AndEmail` ajoutent l'envoi automatique au client + log dans
 * `DocumentDelivery`. Les erreurs d'email sont swallow (non-bloquantes).
 */

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

async function loadLinenContext() {
  const [linenTypes, categories] = await Promise.all([
    prisma.linenType.findMany({
      select: { code: true, name: true, averageWeight: true, category: true },
    }),
    prisma.linenCategoryConfig.findMany({
      select: { code: true, label: true, emoji: true },
    }),
  ]);
  const categoryLabels: Record<string, string> = {};
  for (const c of categories) categoryLabels[c.code] = c.label;
  return { linenTypes, categoryLabels };
}

interface GeneratedDoc {
  type: DocumentType;
  number: string;
  filePath: string;
  publicUrl: string;
}

/* ════════════ BON DE COMMANDE ════════════ */

export async function generateBonCommande(orderId: string): Promise<GeneratedDoc> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { client: true },
  });
  if (!order) throw new NotFoundError('Order not found');

  const [company, { linenTypes, categoryLabels }, number] = await Promise.all([
    getCompanySettings(),
    loadLinenContext(),
    nextDocumentNumber('BON_COMMANDE'),
  ]);

  const { filePath, publicUrl } = await renderBonCommandePdf({
    order,
    docNumber: number,
    company: toCompanyInfo(company),
    linenTypes,
    categoryLabels,
  });

  return { type: 'BON_COMMANDE', number, filePath, publicUrl };
}

export async function generateBonCommandeAndEmail(orderId: string): Promise<GeneratedDoc> {
  const doc = await generateBonCommande(orderId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, client: { select: { email: true, name: true } } },
  });
  await sendDocumentEmail({
    type: 'BON_COMMANDE',
    number: doc.number,
    orderId: order!.id,
    recipientEmail: order!.client.email,
    recipientName: order!.client.name,
    subject: `Bon de commande ${doc.number} - ${order!.orderNumber}`,
    body:
      `Bonjour,\n\nVeuillez trouver ci-joint le bon de commande ${doc.number} ` +
      `correspondant à votre commande ${order!.orderNumber}.\n\nCordialement.`,
    pdfPath: doc.filePath,
  }).catch((err) => logger.warn({ err }, 'BC email failed (non-blocking)'));
  return doc;
}

/* ════════════ BON DE COLLECTE ════════════ */

export async function generateBonCollecte(orderId: string): Promise<GeneratedDoc> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { client: true, collectionDriver: true, collectionVehicle: true },
  });
  if (!order) throw new NotFoundError('Order not found');

  const [company, { linenTypes }, number] = await Promise.all([
    getCompanySettings(),
    loadLinenContext(),
    nextDocumentNumber('BON_COLLECTE'),
  ]);

  const { filePath, publicUrl } = await renderBonCollectePdf({
    order,
    docNumber: number,
    company: toCompanyInfo(company),
    linenTypes,
  });

  return { type: 'BON_COLLECTE', number, filePath, publicUrl };
}

export async function generateBonCollecteAndEmail(orderId: string): Promise<GeneratedDoc> {
  const doc = await generateBonCollecte(orderId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, client: { select: { email: true, name: true } } },
  });
  await sendDocumentEmail({
    type: 'BON_COLLECTE',
    number: doc.number,
    orderId: order!.id,
    recipientEmail: order!.client.email,
    recipientName: order!.client.name,
    subject: `Bon de collecte ${doc.number} - ${order!.orderNumber}`,
    body:
      `Bonjour,\n\nVotre commande ${order!.orderNumber} a bien été collectée. ` +
      `Le bon de collecte ${doc.number} signé est en pièce jointe.\n\nCordialement.`,
    pdfPath: doc.filePath,
  }).catch((err) => logger.warn({ err }, 'BCol email failed (non-blocking)'));
  return doc;
}

/* ════════════ BORDEREAU DE TRIAGE (interne) ════════════ */

export async function generateBordereauTriage(orderId: string): Promise<GeneratedDoc> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { client: true },
  });
  if (!order) throw new NotFoundError('Order not found');

  const [company, { linenTypes }, number] = await Promise.all([
    getCompanySettings(),
    loadLinenContext(),
    nextDocumentNumber('BORDEREAU_TRIAGE'),
  ]);

  const { filePath, publicUrl } = await renderBordereauTriagePdf({
    order,
    docNumber: number,
    company: toCompanyInfo(company),
    linenTypes,
  });

  return { type: 'BORDEREAU_TRIAGE', number, filePath, publicUrl };
}

/* ════════════ BON DE LIVRAISON ════════════ */

export async function generateBonLivraison(orderId: string): Promise<GeneratedDoc> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { client: true, deliveryDriver: true, deliveryVehicle: true },
  });
  if (!order) throw new NotFoundError('Order not found');

  const [company, { linenTypes }, number] = await Promise.all([
    getCompanySettings(),
    loadLinenContext(),
    nextDocumentNumber('BON_LIVRAISON'),
  ]);

  const { filePath, publicUrl } = await renderBonLivraisonPdf({
    order,
    docNumber: number,
    company: toCompanyInfo(company),
    linenTypes,
  });

  return { type: 'BON_LIVRAISON', number, filePath, publicUrl };
}

export async function generateBonLivraisonAndEmail(orderId: string): Promise<GeneratedDoc> {
  const doc = await generateBonLivraison(orderId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, client: { select: { email: true, name: true } } },
  });
  await sendDocumentEmail({
    type: 'BON_LIVRAISON',
    number: doc.number,
    orderId: order!.id,
    recipientEmail: order!.client.email,
    recipientName: order!.client.name,
    subject: `Bon de livraison ${doc.number} - ${order!.orderNumber}`,
    body:
      `Bonjour,\n\nVotre commande ${order!.orderNumber} a été livrée. ` +
      `Le bon de livraison ${doc.number} signé est en pièce jointe.\n\nCordialement.`,
    pdfPath: doc.filePath,
  }).catch((err) => logger.warn({ err }, 'BL email failed (non-blocking)'));
  return doc;
}
