export const defaultSettings = () => ({
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  includeTitle: true,
  imageFormat: 'png',
});

export function newCapture(settings = defaultSettings(), now = new Date()) {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: now.toISOString(),
    timezone: settings.timezone,
    title: '',
    description: '',
    steps: '',
    severity: '',
    tags: '',
    source: { url: '', title: '' },
    images: [],
    local: null,
  };
}

export function filenameTitle(value) {
  return (
    value
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^[. -]+|[. -]+$/g, '')
      .slice(0, 50)
      .replace(/[\uD800-\uDFFF]/gu, '')
      .replace(/[. -]+$/g, '') || 'capture'
  );
}

export function basename(capture, settings) {
  // UTC keeps the filename sortable and unambiguous across DST; the document also records the chosen zone.
  const stamp = capture.createdAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', 'Z');
  return `${stamp}${settings.includeTitle ? `_${filenameTitle(capture.title)}` : ''}_${capture.id}`;
}

export function validateCapture(capture) {
  if (!capture.title.trim()) throw new Error('Add a title before saving.');
  if (!capture.description.trim()) throw new Error('Describe the defect before saving.');
  if (!capture.images.length) throw new Error('Capture or add at least one image.');
  if (!/^[0-9a-f-]{36}$/.test(capture.id)) throw new Error('Invalid capture identity.');
  new Intl.DateTimeFormat('en', { timeZone: capture.timezone }).format(new Date(capture.createdAt));
}

export function dataUrlBytes(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('Only PNG and JPEG image data is supported.');
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const png =
    bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x);
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(match[1] === 'image/png' ? png : jpeg))
    throw new Error('Image bytes do not match their format.');
  return {
    bytes,
    mimeType: match[1],
    extension: match[1] === 'image/png' ? 'png' : 'jpg',
  };
}

export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

export function markdown(capture, imageNames) {
  const localTime = new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'full',
    timeStyle: 'long',
    timeZone: capture.timezone,
  }).format(new Date(capture.createdAt));
  return [
    `# ${capture.title}`,
    '',
    `Capture ID: ${capture.id}`,
    `Captured (UTC): ${capture.createdAt}`,
    `Captured (${capture.timezone}): ${localTime}`,
    `Page title: ${capture.source.title}`,
    `Page URL: ${capture.source.url}`,
    `Severity: ${capture.severity || 'Not specified'}`,
    `Tags: ${capture.tags}`,
    '',
    '## Description',
    '',
    capture.description,
    '',
    '## Reproduction steps',
    '',
    capture.steps,
    '',
    '## Screenshots',
    '',
    ...capture.images.flatMap((image, i) => [
      `![Screenshot ${i + 1}](<${imageNames[i]}>)`,
      '',
      `Source: ${image.source?.url || capture.source.url}`,
      `Captured: ${image.capturedAt || capture.createdAt}`,
      '',
    ]),
  ].join('\n');
}
