# Project handover in the shared operator registry

TokenJunkieLabs · ASTRA-TRANSFER12 · 2026-10-12

`extensions/project-transfer.json` installs all nine existing handover actions in
ECSA's original extension registry. It binds the already-shipped
`project_transfer.ProjectTransfers` provider, using the original Operator and
Fault constructor arguments, original queued task dispatch and original verified
file-ticket decoration. It starts no additional server or worker.

## Register in the current cumulative application

Receive the complete project-transfer source from PR2666, then receive this
`operator/extensions/project-transfer.json` into that same application's installed
extension directory. Keep the current ECSA registry and extension host unchanged.
Restart the existing operator through its usual foreground or supervisor command.
Its authenticated `GET /api/extensions` catalogue will include `project-transfer`
and the nine `project.transfer.*` actions. Its original `/api/actions` endpoint
continues to submit them to the retained task queue.

**Use one registration path.** With this manifest, do not run the legacy
`model.project_transfer_install` direct-server join. A server that already has
that direct join can continue using it; the registry will identify that the
same actions already have an owner rather than replacing the existing owner.
Do not remove or replace unrelated desk registrations, source, science or run
controllers to enable handover.

The installed registry descriptor is backend-only. The complete standalone
browser desk remains available through the original published command:

```sh
python -m model.project_transfer_cli --store ../handover-cache serve --port 8876
```

It is a separate file-transport entry point, not another scientific operator.
The registry descriptor does not add a native sidebar panel. Registered actions
are available to existing API clients and original task/download views; the
complete browser operating path is documented in `model/PROJECT_TRANSFER.md`.

## Original queued actions

| Action | Retained input / operation |
| --- | --- |
| `project.transfer.capture` | Freeze the registered live Workspace through original backup; optional intermediate/delivery selection and block size |
| `project.transfer.accept` | `upload_id` of a complete manifest |
| `project.transfer.receive` | `upload_id` of one complete transfer part |
| `project.transfer.parts` | `snapshot_id`, optional request or request upload, optional payload size |
| `project.transfer.archive` | Reconstruct the complete native-compatible ZIP for `snapshot_id` |
| `project.transfer.restore` | Native restore into the original task's new receiving directory, then original Workspace registration |
| `project.transfer.report` | Complete HTML/CSV/JSON file inventory for `snapshot_id` |
| `project.transfer.inspect` | Saved editions or a selected snapshot's complete manifest and missing-block request |
| `project.transfer.diff` | Exact original-file changes between `before_id` and `after_id` |

Download artifacts are decorated through the existing `_ticket` transport.
Receiving retains the original project identity and a separate editable copy.
Transfers remain tied to the selected original Workspace and retained task IDs.

Source contract inspected: ECSA complete revision-2 source bank F0C8TNEPZB6,
registry SHA-256 `ae573df9f2ad99307f34b8638ffe430b215670caecf6ad8bd669859918acfe5e`.
The descriptor uses its published factory/invoke/decorate_task bindings and
requires no new HTTP route, browser asset or registry modification.
