import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/async-handler.js';
import * as authService from './auth.service.js';

export const loginCtrl = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  });
  res.json(result);
});

export const refreshCtrl = asyncHandler(async (req: Request, res: Response) => {
  const tokens = await authService.refresh(req.body.refreshToken);
  res.json(tokens);
});

export const logoutCtrl = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.body.refreshToken);
  res.json({ ok: true });
});

export const changePasswordCtrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    return;
  }
  await authService.changePassword(req.user.id, req.body);
  res.json({ ok: true });
});

export const meCtrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    return;
  }
  res.json({ user: req.user });
});
