import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors.js';
import { broadcastTagEvent } from '../../realtime/emitter.js';
import type {
  BulkScanDto,
  ListTagsDto,
  ScanTagDto,
  TagState,
} from './tags.dto.js';

/**
 * Service de traçabilité ItemTag.
 *
 * Chaque scan :
 *  - vérifie la transition d'état autorisée
 *  - écrit un TagScan + met à jour ItemTag (state, currentBatchId, scannedAt)
 *  - audit log
 * Tout en transaction.
 */

/** Transitions autorisées par état courant. */
const ALLOWED_TRANSITIONS: Record<TagState, TagState[]> = {
  triaged: ['in_lavage', 'lost'],
  in_lavage: ['in_sechage', 'lost'],
  in_sechage: ['in_calandrage', 'in_repassage', 'in_finition', 'lost'],
  in_calandrage: ['in_finition', 'lost'],
  in_repassage: ['in_finition', 'lost'],
  in_finition: ['done', 'lost'],
  done: [],
  lost: [],
};

function assertTransition(from: TagState, to: TagState) {
  if (from === to) return; // re-scan idempotent
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(
      `Invalid transition ${from} → ${to} (allowed: ${ALLOWED_TRANSITIONS[from].join(', ') || 'none'})`,
    );
  }
}

/* ════════════ LISTING ════════════ */

export async function listTags(opts: ListTagsDto, scopeClientId?: string) {
  const where: Prisma.ItemTagWhereInput = {
    ...(opts.orderId ? { orderId: opts.orderId } : {}),
    ...(opts.state ? { state: opts.state } : {}),
    ...(opts.batchId ? { currentBatchId: opts.batchId } : {}),
    ...(opts.search ? { tag: { contains: opts.search, mode: 'insensitive' } } : {}),
    ...(scopeClientId ? { order: { clientId: scopeClientId } } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.itemTag.findMany({
      where,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      orderBy: { tag: 'asc' },
      include: {
        linenType: { select: { code: true, name: true, category: true } },
        order: { select: { orderNumber: true, clientId: true } },
      },
    }),
    prisma.itemTag.count({ where }),
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

export async function getTag(tagCode: string, scopeClientId?: string) {
  const tag = await prisma.itemTag.findUnique({
    where: { tag: tagCode },
    include: {
      order: { select: { id: true, orderNumber: true, clientId: true } },
      linenType: true,
      currentBatch: { select: { id: true, code: true, stage: true, status: true } },
      scans: {
        orderBy: { scannedAt: 'asc' },
      },
    },
  });
  if (!tag) throw new NotFoundError('Tag not found');
  if (scopeClientId && tag.order.clientId !== scopeClientId) {
    throw new ForbiddenError('Tag does not belong to your account');
  }
  return tag;
}

/* ════════════ SCAN UNITAIRE ════════════ */

export async function scanTag(
  tagCode: string,
  actorUserId: string,
  dto: ScanTagDto,
) {
  const result = await prisma.$transaction(async (tx) => {
    const tag = await tx.itemTag.findUnique({ where: { tag: tagCode } });
    if (!tag) throw new NotFoundError('Tag not found');

    const targetState: TagState = dto.nextState ?? (tag.state as TagState);
    assertTransition(tag.state as TagState, targetState);

    if (dto.batchId) {
      const batch = await tx.batch.findUnique({ where: { id: dto.batchId } });
      if (!batch) throw new BadRequestError('batchId not found');
    }

    const now = new Date();

    const scan = await tx.tagScan.create({
      data: {
        tagId: tag.id,
        station: dto.station,
        scannedBy: actorUserId,
        scannedAt: now,
        metadata: (dto.metadata ?? null) as Prisma.InputJsonValue,
      },
    });

    const updated = await tx.itemTag.update({
      where: { id: tag.id },
      data: {
        state: targetState,
        scannedAt: now,
        ...(dto.batchId ? { currentBatchId: dto.batchId } : {}),
        ...(targetState === 'done' ? { finishedAt: now } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'scan',
        entity: 'item_tag',
        entityId: tag.id,
        payload: {
          tag: tag.tag,
          station: dto.station,
          fromState: tag.state,
          toState: targetState,
          batchId: dto.batchId,
        },
        ...(dto.geoLat && dto.geoLng ? { geoLat: dto.geoLat, geoLng: dto.geoLng } : {}),
      },
    });

    return { tag: updated, scan, fromState: tag.state };
  });

  broadcastTagEvent('tag:scanned', {
    at: new Date().toISOString(),
    actorId: actorUserId,
    tagId: result.tag.id,
    tag: result.tag.tag,
    orderId: result.tag.orderId,
    fromState: result.fromState,
    toState: result.tag.state,
  });

  return { tag: result.tag, scan: result.scan };
}

/* ════════════ BULK SCAN (entrée/sortie de station, multi-tags) ════════════ */

export async function bulkScan(actorUserId: string, dto: BulkScanDto) {
  const txResult = await prisma.$transaction(
    async (tx) => {
      if (dto.batchId) {
        const batch = await tx.batch.findUnique({ where: { id: dto.batchId } });
        if (!batch) throw new BadRequestError('batchId not found');
      }

      const tags = await tx.itemTag.findMany({
        where: { tag: { in: dto.tags } },
      });
      const found = new Map(tags.map((t) => [t.tag, t]));

      const results: {
        tag: string;
        tagId?: string;
        orderId?: string;
        ok: boolean;
        fromState?: string;
        toState?: string;
        error?: string;
      }[] = [];

      const now = new Date();

      for (const tagCode of dto.tags) {
        const tag = found.get(tagCode);
        if (!tag) {
          results.push({ tag: tagCode, ok: false, error: 'Not found' });
          continue;
        }
        const targetState: TagState = dto.nextState ?? (tag.state as TagState);
        try {
          assertTransition(tag.state as TagState, targetState);
        } catch (err) {
          results.push({
            tag: tagCode,
            ok: false,
            fromState: tag.state,
            toState: targetState,
            error: err instanceof Error ? err.message : 'Invalid transition',
          });
          continue;
        }

        await tx.tagScan.create({
          data: {
            tagId: tag.id,
            station: dto.station,
            scannedBy: actorUserId,
            scannedAt: now,
            metadata: (dto.metadata ?? null) as Prisma.InputJsonValue,
          },
        });
        await tx.itemTag.update({
          where: { id: tag.id },
          data: {
            state: targetState,
            scannedAt: now,
            ...(dto.batchId ? { currentBatchId: dto.batchId } : {}),
            ...(targetState === 'done' ? { finishedAt: now } : {}),
          },
        });

        results.push({
          tag: tagCode,
          tagId: tag.id,
          orderId: tag.orderId,
          ok: true,
          fromState: tag.state,
          toState: targetState,
        });
      }

      const okCount = results.filter((r) => r.ok).length;

      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          action: 'scan',
          entity: 'item_tag',
          entityId: null,
          payload: {
            event: 'bulk_scan',
            station: dto.station,
            requested: dto.tags.length,
            scanned: okCount,
            skipped: dto.tags.length - okCount,
            batchId: dto.batchId ?? null,
          },
        },
      });

      return {
        scanned: okCount,
        skipped: results.filter((r) => !r.ok).length,
        results,
      };
    },
    { isolationLevel: 'Serializable', timeout: 20_000 },
  );

  // Diffuse un tag:scanned par tag réussi (post-commit)
  const at = new Date().toISOString();
  for (const r of txResult.results) {
    if (r.ok && r.tagId && r.orderId && r.fromState && r.toState) {
      broadcastTagEvent('tag:scanned', {
        at,
        actorId: actorUserId,
        tagId: r.tagId,
        tag: r.tag,
        orderId: r.orderId,
        fromState: r.fromState,
        toState: r.toState,
      });
    }
  }

  return txResult;
}

/* ════════════ LOST ════════════ */

export async function markTagLost(
  tagCode: string,
  actorUserId: string,
  reason: string,
) {
  return prisma.$transaction(async (tx) => {
    const tag = await tx.itemTag.findUnique({ where: { tag: tagCode } });
    if (!tag) throw new NotFoundError('Tag not found');
    assertTransition(tag.state as TagState, 'lost');

    const updated = await tx.itemTag.update({
      where: { id: tag.id },
      data: { state: 'lost' },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'update',
        entity: 'item_tag',
        entityId: tag.id,
        payload: { event: 'lost', tag: tag.tag, reason, fromState: tag.state },
      },
    });

    return updated;
  });
}
