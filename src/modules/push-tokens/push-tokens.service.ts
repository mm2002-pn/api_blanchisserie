import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../utils/errors.js';
import type { RegisterPushTokenDto } from './push-tokens.dto.js';

/**
 * Enregistre (ou réactive) un token Expo pour l'utilisateur courant.
 * Idempotent : un même token sur le même user le réactive ; un token déjà
 * présent sur un autre user est transféré (cas changement de compte).
 */
export async function registerToken(userId: string, dto: RegisterPushTokenDto) {
  return prisma.userPushToken.upsert({
    where: { token: dto.token },
    create: {
      userId,
      token: dto.token,
      platform: dto.platform,
      deviceName: dto.deviceName,
      isActive: true,
    },
    update: {
      userId,
      platform: dto.platform,
      deviceName: dto.deviceName,
      isActive: true,
      lastUsedAt: new Date(),
    },
  });
}

export async function listMyTokens(userId: string) {
  return prisma.userPushToken.findMany({
    where: { userId },
    orderBy: { lastUsedAt: 'desc' },
  });
}

export async function unregisterToken(userId: string, tokenId: string) {
  const existing = await prisma.userPushToken.findUnique({
    where: { id: tokenId },
  });
  if (!existing || existing.userId !== userId) {
    throw new NotFoundError('Token not found');
  }
  return prisma.userPushToken.update({
    where: { id: tokenId },
    data: { isActive: false },
  });
}

/** Helper utilisé par le dispatcher push. */
export async function findActiveTokensForUser(userId: string) {
  return prisma.userPushToken.findMany({
    where: { userId, isActive: true },
    select: { id: true, token: true },
  });
}

/**
 * Désactive en bulk les tokens dont Expo a renvoyé `DeviceNotRegistered` —
 * appelé par le dispatcher après un envoi.
 */
export async function deactivateTokens(tokens: string[]) {
  if (tokens.length === 0) return { deactivated: 0 };
  const result = await prisma.userPushToken.updateMany({
    where: { token: { in: tokens } },
    data: { isActive: false },
  });
  return { deactivated: result.count };
}

/** Touch lastUsedAt pour les tokens utilisés avec succès. */
export async function touchTokens(tokens: string[]) {
  if (tokens.length === 0) return;
  await prisma.userPushToken.updateMany({
    where: { token: { in: tokens } },
    data: { lastUsedAt: new Date() },
  });
}
