import { Router, Request, Response } from 'express';
import db from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/register', (req: Request, res: Response): void => {
  const { name, deviceId } = req.body as { name?: string; deviceId?: string };
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name_required' });
    return;
  }
  if (!deviceId || typeof deviceId !== 'string') {
    res.status(400).json({ error: 'device_id_required' });
    return;
  }
  const trimmed = name.trim();
  try {
    const stmt = db.prepare('INSERT INTO users (name, device_id) VALUES (?, ?)');
    const result = stmt.run(trimmed, deviceId);
    res.status(201).json({ id: result.lastInsertRowid, name: trimmed });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const existing = db.prepare('SELECT device_id FROM users WHERE name = ?').get(trimmed) as { device_id: string } | undefined;
      if (existing && existing.device_id === deviceId) {
        const user = db.prepare('SELECT id, name FROM users WHERE device_id = ?').get(deviceId) as { id: number; name: string };
        res.status(200).json(user);
      } else {
        res.status(409).json({ error: 'name_taken' });
      }
    } else {
      throw err;
    }
  }
});

router.get('/me', requireAuth, (req: AuthRequest, res: Response): void => {
  res.json({ id: req.userId, name: req.userName });
});

router.get('/', requireAuth, (_req: AuthRequest, res: Response): void => {
  const users = db.prepare('SELECT id, name FROM users ORDER BY name ASC').all();
  res.json(users);
});

export default router;
