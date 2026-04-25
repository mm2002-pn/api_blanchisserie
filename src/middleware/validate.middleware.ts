import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Middleware de validation Zod sur une partie de la requête.
 * En cas d'erreur, le ZodError est forwardé au error.middleware.
 *
 * Note : on attache les valeurs validées à `req.validated.{body,query,params}`
 * pour éviter de réécrire `req.query` (typé ParsedQs en lecture seule).
 *
 * @example
 *   router.post('/', validate({ body: createOrderSchema }), createOrder)
 */
declare global {
  namespace Express {
    interface Request {
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export function validate(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}): RequestHandler {
  return (req, _res, next) => {
    try {
      const validated: NonNullable<Express.Request['validated']> = {};
      if (schemas.body) {
        validated.body = schemas.body.parse(req.body);
        req.body = validated.body;
      }
      if (schemas.query) {
        validated.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        validated.params = schemas.params.parse(req.params);
      }
      req.validated = validated;
      next();
    } catch (err) {
      next(err);
    }
  };
}
