import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { generateInvoicesForPeriod } from '../modules/invoices/invoices.service.js';

/**
 * Génère les factures du mois précédent pour tous les clients ayant des
 * commandes livrées non facturées. Tourne le 1er du mois à 08:00.
 *
 * Acteur = premier admin actif (système). Les opérations sont auditées
 * sous cet acteur ; en prod, créer un User dédié `cron-bot`.
 */
export async function autoInvoiceJob() {
  try {
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59); // dernier jour du mois précédent
    const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);

    const actor = await prisma.user.findFirst({
      where: { role: 'admin', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!actor) {
      logger.warn('cron: autoInvoice — no active admin user found, skipped');
      return;
    }

    const result = await generateInvoicesForPeriod(actor.id, {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      taxRate: 0.18,
    });

    logger.info(
      {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        ...result,
      },
      'cron: monthly invoices generated',
    );
  } catch (err) {
    logger.error({ err }, 'cron: autoInvoice failed');
  }
}
