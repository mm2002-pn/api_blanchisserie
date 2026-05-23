import { logger } from '../config/logger.js';
import { processQueue } from '../modules/notifications/notifications.service.js';

/**
 * Vide la file de notifications (FIFO) à chaque tick.
 * Best-effort : ne propage pas l'erreur pour ne pas tuer le scheduler.
 */
export async function processNotificationsJob() {
  try {
    const result = await processQueue(100);
    if (result.processed > 0) {
      logger.info({ ...result }, 'cron: notifications processed');
    }
  } catch (err) {
    logger.error({ err }, 'cron: processNotifications failed');
  }
}
