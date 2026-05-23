/**
 * Catalogue des événements temps réel diffusés par le serveur.
 *
 * Convention: <domaine>:<action>. Le payload reste minimal — les clients
 * font un GET pour rafraîchir la donnée détaillée à partir de l'id.
 */

export type RtEventName =
  | 'order:created'
  | 'order:updated'
  | 'order:confirmed'
  | 'order:collection_scheduled'
  | 'order:collected'
  | 'order:received'
  | 'order:ready'
  | 'order:delivery_scheduled'
  | 'order:delivered'
  | 'order:cancelled'
  | 'round:created'
  | 'round:started'
  | 'round:updated'
  | 'round:completed'
  | 'round:cancelled'
  | 'batch:created'
  | 'batch:started'
  | 'batch:completed'
  | 'invoice:generated'
  | 'invoice:paid'
  | 'invoice:cancelled'
  | 'tag:scanned'
  | 'notification:new';

export interface RtEventBase {
  at: string; // ISO date
  actorId?: string | null;
}

export interface OrderEventPayload extends RtEventBase {
  orderId: string;
  orderNumber: string;
  clientId: string;
  status?: string;
  workflowState?: string;
  /** Date/heure planifiée pour collecte (collection_scheduled) ou livraison (delivery_scheduled). */
  collectionPlannedAt?: string | null;
  collectionDriverId?: string | null;
  plannedAt?: string | null;
}

export interface BatchEventPayload extends RtEventBase {
  batchId: string;
  code: string;
  stage?: string;
  status?: string;
}

export interface InvoiceEventPayload extends RtEventBase {
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  status?: string;
}

export interface TagEventPayload extends RtEventBase {
  tagId: string;
  tag: string;
  orderId: string;
  fromState: string;
  toState: string;
}

export interface NotificationEventPayload extends RtEventBase {
  notificationId: string;
  channel: string;
  subject?: string | null;
}

export interface RoundEventPayload extends RtEventBase {
  roundId: string;
  number: string;
  status: string;
  vehicleId: string;
  driverId?: string | null;
  orderCount?: number;
}

export type RtEventPayload =
  | OrderEventPayload
  | BatchEventPayload
  | InvoiceEventPayload
  | TagEventPayload
  | NotificationEventPayload
  | RoundEventPayload;
