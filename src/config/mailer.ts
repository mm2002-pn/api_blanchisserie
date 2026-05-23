import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Transporter SMTP (singleton, lazy).
 * Renvoie `null` si la config SMTP est absente — le dispatcher email tombe
 * alors en dry-run.
 */

let cached: Transporter | null = null;
let initialized = false;

export function getMailer(): Transporter | null {
  if (initialized) return cached;
  initialized = true;

  if (!env.SMTP_HOST || !env.SMTP_USER) {
    logger.warn('SMTP_HOST/SMTP_USER not set — email dispatcher will dry-run');
    cached = null;
    return null;
  }

  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  // Vérifie la config au boot (non bloquant)
  cached.verify().then(
    () => logger.info({ host: env.SMTP_HOST }, '✓ SMTP transporter ready'),
    (err: unknown) => logger.error({ err }, 'SMTP verify failed'),
  );

  return cached;
}

export const SMTP_FROM = env.SMTP_FROM;
