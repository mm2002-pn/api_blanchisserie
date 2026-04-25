import type { RequestHandler } from 'express';
import { nanoid } from 'nanoid';

/**
 * Attache un identifiant unique à chaque requête (header X-Request-Id).
 * Utile pour corréler les logs et debugger en prod.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : nanoid(12);
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
