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

  const safeIndicator = document.getElementById('safeIndicator');
  const typingEl = document.getElementById('typing');

  const openStickersBtn = document.getElementById('open-stickers');
  const stickerPanel = document.getElementById('stickerPanel');
  const stickersGrid = document.getElementById('stickers');
  const closeStickersBtn = document.getElementById('close-stickers');
  // Theme options now are larger boxes with data-theme attribute
  const themeOptions = document.querySelectorAll('.theme-option');
  const themeDark = document.getElementById('themeDark');
  const themeLight = document.getElementById('themeLight');
  const toggleShortcut = document.getElementById('toggleShortcut');

  let currentRoom = null;
  let isHost = false;
  let myUsername = null;
  let ownerId = null;
  let ownerName = null;

  // Typing state
  let typingTimeout = null;
  const typingUsers = new Map(); // socketId -> username

  // Settings persisted
  const SETTINGS_KEY = 'divine_chat_settings_v2';
  const defaultSettings = { themeClass: '', theme: 'dark', shortcutEnabled: true };
  let settings = loadSettings();

  // Ban settings / rules: adjust here to add words, warnings, duration (hours)
  // Example: 'fart' gives 2 warnings then 72 hours ban
  const BANNED_WORDS = [
    { word: 'fuck', warnings: 2, durationHours: 24 }, // easy to add more entries here
    { word: 'shit', warnings: 2, durationHours: 6 },
    { word: 'dick', warnings: 2, durationHours: 8 },
    { word: 'nig', warnings: 1, durationHours: 720 },
    { word: 'bitch', warnings: 2, durationHours: 12 },
    { word: 'cock', warnings: 2, durationHours: 8 },
    { word: 'retard', warnings: 1, durationHours: 168 },
    { word: 'idiot', warnings: 5, durationHours: 1 },
    { word: 'cum', warnings: 3, durationHours: 6 },
    { word: 'cunt', warnings: 2, durationHours: 24 },
    { word: 'dumbass', warnings: 3, durationHours: 6 }
  ];

  applySettingsToUI();

  // Sticker manifest default path
  const STICKER_MANIFEST = '/assets/stickers/index.json';

  // check immediate ban on load
  if (getCookie('divine_ban')) {
    // redirect to ban page
    window.location.href = '/ban.html';
  }

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
    // theme class (forest, amethyst, ocean, kawaii)
    document.body.classList.remove('theme-forest','theme-amethyst','theme-ocean','theme-kawaii');
    if (settings.themeClass) document.body.classList.add(settings.themeClass);

    // light vs dark (legacy)
    if (settings.theme === 'light') document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');

    toggleShortcut.checked = !!settings.shortcutEnabled;
    if (settings.theme === 'light') {
      themeDark && themeDark.classList.remove('active');
      themeLight && themeLight.classList.add('active');
    } else {
      themeDark && themeDark.classList.add('active');
      themeLight && themeLight.classList.remove('active');
    }

    // mark active among modern theme options
    themeOptions.forEach(opt => {
      const cls = opt.getAttribute('data-theme-class') || '';
      const themeKey = opt.getAttribute('data-theme') || '';
      if (settings.themeClass === cls || settings.theme === themeKey) {
        opt.classList.add('active');
      } else {
        opt.classList.remove('active');
      }
    });
  }

  function showToast(msg, duration = 2500, type = 'info') {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.toggle('error', type === 'error');
    setTimeout(() => {
      toast.classList.add('hidden');
      toast.classList.remove('error');
    }, duration);
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
  btnSettings.addEventListener('click', () => {
    // re-apply UI before showing
    settings = loadSettings();
    applySettingsToUI();
    showModal('settings');
  });
  btnGlobal.addEventListener('click', () => {
    const name = prompt('Enter a username for Global Chat:', 'Guest');
    if (!name) return;
    socket.emit('joinGlobal', { username: name }, (res) => {
      if (!res || !res.ok) return showToast(res && res.message ? res.message : 'Failed to join global', 3000, 'error');
      enterRoom(res.room, name, res.messages || [], res.users || [], res.ownerId, res.ownerUsername);
    });
  });

  modalClose.addEventListener('click', closeModal);
  createCancel.addEventListener('click', closeModal);
  joinCancel.addEventListener('click', closeModal);
  settingsClose.addEventListener('click', () => {
    // save settings
    settings.shortcutEnabled = !!toggleShortcut.checked;
    // theme (legacy)
    settings.theme = themeLight && themeLight.classList.contains('active') ? 'light' : 'dark';
    saveSettings();
    applySettingsToUI();
    closeModal();
  });

  themeDark && themeDark.addEventListener('click', () => {
    themeDark.classList.add('active');
    themeLight && themeLight.classList.remove('active');
    settings.theme = 'dark';
  });
  themeLight && themeLight.addEventListener('click', () => {
    themeLight.classList.add('active');
    themeDark && themeDark.classList.remove('active');
    settings.theme = 'light';
  });

  // theme options (modern large boxes)
  themeOptions.forEach(btn => {
    btn.addEventListener('click', () => {
      const cls = btn.getAttribute('data-theme-class') || '';
      const theme = btn.getAttribute('data-theme') || '';
      // update settings: prefer themeClass for custom themes; for default/dark/light, use theme key
      settings.themeClass = cls;
      if (theme) settings.theme = theme;
      saveSettings();
      applySettingsToUI();
      showToast(`Theme: ${btn.title || theme || 'Custom'}`, 1200);
    });
  });

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

  createSubmit.addEventListener('click', () => {
    const username = createUsername.value.trim();
    const code = createCode.value.trim();
    const password = createPassword.value;
    const max = createMax.value;
    const safe = createSafe.checked;
    if (!username || !code) return showToast('Username and Code required', 2500, 'error');
    socket.emit('createRoom', { username, code, password, maxUsers: max, safe }, (res) => {
      if (!res || !res.ok) return showToast(res && res.message ? res.message : 'Failed to create', 3000, 'error');
      enterRoom(res.room, username, res.messages || [], res.users || [], res.ownerId, res.ownerUsername);
      closeModal();
    });
  });

  joinSubmit.addEventListener('click', () => {
    const username = joinUsername.value.trim();
    const code = joinCode.value.trim();
    const password = joinPassword.value;
    if (!username || !code) return showToast('Username and Code required', 2500, 'error');
    socket.emit('joinRoom', { username, code, password }, (res) => {
      if (!res || !res.ok) return showToast(res && res.message ? res.message : 'Failed to join', 3000, 'error');
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
    // safe indicator
    if (room.safe) {
      safeIndicator.textContent = 'Safe: ON';
      safeIndicator.title = 'Safe room — refresh will close the room and kick everyone';
    } else {
      safeIndicator.textContent = 'Safe: OFF';
      safeIndicator.title = 'Non-safe room — refresh will NOT kill the room';
    }

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

    // load stickers (when entering a room)
    loadStickers();
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

  // Listen for message edits & deletes (server-side support optional)
  socket.on('messageEdited', (payload) => {
    if (!payload || !payload.id) return;
    const el = document.querySelector(`[data-mid="${payload.id}"]`);
    if (el) updateMessageElement(el, payload);
  });

  socket.on('messageDeleted', (payload) => {
    if (!payload || !payload.id) return;
    const el = document.querySelector(`[data-mid="${payload.id}"]`);
    if (el) {
      // simple fade + replace with system note
      const system = document.createElement('div');
      system.className = 'msg system';
      system.textContent = 'Message deleted';
      el.replaceWith(system);
    }
  });

  socket.on('roomCleared', (payload) => {
    messagesEl.innerHTML = '';
    appendSystem(`Chat cleared by ${payload && payload.by ? payload.by : 'host'}`);
  });

  socket.on('kicked', (payload) => {
    leaveRoom(true, payload && payload.reason);
  });

  // Typing indicator events from server
  socket.on('typing', (payload) => {
    if (!payload || !payload.socketId) return;
    if (payload.typing) {
      typingUsers.set(payload.socketId, payload.username);
    } else {
      typingUsers.delete(payload.socketId);
    }
    renderTyping();
  });

  function renderTyping() {
    const names = Array.from(typingUsers.values()).filter(n => n && n !== myUsername);
    if (names.length === 0) {
      typingEl.classList.add('hidden');
      typingEl.textContent = '';
      return;
    }
    typingEl.classList.remove('hidden');
    if (names.length === 1) typingEl.textContent = `${names[0]} is typing...`;
    else typingEl.textContent = `${names.join(', ')} are typing...`;
  }

  // Ban & warnings utilities
  function getWarnKey(username, word) {
    return `divine_warn_${(username || 'anon')}_${word}`;
  }
  function incrementWarning(username, word) {
    const key = getWarnKey(username, word);
    const raw = localStorage.getItem(key);
    const cur = raw ? parseInt(raw, 10) || 0 : 0;
    const next = cur + 1;
    localStorage.setItem(key, String(next));
    return next;
  }
  function resetWarnings(username, word) {
    const key = getWarnKey(username, word);
    localStorage.removeItem(key);
  }
  function setCookie(name, value, hours) {
    const d = new Date();
    d.setTime(d.getTime() + (hours * 60 * 60 * 1000));
    const expires = "expires="+ d.toUTCString();
    document.cookie = name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/";
  }
  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }
  function removeCookie(name) {
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  }

  // Check message text for banned words. If detected: warn, popup and block send.
  // If warnings exceed threshold: set ban cookie (durationHours) and redirect to /ban.html
  function checkBannedTextBeforeSend(text) {
    if (!text) return true;
    const lowered = String(text).toLowerCase();
    for (const rule of BANNED_WORDS) {
      const needle = String(rule.word).toLowerCase();
      // simple substring match - you can change to regex if you like
      if (lowered.includes(needle)) {
        const warningsSoFar = incrementWarning(myUsername, needle);
        if (warningsSoFar >= (rule.warnings || 1)) {
          // set ban cookie and redirect
          const hours = rule.durationHours || 72;
          const until = Date.now() + hours * 60 * 60 * 1000;
          const payload = { word: needle, until, hours, by: myUsername || 'unknown' };
          setCookie('divine_ban', JSON.stringify(payload), hours);
          // show alert just before redirect so user is aware
          alert('You have been banned for using disallowed words.');
          window.location.href = '/ban.html';
          return false;
        } else {
          // show popup warning (requires click OK)
          alert('Message failed to send. Use kind words.');
          return false;
        }
      }
    }
    return true;
  }

  // msgForm submit now checks for banned words before emitting
  msgForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;
    // verify ban cookie again before send
    if (getCookie('divine_ban')) {
      window.location.href = '/ban.html';
      return;
    }
    if (!checkBannedTextBeforeSend(text)) {
      // blocked by ban/ warning
      return;
    }
    socket.emit('sendMessage', { text }, (res) => {
      if (!res || !res.ok) {
        showToast(res && res.message ? res.message : 'Failed to send', 3000, 'error');
      } else {
        msgInput.value = '';
        sendTyping(false); // stop typing when message sent
      }
    });
  });

  // Send sticker (also check banned words in filename)
  function sendSticker(filename) {
    if (!filename) return;
    if (getCookie('divine_ban')) {
      window.location.href = '/ban.html';
      return;
    }
    if (!checkBannedTextBeforeSend(filename)) return;
    socket.emit('sendMessage', { text: filename, type: 'sticker' }, (res) => {
      if (!res || !res.ok) {
        showToast(res && res.message ? res.message : 'Failed to send sticker', 3000, 'error');
      } else {
        // sticker sent; sticker will arrive via newMessage event
      }
    });
  }

  // Append message to DOM (supports markdown and stickers)
  function appendMessage(m) {
    const div = document.createElement('div');
    div.className = 'msg';
    const mid = getMessageId(m);
    div.setAttribute('data-mid', mid);

    if (m.username === myUsername) div.classList.add('me');
    if (ownerName && m.username === ownerName) div.classList.add('host');

    const meta = document.createElement('div');
    meta.className = 'meta';

    const metaLeft = document.createElement('div');
    metaLeft.className = 'meta-left';
    const t = new Date(m.ts || Date.now());
    const who = document.createElement('span');
    who.className = 'meta-who';
    who.textContent = m.username || 'Anon';
    const when = document.createElement('span');
    when.className = 'meta-time';
    when.textContent = ` • ${t.toLocaleTimeString()}`;

    metaLeft.appendChild(who);
    metaLeft.appendChild(when);
    meta.appendChild(metaLeft);

    // controls only for messages authored by me
    const controls = document.createElement('div');
    controls.className = 'msg-controls';
    if (m.username === myUsername) {
      // edit allowed for 1 minute after ts
      const ageSec = (Date.now() - (m.ts || Date.now())) / 1000;
      if (ageSec <= 60) {
        const btnEdit = document.createElement('button');
        btnEdit.title = 'Edit message (1 minute window)';
        btnEdit.innerHTML = '<svg width="16" height="16"><use href="#icon-pencil"></use></svg>';
        btnEdit.addEventListener('click', () => beginEditMessage(div, m));
        controls.appendChild(btnEdit);
      } else {
        // show clock icon to indicate edit window passed
        const clock = document.createElement('span');
        clock.style.opacity = '0.4';
        clock.innerHTML = '<svg width="14" height="14"><use href="#icon-clock"></use></svg>';
        controls.appendChild(clock);
      }
      const btnTrash = document.createElement('button');
      btnTrash.title = 'Delete message';
      btnTrash.innerHTML = '<svg width="16" height="16"><use href="#icon-trash"></use></svg>';
      btnTrash.addEventListener('click', () => deleteMessage(m));
      controls.appendChild(btnTrash);
    }
    meta.appendChild(controls);

    const body = document.createElement('div');
    body.className = 'body';

    // Render based on type field (sticker) or text (markdown)
    if (m.type && m.type === 'sticker') {
      const img = document.createElement('img');
      img.src = `/assets/stickers/${encodeURIComponent(String(m.text || ''))}`;
      img.alt = 'sticker';
      img.style.maxWidth = '200px';
      img.style.borderRadius = '8px';
      body.appendChild(img);
    } else {
      // sanitize rendered markdown
      try {
        const raw = marked.parse(m.text || '');
        const clean = DOMPurify.sanitize(raw, { ALLOWED_TAGS: false });
        body.innerHTML = clean;
      } catch (err) {
        body.innerHTML = escapeHtml(m.text || '');
      }
    }

    div.appendChild(meta);
    div.appendChild(body);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateMessageElement(el, payload) {
    // payload: { id, text, editedAt }
    if (!el) return;
    const body = el.querySelector('.body');
    if (!body) return;
    if (payload.type === 'sticker') {
      body.innerHTML = '';
      const img = document.createElement('img');
      img.src = `/assets/stickers/${encodeURIComponent(String(payload.text || ''))}`;
      img.alt = 'sticker';
      img.style.maxWidth = '200px';
      img.style.borderRadius = '8px';
      body.appendChild(img);
    } else {
      try {
        const raw = marked.parse(payload.text || '');
        body.innerHTML = DOMPurify.sanitize(raw);
      } catch {
        body.innerHTML = escapeHtml(payload.text || '');
      }
    }
    // add edited marker if provided
    const metaLeft = el.querySelector('.meta-left');
    if (metaLeft && payload.editedAt) {
      let edited = el.querySelector('.edited-mark');
      if (!edited) {
        edited = document.createElement('span');
        edited.className = 'edited-mark';
        edited.style.opacity = '0.7';
        edited.style.fontSize = '0.8rem';
        edited.style.marginLeft = '8px';
        edited.textContent = '(edited)';
        metaLeft.appendChild(edited);
      }
    }
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

  // Typing emission with debounce
  function sendTyping(isTyping) {
    socket.emit('typing', { typing: !!isTyping });
  }
  msgInput.addEventListener('input', () => {
    // send typing true, then after 1200ms of inactivity send false
    sendTyping(true);
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      sendTyping(false);
      typingTimeout = null;
    }, 1200);
  });

  // Clear chat (host only)
  btnClear.addEventListener('click', () => {
    if (!currentRoom || currentRoom === 'GLOBAL_CHAT_DIVINE') return showToast('Cannot clear global chat', 2500, 'error');
    socket.emit('clearRoom', {}, (res) => {
      if (!res || !res.ok) showToast(res && res.message ? res.message : 'Failed to clear', 3000, 'error');
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
    typingUsers.clear();
    renderTyping();
    if (kicked) {
      showToast(reason || 'Kicked from room', 3000, 'error');
    }
  }

  // Handle beforeunload â€” for safe rooms, emit client-refresh so server may delete the room.
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

  // Shortcut Ctrl+Alt+C to clear (host) â€” respects user setting
  window.addEventListener('keydown', (e) => {
    if (!settings.shortcutEnabled) return;
    if (e.ctrlKey && e.altKey && (e.key === 'c' || e.key === 'C')) {
      btnClear.click();
    }
  });

  // Escape closes modal & close sticker panel
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeStickers();
    }
  });

  // Utilities for message id fallback
  function getMessageId(m) {
    return m.id || m._id || m.mid || (`m_${(m.ts || Date.now())}_${(m.username || 'u').replace(/\s+/g,'')}`);
  }

  // Begin editing a message (client-side + emit edit)
  function beginEditMessage(msgEl, message) {
    // prevent multiple editors
    if (msgEl.querySelector('.msg-edit-area')) return;
    const body = msgEl.querySelector('.body');
    const originalHtml = message.text || (body ? body.textContent : '');
    const editArea = document.createElement('div');
    editArea.className = 'msg-edit-area';
    const ta = document.createElement('textarea');
    ta.value = message.text || '';
    const actions = document.createElement('div');
    actions.className = 'msg-edit-actions';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn gold';
    saveBtn.textContent = 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn muted';
    cancelBtn.textContent = 'Cancel';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    editArea.appendChild(ta);
    editArea.appendChild(actions);

    // replace body with editor
    body.style.display = 'none';
    body.parentNode.insertBefore(editArea, body.nextSibling);

    cancelBtn.addEventListener('click', () => {
      editArea.remove();
      body.style.display = '';
    });

    saveBtn.addEventListener('click', () => {
      const newText = ta.value.trim();
      if (newText === (message.text || '')) {
        // no change
        editArea.remove();
        body.style.display = '';
        return;
      }

      // check banned words before allowing edit
      if (!checkBannedTextBeforeSend(newText)) {
        // blocked
        editArea.remove();
        body.style.display = '';
        return;
      }

      // optimistic UI update
      try {
        const raw = marked.parse(newText);
        body.innerHTML = DOMPurify.sanitize(raw);
      } catch {
        body.innerHTML = escapeHtml(newText);
      }
      editArea.remove();
      body.style.display = '';

      const id = getMessageId(message);
      // emit edit event (server must support it) otherwise nothing persisted
      socket.emit('editMessage', { id, text: newText }, (res) => {
        if (!res || !res.ok) {
          showToast(res && res.message ? res.message : 'Failed to edit', 3000, 'error');
          // ideally revert to original
          body.innerHTML = originalHtml;
        } else {
          // server accepted; server should emit messageEdited which will also update other clients
        }
      });
    });
  }

  // Delete message (emit)
  function deleteMessage(message) {
    const id = getMessageId(message);
    if (!confirm('Delete this message?')) return;
    socket.emit('deleteMessage', { id }, (res) => {
      if (!res || !res.ok) {
        showToast(res && res.message ? res.message : 'Failed to delete', 3000, 'error');
      } else {
        // optimistic remove: replace element with system note
        const el = document.querySelector(`[data-mid="${id}"]`);
        if (el) {
          const system = document.createElement('div');
          system.className = 'msg system';
          system.textContent = 'Message deleted';
          el.replaceWith(system);
        }
      }
    });
  }

  // STICKERS loading and UI
  async function loadStickers() {
    try {
      const res = await fetch(STICKER_MANIFEST, { cache: 'no-cache' });
      if (!res.ok) throw new Error('No stickers');
      const list = await res.json();
      renderStickers(list);
    } catch (err) {
      // render nothing or keep existing
      stickersGrid.innerHTML = '<div style="opacity:.6">No stickers found</div>';
    }
  }

  function renderStickers(list) {
    stickersGrid.innerHTML = '';
    if (!Array.isArray(list) || list.length === 0) {
      stickersGrid.innerHTML = '<div style="opacity:.6">No stickers</div>';
      return;
    }
    list.forEach(fname => {
      const img = document.createElement('img');
      img.src = `/assets/stickers/${encodeURIComponent(fname)}`;
      img.alt = fname;
      img.title = fname;
      img.addEventListener('click', () => {
        sendSticker(fname);
        closeStickers();
      });
      stickersGrid.appendChild(img);
    });
  }

  function openStickers() {
    stickerPanel.classList.remove('hidden');
    stickerPanel.setAttribute('aria-hidden', 'false');
    loadStickers();
  }
  function closeStickers() {
    stickerPanel.classList.add('hidden');
    stickerPanel.setAttribute('aria-hidden', 'true');
  }

  openStickersBtn.addEventListener('click', (e) => {
    if (stickerPanel.classList.contains('hidden')) openStickers();
    else closeStickers();
  });
  closeStickersBtn && closeStickersBtn.addEventListener('click', closeStickers);

  // initial load: try to fetch stickers manifest so the panel is ready
  // but only if pane visible later we load again
  (async () => {
    try {
      const res = await fetch(STICKER_MANIFEST, { method: 'HEAD' });
      // do nothing â€” presence checked later
    } catch {}
  })();

})();
