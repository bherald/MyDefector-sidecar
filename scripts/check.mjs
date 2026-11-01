import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url).pathname;
async function walk(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.') || item.name === 'node_modules') continue;
    const path = join(dir, item.name);
    result.push(...(item.isDirectory() ? await walk(path) : [path]));
  }
  return result;
}
let failed = false;
for (const file of await walk(root)) {
  if (/\.(?:js|mjs)$/.test(file)) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      failed = true;
      console.error(r.stderr);
    }
  }
}
const manifest = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'));
if (
  manifest.name !== 'MyDefector-sidecar' ||
  manifest.permissions.some((x) => !['activeTab', 'sidePanel'].includes(x)) ||
  manifest.host_permissions
) {
  failed = true;
  console.error('Unexpected manifest identity or required permissions.');
}
if (failed) process.exitCode = 1;
else console.log('JavaScript syntax and minimal required manifest permissions PASS.');
