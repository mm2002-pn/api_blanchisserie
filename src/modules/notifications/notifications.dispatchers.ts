import path from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getMailer, SMTP_FROM } from '../../config/mailer.js';
import {
  deactivateTokens,
  findActiveTokensForUser,
  touchTokens,
} from '../push-tokens/push-tokens.service.js';

export interface DispatchPayload {
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  subject?: string | null;
  body: string;
  metadata?: Record<string, unknown> | null;
}

export interface DispatchResult {
  success: boolean;
  error?: string;
  providerRef?: string;
}

interface MailAttachment {
  filename: string;
  /** Chemin disque absolu OU URL publique. */
  path: string;
}

function extractAttachments(metadata?: Record<string, unknown> | null): MailAttachment[] {
  if (!metadata || !Array.isArray(metadata.attachments)) return [];
  return (metadata.attachments as unknown[])
    .filter(
      (a): a is MailAttachment =>
        typeof a === 'object' &&
        a !== null &&
        typeof (a as { filename?: unknown }).filename === 'string' &&
        typeof (a as { path?: unknown }).path === 'string',
    )
    .map((a) => {
      // Si chemin commence par /uploads, le résoudre vers le disque
      const isUploadUrl = a.path.startsWith('/uploads/');
      return {
        filename: a.filename,
        path: isUploadUrl
          ? path.join(env.UPLOAD_DIR, a.path.slice('/uploads/'.length))
          : a.path,
      };
    });
}

/**
 * Adapters par canal. Sans clés réelles (SMTP, FCM/APNS, Orange/Twilio),
 * on logue et on retourne success — utile en dev et CI.
 *
 * En prod, ENABLE_* doit valoir true ET un provider doit être branché ici.
 */

async function dispatchEmail(p: DispatchPayload): Promise<DispatchResult> {
  if (!env.ENABLE_EMAIL) {
    logger.info({ to: p.recipientEmail, subject: p.subject }, 'EMAIL (disabled, dry-run)');
    return { success: true, providerRef: 'dry-run' };
  }
  if (!p.recipientEmail) {
    return { success: false, error: 'Missing recipientEmail' };
  }

  const transporter = getMailer();
  if (!transporter) {
    logger.warn({ to: p.recipientEmail }, 'SMTP not configured — accepting (no-op)');
    return { success: true, providerRef: 'noop' };
  }

  const attachments = extractAttachments(p.metadata);

  const info = await transporter.sendMail({
    from: SMTP_FROM,
    to: p.recipientEmail,
    subject: p.subject ?? '(sans objet)',
    text: p.body,
    html: p.body.includes('<') ? p.body : `<pre>${p.body}</pre>`,
    ...(attachments.length > 0 ? { attachments } : {}),
  });

  return { success: true, providerRef: info.messageId };
}

/* ════════════ EXPO PUSH ════════════
 *
 * Doc : https://docs.expo.dev/push-notifications/sending-notifications/
 * Endpoint : POST https://exp.host/--/api/v2/push/send
 * Limite : 100 messages par batch.
 */

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

async function sendExpoPush(messages: {
  to: string;
  title?: string | null;
  body: string;
  data?: Record<string, unknown> | null;
}[]): Promise<ExpoPushTicket[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
  if (env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  }

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Expo push HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: ExpoPushTicket[]; errors?: unknown };
  return json.data ?? [];
}

async function dispatchPush(p: DispatchPayload): Promise<DispatchResult> {
  if (!env.ENABLE_PUSH) {
    logger.info({ to: p.recipientUserId, subject: p.subject }, 'PUSH (disabled, dry-run)');
    return { success: true, providerRef: 'dry-run' };
  }
  if (!p.recipientUserId) {
    return { success: false, error: 'Missing recipientUserId' };
  }

  const tokens = await findActiveTokensForUser(p.recipientUserId);
  if (tokens.length === 0) {
    logger.debug({ userId: p.recipientUserId }, 'PUSH: no active tokens — skip');
    return { success: true, providerRef: 'no-tokens' };
  }

  const messages = tokens.map((t) => ({
    to: t.token,
    title: p.subject ?? undefined,
    body: p.body,
    data: (p.metadata ?? null) as Record<string, unknown> | null,
  }));

  try {
    const tickets = await sendExpoPush(messages);

    const okTokens: string[] = [];
    const deadTokens: string[] = [];
    tickets.forEach((t, i) => {
      const tok = tokens[i]?.token;
      if (!tok) return;
      if (t.status === 'ok') okTokens.push(tok);
      else if (t.details?.error === 'DeviceNotRegistered') deadTokens.push(tok);
    });

    if (okTokens.length > 0) await touchTokens(okTokens);
    if (deadTokens.length > 0) {
      const cleanup = await deactivateTokens(deadTokens);
      logger.info({ ...cleanup, userId: p.recipientUserId }, 'PUSH: dead tokens cleaned');
    }

    const failed = tickets.length - okTokens.length;
    if (okTokens.length === 0) {
      return {
        success: false,
        error: `All ${failed} push messages rejected`,
      };
    }
    return {
      success: true,
      providerRef: `expo:${okTokens.length}/${tickets.length}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Expo push call failed',
    };
  }
}

async function dispatchSms(p: DispatchPayload): Promise<DispatchResult> {
  if (!env.ENABLE_SMS) {
    logger.info({ to: p.recipientPhone }, 'SMS (disabled, dry-run)');
    return { success: true, providerRef: 'dry-run' };
  }
  if (!p.recipientPhone) {
    return { success: false, error: 'Missing recipientPhone' };
  }
  // TODO: brancher Orange SMS / Twilio ici
  logger.warn({ to: p.recipientPhone }, 'SMS provider not configured — accepting');
  return { success: true, providerRef: 'noop' };
}

export const dispatchers = {
  email: dispatchEmail,
  push: dispatchPush,
  sms: dispatchSms,
} satisfies Record<'email' | 'push' | 'sms', (p: DispatchPayload) => Promise<DispatchResult>>;
