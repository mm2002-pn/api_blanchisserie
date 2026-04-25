import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../utils/errors.js';

export async function listMachines(opts: {
  kind?: string;
  status?: string;
  search?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.MachineWhereInput = {
    ...(opts.kind ? { kind: opts.kind as Prisma.EnumMachineKindFilter } : {}),
    ...(opts.status ? { status: opts.status as Prisma.EnumMachineStatusFilter } : {}),
    ...(opts.search
      ? {
          OR: [
            { reference: { contains: opts.search, mode: 'insensitive' } },
            { brand: { contains: opts.search, mode: 'insensitive' } },
            { model: { contains: opts.search, mode: 'insensitive' } },
            { location: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.machine.findMany({
      where,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      orderBy: { reference: 'asc' },
    }),
    prisma.machine.count({ where }),
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

export async function getMachine(id: string) {
  const machine = await prisma.machine.findUnique({
    where: { id },
    include: {
      _count: { select: { batches: true } },
    },
  });
  if (!machine) throw new NotFoundError('Machine not found');

  // Charge actuelle = somme des batches en cours
  const activeLoad = await prisma.batch.aggregate({
    where: { machineId: id, status: 'in_progress' },
    _sum: { currentLoad: true },
  });

  return {
    ...machine,
    currentLoadKg: activeLoad._sum.currentLoad
      ? Math.round(activeLoad._sum.currentLoad / 1000)
      : 0,
  };
}

export async function createMachine(actorId: string, data: Prisma.MachineCreateInput) {
  return prisma.$transaction(async (tx) => {
    const machine = await tx.machine.create({ data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'create',
        entity: 'machine',
        entityId: machine.id,
        payload: { reference: machine.reference, kind: machine.kind },
      },
    });
    return machine;
  });
}

export async function updateMachine(
  actorId: string,
  id: string,
  data: Prisma.MachineUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.machine.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Machine not found');

    const machine = await tx.machine.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'machine',
        entityId: id,
        payload: { changes: data as unknown as Prisma.InputJsonValue },
      },
    });
    return machine;
  });
}

/**
 * Vue d'ensemble de la capacité atelier — utilisée par MachinesPage
 * pour afficher le banner déficit/saturation.
 */
export async function getCapacityOverview() {
  const machines = await prisma.machine.findMany({
    where: { status: 'active' },
    select: { id: true, capacityKg: true, kind: true },
  });

  const totalActiveCapacity = machines.reduce((s, m) => s + m.capacityKg, 0);

  const loadByMachine = await prisma.batch.groupBy({
    by: ['machineId'],
    where: { status: { in: ['in_progress', 'validated'] } },
    _sum: { currentLoad: true },
  });

  const totalLoadGr = loadByMachine.reduce((s, x) => s + (x._sum.currentLoad ?? 0), 0);
  const totalLoadKg = Math.round(totalLoadGr / 1000);
  const utilization = totalActiveCapacity > 0 ? totalLoadKg / totalActiveCapacity : 0;

  return {
    totalActiveCapacityKg: totalActiveCapacity,
    totalLoadKg,
    utilization,
    deficit: utilization > 1,
    machinesActive: machines.length,
  };
}
