import { prisma } from '../../config/prisma.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../utils/errors.js';
import type { CreateTriageDto } from './triage.dto.js';

const DEVIATION_TOLERANCE = 0.05; // 5%

/**
 * Génère un préfixe de tag à partir du numéro de commande.
 * CMD-2026-141 → CMD-141
 */
function tagPrefix(orderNumber: string): string {
  const parts = orderNumber.split('-');
  return parts[0] + '-' + (parts[2] ?? parts[1] ?? '000');
}

/**
 * Triage atomique avec génération des ItemTags et calcul d'écart.
 * Tout est dans une seule transaction Prisma.
 */
export async function createTriage(
  orderId: string,
  actorUserId: string,
  dto: CreateTriageDto,
) {
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundError('Order not found');

      if (order.version !== dto.expectedOrderVersion) {
        throw new ConflictError('Order modified concurrently');
      }

      if (order.workflowState !== 'WEIGHING_COMPLETED') {
        throw new BadRequestError(
          `Cannot triage from state ${order.workflowState}`,
        );
      }

      const existing = await tx.triageRecord.findUnique({ where: { orderId } });
      if (existing) {
        throw new ConflictError('Triage already exists for this order');
      }

      const totalPieces = dto.items.reduce((s, it) => s + it.pieces, 0);
      const totalWeight = dto.items.reduce((s, it) => s + it.weight, 0);
      const baseRef = order.receivedWeight ?? 0;
      const deviation =
        baseRef > 0
          ? Math.round(((totalWeight - baseRef) / baseRef) * 1000) / 10
          : 0;

      if (
        Math.abs(deviation) > DEVIATION_TOLERANCE * 100 &&
        !dto.acceptDeviation
      ) {
        throw new BadRequestError(
          `Triage weight deviation ${deviation}% exceeds 5% tolerance`,
          { deviation, baseRef, triageWeight: totalWeight },
        );
      }

      // Vérifier que les linenTypes existent
      const linenTypeIds = [...new Set(dto.items.map((i) => i.linenTypeId))];
      const linenTypes = await tx.linenType.findMany({
        where: { id: { in: linenTypeIds } },
      });
      if (linenTypes.length !== linenTypeIds.length) {
        throw new BadRequestError('Some linen types not found');
      }
      const linenTypeMap = new Map(linenTypes.map((lt) => [lt.id, lt]));

      const triage = await tx.triageRecord.create({
        data: {
          orderId,
          totalPieces,
          totalWeight,
          deviationPct: deviation,
          performedBy: actorUserId,
          items: {
            create: dto.items.map((it) => ({
              linenTypeId: it.linenTypeId,
              pieces: it.pieces,
              weight: it.weight,
            })),
          },
        },
        include: { items: true },
      });

      // Génération des ItemTags : 1 tag par pièce
      const prefix = tagPrefix(order.orderNumber);
      let counter = 0;
      const tagsData = dto.items.flatMap((item) => {
        const linen = linenTypeMap.get(item.linenTypeId)!;
        const avgWeight = item.pieces > 0 ? Math.floor(item.weight / item.pieces) : 0;
        return Array.from({ length: item.pieces }, () => {
          counter += 1;
          return {
            tag: `${prefix}-${String(counter).padStart(3, '0')}`,
            orderId,
            linenTypeId: item.linenTypeId,
            weight: avgWeight || linen.averageWeight,
            state: 'triaged' as const,
          };
        });
      });

      await tx.itemTag.createMany({ data: tagsData });

      // Met à jour la commande
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'triaged',
          workflowState: 'TRIAGE_COMPLETED',
          triagedAt: new Date(),
          version: { increment: 1 },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          action: 'create',
          entity: 'triage',
          entityId: triage.id,
          payload: {
            orderId,
            totalPieces,
            totalWeight,
            deviation,
            tagsGenerated: counter,
          },
        },
      });

      return { triage, tagsCount: counter };
    },
    { isolationLevel: 'Serializable', timeout: 15000 },
  );
}

/**
 * Marque les étiquettes comme imprimées. Bloque la suite du workflow
 * tant que les étiquettes ne sont pas imprimées.
 */
export async function markLabelsPrinted(
  orderId: string,
  actorUserId: string,
  printerStation?: string,
) {
  return prisma.$transaction(async (tx) => {
    const triage = await tx.triageRecord.findUnique({ where: { orderId } });
    if (!triage) throw new NotFoundError('No triage record found for this order');
    if (triage.labelsPrinted) {
      throw new ConflictError('Labels already marked as printed');
    }

    const updated = await tx.triageRecord.update({
      where: { orderId },
      data: { labelsPrinted: true, labelsPrintedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'print',
        entity: 'triage',
        entityId: triage.id,
        payload: { orderId, printerStation },
      },
    });

    return updated;
  });
}

/** Liste des tags d'une commande (pour scanner station). */
export async function listOrderTags(orderId: string) {
  return prisma.itemTag.findMany({
    where: { orderId },
    include: { linenType: { select: { code: true, name: true, category: true } } },
    orderBy: { createdAt: 'asc' },
  });
}
