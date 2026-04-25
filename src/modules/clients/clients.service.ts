import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../utils/errors.js';

export async function listClients(opts: {
  type?: string;
  search?: string;
  isActive?: boolean;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.ClientWhereInput = {
    ...(opts.type ? { type: opts.type as Prisma.EnumClientTypeFilter } : {}),
    ...(typeof opts.isActive === 'boolean' ? { isActive: opts.isActive } : {}),
    ...(opts.search
      ? {
          OR: [
            { name: { contains: opts.search, mode: 'insensitive' } },
            { contactPerson: { contains: opts.search, mode: 'insensitive' } },
            { phone: { contains: opts.search } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.client.findMany({
      where,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      orderBy: { name: 'asc' },
    }),
    prisma.client.count({ where }),
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

export async function getClient(id: string) {
  const client = await prisma.client.findUnique({
    where: { id },
    include: { tariff: true, _count: { select: { orders: true, invoices: true } } },
  });
  if (!client) throw new NotFoundError('Client not found');
  return client;
}

export async function createClient(actorId: string, data: Prisma.ClientCreateInput) {
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({ data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'create',
        entity: 'client',
        entityId: client.id,
        payload: { name: client.name, type: client.type },
      },
    });
    return client;
  });
}

export async function updateClient(
  actorId: string,
  id: string,
  data: Prisma.ClientUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.client.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Client not found');

    const client = await tx.client.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'client',
        entityId: id,
        payload: { changes: data as unknown as Prisma.InputJsonValue },
      },
    });
    return client;
  });
}
