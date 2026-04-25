import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/** Rate limit global — par défaut 120 req/min/IP. */
export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, slow down' },
  },
});

/** Rate limit serré pour les endpoints sensibles (login, password reset). */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'TOO_MANY_AUTH_ATTEMPTS',
      message: 'Too many attempts, retry in 15 minutes',
    },
  },
});
