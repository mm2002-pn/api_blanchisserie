import { z } from 'zod';

export const enqueueNotificationSchema = z
  .object({
    channel: z.enum(['email', 'push', 'sms']),
    recipientUserId: z.string().optional(),
    recipientEmail: z.string().email().optional(),
    recipientPhone: z.string().min(6).max(30).optional(),
    subject: z.string().max(200).optional(),
    body: z.string().min(1).max(5000),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) =>
      v.channel === 'email'
        ? Boolean(v.recipientEmail || v.recipientUserId)
        : v.channel === 'sms'
          ? Boolean(v.recipientPhone || v.recipientUserId)
          : Boolean(v.recipientUserId),
    {
      message: 'Recipient address required for the selected channel',
      path: ['channel'],
    },
  );

export const listNotificationsSchema = z.object({
  status: z.enum(['queued', 'sent', 'failed']).optional(),
  channel: z.enum(['email', 'push', 'sms']).optional(),
  recipientUserId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export const processQueueSchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
});

export type EnqueueNotificationDto = z.infer<typeof enqueueNotificationSchema>;
export type ListNotificationsDto = z.infer<typeof listNotificationsSchema>;
