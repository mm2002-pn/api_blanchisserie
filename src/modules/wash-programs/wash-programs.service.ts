import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../utils/errors.js';

export async function listWashPrograms(opts: {
  category?: string;
  isActive?: boolean;
  search?: string;
}) {
  const where: Prisma.WashingProgramWhereInput = {
    ...(opts.category
      ? { suitable: { has: opts.category as 'LP' | 'LF' | 'NAE' } }
      : {}),
    ...(typeof opts.isActive === 'boolean' ? { isActive: opts.isActive } : {}),
    ...(opts.search
      ? {
          OR: [
            { code: { contains: opts.search, mode: 'insensitive' } },
            { name: { contains: opts.search, mode: 'insensitive' } },
            { detergentType: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const items = await prisma.washingProgram.findMany({
    where,
    orderBy: { code: 'asc' },
  });

  return { items, count: items.length };
}

export async function getWashProgram(id: string) {
  const program = await prisma.washingProgram.findUnique({ where: { id } });
  if (!program) throw new NotFoundError('Washing program not found');
  return program;
}

export async function createWashProgram(
  actorId: string,
  data: Prisma.WashingProgramCreateInput,
) {
  return prisma.$transaction(async (tx) => {
    const program = await tx.washingProgram.create({ data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'create',
        entity: 'wash_program',
        entityId: program.id,
        payload: { code: program.code, name: program.name },
      },
    });
    return program;
  });
}

export async function updateWashProgram(
  actorId: string,
  id: string,
  data: Prisma.WashingProgramUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.washingProgram.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Washing program not found');

    const program = await tx.washingProgram.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'update',
        entity: 'wash_program',
        entityId: id,
        payload: { changes: data as unknown as Prisma.InputJsonValue },
      },
    });
    return program;
  });
}
