import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { autoInvoiceJob } from './auto-invoice.job.js';
import { markOverdueJob } from './mark-overdue.job.js';
import { processNotificationsJob } from './process-notifications.job.js';

/**
 * Scheduler in-process. À désactiver (`ENABLE_CRON=false`) si on tourne
 * plusieurs instances de l'API : sinon les jobs s'exécutent N fois.
 *
 * En prod multi-instance : déplacer ces jobs dans un worker dédié.
 */

interface JobDef {
  name: string;
  schedule: string;
  fn: () => Promise<void>;
}

const JOBS: JobDef[] = [
  { name: 'notifications', schedule: env.CRON_NOTIFICATIONS, fn: processNotificationsJob },
  { name: 'mark-overdue', schedule: env.CRON_MARK_OVERDUE, fn: markOverdueJob },
  { name: 'auto-invoice', schedule: env.CRON_AUTO_INVOICE, fn: autoInvoiceJob },
];

let scheduled: ScheduledTask[] = [];

export function startScheduler() {
  if (!env.ENABLE_CRON) {
    logger.info('Scheduler disabled (ENABLE_CRON=false)');
    return;
  }

  for (const job of JOBS) {
    if (!cron.validate(job.schedule)) {
      logger.error({ name: job.name, schedule: job.schedule }, 'Invalid cron schedule, skipped');
      continue;
    }
    const task = cron.schedule(job.schedule, () => void job.fn(), {
      timezone: env.CRON_TZ,
    });
    scheduled.push(task);
    logger.info(
      { name: job.name, schedule: job.schedule, tz: env.CRON_TZ },
      'cron job registered',
    );
  }
}

export function stopScheduler() {
  for (const task of scheduled) task.stop();
  scheduled = [];
}
