import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer as createViteServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });

  app.use(vite.middlewares);

  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const rooms = new Map();

  io.on('connection', (socket) => {
    console.log(`➕ Nouveau participant connecté (ID: ${socket.id})`);

    socket.on('join-room', (roomId) => {
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }
      
      const room = rooms.get(roomId);
      if (room.size >= 2) {
        socket.emit('room-full');
        return;
      }

      const isFirstUser = room.size === 0;
      room.add(socket.id);
      socket.join(roomId);
      
      socket.emit('room-joined', { isFirstUser });
      
      if (room.size === 2) {
        io.to(roomId).emit('ready');
      }
    });

    socket.on('offer', ({ roomId, offer }) => {
      socket.to(roomId).emit('offer', offer);
    });

    socket.on('answer', ({ roomId, answer }) => {
      socket.to(roomId).emit('answer', answer);
    });

    socket.on('ice-candidate', ({ roomId, candidate }) => {
      socket.to(roomId).emit('ice-candidate', candidate);
    });

    socket.on('disconnect', () => {
      rooms.forEach((peers, roomId) => {
        if (peers.has(socket.id)) {
          peers.delete(socket.id);
          if (peers.size === 0) {
            rooms.delete(roomId);
          }
          io.to(roomId).emit('peer-disconnected');
        }
      });
    });
  });

  const port = 3001;
  httpServer.listen(port, () => {
    console.log(`🚀 Serveur démarré sur le port ${port}`);
  });
}

startServer().catch(console.error);