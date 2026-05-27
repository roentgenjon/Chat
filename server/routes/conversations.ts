import { Router, Response } from 'express';
import db from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { upload } from '../upload';
import { Server as SocketServer } from 'socket.io';

export function createConversationsRouter(io: SocketServer) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req: AuthRequest, res: Response): void => {
    const rows = db.prepare(`
      SELECT
        c.id, c.name, c.avatar_url, c.is_group, c.created_at,
        m.type AS last_type, m.content AS last_content,
        m.media_url AS last_media_url, m.sent_at AS last_sent_at,
        u.name AS last_sender_name
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
      LEFT JOIN messages m ON m.id = (
        SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN users u ON u.id = m.sender_id
      ORDER BY COALESCE(m.sent_at, c.created_at) DESC
    `).all(req.userId) as ConvRow[];

    const withMembers = rows.map(row => {
      const members = db.prepare(`
        SELECT u.id, u.name FROM users u
        JOIN conversation_members cm ON cm.user_id = u.id
        WHERE cm.conversation_id = ?
      `).all(row.id) as { id: number; name: string }[];
      return { ...row, members };
    });

    res.json(withMembers);
  });

  router.post('/', upload.single('avatar'), (req: AuthRequest, res: Response): void => {
    const body = req.body as { memberIds?: string | string[]; name?: string };
    let memberIds: number[] = [];

    if (Array.isArray(body.memberIds)) {
      memberIds = body.memberIds.map(Number);
    } else if (typeof body.memberIds === 'string') {
      memberIds = body.memberIds.split(',').map(Number);
    }

    memberIds = memberIds.filter(id => !isNaN(id) && id !== req.userId);

    if (memberIds.length === 0) {
      res.status(400).json({ error: 'at_least_one_member' });
      return;
    }

    const allMemberIds = [req.userId!, ...memberIds];
    const isGroup = memberIds.length > 1;

    if (!isGroup) {
      const otherId = memberIds[0];
      const existing = db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
        JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
        WHERE c.is_group = 0
        LIMIT 1
      `).get(req.userId, otherId) as { id: number } | undefined;

      if (existing) {
        const members = db.prepare(`
          SELECT u.id, u.name FROM users u
          JOIN conversation_members cm ON cm.user_id = u.id
          WHERE cm.conversation_id = ?
        `).all(existing.id);
        const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(existing.id);
        res.json({ ...conv as object, members });
        return;
      }
    }

    const groupName = isGroup ? (typeof body.name === 'string' ? body.name.trim() : '') : null;
    if (isGroup && !groupName) {
      res.status(400).json({ error: 'group_name_required' });
      return;
    }

    const avatarUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const insertConv = db.prepare(
      'INSERT INTO conversations (name, avatar_url, is_group) VALUES (?, ?, ?)'
    );
    const insertMember = db.prepare(
      'INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)'
    );

    const createConv = db.transaction(() => {
      const result = insertConv.run(groupName, avatarUrl, isGroup ? 1 : 0);
      const convId = result.lastInsertRowid as number;
      for (const uid of allMemberIds) {
        insertMember.run(convId, uid);
      }
      return convId;
    });

    const convId = createConv();
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as ConvRow;
    const members = db.prepare(`
      SELECT u.id, u.name FROM users u
      JOIN conversation_members cm ON cm.user_id = u.id
      WHERE cm.conversation_id = ?
    `).all(convId) as { id: number; name: string }[];

    const payload = { ...conv, members };

    for (const uid of allMemberIds) {
      io.to(`user:${uid}`).emit('conversation_created', payload);
    }

    res.status(201).json(payload);
  });

  router.get('/:id/messages', (req: AuthRequest, res: Response): void => {
    const convId = Number(req.params.id);
    const before = req.query.before ? Number(req.query.before) : null;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const member = db.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).get(convId, req.userId);
    if (!member) {
      res.status(403).json({ error: 'not_a_member' });
      return;
    }

    let rows;
    if (before) {
      rows = db.prepare(`
        SELECT m.*, u.name AS sender_name FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ? AND m.id < ?
        ORDER BY m.id DESC LIMIT ?
      `).all(convId, before, limit);
    } else {
      rows = db.prepare(`
        SELECT m.*, u.name AS sender_name FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ?
        ORDER BY m.id DESC LIMIT ?
      `).all(convId, limit);
    }

    res.json((rows as unknown[]).reverse());
  });

  return router;
}

interface ConvRow {
  id: number;
  name: string | null;
  avatar_url: string | null;
  is_group: number;
  created_at: number;
  last_type?: string;
  last_content?: string;
  last_media_url?: string;
  last_sent_at?: number;
  last_sender_name?: string;
}
