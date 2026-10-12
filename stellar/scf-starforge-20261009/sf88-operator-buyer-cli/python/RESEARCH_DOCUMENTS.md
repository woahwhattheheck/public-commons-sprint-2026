# Python Documents, Pipelines and analytical workbooks

Python applications can operate the existing Research Documents and Unstructured
Pipelines interfaces, retain an exact source edition, and use the original
Analysis workspace to produce a complete typed export, customer workbook and
portable workspace.

The public entry points are `ResearchWorkspace`, `ResearchDocuments`,
`ResearchPipelines`, `ResearchSelection`, `ResearchInputFile`,
`ResearchDocumentSource` and `ResearchError`. The installed
`stellar-forge-research` command exposes the same interface. The maintained Node
[Research client](../research-dossiers/workspace-client.mjs) and
[Documents/Pipelines facade](../research-dossiers/document-workspace-client.mjs)
own requests, revisions, provider operations and file delivery. The Python bridge
uses the existing [Runtime](stellar_forge_buyer/runtime.py) for process ownership,
cancellation and the final native reply.

## Install and select the original workspace

Use the Python package and Node source from the same complete installed release.
A Python wheel contains the Python modules; supply the matching full source root
as `checkout`. The existing Analysis workbook implementation also needs its
normal workbook runtime, including openpyxl. The source tree's original
`AnalysisWorkspace`, `AnalysisWorkbooks`, `WorkspaceArchives` and receiver
remain the implementation.

Pass the private connection file written by the original Research workspace or
its maintained setup. Its URL and bearer credential stay in that original file.
The Python client retains the connection **path**, native workspace identity and
exact calls in its private application directory. It does not copy the bearer
credential into the call history or analytical source.

```python
from stellar_forge_buyer import ResearchWorkspace

with ResearchWorkspace(
    checkout="/work/installed-merchant-source",
    connection_file="/private/research/connection.json",
    directory="/private/customer/research-client",
    request_timeout_ms=120_000,
) as research:
    print(research.status())
    print(research.dossiers())
```

The first native status binds the actual `research_<sha256>` workspace. Reopening
the same Python directory checks that identity. An explicit
`expected_workspace_id` can bind it before the first request. Moving to another
host connection is supported when it opens the same original Research workspace.
Selecting a different workspace requires a different client directory.

`close()` cancels and drains calls owned by this client. Ownership includes
the final native result, durable attempt publication, temporary request cleanup,
verified download and an in-progress analytical source publication. The host
and provider operations remain under their existing operator.

## Choose an original document or managed job

| Source | Python selection | Retained identity |
| --- | --- | --- |
| An existing self-hosted document purchase | `research.documents(dossier_id).purchase(purchase_id)` | Original SF88 workspace, intent, payment/delivery fields, document/request/response hashes |
| A received document edition | `research.documents(dossier_id).edition(edition_id)` | The same portable original purchase edition |
| A retained managed output | `research.pipelines(dossier_id).output(operation_id, output_id)` | Reviewed local plan, actual provider job ID, selected file/node and retained output |
| A received managed edition | `research.pipelines(dossier_id).edition(edition_id)` | The same portable original job/output edition |

Use IDs returned by the existing list and review calls. Local IDs retain their
original formats: purchases `u_<sha256>`, editions `e_<sha256>`, Pipelines
operations `up_<sha256>`, retained inputs `in_<sha256>` and outputs
`out_<sha256>`. Provider job, file and node IDs remain opaque provider values.

```python
documents = research.documents(dossier_id)
print(documents.list())
selected = documents.edition(edition_id)
review = selected.review()
print(review)

# Use the digest returned by this original review.
for element in selected.iter_elements(
    expected_edition_sha256=reviewed_edition_sha256,
    limit=100,
):
    consume(element)  # Includes the original occurrence and full native fields.
```

`elements()` returns one original page with `items` and `nextOffset`.
`iter_elements()` follows every returned page. Optional page, type and text
filters remain native query fields. Element IDs can repeat; the original
one-based array occurrence remains the stable row and citation locator.

### Prepare and control a managed Pipelines job

The launcher declares the selected provider account and named template/job-node
profiles. Preparation retains the exact local files and selected profile. Native
submit uses that declared account; the original provider owns its queue, status
and cancellation outcome.

```python
from stellar_forge_buyer import ResearchInputFile

pipelines = research.pipelines(dossier_id)
prepared = pipelines.prepare_files(
    request_id=prepare_request_id,       # Retain before calling.
    profile_id=selected_profile_id,
    question_id=selected_question_id,
    label="Quarterly document sources",
    expected_revision=reviewed_dossier_revision,
    files=[
        ResearchInputFile.from_file(
            "/private/customer/report.pdf",
            filename="report.pdf",
            content_type="application/pdf",
        ),
    ],
)
print(prepared)

# Inspect the returned original operation and use its current reviewed values.
operation = pipelines.operation(operation_id)
print(operation)
result = pipelines.submit(
    operation_id,
    request_id=submit_request_id,
    expected_revision=reviewed_operation_revision,
    expected_plan_sha256=reviewed_plan_sha256,
)
print(result)
```

The original provider limits apply: at most ten local input files, each at most
50,000,000 bytes, plus the selected host's total upload allowance. The bridge
streams the verified file descriptors into the existing client request. Paths,
order and hashes are retained before dispatch.

The remaining operations retain the same native IDs and expected revisions:

```python
pipelines.refresh(
    operation_id,
    request_id=refresh_request_id,
    expected_revision=current_revision,
)
pipelines.cancel(
    operation_id,
    request_id=cancel_request_id,
    expected_revision=current_revision,
    reason="The selected document job is no longer needed",
)
jobs = pipelines.provider_jobs(operation_id)  # Original account's read-only listing.
pipelines.reconcile(
    operation_id,
    request_id=reconcile_request_id,
    expected_revision=current_revision,
    expected_plan_sha256=reviewed_plan_sha256,
    provider_job_id=selected_existing_provider_job_id,
    reason="Bind the existing job after the original create reply was lost",
)
pipelines.retain_output(
    operation_id,
    request_id=retain_request_id,
    expected_revision=current_revision,
    file_id=selected_provider_file_id,
    node_id=selected_provider_node_id,  # None selects the original default output.
)
```

A lost provider create reply remains the original `SUBMISSION_UNKNOWN`
operation. Listing jobs and reconciling an actual existing ID resolve that
operation. A cancellation acknowledgment stays distinct from a subsequently
observed `STOPPED` job. The Python wrapper preserves the native lifecycle.

## Reopen an exact call after interruption

Each application write has a caller-selected `request_id`. The private
`calls/` directory retains its action, body, original workspace, native IDs,
replay policy and numbered attempts before starting the bridge.

```python
from stellar_forge_buyer import ResearchError

try:
    result = pipelines.retain_output(
        operation_id,
        request_id=retain_request_id,
        expected_revision=current_revision,
        file_id=selected_provider_file_id,
    )
except ResearchError as error:
    print(error.request_id, error.outcome_unknown, error.recovery)
    print(research.call_record(retain_request_id))

# Explicit continuation uses the exact saved action/body/IDs.
result = research.resume(retain_request_id)
```

The wrapper reopens a saved, complete native success. That includes a final
validated native success received during the Runtime's cancellation grace
period: the actual result is retained, with `pythonRuntime` interruption
metadata. Explicit original failures before process creation are marked
`processStarted: false`, so the same request can continue after admission is
repaired.

An absent or invalid final reply from a dispatched write remains uncertain.
Native idempotent Pipelines actions, specialized source receiving and portable
reopen can resume their original request. Ordinary dossier edits and generic
research-file receiving require original dossier readback before a new write;
their APIs do not supply the same replay contract. `ResearchError.record`
retains the original code, status, recovery and operation ID.

Downloads retain `destinationPublished`, the native file identity and
`sourceCleanupFailed` when applicable. Inspect those fields before choosing
another destination. A complete file whose expected digest did not match remains
available for inspection under its actual original hash.

## Download and receive a selected edition

Use the exact reviewed edition digest for selection-bound reads:

```python
edition = selected.download(
    "edition",
    "/private/customer/selected-edition.json",
    expected_edition_sha256=reviewed_edition_sha256,
)
with edition.open() as stream:
    archive_bytes = stream.read()
print(edition.delivery["sha256"])

received = selected.receive(
    request_id=receive_request_id,
    expected_edition_sha256=reviewed_edition_sha256,
    question_id=selected_question_id,
    label="Reviewed source document",
    expected_revision=reviewed_dossier_revision,
)
print(received)
```

Documents exports support `document`, `response` and `edition`. Pipelines
selection exports support `output` and `edition`; direct
`download_input()` and `download_output()` preserve the original retained
bytes independently of portable-envelope construction limits.

`FileDelivery.open()` verifies the exact file before yielding its descriptor.
`read_bytes()`, `json()` and `save_as()` use the same original reader.
Supplying a known `expected_sha256` allows a later process to reopen an already
published matching destination locally.

## Retain a complete Analysis source

`ResearchSelection.analysis_source()` downloads the original edition, invokes
the original verifier, and publishes a source closure owned by the caller:

```python
source = selected.analysis_source(
    "/private/customer/document-source",
    expected_edition_sha256=reviewed_edition_sha256,
    title="Quarterly document elements",
)
print(source.verify())
print(source.mapping)
```

For a previously exported edition, no live Research host is needed:

```python
from stellar_forge_buyer import ResearchDocumentSource

source = ResearchDocumentSource.create(
    "/private/customer/selected-edition.json",
    "/private/customer/document-source",
    checkout="/work/installed-merchant-source",
    expected_sha256=actual_edition_file_sha256,
    expected_edition_sha256=reviewed_edition_sha256,
    title="Quarterly document elements",
)
```

The source uses the original
[`stellar-forge.analysis-source-document.v1` contract](stellar_forge_buyer/response_documents.py).
Its `source.json` is published after all exact files:

| Data | Retained form |
| --- | --- |
| Every original element or managed projected item | One CSV row per one-based occurrence |
| Full text, page value, metadata, provider record and citation | Separate original/JSON text columns |
| Original purchase or provider job/output binding | Complete analysis receipt |
| Complete research edition | Exact original bytes and SHA-256 |
| Self-hosted original document and response | Exact bytes, including their existing purchase identity |
| Managed original output | Exact bytes and selected file/node identity |
| Long originals | Ordered parts with per-part hashes, offsets and full reassembly hash |
| Workbook text preview | Explicit ASCII JSON string of the first 2,000 Unicode characters, plus completeness and full character count |

The CSV has eighteen declared columns. `position` and `text_characters` use
the original integer conversion; the other columns are text. JSON columns remain
JSON **text**, preserving nested provider data without changing the importer's
type semantics. The full original text is separate from its named workbook
preview.

The preview's maximum 24,002 ASCII characters fits the original workbook cell
limit, including astral Unicode and escaped controls. Original text and metadata
remain complete in the CSV, typed query export and source archive. The workbook
contains an index of all occurrences with these clearly labeled text previews.

Native source limits remain explicit: an edition is at most 64 MiB; original
source-file parts are at most 32 MiB; the complete source closure is at most
256 MiB with at most 32 original roles. The original importer separately bounds
mapped rows, record sizes, elapsed time and the mapped table output. An exceeded
limit returns its original error with the prepared source retained.

`source.original("research-edition", destination)` reconstructs the exact
edition. The other roles are `original-document` and `original-response`
for a saved purchase, or `original-output` for a managed job. Reassembly checks
part order, offsets, each actual file and the complete expected digest. The
published native manifest contains content addresses and attribution, with no
provider credential or signed download URL.

## Review, import and query in the original Analysis workspace

The native workflow separates mapping preview from importing the selected
preview. The convenience methods only forward to the original owner:

```python
from contextlib import closing
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace

with closing(AnalysisWorkspace(
    "/private/customer/analysis",
    checkout="/work/installed-merchant-source",
)) as analysis:
    registration = source.register(analysis, "document_elements", expected_revision=0)
    preview = source.preview(
        analysis,
        "document_elements",
        registration["revision"],
        request_id=preview_request_id,
    )
    # Read analysis.job(preview_request_id) until its original status is COMPLETE.
    # Review its actual mapping, sample and preview_sha256.
    imported = source.import_preview(
        analysis,
        request_id=import_request_id,
        preview_id=preview_request_id,
        preview_sha256=reviewed_preview_sha256,
    )
```

Completed import returns the original immutable record at
`job["result"]["version"]`. Select its `version_id` with
`analysis.database.activate(..., expected_revision=...)`. Saved SQL and query
requests use the original reviewed `analysis.state()["views"]`.

A query's displayed result may be bounded. The original `query-export` job
runs the complete selected query against those retained sources and publishes
typed JSONL, CSV and SQLite. Native workbook definitions use that completed typed
query export, its exact manifest digest and actual string column names.

## Complete customer workbook and portable reopen

The maintained
[`examples/research_document_workbook.py`](examples/research_document_workbook.py)
implements the entire native chain. Its `receive` command explicitly chooses the
shipped occurrence mapping and runs one retained customer operation:

```sh
python3 examples/research_document_workbook.py \
  --checkout /work/installed-merchant-source \
  --directory /private/customer/document-analysis \
  receive \
  --edition /private/customer/selected-edition.json \
  --file-sha256 ACTUAL_ORIGINAL_FILE_SHA256 \
  --edition-sha256 ACTUAL_REVIEWED_EDITION_SHA256 \
  --title "Quarterly document elements"
```

Use the actual file and reviewed digests returned by the original Documents or
Pipelines selection. They can differ because the saved-purchase verifier uses
its original canonical edition identity while the file hash identifies the
actual retained serialization.

The same command retains:

1. Original edition verification, complete source files and native source registration.
2. The exact mapping preview and import decision.
3. The immutable imported version and revision-bound view selection.
4. Saved SQL, its original query result and complete typed query export.
5. The original workbook definition, every occurrence, XLSX and workbook handoff ZIP.
6. A complete original Analysis workspace archive, including source documents.
7. An offline restore and read through the original receiver, without a Node checkout or provider connection.

The operation record is saved before dispatch. Every native job, workbook save
and archive restore uses its retained ID. A repeated completed invocation verifies
and reopens the exact delivered files. Original native jobs retain their
`COMPLETE`, `FAILED`, `INTERRUPTED` or other states. The native archive's
supported same-ID resume remains available; other interrupted native jobs are
resolved through the existing Analysis operator instead of silently creating
another attempt.

For an interactive review, run the same example in two phases:

```sh
python3 examples/research_document_workbook.py \
  --checkout /work/installed-merchant-source \
  --directory /private/customer/document-analysis \
  prepare --edition /private/customer/selected-edition.json \
  --file-sha256 ACTUAL_ORIGINAL_FILE_SHA256 \
  --edition-sha256 ACTUAL_REVIEWED_EDITION_SHA256

python3 examples/research_document_workbook.py \
  --checkout /work/installed-merchant-source \
  --directory /private/customer/document-analysis \
  finish --preview-sha256 ACTUAL_NATIVE_PREVIEW_SHA256

python3 examples/research_document_workbook.py \
  --directory /private/customer/document-analysis reopen
```

A partial original source remains visibly incomplete. The native preview states
whether an incomplete-source acknowledgment is needed; `--allow-incomplete`
records that deliberate import choice. Full original source bytes and warnings
remain in the closure.

### Delivered files

| Location beneath the private caller directory | Purpose |
| --- | --- |
| `operation.json`, `records/` | Exact source selection, native requests, decisions and original receipts |
| `source/source.json`, `source/files/` | Complete original source-document closure |
| `analysis/` | Original analytical database and retained job/output state |
| `deliveries/query/rows.jsonl` | Complete typed rows, including full text and provider metadata |
| `deliveries/query/rows.csv` | Original spreadsheet-safe complete CSV export |
| `deliveries/query/rows.sqlite3` | Original standalone query-result database |
| `deliveries/workbook/workbook.xlsx` | Every occurrence with labeled text previews and source identities |
| `deliveries/workbook/handoff.zip` | Original workbook, typed sources and definition/history |
| `deliveries/workspace/workspace.zip` | Complete portable Analysis workspace and source documents |
| `restored-analysis/` | Original same-archive receiving target |

The cold reader verifies the original workspace ID, immutable table row count,
saved query digest, typed-row file, workbook file and every registered document
file. It reads the original immutable table even if a customer later changes a
current view. Repeating the original restore preserves later edits through the
maintained receiver's existing journal.

To receive the full workspace elsewhere, use the original
[`restore_archive`](stellar_forge_buyer/workspace_archive_receive.py):

```python
from stellar_forge_buyer.workspace_archive_receive import restore_archive
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace

receipt = restore_archive(
    "/private/incoming/workspace.zip",
    "/private/customer/restored-analysis",
    operation=retained_restore_request_id,
    expected_sha256=actual_workspace_zip_sha256,
)
with closing(AnalysisWorkspace(receipt["target"])) as analysis:
    print(analysis.state())
```

The target is absent on first receive; retain the same archive, target and
operation ID for continuation. The workbook handoff and full workspace archive
serve different customer needs: the full workspace also carries every registered
source-document revision and the original analytical history.

## CLI and scripted operations

`stellar-forge-research` exposes `status`, `calls`, `call-record`,
`resume`, `call`, `source`, `source-inspect`, `source-export` and
`register-source`. For `call`, supply the exact native-shaped JSON input and
an explicit caller request ID for mutations. The command's action allowlist and
replay classification match the Python interface.

```sh
stellar-forge-research \
  --checkout /work/installed-merchant-source \
  --connection /private/research/connection.json \
  --directory /private/customer/research-client \
  call-record ORIGINAL_REQUEST_ID

stellar-forge-research \
  --checkout /work/installed-merchant-source \
  --directory /private/customer/document-source \
  source-inspect
```

The native source modules are
[`research_workspace.py`](stellar_forge_buyer/research_workspace.py),
[`research_documents.py`](stellar_forge_buyer/research_documents.py),
[`research-bridge.mjs`](research-bridge.mjs) and
[`research-document-source.mjs`](research-document-source.mjs). The complete
example records actual native results when invoked with a retained edition.
Provider runs, their original output files and receiving identities stay with
the existing customer operation.
