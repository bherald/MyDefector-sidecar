# Install and save your first report

Chrome is all you need to use MyDefector-sidecar. Node.js is only for contributors running developer tests.

1. Unzip the extension package into a permanent folder. Keep that folder in place.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `extension` folder containing `manifest.json`.
3. Pin MyDefector-sidecar. On the page you want to report, click its icon or press **Ctrl+Shift+Y** (**Command+Shift+Y** on macOS).
4. Click **Choose save folder**, near the top of the panel or in **Settings**. Chrome asks you to choose and allow a folder. This selects the destination; it does not save a report yet.
5. Enter a title, description and reproduction steps. Capture or add pictures, then review their order and any redactions.
6. Click **Save Markdown + images**. Open the chosen folder: it contains a Markdown note, numbered pictures and a receipt with file sizes and hashes. Keep them together.

## Keep working

The folder name appears in both Settings and the capture panel. Changing it leaves the first folder intact and requires a fresh save/readback in the new destination. If Chrome asks for permission after a restart, grant it through your Save click, choose the folder again, or use **Export ZIP**. Check Chrome's download result after exporting.

A retry uses the same names and bytes. Matching files are reused; different existing files are not overwritten. An interrupted partial file can require an empty folder or ZIP export. Save writes several files in sequence, so avoid changing these same filenames in another program while saving.

Local saves work offline. Browser settings/store pages may refuse screenshots; use a normal page or **Add images**. File pages need Chrome's separate file-URL access setting.

## Upgrade or remove

To upgrade an unpacked installation, replace files in the same permanent folder and click its **Reload** button at `chrome://extensions`. Keeping the same folder preserves the extension identity and browser drafts. Existing historical metadata stays local and is not retransmitted.

Export drafts you want before removing the extension or clearing its data. Removing it deletes browser drafts, original images and saved folder permissions; exported files remain yours.

## Check an installation

Save a report with two distinct pictures, open its Markdown and both images, and compare the receipt hashes. Retry without duplicates. Choose another folder and confirm a new verified save there while the first stays intact. Check draft/folder recovery after restarting Chrome and try ZIP after cancelling folder permission. Developer browser fixtures substitute picker/extension entry points, so they do not replace this check in your actual installed browser.
