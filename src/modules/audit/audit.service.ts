import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import type { ListAuditLogsDto } from './audit.dto.js';

/**
 * Lecture seule du journal d'audit.
 * Les écritures se font dans les services métier, dans la même transaction
 * que l'action auditée.
 */
export async function listAuditLogs(opts: ListAuditLogsDto) {
  const where: Prisma.AuditLogWhereInput = {
    ...(opts.entity ? { entity: opts.entity } : {}),
    ...(opts.entityId ? { entityId: opts.entityId } : {}),
    ...(opts.actorId ? { actorId: opts.actorId } : {}),
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.from || opts.to
      ? {
          at: {
            ...(opts.from ? { gte: new Date(opts.from) } : {}),
            ...(opts.to ? { lte: new Date(opts.to) } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { at: 'desc' },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: {
        actor: { select: { id: true, email: true, firstName: true, lastName: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
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

export async function getAuditTrail(entity: string, entityId: string) {
  return prisma.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { at: 'asc' },
    include: {
      actor: { select: { id: true, email: true, firstName: true, lastName: true, role: true } },
    },
  });
}
