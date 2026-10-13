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
continues to provide human-readable results. The default connection remains the original
local `http://127.0.0.1` operator. Its native capability is never sent to another
host. A separately issued remote connection can use the explicit trusted HTTPS
recipient boundary described below. Use `--workspace <existing-key>` to select
another permitted workspace on that same original operator.

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

Use `post <relative-api-route> --body <payload.json>` for discovered POST
routes, `put <relative-api-route> --body <payload.json>` for existing Measurements
PUT routes, and `get <relative-api-route> --query <query.json>` for GET fields.
Native scientific actions keep the existing `/api/actions` frozen request flow.
Measurements retains its own maintained preview/save/revision contracts, including
station mapping, record review and prepared intake PUT operations. Complete
Measurements document bodies are passed unchanged: injecting a workspace key
would corrupt a hash-bound study/portable receive. Those routes use the existing
mounted Measurements workspace; a client --workspace override does not retarget
that mounted database. Select the correct original operator connection for it.
Native API writes retain the original workspace field. This client
does not convert a PUT into POST or automatically retry a write. Both native
object errors and original Measurements text errors are returned without masking
them with a client parsing exception. These facilities require no new provider
subscription or paid API.

## Delivery use and inspection

Open and operate the actual outgoing application and all recipient attachments
before calling a package ready. Inspect desktop and relevant narrow layouts,
critical buttons, populated/empty/error states, completed outputs, downloads,
normal report viewers and cold reopening. An HTTP success, source review,
OpenAPI file or passing check alone is not a usable workbench receipt. The API
course is additional to real graphical use, not a substitute for it. Preserve
the exact version, observed task/run IDs and precise unresolved runtime or data
gap. Focused internal validation only; keep delivering the actual product.

## Explicit trusted HTTPS recipient connection

This is the same client, original API, retained download transport and task
queue. It does not create another backend, connector, scientific engine or job.
Use remote mode only after the existing edge/connector owner has deployed and
qualified the intended private recipient route. This source does not establish
that a remote origin is deployed or that its native/browser receiving passed.

E7A1's existing A/B protocol is the selected remote boundary: ordinary same-origin
requests use a separately issued recipient bearer, and large original bodies use
its staged 1 MiB raw-chunk request/input/seal/result protocol. This source implements ordinary requests, verified original downloads, and
file-based stage-upload/stage-json commands against the exact published browser
protocol. Actual edge/native duplicate and uncertain-result receiving remain to
be operated. Use staging for large bodies; do not send an archive above the edge
request limit through the ordinary upload command.

The remote boundary issues its own revocable, recipient-scoped credential.
The native operator capability remains only in the original private startup
file on the native host; the fixed native connector injects that capability
locally. Never paste it into a remote configuration. Connector credentials and
Cloudflare/provider credentials are also separate from recipient credentials.

The private recipient connection has this exact schema and no extra fields:

```json
{
  "schema": "upstate.workbench-remote-connection/v1",
  "origin": "https://workbench.example",
  "workspace_key": "<original-permitted-workspace-key>",
  "recipient_token": "<separately-issued-recipient-token>"
}
```

Keep this file private. Do not put it in source packets, reports, backups,
screenshots, logs or an email. The example is a placeholder, not a deployed
origin. The actual issuer must bind this credential to the intended recipient and
explicit authorization scope. The native capability can reach several projects;
client-side workspace selection is not an authorization boundary. Workspace-scoped
access requires the edge/connector to check action bodies and retained task/file
IDs as well as request headers. If the issued credential intentionally admits the
whole operator, describe that scope explicitly. This client does not infer or
grant authorization.

The caller must independently specify the exact expected canonical origin:

```powershell
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example state
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example --out api-catalog.json catalog
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example --out original-upload.json upload Original.csv
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example freeze client-source.inspect --payload inspect-payload.json --request inspect-request.json
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example --out inspect-task.json submit inspect-request.json
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example download-task <original-complete-task-id> received-originals
```

A canonical remote origin is lowercase ASCII DNS HTTPS with implicit port443,
no path, trailing slash, explicit port, user information, query or fragment.
The explicit trust argument must exactly match the private recipient file.
The legacy startup schema cannot be used for remote HTTPS, and a mixed file
containing operator_url or native capability fields is rejected. Normal Python
TLS certificate and hostname verification remain enabled. There is no insecure
TLS switch, redirect handling, proxy-environment route or arbitrary download URL.

JSON requests, raw uploads, individual retained downloads and full download
cohorts all use the same immutable transport. Remote requests carry only the
recipient bearer credential and the exact canonical Origin. The edge must
validate that credential, bind it to the fixed operator/workspace and preserve
the approved method/path. It must not forward an untrusted recipient
Authorization, Cookie or X-Forwarded header into the native service; only the
fixed native connector adds its private local capability after validating the
selected transport request. Server advertised-origin/Host/Origin/cookie policy
remains the original server owner's separate coordinated change.

### Original-byte transport and recovery

The relay must preserve original upload Content-Length, X-Workspace and
URL-encoded X-Upload-Filename, without rewriting file bodies. Downloads require
identity content encoding, exact status/Content-Length/ETag and, on resume,
exact Range/If-Range and Content-Range. The local receiver checks the complete
SHA256 before create-only publication and keeps its durable original partial
checkpoint. A redirect is rejected, never followed with a credential. Files
are identified only by the original relative /api/file/<64-hex-id> ticket.

Source archives can be hundreds of megabytes. Before advertising remote large
uploads/downloads, the edge and connector owners must operate that original
byte course through their actual streaming or bounded transport implementation.
A small JSON-body relay is not equivalent. Explicit capacity errors must remain
visible; this client never truncates, silently substitutes a source, or falls
back to a different endpoint or local capability. The local byte course remains
available unchanged. No remote large-file execution is claimed by this source.

Keep the complete frozen request before submission. A connection loss or relay
timeout does not reveal whether the original action was accepted. Inspect the
existing task or explicitly resubmit the same frozen operation_id and payload
to reconcile it. Neither the client nor the download receiver retries mutations
automatically. Download interruption resumes the same bytes, not the scientific
operation. Reacquire expired/stale tickets from the original task or item; never
follow an alternate-origin URL. Received-file checkpoints, COHORT/RECEIVING
records and source manifests contain no credentials.

### Source adoption and actual receiving

Compose the complete workbench_client.py and model/retained_download.py
postimages together over their exact retained preimages. Keep the original
provider, descriptor, queue, discovery and scientific modules. Unknown newer
source must be composed rather than replaced. The original local download and
receive_cohort positional signatures remain accepted; the optional transport
argument carries the exact remote selection without changing old callers.

The receiving peer uses the already qualified operator/runtime and existing
original projects. First prove unchanged local connection and download use,
then the explicitly issued remote recipient route. Open original state/runtime,
catalogue, one completed task and its real files, and finish the existing
own-file upload/inspect/reviewed-commit course with exact saved IDs. Exercise
cancel/recovery only on the original intended operation. Open the readable
report, use the complete retained export, and independently restore/cold-open
the original project. Preserve original scientific values and distinct project
identities. Do not rerun completed science merely to test transport.

Source hash/readback and independent review are distinct from actual TLS,
native API, file and graphical acceptance. Before calling the outgoing workbench
ready, its producing peer must actually open/run/render the exact version, LOOK
at desktop and390px screens or real screenshots, operate important controls,
and open every final HTML/PDF/map/CSV/archive/project attachment, including
extracted files and cold reopening. Check populated/empty/loading/error states
and repair clipped, cramped, unstyled or unreadable content. Capturing
screenshots or getting HTTP200 is insufficient. Keep the original same-course
receiving owner and no new watcher/controller. Current owner delivery direction
and original access/vendor policies remain in force.


## Observe an ordinary remote response without repeating the write

The edge can return HTTP202 while it is still waiting for native execution.
That response is marked X-Eco-Pending and contains a relay request ID; it is not
a native task receipt. The client now recognizes pending, uncertain and transport
error headers before native success classification. A native202 without a relay
pending marker remains the original native accepted response.

For ordinary remote JSON calls and uploads, the client chooses an explicit relay
ID before sending. A connection loss, incomplete response body or unverifiable
response reports that same ID instead of retrying the operation. Keep the ID
and the original frozen native request. Observe its existing result explicitly:

```powershell
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example --out original-native-response.json relay-result <original-relay-request-id>
```

This command only GETs the existing result. It requires the matching original
request marker and complete response SHA, and verifies the exact JSON bytes
before returning them. It does not turn uncertainty into a new request. A native
error remains its native error. The ordinary JSON result limit remains64MiB.

An ordinary call's in-memory relay ID is reported on a caught transport failure;
it is not a durable transfer journal if the client itself is killed. Use
stage-json or stage-upload below for durable identity before the first network
call, large files, complete-document admission and original upload-receipt
verification. Do not repeat an ordinary upload merely to obtain its missing
receipt; observe its same ID and compare the original filename/bytes/SHA. A
remote upload receipt/signature mismatch also preserves that ID, with the exact
received object available as the raised error's receipt attribute. The
existing local loopback route remains unchanged.

## Staged original files and complete JSON documents

The maintained model/staged_transport.py uses E7A1's published A/B protocol:
Worker 1d7ebb139ce98d539e010f666b5d31097ddf8eeb (PR4914) and the native connector
in F0C92DWQHK3. It adds no service or scientific queue. The actual edge source
binds immutable request metadata, acknowledges only identical duplicate chunks,
and retains duplicate seals. The connector journals execution and original
responses. These source contracts are reviewed separately from deployment and
the original qualified native receiving course.

Use a separate durable journal and result file for each intended original
operation. Keep both with the complete original input. The private recipient
connection stays separate. No credential is saved in the journal or result.

```powershell
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example stage-upload Original-study.zip --journal transfer-study.json --result uploaded-study.json --seconds 60
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example stage-json POST /api/measurement-workspace/flow/receive complete-original-flow-study.json --journal receive-flow.json --result received-flow.json --seconds 60
python operator/workbench_client.py --connection recipient-private.json --trusted-origin https://workbench.example stage-json PUT /api/measurement-workspace/intake/<original-id> complete-working-intake.json --journal save-intake.json --result saved-intake.json --seconds 60
```

Staged JSON is the exact supplied file, without parsing, canonicalizing or
adding fields. Native actions must therefore use the original frozen request
file, including its workspace and operation_id. Complete Measurements documents
retain their original schema and all original source strings. A malformed JSON
file is returned as its native validation error, not silently repaired. The
native endpoint's own limits still apply: base action JSON remains4MiB, while
the mounted Measurements wrapper has its existing128MiB process limit. Staging
bypasses the edge request-body ceiling; it does not bypass native admission.

Before the first network call, the receiver creates an immutable plan containing
the canonical origin, original workspace, native method/path/content headers,
full body bytes/SHA256, result path and one random stable request ID. It opens
regular source files without following a final symlink, hashes incrementally,
and rechecks identity while transmitting. Source bytes are read in1MiB blocks.
Each chunk acknowledgement must match request ID, offset, byte count and SHA256.
A changed source is never sealed. New journals include the full body_sha256 in
both first request metadata and the seal; these are the actual optional A/B
fields checked against the connector's complete spool. Older journals without
that wire field retain their exact original metadata and seal rather than
changing identity under an existing request ID. Their full source SHA remains
bound locally and each original chunk is still verified. For /api/upload the
native response must additionally match full source SHA/bytes and filename
before publication.

Every explicit reentry must use the same journal, source bytes, endpoint and
result path. If input staging was interrupted, the command repeats only the same
metadata/chunks under the same request ID, relying on the original connector's
verified duplicate acknowledgements. After a successful seal, or after an
uncertain response, later invocations only observe /result. No fresh request ID
or second native mutation is created. A lost seal acknowledgement may require
the same exact seal to be reconciled; the native journal owns that decision.
No failed control operation is automatically retried in this client.

A bounded wait may finish with a pending or uncertain error and the retained
transfer ID. This is not a failed scientific operation. Keep the journal and
inspect the original operator task/operation. Never delete the journal merely
to obtain a new request ID. An uncertain request can be observed again after
the original native owner reconciles it; it is never restaged by this client.
Authorization failures without the exact original request marker remain pending,
allowing explicit credential repair without saving an edge denial as the final
native result. A native401/403 carrying the matching retained request marker is
preserved as its original completed error response when the relay also supplies
the original body hash. A relay failure lacking native result identity/hash
remains an explicit receiving error and cannot become a completed native file.

The result body is streamed into an owned temporary file, flushed, and published
create-only. It requires identity encoding, the matching original request ID,
exact Content-Length and a valid X-Eco-Body-SHA256. The complete streamed hash
must equal that declared native response hash before publication. Generic
chunked HTTP is rejected. The current edge uses FixedLengthStream for retained
bodies; merely setting an ignored Content-Length header would be insufficient. Existing
same-byte result files can be recovered; divergent files are not overwritten.
A complete sidecar records native status, safe original response headers, full
body SHA/bytes and the exact request binding. Reopening a completed result
verifies its bytes without another network call. Non-2xx native outcomes remain
complete original error files and yield a nonzero CLI exit. Headers carrying
cookies, native credentials or relay secrets are never retained.

The ordinary download-task command continues to use original native file tickets,
ETag/range/If-Range and full SHA verification, with restartable partial download
checkpoints. Staged result receiving is a separate record of a request's original
response; it does not invent a retained native file ticket or alter model outputs.

### Same original native receiving course

Admit the new model/staged_transport.py together with the complete client and
retained_download postimages through the existing whole-app installer. Preserve
all current provider/descriptor/server/private origins and source predecessors.
The source packet explicitly admits its full retained original, direct API3 and
published staged predecessors, so an already-installed intermediate edition can
advance without removing its source checks.
The actual equipped peer must compile/import these maintained modules, open
unchanged local state/catalogue/files, and then operate the issued HTTPS route.
Use the existing intended input file and exact original operations: perform
an interrupted1MiB upload/reentry, verify its original upload receipt, transfer
a full saved Measurements document without added fields, observe the same
pending request, read original error results and reopen completed files.
Never manufacture an extra science run or cancel another operation for testing.

The source review does not establish relay deduplication, TLS deployment,
Windows filesystem execution or actual visual acceptance. Keep the exact
original desktop390px/all-attachments/open-and-LOOK rule above, including
normal archive extraction and independent project reopening.
