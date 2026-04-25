import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

/**
 * Middleware d'erreur global. Doit être enregistré en DERNIER.
 * Sérialise toutes les erreurs vers une enveloppe JSON cohérente.
 */
export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  // 1) Zod validation
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.flatten(),
      },
    });
  }

  // 2) Prisma known errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: {
          code: 'DUPLICATE',
          message: 'A record with this value already exists',
          details: { fields: err.meta?.target },
        },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Record not found' },
      });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({
        error: { code: 'FOREIGN_KEY', message: 'Foreign key constraint violated' },
      });
    }
  }

  // 3) Optimistic locking (Prisma transaction failure with version mismatch)
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2034' // Transaction conflict
  ) {
    return res.status(409).json({
      error: {
        code: 'CONCURRENT_UPDATE',
        message: 'Resource was modified by another request, retry',
      },
    });
  }

  // 4) Erreurs applicatives typées
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // 5) Inconnu = 500
  const message = err instanceof Error ? err.message : 'Internal server error';
  logger.error(
    { err, path: req.path, method: req.method, requestId: req.id },
    'Unhandled error',
  );

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Internal server error' : message,
      ...(env.NODE_ENV !== 'production' && err instanceof Error
        ? { stack: err.stack?.split('\n').slice(0, 6) }
        : {}),
    },
  });
};

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
