import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError } from '../../utils/errors.js';

export async function listServices(opts: { isActive?: boolean; search?: string }) {
  const where: Prisma.ServiceWhereInput = {
    ...(typeof opts.isActive === 'boolean' ? { isActive: opts.isActive } : {}),
    ...(opts.search
      ? {
          OR: [
            { code: { contains: opts.search, mode: 'insensitive' } },
            { label: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const items = await prisma.service.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });

  return { items, count: items.length };
}

export async function getService(id: string) {
  const svc = await prisma.service.findUnique({ where: { id } });
  if (!svc) throw new NotFoundError('Service not found');
  return svc;
}

export async function createService(
  actorId: string,
  data: Prisma.ServiceCreateInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.service.findUnique({ where: { code: data.code } });
    if (existing) throw new ConflictError('Code already exists');

    const svc = await tx.service.create({ data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'create',
        entity: 'service',
        entityId: svc.id,
        payload: { code: svc.code, label: svc.label },
      },
    });
    return svc;
  });
}

export async function updateService(
  actorId: string,
  id: string,
  data: Prisma.ServiceUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.service.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Service not found');

    const updated = await tx.service.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'service',
        entityId: id,
        payload: { before, after: updated },
      },
    });
    return updated;
  });
}
