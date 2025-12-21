(() => {
  const socket = io();

  // UI elements
  const btnCreate = document.getElementById('btnCreate');
  const btnJoin = document.getElementById('btnJoin');
  const btnGlobal = document.getElementById('btnGlobal');
  const btnSettings = document.getElementById('btnSettings');
  const modal = document.getElementById('modal');
  const createForm = document.getElementById('createForm');
  const joinForm = document.getElementById('joinForm');
  const settingsForm = document.getElementById('settingsForm');
  const modalClose = document.getElementById('modalClose');
  const createSubmit = document.getElementById('createSubmit');
  const joinSubmit = document.getElementById('joinSubmit');
  const createCancel = document.getElementById('createCancel');
  const joinCancel = document.getElementById('joinCancel');
  const settingsClose = document.getElementById('settingsClose');
  const pane = document.getElementById('pane');
  const hero = document.getElementById('hero');
  const chatTitle = document.getElementById('chatTitle');
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
  const createSafe = document.getElementById('createSafe');

  // Join inputs
  const joinUsername = document.getElementById('joinUsername');
  const joinCode = document.getElementById('joinCode');
  const joinPassword = document.getElementById('joinPassword');

  // Settings elements
  const themeDark = document.getElementById('themeDark');
  const themeLight = document.getElementById('themeLight');
  const toggleShortcut = document.getElementById('toggleShortcut');

  let currentRoom = null;
  let isHost = false;
  let myUsername = null;
  let ownerId = null;
  let ownerName = null;

  // Settings persisted
  const SETTINGS_KEY = 'divine_chat_settings_v1';
  const defaultSettings = { theme: 'dark', shortcutEnabled: true };
  let settings = loadSettings();

  applySettingsToUI();

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...defaultSettings };
      return { ...defaultSettings, ...JSON.parse(raw) };
    } catch {
      return { ...defaultSettings };
    }
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  function applySettingsToUI() {
    if (settings.theme === 'light') document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');

    toggleShortcut.checked = !!settings.shortcutEnabled;
    if (settings.theme === 'light') {
      themeDark.classList.remove('active');
      themeLight.classList.add('active');
    } else {
      themeDark.classList.add('active');
      themeLight.classList.remove('active');
    }
  }

  function showToast(msg, duration = 2500) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), duration);
  }

  function showModal(which) {
    modal.classList.remove('hidden');
    createForm.classList.add('hidden');
    joinForm.classList.add('hidden');
    settingsForm.classList.add('hidden');
    if (which === 'create') createForm.classList.remove('hidden');
    if (which === 'join') joinForm.classList.remove('hidden');
    if (which === 'settings') settingsForm.classList.remove('hidden');
  }
  function closeModal() { modal.classList.add('hidden'); }

  btnCreate.addEventListener('click', () => showModal('create'));
  btnJoin.addEventListener('click', () => showModal('join'));
  btnSettings.addEventListener('click', () => showModal('settings'));
  btnGlobal.addEventListener('click', () => {
    const name = prompt('Enter a username for Global Chat:', 'Guest');
    if (!name) return;
    socket.emit('joinGlobal', { username: name }, (res) => {
      if (!res || !res.ok) return showToast(res && res.message ? res.message : 'Failed to join global');
      enterRoom(res.room, name, res.messages || [], res.users || [], res.ownerId, res.ownerUsername);
    });
  });

  modalClose.addEventListener('click', closeModal);
  createCancel.addEventListener('click', closeModal);
  joinCancel.addEventListener('click', closeModal);
  settingsClose.addEventListener('click', () => {
    // save settings
    settings.shortcutEnabled = !!toggleShortcut.checked;
    settings.theme = themeLight.classList.contains('active') ? 'light' : 'dark';
    saveSettings();
    applySettingsToUI();
    closeModal();
  });

  themeDark.addEventListener('click', () => {
    themeDark.classList.add('active');
    themeLight.classList.remove('active');
  });
  themeLight.addEventListener('click', () => {
    themeLight.classList.add('active');
    themeDark.classList.remove('active');
  });

  createSubmit.addEventListener('click', () => {
    const username = createUsername.value.trim();
    const code = createCode.value.trim();
    const password = createPassword.value;
    const max = createMax.value;
    const safe = createSafe.checked;
    if (!username || !code) return showToast('Username and Code required');
    socket.emit('createRoom', { username, code, password, maxUsers: max, safe }, (res) => {
      if (!res || !res.ok) return showToast(res && res.message ? res.message : 'Failed to create');
      enterRoom(res.room, username, res.messages || [], res.users || [], res.ownerId, res.ownerUsername);
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
      enterRoom(res.room, username, res.messages || [], res.users || [], res.ownerId, res.ownerUsername);
      closeModal();
    });
  });

  function enterRoom(room, username, messages = [], users = [], owner, ownerUsernameParam) {
    currentRoom = room.code;
    myUsername = username;
    ownerId = owner || null;
    ownerName = ownerUsernameParam || null;
    isHost = (socket.id === ownerId);
    hero.classList.add('hidden');
    pane.classList.remove('hidden');

    chatTitle.textContent = room.isGlobal ? 'Global Chat' : 'Private Chat';

    updateUserList(users, ownerId, ownerUsernameParam);
    messagesEl.innerHTML = '';
    messages.forEach(m => appendMessage(m));
    if (room.isGlobal) {
      btnClear.disabled = true;
      btnClear.classList.add('muted');
    } else {
      btnClear.disabled = false;
      btnClear.classList.remove('muted');
    }
    setTimeout(() => msgInput.focus(), 200);
  }

  function updateUserList(users, ownerIdParam, ownerUsernameParam) {
    ownerId = ownerIdParam || ownerId;
    ownerName = ownerUsernameParam || ownerName;
    userListEl.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      const left = document.createElement('div'); left.className = 'left';
      const avatar = document.createElement('div'); avatar.className = 'avatar';
      avatar.textContent = (u.username || 'U').slice(0,1).toUpperCase();
      const name = document.createElement('div'); name.textContent = u.username;
      left.appendChild(avatar); left.appendChild(name);
      li.appendChild(left);

      const right = document.createElement('div'); right.className = 'right';
      const badge = document.createElement('span'); badge.className = 'user-badge';
      if (u.socketId === ownerId) {
        badge.textContent = 'Host';
      } else {
        badge.textContent = '';
      }
      right.appendChild(badge);
      li.appendChild(right);
      userListEl.appendChild(li);
    });
  }

  // Server sends userList: { users, ownerId, ownerUsername }
  socket.on('userList', (payload) => {
    const users = (payload && payload.users) ? payload.users : [];
    updateUserList(users, payload.ownerId, payload.ownerUsername);
    // update isHost if owner changed
    isHost = (socket.id === payload.ownerId);
    ownerName = payload.ownerUsername || ownerName;
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
    if (ownerName && m.username === ownerName) div.classList.add('host');
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
    socket.emit('leaveRoom');
    currentRoom = null;
    hero.classList.remove('hidden');
    pane.classList.add('hidden');
    messagesEl.innerHTML = '';
    userListEl.innerHTML = '';
    if (kicked) {
      showToast(reason || 'Kicked from room');
    }
  }

  // Handle beforeunload — for safe rooms, emit client-refresh so server may delete the room.
  window.addEventListener('beforeunload', (e) => {
    try {
      if (currentRoom && currentRoom !== 'GLOBAL_CHAT_DIVINE') {
        // best-effort: notify server that this client refreshed, which may delete the room (if safe)
        socket.emit('client-refresh');
      }
    } catch (err) {
      // ignore
    }
  });

  // Shortcut Ctrl+Alt+C to clear (host) — respects user setting
  window.addEventListener('keydown', (e) => {
    if (!settings.shortcutEnabled) return;
    if (e.ctrlKey && e.altKey && (e.key === 'c' || e.key === 'C')) {
      btnClear.click();
    }
  });

  // Escape closes modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Helper: when user clicks Global prompt or anywhere, server responses handle duplicates

})();
