import argon2 from 'argon2';
import { env } from '../config/env.js';

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: env.ARGON_MEMORY_COST,
  timeCost: env.ARGON_TIME_COST,
  parallelism: env.ARGON_PARALLELISM,
};

/** Hash sécurisé via Argon2id (recommandé OWASP 2024+). */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTS);
}

/** Vérifie un password contre son hash + déclenche rehash si paramètres obsolètes. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

export async function needsRehash(hash: string): Promise<boolean> {
  return argon2.needsRehash(hash, ARGON_OPTS);
}
