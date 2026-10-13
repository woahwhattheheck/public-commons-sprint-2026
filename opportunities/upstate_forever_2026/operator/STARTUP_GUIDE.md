# Workbench startup and Windows operation

Read the application [owner direction](../CURRENT_OWNER_DIRECTION.md) and [working instructions](../AGENTS.md) together with this guide.

## Startup guidance

A connected, loaded workbench offers four short cards for Workspace, original sources and scientific workflow, Operations, and backup and delivery. The Quick guide button resumes a dismissed guide and replays a completed guide. Next, Back, Not now, Done and Show control operate the guide itself. Show control scrolls to and focuses the existing control; it never submits a form, starts a calculation or changes a scientific selection.

Progress belongs to the current person, workspace and scientific project in the same browser origin. Other people and restored workspaces have independent records. An unknown future storage format is preserved; unavailable storage falls back to the current browser session. The guide appears after authenticated workspace loading and steps aside for open dialogs, Operations and scientific editing. It remains separate from the scientific Guided journey and the Measurements reader.

## Open, save and close

Use the existing `open_received_study.py` wrapper with the selected Workspace, application, interpreter and private operator state. Windows plain opening uses the same scientific project and retained results. Native scientific execution continues on its configured compatible runtime.

The launcher owns only the process it starts. On Windows it starts a separate process group and waits for the child's nonce-bound shutdown-handler acknowledgement before sending CTRL_BREAK. The collector keeps consuming output while the server drains active work and releases its lease. Repeated Ctrl+C leaves that shutdown in progress. An adopted existing session remains running when its adopting launcher returns. Keep the owning terminal open until normal shutdown completes.

Back up the Workspace, open the downloaded archive, restore into a new directory through the existing receiving workflow, and reopen the retained project. Selected Studies and source recipes retain their existing export/import operations. Windows receives ordinary canonical member names; device names, invalid components and case aliases are rejected before extraction. Source uploads use the same naming rules.

## File identity and platform behavior

The Windows filesystem adapter opens leaf handles without following reparse points, uses process locks, flushes file bodies and publishes replacements through write-through moves. Path and descriptor identity both read native ChangeTime; device, inode, length and modification time remain part of the same verification. This catches modified source bytes even when an earlier modification timestamp is restored. Online SQLite capture retains its existing device/inode comparison; frozen snapshots retain full identity and content verification.

POSIX retains its original file-stat calls, locks, reflink fallback and directory fsync. Windows directory validation is not a POSIX directory-fsync guarantee. Retained-object durability reopening needs a writable handle on Windows.

## Inspect the outgoing application

The producing worker must personally open, operate and look at the exact outgoing application and every attachment in its normal viewer before presenting it. At desktop and 390-pixel widths, use all four cards, Show control, dismissal, resume and replay. Switch between retained Workspaces, open an existing task and an editable scientific form, and verify the guide yields while work stays intact. Export and open the populated Workspace and selected Study, save a real edit, close normally and cold reopen it. Fix the actual affected screen or operation when a defect appears; retain the existing scientific outputs and process ownership.

Static source checks and filesystem checks establish their specific behavior. The populated application and recipient-facing files still require direct operation and visual inspection.
