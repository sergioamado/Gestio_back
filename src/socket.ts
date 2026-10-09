// Gestio_back/src/socket.ts
import { Server } from 'socket.io';

let io: Server;

export const initSocket = (server: any) => {
  io = new Server(server, {
    cors: { origin: '*' } // (as suas configurações de CORS)
  });

  io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);

    // Colocar o utilizador na sala certa!
    socket.on('identificar_usuario', (userId) => {
      const roomName = `user_${userId}`;
      socket.join(roomName);
      console.log(`O utilizador ${userId} sintonizou a sala ${roomName}`);
    });

    socket.on('disconnect', () => {
      console.log('Cliente desconectado:', socket.id);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) throw new Error("Socket.io não inicializado!");
  return io;
};