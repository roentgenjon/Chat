'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  deviceId: null,
  me: null,
  conversations: [],
  activeConvId: null,
  oldestMessageId: null,
  allUsers: [],
  selectedUserIds: new Set(),
  groupAvatarFile: null,
};

// ── Device ID ──────────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('deviceId', id);
  }
  return id;
}

// ── API helpers ────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'X-Device-ID': state.deviceId },
  };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── Socket.io ──────────────────────────────────────────────────────────────
let socket;
function connectSocket() {
  socket = io();
  socket.on('connect', () => socket.emit('authenticate', { deviceId: state.deviceId }));
  socket.on('new_message', onNewMessage);
  socket.on('conversation_created', onConversationCreated);
}

function joinConvRoom(convId) {
  if (socket) socket.emit('join_conversation', { conversationId: convId });
}
function leaveConvRoom(convId) {
  if (socket && convId) socket.emit('leave_conversation', { conversationId: convId });
}

// ── Screens ────────────────────────────────────────────────────────────────
const screenRegister = document.getElementById('screen-register');
const screenApp = document.getElementById('screen-app');

function showApp() {
  screenRegister.classList.add('hidden');
  screenApp.classList.remove('hidden');
  document.getElementById('my-name').textContent = state.me.name;
}

function showRegister() {
  screenRegister.classList.remove('hidden');
  screenApp.classList.add('hidden');
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  state.deviceId = getDeviceId();
  connectSocket();

  const { ok, data } = await api('GET', '/api/users/me');
  if (ok) {
    state.me = data;
    showApp();
    loadConversations();
  } else {
    showRegister();
  }
}

// ── Registration ───────────────────────────────────────────────────────────
document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('register-name').value.trim();
  const errEl = document.getElementById('register-error');
  errEl.textContent = '';
  if (!name) return;

  const { ok, data } = await api('POST', '/api/users/register', { name, deviceId: state.deviceId });
  if (ok) {
    state.me = data;
    showApp();
    loadConversations();
  } else if (data.error === 'name_taken') {
    errEl.textContent = 'Dieser Name ist bereits vergeben. Bitte wähle einen anderen.';
  } else {
    errEl.textContent = 'Fehler beim Erstellen des Kontos.';
  }
});

// ── Conversation list ──────────────────────────────────────────────────────
async function loadConversations() {
  const { ok, data } = await api('GET', '/api/conversations');
  if (!ok) return;
  state.conversations = data;
  renderConvList();
}

function convDisplayName(conv) {
  if (conv.is_group) return conv.name || 'Gruppe';
  const other = conv.members.find(m => m.id !== state.me.id);
  return other ? other.name : 'Chat';
}

function convInitial(name) {
  return name ? name[0].toUpperCase() : '?';
}

function renderConvList() {
  const list = document.getElementById('conv-list');
  list.innerHTML = '';
  for (const conv of state.conversations) {
    const displayName = convDisplayName(conv);
    const el = document.createElement('div');
    el.className = 'conv-item' + (conv.id === state.activeConvId ? ' active' : '');
    el.dataset.id = conv.id;

    let avatarHtml;
    if (conv.is_group && conv.avatar_url) {
      avatarHtml = `<div class="conv-avatar"><img src="${conv.avatar_url}" alt=""></div>`;
    } else {
      avatarHtml = `<div class="conv-avatar">${convInitial(displayName)}</div>`;
    }

    let preview = '';
    if (conv.last_type === 'text') preview = conv.last_content || '';
    else if (conv.last_type === 'image') preview = '📷 Foto';
    else if (conv.last_type === 'video') preview = '🎥 Video';

    if (conv.last_sender_name && conv.is_group && preview) {
      preview = `${conv.last_sender_name}: ${preview}`;
    }

    el.innerHTML = `
      ${avatarHtml}
      <div class="conv-info">
        <div class="conv-name">${esc(displayName)}</div>
        <div class="conv-preview">${esc(preview)}</div>
      </div>
    `;
    el.addEventListener('click', () => openConversation(conv.id));
    list.appendChild(el);
  }
}

// ── Open conversation ──────────────────────────────────────────────────────
async function openConversation(convId) {
  if (state.activeConvId) leaveConvRoom(state.activeConvId);
  state.activeConvId = convId;
  state.oldestMessageId = null;

  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');

  // Mobile: hide sidebar
  if (window.innerWidth <= 700) {
    document.getElementById('sidebar').classList.add('hidden');
  }

  const conv = state.conversations.find(c => c.id === convId);
  renderConvHeader(conv);
  renderConvList();
  joinConvRoom(convId);

  document.getElementById('messages').innerHTML = '';
  await loadMessages(convId, null);
}

function renderConvHeader(conv) {
  if (!conv) return;
  const displayName = convDisplayName(conv);
  document.getElementById('chat-title').textContent = displayName;

  const avatarEl = document.getElementById('chat-avatar');
  if (conv.is_group && conv.avatar_url) {
    avatarEl.src = conv.avatar_url;
    avatarEl.style.display = '';
  } else {
    avatarEl.src = '';
    avatarEl.style.background = 'var(--primary)';
    avatarEl.style.display = '';
  }

  if (conv.is_group) {
    const names = conv.members.map(m => m.name).join(', ');
    document.getElementById('chat-subtitle').textContent = names;
  } else {
    document.getElementById('chat-subtitle').textContent = '';
  }
}

// ── Messages ───────────────────────────────────────────────────────────────
async function loadMessages(convId, before) {
  const url = `/api/conversations/${convId}/messages` + (before ? `?before=${before}&limit=50` : '?limit=50');
  const { ok, data } = await api('GET', url);
  if (!ok) return;

  const loadMoreBtn = document.getElementById('btn-load-more');
  loadMoreBtn.style.display = data.length < 50 ? 'none' : '';

  if (data.length > 0) {
    state.oldestMessageId = data[0].id;
    prependMessages(data, before != null);
  } else if (!before) {
    loadMoreBtn.style.display = 'none';
  }
}

let lastRenderedDate = null;

function prependMessages(msgs, prepend) {
  const container = document.getElementById('messages');
  const fragment = document.createDocumentFragment();

  if (!prepend) lastRenderedDate = null;

  for (const msg of msgs) {
    const dateStr = formatDate(msg.sent_at);
    if (dateStr !== lastRenderedDate) {
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.textContent = dateStr;
      fragment.appendChild(sep);
      lastRenderedDate = dateStr;
    }
    fragment.appendChild(buildMessageEl(msg));
  }

  if (prepend) {
    container.prepend(fragment);
  } else {
    container.appendChild(fragment);
    scrollToBottom();
  }
}

function buildMessageEl(msg) {
  const isOut = msg.sender_id === state.me.id;
  const conv = state.conversations.find(c => c.id === state.activeConvId);
  const isGroup = conv && conv.is_group;

  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (isOut ? 'out' : 'in');
  wrap.dataset.id = msg.id;

  let inner = '';
  if (!isOut && isGroup) {
    inner += `<div class="msg-sender">${esc(msg.sender_name)}</div>`;
  }
  inner += '<div class="msg-bubble">';
  if (msg.type === 'text') {
    inner += esc(msg.content);
  } else if (msg.type === 'image') {
    inner += `<div class="msg-media"><img src="${msg.media_url}" alt="Foto" loading="lazy"></div>`;
  } else if (msg.type === 'video') {
    inner += `<div class="msg-media"><video src="${msg.media_url}" controls></div>`;
  }
  inner += '</div>';
  inner += `<div class="msg-time">${formatTime(msg.sent_at)}</div>`;
  wrap.innerHTML = inner;

  if (msg.type === 'image') {
    wrap.querySelector('img').addEventListener('click', () => openLightbox(msg.media_url));
  }
  return wrap;
}

function appendMessage(msg) {
  const container = document.getElementById('messages');
  const dateStr = formatDate(msg.sent_at);
  if (dateStr !== lastRenderedDate) {
    const sep = document.createElement('div');
    sep.className = 'date-sep';
    sep.textContent = dateStr;
    container.appendChild(sep);
    lastRenderedDate = dateStr;
  }
  container.appendChild(buildMessageEl(msg));
  scrollToBottom();
}

function scrollToBottom() {
  const c = document.getElementById('messages-container');
  c.scrollTop = c.scrollHeight;
}

// ── Socket events ──────────────────────────────────────────────────────────
function onNewMessage(msg) {
  if (msg.conversation_id === state.activeConvId) {
    appendMessage(msg);
  }
  // Update conversation list preview
  const conv = state.conversations.find(c => c.id === msg.conversation_id);
  if (conv) {
    conv.last_type = msg.type;
    conv.last_content = msg.content;
    conv.last_media_url = msg.media_url;
    conv.last_sent_at = msg.sent_at;
    conv.last_sender_name = msg.sender_name;
    // Move to top
    state.conversations = [conv, ...state.conversations.filter(c => c.id !== conv.id)];
    renderConvList();
  }
}

function onConversationCreated(conv) {
  if (!state.conversations.find(c => c.id === conv.id)) {
    state.conversations.unshift(conv);
    renderConvList();
  }
}

// ── Send message ───────────────────────────────────────────────────────────
document.getElementById('message-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !state.activeConvId) return;
  input.value = '';
  await api('POST', `/api/conversations/${state.activeConvId}/messages`, { type: 'text', content: text });
});

document.getElementById('media-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file || !state.activeConvId) return;
  e.target.value = '';
  const fd = new FormData();
  fd.append('media', file);
  await api('POST', `/api/conversations/${state.activeConvId}/messages`, fd);
});

// ── Load more ──────────────────────────────────────────────────────────────
document.getElementById('btn-load-more').addEventListener('click', () => {
  if (state.activeConvId && state.oldestMessageId) {
    loadMessages(state.activeConvId, state.oldestMessageId);
  }
});

// ── Back button (mobile) ───────────────────────────────────────────────────
document.getElementById('btn-back').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('chat-view').classList.add('hidden');
  document.getElementById('empty-state').classList.remove('hidden');
  if (state.activeConvId) leaveConvRoom(state.activeConvId);
  state.activeConvId = null;
  renderConvList();
});

// ── New Chat Modal ─────────────────────────────────────────────────────────
const modalNewChat = document.getElementById('modal-new-chat');

document.getElementById('btn-new-chat').addEventListener('click', async () => {
  const { ok, data } = await api('GET', '/api/users');
  if (!ok) return;
  state.allUsers = data.filter(u => u.id !== state.me.id);
  state.selectedUserIds = new Set();
  state.groupAvatarFile = null;
  document.getElementById('new-chat-error').textContent = '';
  document.getElementById('group-name-input').value = '';
  document.getElementById('avatar-preview-img').classList.add('hidden');
  document.getElementById('avatar-preview-text').classList.remove('hidden');
  document.getElementById('user-search').value = '';
  renderUserList('');
  updateModalState();
  modalNewChat.classList.remove('hidden');
});

document.querySelectorAll('.close-modal').forEach(btn => {
  btn.addEventListener('click', () => modalNewChat.classList.add('hidden'));
});
modalNewChat.addEventListener('click', e => {
  if (e.target === modalNewChat) modalNewChat.classList.add('hidden');
});

document.getElementById('user-search').addEventListener('input', e => {
  renderUserList(e.target.value.trim().toLowerCase());
});

function renderUserList(filter) {
  const list = document.getElementById('user-list');
  list.innerHTML = '';
  const filtered = filter ? state.allUsers.filter(u => u.name.toLowerCase().includes(filter)) : state.allUsers;
  for (const user of filtered) {
    const row = document.createElement('label');
    row.className = 'user-row';
    const checked = state.selectedUserIds.has(user.id);
    row.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''} data-uid="${user.id}">
      <div class="user-row-avatar">${esc(user.name[0].toUpperCase())}</div>
      <span class="user-row-name">${esc(user.name)}</span>
    `;
    row.querySelector('input').addEventListener('change', ev => {
      if (ev.target.checked) state.selectedUserIds.add(user.id);
      else state.selectedUserIds.delete(user.id);
      updateModalState();
    });
    list.appendChild(row);
  }
}

function updateModalState() {
  const count = state.selectedUserIds.size;
  const step = document.getElementById('step-group');
  const btn = document.getElementById('btn-create-chat');

  if (count >= 2) {
    step.classList.remove('hidden');
  } else {
    step.classList.add('hidden');
  }
  btn.disabled = count === 0;
}

document.getElementById('group-avatar-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  state.groupAvatarFile = file;
  const img = document.getElementById('avatar-preview-img');
  const txt = document.getElementById('avatar-preview-text');
  img.src = URL.createObjectURL(file);
  img.classList.remove('hidden');
  txt.classList.add('hidden');
});

document.getElementById('btn-create-chat').addEventListener('click', async () => {
  const count = state.selectedUserIds.size;
  const errEl = document.getElementById('new-chat-error');
  errEl.textContent = '';

  if (count === 0) return;

  const memberIds = [...state.selectedUserIds];

  if (count >= 2) {
    const groupName = document.getElementById('group-name-input').value.trim();
    if (!groupName) {
      errEl.textContent = 'Bitte gib einen Gruppennamen ein.';
      return;
    }
    const fd = new FormData();
    memberIds.forEach(id => fd.append('memberIds', id));
    fd.append('name', groupName);
    if (state.groupAvatarFile) fd.append('avatar', state.groupAvatarFile);

    const { ok, data } = await api('POST', '/api/conversations', fd);
    if (!ok) { errEl.textContent = 'Fehler beim Erstellen der Gruppe.'; return; }
    modalNewChat.classList.add('hidden');
    if (!state.conversations.find(c => c.id === data.id)) {
      state.conversations.unshift(data);
    }
    renderConvList();
    openConversation(data.id);
  } else {
    const { ok, data } = await api('POST', '/api/conversations', { memberIds });
    if (!ok) { errEl.textContent = 'Fehler beim Erstellen des Chats.'; return; }
    modalNewChat.classList.add('hidden');
    if (!state.conversations.find(c => c.id === data.id)) {
      state.conversations.unshift(data);
    }
    renderConvList();
    openConversation(data.id);
  }
});

// ── Lightbox ───────────────────────────────────────────────────────────────
function openLightbox(src) {
  const lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = `<img src="${src}" alt="Foto">`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(unixSec) {
  const d = new Date(unixSec * 1000);
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(unixSec) {
  const d = new Date(unixSec * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Heute';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Start ──────────────────────────────────────────────────────────────────
boot();
