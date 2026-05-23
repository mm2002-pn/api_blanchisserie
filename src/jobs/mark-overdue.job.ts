import { logger } from '../config/logger.js';
import { markOverdueInvoices } from '../modules/invoices/invoices.service.js';

/**
 * Bascule les factures `pending` dont la dueDate est passée vers `overdue`.
 * Tourne typiquement à 06:00 chaque jour.
 */
export async function markOverdueJob() {
  try {
    const result = await markOverdueInvoices();
    if (result.updated > 0) {
      logger.info({ ...result }, 'cron: invoices marked overdue');
    }
  } catch (err) {
    logger.error({ err }, 'cron: markOverdue failed');
  }
}
