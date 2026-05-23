import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError } from '../../utils/errors.js';
import type {
  CreatePdaDto,
  ListPdasDto,
  SetPdaStatusDto,
  UpdatePdaDto,
} from './pdas.dto.js';

export async function listPdas(opts: ListPdasDto) {
  const where: Prisma.PdaWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(typeof opts.isActive === 'boolean' ? { isActive: opts.isActive } : {}),
    ...(opts.search
      ? {
          OR: [
            { reference: { contains: opts.search, mode: 'insensitive' } },
            { brand: { contains: opts.search, mode: 'insensitive' } },
            { model: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.pda.findMany({
      where,
      orderBy: [{ status: 'asc' }, { reference: 'asc' }],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.pda.count({ where }),
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

export async function getPda(id: string) {
  const pda = await prisma.pda.findUnique({ where: { id } });
  if (!pda) throw new NotFoundError('PDA not found');
  return pda;
}

export async function createPda(actorId: string, dto: CreatePdaDto) {
  const existing = await prisma.pda.findUnique({
    where: { reference: dto.reference },
  });
  if (existing) throw new ConflictError(`PDA reference ${dto.reference} already exists`);

  const pda = await prisma.pda.create({
    data: {
      reference: dto.reference,
      brand: dto.brand ?? null,
      model: dto.model ?? null,
      status: dto.status,
      batteryLevel: dto.batteryLevel ?? null,
      notes: dto.notes ?? null,
      isActive: dto.isActive,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'create',
      entity: 'pda',
      entityId: pda.id,
      payload: { reference: pda.reference },
    },
  });
  return pda;
}

export async function updatePda(actorId: string, id: string, dto: UpdatePdaDto) {
  const existing = await prisma.pda.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('PDA not found');

  if (dto.reference && dto.reference !== existing.reference) {
    const dupe = await prisma.pda.findUnique({ where: { reference: dto.reference } });
    if (dupe) throw new ConflictError(`PDA reference ${dto.reference} already exists`);
  }

  const pda = await prisma.pda.update({
    where: { id },
    data: {
      reference: dto.reference,
      brand: dto.brand,
      model: dto.model,
      status: dto.status,
      batteryLevel: dto.batteryLevel,
      notes: dto.notes,
      isActive: dto.isActive,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'update',
      entity: 'pda',
      entityId: id,
      payload: { changes: dto as unknown as Prisma.InputJsonValue },
    },
  });
  return pda;
}

export async function setPdaStatus(actorId: string, id: string, dto: SetPdaStatusDto) {
  const existing = await prisma.pda.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('PDA not found');

  const pda = await prisma.pda.update({
    where: { id },
    data: { status: dto.status },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'update',
      entity: 'pda',
      entityId: id,
      payload: { event: 'status_change', from: existing.status, to: dto.status, reason: dto.reason },
    },
  });
  return pda;
}

/** Vue d'ensemble : compteurs par statut + dispo. Pour dashboard. */
export async function getPdaOverview() {
  const all = await prisma.pda.findMany({
    where: { isActive: true },
    select: { status: true },
  });
  const counters = { available: 0, in_use: 0, maintenance: 0, out_of_service: 0 };
  for (const p of all) counters[p.status] += 1;
  return { total: all.length, counters };
}
