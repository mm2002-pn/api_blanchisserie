import type { DocumentType } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

/**
 * Service Documents :
 *  - getCompanySettings : config entreprise (singleton, auto-créé si absent)
 *  - nextDocumentNumber : compteur atomique par type+année (CMD-2026-001 …)
 *  - getCompanyOrDefault : fallback sain si l'admin n'a rien configuré
 */

const PREFIX: Record<DocumentType, string> = {
  BON_COMMANDE: 'CMD',
  BON_COLLECTE: 'BCOL',
  BORDEREAU_TRIAGE: 'BT',
  BON_LIVRAISON: 'BL',
  FACTURE: 'FAC',
  AVOIR: 'AV',
};

/**
 * Génère atomiquement le prochain numéro pour un type donné.
 * Utilise une transaction Prisma pour éviter les courses concurrentes :
 *  - upsert sur (type, year) avec increment
 *  - lecture du counter résultant
 */
export async function nextDocumentNumber(type: DocumentType): Promise<string> {
  const year = new Date().getFullYear();
  const seq = await prisma.documentSequence.upsert({
    where: { type_year: { type, year } },
    create: { type, year, counter: 1 },
    update: { counter: { increment: 1 } },
  });
  const padded = String(seq.counter).padStart(3, '0');
  return `${PREFIX[type]}-${year}-${padded}`;
}

/**
 * Récupère la config entreprise. Crée une ligne par défaut si absente.
 * (Évite à l'admin de devoir initialiser manuellement avant le 1er doc.)
 */
export async function getCompanySettings() {
  const existing = await prisma.companySettings.findFirst();
  if (existing) return existing;
  return prisma.companySettings.create({
    data: {
      companyName: 'Blanchisserie SN',
      address: 'Dakar, Sénégal',
      city: 'Dakar',
      country: 'Sénégal',
      vatRate: 0.18,
      paymentTerms: 'Paiement sous 30 jours',
    },
  });
}

export async function updateCompanySettings(
  actorId: string,
  patch: Partial<{
    companyName: string;
    legalForm: string | null;
    ninea: string | null;
    rcNumber: string | null;
    address: string;
    city: string;
    postalCode: string | null;
    country: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    logoUrl: string | null;
    vatRate: number;
    bankName: string | null;
    bankAccount: string | null;
    bankSwift: string | null;
    legalMentions: string | null;
    paymentTerms: string;
  }>,
) {
  const current = await getCompanySettings();
  return prisma.companySettings.update({
    where: { id: current.id },
    data: { ...patch, updatedBy: actorId },
  });
}
