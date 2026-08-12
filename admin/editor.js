import { Editor } from 'https://esm.sh/@tiptap/core@3.27.0';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@3.27.0';
import Image from 'https://esm.sh/@tiptap/extension-image@3.27.0';
import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder@3.27.0';

const DRAFT_KEY = 'sonomzy-writer-draft-v1';
const $ = (selector) => document.querySelector(selector);

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
const toast = $('#toast');

let saveTimer = null;
let slashFrom = null;
let slashIndex = 0;
let toastTimer = null;

const today = new Date();
dateInput.value = today.toISOString().slice(0, 10);

const editor = new Editor({
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
    Image.configure({
      inline: false,
      allowBase64: true,
    }),
    Placeholder.configure({
      placeholder: 'Tell your story…',
    }),
  ],
  content: '<p></p>',
  autofocus: 'end',
  editorProps: {
    attributes: {
      spellcheck: 'true',
      'aria-label': 'Post body',
    },
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
  onSelectionUpdate() {
    updateSelectionToolbar();
  },
  onFocus() {
    updateSelectionToolbar();
  },
  onBlur() {
    setTimeout(() => {
      if (!selectionToolbar.matches(':hover')) hideSelectionToolbar();
    }, 120);
  },
});

loadDraft();
autosizeTitle();

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
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
    saveStatus.textContent = 'Saved locally';
  } catch (error) {
    saveStatus.textContent = 'Could not save';
    showToast('This draft is too large for browser storage. Large embedded images are usually the cause.');
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
  const { from, to } = editor.state.selection;
  if (from === to || !editor.isFocused) {
    hideSelectionToolbar();
    return;
  }

  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  selectionToolbar.style.left = `${(start.left + end.right) / 2}px`;
  selectionToolbar.style.top = `${Math.min(start.top, end.top) - 8}px`;
  selectionToolbar.hidden = false;

  selectionToolbar.querySelector('[data-command="bold"]').classList.toggle('active', editor.isActive('bold'));
  selectionToolbar.querySelector('[data-command="italic"]').classList.toggle('active', editor.isActive('italic'));
  selectionToolbar.querySelector('[data-command="underline"]').classList.toggle('active', editor.isActive('underline'));
}

function hideSelectionToolbar() {
  selectionToolbar.hidden = true;
}

function runCommand(command) {
  const chain = editor.chain().focus();
  const commands = {
    bold: () => chain.toggleBold().run(),
    italic: () => chain.toggleItalic().run(),
    underline: () => chain.toggleUnderline().run(),
    heading2: () => chain.toggleHeading({ level: 2 }).run(),
    heading3: () => chain.toggleHeading({ level: 3 }).run(),
    quote: () => chain.toggleBlockquote().run(),
    bullet: () => chain.toggleBulletList().run(),
    ordered: () => chain.toggleOrderedList().run(),
    code: () => chain.toggleCodeBlock().run(),
    divider: () => chain.setHorizontalRule().run(),
    paragraph: () => chain.setParagraph().run(),
  };
  commands[command]?.();
}

function editLink() {
  const previous = editor.getAttributes('link').href || '';
  const href = window.prompt('Paste or type a link', previous);
  if (href === null) return;
  if (href.trim() === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
}

selectionToolbar.addEventListener('mousedown', (event) => event.preventDefault());
selectionToolbar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-command]');
  if (!button) return;
  if (button.dataset.command === 'link') editLink();
  else runCommand(button.dataset.command);
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

function closeSlashMenu() {
  slashMenu.hidden = true;
  slashFrom = null;
  slashIndex = 0;
}

function paintSlashSelection(items) {
  items.forEach((item, index) => item.classList.toggle('active', index === slashIndex));
  items[slashIndex]?.scrollIntoView({ block: 'nearest' });
}

function removeSlash() {
  if (slashFrom === null) return;
  const current = editor.state.selection.from;
  if (current > slashFrom) {
    editor.chain().focus().deleteRange({ from: slashFrom, to: Math.min(current, slashFrom + 1) }).run();
  }
}

slashMenu.addEventListener('mousedown', (event) => event.preventDefault());
slashMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-slash]');
  if (!button) return;
  const action = button.dataset.slash;
  removeSlash();
  closeSlashMenu();
  if (action === 'image') imageInput.click();
  else runCommand(action);
});

document.addEventListener('click', (event) => {
  if (!slashMenu.hidden && !slashMenu.contains(event.target) && !editor.view.dom.contains(event.target)) {
    closeSlashMenu();
  }
});

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    editor.chain().focus().setImage({ src: reader.result, alt: file.name }).run();
    imageInput.value = '';
    showToast('Image inserted. It is stored inside this local draft for now.');
  };
  reader.readAsDataURL(file);
});

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
function closePreview() {
  previewModal.hidden = true;
  document.body.style.overflow = '';
}
$('#previewButton').addEventListener('click', openPreview);
$('#closePreview').addEventListener('click', closePreview);

$('#publishButton').addEventListener('click', async () => {
  saveDraft();
  if (!titleInput.value.trim()) {
    titleInput.focus();
    showToast('Give the post a title first.');
    return;
  }

  const post = buildJekyllPost();
  try {
    await navigator.clipboard.writeText(post);
    showToast('Draft saved. The complete Jekyll post was copied to your clipboard. Secure one-click publishing is the next step.');
  } catch (error) {
    showToast('Draft saved locally. Secure one-click publishing is the next step.');
  }
});

function buildJekyllPost() {
  const safeTitle = titleInput.value.replace(/"/g, '\\"');
  const safeDescription = descriptionInput.value.replace(/"/g, '\\"');
  return `---\nlayout: post\ntitle: "${safeTitle}"\ndate: ${dateInput.value}\ndescription: "${safeDescription}"\n---\n\n${editor.getHTML()}\n`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4400);
}

window.addEventListener('beforeunload', saveDraft);
