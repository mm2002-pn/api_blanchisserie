import type {
  BatchEventPayload,
  InvoiceEventPayload,
  NotificationEventPayload,
  OrderEventPayload,
  RoundEventPayload,
  RtEventName,
  TagEventPayload,
} from './events.js';
import { emitEvent } from './socket.js';

/**
 * API métier de diffusion. Centralise le routing par room :
 *  - événements ordre/facture → staff (admin/manager/supervisor/operator)
 *    + client propriétaire (`client:<id>`)
 *  - événements batch/tag → atelier uniquement
 *  - notification → user destinataire
 */

const STAFF_ROLES = ['admin', 'manager', 'supervisor', 'operator'];
const ATELIER_ROLES = ['admin', 'manager', 'supervisor', 'operator'];

function staffRooms() {
  return STAFF_ROLES.map((r) => `role:${r}`);
}
function atelierRooms() {
  return ATELIER_ROLES.map((r) => `role:${r}`);
}

export function broadcastOrderEvent(name: RtEventName, payload: OrderEventPayload) {
  emitEvent(name, payload, {
    rooms: [...staffRooms(), `client:${payload.clientId}`],
  });
}

export function broadcastBatchEvent(name: RtEventName, payload: BatchEventPayload) {
  emitEvent(name, payload, { rooms: atelierRooms() });
}

export function broadcastInvoiceEvent(name: RtEventName, payload: InvoiceEventPayload) {
  emitEvent(name, payload, {
    rooms: ['role:admin', 'role:manager', `client:${payload.clientId}`],
  });
}

export function broadcastTagEvent(name: RtEventName, payload: TagEventPayload) {
  emitEvent(name, payload, { rooms: atelierRooms() });
}

export function broadcastNotificationEvent(payload: NotificationEventPayload, userId: string) {
  emitEvent('notification:new', payload, { rooms: [`user:${userId}`] });
}

/** Événement tournée de collecte : staff (admin/manager/supervisor) + chauffeur enrôlé. */
export function broadcastRoundEvent(name: RtEventName, payload: RoundEventPayload) {
  const rooms = [...staffRooms()];
  if (payload.driverId) rooms.push(`user:${payload.driverId}`);
  emitEvent(name, payload, { rooms });
}
