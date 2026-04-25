import Groq from 'groq-sdk';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Client Groq — utilisé pour bin-packing IA, détection d'anomalies,
 * suggestions de routes, etc.
 *
 * Si GROQ_API_KEY est vide, le client renverra null et le service
 * tombera en mode fallback (algorithme heuristique pur).
 */
export const groq = env.GROQ_API_KEY
  ? new Groq({
      apiKey: env.GROQ_API_KEY,
      timeout: env.GROQ_TIMEOUT_MS,
    })
  : null;

if (!groq) {
  logger.warn('GROQ_API_KEY missing — AI features will use fallback heuristics');
}

export const GROQ_MODEL = env.GROQ_MODEL;
