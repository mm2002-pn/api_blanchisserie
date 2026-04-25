import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Singleton Prisma — réutilise la même instance entre les requêtes,
 * évite la fuite de connexions en dev/hot-reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function makeClient() {
  const client = new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });

  // Bind logger events. Le typing strict de Prisma 5 nécessite un cast ici.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  c.$on('error', (e: { message?: string }) =>
    logger.error({ prisma: e }, 'Prisma error'),
  );
  c.$on('warn', (e: { message?: string }) =>
    logger.warn({ prisma: e }, 'Prisma warn'),
  );
  if (env.NODE_ENV === 'development') {
    c.$on('query', (e: { duration: number; query: string }) =>
      logger.debug({ ms: e.duration, query: e.query }, 'Prisma query'),
    );
  }

  return client;
}

export const prisma = globalForPrisma.prisma ?? makeClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
