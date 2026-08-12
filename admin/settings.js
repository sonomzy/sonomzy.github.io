import { API_BASE } from './config.js';

const SESSION_KEY = 'sonomzy-writer-session';
const $ = (selector) => document.querySelector(selector);
const authGate = $('#authGate');
const settingsApp = $('#settingsApp');
const authMessage = $('#authMessage');
const loginButton = $('#loginButton');
const logoutButton = $('#logoutButton');
const saveButton = $('#saveButton');
const status = $('#status');
const navRows = $('#navRows');

boot();

async function boot() {
  const session = sessionStorage.getItem(SESSION_KEY);
  if (!session) return showLogin();
  try {
    const me = await apiFetch('/api/me');
    if (!me.ok) throw new Error('Session expired');
    await loadSettings();
    authGate.hidden = true;
    settingsApp.hidden = false;
  } catch (error) {
    sessionStorage.removeItem(SESSION_KEY);
    showLogin('Your session expired. Sign in again.');
  }
}

function showLogin(message = 'Sign in to edit the public site.') {
  authGate.hidden = false;
  settingsApp.hidden = true;
  authMessage.textContent = message;
}

loginButton.addEventListener('click', () => {
  sessionStorage.setItem('sonomzy-auth-return', '/admin/settings.html');
  location.href = `${API_BASE}/auth/github?return=settings`;
});

logoutButton.addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
});

function apiFetch(path, options = {}) {
  const session = sessionStorage.getItem(SESSION_KEY);
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
      ...(options.headers || {}),
    },
  });
}

async function loadSettings() {
  const response = await apiFetch('/api/site-settings');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load site settings');
  const design = data.site || {};
  $('#siteName').value = design.site_name || 'Sonomzy';
  $('#tagline').value = design.tagline || '';
  $('#background').value = design.background || '#f5f1ed';
  $('#surface').value = design.surface || '#fffdfb';
  $('#text').value = design.text || '#181512';
  $('#muted').value = design.muted || '#6d655e';
  $('#accent').value = design.accent || '#2d4f73';
  $('#border').value = design.border || '#e7dfd8';
  $('#contentWidth').value = design.content_width || 1120;
  $('#articleWidth').value = design.article_width || 820;
  $('#radius').value = design.radius ?? 18;
  renderNavigation(data.navigation || []);
}

function renderNavigation(items) {
  navRows.innerHTML = '';
  items.forEach(addNavRow);
}

function addNavRow(item = { title: '', url: '/' }) {
  const row = document.createElement('div');
  row.className = 'nav-row';
  row.draggable = true;
  row.innerHTML = `
    <span class="nav-handle" title="Drag to reorder">⋮⋮</span>
    <input class="nav-title" type="text" placeholder="Label" value="${escapeAttr(item.title || '')}">
    <input class="nav-url" type="url" placeholder="/about/" value="${escapeAttr(item.url || '')}">
    <button type="button" class="remove-nav" aria-label="Remove">×</button>`;
  row.querySelector('.remove-nav').addEventListener('click', () => row.remove());
  row.addEventListener('dragstart', () => row.classList.add('dragging'));
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  navRows.appendChild(row);
}

navRows.addEventListener('dragover', (event) => {
  event.preventDefault();
  const dragging = navRows.querySelector('.dragging');
  if (!dragging) return;
  const siblings = [...navRows.querySelectorAll('.nav-row:not(.dragging)')];
  const next = siblings.find((row) => event.clientY <= row.getBoundingClientRect().top + row.offsetHeight / 2);
  navRows.insertBefore(dragging, next || null);
});

$('#addNav').addEventListener('click', () => addNavRow());

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
    $('#designPanel').classList.toggle('active', tab.dataset.tab === 'design');
    $('#navigationPanel').classList.toggle('active', tab.dataset.tab === 'navigation');
  });
});

saveButton.addEventListener('click', async () => {
  status.className = 'status';
  status.textContent = 'Saving…';
  saveButton.disabled = true;
  const payload = {
    site: {
      site_name: $('#siteName').value.trim() || 'Sonomzy',
      tagline: $('#tagline').value.trim(),
      background: $('#background').value,
      surface: $('#surface').value,
      text: $('#text').value,
      muted: $('#muted').value,
      accent: $('#accent').value,
      border: $('#border').value,
      content_width: Number($('#contentWidth').value),
      article_width: Number($('#articleWidth').value),
      radius: Number($('#radius').value),
    },
    navigation: [...navRows.querySelectorAll('.nav-row')].map((row) => ({
      title: row.querySelector('.nav-title').value.trim(),
      url: row.querySelector('.nav-url').value.trim(),
    })).filter((item) => item.title && item.url),
  };

  try {
    const response = await apiFetch('/api/site-settings', { method: 'POST', body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save settings');
    status.className = 'status success';
    status.textContent = 'Saved. GitHub Pages is rebuilding the site now.';
  } catch (error) {
    status.className = 'status error';
    status.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
