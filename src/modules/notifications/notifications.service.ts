import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { NotFoundError } from '../../utils/errors.js';
import { dispatchers, type DispatchPayload } from './notifications.dispatchers.js';
import type { EnqueueNotificationDto } from './notifications.dto.js';

type Tx = Prisma.TransactionClient;

/**
 * Service notifications.
 *
 *  - `enqueue` : insère une notification en `queued`. À utiliser depuis n'importe
 *     quelle transaction métier (passer `tx`) pour garantir l'atomicité.
 *  - `processQueue` : pop FIFO des `queued`, dispatche selon le canal, marque
 *     `sent` ou `failed`. À appeler par cron ou via `POST /notifications/process`.
 *  - `notifyImmediate` : enqueue + dispatch sur place (pour tests / cas urgents).
 */

export async function enqueue(
  data: EnqueueNotificationDto,
  txOpt?: Tx,
) {
  const client = txOpt ?? prisma;
  return client.notification.create({
    data: {
      channel: data.channel,
      recipientUserId: data.recipientUserId ?? null,
      recipientEmail: data.recipientEmail ?? null,
      recipientPhone: data.recipientPhone ?? null,
      subject: data.subject ?? null,
      body: data.body,
      metadata: (data.metadata ?? null) as Prisma.InputJsonValue,
      status: 'queued',
    },
  });
}

export async function notifyImmediate(data: EnqueueNotificationDto) {
  const notif = await enqueue(data);
  await processOne(notif.id);
  return prisma.notification.findUnique({ where: { id: notif.id } });
}

async function processOne(notifId: string) {
  const notif = await prisma.notification.findUnique({ where: { id: notifId } });
  if (!notif) throw new NotFoundError('Notification not found');
  if (notif.status !== 'queued') return notif;

  const payload: DispatchPayload = {
    recipientUserId: notif.recipientUserId,
    recipientEmail: notif.recipientEmail,
    recipientPhone: notif.recipientPhone,
    subject: notif.subject,
    body: notif.body,
    metadata: (notif.metadata as Record<string, unknown> | null) ?? null,
  };

  try {
    const result = await dispatchers[notif.channel](payload);
    return prisma.notification.update({
      where: { id: notifId },
      data: {
        status: result.success ? 'sent' : 'failed',
        sentAt: result.success ? new Date() : null,
        error: result.success ? null : result.error ?? 'Unknown dispatcher error',
      },
    });
  } catch (err) {
    logger.error({ err, notifId }, 'Notification dispatch crashed');
    return prisma.notification.update({
      where: { id: notifId },
      data: {
        status: 'failed',
        error: err instanceof Error ? err.message : 'crash',
      },
    });
  }
}

/** Vide la file (FIFO) jusqu'à `limit` notifs, en best-effort. */
export async function processQueue(limit = 50) {
  const queued = await prisma.notification.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let sent = 0;
  let failed = 0;
  for (const n of queued) {
    const updated = await processOne(n.id);
    if (updated?.status === 'sent') sent += 1;
    else failed += 1;
  }
  return { processed: queued.length, sent, failed };
}

/* ════════════ LISTING ════════════ */

export async function listNotifications(opts: {
  status?: 'queued' | 'sent' | 'failed';
  channel?: 'email' | 'push' | 'sms';
  recipientUserId?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.NotificationWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.channel ? { channel: opts.channel } : {}),
    ...(opts.recipientUserId ? { recipientUserId: opts.recipientUserId } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: opts.page,
      pageSize: opts.pageSize,
      total,
      totalPages: Math.ceil(total / opts.pageSize),
    },
  };
}

/* ════════════ HELPERS DOMAINE (utilisés par les services métier) ════════════
 *
 * Ces helpers résolvent le destinataire (User d'un client hôtel ou contact direct)
 * puis empilent une notification dans la même transaction si fournie.
 */

export async function notifyClientUsers(
  clientId: string,
  subject: string,
  body: string,
  metadata?: Record<string, unknown>,
  txOpt?: Tx,
) {
  const client = txOpt ?? prisma;
  const c = await client.client.findUnique({
    where: { id: clientId },
    select: { email: true, phone: true, users: { select: { id: true } } },
  });
  if (!c) return [];

  const created: { id: string }[] = [];

  // Push à tous les users du client
  for (const u of c.users) {
    const n = await enqueue(
      {
        channel: 'push',
        recipientUserId: u.id,
        subject,
        body,
        metadata,
      },
      txOpt,
    );
    created.push({ id: n.id });
  }

  // Email au contact principal du client
  if (c.email) {
    const n = await enqueue(
      {
        channel: 'email',
        recipientEmail: c.email,
        subject,
        body,
        metadata,
      },
      txOpt,
    );
    created.push({ id: n.id });
  }

  return created;
}

/** Push notification ciblée à un user spécifique (chauffeur, opérateur, etc.). */
export async function notifyUser(
  userId: string,
  subject: string,
  body: string,
  metadata?: Record<string, unknown>,
  txOpt?: Tx,
) {
  const n = await enqueue(
    {
      channel: 'push',
      recipientUserId: userId,
      subject,
      body,
      metadata,
    },
    txOpt,
  );
  return n;
}
