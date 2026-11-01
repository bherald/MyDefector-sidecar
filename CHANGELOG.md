# Changes

## 0.2.0 — local folder saves

- Choose the save folder near the top of the capture panel or in Settings. Both controls remember the same folder.
- Save a Markdown note, ordered pictures and a hash receipt directly to that folder. Retry, permission recovery, ZIP export and existing drafts remain available.
- Changing folders clears verification until the exact snapshot has been saved and checked in the new destination. Restoring archived drafts and changing Settings during a save also refresh folder state safely.
- The former posting adapter, receiver and their dependencies are removed. Chrome is the end-user application; Node is contributor test tooling only. Existing browser data and historical metadata stay local.

Verification includes 11 local-file unit cases and 14 disposable Chrome scenarios. Those fixtures substitute extension entry points and picker selection; use the installation check in [Local setup](docs/LOCAL-SETUP.md) for the actual toolbar, native folder prompt and saved files.
