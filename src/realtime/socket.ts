import type { Server as HttpServer } from 'node:http';
import {
  Server as SocketServer,
  type Socket,
  type DefaultEventsMap,
} from 'socket.io';
import type { Role } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { verifyAccessToken } from '../utils/jwt.js';
import type { RtEventName, RtEventPayload } from './events.js';

/**
 * Couche temps réel. JWT obligatoire au handshake (auth.token ou query.token).
 *
 * Rooms automatiques par socket :
 *  - `user:<userId>`     — diffusion ciblée
 *  - `role:<role>`       — staff par fonction
 *  - `client:<clientId>` — hôtels (un seul si role=hotel)
 *
 * Le routing applicatif est dans `src/realtime/emitter.ts`.
 */

interface SocketUser {
  id: string;
  role: Role;
  email: string;
  clientId?: string | null;
}

interface SocketData {
  user?: SocketUser;
}

type Io = SocketServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
type Sock = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

let io: Io | null = null;

export function getIo(): Io | null {
  return io;
}

export function initSocketServer(server: HttpServer) {
  io = new SocketServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(server, {
    path: '/realtime',
    cors: {
      origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
      credentials: true,
    },
    // 30s ping, déconnecte les clients silencieux
    pingTimeout: 30_000,
    pingInterval: 25_000,
  });

  // ─── Auth handshake ────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined);
      if (!token) return next(new Error('Missing token'));

      const payload = await verifyAccessToken(token);
      socket.data.user = {
        id: payload.sub,
        role: payload.role as Role,
        email: payload.email,
        clientId: payload.clientId ?? null,
      };
      return next();
    } catch (err) {
      logger.warn({ err }, 'realtime: handshake rejected');
      next(new Error('Unauthorized'));
    }
  });

  // ─── Connection lifecycle ──────────────────────────────────────────
  io.on('connection', (socket: Sock) => {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    void socket.join(`user:${user.id}`);
    void socket.join(`role:${user.role}`);
    if (user.clientId) void socket.join(`client:${user.clientId}`);

    logger.debug(
      { socketId: socket.id, userId: user.id, role: user.role },
      'realtime: client connected',
    );

    socket.on('disconnect', (reason) => {
      logger.debug(
        { socketId: socket.id, userId: user.id, reason },
        'realtime: client disconnected',
      );
    });
  });

  logger.info({ path: '/realtime' }, '✓ Socket.IO server attached');
  return io;
}

export function closeSocketServer() {
  if (io) {
    io.close();
    io = null;
  }
}

/* ════════════ EMIT HELPERS ════════════ */

interface EmitOptions {
  /** Rooms cibles. Si vide, broadcast à tous les sockets connectés. */
  rooms?: string[];
}

export function emitEvent<T extends RtEventPayload>(
  name: RtEventName,
  payload: T,
  opts: EmitOptions = {},
) {
  if (!io) return;
  const rooms = opts.rooms ?? [];
  if (rooms.length === 0) {
    io.emit(name, payload);
    return;
  }
  io.to(rooms).emit(name, payload);
}
