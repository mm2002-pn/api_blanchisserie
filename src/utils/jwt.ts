import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

const ACCESS_SECRET = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const REFRESH_SECRET = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

const ACCESS_ISS = 'blanchisserie-sn-api';
const ACCESS_AUD = 'blanchisserie-sn-clients';

export type AccessTokenPayload = {
  sub: string; // userId
  role: string;
  email: string;
  clientId?: string | null;
};

export type RefreshTokenPayload = {
  sub: string; // userId
  jti: string; // unique token id (pour rotation/revocation)
};

/** Génère un access token court (par défaut 15 min). */
export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(ACCESS_ISS)
    .setAudience(ACCESS_AUD)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(ACCESS_SECRET);
}

/** Génère un refresh token long (par défaut 30 j). */
export async function signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
  return new SignJWT({ jti: payload.jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(ACCESS_ISS)
    .setAudience(ACCESS_AUD)
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_TTL)
    .sign(REFRESH_SECRET);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, ACCESS_SECRET, {
      issuer: ACCESS_ISS,
      audience: ACCESS_AUD,
    });
    return payload as unknown as AccessTokenPayload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new UnauthorizedError('Access token expired');
    }
    throw new UnauthorizedError('Invalid access token');
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, REFRESH_SECRET, {
      issuer: ACCESS_ISS,
      audience: ACCESS_AUD,
    });
    return payload as unknown as RefreshTokenPayload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new UnauthorizedError('Refresh token expired');
    }
    throw new UnauthorizedError('Invalid refresh token');
  }
}
