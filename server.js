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
//   isGlobal: boolean,
//   safe: boolean
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
  isGlobal: true,
  safe: false
};

function sanitizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildUserList(room) {
  const users = Object.entries(room.users).map(([sid, u]) => ({
    username: u.username,
    socketId: sid,
    joinedAt: u.joinedAt
  }));
  const ownerUsername = room.ownerId && room.users[room.ownerId] ? room.users[room.ownerId].username : null;
  return { users, ownerId: room.ownerId, ownerUsername };
}

function reassignOwnerIfNeeded(room) {
  // If owner is missing or disconnected, pick a new owner if there are users
  if (!room) return;
  if (room.ownerId && room.users[room.ownerId]) return; // owner still present
  const sids = Object.keys(room.users);
  if (sids.length === 0) {
    // No users; delete non-global rooms to free memory
    if (!room.isGlobal) {
      delete rooms[room.code];
      console.log(`Room ${room.code} deleted because empty.`);
    } else {
      room.ownerId = null;
    }
    return;
  }
  // pick first user as new owner
  room.ownerId = sids[0];
  const newOwnerName = room.users[room.ownerId] ? room.users[room.ownerId].username : null;
  io.to(room.code).emit('systemMessage', { text: `${newOwnerName || 'Someone'} is now the host.` });
  const userList = buildUserList(room);
  io.to(room.code).emit('userList', { users: userList.users, ownerId: userList.ownerId, ownerUsername: userList.ownerUsername });
}

io.on('connection', (socket) => {
  socket.data.currentRoom = null;
  socket.data.username = null;
  socket.data.lastMessageTs = 0;

  // Create a room
  socket.on('createRoom', async (payload, cb) => {
    try {
      const { username, code, password, maxUsers, safe } = payload || {};
      if (!username || !code) return cb && cb({ ok: false, message: 'Username and code required.' });
      const key = String(code).trim();
      if (rooms[key]) return cb && cb({ ok: false, message: 'Room code already exists.' });

      const parsedMax = parseInt(maxUsers);
      const finalMax = Number.isInteger(parsedMax) ? Math.max(2, Math.min(parsedMax, 200)) : 10;
      const saltRounds = 10;
      const passwordHash = password ? await bcrypt.hash(String(password), saltRounds) : null;

      rooms[key] = {
        code: key,
        ownerId: socket.id,
        passwordHash,
        maxUsers: finalMax,
        users: {},
        messages: [],
        isGlobal: false,
        safe: safe === undefined ? true : !!safe,
      };

      // Add creator to room
      const safeName = sanitizeText(username);
      rooms[key].users[socket.id] = { username: safeName, joinedAt: Date.now() };
      socket.join(key);
      socket.data.currentRoom = key;
      socket.data.username = safeName;

      const userList = buildUserList(rooms[key]);
      cb && cb({ ok: true, room: { code: key, maxUsers: finalMax, isGlobal: false, safe: rooms[key].safe }, messages: rooms[key].messages, users: userList.users, ownerId: userList.ownerId, ownerUsername: userList.ownerUsername });
      io.to(key).emit('userList', { users: userList.users, ownerId: userList.ownerId, ownerUsername: userList.ownerUsername });
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

      // username uniqueness (case-insensitive)
      const unameLower = String(username).trim().toLowerCase();
      const nameTaken = Object.values(room.users).some(u => (u.username || '').toLowerCase() === unameLower);
      if (nameTaken) return cb && cb({ ok: false, message: 'Username already taken in this room.' });

      if (!room.isGlobal && room.passwordHash) {
        const ok = await bcrypt.compare(String(password || ''), room.passwordHash);
        if (!ok) return cb && cb({ ok: false, message: 'Incorrect password.' });
      }
      const userCount = Object.keys(room.users).length;
      if (userCount >= room.maxUsers) return cb && cb({ ok: false, message: 'Room is full.' });

      const safeName = sanitizeText(username);
      room.users[socket.id] = { username: safeName, joinedAt: Date.now() };
      socket.join(key);
      socket.data.currentRoom = key;
      socket.data.username = safeName;

      const userList = buildUserList(room);
      cb && cb({ ok: true, room: { code: key, maxUsers: room.maxUsers, isGlobal: room.isGlobal, safe: room.safe }, messages: room.messages, users: userList.users, ownerId: userList.ownerId, ownerUsername: userList.ownerUsername });
      io.to(key).emit('userList', { users: userList.users, ownerId: userList.ownerId, ownerUsername: userList.ownerUsername });
      io.to(key).emit('systemMessage', { text: `${safeName} joined the room.` });
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

    const unameLower = String(username).trim().toLowerCase();
    const nameTaken = Object.values(room.users).some(u => (u.username || '').toLowerCase() === unameLower);
    if (nameTaken) return cb && cb({ ok: false, message: 'Username already taken in global chat.' });

    const safeName = sanitizeText(username);
    room.users[socket.id] = { username: safeName, joinedAt: Date.now() };
    socket.join(GLOBAL_CODE);
    socket.data.currentRoom = GLOBAL_CODE;
    socket.data.username = safeName;
    const userList = buildUserList(room);
    cb && cb({ ok: true, room: { code: GLOBAL_CODE, isGlobal: true, safe: room.safe }, messages: room.messages, users: userList.users, ownerId: userList.ownerId, ownerUsername: userList.ownerUsername });
    io.to(GLOBAL_CODE).emit('userList', { users: userList.users, ownerId: userList.ownerId, ownerUsername: userList.ownerUsername });
    io.to(GLOBAL_CODE).emit('systemMessage', { text: `${safeName} joined Global Chat.` });
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

  // Typing indicator (simple broadcast to room)
  socket.on('typing', (payload) => {
    try {
      const roomKey = socket.data.currentRoom;
      if (!roomKey) return;
      const username = socket.data.username || 'Unknown';
      const typing = !!(payload && payload.typing);
      // Broadcast to others in room
      socket.to(roomKey).emit('typing', { username, socketId: socket.id, typing });
    } catch (err) {
      // ignore
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

      // Only delete room if it's a safe room
      if (room.safe) {
        io.to(roomKey).emit('kicked', { reason: 'Room closed due to page refresh (safe room).' });

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
        console.log(`Room ${roomKey} deleted due to client refresh (safe room).`);
      } else {
        // Not a safe room: do nothing special. The user's normal disconnect will remove them.
        console.log(`Client refresh in non-safe room ${roomKey} — no room deletion.`);
      }
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

    // If the leaving user was the owner, reassign
    if (room.ownerId === socket.id) {
      reassignOwnerIfNeeded(room);
    } else {
      const userList = buildUserList(room);
      io.to(roomKey).emit('userList', { users: userList.users, ownerId: userList.ownerId, ownerUsername: userList.ownerUsername });
    }
  });

  socket.on('disconnect', () => {
    // On disconnect, remove from room users list but do NOT delete room (unless owner/empty)
    const roomKey = socket.data.currentRoom;
    if (roomKey) {
      const room = rooms[roomKey];
      if (room) {
        delete room.users[socket.id];
        // If the disconnected user was the owner, reassign
        if (room.ownerId === socket.id) {
          reassignOwnerIfNeeded(room);
        } else {
          const userList = buildUserList(room);
          io.to(roomKey).emit('userList', { users: userList.users, ownerId: userList.ownerId, ownerUsername: userList.ownerUsername });
        }
        // Do not delete room on disconnect; delete only on client-refresh for safe rooms or if empty handled in reassignOwnerIfNeeded
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
