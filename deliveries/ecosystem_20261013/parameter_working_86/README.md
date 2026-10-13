# Parameter working designs — complete installer source

This release contains all **86 exact source paths** consumed by the maintained Calibration installer at commit `bdf18bc7cf4375689d1a3746f32f6038e0b74efe`. It includes named Parameter working revisions, unfinished recovery, full history downloads, direct selected Study capture/reopen, Calibration history, same-DEM catchment integration, and the current shared terrain/climate Study runtime.

It installs into an **existing complete scientific application**. Its native Workspace, engine, extension host and original inputs remain required; this source cohort is not a replacement for that full application or an original scientific Workspace.

## Materialize the complete source

Download `source-bank.json.gz` and `materialize_source.py` from this pinned directory. A connector-only receiver can instead save the exact complete text blob `100e35b6cdc8292dc708dacf3f5caa0a6c15cc73` as `source-bank.base64.txt`; no direct native Git HTTP is needed.

Set these variables to the actual receiving paths:

```bash
export ECO_PYTHON=/path/to/the/qualified/python
export ECO_APP=/path/to/the/existing/complete/application
export ECO_WORKING_SOURCE=/path/to/a/new/parameter-working-source
export ECO_WORKING_BANK=/path/to/source-bank.json.gz
"$ECO_PYTHON" /path/to/materialize_source.py --bank "$ECO_WORKING_BANK" --output "$ECO_WORKING_SOURCE"
"$ECO_PYTHON" "$ECO_WORKING_SOURCE/operator/install_calibration.py" --application "$ECO_APP" --source "$ECO_WORKING_SOURCE" --preview
"$ECO_PYTHON" "$ECO_WORKING_SOURCE/operator/install_calibration.py" --application "$ECO_APP" --source "$ECO_WORKING_SOURCE"
```

The materializer verifies the entire carrier and every original source member before creating a new source directory. The installer inspects exact predecessors, rejects independent host edits and retains backups; shared registration composes against the host's actual maintained extension installer. Apply at that physical application's safe boundary. Preserve active jobs, original source, native Workspace identities and peer features. If a host has an independent later edit, reconcile that exact body instead of bypassing the guard.

The Base64 carrier is an alternate representation of the identical gzip. Its bytes are not source fragments and must not be trimmed or wrapped before verification.

## Operate and inspect the actual product

Read `operator/PARAMETER_WORKING.md` in the materialized source. Its original native course covers raw invalid fields, attributed revision save/reopen, complete history import, concurrent-branch conflict, original lost-response replay, ordinary scientific preview/prepare, selected Study cold receiving, and desktop/390px presentation plus actual downloaded files.

Raw drafts remain separate from accepted scientific selections. Earlier native inputs, saved histories, completed cases and held-out Calibration lineage remain preserved. No scientific run is started by source materialization or installation.

Original operation: Slack `1791913662.534029`; merged source handoff `1791916088.362199`. PR4744: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/4744

## Exact identities

- JSON: 1871333 bytes / SHA-256 `feb6a9e3ce918cef4426b0c8f669d706b70b5ac5bd94a438ca945b784515bb83`
- Gzip: 479504 bytes / SHA-256 `75708bbe75515b1417c3b18d07f72c2cb5b69d50a955a5bbdda280cb4bba40b0`
- Base64 UTF-8: 639340 bytes / SHA-256 `ea567b6dd6279c6d55851b82e5315ff85ff6904d7c70322ffa6ea7c7963e84b9`
- All 86 original path, length, SHA-256 and Git identities are retained in `manifest.json` and the complete bank.
- Full-source review, exact merged readback and meaningful authored-JS replay passed. Physical Python/browser execution of this new working-design course remains pending with the original receiving owner.
