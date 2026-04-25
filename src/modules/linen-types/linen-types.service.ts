import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError } from '../../utils/errors.js';

export async function listLinenTypes(opts: {
  category?: string;
  isActive?: boolean;
  search?: string;
}) {
  const where: Prisma.LinenTypeWhereInput = {
    ...(opts.category
      ? { category: opts.category as Prisma.EnumLinenCategoryFilter }
      : {}),
    ...(typeof opts.isActive === 'boolean' ? { isActive: opts.isActive } : {}),
    ...(opts.search
      ? {
          OR: [
            { code: { contains: opts.search, mode: 'insensitive' } },
            { name: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const items = await prisma.linenType.findMany({
    where,
    orderBy: [{ category: 'asc' }, { code: 'asc' }],
  });

  return { items, count: items.length };
}

export async function getLinenType(id: string) {
  const linen = await prisma.linenType.findUnique({ where: { id } });
  if (!linen) throw new NotFoundError('Linen type not found');
  return linen;
}

export async function createLinenType(
  actorId: string,
  data: Prisma.LinenTypeCreateInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.linenType.findUnique({ where: { code: data.code } });
    if (existing) throw new ConflictError('Code already exists');

    const linen = await tx.linenType.create({ data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'create',
        entity: 'linen_type',
        entityId: linen.id,
        payload: { code: linen.code, name: linen.name, category: linen.category },
      },
    });
    return linen;
  });
}

export async function updateLinenType(
  actorId: string,
  id: string,
  data: Prisma.LinenTypeUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.linenType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Linen type not found');

    const linen = await tx.linenType.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'linen_type',
        entityId: id,
        payload: { changes: data as unknown as Prisma.InputJsonValue },
      },
    });
    return linen;
  });
}
