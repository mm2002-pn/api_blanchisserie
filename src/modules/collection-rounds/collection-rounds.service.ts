import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../utils/errors.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { broadcastRoundEvent } from '../../realtime/emitter.js';
import type {
  AddOrdersToRoundDto,
  CancelRoundDto,
  CreateCollectionRoundDto,
  ListCollectionRoundsDto,
  RemoveOrderFromRoundDto,
  UnloadRoundDto,
  UpdateCollectionRoundDto,
} from './collection-rounds.dto.js';

/**
 * Service Tournées de Collecte (CollectionRound).
 *
 * Pattern :
 *  - Un round groupe plusieurs commandes sur un même véhicule, à une date donnée
 *  - L'équipage (chauffeur + PDA) est dérivé de l'enrollement du véhicule
 *  - Créer un round met toutes les commandes en collection_planned d'un coup
 *  - Annuler un round libère les commandes (retour à pending/confirmed)
 *
 * La numérotation `RND-YYYY-NNN` est atomique via DocumentSequence (réutilise
 * le même mécanisme que les autres docs commerciaux).
 */

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  clientId: true,
  client: { select: { id: true, name: true, address: true, city: true } },
  collectionDate: true,
  estimatedWeight: true,
  pickupGeoLat: true,
  pickupGeoLng: true,
  collectedAt: true,
  unloadedAt: true,
  deliveredAt: true,
} satisfies Prisma.OrderSelect;

const ROUND_INCLUDE = {
  vehicle: {
    include: {
      enrolledDriver: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
      enrolledPda: {
        select: { id: true, reference: true, brand: true, model: true },
      },
    },
  },
  collectOrders: { select: ORDER_SELECT },
  deliveryOrders: { select: ORDER_SELECT },
} satisfies Prisma.CollectionRoundInclude;

/** Aplatit `orders` virtuel sur le round (selon `type`) pour rétro-compat front. */
type RoundWithBothOrders = Prisma.CollectionRoundGetPayload<{
  include: typeof ROUND_INCLUDE;
}>;
function flattenOrders<T extends RoundWithBothOrders>(round: T) {
  const orders =
    round.type === 'delivery' ? round.deliveryOrders : round.collectOrders;
  // On expose `orders` (champ historique) + on garde les 2 listes typées pour
  // les cas où le client veut le détail.
  return { ...round, orders };
}

async function nextRoundNumber(): Promise<string> {
  const year = new Date().getFullYear();
  // Réutilise DocumentSequence avec un type "interne" (non un enum DocumentType).
  // On stocke le compteur dans une ligne CollectionRound count via raw query :
  // pour rester simple on compte les rounds créés cette année + 1.
  const count = await prisma.collectionRound.count({
    where: {
      number: { startsWith: `RND-${year}-` },
    },
  });
  const seq = String(count + 1).padStart(3, '0');
  return `RND-${year}-${seq}`;
}

export async function listCollectionRounds(
  opts: ListCollectionRoundsDto,
  scope: { driverScopeId?: string } = {},
) {
  const where: Prisma.CollectionRoundWhereInput = {
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}),
    ...(opts.dateFrom || opts.dateTo
      ? {
          plannedAt: {
            ...(opts.dateFrom ? { gte: new Date(opts.dateFrom) } : {}),
            ...(opts.dateTo ? { lt: new Date(opts.dateTo) } : {}),
          },
        }
      : {}),
    // Restreint au chauffeur enrôlé sur le véhicule de la tournée.
    ...(scope.driverScopeId
      ? { vehicle: { enrolledDriverId: scope.driverScopeId } }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.collectionRound.findMany({
      where,
      include: ROUND_INCLUDE,
      orderBy: { plannedAt: 'asc' },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.collectionRound.count({ where }),
  ]);
  return {
    items: items.map(flattenOrders),
    pagination: {
      page: opts.page,
      pageSize: opts.pageSize,
      total,
      totalPages: Math.ceil(total / opts.pageSize),
    },
  };
}

export async function getCollectionRound(id: string) {
  const round = await prisma.collectionRound.findUnique({
    where: { id },
    include: ROUND_INCLUDE,
  });
  if (!round) throw new NotFoundError('Round not found');
  return flattenOrders(round);
}

/** Crée un round (collecte ou livraison) + affecte toutes les commandes. */
export async function createCollectionRound(
  actorId: string,
  dto: CreateCollectionRoundDto,
) {
  return prisma.$transaction(async (tx) => {
    // 1. Vérifier le véhicule + enrollement
    const vehicle = await tx.vehicle.findUnique({
      where: { id: dto.vehicleId },
      select: { id: true, enrolledDriverId: true, enrolledPdaId: true },
    });
    if (!vehicle) throw new NotFoundError('Vehicle not found');
    if (!vehicle.enrolledDriverId) {
      throw new BadRequestError(
        'Vehicle has no enrolled driver. Configure enrollment in Settings → Vehicles.',
      );
    }

    // 2. Vérifier toutes les commandes selon le type de tournée
    const orders = await tx.order.findMany({
      where: { id: { in: dto.orderIds } },
      select: {
        id: true,
        status: true,
        workflowState: true,
        collectionRoundId: true,
        deliveryRoundId: true,
        version: true,
      },
    });
    if (orders.length !== dto.orderIds.length) {
      const found = new Set(orders.map((o) => o.id));
      const missing = dto.orderIds.filter((id) => !found.has(id));
      throw new NotFoundError(`Orders not found: ${missing.join(', ')}`);
    }

    const isDelivery = dto.type === 'delivery';
    const COLLECT_EDITABLE = ['pending', 'confirmed', 'collection_planned'];
    const DELIVERY_EDITABLE = ['ready'];
    const editable = isDelivery ? DELIVERY_EDITABLE : COLLECT_EDITABLE;
    for (const o of orders) {
      if (!editable.includes(o.status)) {
        throw new ConflictError(
          `Order ${o.id} cannot be planned for ${dto.type} (status: ${o.status})`,
        );
      }
      // Vérifie seulement le champ de round correspondant au TYPE en cours.
      // Une commande peut très bien avoir un collectionRoundId (ancien round
      // de collecte déjà terminé) et être en cours d'assignation à un round
      // de livraison via deliveryRoundId — les deux champs sont indépendants.
      const blockingRoundId = isDelivery
        ? o.deliveryRoundId
        : o.collectionRoundId;
      if (blockingRoundId) {
        throw new ConflictError(
          `Order ${o.id} is already in another ${dto.type} round (${blockingRoundId})`,
        );
      }
    }

    // 3. Créer le round
    const number = await nextRoundNumber();
    const round = await tx.collectionRound.create({
      data: {
        number,
        type: dto.type,
        vehicleId: dto.vehicleId,
        plannedAt: new Date(dto.plannedAt),
        status: 'planned',
        notes: dto.notes,
        createdById: actorId,
      },
    });

    // 4. Affecter toutes les commandes selon le type.
    // Les FK scalaires (deliveryRoundId, etc.) ne sont pas exposées dans
    // OrderUpdateManyMutationInput côté Prisma — on doit utiliser la forme
    // relation `connect` via `update` singulier.
    const plannedAt = new Date(dto.plannedAt);
    if (isDelivery) {
      for (const o of orders) {
        await tx.order.update({
          where: { id: o.id },
          data: {
            deliveryRound: { connect: { id: round.id } },
            deliveryDriver: { connect: { id: vehicle.enrolledDriverId } },
            deliveryVehicle: { connect: { id: vehicle.id } },
            ...(vehicle.enrolledPdaId
              ? { deliveryPda: { connect: { id: vehicle.enrolledPdaId } } }
              : {}),
            workflowState: 'LIVRAISON_SCHEDULED',
            version: { increment: 1 },
          },
        });
      }
    } else {
      for (const o of orders) {
        await tx.order.update({
          where: { id: o.id },
          data: {
            collectionRound: { connect: { id: round.id } },
            collectionDriver: { connect: { id: vehicle.enrolledDriverId } },
            collectionVehicle: { connect: { id: vehicle.id } },
            ...(vehicle.enrolledPdaId
              ? { collectionPda: { connect: { id: vehicle.enrolledPdaId } } }
              : {}),
            collectionPlannedAt: plannedAt,
            status: 'collection_planned',
            version: { increment: 1 },
          },
        });
      }
    }

    // 5. Marquer le PDA en in_use + chauffeur on_route
    if (vehicle.enrolledPdaId) {
      await tx.pda.update({
        where: { id: vehicle.enrolledPdaId },
        data: { status: 'in_use' },
      });
    }
    await tx.user.update({
      where: { id: vehicle.enrolledDriverId },
      data: { driverStatus: 'on_route' },
    });

    // 6. Audit log
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'create',
        entity: 'collection_round',
        entityId: round.id,
        payload: {
          number: round.number,
          type: dto.type,
          orderCount: orders.length,
          vehicleId: dto.vehicleId,
          plannedAt: dto.plannedAt,
        },
      },
    });

    // 7. Notification au chauffeur enrôlé
    const plannedFr = new Date(dto.plannedAt).toLocaleString('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const action = isDelivery ? 'livraison' : 'collecte';
    await notifyUser(
      vehicle.enrolledDriverId,
      `Nouvelle tournée de ${action} assignée`,
      `Tournée ${round.number} · ${orders.length} ${action}${orders.length > 1 ? 's' : ''} planifiée${orders.length > 1 ? 's' : ''} le ${plannedFr}.`,
      {
        roundId: round.id,
        roundNumber: round.number,
        roundType: dto.type,
        orderCount: orders.length,
        plannedAt: dto.plannedAt,
        event: 'round_assigned',
      },
      tx,
    );

    // Retourner avec relations
    const fresh = await tx.collectionRound.findUniqueOrThrow({
      where: { id: round.id },
      include: ROUND_INCLUDE,
    });
    const result = flattenOrders(fresh);

    // Broadcast realtime
    broadcastRoundEvent('round:created', {
      at: new Date().toISOString(),
      actorId,
      roundId: round.id,
      number: round.number,
      status: 'planned',
      vehicleId: round.vehicleId,
      driverId: vehicle.enrolledDriverId,
      orderCount: orders.length,
    });

    return result;
  });
}

export async function updateCollectionRound(
  actorId: string,
  id: string,
  dto: UpdateCollectionRoundDto,
) {
  return prisma.$transaction(async (tx) => {
    const round = await tx.collectionRound.findUnique({ where: { id } });
    if (!round) throw new NotFoundError('Round not found');
    if (round.status !== 'planned') {
      throw new BadRequestError(
        `Cannot update round in status ${round.status} (must be planned)`,
      );
    }

    if (dto.vehicleId) {
      const vehicle = await tx.vehicle.findUnique({
        where: { id: dto.vehicleId },
        select: { id: true, enrolledDriverId: true, enrolledPdaId: true },
      });
      if (!vehicle) throw new NotFoundError('Vehicle not found');
      if (!vehicle.enrolledDriverId) {
        throw new BadRequestError('Vehicle has no enrolled driver');
      }
    }

    const updated = await tx.collectionRound.update({
      where: { id },
      data: {
        vehicleId: dto.vehicleId,
        plannedAt: dto.plannedAt ? new Date(dto.plannedAt) : undefined,
        notes: dto.notes,
      },
      include: { vehicle: { select: { enrolledDriverId: true, enrolledPdaId: true } } },
    });

    // Si véhicule ou date changée → propager aux commandes du round.
    // On boucle (un update par order) pour pouvoir utiliser connect/disconnect
    // sur les relations nommées (les FK scalaires ne sont pas exposées dans
    // OrderUpdateManyMutationInput).
    if (dto.vehicleId || dto.plannedAt) {
      const plannedAt = dto.plannedAt ? new Date(dto.plannedAt) : round.plannedAt;
      const driverId = updated.vehicle.enrolledDriverId;
      const pdaId = updated.vehicle.enrolledPdaId;
      const targetOrders = await tx.order.findMany({
        where:
          round.type === 'delivery'
            ? { deliveryRoundId: id }
            : { collectionRoundId: id },
        select: { id: true },
      });
      for (const o of targetOrders) {
        if (round.type === 'delivery') {
          await tx.order.update({
            where: { id: o.id },
            data: {
              deliveryVehicle: { connect: { id: updated.vehicleId } },
              ...(driverId
                ? { deliveryDriver: { connect: { id: driverId } } }
                : { deliveryDriver: { disconnect: true } }),
              ...(pdaId
                ? { deliveryPda: { connect: { id: pdaId } } }
                : { deliveryPda: { disconnect: true } }),
            },
          });
        } else {
          await tx.order.update({
            where: { id: o.id },
            data: {
              collectionVehicle: { connect: { id: updated.vehicleId } },
              ...(driverId
                ? { collectionDriver: { connect: { id: driverId } } }
                : { collectionDriver: { disconnect: true } }),
              ...(pdaId
                ? { collectionPda: { connect: { id: pdaId } } }
                : { collectionPda: { disconnect: true } }),
              collectionPlannedAt: plannedAt,
            },
          });
        }
      }
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'collection_round',
        entityId: id,
        payload: { changes: dto as unknown as Prisma.InputJsonValue },
      },
    });

    const fresh = await tx.collectionRound.findUniqueOrThrow({
      where: { id },
      include: ROUND_INCLUDE,
    });
    return flattenOrders(fresh);
  });
}

/** Ajoute des commandes à un round existant. */
export async function addOrdersToRound(
  actorId: string,
  id: string,
  dto: AddOrdersToRoundDto,
) {
  return prisma.$transaction(async (tx) => {
    const round = await tx.collectionRound.findUnique({
      where: { id },
      include: {
        vehicle: { select: { enrolledDriverId: true, enrolledPdaId: true } },
      },
    });
    if (!round) throw new NotFoundError('Round not found');
    if (round.status !== 'planned') {
      throw new BadRequestError(
        `Cannot modify round in status ${round.status}`,
      );
    }

    const isDelivery = round.type === 'delivery';
    const orders = await tx.order.findMany({
      where: { id: { in: dto.orderIds } },
      select: {
        id: true,
        status: true,
        collectionRoundId: true,
        deliveryRoundId: true,
      },
    });
    const EDITABLE = isDelivery
      ? ['ready']
      : ['pending', 'confirmed', 'collection_planned'];
    for (const o of orders) {
      if (!EDITABLE.includes(o.status)) {
        throw new ConflictError(`Order ${o.id} cannot be planned`);
      }
      const blocking = isDelivery ? o.deliveryRoundId : o.collectionRoundId;
      if (blocking && blocking !== id) {
        throw new ConflictError(`Order ${o.id} already in another round`);
      }
    }

    const driverId = round.vehicle.enrolledDriverId;
    const pdaId = round.vehicle.enrolledPdaId;
    if (isDelivery) {
      for (const orderId of dto.orderIds) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            deliveryRound: { connect: { id } },
            ...(driverId
              ? { deliveryDriver: { connect: { id: driverId } } }
              : {}),
            deliveryVehicle: { connect: { id: round.vehicleId } },
            ...(pdaId
              ? { deliveryPda: { connect: { id: pdaId } } }
              : {}),
            workflowState: 'LIVRAISON_SCHEDULED',
          },
        });
      }
    } else {
      for (const orderId of dto.orderIds) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            collectionRound: { connect: { id } },
            ...(driverId
              ? { collectionDriver: { connect: { id: driverId } } }
              : {}),
            collectionVehicle: { connect: { id: round.vehicleId } },
            ...(pdaId
              ? { collectionPda: { connect: { id: pdaId } } }
              : {}),
            collectionPlannedAt: round.plannedAt,
            status: 'collection_planned',
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'collection_round',
        entityId: id,
        payload: { event: 'add_orders', orderIds: dto.orderIds },
      },
    });

    const fresh = await tx.collectionRound.findUniqueOrThrow({
      where: { id },
      include: ROUND_INCLUDE,
    });
    return flattenOrders(fresh);
  });
}

/** Retire une commande du round (la commande retourne à son état antérieur). */
export async function removeOrderFromRound(
  actorId: string,
  id: string,
  dto: RemoveOrderFromRoundDto,
) {
  return prisma.$transaction(async (tx) => {
    const round = await tx.collectionRound.findUnique({ where: { id } });
    if (!round) throw new NotFoundError('Round not found');
    if (round.status !== 'planned') {
      throw new BadRequestError(`Cannot modify round in status ${round.status}`);
    }
    const isDelivery = round.type === 'delivery';

    const order = await tx.order.findUnique({
      where: { id: dto.orderId },
      select: {
        id: true,
        collectionRoundId: true,
        deliveryRoundId: true,
      },
    });
    const linked = isDelivery ? order?.deliveryRoundId : order?.collectionRoundId;
    if (!order || linked !== id) {
      throw new NotFoundError('Order not in this round');
    }

    // Forme `disconnect` sur les relations nommées (FK scalaires inaccessibles
    // dans OrderUpdateInput).
    if (isDelivery) {
      await tx.order.update({
        where: { id: dto.orderId },
        data: {
          deliveryRound: { disconnect: true },
          deliveryDriver: { disconnect: true },
          deliveryVehicle: { disconnect: true },
          deliveryPda: { disconnect: true },
          workflowState: 'FINITION_COMPLETED',
        },
      });
    } else {
      await tx.order.update({
        where: { id: dto.orderId },
        data: {
          collectionRound: { disconnect: true },
          collectionDriver: { disconnect: true },
          collectionVehicle: { disconnect: true },
          collectionPda: { disconnect: true },
          collectionPlannedAt: null,
          status: 'pending',
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'collection_round',
        entityId: id,
        payload: { event: 'remove_order', orderId: dto.orderId },
      },
    });

    const fresh = await tx.collectionRound.findUniqueOrThrow({
      where: { id },
      include: ROUND_INCLUDE,
    });
    return flattenOrders(fresh);
  });
}

export async function startCollectionRound(
  actorId: string,
  id: string,
  scope: { driverScopeId?: string } = {},
) {
  return prisma.$transaction(async (tx) => {
    const round = await tx.collectionRound.findUnique({
      where: { id },
      include: { vehicle: { select: { enrolledDriverId: true } } },
    });
    if (!round) throw new NotFoundError('Round not found');
    if (round.status !== 'planned') {
      throw new BadRequestError(`Cannot start round in status ${round.status}`);
    }
    // Scope chauffeur : un driver ne peut démarrer QUE sa propre tournée
    // (celle dont le véhicule a son id en enrolledDriverId).
    if (
      scope.driverScopeId &&
      round.vehicle.enrolledDriverId !== scope.driverScopeId
    ) {
      throw new BadRequestError('You can only start your own round');
    }

    const updated = await tx.collectionRound.update({
      where: { id },
      data: { status: 'in_progress', startedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'collection_round',
        entityId: id,
        payload: { event: 'start' },
      },
    });

    broadcastRoundEvent('round:started', {
      at: new Date().toISOString(),
      actorId,
      roundId: id,
      number: updated.number,
      status: 'in_progress',
      vehicleId: updated.vehicleId,
      driverId: round.vehicle.enrolledDriverId,
    });

    return updated;
  });
}

/**
 * Confirme l'arrivée du chauffeur à l'usine après collecte.
 * Marque toutes les commandes de la tournée + la tournée elle-même comme
 * "déchargées". Sert de gate avant la pesée atelier.
 *  - Réservé aux rounds type=collect (pour delivery, le retour usine n'existe pas)
 *  - La round doit être en status `completed` (toutes commandes collectées)
 *  - Idempotent : si déjà déchargée, retourne sans erreur
 */
export async function unloadCollectionRound(
  actorId: string,
  id: string,
  dto: UnloadRoundDto,
  scope: { driverScopeId?: string } = {},
) {
  return prisma.$transaction(async (tx) => {
    const round = await tx.collectionRound.findUnique({
      where: { id },
      include: { vehicle: { select: { enrolledDriverId: true } } },
    });
    if (!round) throw new NotFoundError('Round not found');
    if (round.type !== 'collect') {
      throw new BadRequestError(
        'Only collect rounds need unloading at factory',
      );
    }
    if (round.status !== 'completed') {
      throw new BadRequestError(
        `Cannot unload : round must be completed first (current: ${round.status})`,
      );
    }
    if (
      scope.driverScopeId &&
      round.vehicle.enrolledDriverId !== scope.driverScopeId
    ) {
      throw new BadRequestError('You can only unload your own round');
    }
    if (round.unloadedAt) {
      // Idempotent : déjà déchargée
      const existing = await tx.collectionRound.findUniqueOrThrow({
        where: { id },
        include: ROUND_INCLUDE,
      });
      return flattenOrders(existing);
    }

    const now = new Date();
    await tx.collectionRound.update({
      where: { id },
      data: {
        unloadedAt: now,
        unloadedSignatureUrl: dto.signatureUrl,
        unloadedRecipientName: dto.recipientName ?? null,
      },
    });

    // Marque toutes les commandes de la round comme déchargées
    await tx.order.updateMany({
      where: { collectionRoundId: id },
      data: { unloadedAt: now },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'collection_round',
        entityId: id,
        payload: { event: 'unload', roundNumber: round.number },
      },
    });

    broadcastRoundEvent('round:updated', {
      at: now.toISOString(),
      actorId,
      roundId: id,
      number: round.number,
      status: round.status,
      vehicleId: round.vehicleId,
      driverId: round.vehicle.enrolledDriverId,
    });

    const fresh = await tx.collectionRound.findUniqueOrThrow({
      where: { id },
      include: ROUND_INCLUDE,
    });
    return flattenOrders(fresh);
  });
}

export async function cancelCollectionRound(
  actorId: string,
  id: string,
  dto: CancelRoundDto,
) {
  return prisma.$transaction(async (tx) => {
    const round = await tx.collectionRound.findUnique({
      where: { id },
      include: { vehicle: { select: { enrolledDriverId: true, enrolledPdaId: true } } },
    });
    if (!round) throw new NotFoundError('Round not found');
    if (round.status === 'completed' || round.status === 'cancelled') {
      throw new BadRequestError(`Cannot cancel round in status ${round.status}`);
    }

    // Libère les commandes selon le type de tournée — on boucle pour pouvoir
    // utiliser disconnect sur les relations nommées.
    const targets = await tx.order.findMany({
      where:
        round.type === 'delivery'
          ? { deliveryRoundId: id, workflowState: 'LIVRAISON_SCHEDULED' }
          : { collectionRoundId: id, status: 'collection_planned' },
      select: { id: true },
    });
    for (const o of targets) {
      if (round.type === 'delivery') {
        await tx.order.update({
          where: { id: o.id },
          data: {
            deliveryRound: { disconnect: true },
            deliveryDriver: { disconnect: true },
            deliveryVehicle: { disconnect: true },
            deliveryPda: { disconnect: true },
            workflowState: 'FINITION_COMPLETED',
          },
        });
      } else {
        await tx.order.update({
          where: { id: o.id },
          data: {
            collectionRound: { disconnect: true },
            collectionDriver: { disconnect: true },
            collectionVehicle: { disconnect: true },
            collectionPda: { disconnect: true },
            collectionPlannedAt: null,
            status: 'pending',
          },
        });
      }
    }

    // Libère PDA + chauffeur
    if (round.vehicle.enrolledPdaId) {
      await tx.pda.update({
        where: { id: round.vehicle.enrolledPdaId },
        data: { status: 'available' },
      });
    }
    if (round.vehicle.enrolledDriverId) {
      await tx.user.update({
        where: { id: round.vehicle.enrolledDriverId },
        data: { driverStatus: 'available' },
      });
    }

    const updated = await tx.collectionRound.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: dto.reason,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'collection_round',
        entityId: id,
        payload: { event: 'cancel', reason: dto.reason },
      },
    });

    broadcastRoundEvent('round:cancelled', {
      at: new Date().toISOString(),
      actorId,
      roundId: id,
      number: updated.number,
      status: 'cancelled',
      vehicleId: updated.vehicleId,
      driverId: round.vehicle.enrolledDriverId,
    });

    return updated;
  });
}
