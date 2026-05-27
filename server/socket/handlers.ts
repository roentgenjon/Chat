import { Server as SocketServer, Socket } from 'socket.io';
import db from '../db';

export function registerSocketHandlers(io: SocketServer) {
  const socketToUser = new Map<string, number>();

  io.on('connection', (socket: Socket) => {
    socket.on('authenticate', (data: { deviceId?: string }) => {
      if (!data?.deviceId) return;
      const user = db.prepare('SELECT id FROM users WHERE device_id = ?').get(data.deviceId) as { id: number } | undefined;
      if (!user) return;
      socketToUser.set(socket.id, user.id);
      socket.join(`user:${user.id}`);
    });

    socket.on('join_conversation', (data: { conversationId?: number }) => {
      const userId = socketToUser.get(socket.id);
      if (!userId || !data?.conversationId) return;
      const member = db.prepare(
        'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
      ).get(data.conversationId, userId);
      if (member) {
        socket.join(`conv:${data.conversationId}`);
      }
    });

    socket.on('leave_conversation', (data: { conversationId?: number }) => {
      if (data?.conversationId) {
        socket.leave(`conv:${data.conversationId}`);
      }
    });

    socket.on('disconnect', () => {
      socketToUser.delete(socket.id);
    });
  });
}
