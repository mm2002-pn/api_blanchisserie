import { Router } from 'express';
import { authMiddleware, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import {
  bulkScanSchema,
  listTagsSchema,
  markLostSchema,
  scanTagSchema,
  type ListTagsDto,
} from './tags.dto.js';
import * as svc from './tags.service.js';

export const tagsRouter = Router();
tagsRouter.use(authMiddleware);

tagsRouter.get(
  '/',
  validate({ query: listTagsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const q = req.validated?.query as ListTagsDto;
    const scope =
      req.user.role === 'hotel' ? req.user.clientId ?? '__none__' : undefined;
    const result = await svc.listTags(q, scope);
    res.json(result);
  }),
);

tagsRouter.get(
  '/:tag',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const scope =
      req.user.role === 'hotel' ? req.user.clientId ?? '__none__' : undefined;
    const result = await svc.getTag(req.params.tag as string, scope);
    res.json(result);
  }),
);

tagsRouter.post(
  '/:tag/scan',
  requireRoles('operator', 'supervisor', 'driver', 'admin', 'manager'),
  validate({ body: scanTagSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await svc.scanTag(req.params.tag as string, req.user.id, req.body);
    res.status(201).json(result);
  }),
);

tagsRouter.post(
  '/bulk-scan',
  requireRoles('operator', 'supervisor', 'admin', 'manager'),
  validate({ body: bulkScanSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const result = await svc.bulkScan(req.user.id, req.body);
    res.status(201).json(result);
  }),
);

tagsRouter.post(
  '/:tag/lost',
  requireRoles('supervisor', 'admin', 'manager'),
  validate({ body: markLostSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const reason = (req.body as { reason: string }).reason;
    const result = await svc.markTagLost(req.params.tag as string, req.user.id, reason);
    res.json(result);
  }),
);
