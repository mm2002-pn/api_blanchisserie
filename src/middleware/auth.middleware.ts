import type { Role } from '@prisma/client';
import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/jwt.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        email: string;
        clientId?: string | null;
      };
    }
  }
}

/**
 * Vérifie le JWT (header `Authorization: Bearer <token>`) et attache
 * l'utilisateur à `req.user`.
 */
export const authMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }
    const token = header.slice(7).trim();
    const payload = await verifyAccessToken(token);

    req.user = {
      id: payload.sub,
      role: payload.role as Role,
      email: payload.email,
      clientId: payload.clientId ?? null,
    };
    next();
  } catch (err) {
    next(err);
  }
};

/** Restreint l'accès à certains rôles. */
export const requireRoles =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Role '${req.user.role}' not allowed (required: ${roles.join(', ')})`,
        ),
      );
    }
    next();
  };

/** Auth optionnelle — `req.user` est défini si token valide, sinon undefined. */
export const optionalAuthMiddleware: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const token = header.slice(7).trim();
    const payload = await verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role as Role,
      email: payload.email,
      clientId: payload.clientId ?? null,
    };
  } catch {
    // Token invalide → on ignore silencieusement
  }
  next();
};
