import { get, put } from './lib/db.js';
import { defaultSettings } from './lib/capture.js';
import { chooseSaveDirectory } from './lib/bundle.js';
const $ = (id) => document.getElementById(id);
const settings = { ...defaultSettings(), ...(await get('settings')) };
let directory = await get('directory');
$('folder-name').textContent = directory?.name || 'No folder selected';
$('timezone').value = settings.timezone;
$('include-title').checked = settings.includeTitle;
$('image-format').value = settings.imageFormat;
$('folder').addEventListener('click', async () => {
  try {
    // The picker starts in this user gesture, before any storage work.
    const chosen = await chooseSaveDirectory();
    await put('directory', chosen);
    directory = chosen;
    $('folder-name').textContent = directory.name;
    $('folder-status').textContent =
      'Folder saved. Return to the capture panel and choose Save Markdown + images.';
  } catch (error) {
    $('folder-status').textContent =
      error.name === 'AbortError'
        ? 'Folder selection cancelled. Your saved folder is unchanged.'
        : `${error.message} Your previous folder is retained. You can export a ZIP from the capture panel.`;
  }
});
$('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    new Intl.DateTimeFormat('en', { timeZone: $('timezone').value }).format();
    await put('settings', {
      ...settings,
      timezone: $('timezone').value,
      includeTitle: $('include-title').checked,
      imageFormat: $('image-format').value,
    });
    $('settings-status').textContent =
      'Settings saved. Existing captures keep their original timezone.';
  } catch (error) {
    $('settings-status').textContent = error.message;
  }
});
