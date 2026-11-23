// Gestio_back/src/socket.ts
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import type { Server as HttpServer } from 'http';

let io: Server;

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: { origin: '*' },
  });

  // Autenticação no handshake: o cliente envia o JWT em `auth.token`.
  // Sem token válido, a conexão é recusada.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Não autenticado'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: number };
      socket.data.userId = decoded.id;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    // A sala vem do token, nunca do que o cliente diz ser.
    const userId: number = socket.data.userId;
    socket.join(`user_${userId}`);

    // Mantido por compatibilidade com clientes antigos; o id enviado é ignorado.
    socket.on('identificar_usuario', () => socket.join(`user_${userId}`));
  });

  return io;
};

export const getIO = () => {
  if (!io) throw new Error("Socket.io não inicializado!");
  return io;
};
