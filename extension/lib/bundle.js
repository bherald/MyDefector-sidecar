import { basename, dataUrlBytes, markdown, sha256, validateCapture } from './capture.js';

export async function prepareBundle(capture, settings) {
  validateCapture(capture);
  const name = basename(capture, settings);
  const images = capture.images.map((image, i) => {
    const decoded = dataUrlBytes(image.dataUrl);
    return {
      name: `${name}-${String(i + 1).padStart(2, '0')}.${decoded.extension}`,
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
    };
  });
  const text = markdown(
    capture,
    images.map((x) => x.name),
  );
  const files = [
    {
      name: `${name}.md`,
      bytes: new TextEncoder().encode(text),
      mimeType: 'text/markdown',
    },
    ...images,
  ];
  for (const file of files) file.sha256 = await sha256(file.bytes);
  const receipt = {
    schemaVersion: 1,
    captureId: capture.id,
    basename: name,
    createdAt: capture.createdAt,
    files: files.map(({ name, sha256, bytes }) => ({
      name,
      sha256,
      bytes: bytes.length,
    })),
  };
  const receiptFile = {
    name: `${name}.receipt.json`,
    bytes: new TextEncoder().encode(JSON.stringify(receipt, null, 2) + '\n'),
    mimeType: 'application/json',
  };
  receiptFile.sha256 = await sha256(receiptFile.bytes);
  return {
    basename: name,
    captureId: capture.id,
    markdown: text,
    files: [...files, receiptFile],
    receipt,
    verified: [],
    complete: false,
  };
}

export function chooseSaveDirectory(picker = globalThis.showDirectoryPicker?.bind(globalThis)) {
  if (typeof picker !== 'function')
    throw new Error('Folder selection is unavailable in this browser context.');
  return picker({ id: 'MyDefector-sidecar', mode: 'readwrite' });
}

export async function requestWritePermission(directory) {
  if (!directory) throw new Error('Choose a folder first, or export a ZIP.');
  const descriptor = { mode: 'readwrite' };
  if (
    (await directory.queryPermission(descriptor)) !== 'granted' &&
    (await directory.requestPermission(descriptor)) !== 'granted'
  ) {
    throw new Error(
      'Folder permission was not granted. Choose a folder again or export a ZIP. Your capture is retained.',
    );
  }
}

async function existingFile(directory, name) {
  try {
    return await directory.getFileHandle(name);
  } catch (error) {
    if (error.name === 'NotFoundError') return null;
    throw error;
  }
}

export async function saveBundle(directory, plan, persistProgress) {
  // Never rewrite an existing mismatched file, including an ambiguous partial write.
  // The operator can select an empty folder or use ZIP while keeping this exact snapshot.
  plan.complete = false;
  for (const file of plan.files) {
    const handle = await existingFile(directory, file.name);
    if (handle && (await sha256(await (await handle.getFile()).arrayBuffer())) !== file.sha256) {
      throw new Error(
        `Existing file differs: ${file.name}. No overwrite. Choose an empty folder or export ZIP.`,
      );
    }
  }
  plan.verified = [];
  // Browser-private handle binds save proof to the actual destination; it is never exported.
  plan.directory = directory;
  await persistProgress(plan);
  for (const file of plan.files) {
    let handle = await existingFile(directory, file.name);
    if (handle) {
      if ((await sha256(await (await handle.getFile()).arrayBuffer())) !== file.sha256)
        throw new Error(`File changed during save: ${file.name}`);
    } else {
      handle = await directory.getFileHandle(file.name, { create: true });
      // An external writer may have appeared after the preflight. Recheck before writing.
      if ((await handle.getFile()).size !== 0)
        throw new Error(`File appeared during save: ${file.name}`);
      const stream = await handle.createWritable();
      try {
        await stream.write(file.bytes);
        await stream.close();
      } catch (error) {
        try {
          await stream.abort();
        } catch {}
        throw error;
      }
    }
    const actual = await handle.getFile();
    if (
      actual.size !== file.bytes.length ||
      (await sha256(await actual.arrayBuffer())) !== file.sha256
    )
      throw new Error(`Read-back verification failed: ${file.name}`);
    plan.verified.push(file.name);
    await persistProgress(plan);
  }
  plan.complete = true;
  await persistProgress(plan);
  return plan.receipt;
}
