import { Router, Response } from 'express';
import db from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { upload } from '../upload';
import { Server as SocketServer } from 'socket.io';

export function createMessagesRouter(io: SocketServer) {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.post('/', upload.single('media'), (req: AuthRequest, res: Response): void => {
    const convId = Number(req.params.id);

    const member = db.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).get(convId, req.userId);
    if (!member) {
      res.status(403).json({ error: 'not_a_member' });
      return;
    }

    const body = req.body as { type?: string; content?: string };
    let type = body.type || 'text';
    let content: string | null = null;
    let mediaUrl: string | null = null;

    if (req.file) {
      mediaUrl = `/uploads/${req.file.filename}`;
      type = req.file.mimetype.startsWith('image/') ? 'image' : 'video';
    } else {
      content = typeof body.content === 'string' ? body.content.trim() : null;
      if (!content) {
        res.status(400).json({ error: 'content_required' });
        return;
      }
      type = 'text';
    }

    const result = db.prepare(
      'INSERT INTO messages (conversation_id, sender_id, type, content, media_url) VALUES (?, ?, ?, ?, ?)'
    ).run(convId, req.userId, type, content, mediaUrl);

    const message = db.prepare(`
      SELECT m.*, u.name AS sender_name FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

    io.to(`conv:${convId}`).emit('new_message', message);

    res.status(201).json(message);
  });

  return router;
}
