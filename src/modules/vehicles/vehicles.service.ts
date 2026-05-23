import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../utils/errors.js';
import type {
  CreateVehicleDto,
  EnrollVehicleDto,
  ListVehiclesDto,
  RecordMaintenanceDto,
  SetVehicleStatusDto,
  UpdateVehicleDto,
} from './vehicles.dto.js';

const ENROLLMENT_INCLUDE = {
  enrolledDriver: {
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, role: true },
  },
  enrolledPda: {
    select: { id: true, reference: true, brand: true, model: true, batteryLevel: true, status: true },
  },
} satisfies Prisma.VehicleInclude;

export async function listVehicles(opts: ListVehiclesDto) {
  const where: Prisma.VehicleWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.search
      ? {
          OR: [
            { matricule: { contains: opts.search, mode: 'insensitive' } },
            { brand: { contains: opts.search, mode: 'insensitive' } },
            { model: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.vehicle.findMany({
      where,
      include: ENROLLMENT_INCLUDE,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      orderBy: { matricule: 'asc' },
    }),
    prisma.vehicle.count({ where }),
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

export async function getVehicle(id: string) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: {
      ...ENROLLMENT_INCLUDE,
      _count: {
        select: { collectOrders: true, deliverOrders: true },
      },
    },
  });
  if (!vehicle) throw new NotFoundError('Vehicle not found');

  // Ordres actuellement en cours sur ce véhicule
  const activeOrders = await prisma.order.count({
    where: {
      OR: [{ collectionVehicleId: id }, { deliveryVehicleId: id }],
      status: { in: ['collected', 'received', 'in_production', 'ready'] },
    },
  });

  return { ...vehicle, activeOrdersCount: activeOrders };
}

export async function createVehicle(actorId: string, data: CreateVehicleDto) {
  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.create({ data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'create',
        entity: 'vehicle',
        entityId: vehicle.id,
        payload: {
          matricule: vehicle.matricule,
          brand: vehicle.brand,
          model: vehicle.model,
        },
      },
    });
    return vehicle;
  });
}

export async function updateVehicle(actorId: string, id: string, data: UpdateVehicleDto) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vehicle.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Vehicle not found');

    const vehicle = await tx.vehicle.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'vehicle',
        entityId: id,
        payload: { changes: data as unknown as Prisma.InputJsonValue },
      },
    });
    return vehicle;
  });
}

export async function setVehicleStatus(
  actorId: string,
  id: string,
  dto: SetVehicleStatusDto,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vehicle.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Vehicle not found');

    const vehicle = await tx.vehicle.update({
      where: { id },
      data: { status: dto.status },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'vehicle',
        entityId: id,
        payload: {
          event: 'status_change',
          from: existing.status,
          to: dto.status,
          reason: dto.reason,
        },
      },
    });
    return vehicle;
  });
}

export async function recordMaintenance(
  actorId: string,
  id: string,
  dto: RecordMaintenanceDto,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vehicle.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Vehicle not found');

    const vehicle = await tx.vehicle.update({
      where: { id },
      data: {
        lastMaintenanceAt: dto.performedAt ? new Date(dto.performedAt) : new Date(),
        ...(dto.fuelLevel !== undefined ? { fuelLevel: dto.fuelLevel } : {}),
        // Sortie de maintenance → repasse available
        status: existing.status === 'maintenance' ? 'available' : existing.status,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'vehicle',
        entityId: id,
        payload: {
          event: 'maintenance',
          notes: dto.notes,
          fuelLevel: dto.fuelLevel,
        },
      },
    });
    return vehicle;
  });
}

/** Enrolle un chauffeur + un PDA sur un vehicule (crew binding).
 *  Cree une nouvelle ligne VehicleEnrollment + cloture l'ancienne (endsAt = now).
 *  Met a jour le cache Vehicle.enrolled* + enrolledSince.
 *  Pattern : "le vehicule V1 a pour equipage Mamadou + PDA-001 depuis le 20/05/2026". */
export async function enrollVehicle(
  actorId: string,
  id: string,
  dto: EnrollVehicleDto,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vehicle.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Vehicle not found');

    if (dto.driverId) {
      const driver = await tx.user.findUnique({ where: { id: dto.driverId } });
      if (!driver || driver.role !== 'driver') {
        throw new NotFoundError('Driver not found or not a driver');
      }
    }
    if (dto.pdaId) {
      const pda = await tx.pda.findUnique({ where: { id: dto.pdaId } });
      if (!pda) throw new NotFoundError('PDA not found');
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    const isClearing = !dto.driverId && !dto.pdaId;

    // Cloture l'enrollement actif precedent (endsAt IS NULL)
    await tx.vehicleEnrollment.updateMany({
      where: { vehicleId: id, endsAt: null },
      data: { endsAt: startsAt },
    });

    // Cree la nouvelle ligne d'historique
    if (!isClearing) {
      await tx.vehicleEnrollment.create({
        data: {
          vehicleId: id,
          driverId: dto.driverId,
          pdaId: dto.pdaId,
          startsAt,
          endsAt,
          notes: dto.notes,
          createdById: actorId,
        },
      });
    }

    // Met a jour le cache courant (denormalise pour lookup rapide)
    const isActiveNow = !endsAt || endsAt > new Date();
    const vehicle = await tx.vehicle.update({
      where: { id },
      data: {
        enrolledDriverId: isActiveNow ? dto.driverId : null,
        enrolledPdaId: isActiveNow ? dto.pdaId : null,
        enrolledSince: isActiveNow && (dto.driverId || dto.pdaId) ? startsAt : null,
      },
      include: ENROLLMENT_INCLUDE,
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'vehicle',
        entityId: id,
        payload: {
          event: 'enroll',
          driverId: dto.driverId,
          pdaId: dto.pdaId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt?.toISOString() ?? null,
        },
      },
    });
    return vehicle;
  });
}

/** Historique des enrollements d'un vehicule, du plus recent au plus ancien. */
export async function getVehicleEnrollmentHistory(vehicleId: string) {
  const items = await prisma.vehicleEnrollment.findMany({
    where: { vehicleId },
    include: {
      driver: { select: { id: true, firstName: true, lastName: true } },
      pda: { select: { id: true, reference: true } },
    },
    orderBy: [{ endsAt: { sort: 'asc', nulls: 'first' } }, { startsAt: 'desc' }],
  });
  return { items, count: items.length };
}

/** Vue d'ensemble flotte — pour bandeau dashboard. */
export async function getFleetOverview() {
  const [byStatus, capacity] = await prisma.$transaction([
    prisma.vehicle.groupBy({
      by: ['status'],
      _count: true,
      orderBy: { status: 'asc' },
    }),
    prisma.vehicle.aggregate({
      _sum: { capacityKg: true },
      _avg: { fuelLevel: true },
      _count: true,
    }),
  ]);

  return {
    total: capacity._count,
    totalCapacityKg: capacity._sum.capacityKg ?? 0,
    avgFuelLevel: Math.round(capacity._avg.fuelLevel ?? 0),
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
  };
}
