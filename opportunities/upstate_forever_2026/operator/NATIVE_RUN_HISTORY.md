# Original native execution history

The Native run desk can retain the complete recorded execution history of its checked, prepared runs. This reads saved run records and writes an independent handover. It uses the same native task queue, task recovery and authenticated downloads as the existing run and process-report controls.

## Operator workflow

1. Open **Native run desk** in the original scientific workspace. Select the working grid, parameter profiles and scenarios, then check the prepared runs whose history you want to retain. The current process-report controls and selected model scopes continue to work.
2. Under **Retain actual execution history**, name the handover and choose **Review selected history**. The preview reads the full original native records, including prior attempts and transferred-stage lineage.
3. Review attempt intervals, recorded coverage and each stage's origin. A receiving run can contain the original calculation time of a donor stage; its local transfer time is displayed separately.
4. Choose **Save history and handover**. The task freezes the reviewed run and input records. If a native run changes between preview and task admission, review its new history before saving. A saved snapshot already published by that original task remains reopenable even when native work later advances.
5. Open the completed task or the history in **Saved execution histories**. Download the readable HTML, complete ZIP, original JSON, and run/attempt/stage CSV files. Extract the ZIP and open `index.html` to read it offline.
6. A normal scientific Workspace backup carries the history directory and its original snapshots. Restore the Workspace, reopen the Native run desk and select the saved history. Reading a saved history uses those snapshots and does not require re-executing or resolving its old run state.

The task payload binds the exact ordered run IDs, title and preview identity. The current native queue's accepted original task remains the recovery point. The desk retains that task before refreshing the catalogue, so a catalogue read failure does not lose a completed handover.

## Meaning of the times

- **Original native calculation interval:** the stage's retained `started_at` and `completed_at`. This includes the producer's recorded native execution and registry-retention boundary; it is not a CPU-only benchmark.
- **Local native-stage interval:** the original interval for a stage calculated for this selected run. Inherited donor intervals are excluded.
- **Reuse transfer interval:** the receiving stage's `reuse_started_at` through `reused_at`. Original donor IDs, input signatures and multi-hop reuse lineage remain available.
- **Attempt interval:** the native producer's actual attempt start and completed/failed end. It includes validation, waiting, transfer, calculation and export.
- **Recorded interval union:** overlap is counted once. It describes the coverage of the available closed wall-clock intervals.
- **Recorded span:** the earliest available start through the latest available end, including gaps. It is shown separately from both interval union and interval sum.

Missing, invalid, timezone-free and reversed timestamps remain unavailable. An interrupted attempt's `recovered_at` or `updated_at` is not treated as a known stop. Coverage counts accompany every aggregate; a record with missing timing does not become a zero-duration run. Clock observations from different hosts depend on their original clock synchronization; full attempt host and resource records are retained.

The original project, grid dimensions/bounds/CRS, parameter profile, scenario and native runtime remain in the source records. The history preserves the original dataset's scope. A simulated rectangular demonstration remains a simulated demonstration, while a regional run retains its real geographic bindings.

This handover describes execution. Physical N/P and sediment output descriptors retain their exact original units; the feature does not derive concentrations, rerun native models, or infer intake delivery from stream export.

## Complete portable contents

| Member | Content |
|---|---|
| `index.html` | Readable offline interval, run, attempt and stage report |
| `history.json` | Structured report, full stage/attempt originals and interpretation |
| `runs.csv` | Ordered selected runs, scenario/profile/model bindings and coverage |
| `attempts.csv` | Every retained attempt and its observed interval status |
| `stages.csv` | Local/inherited calculation bounds, transfer duration and donor |
| `originals.json` | Complete frozen project, original runs and selected input records |
| `originals/{runs,grids,profiles,scenarios}/*.json` | Independently readable exact original record snapshots |
| `identity.json` | Ordered selection and canonical SHA-256 bindings |
| `MANIFEST.json` | Exact member paths, byte lengths and SHA-256 digests |
| `history.zip` | Complete original snapshot and readable handover |

JSON preserves original values. CSV text that starts with a spreadsheet formula character is prefixed with an apostrophe. Native numeric timing fields remain numeric; unknown values are blank in CSV and explicit in JSON.

## Native integration

The model is `model/native_run_history.py`. Its public methods are:

- `preview(workspace, {'run_ids': [...], 'title': ...})`
- `build(workspace, selection, expected_preview_id)`
- `catalog(workspace)`
- `inspect(workspace, saved_history_id)`

Original source loading uses `Workspace.inspect_run`, `get_grid` and the content-addressed profile/scenario records. Inventory and preview read metadata records; they do not hash or copy large native raster bodies. Saved history inspection verifies the frozen originals, derived summary, complete file inventory and ZIP members.

The registered action is `run.history.save` with payload `{selection, expected_preview_id}`. Read routes are:

- `GET /api/native-run-history/catalog?workspace=...`
- `POST /api/native-run-history/preview` with `{workspace, selection}`
- `GET /api/native-run-history/report?workspace=...&id=...`

The item kind is `native-run-histories`. The ordinary extension restore hook verifies saved histories within the actual receiving Workspace. Original solver, run locks, native execution and stage-reuse producers remain the owners of their records.

## Maintained application assembly

Use the normal assembler's component-fragment discovery with `integration/component_fragments/native-run-history.json`. The family requires `core`, `native-run-desk` and `guided-journey` because its immediate current-stage view reuses the existing Journey `nativeTiming` reader. The fragment carries the complete native model/provider/descriptor, browser helper, current run desk and this guide. It adds no separate installer or execution queue.

For a native receiving course, choose actual retained run IDs from the receiving application's catalogue. Preserve the real project and dataset scope; do not substitute newly constructed inputs for a completed producer's records. Save through the existing action, open every download, extract and view the offline HTML at desktop and narrow widths, then restore a normal Workspace backup and reopen the same saved history. A source-record fixture exercises interval/recovery logic but does not constitute a native scientific run or a viewed product.

## Current owner direction and actual receiving

This feature follows [CURRENT_OWNER_DIRECTION.md](../CURRENT_OWNER_DIRECTION.md), version **2026-10-13.3**. The complete direction travels in the maintained component closure and must accompany the actual receiving work order. The prepared native simulated case is the immediate priority; this history reads its original records without interrupting, restarting or replacing active scientific work. Preserve the October 13, 2026 **14:00 UTC** cutoff.

For the actual RFP case, keep the 30 m upstream model domain, South Carolina reporting mask and four original utility focus anchors distinct. Preserve baseline, editable realistic riparian alternative and matched control, their actual source editions/assumptions/parameters, matched support and annual N/P kg/year and sediment tonnes/year reaching streams. A rectangular simulated demonstration retains that explicit scope. Use the history to explain observed execution speed together with actual commit/package records; do not infer missing timings or customer acceptance.

The recipient is an experienced GIS, hydrology and modeling practice. Present inspectable production offload under its scientific direction: useful actual outputs, editable GIS and a complete cold-reopenable application/project. Open, LOOK at and operate the exact desktop/narrow application and every outgoing HTML/CSV/JSON/archive/project attachment, including the downloaded and restored copies. Correct unreadable or broken material in that same course. If a video is produced, use the actual working application, available natural generative TTS, and watch and listen to the finished export. Carry the complete referenced direction onward; preserve source/copyright, lab attribution, contact/incident and existing compute/ownership controls. Add no new approval gate, broad test sweep, private GitHub/Actions use or llama.cpp workload.
