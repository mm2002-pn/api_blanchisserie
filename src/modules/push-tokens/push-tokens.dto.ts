import { z } from 'zod';

/**
 * Format Expo : `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]` ou `ExpoPushToken[...]`.
 * On valide la forme côté serveur pour éviter d'appeler Expo avec des chaînes
 * arbitraires.
 */
const expoTokenRegex = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

export const registerPushTokenSchema = z.object({
  token: z.string().regex(expoTokenRegex, 'Invalid Expo push token format'),
  platform: z.enum(['ios', 'android', 'web']),
  deviceName: z.string().max(120).optional(),
});

export type RegisterPushTokenDto = z.infer<typeof registerPushTokenSchema>;
