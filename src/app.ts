import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { globalLimiter } from './middleware/rate-limit.middleware.js';
import { NotFoundError } from './utils/errors.js';
import { apiRouter } from './routes/index.js';

export function createApp() {
  const app = express();

  // ─────── Trust proxy (derrière Nginx/Cloudflare) ───────
  app.set('trust proxy', 1);

  // ─────── Sécurité ───────
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // Pas d'origin (Postman, mobile native, server-to-server) → autorisé
        if (!origin) return cb(null, true);
        if (env.CORS_ORIGINS.includes(origin) || env.CORS_ORIGINS.includes('*')) {
          return cb(null, true);
        }
        return cb(new Error(`CORS: origin '${origin}' not allowed`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  // ─────── Body parsers + compression ───────
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(compression());

  // ─────── Observabilité ───────
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { id?: string }).id ?? 'unknown',
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/ready',
      },
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // ─────── Health checks (avant rate limit) ───────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), env: env.NODE_ENV });
  });
  app.get('/ready', async (_req, res) => {
    // Optionnel: ping DB
    res.json({ status: 'ready' });
  });

  // ─────── Rate limit global ───────
  app.use(globalLimiter);

  // ─────── Fichiers uploadés (servis en statique, sans rate limit pour les blobs) ───────
  app.use(
    '/uploads',
    express.static(path.resolve(env.UPLOAD_DIR), {
      maxAge: env.NODE_ENV === 'production' ? '7d' : 0,
      fallthrough: false,
    }),
  );

  // ─────── Routes API ───────
  app.use('/api/v1', apiRouter);

  // ─────── 404 catch-all ───────
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  });

  // ─────── Error handler (toujours en dernier) ───────
  app.use(errorMiddleware);

  return app;
}
