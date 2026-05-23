import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors.js';
import * as notif from '../notifications/notifications.service.js';
import {
  generateBonCollecteAndEmail,
  generateBonCommandeAndEmail,
  generateBonLivraisonAndEmail,
  generateBordereauTriage,
} from '../documents/documents.generator.js';
import { broadcastOrderEvent, broadcastRoundEvent } from '../../realtime/emitter.js';
import type {
  CollectOrderDto,
  ConfirmOrderDto,
  CreateOrderDto,
  DeliverOrderDto,
  MarkOrderReadyDto,
  ReceiveOrderDto,
  ScheduleDeliveryDto,
  StartDeliveryDto,
  UpdateOrderDto,
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

function generateOrderNumber(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `CMD-${yyyy}-${seq}`;
}

/**
 * Calcule le poids estimé total (grammes) à partir des items déclarés et
 * du catalogue `LinenType` (champ `averageWeight`).
 *
 * Pas de fallback codé : si un `type` n'existe pas en DB, on jette une 400 —
 * l'admin doit ajouter le type dans le catalogue.
 */
async function estimateWeight(
  items: CreateOrderDto['estimatedItems'],
): Promise<number> {
  const codes = Array.from(new Set(items.map((it) => it.type)));
  const linenTypes = await prisma.linenType.findMany({
    where: { code: { in: codes } },
    select: { code: true, averageWeight: true },
  });
  const byCode = new Map(linenTypes.map((lt) => [lt.code, lt.averageWeight]));

  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new BadRequestError(
      `Unknown linen types: ${missing.join(', ')}. Add them in the catalogue first.`,
    );
  }

  return items.reduce(
    (sum, it) => sum + (byCode.get(it.type) ?? 0) * it.quantity,
    0,
  );
}

/* ════════════ CRÉATION ════════════ */

export async function createOrder(
  clientId: string,
  actorUserId: string,
  dto: CreateOrderDto,
) {
  const estimatedWeight = await estimateWeight(dto.estimatedItems);

  const order = await prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundError('Client not found');

    // Fallback : si le client n'envoie pas de géoloc, on prend celle de son hôtel.
    const pickupGeoLat = dto.pickupGeoLat ?? client.geoLat ?? null;
    const pickupGeoLng = dto.pickupGeoLng ?? client.geoLng ?? null;

    const created = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        clientId,
        estimatedItems: dto.estimatedItems as unknown as Prisma.InputJsonValue,
        estimatedWeight,
        collectionDate: new Date(dto.collectionDate),
        instructions: dto.instructions,
        pickupGeoLat,
        pickupGeoLng,
        status: 'pending',
        workflowState: 'COLLECTE_SCHEDULED',
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'create',
        entity: 'order',
        entityId: created.id,
        payload: { orderNumber: created.orderNumber, estimatedWeight },
      },
    });

    return created;
  });

  broadcastOrderEvent('order:created', {
    at: new Date().toISOString(),
    actorId: actorUserId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    clientId: order.clientId,
    status: order.status,
    workflowState: order.workflowState,
  });

  // Génère Bon de Commande PDF + email (non-bloquant).
  void generateBonCommandeAndEmail(order.id).catch((err) =>
    logger.warn({ err, orderId: order.id }, 'BC generation failed (non-blocking)'),
  );

  return order;
}

/* ════════════ ÉDITION (client, AVANT collecte) ════════════ */

const EDITABLE_STATUSES = ['pending', 'confirmed', 'collection_planned'] as const;

export async function updateOrder(
  orderId: string,
  actorUserId: string,
  dto: UpdateOrderDto,
  scopeClientId?: string,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');

    // Scope client : un hôtel ne peut éditer que ses propres commandes
    if (scopeClientId && order.clientId !== scopeClientId) {
      throw new ForbiddenError('You can only edit your own orders');
    }

    // États autorisés : strictement avant collecte
    if (
      !EDITABLE_STATUSES.includes(
        order.status as (typeof EDITABLE_STATUSES)[number],
      )
    ) {
      throw new BadRequestError(
        `Cannot edit order in status ${order.status} (already collected or beyond)`,
      );
    }

    if (order.version !== dto.expectedVersion) {
      throw new ConflictError('Order modified concurrently');
    }

    const data: Prisma.OrderUpdateInput = {
      version: { increment: 1 },
    };
    if (dto.estimatedItems) {
      data.estimatedItems = dto.estimatedItems as unknown as Prisma.InputJsonValue;
      data.estimatedWeight = await estimateWeight(dto.estimatedItems);
    }
    if (dto.collectionDate) {
      data.collectionDate = new Date(dto.collectionDate);
    }
    if (dto.instructions !== undefined) {
      data.instructions = dto.instructions || null;
    }
    if (dto.pickupGeoLat !== undefined) {
      data.pickupGeoLat = dto.pickupGeoLat;
    }
    if (dto.pickupGeoLng !== undefined) {
      data.pickupGeoLng = dto.pickupGeoLng;
    }

    const result = await tx.order.update({ where: { id: orderId }, data });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'update',
        entity: 'order',
        entityId: orderId,
        payload: {
          event: 'client_edit',
          changes: {
            estimatedItems: dto.estimatedItems !== undefined,
            collectionDate: dto.collectionDate ?? null,
            instructions: dto.instructions ?? null,
          },
        },
      },
    });

    return result;
  });

  broadcastOrderEvent('order:updated', {
    at: new Date().toISOString(),
    actorId: actorUserId,
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    clientId: updated.clientId,
    status: updated.status,
    workflowState: updated.workflowState,
  });

  return updated;
}

/* ════════════ LISTING (paginé) ════════════ */

export async function listOrders(opts: {
  clientId?: string;
  status?: string;
  statusIn?: string[];
  page: number;
  pageSize: number;
  search?: string;
  scopeClientId?: string; // si user.role = 'hotel', restreint à son client
  dateFrom?: Date;
  dateTo?: Date;
  dateField?: 'createdAt' | 'updatedAt' | 'collectionDate';
}) {
  const dateField = opts.dateField ?? 'updatedAt';
  const dateFilter =
    opts.dateFrom || opts.dateTo
      ? {
          [dateField]: {
            ...(opts.dateFrom ? { gte: opts.dateFrom } : {}),
            ...(opts.dateTo ? { lt: opts.dateTo } : {}),
          },
        }
      : {};

  // Status logic : `status` (single) prime sur `statusIn` (multiple) si fourni.
  const statusFilter = opts.status
    ? { status: opts.status as Prisma.EnumOrderStatusFilter }
    : opts.statusIn && opts.statusIn.length > 0
      ? { status: { in: opts.statusIn as never[] } }
      : {};

  const where: Prisma.OrderWhereInput = {
    ...(opts.scopeClientId ? { clientId: opts.scopeClientId } : {}),
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
    ...statusFilter,
    ...dateFilter,
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
      collectionDriver: {
        select: { id: true, firstName: true, lastName: true, phone: true, email: true },
      },
      deliveryDriver: {
        select: { id: true, firstName: true, lastName: true, phone: true, email: true },
      },
      collectionVehicle: {
        select: { id: true, matricule: true, brand: true, model: true },
      },
      deliveryVehicle: {
        select: { id: true, matricule: true, brand: true, model: true },
      },
      collectionPda: {
        select: { id: true, reference: true, brand: true, model: true, batteryLevel: true },
      },
      deliveryPda: {
        select: { id: true, reference: true, brand: true, model: true, batteryLevel: true },
      },
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
  const result = await prisma.$transaction(async (tx) => {
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
        driverItems: dto.driverItems
          ? (dto.driverItems as unknown as Prisma.InputJsonValue)
          : undefined,
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

    let completedRound: {
      id: string;
      number: string;
      vehicleId: string;
      driverId: string | null;
    } | null = null;

    // Auto-completion de la tournée si toutes les commandes du round sont collectées.
    if (order.collectionRoundId) {
      const remaining = await tx.order.count({
        where: {
          collectionRoundId: order.collectionRoundId,
          collectedAt: null,
        },
      });
      if (remaining === 0) {
        // Toutes les commandes du round sont collectées → round terminé
        const round = await tx.collectionRound.update({
          where: { id: order.collectionRoundId },
          data: { status: 'completed', completedAt: new Date() },
          include: { vehicle: { select: { enrolledDriverId: true } } },
        });
        completedRound = {
          id: round.id,
          number: round.number,
          vehicleId: round.vehicleId,
          driverId: round.vehicle?.enrolledDriverId ?? driverUserId,
        };
        // Libère ressources : PDA → available, chauffeur → available
        if (order.collectionPdaId) {
          await tx.pda.update({
            where: { id: order.collectionPdaId },
            data: { status: 'available' },
          });
        }
        await tx.user.update({
          where: { id: driverUserId },
          data: { driverStatus: 'available' },
        });
      }
    } else {
      // Collecte standalone (sans tournée) : libère le PDA immédiatement.
      if (order.collectionPdaId) {
        await tx.pda.update({
          where: { id: order.collectionPdaId },
          data: { status: 'available' },
        });
      }
    }

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

    return { updated, completedRound };
  });

  const { updated, completedRound } = result;

  broadcastOrderEvent('order:collected', {
    at: new Date().toISOString(),
    actorId: driverUserId,
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    clientId: updated.clientId,
    status: updated.status,
    workflowState: updated.workflowState,
  });

  if (completedRound) {
    broadcastRoundEvent('round:completed', {
      at: new Date().toISOString(),
      actorId: driverUserId,
      roundId: completedRound.id,
      number: completedRound.number,
      status: 'completed',
      vehicleId: completedRound.vehicleId,
      driverId: completedRound.driverId,
    });
  }

  // Génère Bon de Collecte PDF + email client (non-bloquant).
  void generateBonCollecteAndEmail(updated.id).catch((err) =>
    logger.warn({ err, orderId: updated.id }, 'BCol generation failed (non-blocking)'),
  );

  return updated;
}

/* ════════════ RECEIVE (atelier - pesée officielle) ════════════ */

export async function receiveOrder(
  orderId: string,
  receptionistUserId: string,
  dto: ReceiveOrderDto,
) {
  const updated = await prisma.$transaction(async (tx) => {
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
        receivedItems: dto.receivedItems
          ? (dto.receivedItems as unknown as Prisma.InputJsonValue)
          : undefined,
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

  broadcastOrderEvent('order:received', {
    at: new Date().toISOString(),
    actorId: receptionistUserId,
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    clientId: updated.clientId,
    status: updated.status,
    workflowState: updated.workflowState,
  });
  return updated;
}

/* ════════════ CANCEL ════════════ */

export async function cancelOrder(
  orderId: string,
  actorUserId: string,
  reason: string,
  expectedVersion: number,
) {
  const updated = await prisma.$transaction(async (tx) => {
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

  broadcastOrderEvent('order:cancelled', {
    at: new Date().toISOString(),
    actorId: actorUserId,
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    clientId: updated.clientId,
    status: updated.status,
    workflowState: updated.workflowState,
  });
  return updated;
}

/* ════════════ CONFIRM (admin/manager confirme une commande hôtel pending) ════════════ */

export async function confirmOrder(
  orderId: string,
  actorUserId: string,
  dto: ConfirmOrderDto,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');
    if (order.version !== dto.expectedVersion) {
      throw new ConflictError('Order modified concurrently');
    }
    // Affectation modifiable tant que la collecte n'a pas eu lieu.
    // Permet la replanification (changer chauffeur/vehicule/creneau).
    const EDITABLE = ['pending', 'confirmed', 'collection_planned'] as const;
    if (!EDITABLE.includes(order.status as (typeof EDITABLE)[number])) {
      throw new BadRequestError(
        `Cannot reassign order in status ${order.status} (deja collectee ou au-dela)`,
      );
    }

    // Resout l'equipage depuis l'enrollement du vehicule :
    // si la requete envoie un vehicleId mais pas driver/pda, on les derive
    // de Vehicle.enrolledDriver/Pda. Permet le pattern "affecter par vehicule"
    // sans devoir choisir chaque ressource manuellement.
    let resolvedDriverId = dto.collectionDriverId ?? null;
    let resolvedPdaId = dto.collectionPdaId ?? null;

    if (dto.collectionVehicleId) {
      const vehicle = await tx.vehicle.findUnique({
        where: { id: dto.collectionVehicleId },
        select: { id: true, enrolledDriverId: true, enrolledPdaId: true },
      });
      if (!vehicle) throw new BadRequestError('collectionVehicleId not found');
      if (!resolvedDriverId && vehicle.enrolledDriverId) {
        resolvedDriverId = vehicle.enrolledDriverId;
      }
      if (!resolvedPdaId && vehicle.enrolledPdaId) {
        resolvedPdaId = vehicle.enrolledPdaId;
      }
    }

    if (resolvedDriverId) {
      const driver = await tx.user.findUnique({ where: { id: resolvedDriverId } });
      if (!driver || driver.role !== 'driver') {
        throw new BadRequestError('Resolved driver must reference a driver user');
      }
    }
    if (resolvedPdaId) {
      const pda = await tx.pda.findUnique({ where: { id: resolvedPdaId } });
      if (!pda) throw new BadRequestError('Resolved PDA not found');
    }

    const planned = dto.collectionPlannedAt
      ? new Date(dto.collectionPlannedAt)
      : order.collectionDate;

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: resolvedDriverId ? 'collection_planned' : 'confirmed',
        collectionPlannedAt: planned,
        collectionDriverId: resolvedDriverId,
        collectionVehicleId: dto.collectionVehicleId ?? null,
        collectionPdaId: resolvedPdaId,
        version: { increment: 1 },
      },
    });

    // Libere les ressources de l'affectation precedente si elles changent.
    // (Sinon un PDA reste bloque en "in_use" apres reaffectation.)
    if (order.collectionPdaId && order.collectionPdaId !== resolvedPdaId) {
      await tx.pda.update({
        where: { id: order.collectionPdaId },
        data: { status: 'available' },
      });
    }
    if (order.collectionDriverId && order.collectionDriverId !== resolvedDriverId) {
      await tx.user.update({
        where: { id: order.collectionDriverId },
        data: { driverStatus: 'available' },
      });
    }

    if (resolvedPdaId) {
      await tx.pda.update({
        where: { id: resolvedPdaId },
        data: { status: 'in_use' },
      });
    }
    if (resolvedDriverId) {
      await tx.user.update({
        where: { id: resolvedDriverId },
        data: { driverStatus: 'on_route' },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'update',
        entity: 'order',
        entityId: orderId,
        payload: {
          event: 'confirm',
          collectionPlannedAt: planned,
          driverId: resolvedDriverId,
          vehicleId: dto.collectionVehicleId ?? null,
          pdaId: resolvedPdaId,
        },
      },
    });

    await notif.notifyClientUsers(
      order.clientId,
      'Commande confirmée',
      `Votre commande ${order.orderNumber} a été confirmée. Collecte prévue le ${planned.toLocaleDateString('fr-FR')}.`,
      { orderId, orderNumber: order.orderNumber, event: 'confirmed' },
      tx,
    );

    return updated;
  });

  broadcastOrderEvent('order:confirmed', {
    at: new Date().toISOString(),
    actorId: actorUserId,
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    clientId: updated.clientId,
    status: updated.status,
    workflowState: updated.workflowState,
    collectionPlannedAt: updated.collectionPlannedAt?.toISOString() ?? null,
    collectionDriverId: updated.collectionDriverId ?? null,
  });
  // Event dédié si une collecte concrète vient d'être planifiée
  // (driver + créneau). Permet au mobile de différencier de "commande confirmée".
  if (updated.collectionDriverId) {
    broadcastOrderEvent('order:collection_scheduled', {
      at: new Date().toISOString(),
      actorId: actorUserId,
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      clientId: updated.clientId,
      status: updated.status,
      workflowState: updated.workflowState,
      collectionPlannedAt: updated.collectionPlannedAt?.toISOString() ?? null,
      collectionDriverId: updated.collectionDriverId,
    });
  }
  return updated;
}

/* ════════════ MARK READY (sortie production → prêt à livrer) ════════════ */

const PRODUCTION_DONE_STATES = [
  'FINITION_COMPLETED',
  'REPASSAGE_COMPLETED',
  'CALANDRAGE_COMPLETED',
  'SECHAGE_COMPLETED',
] as const;

export async function markOrderReady(
  orderId: string,
  actorUserId: string,
  dto: MarkOrderReadyDto,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');
    if (order.version !== dto.expectedVersion) {
      throw new ConflictError('Order modified concurrently');
    }
    const allowed = (PRODUCTION_DONE_STATES as readonly string[]).includes(
      order.workflowState,
    );
    if (!allowed) {
      throw new BadRequestError(
        `Cannot mark ready from state ${order.workflowState}`,
      );
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        readyAt: new Date(),
        status: 'ready',
        workflowState: 'LIVRAISON_SCHEDULED',
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'update',
        entity: 'order',
        entityId: orderId,
        payload: { event: 'mark_ready', notes: dto.notes },
      },
    });

    await notif.notifyClientUsers(
      order.clientId,
      'Votre commande est prête',
      `La commande ${order.orderNumber} est prête. Une livraison vous sera planifiée.`,
      { orderId, orderNumber: order.orderNumber, event: 'ready' },
      tx,
    );

    return updated;
  });

  broadcastOrderEvent('order:ready', {
    at: new Date().toISOString(),
    actorId: actorUserId,
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    clientId: updated.clientId,
    status: updated.status,
    workflowState: updated.workflowState,
  });
  return updated;
}

/* ════════════ SCHEDULE DELIVERY (admin/manager assigne chauffeur + créneau) ════════════ */

export async function scheduleDelivery(
  orderId: string,
  actorUserId: string,
  dto: ScheduleDeliveryDto,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');
    if (order.version !== dto.expectedVersion) {
      throw new ConflictError('Order modified concurrently');
    }
    // États autorisés : la commande doit être prête (finition terminée) ou
    // déjà programmée (re-planification autorisée).
    const allowed = ['FINITION_COMPLETED', 'LIVRAISON_SCHEDULED'] as const;
    if (!allowed.includes(order.workflowState as typeof allowed[number])) {
      throw new BadRequestError(
        `Cannot schedule delivery from state ${order.workflowState}`,
      );
    }

    // Resolution equipage : si vehicleId est fourni sans driver/pda, on derive
    // depuis Vehicle.enrolledDriver/Pda.
    let resolvedDriverId: string | null = dto.driverId ?? null;
    let resolvedPdaId: string | null = dto.pdaId ?? null;

    if (dto.vehicleId) {
      const vehicle = await tx.vehicle.findUnique({
        where: { id: dto.vehicleId },
        select: { id: true, enrolledDriverId: true, enrolledPdaId: true },
      });
      if (!vehicle) throw new BadRequestError('vehicleId not found');
      if (!resolvedDriverId && vehicle.enrolledDriverId) {
        resolvedDriverId = vehicle.enrolledDriverId;
      }
      if (!resolvedPdaId && vehicle.enrolledPdaId) {
        resolvedPdaId = vehicle.enrolledPdaId;
      }
    }

    if (!resolvedDriverId) {
      throw new BadRequestError(
        'No driver resolvable : provide driverId or enroll a driver on the vehicle',
      );
    }
    const driver = await tx.user.findUnique({ where: { id: resolvedDriverId } });
    if (!driver || driver.role !== 'driver') {
      throw new BadRequestError('Resolved driver must reference a driver user');
    }
    if (resolvedPdaId) {
      const pda = await tx.pda.findUnique({ where: { id: resolvedPdaId } });
      if (!pda) throw new BadRequestError('Resolved PDA not found');
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        deliveryDriverId: resolvedDriverId,
        deliveryVehicleId: dto.vehicleId ?? null,
        deliveryPdaId: resolvedPdaId,
        collectionPlannedAt: new Date(dto.plannedAt),
        workflowState: 'LIVRAISON_SCHEDULED',
        version: { increment: 1 },
      },
    });

    if (resolvedPdaId) {
      await tx.pda.update({
        where: { id: resolvedPdaId },
        data: { status: 'in_use' },
      });
    }
    await tx.user.update({
      where: { id: resolvedDriverId },
      data: { driverStatus: 'on_route' },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'update',
        entity: 'order',
        entityId: orderId,
        payload: {
          event: 'schedule_delivery',
          driverId: resolvedDriverId,
          vehicleId: dto.vehicleId ?? null,
          pdaId: resolvedPdaId,
          plannedAt: dto.plannedAt,
        },
      },
    });

    const plannedDate = new Date(dto.plannedAt);
    await notif.notifyClientUsers(
      order.clientId,
      'Livraison planifiée',
      `La livraison de votre commande ${order.orderNumber} est prévue le ${plannedDate.toLocaleDateString('fr-FR')} à ${plannedDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`,
      {
        orderId,
        orderNumber: order.orderNumber,
        event: 'delivery_scheduled',
        plannedAt: dto.plannedAt,
      },
      tx,
    );

    return updated;
  });

  // Event dédié à la planification livraison (distinct de order:ready qui marque
  // la fin de production). Permet au client d'avoir une notif claire.
  broadcastOrderEvent('order:delivery_scheduled', {
    at: new Date().toISOString(),
    actorId: actorUserId,
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    clientId: updated.clientId,
    status: updated.status,
    workflowState: updated.workflowState,
    plannedAt: dto.plannedAt,
  });
  return updated;
}

/* ════════════ START DELIVERY (driver part de l'atelier) ════════════ */

export async function startDelivery(
  orderId: string,
  driverUserId: string,
  dto: StartDeliveryDto,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');
    if (order.version !== dto.expectedVersion) {
      throw new ConflictError('Order modified concurrently');
    }
    if (order.workflowState !== 'LIVRAISON_SCHEDULED') {
      throw new BadRequestError(
        `Cannot start delivery from state ${order.workflowState}`,
      );
    }
    if (order.deliveryDriverId && order.deliveryDriverId !== driverUserId) {
      throw new ForbiddenError('Order assigned to another driver');
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        deliveryDriverId: driverUserId,
        workflowState: 'LIVRAISON_IN_PROGRESS',
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: driverUserId,
        action: 'update',
        entity: 'order',
        entityId: orderId,
        payload: { event: 'start_delivery' },
      },
    });

    return updated;
  });

  broadcastOrderEvent('order:ready', {
    at: new Date().toISOString(),
    actorId: driverUserId,
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    clientId: updated.clientId,
    status: updated.status,
    workflowState: updated.workflowState,
  });
  return updated;
}

/* ════════════ DELIVER (driver clôt + signature client) ════════════ */

export async function deliverOrder(
  orderId: string,
  driverUserId: string,
  dto: DeliverOrderDto,
) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Order not found');
    if (order.version !== dto.expectedVersion) {
      throw new ConflictError('Order modified concurrently');
    }
    const allowed: typeof order.workflowState[] = [
      'LIVRAISON_SCHEDULED',
      'LIVRAISON_IN_PROGRESS',
    ];
    if (!allowed.includes(order.workflowState)) {
      throw new BadRequestError(
        `Cannot complete delivery from state ${order.workflowState}`,
      );
    }
    if (order.deliveryDriverId && order.deliveryDriverId !== driverUserId) {
      throw new ForbiddenError('Order assigned to another driver');
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        deliveryDriverId: driverUserId,
        deliveryRecipientName: dto.recipientName,
        deliverySignatureUrl: dto.signatureUrl ?? null,
        deliveryPhotos: dto.deliveryPhotos,
        deliveredAt: new Date(),
        status: 'delivered',
        workflowState: 'LIVRAISON_COMPLETED',
        version: { increment: 1 },
      },
    });

    // Auto-completion de la tournée de livraison si toutes les commandes
    // sont livrées (mirror du même mécanisme côté collect).
    let completedRound: {
      id: string;
      number: string;
      vehicleId: string;
      driverId: string | null;
    } | null = null;

    if (order.deliveryRoundId) {
      const remaining = await tx.order.count({
        where: {
          deliveryRoundId: order.deliveryRoundId,
          deliveredAt: null,
        },
      });
      if (remaining === 0) {
        const updatedRound = await tx.collectionRound.update({
          where: { id: order.deliveryRoundId },
          data: { status: 'completed', completedAt: new Date() },
          include: { vehicle: { select: { enrolledDriverId: true } } },
        });
        completedRound = {
          id: updatedRound.id,
          number: updatedRound.number,
          vehicleId: updatedRound.vehicleId,
          driverId: updatedRound.vehicle?.enrolledDriverId ?? driverUserId,
        };
      }
    }

    // Libere les ressources : PDA -> available, chauffeur -> available.
    if (order.deliveryPdaId) {
      await tx.pda.update({
        where: { id: order.deliveryPdaId },
        data: { status: 'available' },
      });
    }
    await tx.user.update({
      where: { id: driverUserId },
      data: { driverStatus: 'available' },
    });

    await tx.auditLog.create({
      data: {
        actorId: driverUserId,
        action: 'update',
        entity: 'order',
        entityId: orderId,
        payload: {
          event: 'deliver',
          recipientName: dto.recipientName,
          photos: dto.deliveryPhotos.length,
        },
        ...(dto.geoLat && dto.geoLng ? { geoLat: dto.geoLat, geoLng: dto.geoLng } : {}),
      },
    });

    await notif.notifyClientUsers(
      order.clientId,
      'Commande livrée',
      `La commande ${order.orderNumber} a été livrée à ${dto.recipientName}.`,
      { orderId, orderNumber: order.orderNumber, event: 'delivered' },
      tx,
    );

    return { updated, completedRound };
  });

  const { updated, completedRound } = result;

  broadcastOrderEvent('order:delivered', {
    at: new Date().toISOString(),
    actorId: driverUserId,
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    clientId: updated.clientId,
    status: updated.status,
    workflowState: updated.workflowState,
  });

  if (completedRound) {
    broadcastRoundEvent('round:completed', {
      at: new Date().toISOString(),
      actorId: driverUserId,
      roundId: completedRound.id,
      number: completedRound.number,
      status: 'completed',
      vehicleId: completedRound.vehicleId,
      driverId: completedRound.driverId,
    });
  }

  // Génère Bon de Livraison PDF + email client (non-bloquant).
  void generateBonLivraisonAndEmail(updated.id).catch((err) =>
    logger.warn({ err, orderId: updated.id }, 'BL generation failed (non-blocking)'),
  );

  return updated;
}
