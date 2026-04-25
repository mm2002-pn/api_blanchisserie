import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors.js';
import type {
  CollectOrderDto,
  CreateOrderDto,
  ReceiveOrderDto,
} from './orders.dto.js';

/**
 * Service Orders.
 *
 * Toutes les transitions de statut sont protégées par :
 *  - Optimistic locking (champ `version` incrémenté à chaque write)
 *  - Vérification de transition (workflowState valide → suivant)
 *  - Audit log dans la même transaction
 *
 * Aucune mise à jour ne se fait en dehors d'une transaction.
 */

const POIDS_MOYENS_GR: Record<string, number> = {
  drap: 800,
  taie: 200,
  serviette: 400,
  nappe: 500,
  torchon: 100,
  rideau: 1500,
  couverture: 2000,
  housse: 1500,
  peignoir: 600,
  tapis: 3000,
  chemise: 200,
  jean: 700,
  pantalon: 500,
  tshirt: 150,
  jupe: 400,
  robe: 400,
  sweat: 400,
};

function generateOrderNumber(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `CMD-${yyyy}-${seq}`;
}

function estimateWeight(items: CreateOrderDto['estimatedItems']): number {
  return items.reduce((sum, it) => {
    const avg = POIDS_MOYENS_GR[it.type.toLowerCase()] ?? 500;
    return sum + avg * it.quantity;
  }, 0);
}

/* ════════════ CRÉATION ════════════ */

export async function createOrder(
  clientId: string,
  actorUserId: string,
  dto: CreateOrderDto,
) {
  const estimatedWeight = estimateWeight(dto.estimatedItems);

  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundError('Client not found');

    const order = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        clientId,
        estimatedItems: dto.estimatedItems as unknown as Prisma.InputJsonValue,
        estimatedWeight,
        collectionDate: new Date(dto.collectionDate),
        instructions: dto.instructions,
        status: 'pending',
        workflowState: 'COLLECTE_SCHEDULED',
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'create',
        entity: 'order',
        entityId: order.id,
        payload: { orderNumber: order.orderNumber, estimatedWeight },
      },
    });

    return order;
  });
}

/* ════════════ LISTING (paginé) ════════════ */

export async function listOrders(opts: {
  clientId?: string;
  status?: string;
  page: number;
  pageSize: number;
  search?: string;
  scopeClientId?: string; // si user.role = 'hotel', restreint à son client
}) {
  const where: Prisma.OrderWhereInput = {
    ...(opts.scopeClientId ? { clientId: opts.scopeClientId } : {}),
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
    ...(opts.status ? { status: opts.status as Prisma.EnumOrderStatusFilter } : {}),
    ...(opts.search
      ? {
          OR: [
            { orderNumber: { contains: opts.search, mode: 'insensitive' } },
            { client: { name: { contains: opts.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      orderBy: { createdAt: 'desc' },
      include: { client: { select: { id: true, name: true, type: true } } },
    }),
    prisma.order.count({ where }),
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

/* ════════════ DÉTAIL ════════════ */

export async function getOrder(id: string, scopeClientId?: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      client: true,
      triage: { include: { items: { include: { linenType: true } } } },
      itemTags: { take: 50, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!order) throw new NotFoundError('Order not found');
  if (scopeClientId && order.clientId !== scopeClientId) {
    throw new ForbiddenError('Order does not belong to your account');
  }
  return order;
}

/* ════════════ COLLECT (chauffeur scanne + pèse sur le terrain) ════════════ */

export async function collectOrder(
  orderId: string,
  driverUserId: string,
  dto: CollectOrderDto,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');

    // Optimistic locking
    if (order.version !== dto.expectedVersion) {
      throw new ConflictError(
        `Order modified concurrently (expected v${dto.expectedVersion}, got v${order.version})`,
      );
    }

    // Validation transition
    const allowed: typeof order.workflowState[] = [
      'COLLECTE_SCHEDULED',
      'COLLECTE_IN_PROGRESS',
    ];
    if (!allowed.includes(order.workflowState)) {
      throw new BadRequestError(
        `Cannot collect from state ${order.workflowState}`,
      );
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        driverWeight: dto.driverWeight,
        driverPieces: dto.driverPieces,
        visualEstimation: dto.visualEstimation,
        collectionPhotos: dto.collectionPhotos,
        collectionSignatureUrl: dto.signatureUrl,
        collectionRecipientName: dto.recipientName,
        collectionGeoLat: dto.geoLat,
        collectionGeoLng: dto.geoLng,
        collectionDriverId: driverUserId,
        collectedAt: new Date(),
        status: 'collected',
        workflowState: 'COLLECTE_COMPLETED',
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: driverUserId,
        action: 'weigh',
        entity: 'order',
        entityId: orderId,
        payload: {
          driverWeight: dto.driverWeight,
          driverPieces: dto.driverPieces,
          estimatedWeight: order.estimatedWeight,
        },
        ...(dto.geoLat && dto.geoLng ? { geoLat: dto.geoLat, geoLng: dto.geoLng } : {}),
      },
    });

    return updated;
  });
}

/* ════════════ RECEIVE (atelier - pesée officielle) ════════════ */

export async function receiveOrder(
  orderId: string,
  receptionistUserId: string,
  dto: ReceiveOrderDto,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');

    if (order.version !== dto.expectedVersion) {
      throw new ConflictError(
        `Order modified concurrently (expected v${dto.expectedVersion}, got v${order.version})`,
      );
    }

    if (order.workflowState !== 'COLLECTE_COMPLETED') {
      throw new BadRequestError(
        `Cannot receive from state ${order.workflowState}`,
      );
    }

    const baseRef = order.driverWeight ?? order.estimatedWeight ?? dto.receivedWeight;
    const deviation =
      baseRef > 0
        ? Math.round(((dto.receivedWeight - baseRef) / baseRef) * 1000) / 10
        : 0;

    if (Math.abs(deviation) > 30 && !dto.acceptDeviation) {
      throw new BadRequestError(
        `Weight deviation ${deviation}% exceeds 30% threshold (acceptDeviation=true required)`,
        { deviation, baseRef, receivedWeight: dto.receivedWeight },
      );
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        receivedWeight: dto.receivedWeight,
        receivedPieces: dto.receivedPieces,
        weightDeviation: deviation,
        receivedAt: new Date(),
        status: 'received',
        workflowState: 'WEIGHING_COMPLETED',
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: receptionistUserId,
        action: 'weigh',
        entity: 'order',
        entityId: orderId,
        payload: {
          receivedWeight: dto.receivedWeight,
          receivedPieces: dto.receivedPieces,
          deviation,
          acceptedManually: dto.acceptDeviation && Math.abs(deviation) > 30,
        },
      },
    });

    if (Math.abs(deviation) > 10) {
      logger.warn(
        { orderId, deviation, baseRef, receivedWeight: dto.receivedWeight },
        'Weight deviation > 10% on order reception',
      );
    }

    return updated;
  });
}

/* ════════════ CANCEL ════════════ */

export async function cancelOrder(
  orderId: string,
  actorUserId: string,
  reason: string,
  expectedVersion: number,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');
    if (order.version !== expectedVersion) {
      throw new ConflictError('Order modified concurrently');
    }
    const blockedStates: typeof order.workflowState[] = [
      'LIVRAISON_COMPLETED',
      'CANCELLED',
    ];
    if (blockedStates.includes(order.workflowState)) {
      throw new BadRequestError(`Cannot cancel from state ${order.workflowState}`);
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'cancelled',
        workflowState: 'CANCELLED',
        cancelReason: reason,
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'update',
        entity: 'order',
        entityId: orderId,
        payload: { event: 'cancel', reason },
      },
    });

    return updated;
  });
}
