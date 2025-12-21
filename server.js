const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from public
app.use(express.static('public'));

// In-memory room store
// room = {
//   code,
//   ownerId,
//   passwordHash,
//   maxUsers,
//   users: { socketId: { username, joinedAt } },
//   messages: [ { username, text, ts } ],
//   isGlobal: boolean
// }
const rooms = {};

// Create global room
const GLOBAL_CODE = 'GLOBAL_CHAT_DIVINE';
rooms[GLOBAL_CODE] = {
  code: GLOBAL_CODE,
  ownerId: null,
  passwordHash: null,
  maxUsers: Infinity,
  users: {},
  messages: [],
  isGlobal: true
};

function sanitizeText(text) {
  // Basic sanitization: escape <, >, &, ", '
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

io.on('connection', (socket) => {
  socket.data.currentRoom = null;
  socket.data.username = null;
  socket.data.lastMessageTs = 0;

  // Create a room
  socket.on('createRoom', async (payload, cb) => {
    try {
      const { username, code, password, maxUsers } = payload || {};
      if (!username || !code) return cb && cb({ ok: false, message: 'Username and code required.' });
      const key = String(code).trim();
      if (rooms[key]) return cb && cb({ ok: false, message: 'Room code already exists.' });
      const parsedMax = parseInt(maxUsers) || 10;
      const finalMax = Math.max(2, Math.min(parsedMax, 200));
      const saltRounds = 10;
      const passwordHash = password ? await bcrypt.hash(String(password), saltRounds) : null;

      rooms[key] = {
        code: key,
        ownerId: socket.id,
        passwordHash,
        maxUsers: finalMax,
        users: {},
        messages: [],
        isGlobal: false
      };

      // Add creator to room
      rooms[key].users[socket.id] = { username: sanitizeText(username), joinedAt: Date.now() };
      socket.join(key);
      socket.data.currentRoom = key;
      socket.data.username = sanitizeText(username);

      cb && cb({ ok: true, room: { code: key, maxUsers: finalMax }, messages: rooms[key].messages, users: Object.values(rooms[key].users) });
      io.to(key).emit('userList', { users: Object.values(rooms[key].users), ownerId: rooms[key].ownerId });
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false, message: 'Server error' });
    }
  });

  // Join a room
  socket.on('joinRoom', async (payload, cb) => {
    try {
      const { username, code, password } = payload || {};
      if (!username || !code) return cb && cb({ ok: false, message: 'Username and code required.' });
      const key = String(code).trim();
      const room = rooms[key];
      if (!room) return cb && cb({ ok: false, message: 'Room not found.' });
      if (!room.isGlobal && room.passwordHash) {
        const ok = await bcrypt.compare(String(password || ''), room.passwordHash);
        if (!ok) return cb && cb({ ok: false, message: 'Incorrect password.' });
      }
      const userCount = Object.keys(room.users).length;
      if (userCount >= room.maxUsers) return cb && cb({ ok: false, message: 'Room is full.' });

      room.users[socket.id] = { username: sanitizeText(username), joinedAt: Date.now() };
      socket.join(key);
      socket.data.currentRoom = key;
      socket.data.username = sanitizeText(username);

      cb && cb({ ok: true, room: { code: key, maxUsers: room.maxUsers, isGlobal: room.isGlobal }, messages: room.messages, users: Object.values(room.users), ownerId: room.ownerId });
      io.to(key).emit('userList', { users: Object.values(room.users), ownerId: room.ownerId });
      io.to(key).emit('systemMessage', { text: `${sanitizeText(username)} joined the room.` });
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false, message: 'Server error' });
    }
  });

  // Join global (convenience)
  socket.on('joinGlobal', (payload, cb) => {
    const { username } = payload || {};
    if (!username) return cb && cb({ ok: false, message: 'Username required.' });
    const room = rooms[GLOBAL_CODE];
    room.users[socket.id] = { username: sanitizeText(username), joinedAt: Date.now() };
    socket.join(GLOBAL_CODE);
    socket.data.currentRoom = GLOBAL_CODE;
    socket.data.username = sanitizeText(username);
    cb && cb({ ok: true, room: { code: GLOBAL_CODE, isGlobal: true }, messages: room.messages, users: Object.values(room.users) });
    io.to(GLOBAL_CODE).emit('userList', { users: Object.values(room.users), ownerId: room.ownerId });
    io.to(GLOBAL_CODE).emit('systemMessage', { text: `${sanitizeText(username)} joined Global Chat.` });
  });

  // Send message
  socket.on('sendMessage', (payload, cb) => {
    try {
      const { text } = payload || {};
      const roomKey = socket.data.currentRoom;
      const username = socket.data.username || 'Unknown';
      if (!roomKey) return cb && cb({ ok: false, message: 'Not in a room.' });
      if (!text || !String(text).trim()) return cb && cb({ ok: false, message: 'Empty message.' });

      const now = Date.now();
      if (now - socket.data.lastMessageTs < 200) return cb && cb({ ok: false, message: 'You are sending messages too quickly.' });
      socket.data.lastMessageTs = now;

      const room = rooms[roomKey];
      if (!room) return cb && cb({ ok: false, message: 'Room not found.' });

      const safeText = sanitizeText(String(text).slice(0, 2000));
      const msg = { username, text: safeText, ts: now };
      room.messages.push(msg);
      if (room.messages.length > 500) room.messages.shift();

      io.to(roomKey).emit('newMessage', msg);
      cb && cb({ ok: true });
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false, message: 'Server error' });
    }
  });

  // Host clear chat
  socket.on('clearRoom', (payload, cb) => {
    try {
      const roomKey = socket.data.currentRoom;
      if (!roomKey) return cb && cb({ ok: false, message: 'Not in a room.' });
      const room = rooms[roomKey];
      if (!room) return cb && cb({ ok: false, message: 'Room not found.' });
      if (room.isGlobal) return cb && cb({ ok: false, message: 'Cannot clear global chat.' });
      if (room.ownerId !== socket.id) return cb && cb({ ok: false, message: 'Only the host can clear the chat.' });

      room.messages = [];
      io.to(roomKey).emit('roomCleared', { by: socket.data.username || 'host' });
      cb && cb({ ok: true });
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false, message: 'Server error' });
    }
  });

  // Client explicitly signals refresh/kill action (private rooms only)
  socket.on('client-refresh', (payload) => {
    try {
      const roomKey = socket.data.currentRoom;
      if (!roomKey) return;
      const room = rooms[roomKey];
      if (!room || room.isGlobal) return;

      // Delete the room and notify everyone
      io.to(roomKey).emit('kicked', { reason: 'Room closed due to page refresh.' });

      // Remove users from room and close it
      const socketsToLeave = Object.keys(room.users || {});
      socketsToLeave.forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.leave(roomKey);
          s.data.currentRoom = null;
        }
      });

      delete rooms[roomKey];
      console.log(`Room ${roomKey} deleted due to client refresh.`);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('leaveRoom', () => {
    const roomKey = socket.data.currentRoom;
    if (!roomKey) return;
    const room = rooms[roomKey];
    if (!room) {
      socket.data.currentRoom = null;
      return;
    }
    delete room.users[socket.id];
    socket.leave(roomKey);
    socket.data.currentRoom = null;
    io.to(roomKey).emit('userList', { users: Object.values(room.users), ownerId: room.ownerId });
  });

  socket.on('disconnect', () => {
    // On disconnect, remove from room users list but do NOT delete room.
    const roomKey = socket.data.currentRoom;
    if (roomKey) {
      const room = rooms[roomKey];
      if (room) {
        delete room.users[socket.id];
        io.to(roomKey).emit('userList', { users: Object.values(room.users), ownerId: room.ownerId });
        // Do not delete room on disconnect; delete only on client-refresh event to implement "kick everyone" behavior.
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
