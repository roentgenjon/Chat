import { Request, Response, NextFunction } from 'express';
import db from '../db';

export interface AuthRequest extends Request {
  userId?: number;
  userName?: string;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const deviceId = req.headers['x-device-id'] as string | undefined;
  if (!deviceId) {
    res.status(401).json({ error: 'missing_device_id' });
    return;
  }
  const user = db.prepare('SELECT id, name FROM users WHERE device_id = ?').get(deviceId) as { id: number; name: string } | undefined;
  if (!user) {
    res.status(401).json({ error: 'not_registered' });
    return;
  }
  req.userId = user.id;
  req.userName = user.name;
  next();
}
