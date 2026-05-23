import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { hashPassword } from '../../utils/password.js';
import { ConflictError, NotFoundError } from '../../utils/errors.js';

const PUBLIC_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isActive: true,
  clientId: true,
  driverStatus: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export async function listUsers(opts: {
  role?: string;
  search?: string;
  isActive?: boolean;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.UserWhereInput = {
    ...(opts.role ? { role: opts.role as Prisma.EnumRoleFilter } : {}),
    ...(typeof opts.isActive === 'boolean' ? { isActive: opts.isActive } : {}),
    ...(opts.search
      ? {
          OR: [
            { email: { contains: opts.search, mode: 'insensitive' } },
            { firstName: { contains: opts.search, mode: 'insensitive' } },
            { lastName: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: PUBLIC_SELECT,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
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

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: PUBLIC_SELECT,
  });
  if (!user) throw new NotFoundError('User not found');
  return user;
}

export async function createUser(
  actorId: string,
  data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role: 'admin' | 'manager' | 'supervisor' | 'operator' | 'driver' | 'hotel';
    clientId?: string;
  },
) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new ConflictError('Email already in use');

  const passwordHash = await hashPassword(data.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        role: data.role,
        clientId: data.clientId,
      },
      select: PUBLIC_SELECT,
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'create',
        entity: 'user',
        entityId: user.id,
        payload: { email: user.email, role: user.role },
      },
    });

    return user;
  });
}

export async function updateUser(
  actorId: string,
  id: string,
  data: Prisma.UserUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('User not found');

    const user = await tx.user.update({
      where: { id },
      data,
      select: PUBLIC_SELECT,
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'user',
        entityId: id,
        payload: { changes: data as unknown as Prisma.InputJsonValue },
      },
    });

    return user;
  });
}

/** Reset par admin (sans connaitre l'ancien mot de passe). */
export async function adminResetPassword(
  actorId: string,
  userId: string,
  newPassword: string,
) {
  const passwordHash = await hashPassword(newPassword);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');

    await tx.user.update({ where: { id: userId }, data: { passwordHash } });

    // Révoque tous les refresh tokens
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'permission',
        entity: 'user',
        entityId: userId,
        payload: { event: 'admin_password_reset' },
      },
    });

    return { ok: true };
  });
}

export async function deactivateUser(actorId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('User not found');
    if (!user.isActive) return user;

    const updated = await tx.user.update({
      where: { id },
      data: { isActive: false },
      select: PUBLIC_SELECT,
    });

    await tx.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'user',
        entityId: id,
        payload: { event: 'deactivate' },
      },
    });

    return updated;
  });
}

/** Met a jour la disponibilite d'un chauffeur (admin/manager/supervisor ou le chauffeur lui-meme). */
export async function setDriverStatus(
  actorId: string,
  userId: string,
  driverStatus: 'available' | 'on_route' | 'off_duty' | 'unavailable',
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User not found');
  if (user.role !== 'driver') {
    throw new ConflictError('User is not a driver');
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { driverStatus },
    select: PUBLIC_SELECT,
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'update',
      entity: 'user',
      entityId: userId,
      payload: { event: 'driver_status', driverStatus },
    },
  });
  return updated;
}
