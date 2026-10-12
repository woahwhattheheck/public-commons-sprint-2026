# Receive Research documents in the Analysis workspace

The **Research** tab in the existing Analysis application receives a saved
document purchase, a retained managed Pipelines output, or an existing dossier
edition. The operator reviews the original edition, captures its full source
closure, and continues through the same response mapping, immutable import,
SQL, full query exports, workbooks and portable workspace.

The implementation reuses the [Research Python client](RESEARCH_DOCUMENTS.md),
its [original source producer](research-document-source.mjs), the existing
[response source registration](stellar_forge_buyer/response_documents.py),
[Analysis jobs](stellar_forge_buyer/analysis_workspace.py), and
[workspace archives](stellar_forge_buyer/workspace_archive.py). Original native
payment fields, provider job/file/node identities and capture completeness stay
attached to the source.

## Start the original local application

Use the buyer Python package and full Node source from the same maintained
release. Install the existing workbook extra when producing XLSX files; its
original dependency is openpyxl 3.1.5. Start the Research application through its
normal launcher and retain its private connection file.

First read that workspace with the original Python client or Research SDK. Copy
the actual returned `research_<64-hex-digest>` workspace ID into a local
connection registry:

```json
{
  "schema": "stellar-forge.analysis-research-connections.v1",
  "connections": [
    {
      "name": "CustomerResearch",
      "label": "Customer document research",
      "connection_file": "/private/research/connection.json",
      "expected_workspace_id": "research_REPLACE_WITH_THE_ACTUAL_64_HEX_DIGEST",
      "request_timeout_ms": 120000
    }
  ]
}
```

Replace the placeholder with the original returned identity. The registry
contains absolute paths to existing private connection files; it contains no
new bearer credential. Keep these files private. The registry accepts at most
64 distinct aliases. Labels are at most 160 characters. Each request deadline
is an explicit 1,000–900,000 milliseconds, with 120,000 as the default.

```bash
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /work/installed-merchant-source \
  --research-connections /private/research-connections.json \
  serve --port 0 --open
```

The original server binds to numeric IPv4 loopback and writes its original
private launch capability. The browser and native Analysis agent use the same
capability, same-origin checks and API. Browser requests select a connection
alias; they cannot supply a URL, token, local document path or runtime path.

The operator can rotate the original connection file for a restarted service
that opens the same Research workspace. A different Research workspace needs
its own reviewed registry entry. The actual workspace ID is checked on every
native client operation.

Starting Analysis without `--research-connections` keeps its previously
captured sources and results available. Restored source documents and existing
analytical results use their original local source closure.

## Browser workflow

1. Open **Research**, choose a named connection, and select **Read dossiers**.
   The application follows the original dossier inventory snapshot and cursor.
   **More dossiers** keeps that snapshot. A changed inventory asks for a fresh
   list rather than silently joining pages from different inventories.
2. Choose the original dossier and either **Documents** or **Managed Pipelines
   outputs**. **Read saved sources** shows actual saved purchases, existing
   editions and retained outputs. A provider operation with no retained output
   shows its current original state. Each output preserves its actual file and
   optional node ID.
3. Select one source and choose **Review selected edition**. Review the complete
   edition digest and its original source/provider/payment/delivery fields.
   Element browsing is paged. Text and record display excerpts are labeled;
   capture retains the whole verified edition.
4. Choose an Analysis source name and title. The source name uses the existing
   Analysis identifier grammar: a letter followed by at most 63 letters,
   digits, underscores or hyphens. The title has at most 160 characters and no
   control characters. The application shows the current source revision and
   retains the full ISO capture timestamp.
5. Select **Capture reviewed edition**. Before the POST, the browser retains the
   exact 32-hex request ID, selected Research identity, source selection, edition
   digest, source revision, title and timestamp. The original Analysis job is
   then saved before its background work starts.
6. The saved capture reports the original source-document ID, row count,
   original file count, verified bytes and completeness. Choose **Open source in
   response mapping** to load the source producer's full 18-column mapping into
   the original **API responses** pane.
7. Review or adjust the explicit column types, run **Preview all mapped
   records**, inspect the complete projection and its scope, then **Import
   reviewed projection**. Import creates an immutable original dataset version.
   Select that version for a SQL view in **Data**.
8. Use the existing **Analysis**, **Exports**, **Workbooks** and **Backups**
   controls. A query preview can have a row/byte limit; **Export every query
   row** uses the original full query-export operation. A workbook can consume
   that typed export. A complete workspace backup includes every registered
   original document revision, saved source mapping, imported tables, query and
   workbook history, and selected original output files.

A source alias that has since advanced to another revision remains visible in
capture history. Its previous capture and imported data stay retained. The
mapping handoff checks the exact current source revision before changing the
working response selection.

### Interruption and cancellation

**Reopen this exact capture** first reads the original Analysis job ID. If the
first POST was accepted, it joins that job. A completed job reopens its saved
source and receipt. An interrupted, failed or locally cancelled capture can
explicitly continue through the original start API with the unchanged request.

A completed native pre-admission rejection plus an absent original job is
shown as `NOT_STARTED`. The operator can keep that request in the browser for
inspection or begin a new review with the current source revision. A lost HTTP
reply retains the same request until its original job is reconciled.

**Cancel this local capture** cancels the client and local capture activity.
The original Research application continues to own its purchases and provider
jobs. If source registration already completed, that authoritative source is
retained and is found by the same capture on reopen.

Capture recovery looks for the matching original registered source **before**
opening a Research connection. This also recovers a capture whose source
registration completed just before its Analysis result reply was lost. A
portable restore includes that source and the original job request, so it can
finish the same registration recovery with the provider offline.

The original workspace close cancels active local Research calls, waits for
their cleanup and result publication, then drains its existing Analysis executor.
A source staging copy is removed after verified original registration; its
complete retained source remains under the existing source-document owner.

## Programmatic and command-line use

`AnalysisWorkspace(..., research_connections=...)` accepts either the private
registry file path or the same registry object. Public connection summaries
expose only name, label and expected workspace ID.

```python
from contextlib import closing
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace

with closing(AnalysisWorkspace(
    "/private/customer/analysis",
    checkout="/work/installed-merchant-source",
    research_connections="/private/research-connections.json",
)) as analysis:
    configured = analysis.research.configuration()
    selected = configured["connections"][0]
    base = {
        "connection": selected["name"],
        "expected_workspace_id": selected["workspace_id"],
    }
    page = analysis.research.read("dossiers", {**base, "offset": 0, "limit": 20})
    print(page)
    # Use result.next unchanged for another inventory page.
```

The four read actions are `dossiers`, `sources`, `review` and `elements`.
Their response envelope preserves `connection`, `workspace_id`, and where
applicable `dossier_id`/`family`, with the native result under `result`.

A capture request uses these exact fields:

| Field | Meaning |
| --- | --- |
| `id` | Original Analysis request ID: 32 lowercase hex characters, retained before calling |
| `connection` | Launcher-selected alias |
| `expected_workspace_id` | Actual original `research_<64 hex>` identity |
| `dossier_id` | Returned `d_<UUID>`, unchanged |
| `family` | `documents` or `pipelines` |
| `selection` | One original selection object below |
| `expected_edition_sha256` | Digest returned by the original review |
| `name` | Original Analysis source alias |
| `expected_revision` | Reviewed source registration revision, or zero for a new alias |
| `title` | Source title, 1–160 characters without control characters |
| `captured_at` | Full ISO timestamp with timezone, retained unchanged on resume |

Selections:

```json
{"purchaseId": "u_<64 hex>"}
{"editionId": "e_<64 hex>"}
{"operationId": "up_<64 hex>", "outputId": "out_<64 hex>"}
```

Use returned values rather than the placeholders. Documents accepts purchase
or edition; Pipelines accepts operation/output or edition. Provider job/file/
node IDs are retained in the actual review and source receipt and are never
regenerated from row order.

```python
job = analysis.start("research-capture", exact_capture_request)
job = analysis.job(exact_capture_request["id"])

# After an interruption, repeat the unchanged original request:
job = analysis.start("research-capture", exact_capture_request)

# Cancel the current local capture and read its original job:
job = analysis.research.cancel(exact_capture_request["id"])
```

The existing CLI can read or run the same requests from private JSON files:

```bash
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /work/installed-merchant-source \
  --research-connections /private/research-connections.json \
  research-read --action review --request /private/review-selection.json

python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /work/installed-merchant-source \
  --research-connections /private/research-connections.json \
  research-capture --request /private/exact-capture.json
```

Use these local CLI commands while that Analysis workspace is closed, as the
original owner lock permits one workspace process. The running browser and
native MCP agent use its existing HTTP service.

## Native Analysis agent and HTTP joins

The native agent's Research operations select one of the host-registered
Analysis workspace aliases. They use the same application API and original
jobs, with the same source and edition review fields.

| Method and path | Original operation |
| --- | --- |
| GET `/api/research-connections` | Safe launcher-selected connection aliases |
| POST `/api/research-dossiers` | Original paged dossier inventory; preserve `snapshot` with nonzero offset |
| POST `/api/research-sources` | Saved document selections or retained managed outputs |
| POST `/api/research-review` | Original selected edition review |
| POST `/api/research-elements` | Original element page and reviewed edition guard |
| POST `/api/start/research-capture` | Existing Analysis job admission and same-ID resume |
| GET `/api/jobs/:id` | Existing durable job, result and local progress |
| GET `/api/research-captures` | Paged original capture history, using `before` sequence |
| POST `/api/research-captures/:id/cancel` | Cancel this local capture; body is `{}` |

The existing native response-source/preview/import, query-export, workbook and
workspace-archive operations continue from the capture's returned source
revision and default mapping. Full source payloads use the existing original
file-reader/export paths.

## Source completeness and limits

The source producer verifies the complete edition with the original Documents
or Pipelines verifier before publishing an Analysis source. It retains one row
per original element occurrence. Repeated provider element IDs remain separate.
Full text, metadata JSON, provider record JSON, citation JSON, original
operation/document/output digests and the edition digest are separate columns.

Workbook-safe preview fields preserve the first 2,000 Unicode characters as an
ASCII JSON string, its completeness flag, and the full character count. Full
text stays in the source and typed query export. The original producer limits
remain 64 MiB for an edition, 256 MiB for the complete source closure, 32 MiB
per retained part, at most 32 original roles/parts, and one million occurrences.
Its original row limit also applies.

The capture result returns the complete original producer receipt and native
source verification. A matching source registration reopens before revision
CAS, following the original response-registration semantics. A different
source revision requires a new explicit selection; the existing histories and
source files are preserved.


## Complete original receiving continuation

The maintained receiver can continue the **same returned Research source**
through the actual browser and complete original Analysis chain. Use its existing
Linux/Node/Playwright/Chromium environment and the full installed buyer Python
source, including the existing workbook extra. Keep the operating directory,
native requests and returned outputs private.

Prepare a safe selection file from the actual original inventory and review:

```json
{
  "connection": "CustomerResearch",
  "expected_workspace_id": "research_REPLACE_WITH_ACTUAL_64_HEX_DIGEST",
  "dossier_id": "d_REPLACE_WITH_ACTUAL_UUID",
  "family": "pipelines",
  "selection": {
    "operationId": "up_REPLACE_WITH_ACTUAL_64_HEX_DIGEST",
    "outputId": "out_REPLACE_WITH_ACTUAL_64_HEX_DIGEST"
  },
  "expected_edition_sha256": "REPLACE_WITH_THE_REVIEWED_EDITION_DIGEST",
  "name": "document_elements",
  "title": "Retained document elements"
}
```

An existing edition selection is `{"editionId":"e_<actual digest>"}`;
a Documents purchase selection is `{"purchaseId":"u_<actual digest>"}`.
The receiving example uses the original `document_elements` source/view
name from the maintained workbook example. It checks these exact values before
creating the receiving operation. The ordinary browser supports any valid
Analysis source name.

```bash
python3 /installed/python/examples/research_intake_workbook.py \
  --directory /private/customer/research-analysis-receiving \
  --checkout /installed/complete-merchant-source \
  --research-connections /private/research-connections.json \
  --node /actual/node \
  --playwright /actual/playwright/index.mjs \
  --chromium /actual/chrome-headless-shell \
  --temporary-root /dev \
  receive --selection /private/reviewed-research-selection.json
```

The original host/controller chooses the actual runtime paths and resource
declaration. `--temporary-root` selects an existing filesystem for this
one process's browser/temp files; the default is `/dev` on Linux. Source
state, requests, complete exports and receiving receipts stay in
`--directory`. This command receives a saved selection; it does not launch
a managed provider job.

The joined operation:

1. Starts the original Analysis host with the reviewed named connection and
   opens its actual Research tab. It follows original inventory pages and
   selects the radio value containing the exact purchase/edition/output identity.
2. Retains the capture request before forwarding it to the original host,
   discards one **actual accepted capture reply**, then joins that same native
   job. The helper records the observed reply and interruption separately.
3. Reopens that original capture, loads the full 18-column source mapping through
   the actual response pane, previews every retained occurrence and imports the
   reviewed complete source through its native controls.
4. Reuses the unchanged `research_document_workbook.Workflow` for the
   original saved SQL, full query export in JSONL/CSV/SQLite, typed XLSX workbook,
   complete source handoff and whole workspace archive. The preview/import IDs
   are the actual browser requests; subsequent native IDs are retained before use.
5. Closes the source host, restores the same archive through the original
   receiver, and reopens the captured source/mapping in a browser with **no
   Research connection and no Node checkout**. The existing original receiver
   checks query results, original document files, typed rows and workbook bytes.
6. Retains desktop, 390-pixel mobile and restored-browser views with their actual
   filenames, sizes and hashes.

Repeat the identical command with the same selection and directory to continue
its retained operation. The helper reuses the existing native job IDs and saved
receipts. Completed browser phases also verify and reuse their original
screenshot bytes and source/workspace bindings; another identical receiving
command does not replace those accepted views. If a preview/import request was
retained before process loss but the
original host proves that ID absent, it repeats that exact request through the
original API. If the original workspace marked a running preview/import
`INTERRUPTED` after process loss, Activity offers **Continue original response
action**. The example uses that same control and retained request. The native
continuation verifies the original historical source revision and preview SHA;
a previously committed import reopens its manifest-derived immutable version.
Completed jobs and provider operations are never re-created. A native failed
preview/import remains available for inspection.

The receiving exercise selects complete-source imports only. An incomplete
source asks for the ordinary operator's explicit scope decision in the existing
response pane; it is not silently accepted by this example.

The operation's `result.json` links all original capture/import/query/
export/workbook/archive identities. `records/` keeps exact request/result
receipts, `browser/` keeps original browser request recovery and views,
and `deliveries/` contains the complete customer files. Use the original
result's file map and digests when delivering them.

For an existing receiver that already owns an Analysis server and a Playwright
page, `examples/research_intake_browser.mjs` exports:

```javascript
await runResearchIntakeJourney({
  page,                         // its existing owned Page
  url: originalAnalysisUrl,      // current original loopback capability
  directory: privateBrowserRecords,
  selection: exactReviewedSelection,
  analysisWorkspaceId: actualAnalysisWorkspaceId,
  waitSeconds: 900
});
```

The exported continuation keeps its source/request journal in the selected
private directory and uses the real application controls. Its result can be
joined to the same original workbook/archive receiver; it does not create a
replacement browser or host when called this way.
