import { enqueueCapture, get } from './lib/db.js';

async function capture(tab) {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab.windowId) || !tab.active || !tab.url) {
    throw new Error(
      'Activate a page and click the extension icon (or its keyboard shortcut) to grant capture access.',
    );
  }
  const settings = await get('settings');
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: settings?.imageFormat === 'jpeg' ? 'jpeg' : 'png',
  });
  const after = await chrome.tabs.get(tab.id);
  if (!after.active || after.url !== tab.url)
    throw new Error('The page changed during capture. Capture it again.');
  const image = {
    id: crypto.randomUUID(),
    dataUrl,
    source: { url: tab.url, title: tab.title || '' },
    capturedAt: new Date().toISOString(),
  };
  await enqueueCapture(image);
  chrome.runtime.sendMessage({ type: 'capture-ready' }).catch(() => {});
  return { ok: true };
}
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  capture(tab).catch(async (error) => {
    await enqueueCapture({ id: crypto.randomUUID(), error: error.message });
    chrome.runtime.sendMessage({ type: 'capture-ready' }).catch(() => {});
  });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'capture-visible') return false;
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => capture(tab))
    .then(respond)
    .catch((error) => respond({ ok: false, error: error.message }));
  return true;
});
