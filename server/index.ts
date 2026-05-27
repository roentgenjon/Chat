import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import { UPLOADS_DIR } from './db';
import usersRouter from './routes/users';
import { createConversationsRouter } from './routes/conversations';
import { createMessagesRouter } from './routes/messages';
import { registerSocketHandlers } from './socket/handlers';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/users', usersRouter);
app.use('/api/conversations', createConversationsRouter(io));
app.use('/api/conversations/:id/messages', createMessagesRouter(io));

app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err.message === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'file_too_large' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
});
