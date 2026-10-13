# Scientific workbench API

TokenJunkieLabs — maintained operator API, version 1.0.0.

The API operates the same retained workspaces, original files, scientific
settings, task queue, native processes, reports and exports as the workbench.
It does not run a separate simulation engine. Tim can use the ordinary graphical
workbench; this client is for repeatable automation and integrations.

## Connect to the running workbench

Open the package with its normal launcher. Keep the resulting startup JSON
private: its `operator_url` contains the local capability. Select that file with
`--connection`. Do not paste its URL or token into Slack, a repository, email,
API logs, example files or a shared command line. The client reads it directly.

```powershell
python operator/workbench_client.py --connection <private-startup.json> state
python operator/workbench_client.py --connection <private-startup.json> runtime
python operator/workbench_client.py --connection <private-startup.json> --out api-catalog.json catalog
```

`state` and task commands print readable summaries. `--json` selects complete
machine output; `--out` saves the full response separately. The normal application
continues to provide human-readable results. The client accepts only the original
local `http://127.0.0.1` operator; it never sends the capability to another host.
Use `--workspace <existing-key>` to select another workspace on that operator.

The running maintained API exposes:

| Method and route | What it does |
|---|---|
| `GET /api/workbench-api` | Discovers installed actions, routes, extension versions and workflow |
| `GET /api/workbench-api/openapi` | Returns OpenAPI 3.1 for the installed operator |
| `GET /api/state?workspace=...&compact=1` | Opens retained source, study, run and task catalogues |
| `POST /api/upload` | Streams the unchanged original file bytes |
| `POST /api/actions` | Accepts or reconciles one exact original operation |
| `GET /api/task?id=...` | Opens the original task, result, errors and file tickets |
| `POST /api/task/resume` | Explicitly resumes the same retained task |
| `POST /api/task/cancel` | Requests original task cancellation; inspect the returned state |
| `GET /api/item?workspace=...&kind=...&id=...` | Opens an original retained record and downloads |
| `GET /api/source-info?workspace=...&collection=...&source=...` | Opens original source metadata and samples |
| `GET /api/native-job?workspace=...&id=...` | Reads original native worker progress and logs |
| `GET /api/runtime?workspace=...` | Reads installed scientific package versions |
| `GET /api/file/<ticket-id>` | Downloads an authenticated retained file; supports original resumable transport |

The discovery catalogue includes current extension routes. The original
scientific modules validate their own action-specific payloads; OpenAPI does not
invent a universal scientific schema. Some installed desks require additional
selection fields described in their own package guides. All API routes require
the existing bearer capability or approved original team credential, and retain
the original person/workspace permissions. `202 Accepted` means queued or
reconciled, **not a finished calculation**.

## Retain a request before submitting it

Every operation uses a stable ID, original workspace and complete selection:

```json
{
  "workspace": "<existing-64-character-workspace-key>",
  "action": "client-source.inspect",
  "payload": {
    "title": "Tim original monitoring files",
    "uploads": [{"upload_id": "<retained-upload-id>", "options": {"header_row": 1, "formula_mode": "formulas"}}]
  },
  "operation_id": "<stable-original-operation-id>"
}
```

Use the client to save an immutable request with a UUID before any submission:

```powershell
python operator/workbench_client.py --connection <private-startup.json> freeze client-source.inspect --payload inspect-payload.json --request inspect-request.json
python operator/workbench_client.py --connection <private-startup.json> --out inspect-task.json submit inspect-request.json
python operator/workbench_client.py --connection <private-startup.json> wait <task-id> --seconds 60
```

If a connection closes after submission, keep the file and submit that **same
file** again. The original operator returns the accepted task, including an
active identical selection bound to a retained alias. A changed selection under
the same ID receives `409 OPERATION_REUSED`. A new selection gets a new frozen
request. `wait` only observes; expiry does not cancel or restart anything.
Failed, interrupted or cancelled tasks remain retained. Inspect their original
error and native state before explicitly using `resume <task-id>`.

## Original data to readable results

1. **Upload original files.** Use the unchanged XLSX, CSV, TSV, GIS layer or
   raster. The client streams the file and verifies the returned filename,
   byte count and SHA-256. It does not load a large file into memory or change
   its cells. Shapefiles need their original sidecars; upload each required file.

   ```powershell
   python operator/workbench_client.py --connection <private-startup.json> --out upload.json upload <original-file.xlsx>
   ```

2. **Inspect the originals.** Freeze `client-source.inspect` with
   `{"title":"...","uploads":[{"upload_id":"...","options":{...}}]}`.
   Reading options are `encoding` (`utf-8-sig`, `utf-16`, `cp1252`), optional
   `delimiter` (comma/tab/semicolon/pipe), 1-based `header_row`, and `formula_mode`
   (`formulas` or `cached`). The original parser retains original field IDs and
   sheet names; absent cached formula results do not become invented values.
   Open `/api/client-source/result` with the completed inspection task ID.

3. **Confirm meaning and mapping.** Freeze `client-source.commit` with
   `inspection_id`, `title` and `selections`. Each selected sheet/layer/band uses
   `file_index`, `part_index`, `role`, `title`, original `uri`, `vintage`, `units`,
   `period`, `timezone`, `reviewer`, `reference`, `notes`, `confirmed:true` and
   original field IDs for `identifier_field`/`label_field` where selected.
   `BIOPHYSICAL` tables additionally map native fields through `mapping` and
   select `models:["ndr","sdr"]` or the actual chosen subset. Read allowable
   roles, target units and required fields from `/api/client-source/catalog`.
   **Do not infer units, constituent fraction, period or scientific applicability
   from column labels.** Continuous raster conversions must retain their factor,
   original/target units and source reference. Original files and reviewed
   mapping remain downloadable companions. Context files remain explicitly
   context until reviewed for a scientific role.

4. **Prepare the study and native run.** Use the existing scientific desk to
   author the grid/profile/scenario selections, or freeze those same complete
   payloads through the client. `grid.prepare` selects a retained source
   collection, model domain, reporting area, required raster roles, CRS and
   resolution. `profile.save` and `scenario.save` retain the scientist's original
   model settings and scenario definition. `run.prepare` takes
   `grid_id`, `profile_id`, `scenario_id` and the selected `models`.
   `run.start` takes `{"run_id":"<prepared-run-id>"}`. The native runtime must
   be qualified for those actual models and sources. The original writer
   validates land-cover codes, physical units, model-specific inputs and table
   coverage. Missing inputs are not replaced by simulated Tim data.

5. **Read actual operation and model outcomes.** Read `/api/task` until its
   retained state is terminal, then open the original run through `/api/item`
   (`kind=runs`). Read `/api/native-job` with its task ID and retained run/
   execution binding for live progress. Completed example runs can be inspected
   directly; do not rerun them merely to show a passing status. Use the same
   original report/analysis desk or its discovered action to make the scientific
   report. `/api/deliveries/report` returns the original readable delivery report;
   `/api/source-reports/scientific-catalog` and scientific editions provide
   retained report figures/maps/data. Annual modeled export, measured
   concentration and inferred load remain distinct, with original units,
   support and provenance. Tim controls scientific interpretation.

6. **Download and reopen.** Use `download-task <completed-task-id> <directory>`
   to receive every original file ticket through the maintained restartable
   checksum-bound transport. Repeating the same download retains partial
   checkpoints and completed verified files; it does not repeat the scientific
   operation. Open the actual HTML/PDF/maps/CSV and normal archive contents.

7. **Transfer an editable study or full workspace.** Discover saved roots at
   `/api/study-transfer/catalog`, preview the original selection at
   `POST /api/study-transfer/preview` with `selection`, then freeze `study.export`
   using the **same selected roots and returned preview token**. A root is
   `{"kind":"<catalog-kind>","id":"<saved-study-id>"}`. For a complete
   workspace, use `workspace.backup` with `{"include_intermediates":true}`.
   Download the completed archive. Upload that archive unchanged and freeze
   `workspace.restore` with `{"upload_id":"<archive-upload-id>"}`.
   The completed restore returns `workspace_key`; select it and reopen the
   saved original sources/studies/reports. Restore preserves project identity
   while the receiving filesystem gets its own registered workspace key.

## Python integration

```python
from pathlib import Path
import sys
sys.path.insert(0, str(Path("operator").resolve()))
from workbench_client import WorkbenchClient

# Run from the extracted application directory. Keep the standard-library
# operator module intact; import this client from its explicit directory.
client = WorkbenchClient(Path("private-startup.json"))
upload = client.upload(Path("Original monitoring.xlsx"))
request = client.freeze(
    "client-source.inspect",
    {"title": "Original monitoring", "uploads": [{"upload_id": upload["id"]}]},
    Path("inspect-request.json"),
)
accepted = client.submit(request)
task = client.wait(accepted["id"], seconds=60)
if task["state"] == "complete":
    original = client.query("/api/client-source/result", id=task["id"])
    client.download_task(task["id"], Path("received-originals"))
# The user's explicit reviewed mapping comes next. No automatic scientific
# interpretation or native run is hidden in upload, inspect, wait or download.
```

Use `post <relative-api-route> --body <payload.json>` for discovered read-style
POST routes, and `get <relative-api-route> --query <query.json>` for GET fields.
All scientific writes go through the existing `/api/actions` frozen request
flow. These facilities require no new provider subscription or paid API.

## Delivery use and inspection

Open and operate the actual outgoing application and all recipient attachments
before calling a package ready. Inspect desktop and relevant narrow layouts,
critical buttons, populated/empty/error states, completed outputs, downloads,
normal report viewers and cold reopening. An HTTP success, source review,
OpenAPI file or passing check alone is not a usable workbench receipt. The API
course is additional to real graphical use, not a substitute for it. Preserve
the exact version, observed task/run IDs and precise unresolved runtime or data
gap. Focused internal validation only; keep delivering the actual product.
