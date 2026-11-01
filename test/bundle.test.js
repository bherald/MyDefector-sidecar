import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  newCapture,
  defaultSettings,
  filenameTitle,
  dataUrlBytes,
  sha256,
} from '../extension/lib/capture.js';
import {
  prepareBundle,
  saveBundle,
  requestWritePermission,
  chooseSaveDirectory,
} from '../extension/lib/bundle.js';
import { zipBundle, crc32 } from '../extension/lib/zip.js';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=';
function capture() {
  const d = newCapture(
    { ...defaultSettings(), timezone: 'America/New_York' },
    new Date('2026-11-01T06:30:00.125Z'),
  );
  Object.assign(d, {
    title: '../CON: login / error 🧪',
    description: '  Full input\n<script>literal</script>\n' + '正文😀'.repeat(12000),
    steps: '1. Login\n2. Observe\n',
    source: {
      url: 'https://example.test/page?x=1#part',
      title: 'Example <page>',
    },
  });
  d.images = [
    { id: crypto.randomUUID(), dataUrl: png, source: d.source },
    { id: crypto.randomUUID(), dataUrl: png, source: d.source },
  ];
  return d;
}
class Directory {
  constructor(path) {
    this.path = path;
    this.writes = 0;
    this.failAt = 0;
    this.corrupt = false;
  }
  async getFileHandle(name, { create = false } = {}) {
    const path = join(this.path, name),
      self = this;
    try {
      await stat(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) throw new DOMException('missing', 'NotFoundError');
      await writeFile(path, new Uint8Array(), { flag: 'wx' });
    }
    return {
      async getFile() {
        const bytes = await readFile(path);
        return new Blob([bytes]);
      },
      async createWritable() {
        self.writes++;
        return {
          async write(bytes) {
            if (self.failAt === self.writes) throw new Error('disk full');
            this.bytes = bytes;
          },
          async close() {
            await writeFile(path, self.corrupt ? 'corrupt' : this.bytes);
          },
          async abort() {},
        };
      },
    };
  }
}
test('full Unicode/text retained, stable same-root names, ordered links, exact hashes and receipt', async () => {
  const d = capture(),
    p = await prepareBundle(d, defaultSettings());
  assert.ok(p.markdown.includes(d.description));
  assert.ok(p.markdown.includes(d.steps));
  assert.ok(p.markdown.includes(d.source.url));
  assert.ok(p.markdown.includes('America/New_York'));
  assert.match(p.basename, /2026-11-01_06-30-00-125Z/);
  assert.ok(p.basename.endsWith(d.id));
  assert.equal(p.files.length, 4);
  for (const file of p.files) {
    assert.ok(!/[<>:"/\\|?*\x00-\x1f]/.test(file.name));
    assert.equal(file.sha256, await sha256(file.bytes));
  }
  assert.ok(p.markdown.indexOf(p.files[1].name) < p.markdown.indexOf(p.files[2].name));
  assert.equal(p.receipt.files.length, 3);
  assert.deepEqual((await prepareBundle(d, defaultSettings())).files, p.files);
});
test('collision resistance uses complete UUID, same timestamp/title remain distinct', async () => {
  const a = capture(),
    b = capture();
  assert.notEqual(
    (await prepareBundle(a, defaultSettings())).basename,
    (await prepareBundle(b, defaultSettings())).basename,
  );
  assert.equal(filenameTitle(' .. / : ? '), 'capture');
});
test('invalid/incomplete image input rejects; bytes checked against MIME', async () => {
  assert.throws(() => dataUrlBytes('data:image/png;base64,aGVsbG8='), /bytes/);
  const d = capture();
  d.images = [];
  await assert.rejects(prepareBundle(d, defaultSettings()), /at least one/);
  d.images = [{ dataUrl: png }];
  d.title = ' ';
  await assert.rejects(prepareBundle(d, defaultSettings()), /title/);
});
test('real filesystem save reopens/verifies every file; replay does not rewrite', async () => {
  const path = await mkdtemp(join(tmpdir(), 'MyDefector-sidecar-test-')),
    dir = new Directory(path),
    p = await prepareBundle(capture(), defaultSettings()),
    checkpoints = [];
  await saveBundle(dir, p, async (value) => checkpoints.push(structuredClone(value)));
  assert.equal(p.complete, true);
  assert.equal(dir.writes, 4);
  assert.equal(p.verified.length, 4);
  assert.equal(checkpoints.length, 6);
  await saveBundle(dir, p, async () => {});
  assert.equal(dir.writes, 4);
  assert.deepEqual(JSON.parse(await readFile(join(path, p.files[3].name), 'utf8')), p.receipt);
});
test('mismatching collision rejects before any write, preserves foreign bytes', async () => {
  const path = await mkdtemp(join(tmpdir(), 'MyDefector-sidecar-collision-')),
    dir = new Directory(path),
    p = await prepareBundle(capture(), defaultSettings());
  await writeFile(join(path, p.files[2].name), 'unrelated');
  await assert.rejects(
    saveBundle(dir, p, async () => {}),
    /No overwrite/,
  );
  assert.equal(dir.writes, 0);
  assert.equal(await readFile(join(path, p.files[2].name), 'utf8'), 'unrelated');
  assert.equal(p.complete, false);
});
test('disk failure preserves snapshot and written-file proof; restart can save exact snapshot to empty folder', async () => {
  const path = await mkdtemp(join(tmpdir(), 'MyDefector-sidecar-failure-')),
    dir = new Directory(path),
    p = await prepareBundle(capture(), defaultSettings());
  dir.failAt = 2;
  let checkpoint;
  await assert.rejects(
    saveBundle(dir, p, async (value) => {
      checkpoint = structuredClone(value);
    }),
    /disk full/,
  );
  assert.equal(checkpoint.verified.length, 1);
  assert.equal(p.complete, false);
  await assert.rejects(
    saveBundle(dir, p, async () => {}),
    /Existing file differs/,
  );
  assert.equal(dir.writes, 2);
  assert.equal(p.verified.length, 1);
  const target = join(path, 'recovered');
  await mkdir(target);
  await saveBundle(new Directory(target), checkpoint, async () => {});
  assert.equal(checkpoint.complete, true);
  assert.equal(checkpoint.captureId, p.captureId);
});
test('read-back corruption never reports saved; progress persistence failure prevents writes', async () => {
  const dir = new Directory(await mkdtemp(join(tmpdir(), 'MyDefector-sidecar-corrupt-'))),
    p = await prepareBundle(capture(), defaultSettings());
  await assert.rejects(
    saveBundle(dir, p, async () => {
      throw new Error('storage quota');
    }),
    /storage quota/,
  );
  assert.equal(dir.writes, 0);
  dir.corrupt = true;
  await assert.rejects(
    saveBundle(dir, p, async () => {}),
    /verification failed/,
  );
  assert.equal(p.complete, false);
  assert.equal(p.verified.length, 0);
});
test('revoked permission requests recovery; refusal and absent folder are explicit', async () => {
  const calls = [];
  await requestWritePermission({
    queryPermission: async () => 'prompt',
    requestPermission: async (opts) => {
      calls.push(opts);
      return 'granted';
    },
  });
  assert.deepEqual(calls, [{ mode: 'readwrite' }]);
  await assert.rejects(
    requestWritePermission({
      queryPermission: async () => 'denied',
      requestPermission: async () => 'denied',
    }),
    /capture is retained/,
  );
  await assert.rejects(requestWritePermission(null), /Choose a folder/);
});
test('ZIP independently extracts all original bytes, Unicode names and CRC', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const p = await prepareBundle(capture(), defaultSettings()),
    root = await mkdtemp(join(tmpdir(), 'MyDefector-sidecar-zip-'));
  const path = join(root, 'bundle.zip');
  await writeFile(path, new Uint8Array(await zipBundle(p.files).arrayBuffer()));
  const actual = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        'import zipfile,json,hashlib,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}))',
        path,
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.deepEqual(actual, Object.fromEntries(p.files.map((file) => [file.name, file.sha256])));
});

test('folder chooser invokes the browser immediately from the click; cancellation and unavailable API are explicit', async () => {
  const calls = [];
  const handle = { name: 'selected-folder' };
  const pending = chooseSaveDirectory((options) => {
    calls.push(options);
    return Promise.resolve(handle);
  });
  assert.deepEqual(calls, [{ id: 'MyDefector-sidecar', mode: 'readwrite' }]);
  assert.equal(await pending, handle);
  assert.throws(() => chooseSaveDirectory(null), /unavailable/);
  await assert.rejects(
    chooseSaveDirectory(() => Promise.reject(new DOMException('Cancelled', 'AbortError'))),
    { name: 'AbortError' },
  );
});

test('save proof binds to the actual target while exported receipt remains portable and handle-free', async () => {
  const plan = await prepareBundle(capture(), defaultSettings());
  const a = new Directory(await mkdtemp(join(tmpdir(), 'MyDefector-folder-a-')));
  const b = new Directory(await mkdtemp(join(tmpdir(), 'MyDefector-folder-b-')));
  await saveBundle(a, plan, async () => {});
  assert.equal(plan.directory, a);
  const exactFiles = structuredClone(plan.files);
  await saveBundle(b, plan, async () => {});
  assert.equal(plan.directory, b);
  assert.deepEqual(plan.files, exactFiles);
  assert.equal(plan.complete, true);
  assert.equal(JSON.stringify(plan.receipt).includes(b.path), false);
  assert.equal(
    plan.files.some((file) => new TextDecoder().decode(file.bytes).includes(b.path)),
    false,
  );
});
