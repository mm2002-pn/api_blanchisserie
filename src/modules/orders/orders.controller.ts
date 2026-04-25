import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import { ForbiddenError, UnauthorizedError } from '../../utils/errors.js';
import * as svc from './orders.service.js';

export const createOrderCtrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  // Hôtel = scoping forcé sur son client
  const clientId =
    req.user.role === 'hotel'
      ? req.user.clientId
      : (req.body.clientId as string | undefined);
  if (!clientId) throw new ForbiddenError('clientId required');

  const order = await svc.createOrder(clientId, req.user.id, req.body);
  res.status(201).json(order);
});

export const listOrdersCtrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const scope = req.user.role === 'hotel' ? req.user.clientId : undefined;
  const result = await svc.listOrders({
    clientId: req.query.clientId as string | undefined,
    status: req.query.status as string | undefined,
    page: Number(req.query.page) || 1,
    pageSize: Number(req.query.pageSize) || 20,
    search: req.query.search as string | undefined,
    scopeClientId: scope ?? undefined,
  });
  res.json(result);
});

export const getOrderCtrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const scope = req.user.role === 'hotel' ? req.user.clientId ?? undefined : undefined;
  const order = await svc.getOrder(req.params.id as string, scope);
  res.json(order);
});

export const collectOrderCtrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const updated = await svc.collectOrder(req.params.id as string, req.user.id, req.body);
  res.json(updated);
});

export const receiveOrderCtrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const updated = await svc.receiveOrder(req.params.id as string, req.user.id, req.body);
  res.json(updated);
});

export const cancelOrderCtrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const updated = await svc.cancelOrder(
    req.params.id as string,
    req.user.id,
    req.body.reason,
    req.body.expectedVersion,
  );
  res.json(updated);
});
