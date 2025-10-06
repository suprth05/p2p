const express = require('express');
const https = require('https');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();

// Load SSL certificate
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'certs/key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'certs/cert.pem'))
};

// Create HTTPS server
const server = https.createServer(sslOptions, app);
const io = socketIO(server, {
  maxHttpBufferSize: 1e8 // 100MB - match client side max file size
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Room management
const rooms = {};

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  let currentRoom = null;

  // Create a new room
  socket.on('create-room', () => {
    const roomId = uuidv4();
    rooms[roomId] = {
      host: socket.id,
      participants: [socket.id],
      messages: []
    };
    
    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-created', roomId);
    console.log(`Room created: ${roomId} by ${socket.id}`);
  });

  // Join an existing room
  socket.on('join-room', (roomId) => {
    if (rooms[roomId]) {
      socket.join(roomId);
      rooms[roomId].participants.push(socket.id);
      
      currentRoom = roomId;
      socket.emit('room-joined', roomId);
      socket.to(roomId).emit('user-connected', socket.id);
      console.log(`User ${socket.id} joined room: ${roomId}`);
    } else {
      socket.emit('error', 'Room does not exist');
    }
  });

  // Get users in a room
  socket.on('get-users', (roomId) => {
    if (rooms[roomId]) {
      // Send all participants except the requesting user
      const otherParticipants = rooms[roomId].participants.filter(id => id !== socket.id);
      socket.emit('room-users', otherParticipants);
    }
  });

  // WebRTC signaling
  socket.on('offer', (payload) => {
    io.to(payload.target).emit('offer', {
      sdp: payload.sdp,
      sender: socket.id
    });
  });

  socket.on('answer', (payload) => {
    io.to(payload.target).emit('answer', {
      sdp: payload.sdp,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (payload) => {
    io.to(payload.target).emit('ice-candidate', {
      candidate: payload.candidate,
      sender: socket.id
    });
  });

  // Chat message handling
  socket.on('send-message', (payload) => {
    const { roomId, message } = payload;
    if (rooms[roomId]) {
      const messageObj = {
        sender: socket.id,
        text: message,
        timestamp: new Date().toISOString()
      };
      
      rooms[roomId].messages.push(messageObj);
      io.to(roomId).emit('new-message', messageObj);
    }
  });

  // File sharing handling
  socket.on('file-start', (payload) => {
    const { roomId, fileInfo } = payload;
    if (rooms[roomId]) {
      socket.to(roomId).emit('file-start', {
        sender: socket.id,
        fileInfo
      });
      
      // Add a system message about file sharing
      const messageObj = {
        sender: 'system',
        text: `${socket.id.substring(0, 4)} is sharing file: ${fileInfo.fileName}`,
        timestamp: new Date().toISOString()
      };
      
      rooms[roomId].messages.push(messageObj);
      io.to(roomId).emit('new-message', messageObj);
      
      console.log(`User ${socket.id} started sharing file ${fileInfo.fileName} in room ${roomId}`);
    }
  });

  socket.on('file-chunk', (payload) => {
    const { roomId, fileId, chunk, chunkIndex, totalChunks } = payload;
    if (rooms[roomId]) {
      socket.to(roomId).emit('file-chunk', {
        sender: socket.id,
        fileId,
        chunk,
        chunkIndex,
        totalChunks
      });
      
      // Log progress occasionally
      if (chunkIndex % 10 === 0 || chunkIndex === totalChunks - 1) {
        console.log(`File transfer ${fileId}: ${chunkIndex+1}/${totalChunks} chunks sent`);
      }
    }
  });

  socket.on('file-complete', (payload) => {
    const { roomId, fileId } = payload;
    if (rooms[roomId]) {
      socket.to(roomId).emit('file-complete', {
        sender: socket.id,
        fileId
      });
      console.log(`File transfer ${fileId} completed by user ${socket.id}`);
    }
  });

  socket.on('file-reject', (payload) => {
    const { target, fileId, reason } = payload;
    io.to(target).emit('file-reject', {
      sender: socket.id,
      fileId,
      reason
    });
    console.log(`File transfer ${fileId} rejected by user ${socket.id}: ${reason}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    for (const roomId in rooms) {
      const room = rooms[roomId];
      
      if (room.participants.includes(socket.id)) {
        // Remove user from room
        room.participants = room.participants.filter(id => id !== socket.id);
        
        // Notify other users
        io.to(roomId).emit('user-disconnected', socket.id);
        
        // Add system message
        const messageObj = {
          sender: 'system',
          text: `User ${socket.id.substring(0, 4)} has left the room`,
          timestamp: new Date().toISOString()
        };
        
        room.messages.push(messageObj);
        io.to(roomId).emit('new-message', messageObj);
        
        // Remove room if empty
        if (room.participants.length === 0) {
          delete rooms[roomId];
          console.log(`Room deleted: ${roomId}`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Secure server running at https://0.0.0.0:${PORT}`);
});
