import { get, put, inbox, acceptInbox, archives } from './lib/db.js';
import {
  defaultSettings,
  newCapture,
  dataUrlBytes,
  sha256,
  markdown,
  basename,
} from './lib/capture.js';
import {
  prepareBundle,
  requestWritePermission,
  saveBundle,
  chooseSaveDirectory,
} from './lib/bundle.js';
import { zipBundle } from './lib/zip.js';

const $ = (id) => document.getElementById(id);
const fields = {
  title: 'title',
  description: 'description',
  steps: 'steps',
  severity: 'severity',
  tags: 'tags',
};
let draft,
  settings,
  directory,
  busy = false,
  locked = false,
  refreshPending = false,
  persistence = Promise.resolve(),
  editing = null;
function message(text, error = false) {
  $('message').textContent = text;
  $('message').className = error ? 'error' : '';
}
function persist() {
  const snapshot = structuredClone(draft);
  persistence = persistence.catch(() => {}).then(() => put('draft', snapshot));
  return persistence;
}
function freezeControls() {
  const frozen = locked || busy || Boolean(draft?.local);
  for (const id of [
    ...Object.keys(fields),
    'page-title',
    'page-url',
    'capture',
    'add-images',
    'add-images-button',
  ])
    $(id).disabled = frozen;
  for (const id of ['save', 'zip', 'copy', 'new', 'duplicate', 'folder', 'restore-draft'])
    $(id).disabled = locked || busy;
  for (const button of document.querySelectorAll('.image-card button'))
    button.disabled = frozen || button.dataset.boundary === 'true';
}
async function action(fn, needsPersistence = true) {
  if (busy || locked) return;
  busy = true;
  freezeControls();
  try {
    if (needsPersistence) await persistence;
    await fn();
  } catch (error) {
    message(error.message, true);
  } finally {
    busy = false;
    render();
    if (refreshPending) queueMicrotask(refreshWhenIdle);
  }
}
function render() {
  if (!draft) return;
  for (const [id, key] of Object.entries(fields))
    if ($(id) !== document.activeElement) $(id).value = draft[key];
  if ($('page-title') !== document.activeElement) $('page-title').value = draft.source.title;
  if ($('page-url') !== document.activeElement) $('page-url').value = draft.source.url;
  $('capture-identity').textContent = `${draft.createdAt} · ${draft.timezone} · ${draft.id}`;
  $('folder-name').textContent = directory?.name || 'No folder selected';
  $('image-count').textContent = draft.images.length;
  $('empty-images').hidden = Boolean(draft.images.length);
  const imageBox = $('images');
  imageBox.replaceChildren();
  draft.images.forEach((image, index) => {
    const card = document.createElement('article');
    card.className = 'image-card';
    const img = document.createElement('img');
    img.src = image.dataUrl;
    img.alt = `Screenshot ${index + 1}`;
    card.append(img);
    const caption = document.createElement('p');
    caption.className = 'hint';
    caption.textContent = `${index + 1}. ${image.source?.title || 'Added image'}`;
    card.append(caption);
    const row = document.createElement('div');
    row.className = 'row';
    const button = (text, fn, boundary = false) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.dataset.boundary = String(boundary);
      b.addEventListener('click', () => action(fn));
      row.append(b);
    };
    button(
      'Move up',
      async () => {
        [draft.images[index - 1], draft.images[index]] = [
          draft.images[index],
          draft.images[index - 1],
        ];
        await persist();
      },
      index === 0,
    );
    button(
      'Move down',
      async () => {
        [draft.images[index + 1], draft.images[index]] = [
          draft.images[index],
          draft.images[index + 1],
        ];
        await persist();
      },
      index === draft.images.length - 1,
    );
    button('Crop / redact', () => openEditor(image));
    button('Remove', async () => {
      draft.images.splice(index, 1);
      await persist();
    });
    card.append(row);
    imageBox.append(card);
  });
  const plan = draft.local;
  $('local-status').textContent = plan
    ? plan.complete
      ? `Saved and read back ${plan.files.length} files. SHA-256 hashes match.`
      : `Snapshot retained. ${plan.verified.length}/${plan.files.length} files verified in the last save attempt.`
    : 'No files saved yet.';
  $('saved-files').replaceChildren();
  for (const file of plan?.files || []) {
    const li = document.createElement('li');
    li.textContent = `${plan.verified.includes(file.name) ? 'Verified' : 'Pending'}: ${file.name}`;
    $('saved-files').append(li);
  }
  try {
    $('preview').textContent =
      plan?.markdown ||
      markdown(
        draft,
        draft.images.map(
          (img, i) =>
            `${basename(draft, settings)}-${String(i + 1).padStart(2, '0')}.${dataUrlBytes(img.dataUrl).extension}`,
        ),
      );
  } catch (error) {
    $('preview').textContent = error.message;
  }
  freezeControls();
}
async function drainInbox() {
  if (busy || locked || !draft) return;
  await action(async () => {
    const pending = await inbox();
    if (!pending.length) return;
    const errors = pending.filter((x) => x.error),
      images = pending.filter((x) => !x.error);
    if (draft.local && images.length) {
      message(`${images.length} new screenshot(s) retained. Start a new draft to use them.`);
      return;
    }
    for (const image of images) {
      dataUrlBytes(image.dataUrl);
      if (!draft.images.some((x) => x.id === image.id)) draft.images.push(image);
    }
    if (!draft.source.url && images[0]) draft.source = { ...images[0].source };
    await acceptInbox(
      structuredClone(draft),
      pending.map((x) => x.id),
    );
    message(
      errors.length
        ? errors.map((x) => x.error).join('\n')
        : `${images.length} screenshot(s) added.`,
      Boolean(errors.length),
    );
  });
}
async function snapshot(allowMemoryOnly = false) {
  if (!draft.local) draft.local = await prepareBundle(draft, settings);
  try {
    await persist();
  } catch (error) {
    if (!allowMemoryOnly) throw error;
  }
  return draft.local;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
for (const [id, key] of Object.entries(fields))
  $(id).addEventListener('input', () => {
    if (!draft || locked || draft.local) return;
    draft[key] = $(id).value;
    persist().catch((error) =>
      message(
        `Draft was not saved: ${error.message}. Keep this panel open and copy/export the content.`,
        true,
      ),
    );
  });
for (const [id, key] of [
  ['page-title', 'title'],
  ['page-url', 'url'],
])
  $(id).addEventListener('input', () => {
    if (!draft || locked || draft.local) return;
    draft.source[key] = $(id).value;
    persist().catch((error) => message(error.message, true));
  });
$('capture-form').addEventListener('submit', (event) => event.preventDefault());
$('add-images-button').addEventListener('click', () => $('add-images').click());
$('capture').addEventListener('click', async () => {
  await action(async () => {
    const result = await chrome.runtime.sendMessage({
      type: 'capture-visible',
    });
    if (!result?.ok)
      throw new Error(
        result?.error || 'Capture failed. Click the extension icon on the page first.',
      );
  });
  await drainInbox();
});
$('add-images').addEventListener('change', () =>
  action(async () => {
    for (const file of $('add-images').files) {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      dataUrlBytes(dataUrl);
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      draft.images.push({
        id: crypto.randomUUID(),
        dataUrl,
        source: { url: '', title: file.name },
        capturedAt: new Date().toISOString(),
      });
      await persist();
    }
    $('add-images').value = '';
    message('Images added. Review and reorder them before saving.');
  }),
);
$('folder').addEventListener('click', async () => {
  if (busy || locked) return;
  // Invoke the picker directly in the click handler, before asynchronous work.
  try {
    const chosen = await chooseSaveDirectory();
    await action(async () => {
      await put('directory', chosen);
      directory = chosen;
      if (draft.local) {
        draft.local.complete = false;
        draft.local.verified = [];
        await persist();
      }
      message(`Folder selected: ${directory.name}`);
    });
  } catch (error) {
    if (error.name !== 'AbortError')
      message(`${error.message} You can export a ZIP instead.`, true);
  }
});
$('save').addEventListener('click', async () => {
  if (busy || locked) return;
  // Permission recovery remains tied to this explicit Save click.
  const permission = requestWritePermission(directory).then(
    () => ({}),
    (error) => ({ error }),
  );
  await action(async () => {
    const result = await permission;
    if (result.error) throw result.error;
    const plan = await snapshot();
    await navigator.locks.request(`save:${plan.captureId}`, () =>
      saveBundle(directory, plan, async () => persist()),
    );
    message('Saved. Every file was reopened and its SHA-256 verified.');
  });
});
$('zip').addEventListener('click', () =>
  action(async () => {
    const plan = await snapshot(true);
    download(zipBundle(plan.files), `${plan.basename}.zip`);
    message(
      'ZIP download requested. Check your browser downloads; direct folder save status is unchanged.',
    );
  }, false),
);
$('copy').addEventListener('click', () =>
  action(async () => {
    const plan = await snapshot(true);
    await navigator.clipboard.writeText(plan.markdown);
    message('Markdown copied. Relative image links need the images from this same bundle.');
  }, false),
);
async function refreshArchives() {
  const list = await archives();
  $('archives').replaceChildren(new Option('Select a draft', ''));
  for (const item of list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    $('archives').append(new Option(`${item.createdAt} · ${item.title || 'Untitled'}`, item.id));
}
async function replaceDraft(copy) {
  if (!confirm('The current draft will be archived in this browser. Continue with a new capture?'))
    return;
  await put(`archive:${draft.id}`, draft);
  const next = newCapture(settings);
  if (copy) {
    for (const key of ['title', 'description', 'steps', 'severity', 'tags', 'source', 'images'])
      next[key] = structuredClone(draft[key]);
  }
  draft = next;
  await persist();
  await refreshArchives();
  message('New draft ready. Previous draft retained in browser storage.');
}
$('new').addEventListener('click', async () => {
  await action(() => replaceDraft(false));
  await drainInbox();
});
$('duplicate').addEventListener('click', async () => {
  await action(() => replaceDraft(true));
  await drainInbox();
});
$('restore-draft').addEventListener('click', () =>
  action(async () => {
    const id = $('archives').value;
    if (!id) return;
    const previous = await get(`archive:${id}`);
    if (!previous) throw new Error('That draft no longer exists.');
    await put(`archive:${draft.id}`, draft);
    draft = previous;
    await refreshDirectory();
    await persist();
    await refreshArchives();
    message('Previous draft restored.');
  }),
);
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

async function openEditor(image) {
  const bitmap = await createImageBitmap(await (await fetch(image.dataUrl)).blob());
  const canvas = $('editor-canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  editing = {
    image,
    base: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height),
    rect: null,
    start: null,
  };
  $('selection').textContent = 'No area selected.';
  $('editor').showModal();
}
function paintEditor() {
  const c = $('editor-canvas'),
    ctx = c.getContext('2d');
  ctx.putImageData(editing.base, 0, 0);
  if (editing.rect) {
    const { x, y, w, h } = editing.rect;
    ctx.strokeStyle = '#ff5d00';
    ctx.lineWidth = Math.max(2, c.width / 400);
    ctx.strokeRect(x, y, w, h);
    $('selection').textContent = `Selected ${w} × ${h} pixels.`;
  }
}
function point(event) {
  const c = $('editor-canvas'),
    r = c.getBoundingClientRect();
  return {
    x: Math.round(Math.max(0, Math.min(c.width, ((event.clientX - r.left) * c.width) / r.width))),
    y: Math.round(Math.max(0, Math.min(c.height, ((event.clientY - r.top) * c.height) / r.height))),
  };
}
$('editor-canvas').addEventListener('pointerdown', (event) => {
  if (!editing) return;
  editing.start = point(event);
  event.target.setPointerCapture(event.pointerId);
});
$('editor-canvas').addEventListener('pointermove', (event) => {
  if (!editing?.start) return;
  const end = point(event),
    start = editing.start;
  editing.rect = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
  paintEditor();
});
$('editor-canvas').addEventListener('pointerup', () => {
  if (editing) editing.start = null;
});
for (const kind of ['crop', 'redact'])
  $(kind).addEventListener('click', () => {
    if (!editing?.rect?.w || !editing.rect.h) return;
    const c = $('editor-canvas'),
      ctx = c.getContext('2d'),
      { x, y, w, h } = editing.rect;
    ctx.putImageData(editing.base, 0, 0);
    if (kind === 'crop') {
      const selected = ctx.getImageData(x, y, w, h);
      c.width = w;
      c.height = h;
      ctx.putImageData(selected, 0, 0);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, w, h);
    }
    editing.base = ctx.getImageData(0, 0, c.width, c.height);
    editing.rect = null;
    editing.start = null;
    $('selection').textContent = 'Preview updated. Apply to keep this edit.';
  });
$('restore-image').addEventListener('click', async () => {
  if (editing) {
    const image = editing.image;
    const original = image.originalDataUrl || image.dataUrl;
    await openEditor({ ...image, dataUrl: original });
    editing.image = image;
  }
});
$('apply-image').addEventListener('click', () =>
  action(async () => {
    if (!editing) return;
    const image = editing.image,
      c = $('editor-canvas');
    c.getContext('2d').putImageData(editing.base, 0, 0);
    image.originalDataUrl ||= image.dataUrl;
    image.dataUrl = c.toDataURL('image/png');
    image.sha256 = await sha256(dataUrlBytes(image.dataUrl).bytes);
    await persist();
    $('editor').close();
    editing = null;
    message('Image edit applied. The exported bundle includes only the edited image.');
  }),
);
$('cancel-image').addEventListener('click', () => {
  $('editor').close();
  editing = null;
});
$('editor').addEventListener('close', () => {
  editing = null;
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'capture-ready') drainInbox();
});
async function refreshDirectory() {
  const selected = await get('directory');
  const plan = draft?.local;
  if (plan && (plan.complete || plan.verified.length)) {
    const same = selected && plan.directory && (await selected.isSameEntry(plan.directory));
    if (!same) {
      plan.complete = false;
      plan.verified = [];
      await persist();
    }
  }
  directory = selected;
}
function refreshWhenIdle() {
  if (!refreshPending || busy || locked || !draft) return;
  refreshPending = false;
  action(async () => {
    settings = { ...defaultSettings(), ...(await get('settings')) };
    await refreshDirectory();
  }).then(() => drainInbox());
}
window.addEventListener('focus', () => {
  refreshPending = true;
  refreshWhenIdle();
});

navigator.locks
  .request('MyDefector-sidecar:editor', { ifAvailable: true }, async (lock) => {
    if (!lock) {
      locked = true;
      message(
        'This draft is open in another panel. Close that panel and reload here to edit safely.',
        true,
      );
      freezeControls();
      return;
    }
    try {
      settings = { ...defaultSettings(), ...(await get('settings')) };
      draft = (await get('draft')) || newCapture(settings);
      await refreshDirectory();
      await persist();
      await refreshArchives();
      render();
      message(
        draft.local
          ? 'Saved snapshot restored. You can retry save/export or start a new draft.'
          : 'Draft restored. Capture a page or add images.',
      );
      await drainInbox();
    } catch (error) {
      locked = true;
      message(`Cannot open local draft storage: ${error.message}`, true);
      freezeControls();
    }
    await new Promise(() => {});
  })
  .catch((error) => {
    locked = true;
    message(error.message, true);
    freezeControls();
  });
