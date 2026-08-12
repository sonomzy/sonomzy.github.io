import { Editor } from 'https://esm.sh/@tiptap/core@3.27.0';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@3.27.0';
import Image from 'https://esm.sh/@tiptap/extension-image@3.27.0';
import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder@3.27.0';
import { API_BASE } from './config.js';

const DRAFT_KEY = 'sonomzy-writer-draft-v1';
const SESSION_KEY = 'sonomzy-writer-session';
const $ = (selector) => document.querySelector(selector);

const authGate = $('#authGate');
const authMessage = $('#authMessage');
const appShell = $('#appShell');
const loginButton = $('#loginButton');
const logoutButton = $('#logoutButton');
const titleInput = $('#titleInput');
const descriptionInput = $('#descriptionInput');
const slugInput = $('#slugInput');
const dateInput = $('#dateInput');
const saveStatus = $('#saveStatus');
const slashMenu = $('#slashMenu');
const selectionToolbar = $('#selectionToolbar');
const imageInput = $('#imageInput');
const settingsPanel = $('#settingsPanel');
const settingsButton = $('#settingsButton');
const panelBackdrop = $('#panelBackdrop');
const previewModal = $('#previewModal');
const publishButton = $('#publishButton');
const toast = $('#toast');

let saveTimer = null;
let slashFrom = null;
let slashIndex = 0;
let toastTimer = null;
let editor = null;
let currentUser = null;

const today = new Date();
dateInput.value = today.toISOString().slice(0, 10);

bootAuth();

async function bootAuth() {
  readAuthHash();

  if (API_BASE.includes('YOUR-WORKERS-SUBDOMAIN')) {
    authMessage.textContent = 'The editor backend has been built, but the Cloudflare Worker URL still needs to be added.';
    loginButton.disabled = true;
    loginButton.textContent = 'Worker setup required';
    return;
  }

  const session = sessionStorage.getItem(SESSION_KEY);
  if (!session) {
    showLogin();
    return;
  }

  authMessage.textContent = 'Checking your GitHub session…';
  try {
    const response = await apiFetch('/api/me');
    if (!response.ok) throw new Error('Session expired');
    const data = await response.json();
    currentUser = data;
    openWriter();
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    showLogin('Your session expired. Sign in again.');
  }
}

function readAuthHash() {
  if (!location.hash) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const session = params.get('session');
  const error = params.get('error');
  if (session) sessionStorage.setItem(SESSION_KEY, session);
  if (error) authMessage.textContent = error;
  history.replaceState(null, '', location.pathname + location.search);
}

function showLogin(message = 'Sign in with the GitHub account that owns this site.') {
  authGate.hidden = false;
  appShell.hidden = true;
  authMessage.textContent = message;
}

function openWriter() {
  authGate.hidden = true;
  appShell.hidden = false;
  if (!editor) initialiseEditor();
  saveStatus.textContent = currentUser?.login ? `Signed in as ${currentUser.login}` : 'Signed in';
}

loginButton.addEventListener('click', () => {
  location.href = `${API_BASE}/auth/github`;
});

logoutButton.addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  currentUser = null;
  location.reload();
});

function apiFetch(path, options = {}) {
  const session = sessionStorage.getItem(SESSION_KEY);
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(session ? { 'Authorization': `Bearer ${session}` } : {}),
      ...(options.headers || {}),
    },
  });
}

function initialiseEditor() {
  editor = new Editor({
    element: $('#editor'),
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
        },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: 'Tell your story…' }),
    ],
    content: '<p></p>',
    autofocus: 'end',
    editorProps: {
      attributes: { spellcheck: 'true', 'aria-label': 'Post body' },
      handleKeyDown(view, event) {
        if (slashMenu.hidden === false) {
          const items = [...slashMenu.querySelectorAll('[data-slash]')];
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            slashIndex = (slashIndex + 1) % items.length;
            paintSlashSelection(items);
            return true;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            slashIndex = (slashIndex - 1 + items.length) % items.length;
            paintSlashSelection(items);
            return true;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            items[slashIndex]?.click();
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            closeSlashMenu();
            return true;
          }
        }
        if (event.key === '/' && view.state.selection.empty) {
          slashFrom = view.state.selection.from;
          slashIndex = 0;
          setTimeout(openSlashMenu, 0);
        }
        return false;
      },
    },
    onUpdate() {
      queueSave();
      if (!slashMenu.hidden && slashFrom !== null) {
        const current = editor.state.selection.from;
        if (current > slashFrom + 1 || current < slashFrom) closeSlashMenu();
      }
    },
    onSelectionUpdate: updateSelectionToolbar,
    onFocus: updateSelectionToolbar,
    onBlur() {
      setTimeout(() => {
        if (!selectionToolbar.matches(':hover')) hideSelectionToolbar();
      }, 120);
    },
  });

  loadDraft();
  autosizeTitle();
}

function slugify(value) {
  return value.toLowerCase().trim().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}
function autosizeTitle() {
  titleInput.style.height = 'auto';
  titleInput.style.height = `${Math.max(titleInput.scrollHeight, 60)}px`;
}
function queueSave() {
  saveStatus.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 450);
}
function saveDraft() {
  if (!editor) return;
  const draft = {
    title: titleInput.value,
    description: descriptionInput.value,
    slug: slugInput.value,
    date: dateInput.value,
    html: editor.getHTML(),
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    saveStatus.textContent = currentUser?.login ? `Saved · ${currentUser.login}` : 'Saved locally';
  } catch {
    saveStatus.textContent = 'Could not save';
    showToast('This draft could not be saved in the browser.');
  }
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    titleInput.value = draft.title || '';
    descriptionInput.value = draft.description || '';
    slugInput.value = draft.slug || '';
    dateInput.value = draft.date || dateInput.value;
    if (draft.html) editor.commands.setContent(draft.html, { emitUpdate: false });
    saveStatus.textContent = 'Draft restored';
  } catch (error) {
    console.warn('Could not restore draft', error);
  }
}

function updateSelectionToolbar() {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  if (from === to || !editor.isFocused) return hideSelectionToolbar();
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  selectionToolbar.style.left = `${(start.left + end.right) / 2}px`;
  selectionToolbar.style.top = `${Math.min(start.top, end.top) - 8}px`;
  selectionToolbar.hidden = false;
  for (const mark of ['bold', 'italic', 'underline']) {
    selectionToolbar.querySelector(`[data-command="${mark}"]`)?.classList.toggle('active', editor.isActive(mark));
  }
}
function hideSelectionToolbar() { selectionToolbar.hidden = true; }

function runCommand(command) {
  const chain = editor.chain().focus();
  const commands = {
    bold: () => chain.toggleBold().run(), italic: () => chain.toggleItalic().run(), underline: () => chain.toggleUnderline().run(),
    heading2: () => chain.toggleHeading({ level: 2 }).run(), heading3: () => chain.toggleHeading({ level: 3 }).run(),
    quote: () => chain.toggleBlockquote().run(), bullet: () => chain.toggleBulletList().run(), ordered: () => chain.toggleOrderedList().run(),
    code: () => chain.toggleCodeBlock().run(), divider: () => chain.setHorizontalRule().run(), paragraph: () => chain.setParagraph().run(),
  };
  commands[command]?.();
}
function editLink() {
  const previous = editor.getAttributes('link').href || '';
  const href = window.prompt('Paste or type a link', previous);
  if (href === null) return;
  if (!href.trim()) return editor.chain().focus().extendMarkRange('link').unsetLink().run();
  editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
}

selectionToolbar.addEventListener('mousedown', (event) => event.preventDefault());
selectionToolbar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-command]');
  if (!button) return;
  button.dataset.command === 'link' ? editLink() : runCommand(button.dataset.command);
  updateSelectionToolbar();
});

function openSlashMenu() {
  if (slashFrom === null) return;
  const coords = editor.view.coordsAtPos(editor.state.selection.from);
  slashMenu.style.left = `${Math.min(coords.left, window.innerWidth - 336)}px`;
  slashMenu.style.top = `${Math.min(coords.bottom + 8, window.innerHeight - 410)}px`;
  slashMenu.hidden = false;
  paintSlashSelection([...slashMenu.querySelectorAll('[data-slash]')]);
}
function closeSlashMenu() { slashMenu.hidden = true; slashFrom = null; slashIndex = 0; }
function paintSlashSelection(items) {
  items.forEach((item, index) => item.classList.toggle('active', index === slashIndex));
  items[slashIndex]?.scrollIntoView({ block: 'nearest' });
}
function removeSlash() {
  if (slashFrom === null) return;
  const current = editor.state.selection.from;
  if (current > slashFrom) editor.chain().focus().deleteRange({ from: slashFrom, to: Math.min(current, slashFrom + 1) }).run();
}
slashMenu.addEventListener('mousedown', (event) => event.preventDefault());
slashMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-slash]');
  if (!button) return;
  const action = button.dataset.slash;
  removeSlash();
  closeSlashMenu();
  action === 'image' ? imageInput.click() : runCommand(action);
});
document.addEventListener('click', (event) => {
  if (editor && !slashMenu.hidden && !slashMenu.contains(event.target) && !editor.view.dom.contains(event.target)) closeSlashMenu();
});

imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  imageInput.value = '';
  showToast('Uploading image…');
  try {
    const dataUrl = await fileToDataUrl(file);
    const response = await apiFetch('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, dataUrl }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Image upload failed.');
    editor.chain().focus().setImage({ src: result.url, alt: file.name }).run();
    showToast('Image uploaded.');
  } catch (error) {
    showToast(error.message || 'Image upload failed.');
  }
});
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

titleInput.addEventListener('input', () => {
  autosizeTitle();
  if (!slugInput.dataset.edited) slugInput.value = slugify(titleInput.value);
  queueSave();
});
[descriptionInput, dateInput].forEach((input) => input.addEventListener('input', queueSave));
slugInput.addEventListener('input', () => {
  slugInput.dataset.edited = '1';
  slugInput.value = slugify(slugInput.value);
  queueSave();
});

function openSettings() {
  settingsPanel.classList.add('open');
  settingsPanel.setAttribute('aria-hidden', 'false');
  settingsButton.setAttribute('aria-expanded', 'true');
  panelBackdrop.hidden = false;
}
function closeSettings() {
  settingsPanel.classList.remove('open');
  settingsPanel.setAttribute('aria-hidden', 'true');
  settingsButton.setAttribute('aria-expanded', 'false');
  panelBackdrop.hidden = true;
}
settingsButton.addEventListener('click', openSettings);
$('#closeSettings').addEventListener('click', closeSettings);
panelBackdrop.addEventListener('click', closeSettings);

function openPreview() {
  $('#previewTitle').textContent = titleInput.value.trim() || 'Untitled';
  $('#previewDescription').textContent = descriptionInput.value.trim();
  $('#previewDescription').hidden = !descriptionInput.value.trim();
  $('#previewContent').innerHTML = editor.getHTML();
  previewModal.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closePreview() { previewModal.hidden = true; document.body.style.overflow = ''; }
$('#previewButton').addEventListener('click', openPreview);
$('#closePreview').addEventListener('click', closePreview);

publishButton.addEventListener('click', async () => {
  saveDraft();
  if (!titleInput.value.trim()) {
    titleInput.focus();
    return showToast('Give the post a title first.');
  }
  if (editor.isEmpty) return showToast('Write something before publishing.');

  publishButton.disabled = true;
  publishButton.textContent = 'Publishing…';
  try {
    const response = await apiFetch('/api/publish', {
      method: 'POST',
      body: JSON.stringify({
        title: titleInput.value,
        description: descriptionInput.value,
        slug: slugInput.value || slugify(titleInput.value),
        date: dateInput.value,
        html: editor.getHTML(),
      }),
    });
    const result = await response.json();
    if (response.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      throw new Error('Your session expired. Sign in again.');
    }
    if (!response.ok) throw new Error(result.error || 'Publishing failed.');
    localStorage.removeItem(DRAFT_KEY);
    saveStatus.textContent = 'Published';
    showToast('Published to GitHub. GitHub Pages is rebuilding the site now.');
  } catch (error) {
    showToast(error.message || 'Publishing failed.');
  } finally {
    publishButton.disabled = false;
    publishButton.textContent = 'Publish';
  }
});

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4400);
}

window.addEventListener('beforeunload', saveDraft);
