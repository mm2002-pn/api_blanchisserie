import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { prisma } from '../../config/prisma.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt.js';
import { hashPassword, needsRehash, verifyPassword } from '../../utils/password.js';
import { ConflictError, UnauthorizedError } from '../../utils/errors.js';
import type { ChangePasswordDto, LoginDto } from './auth.dto.js';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Login — vérifie email/password, génère access + refresh tokens.
 *
 * Sécurité :
 *  - argon2id pour le password
 *  - refresh token stocké hashé (jamais en clair)
 *  - rotation automatique des paramètres argon (needsRehash)
 *  - met à jour lastLoginAt
 *  - écrit un audit log
 */
export async function login(
  dto: LoginDto,
  meta: { ipAddress?: string; userAgent?: string } = {},
) {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });
  if (!user || !user.isActive) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const ok = await verifyPassword(user.passwordHash, dto.password);
  if (!ok) {
    throw new UnauthorizedError('Invalid credentials');
  }

  // Rehash si paramètres argon obsolètes
  let passwordHash = user.passwordHash;
  if (await needsRehash(user.passwordHash)) {
    passwordHash = await hashPassword(dto.password);
  }

  const jti = nanoid(24);
  const refreshTokenRaw = await signRefreshToken({ sub: user.id, jti });
  const refreshTokenHash = hashRefreshToken(refreshTokenRaw);

  // Tout en transaction
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), passwordHash },
    }),
    prisma.refreshToken.create({
      data: {
        tokenHash: refreshTokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'login',
        entity: 'user',
        entityId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    }),
  ]);

  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    clientId: user.clientId,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      clientId: user.clientId,
    },
    accessToken,
    refreshToken: refreshTokenRaw,
  };
}

/**
 * Refresh — vérifie le refresh token, le révoque, en émet de nouveaux (rotation).
 */
export async function refresh(refreshTokenRaw: string) {
  const payload = await verifyRefreshToken(refreshTokenRaw);
  const tokenHash = hashRefreshToken(refreshTokenRaw);

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token revoked or expired');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    throw new UnauthorizedError('User not found or inactive');
  }

  // Rotation : révoque l'ancien, émet un nouveau
  const newJti = nanoid(24);
  const newRefreshRaw = await signRefreshToken({ sub: user.id, jti: newJti });
  const newRefreshHash = hashRefreshToken(newRefreshRaw);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        tokenHash: newRefreshHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    }),
  ]);

  const newAccess = await signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    clientId: user.clientId,
  });

  return { accessToken: newAccess, refreshToken: newRefreshRaw };
}

/** Logout — révoque le refresh token courant. */
export async function logout(refreshTokenRaw: string) {
  const tokenHash = hashRefreshToken(refreshTokenRaw);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Change password — vérifie l'ancien, hash le nouveau, révoque tous les refresh tokens. */
export async function changePassword(userId: string, dto: ChangePasswordDto) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError('User not found');

  const ok = await verifyPassword(user.passwordHash, dto.currentPassword);
  if (!ok) throw new UnauthorizedError('Current password incorrect');

  const newHash = await hashPassword(dto.newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'update',
        entity: 'user',
        entityId: userId,
        payload: { event: 'password_change' },
      },
    }),
  ]);

  return { ok: true };
}

/**
 * Inscription d'un compte hôtel (libre-service depuis l'app mobile).
 * NOTE : cette route doit être limitée par rate-limit strict.
 */
export async function registerHotel(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  hotelName: string;
  hotelType: 'hotel_5_etoiles' | 'hotel_4_etoiles' | 'hotel_3_etoiles' | 'restaurant' | 'autre';
  address: string;
  phone?: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('Email already in use');

  const passwordHash = await hashPassword(input.password);

  const created = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        name: input.hotelName,
        type: input.hotelType,
        address: input.address,
        phone: input.phone,
        email: input.email,
      },
    });

    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'hotel',
        clientId: client.id,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: 'create',
        entity: 'user',
        entityId: user.id,
        payload: { event: 'hotel_self_registration', clientId: client.id },
      },
    });

    return { user, client };
  });

  return created;
}
