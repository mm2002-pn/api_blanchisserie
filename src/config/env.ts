import 'dotenv/config';
import { z } from 'zod';

/**
 * Validation des variables d'environnement au boot.
 * Si une seule variable manque ou est invalide → process.exit(1).
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // 10 req/s par IP — back-office interne, pas une API publique
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  ARGON_MEMORY_COST: z.coerce.number().int().positive().default(19_456),
  ARGON_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON_PARALLELISM: z.coerce.number().int().positive().default(1),

  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),

  ENABLE_EMAIL: z.coerce.boolean().default(false),
  ENABLE_PUSH: z.coerce.boolean().default(false),
  ENABLE_SMS: z.coerce.boolean().default(false),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('Blanchisserie SN <no-reply@blanchisserie.sn>'),

  ENABLE_CRON: z.coerce.boolean().default(false),
  CRON_TZ: z.string().default('Africa/Dakar'),
  CRON_NOTIFICATIONS: z.string().default('* * * * *'),         // chaque minute
  CRON_MARK_OVERDUE: z.string().default('0 6 * * *'),          // chaque jour 06:00
  CRON_AUTO_INVOICE: z.string().default('0 8 1 * *'),          // 1er du mois 08:00

  EXPO_ACCESS_TOKEN: z.string().default(''),                   // optionnel (rate limit augmenté)
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
