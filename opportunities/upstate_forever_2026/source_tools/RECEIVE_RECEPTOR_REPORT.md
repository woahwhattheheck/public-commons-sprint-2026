# Receive a saved source-water scientific report

Use `source_tools.receive_receptor_report` to carry one existing watershed
network or prepared-area product through the application's original scientific
report workflow. The command prepares or reopens its immutable report source,
runs the original queued renderer, downloads the complete report, makes a full
Workspace backup, and independently restores both the full project and its
editable selected Study. It then checks the original source-water products in
both restored Workspaces.

Run this command from the actual complete application with its installed Python
environment. Use the actual existing Workspace path and a separate owned output
directory. The original project, network and prepared-area IDs stay unchanged.

## Complete native course

For an existing prepared-area product:

```sh
python -B -m source_tools.receive_receptor_report \
  --workspace ACTUAL_WORKSPACE \
  --prepared ACTUAL_PREPARED_AREA_ID \
  --expected-project ACTUAL_PROJECT_ID \
  --output ACTUAL_OUTPUT/source-water-report
```

For a saved network without a prepared-area selection, replace `--prepared`
with `--network ACTUAL_NETWORK_ID`. The command accepts exactly one of those
selectors or `--report-id ACTUAL_SAVED_SOURCE_REPORT_ID`.

The default source edition contains the original topology, source geometry,
membership tables and published areas. Creating this source uses the standard
library. The subsequent scientific report course uses the installed maintained
renderer and complete operator application. It does not run the watershed graph,
prepare new intervention polygons or execute a pollutant model.

To prepare a distinct source edition with the original projected maps, explicitly
add `--include-maps` and choose a separate output directory:

```sh
python -B -m source_tools.receive_receptor_report \
  --workspace ACTUAL_WORKSPACE \
  --prepared ACTUAL_PREPARED_AREA_ID \
  --include-maps \
  --expected-project ACTUAL_PROJECT_ID \
  --output ACTUAL_OUTPUT/source-water-mapped-report
```

This edition uses the receiving host's actual GIS and ReportLab environment.
The source identity retains that runtime and the exact producer, reader and
renderer source. Map captions distinguish projected grid scale from ground
distance; quantitative areas remain the publisher's original AreaSqKm values.

An already retained source, including a mapped edition received from another
host, reopens by exact ID:

```sh
python -B -m source_tools.receive_receptor_report \
  --workspace ACTUAL_WORKSPACE \
  --report-id ACTUAL_SAVED_SOURCE_REPORT_ID \
  --output ACTUAL_OUTPUT/retained-source-report
```

A retained source already owns its title and map selection; do not combine
`--report-id` with `--title` or `--include-maps`. Opening that source verifies
its original files and bindings without rendering new watershed maps. The
scientific publisher retains its own current saved preview and queued operation.

## Continue the same operation

Repeat the same invocation and add `--resume`:

```sh
python -B -m source_tools.receive_receptor_report \
  --workspace ACTUAL_WORKSPACE \
  --prepared ACTUAL_PREPARED_AREA_ID \
  --expected-project ACTUAL_PROJECT_ID \
  --output ACTUAL_OUTPUT/source-water-report \
  --resume
```

The receiver binds the original project, Workspace, source selection and
selected-Study mode. It writes the source identity before building. After that
source is complete, retries reopen it even if the installed rendering libraries
have changed. An incomplete mapped source still requires its frozen runtime;
a deliberately changed edition needs a new output directory.

The scientific subcourse keeps its original preview, task IDs, export selection,
downloads and independently restored paths under `scientific/`. Completed tasks
reopen through the maintained receiver. Interrupted or failed tasks use its
existing resume path. A wrapper exception leaves both the source checkpoint and
the queued scientific operation intact.

The source capture/build and its immutable source snapshot hold the normal
Workspace lock. That prevents an ordinary concurrent backup from capturing a
partial report source. The wrapper releases this lock before entering the
scientific queue, whose own backup operation acquires the same Workspace lock.

The receiving output must be outside the application and original Workspace,
with neither tree nested inside the other. This keeps repeated backup archives
out of the source project. A nonblocking output lock prevents concurrent owners
from advancing the same receiving directory.

## What successful receiving verifies

The final `source-water-report-receiving.json` records:

- Original project, source report, network and optional prepared-area IDs.
- Exact source choice and complete source identity, original source binding,
  original result-file hashes, per-area HUC12 counts and prepared collection ID.
- Scientific edition, retained queue tasks and original PDF, HTML, Markdown,
  data and complete report ZIP downloads.
- Full Workspace archive and independently reopened Workspace.
- Editable selected Study archive, its independent reopened Workspace and
  exact source-water lineage receipt.

The command calls the ordinary source and prepared-area inspectors in both
restored Workspaces. They verify their retained members and source collections.
The original result-file hashes and full source snapshot must remain identical.

The selected Study additionally calls
`model.receptor_study_transfer.verify_received`, which first verifies the
normal Study receipt. The matching lineage row must identify the original
source choice, source report, network and preparation as editable same-project
products. The six-root transfer family preserves original source collection
references, profile selections and complete map companions.

Earlier archives that contain a complete report source but omit native producer
roots retain their source-only reading behavior. They are useful historical
archives; this complete editable receiving course requires an archive with the
new typed native lineage. Re-export that saved report through the current
selected Study workflow into a distinct operation if needed.

## Reading progress and failures

The output directory retains:

| File | Purpose |
| --- | --- |
| source-water-selection.json | Original immutable receiving request |
| source-plan.json | Frozen source identity and normalized selection |
| source-products.json | Verified original product snapshot |
| scientific-selection.json | Exact source selector and title for the original renderer |
| progress.json | Current wrapper phase |
| scientific/receiving-progress.json | Original queue phase and retained task IDs |
| scientific/scientific-report-receiving.json | Original scientific receiving result |
| selected-source-water-receiving.json | Typed editable native product verification |
| source-water-report-receiving.json | Completed combined course |
| exception.json | Latest failed phase and original exception |

An error returns a nonzero exit and retains the original exception. If the disk
cannot accept a failure record, the command preserves the primary runtime
exception and reports the recording error on stderr when possible. It removes
an earlier exception record only after the complete requested course succeeds.

Use `--timeout SECONDS` for the existing task wait and
`--upload-limit-gib N` for actual upload capacity from 1 to 64 GiB. A timeout
does not create a replacement task. Resume the same directory.

## Optional actual browser continuation

Pass `--browser-node ACTUAL_NODE` to run the maintained scientific report
browser receiver after the native course; `--video` additionally requests its
recording. The interpreter path is resolved from the caller's invocation before
the receiver loads its application paths. Inspect the actual report and source
views at the existing host's desktop and narrow layouts, and retain its normal
browser outputs with the same operation.

## Full-project course and installation

The default course includes editable selected Study receiving. If the current
operated application intentionally needs only the full-project course, use
`--full-project-only` with its own output directory. Its source and independent
full-Workspace checks remain complete. The selected-Study mode is immutable
within an operation; use a separate output to request the additional course.

Install the current complete application, including the Source-water producer,
six-root `model/receptor_study_transfer.py` with `verify_received`, original
scientific receiver `source/observed-report-20261013/receive_operator.py`,
scientific report extension and ordinary Study transfer extension. The
Source-water component fragment retains this driver and guide plus the original
receiver/browser scripts. Preserve newer shared renderer, operator and archive
implementations when applying a component source update.
