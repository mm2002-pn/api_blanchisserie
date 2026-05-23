import { z } from 'zod';

const linenItemSchema = z.object({
  category: z.enum(['LP', 'LF', 'NAE']),
  type: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const createOrderSchema = z.object({
  estimatedItems: z.array(linenItemSchema).min(1),
  collectionDate: z.string().datetime(),
  instructions: z.string().max(2000).optional(),
  /** Localisation cible où le chauffeur doit venir collecter. */
  pickupGeoLat: z.number().min(-90).max(90).optional(),
  pickupGeoLng: z.number().min(-180).max(180).optional(),
});

/** Édition d'une commande par le client AVANT collecte uniquement.
 *  Tous les champs sont optionnels (envoyer juste ceux qui changent). */
export const updateOrderSchema = z.object({
  estimatedItems: z.array(linenItemSchema).min(1).optional(),
  collectionDate: z.string().datetime().optional(),
  instructions: z.string().max(2000).optional(),
  pickupGeoLat: z.number().min(-90).max(90).optional(),
  pickupGeoLng: z.number().min(-180).max(180).optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const listOrdersSchema = z.object({
  status: z.string().optional(),
  /** Liste de status séparés par virgule, ex: "received,triaged,in_production". */
  statusIn: z.string().optional(),
  clientId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().optional(),
  /** Bornes de date (ISO) appliquées au champ choisi via `dateField`. */
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  /** Champ de date filtré (default = updatedAt). */
  dateField: z.enum(['createdAt', 'updatedAt', 'collectionDate']).optional(),
});

/** URL d'asset : accepte URL absolue (http://…) ou chemin relatif (/uploads/…). */
const assetUrl = z.string().min(1).max(500);

/** Item agrégé par type avec la quantité réellement comptée. */
const itemCountSchema = z.object({
  type: z.string().min(1),
  quantity: z.number().int().nonnegative(),
});

export const collectOrderSchema = z.object({
  driverWeight: z.number().int().positive(),
  driverPieces: z.number().int().positive(),
  // Détail par type validé par le chauffeur (optionnel — fallback driverPieces si absent).
  driverItems: z.array(itemCountSchema).optional(),
  visualEstimation: z.enum(['S', 'M', 'L', 'XL']).optional(),
  collectionPhotos: z.array(assetUrl).max(10).default([]),
  signatureUrl: assetUrl.optional(),
  recipientName: z.string().max(120).optional(),
  geoLat: z.number().optional(),
  geoLng: z.number().optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const receiveOrderSchema = z.object({
  receivedWeight: z.number().int().positive(),
  receivedPieces: z.number().int().positive(),
  // Détail par type comptabilisé à la pesée atelier.
  receivedItems: z.array(itemCountSchema).optional(),
  acceptDeviation: z.boolean().default(false),
  expectedVersion: z.number().int().nonnegative(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().min(3).max(500),
  expectedVersion: z.number().int().nonnegative(),
});

export const confirmOrderSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  collectionPlannedAt: z.string().datetime().optional(),
  collectionDriverId: z.string().optional(),
  collectionVehicleId: z.string().optional(),
  collectionPdaId: z.string().optional(),
});

export const markOrderReadySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  notes: z.string().max(500).optional(),
});

export const scheduleDeliverySchema = z.object({
  driverId: z.string().optional(),
  vehicleId: z.string().optional(),
  pdaId: z.string().optional(),
  plannedAt: z.string().datetime(),
  expectedVersion: z.number().int().nonnegative(),
});

export const startDeliverySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

export const deliverOrderSchema = z.object({
  recipientName: z.string().min(2).max(120),
  signatureUrl: assetUrl.optional(),
  deliveryPhotos: z.array(assetUrl).max(10).default([]),
  geoLat: z.number().optional(),
  geoLng: z.number().optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type UpdateOrderDto = z.infer<typeof updateOrderSchema>;
export type CollectOrderDto = z.infer<typeof collectOrderSchema>;
export type ReceiveOrderDto = z.infer<typeof receiveOrderSchema>;
export type ConfirmOrderDto = z.infer<typeof confirmOrderSchema>;
export type MarkOrderReadyDto = z.infer<typeof markOrderReadySchema>;
export type ScheduleDeliveryDto = z.infer<typeof scheduleDeliverySchema>;
export type StartDeliveryDto = z.infer<typeof startDeliverySchema>;
export type DeliverOrderDto = z.infer<typeof deliverOrderSchema>;
