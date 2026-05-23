import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError } from '../../utils/errors.js';

export async function listTariffs(opts: {
  type?: string;
  isActive?: boolean;
  search?: string;
}) {
  const where: Prisma.TariffWhereInput = {
    ...(opts.type ? { type: opts.type as Prisma.EnumTariffTypeFilter } : {}),
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

  const items = await prisma.tariff.findMany({
    where,
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { items: true, clients: true } } },
  });
  return { items, count: items.length };
}

export async function getTariff(id: string) {
  const tariff = await prisma.tariff.findUnique({
    where: { id },
    include: { items: true, clients: { select: { id: true, name: true, type: true } } },
  });
  if (!tariff) throw new NotFoundError('Tariff not found');
  return tariff;
}

/**
 * Retourne le tarif applicable à un client donné.
 * - 1. Si le client a un `tariffId` assigné et que le tarif est actif → ce tarif.
 * - 2. Sinon → le tarif `isDefault = true` (forcément un seul).
 * - 3. Sinon → 404.
 */
export async function getApplicableTariff(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { tariffId: true },
  });
  if (!client) throw new NotFoundError('Client not found');

  if (client.tariffId) {
    const assigned = await prisma.tariff.findUnique({
      where: { id: client.tariffId },
      include: { items: true },
    });
    if (assigned && assigned.isActive) return assigned;
  }

  const defaultTariff = await prisma.tariff.findFirst({
    where: { isDefault: true, isActive: true },
    include: { items: true },
  });
  if (!defaultTariff) {
    throw new NotFoundError('No applicable tariff (no client assignment, no default)');
  }
  return defaultTariff;
}

type TariffInput = {
  code: string;
  name: string;
  type: 'standard' | 'premium' | 'forfait' | 'segment' | 'service';
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  validFrom: string;
  validUntil?: string;
  monthlyPriceFcfa?: number;
  monthlyKgLimit?: number;
  overagePerKgFcfa?: number;
  applicableClientTypes?: (
    | 'hotel_5_etoiles'
    | 'hotel_4_etoiles'
    | 'hotel_3_etoiles'
    | 'restaurant'
    | 'autre'
  )[];
  items?: {
    linenTypeCode: string;
    linenTypeName: string;
    pricePerKg?: number | null;
    pricePerPiece?: number | null;
    billingMode: 'weight' | 'piece';
  }[];
};

export async function createTariff(actorId: string, dto: TariffInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tariff.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictError('Tariff code already exists');

    // Si on crée un nouveau "default", retire l'ancien
    if (dto.isDefault) {
      await tx.tariff.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const tariff = await tx.tariff.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
        validFrom: new Date(dto.validFrom),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        monthlyPriceFcfa: dto.monthlyPriceFcfa,
        monthlyKgLimit: dto.monthlyKgLimit,
        overagePerKgFcfa: dto.overagePerKgFcfa,
        applicableClientTypes: dto.applicableClientTypes ?? [],
        items: dto.items
          ? {
              create: dto.items.map((it) => ({
                linenTypeCode: it.linenTypeCode,
                linenTypeName: it.linenTypeName,
                pricePerKg: it.pricePerKg ?? null,
                pricePerPiece: it.pricePerPiece ?? null,
                billingMode: it.billingMode,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'create',
        entity: 'tariff',
        entityId: tariff.id,
        payload: { code: tariff.code, type: tariff.type, itemCount: dto.items?.length ?? 0 },
      },
    });

    return tariff;
  });
}

export async function updateTariff(actorId: string, id: string, dto: Partial<TariffInput>) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tariff.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Tariff not found');

    if (dto.isDefault) {
      await tx.tariff.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    // Update items : delete + recreate (atomique)
    if (dto.items) {
      await tx.tariffItem.deleteMany({ where: { tariffId: id } });
    }

    const tariff = await tx.tariff.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        description: dto.description,
        isDefault: dto.isDefault,
        isActive: dto.isActive,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        monthlyPriceFcfa: dto.monthlyPriceFcfa,
        monthlyKgLimit: dto.monthlyKgLimit,
        overagePerKgFcfa: dto.overagePerKgFcfa,
        applicableClientTypes: dto.applicableClientTypes,
        items: dto.items
          ? {
              create: dto.items.map((it) => ({
                linenTypeCode: it.linenTypeCode,
                linenTypeName: it.linenTypeName,
                pricePerKg: it.pricePerKg ?? null,
                pricePerPiece: it.pricePerPiece ?? null,
                billingMode: it.billingMode,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'tariff',
        entityId: id,
        payload: { changes: 'tariff_update' },
      },
    });

    return tariff;
  });
}
