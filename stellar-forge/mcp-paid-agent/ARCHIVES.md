# Portable Analysis workspaces through the native MCP

Export a complete customer Analysis workspace, resume its download, and reopen
the received database with its retained query, report and workbook history.
These native operations use the original Python workspace exporter and its
existing worker. The installed receiving command owns archive inspection,
extraction, publication and recovery.

The archive contains the original SQLite snapshot and the immutable output
files selected by its completed jobs. It preserves saved queries, source and
view identities, original job outcomes, report definitions/publications,
complete query exports and workbook editions, including their typed source
files and predecessor definitions. The review shows the actual selection and
any missing retained files before the export starts.

## Use the existing customer host

Install the complete maintained release and its declared Node/Python
dependencies. The Python application and native adapter must both contain this
archive feature. The existing workbook extra remains necessary to build new
Excel workbooks; receiving retained files uses the original installed Python
application. The native download journal uses the same Linux util-linux
`flock` helper already used by the merchant file downloader.

Open the original Analysis workspace with its existing launcher:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/database serve
~~~

Keep its current process when it is already running. One process owns the
database. Register that live workspace with the existing native MCP host:

~~~sh
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  analysis-register --dir /private/customer/native \
  --name customer --database /private/customer/database
~~~

A host that has not yet initialized its native workspace can use the original
`init --dir /private/customer/native --workspace /private/customer/buyer`
command with the customer's existing SF88 buyer workspace. The complete setup
is in [ANALYSIS.md](ANALYSIS.md). Keep that original workspace and its host
configuration.

Serve the native workspace with the existing MCP token environment:

~~~sh
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  serve --dir /private/customer/native --port 3210
~~~

The launcher prints its MCP URL. `MCP_ACCESS_TOKEN` stays in the host/client
environment; `--token-env NAME` can select another existing environment
variable in the download command. Agent arguments select the immutable
`customer` alias. On every operation the adapter resolves the fresh private
Analysis launch capability and checks the selected workspace identity.

## Review the whole original selection

Call the existing `sf43_discover_review_and_pay` tool with this native request:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "workspace-archive-review",
  "analysisRequest": {
    "include_previous_backups": false,
    "offset": 0,
    "limit": 25
  }
}
~~~

The result includes the original `workspace_id`, selected payload count and
size, database size, `ready`, and three arrays: `outputs`, `exclusions` and
`missing`. The native adapter pages each array independently at the selected
offset. `pages` gives each array's complete total and `nextOffset`; follow the
applicable cursor to read its remaining entries. The original `ready` value
always describes the entire selection.

`include_previous_backups: true` includes earlier original SQLite backups.
Earlier portable workspace ZIPs remain separately retained, avoiding recursive
archives. Runtime launch capabilities and external provider connections are
created or selected by the receiving host. The snapshot preserves their
original data/source identities.

When the review names a missing original output, restore that exact retained
file from its original customer handoff using the named identity. Reopen the
same review after that source repair. Completed job history remains attached
to its original files.

## Export, follow progress, and recover the same job

Generate and retain a fresh lowercase hexadecimal UUID32 before dispatch.
Save the complete intended request. Replace `EXPORT_UUID32` below with that
actual ID:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "workspace-export",
  "analysisRequest": {
    "id": "EXPORT_UUID32",
    "include_previous_backups": false
  }
}
~~~

Use the same reviewed backup selection in this request. The original worker
takes one SQLite snapshot and then streams the selected immutable outputs
into `workspace.zip`. Read the original job using:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "job",
  "analysisRequest": {"id": "EXPORT_UUID32"}
}
~~~

The job exposes the original status and archive progress. On COMPLETE its
result has schema `stellar-forge.analysis-workspace-export.v1`, the export
and workspace IDs, payload totals, and two exact file records:
`workspace.zip` and `archive-manifest.json`. Preserve both original SHA256
values and sizes.

Use `workspace-archives` with `limit` and optional `before` to follow older
original exports. Pass its `next_before` sequence to the next call, including
when reviewing an interrupted or cancelled job.

To cancel an in-progress export, use `cancel-workspace-export` with that same
`id`, then reopen the original job to read its outcome. Repeating the exact
original `workspace-export` request recovers a COMPLETE result or resumes
its retained interrupted, failed or cancelled snapshot. A different intended
selection requires a new ID. An interrupted ZIP is rebuilt from the same
frozen snapshot and pinned outputs.

## Download the complete archive with the installed client

The maintained package exposes this client as `starforge mcp-analysis-archive`.
After installing the original archive, use `npx --no-install starforge
mcp-analysis-archive` with the same arguments shown below. The source-path
form also works inside an operator-selected source tree.

The download command connects to the same authenticated native MCP endpoint.
It uses the original MCP JSON-RPC client and native SavedFileReader, preserving
the completed job, workspace identity, exact manifest and both file digests.

Inspect the completed remote job:

~~~sh
node stellar-forge/mcp-paid-agent/native-analysis-archive-download.mjs \
  inspect --url http://127.0.0.1:3210/mcp \
  --workspace customer --id EXPORT_UUID32
~~~

Create a private parent for the chosen transfer directory. Replace
`ZIP_SHA256` and `MANIFEST_SHA256` below with the exact digests from that
completed job, then download:

~~~sh
node stellar-forge/mcp-paid-agent/native-analysis-archive-download.mjs \
  download --url http://127.0.0.1:3210/mcp \
  --workspace customer --id EXPORT_UUID32 \
  --dir /private/customer/transfers/export-1 \
  --sha256 ZIP_SHA256 --manifest-sha256 MANIFEST_SHA256
~~~

The client creates the selected private transfer directory. It retains a
source-bound journal before writing payloads. Each range is verified against
the original file identity and expected offset, decoded into a private partial
file, fsynced, and checkpointed. The completed local file is published only
after its full size and SHA256 match. Existing unrelated files are preserved.

After a connection failure or process interruption, run the identical command
with the same transfer directory and digests. The original verified prefix is
reused. A killed write can leave an uncheckpointed suffix; only that suffix is
discarded. The caller may select a restarted host's current URL and token
environment while retaining the same workspace/export/file bindings.

A native host restart also preserves the local registration. A restarted
Analysis process may issue a new port and capability; the adapter resolves
its current original launch file on reconnect. File range requests have no
remote cursor that must survive a restart.

The final result has schema
`stellar-forge.analysis-workspace-download.v1`. The transfer directory holds:

- `workspace.zip`: the complete original portable archive.
- `archive-manifest.json`: its exact original external manifest.
- `download-receipt.json`: retained source identity, hashes, sizes and local
  completion. A lost response returns this same recorded completion.
- `download-state/`: the original transfer journal and lock.

A resumed/reopened call reports `reused: true` alongside that saved receipt.
The actual snapshot and completed job remain owned by the original producer.

## Reopen and restore offline

With both services closed, reopen the complete downloaded files:

~~~sh
node stellar-forge/mcp-paid-agent/native-analysis-archive-download.mjs \
  reopen --dir /private/customer/transfers/export-1 \
  --sha256 ZIP_SHA256 --manifest-sha256 MANIFEST_SHA256
~~~

This verifies the local files against the retained source binding and receipt.
It needs no MCP endpoint or token. Full ZIP member/schema and SQLite receiving
checks belong to the maintained original Python receiver:

~~~sh
python -m stellar_forge_buyer.workspace_archive_receive inspect \
  /private/customer/transfers/export-1/workspace.zip \
  --sha256 ZIP_SHA256
~~~

Choose an absent destination below a private parent and retain a new receiving
UUID32. Receive the exact downloaded archive:

~~~sh
python -m stellar_forge_buyer.workspace_archive_receive receive \
  /private/customer/transfers/export-1/workspace.zip \
  /private/customer/restored-database \
  --operation RECEIVE_UUID32 --sha256 ZIP_SHA256
~~~

The original receiver checks the exact member manifest and every payload,
stages private files, verifies the SQLite workspace identity and retained
table counts, and publishes the complete destination atomically. Use the
same source, digest, target and operation after interruption. A completed
replay returns the original receipt while preserving subsequent customer
database and session changes.

Its result schema is `stellar-forge.analysis-workspace-receipt.v1`; retain
the original `operation_id`, `archive_id`, `workspace_id`,
`archive_sha256`, `manifest_sha256`, `target` and `database_path`.
See the complete [Python receiving guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/WORKSPACE_ARCHIVE_RECEIVING.md)
for the original format, recovery and operating details.

## Continue working in the received customer application

Open the received workspace with its original launcher:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/restored-database serve
~~~

The application retains the original workspace identity and creates a fresh
local launch capability. Browse its saved queries, views, report history,
query-export cohorts and workbook editions. Existing complete files reopen
from the receiving database's own retained directories. Producer directory
fields remain historical provenance.

With the native MCP host closed, register the received running database
under a distinct alias, then serve that same host again:

~~~sh
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  analysis-register --dir /private/customer/native \
  --name restored_customer --database /private/customer/restored-database

node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  serve --dir /private/customer/native --port 3210
~~~

Use `restored_customer` for subsequent native operations. The original
[workbook workflow](WORKBOOKS.md) can reopen its saved editions and deliver a
new reviewed recurring edition from the received retained results.

## Programmatic customer transport

The same installed module exports:

~~~js
import {
  openNativeAnalysisArchiveClient,
  inspectNativeAnalysisArchive,
  downloadNativeAnalysisArchive,
  reopenNativeAnalysisArchive
} from '@tokenjunkielabs/starforge-merchant/buyer/mcp/analysis-archives';

const client = await openNativeAnalysisArchiveClient({
  url: process.env.CUSTOMER_MCP_URL,
  analysisWorkspace: 'customer'
});
const source = await inspectNativeAnalysisArchive({
  client, analysisWorkspace: 'customer', id: originalExportId
});
const receipt = await downloadNativeAnalysisArchive({
  client, analysisWorkspace: 'customer', id: originalExportId,
  directory: privateTransferDirectory,
  expectedSha256: source.files.find(file => file.name === 'workspace.zip').sha256,
  expectedManifestSha256: source.manifestSha256,
  onProgress: progress => updateCustomerProgress(progress)
});
~~~

The host supplies executable code, endpoint selection, private paths and
credential environment. An embedding may supply a compatible client whose
`analysisWorkspace` is the selected alias and whose
`call(operation, request)` returns the original native analysis result.
`chunkSize` supports 1–65,536 bytes. An `AbortSignal` can interrupt a
download; the durable checkpoint remains available to the same next call.

## Native operation reference

| Native analysis operation | Original application operation |
| --- | --- |
| `workspace-archive-review` | `GET /api/workspace-archive-review`; paged native display of the complete review |
| `workspace-export` | `POST /api/start/workspace-export` with the retained exact request/ID |
| `job` | Existing `GET /api/jobs/ID`, including original archive progress |
| `workspace-archives` | `GET /api/workspace-archives?before=SEQUENCE&limit=N` |
| `cancel-workspace-export` | `POST /api/workspace-archives/ID/cancel` |
| `workspace-archive-file` | COMPLETE original job plus current receiving-directory manifest and shared SavedFileReader |

For direct file ranges, select `workspace.zip` or `archive-manifest.json`
and supply `id`, `filename`, `manifest_sha256`, `sha256`,
`byteOffset` and `maxBytes`. The returned range carries its original
workspace/export identity, exact offset, base64 bytes and next offset. The
installed download command performs the complete durable transport and
hands its exact finished artifact to the original receiving workflow.
