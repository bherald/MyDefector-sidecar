// Existing Playwright installation supplied by the caller; no browser/dependency install.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = resolve(import.meta.dirname, '../extension');
const evidence = resolve(process.env.MYDEFECTOR_TEST_EVIDENCE || '.cache/browser');
await mkdir(evidence, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + '/')) throw Error('path');
    const body = await readFile(path);
    res.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] ||
        'application/octet-stream',
    );
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'MyDefector-sidecar-chrome-'));
let context;
const results = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true,
    viewport: { width: 1000, height: 1050 },
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    // Only Chrome extension entry points are substituted. DOM, canvas, IndexedDB,
    // Web Locks, ZIP downloads and OPFS directory/file handles run in real Chrome.
    window.chrome = {
      runtime: {
        onMessage: { addListener() {} },
        openOptionsPage: async () => {},
        sendMessage: async () => ({
          ok: false,
          error: 'Click the extension icon on this page first.',
        }),
      },
    };
    window.showDirectoryPicker = async () => {
      const dir = await navigator.storage.getDirectory();
      window.__pickerCalls = (window.__pickerCalls || 0) + 1;
      if (window.__cancelPicker) throw new DOMException('Cancelled', 'AbortError');
      return dir.getDirectoryHandle(window.__folderName || 'test-bundles', {
        create: true,
      });
    };
  });
  const page = context.pages()[0],
    errors = [],
    requests = [];
  context.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/sidepanel.html`);
  await page.waitForFunction(() =>
    document.querySelector('#message').textContent.includes('Draft restored'),
  );
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#dce9f2';
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#183d51';
    ctx.font = '24px sans-serif';
    ctx.fillText('Synthetic login page', 32, 65);
    ctx.fillStyle = '#b23e38';
    ctx.fillText('Example: sign-in failed', 32, 130);
    return c.toDataURL('image/png');
  });
  const imageBytes = Buffer.from(image.split(',')[1], 'base64');
  await page.locator('#title').fill('Login error — test capture');
  const full = '  Exact description\n' + 'Unicode 😀正文 '.repeat(1600) + '\nLast line retained  ';
  await page.locator('#description').fill(full);
  await page
    .locator('#steps')
    .fill('1. Open the synthetic login page\n2. Submit\n3. Observe error');
  await page.locator('#add-images').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: imageBytes },
    { name: 'second.png', mimeType: 'image/png', buffer: imageBytes },
  ]);
  await page.waitForFunction(() => document.querySelector('#image-count').textContent === '2');
  await page.waitForFunction(async () => {
    const { get } = await import('./lib/db.js');
    return (await get('draft')).images.length === 2;
  });
  const before = await page.evaluate(async () => {
    const { get } = await import('./lib/db.js');
    return get('draft');
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#image-count').textContent === '2');
  assert.equal(await page.locator('#description').inputValue(), full);
  assert.equal(
    (
      await page.evaluate(async () => {
        const { get } = await import('./lib/db.js');
        return get('draft');
      })
    ).id,
    before.id,
  );
  results.push('restart restores full Unicode draft, stable UUID, and both image bytes');
  const second = await context.newPage();
  await second.goto(`${origin}/sidepanel.html`);
  await second.waitForFunction(() =>
    document.querySelector('#message').textContent.includes('another panel'),
  );
  assert.equal(await second.locator('#title').isDisabled(), true);
  await second.close();
  results.push('second panel cannot overwrite the active editor');
  await page.locator('.image-card').nth(1).getByText('Move up', { exact: true }).click();
  await page.waitForFunction(async () => {
    const { get } = await import('./lib/db.js');
    return (await get('draft')).images[0].source.title === 'second.png';
  });
  await page.locator('.image-card').first().getByText('Crop / redact', { exact: true }).click();
  await page.locator('#editor').waitFor({ state: 'visible' });
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 110);
  await page.mouse.up();
  await page.locator('#redact').click();
  await page.locator('#apply-image').click();
  await page.waitForFunction(async () => {
    const { get } = await import('./lib/db.js');
    return Boolean((await get('draft')).images[0].originalDataUrl);
  });
  const edited = await page.evaluate(async () => {
    const { get } = await import('./lib/db.js');
    return (await get('draft')).images[0];
  });
  assert.notEqual(edited.dataUrl, edited.originalDataUrl);
  results.push('ordered images and deliberate canvas redaction retain original privately');
  await page.locator('#folder').click();
  await page.waitForFunction(
    () => document.querySelector('#folder-name').textContent === 'test-bundles',
  );
  await page.locator('#save').click();
  await page.waitForFunction(() =>
    document.querySelector('#local-status').textContent.startsWith('Saved and read back'),
  );
  const saved = await page.evaluate(async () => {
    const { get } = await import('./lib/db.js');
    const d = await get('draft'),
      dir = await get('directory');
    const names = [];
    for await (const name of dir.keys()) names.push(name);
    return { draft: d, names };
  });
  assert.equal(saved.names.length, 4);
  assert.equal(saved.draft.local.verified.length, 4);
  assert.ok(saved.draft.local.markdown.includes(full));
  assert.equal(await page.locator('#title').isDisabled(), true);
  results.push('real OPFS files saved with per-file readback hashes and immutable snapshot');
  await page.setViewportSize({ width: 1000, height: 1050 });
  await page.screenshot({
    path: join(evidence, 'desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 350, height: 900 });
  await page.screenshot({
    path: join(evidence, 'compact.png'),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  results.push('desktop and 350px layout render without horizontal overflow');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#zip').click();
  const download = await downloadEvent;
  await download.saveAs(join(evidence, 'synthetic-bundle.zip'));
  assert.ok(download.suggestedFilename().endsWith(`${before.id}.zip`));
  results.push('actual Chrome ZIP download contains pinned capture identity');
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector('#local-status').textContent.startsWith('Saved and read back'),
  );
  assert.equal(await page.locator('#folder-name').textContent(), 'test-bundles');
  await page.locator('#save').click();
  await page.waitForFunction(() =>
    document.querySelector('#message').textContent.startsWith('Saved.'),
  );
  results.push('stored real directory handle and unchanged save replay survive reload');
  await page.evaluate(async () => {
    const { get, put } = await import('./lib/db.js');
    const draft = await get('draft');
    draft.google = {
      state: 'unknown',
      attempted: true,
      body: { requestId: 'historical-synthetic-only' },
    };
    await put('draft', draft);
  });
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector('#local-status').textContent.startsWith('Saved and read back'),
  );
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#duplicate').click();
  await page.waitForFunction(() => !document.querySelector('#title').disabled);
  const copied = await page.evaluate(async () => {
    const { get } = await import('./lib/db.js');
    return get('draft');
  });
  assert.notEqual(copied.id, before.id);
  assert.equal(copied.description, full);
  assert.equal(copied.images.length, 2);
  await page.locator('summary').filter({ hasText: 'Previous drafts' }).click();
  await page.locator('#archives').selectOption(before.id);
  await page.locator('#restore-draft').click();
  await page.waitForFunction(
    () => document.querySelector('#message').textContent === 'Previous draft restored.',
  );
  assert.deepEqual(
    await page.evaluate(async () => {
      const { get } = await import('./lib/db.js');
      return (await get('draft')).google;
    }),
    {
      state: 'unknown',
      attempted: true,
      body: { requestId: 'historical-synthetic-only' },
    },
  );
  results.push(
    'new local draft uses fresh identity; archive restores exact original snapshot and opaque prior unknown metadata without transmission',
  );
  await context.setOffline(true);
  const offlineDownload = page.waitForEvent('download');
  await page.locator('#zip').click();
  await (await offlineDownload).saveAs(join(evidence, 'offline-bundle.zip'));
  await context.setOffline(false);
  results.push('frozen local bundle exports while browser network is offline');
  const options = await context.newPage();
  await options.goto(`${origin}/options.html`);
  assert.equal(await options.locator('#folder-name').textContent(), 'test-bundles');
  assert.equal(
    await options.getByRole('button', { name: 'Choose save folder', exact: true }).isVisible(),
    true,
  );
  await options.evaluate(() => (window.__cancelPicker = true));
  await options.locator('#folder').click();
  await options.waitForFunction(() =>
    document.querySelector('#folder-status').textContent.includes('cancelled'),
  );
  assert.equal(await options.locator('#folder-name').textContent(), 'test-bundles');
  await options.evaluate(() => {
    window.__cancelPicker = false;
    window.__folderName = 'settings-bundles';
  });
  await options.locator('#folder').click();
  await options.waitForFunction(() =>
    document.querySelector('#folder-status').textContent.startsWith('Folder saved.'),
  );
  assert.equal(await options.locator('#folder-name').textContent(), 'settings-bundles');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(
    () => document.querySelector('#folder-name').textContent === 'settings-bundles',
  );
  assert.equal(
    await page.locator('#local-status').textContent(),
    'Snapshot retained. 0/4 files verified in the last save attempt.',
  );
  const prior = await page.evaluate(async () => {
    const { get } = await import('./lib/db.js');
    return (await get('draft')).local;
  });
  await context.setOffline(true);
  await page.locator('#save').click();
  await page.waitForFunction(() =>
    document.querySelector('#local-status').textContent.startsWith('Saved and read back'),
  );
  await context.setOffline(false);
  const moved = await page.evaluate(async () => {
    const { get } = await import('./lib/db.js');
    const draft = await get('draft'),
      dir = await get('directory');
    const files = [];
    for await (const name of dir.keys()) files.push(name);
    return { draft, files, same: await dir.isSameEntry(draft.local.directory) };
  });
  assert.equal(moved.draft.id, before.id);
  assert.deepEqual(moved.draft.local.files, prior.files);
  assert.equal(moved.same, true);
  assert.equal(moved.files.length, 4);
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector('#local-status').textContent.startsWith('Saved and read back'),
  );
  assert.equal(await page.locator('#folder-name').textContent(), 'settings-bundles');
  results.push(
    'Settings chooser cancellation preserves old handle; changed folder refreshes panel, clears old proof, and saves exact snapshot offline; handle/proof survive reload',
  );

  await page.locator('#duplicate').click();
  await page.waitForFunction(() =>
    document.querySelector('#message').textContent.startsWith('New draft ready.'),
  );
  await page.evaluate(() => {
    const original = navigator.locks.request.bind(navigator.locks);
    navigator.locks.request = (name, ...args) => {
      if (!name.startsWith('save:')) return original(name, ...args);
      window.__saveWaiting = true;
      return new Promise((resolve, reject) => {
        window.__releaseSave = () => original(name, ...args).then(resolve, reject);
      });
    };
  });
  await page.locator('#save').click();
  await page.waitForFunction(() => window.__saveWaiting);
  await options.evaluate(() => (window.__folderName = 'settings-next-bundles'));
  await options.locator('#folder').click();
  await options.waitForFunction(
    () => document.querySelector('#folder-name').textContent === 'settings-next-bundles',
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.__releaseSave();
  });
  await page.waitForFunction(
    () => document.querySelector('#folder-name').textContent === 'settings-next-bundles',
  );
  assert.equal(
    await page.locator('#local-status').textContent(),
    'Snapshot retained. 0/4 files verified in the last save attempt.',
  );
  results.push(
    'Settings change focused during busy save is refreshed once afterward, without a second focus or wrong-folder success',
  );
  await page.locator('summary').filter({ hasText: 'Previous drafts' }).click();
  await page.locator('#archives').selectOption(before.id);
  await page.locator('#restore-draft').click();
  await page.waitForFunction(
    () => document.querySelector('#message').textContent === 'Previous draft restored.',
  );
  assert.equal(await page.locator('#folder-name').textContent(), 'settings-next-bundles');
  assert.equal(
    await page.locator('#local-status').textContent(),
    'Snapshot retained. 0/4 files verified in the last save attempt.',
  );
  assert.equal(
    await page.evaluate(async () => {
      const { get } = await import('./lib/db.js');
      return (await get('draft')).id;
    }),
    before.id,
  );
  results.push(
    'restoring an archive verified in a previous folder cannot reuse its completion proof for the current destination',
  );

  await options.evaluate(() => {
    window.__folderName = 'failed-settings-folder';
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'directory')
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  await options.locator('#folder').click();
  await options.waitForFunction(() =>
    document.querySelector('#folder-status').textContent.includes('previous folder is retained'),
  );
  assert.equal(await options.locator('#folder-name').textContent(), 'settings-next-bundles');
  assert.equal(
    await options.evaluate(async () => {
      const { get } = await import('./lib/db.js');
      return (await get('directory')).name;
    }),
    'settings-next-bundles',
  );
  results.push(
    'Settings directory persistence failure preserves previous handle and never claims the new choice was saved',
  );

  await options.locator('#timezone').fill('America/New_York');
  await options.getByRole('button', { name: 'Save settings', exact: true }).click();
  await options.waitForFunction(() =>
    document.querySelector('#settings-status').textContent.startsWith('Settings saved'),
  );
  assert.equal(await options.locator('input[type="password"]').count(), 0);
  assert.equal(await options.locator('input[type="url"]').count(), 0);
  await options.close();
  assert.ok(
    requests.every(
      (url) => url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:'),
    ),
  );
  results.push(
    'Settings remains local-only; no receiver controls, permissions request or external network request',
  );
  assert.deepEqual(errors, []);
  const receipt = {
    status: 'PASS',
    chrome: (await context.browser()?.version()) || 'persistent Chrome',
    tests: results.length,
    results,
    profile,
    limitations: [
      'Chrome extension entrypoints substituted; toolbar activeTab and native folder picker require normal Load unpacked/manual acceptance.',
      'No helper/server is part of product use; fixture server only serves test HTML. No installed/personal profile touched.',
    ],
  };
  await writeFile(join(evidence, 'RESULT.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await context?.close();
  await new Promise((r) => server.close(r));
}
