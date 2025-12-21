(() => {
  const socket = io();
  // UI elements
  const btnCreate = document.getElementById('btnCreate');
  const btnJoin = document.getElementById('btnJoin');
  const btnGlobal = document.getElementById('btnGlobal');
  const modal = document.getElementById('modal');
  const createForm = document.getElementById('createForm');
  const joinForm = document.getElementById('joinForm');
  const modalClose = document.getElementById('modalClose');
  const createSubmit = document.getElementById('createSubmit');
  const joinSubmit = document.getElementById('joinSubmit');
  const createCancel = document.getElementById('createCancel');
  const joinCancel = document.getElementById('joinCancel');
  const pane = document.getElementById('pane');
  const hero = document.getElementById('hero');
  const roomCodeEl = document.getElementById('roomCode');
  const roomTypeEl = document.getElementById('roomType');
  const userListEl = document.getElementById('userList');
  const messagesEl = document.getElementById('messages');
  const msgForm = document.getElementById('msgForm');
  const msgInput = document.getElementById('msgInput');
  const btnClear = document.getElementById('btnClear');
  const btnLeave = document.getElementById('btnLeave');
  const toast = document.getElementById('toast');

  // Create inputs
  const createUsername = document.getElementById('createUsername');
  const createCode = document.getElementById('createCode');
  const createPassword = document.getElementById('createPassword');
  const createMax = document.getElementById('createMax');

  // Join inputs
  const joinUsername = document.getElementById('joinUsername');
  const joinCode = document.getElementById('joinCode');
  const joinPassword = document.getElementById('joinPassword');

  let currentRoom = null;
  let isHost = false;
  let myUsername = null;
  let ownerId = null;

  function showToast(msg, duration = 2500) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), duration);
  }

  function showModal(which) {
    modal.classList.remove('hidden');
    createForm.classList.add('hidden');
    joinForm.classList.add('hidden');
    if (which === 'create') createForm.classList.remove('hidden');
    if (which === 'join') joinForm.classList.remove('hidden');
  }
  function closeModal() { modal.classList.add('hidden'); }

  btnCreate.addEventListener('click', () => showModal('create'));
  btnJoin.addEventListener('click', () => showModal('join'));
  btnGlobal.addEventListener('click', () => {
    const name = prompt('Enter a username for Global Chat:', 'Guest');
    if (!name) return;
    socket.emit('joinGlobal', { username: name }, (res) => {
      if (!res || !res.ok) return showToast(res && res.message ? res.message : 'Failed to join global');
      enterRoom(res.room, name, res.messages || [], res.users || [], res.ownerId);
    });
  });

  modalClose.addEventListener('click', closeModal);
  createCancel.addEventListener('click', closeModal);
  joinCancel.addEventListener('click', closeModal);

  createSubmit.addEventListener('click', () => {
    const username = createUsername.value.trim();
    const code = createCode.value.trim();
    const password = createPassword.value;
    const max = createMax.value;
    if (!username || !code) return showToast('Username and Code required');
    socket.emit('createRoom', { username, code, password, maxUsers: max }, (res) => {
      if (!res || !res.ok) return showToast(res && res.message ? res.message : 'Failed to create');
      enterRoom(res.room, username, res.messages || [], res.users || [], res.ownerId);
      closeModal();
    });
  });

  joinSubmit.addEventListener('click', () => {
    const username = joinUsername.value.trim();
    const code = joinCode.value.trim();
    const password = joinPassword.value;
    if (!username || !code) return showToast('Username and Code required');
    socket.emit('joinRoom', { username, code, password }, (res) => {
      if (!res || !res.ok) return showToast(res && res.message ? res.message : 'Failed to join');
      enterRoom(res.room, username, res.messages || [], res.users || [], res.ownerId);
      closeModal();
    });
  });

  function enterRoom(room, username, messages = [], users = [], owner) {
    currentRoom = room.code;
    myUsername = username;
    ownerId = owner || null;
    isHost = owner === socket.id || (room.isGlobal && false);
    hero.classList.add('hidden');
    pane.classList.remove('hidden');
    roomCodeEl.textContent = room.code === 'GLOBAL_CHAT_DIVINE' ? 'Global Chat' : `Room: ${room.code}`;
    roomTypeEl.textContent = room.isGlobal ? '(Global)' : '(Private)';
    updateUserList(users);
    messagesEl.innerHTML = '';
    messages.forEach(m => appendMessage(m));
    if (room.isGlobal) {
      btnClear.disabled = true;
      btnClear.classList.add('muted');
    } else {
      btnClear.disabled = false;
      btnClear.classList.remove('muted');
    }
    // mark host if applicable
    if (room.code && room.code !== 'GLOBAL_CHAT_DIVINE') {
      // owner id was provided by server (if available)
    }
    // focus message input
    setTimeout(() => msgInput.focus(), 200);
  }

  function updateUserList(users) {
    userListEl.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = u.username;
      const badge = document.createElement('span');
      badge.className = 'user-badge';
      // mark host if ownerId matches (server may send ownerId separately)
      li.appendChild(name);
      if (u.socketId === ownerId) {
        badge.textContent = 'Host';
        li.appendChild(badge);
        li.classList.add('host');
      } else {
        li.appendChild(badge);
        badge.textContent = '';
      }
      userListEl.appendChild(li);
    });
  }

  // Server sends userList: { users, ownerId }
  socket.on('userList', (payload) => {
    ownerId = payload && payload.ownerId;
    const users = (payload && payload.users) ? payload.users.map(u => ({ username: u.username, socketId: u.socketId })) : [];
    // The server returns array of user objects without socketId in some cases; handle flexible
    updateUserList(payload && payload.users ? payload.users : []);
  });

  socket.on('systemMessage', (m) => {
    appendSystem(m.text || '');
  });

  socket.on('newMessage', (m) => {
    appendMessage(m);
  });

  socket.on('roomCleared', (payload) => {
    messagesEl.innerHTML = '';
    appendSystem(`Chat cleared by ${payload && payload.by ? payload.by : 'host'}`);
  });

  socket.on('kicked', (payload) => {
    leaveRoom(true, payload && payload.reason);
  });

  msgForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit('sendMessage', { text }, (res) => {
      if (!res || !res.ok) {
        showToast(res && res.message ? res.message : 'Failed to send');
      } else {
        msgInput.value = '';
      }
    });
  });

  function appendMessage(m) {
    const div = document.createElement('div');
    div.className = 'msg';
    if (m.username === myUsername) div.classList.add('me');
    if (m.username && ownerId && m.username === 'host') div.classList.add('host');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = new Date(m.ts || Date.now());
    meta.textContent = `${m.username} • ${t.toLocaleTimeString()}`;
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = escapeHtml(m.text);
    div.appendChild(meta);
    div.appendChild(body);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br/>');
  }

  // Clear chat (host only)
  btnClear.addEventListener('click', () => {
    if (!currentRoom || currentRoom === 'GLOBAL_CHAT_DIVINE') return showToast('Cannot clear global chat');
    socket.emit('clearRoom', {}, (res) => {
      if (!res || !res.ok) showToast(res && res.message ? res.message : 'Failed to clear');
    });
  });

  // Leave room
  btnLeave.addEventListener('click', () => {
    leaveRoom(false);
  });

  function leaveRoom(kicked = false, reason = '') {
    // tell server to leave (normal leave)
    socket.emit('leaveRoom');
    currentRoom = null;
    hero.classList.remove('hidden');
    pane.classList.add('hidden');
    roomCodeEl.textContent = '';
    messagesEl.innerHTML = '';
    userListEl.innerHTML = '';
    if (kicked) {
      showToast(reason || 'Kicked from room');
    }
  }

  // Handle beforeunload — important: for private rooms, emit client-refresh to trigger server delete.
  window.addEventListener('beforeunload', (e) => {
    try {
      if (currentRoom && currentRoom !== 'GLOBAL_CHAT_DIVINE') {
        // best-effort: notify server that this client refreshed, which will delete the room and kick everyone
        socket.emit('client-refresh');
        // let it finish if possible
      }
    } catch (err) {
      // ignore
    }
  });

  // Shortcut Ctrl+Alt+C to clear (host)
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && (e.key === 'c' || e.key === 'C')) {
      btnClear.click();
    }
  });

  // Helper: when user presses Escape, close modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Optional: some UI polish for username prompts on direct global entry
  // Everything else is handled by server events

})();
