# MyDefector-sidecar

Capture a problem while you browse. Save a Markdown note and its ordered screenshots in a folder you choose. **Chrome is all an end user needs: no Node.js, server, receiver, account or AI.**

Version 0.2.0 saves directly to your chosen local folder. Keep the note and pictures together so the image links continue to work.

## Start using it

1. Keep the unpacked `extension` folder in a permanent location. In desktop Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that folder.
2. Pin **MyDefector-sidecar**. On the page with the problem, click its icon or press **Ctrl+Shift+Y** (**Command+Shift+Y** on macOS). The panel opens and captures the visible page.
3. Choose **Choose save folder**, near the top of the panel or in **Settings**. Both controls use the same remembered folder. Choosing a folder does not save files yet.
4. Add a title, description and steps. Capture or add more PNG/JPEG images; reorder, crop or redact them as needed.
5. Choose **Save Markdown + images**. The note, numbered pictures and receipt share one basename and stay together. Every file is reopened and its SHA-256 checked.

A saved directory may need permission again after Chrome restarts. Click **Save** to request it, choose the folder again if necessary, or use **Export ZIP**. Nothing requires a local server or a port. See [Local setup and acceptance](docs/LOCAL-SETUP.md).

## Files and recovery

Each capture produces a `.md` note, ordered `.png`/`.jpg` pictures and a `.receipt.json` containing filenames, sizes and SHA-256 hashes. Names include UTC time, an optional sanitized title and the complete capture UUID. The note preserves full text, page URL/title, capture time/timezone, severity, tags and relative image links.

- Text, images, original images for restoration and immutable save snapshots stay in this browser profile. A second panel cannot overwrite an open editor.
- The first save/export freezes the snapshot. Retry uses the same identity, bytes and filenames. Matching files are reused; mismatched files are never overwritten. After an interrupted partial write, choose an empty folder or export ZIP.
- Changing the destination clears its save verification status. The exact same snapshot must be written and read back in the new folder before it is reported saved there.
- **Export ZIP** packages the same note, pictures and receipt. Check the browser download result; requesting ZIP is not a verified folder save. Very large ZIP64 bundles require direct folder saving.
- **Copy Markdown** copies the note; relative image links still need the accompanying files. **New capture**, **Copy to a new draft** and **Previous drafts** preserve archived drafts.
- Saves are a sequence of writes, not an atomic multi-file transaction. Keep other programs from changing these filenames while saving.

If storage is full/unavailable, keep the panel open and export or copy before closing. Removing the extension or clearing its data deletes retained browser drafts/settings/handles. Export first; saved files are not deleted. Upgrade preserves existing capture data and opaque historical metadata; it does not retry or reclassify earlier remote operations.

## Privacy and permissions

Only `activeTab` and `sidePanel` are required. Invoke the icon/shortcut on each new page to grant screenshot access. There is no browsing-history read, injected page script, analytics, remote destination or network transmission. Screenshots may contain private information: review and redact before sharing. Browser drafts/originals are not encrypted by this application.

The former optional posting adapter and receiver are removed from the current source. Historical commits/receipts remain records; no data is automatically sent or purged. Users do not run development commands.

## Contributor checks

For contributor tests, use a full source checkout. Node 22+ is **developer test tooling only**, never an end-user prerequisite:

```sh
npm test
npm run check
```

The browser fixture uses an existing Playwright installation and disposable Chrome profile; no dependency or browser installation occurs:

```sh
PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright/index.mjs \
CHROME_BIN=/usr/bin/google-chrome \
MYDEFECTOR_TEST_EVIDENCE=/tmp/mydefector-local-only-evidence \
node test/browser.mjs
```

DOM/canvas/IndexedDB/Web Locks/OPFS/ZIP run in Chrome. Extension APIs and picker selection are substituted. Actual **Load unpacked**, toolbar capture, native folder prompt, restart and real selected-directory readback need separate manual acceptance. Source tests do not replace the installation check in your actual browser. [Chrome removed the former automated load-extension shortcut](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ); use normal installation, not policy bypasses.

References: [side panels](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab), [directory handles and permission recovery](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

## License and contributions

First-party source uses the [MIT license](LICENSE); see [contributors](CONTRIBUTORS.md). Browser and optional developer test tools are installed separately and are not bundled. Use synthetic reports when contributing; keep captured notes, pictures and private configuration out of commits.
