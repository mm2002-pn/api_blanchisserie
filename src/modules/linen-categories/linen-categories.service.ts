import { prisma } from '../../config/prisma.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import type { z } from 'zod';
import type {
  upsertLinenCategorySchema,
  updateLinenCategorySchema,
} from './linen-categories.dto.js';

type UpsertInput = z.infer<typeof upsertLinenCategorySchema>;
type UpdateInput = z.infer<typeof updateLinenCategorySchema>;

export async function listLinenCategories(opts: { isActive?: boolean } = {}) {
  const items = await prisma.linenCategoryConfig.findMany({
    where:
      typeof opts.isActive === 'boolean' ? { isActive: opts.isActive } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  return { items, count: items.length };
}

export async function getLinenCategory(id: string) {
  const cat = await prisma.linenCategoryConfig.findUnique({ where: { id } });
  if (!cat) throw new NotFoundError('Linen category not found');
  return cat;
}

/** Crée ou met à jour la config affichage d'un code catégorie (LP/LF/NAE). */
export async function upsertLinenCategory(actorId: string, dto: UpsertInput) {
  const existing = await prisma.linenCategoryConfig.findUnique({
    where: { code: dto.code },
  });
  if (existing) {
    throw new ConflictError(
      `Category config already exists for code ${dto.code} (use PATCH to update)`,
    );
  }
  const created = await prisma.linenCategoryConfig.create({
    data: {
      code: dto.code,
      label: dto.label,
      emoji: dto.emoji ?? null,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'create',
      entity: 'linen_category_config',
      entityId: created.id,
      payload: { code: dto.code, label: dto.label },
    },
  });
  return created;
}

export async function updateLinenCategory(
  actorId: string,
  id: string,
  dto: UpdateInput,
) {
  const existing = await prisma.linenCategoryConfig.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Linen category not found');

  const updated = await prisma.linenCategoryConfig.update({
    where: { id },
    data: {
      label: dto.label,
      emoji: dto.emoji,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'update',
      entity: 'linen_category_config',
      entityId: id,
      payload: { changes: dto },
    },
  });
  return updated;
}
