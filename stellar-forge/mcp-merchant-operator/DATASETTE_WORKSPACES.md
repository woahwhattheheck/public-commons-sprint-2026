# Datasette source editions and complete customer receiving

This is the merchant attachment to the original Datasette workspace. It uses the
same native client, persistent workspace identity, source editions, publisher
history and release packages. The source CLI and industrial browser retain their
existing owner. The merchant attachment exposes that owner’s operations and
receives its complete original files.

## Open the existing workspace

Start the original Datasette CLI with its existing workspace, selected buyer
settings and private launch-file option. Follow the source-owned
`datasette/README.md` for the installed command’s current flags. Its one startup
record uses `stellar-forge.datasette-server.v1` and contains `url`,
`workspaceId` and `instanceId`. Keep the launch file private. The merchant
does not start another Datasette process or acquire another workspace lease.

Declare that launch file in the original connection configuration:

```json
{
  "schema": "stellar-forge.datasette-workspace-connection.v1",
  "workspaces": {
    "geothermal": {
      "label": "Reviewed WRI geothermal source edition",
      "urlFile": "./datasette-launch.json",
      "expectedWorkspaceId": "USE_THE_ORIGINAL_WORKSPACE_ID",
      "timeoutMs": 300000
    }
  }
}
```

The connection reader resolves `urlFile` relative to this configuration.
Alternatively, declare `urlEnv` with the existing environment variable holding
the native origin. Use exactly one. The server admits its existing loopback
Host/Origin protocol and requires `X-Datasette-Workspace-ID` after health
discovery. The original native client owns those details.

The existing merchant provider is `datasette-workspaces`. Its configuration
input remains `datasetteWorkspaceConnection` and its family remains
`datasetteWorkspaces`. Configure the merchant’s ordinary private
`exportsDirectory` for receiving records. On a shared local machine it must be
outside the native source workspace, so receiving does not insert its own
metadata into the original source inventory. The merchant HTTP listener uses its
existing access token. Tokens and connection URLs belong in host configuration;
a tool caller selects the declared alias.

## Original source and publication operations

Read `merchant_datasette_health`, `merchant_datasette_status` and
`merchant_datasette_operations` before changing an existing workspace.
`merchant_datasette_operation` forwards one complete `operation` and `input`
to the source-owned dispatcher. Its operation enumeration is imported directly
from the source client.

| Native operations | Preserved original behavior |
| --- | --- |
| `source.capture`, `source.adopt`, `source.inspect`, `source.review` | Continue the original source operation, retain complete responses, inspect exact values, and review all source keys and projected types. |
| `editions.create`, `editions.list`, `editions.inspect`, `editions.compare`, `source.select` | Keep immutable edition identity, complete reviewed projection and saved source comparisons. |
| `publisher.status`, `publisher.source`, `publisher.target`, `publisher.plan`, `publisher.extract`, `publisher.inspect`, `publisher.review`, `publisher.publish`, `publisher.recover` | Use the existing typed dataset publisher, candidate/run history, exact review and target revision. |
| `publisher.buyer-offer`, `publisher.prepare-buyer`, `release.prepare`, `release.stage` | Keep the original published snapshot, buyer terms and complete source/release package. |
| `source.export`, `source.receive`, `workspace.export`, `workspace.receive` | Export and receive the original source-edition or full editable-workspace archive using its maintained archive engine. |
| `files.list`, `files.inspect`, `files.read` | Read complete original file identities and exact native byte ranges. |
| `operations.inspect`, `operations.cancel` | Inspect a saved capture/extraction by its original ID or cancel the actual active native operation. |

The source client declares the original 31 native operations and, in the joined
request-recovery edition, `requests.inspect` and `requests.list`. The merchant
tool catalog has five original control tools plus twelve upload and receiving
tools. Catalog presence is
separate from an operation being executed; receiving reports record the actual
calls and files.

Keep a capture’s `operationId`, an extraction’s `runId`, and the original
edition/review/target identities. No transport retries a mutating native action
automatically. A timeout or lost response leaves its outcome uncertain. Read
native status and `operations.inspect` with the same saved identity before
using the source’s documented continuation or publisher recovery. Reconnect does
not issue the interrupted action.

For example, inspecting an already-retained edition requires its existing ID:

```json
{
  "workspace": "geothermal",
  "operation": "editions.inspect",
  "input": {"id": "THE_SAVED_EDITION_ID", "offset": 0, "limit": 250}
}
```

## Upload a complete reviewed archive

Use the original upload UUID, original filename, exact decimal byte count and
whole-file SHA-256. The same native file authority retains the declaration,
durable prefix and original chunk history. Its existing workspace gate owns
cancellation and shutdown; the merchant attaches that owner.

`merchant_datasette_upload_status` reads the original declaration and
`merchant_datasette_upload_chunk` forwards one original range through the
native client. Tool byte fields remain decimal strings. Its `data` is canonical
base64 for at most 8 MiB; the native request body is the exact decoded bytes.
The selected provider declares a 12 MiB MCP request ceiling for that encoding.
The original native operation JSON ceiling remains 1 MiB.

The SDK and CLI transfer a complete reviewed local file with bounded buffers:

~~~sh
starforge datasette-mcp upload \
  --url http://127.0.0.1:8123/mcp \
  --workspace geothermal \
  --upload-id ORIGINAL_UPLOAD_UUID \
  --file /private/customer/wri-geothermal.sfds.gz \
  --name wri-geothermal.sfds.gz \
  --bytes 59792 \
  --sha256 53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0
~~~

Those bytes identify the original retained WRI source archive; a different
archive must use its own reviewed declaration. Before the first chunk the
helper hashes the complete private regular file and verifies its original size.
An existing upload must match all four declaration fields, and its durable
prefix must match those same local bytes. The helper then sends complete ranges
of 1 MiB by default, or the selected 64 KiB–8 MiB size. It keeps one native UUID
and does not create a separate upload ledger or workspace.

A failed chunk stops without automatic repetition. Read its actual state with:

~~~sh
starforge datasette-mcp upload-status \
  --url http://127.0.0.1:8123/mcp \
  --workspace geothermal \
  --upload-id ORIGINAL_UPLOAD_UUID
~~~

Explicitly run the same upload command to continue. The original authority
verifies the committed prefix before discarding only an uncheckpointed partial
suffix. FINALIZABLE permits the native zero-byte finish at the complete length.
COMPLETE returns its original archiveFile and retainedFile. REJECTED retains the
original failure and bytes; correcting a declaration requires another reviewed
UUID. Local file changes stop the transfer without replacing native history.

After COMPLETE, explicitly pass that native archiveFile and SHA to the existing
source.receive operation with a stable destination id, or to workspace.receive
with the selected receiving directory. Those unchanged engines validate and
receive the archive. An upload alone does not capture, approve, publish or restore
a dataset.

The SDK equivalent is `client.uploadFile({path,uploadId,name,bytes,sha256})`.
Its result retains state, the complete native upload reply, the reviewed local
identity and resumedBytes. The standalone `uploadDatasetteFile` function
accepts the same fields with the original merchant URL/alias or client.

## Preserve the source’s meaning

Source rows expose `cellTypes` alongside exact source text. A numeric lexeme,
a string containing digits and a null value remain distinct. Do not pass source
numbers through JavaScript `Number` merely to display or export them.

The original retained WRI geothermal input contains four pages with 50, 50, 50
and 39 rows. Those page bodies omit the columns array: use the ordered columns
from their original table metadata and manifest. The observed source key
`gppd_idnr` was unique and nonblank across those 189 rows; the database metadata
declares no primary key. `rowid` is the source locator. In the original schema
`commissioning_year` is REAL and has fractional values; `wepp_id` is TEXT and
can contain compound values. Preserve original nulls and sparse year coverage.

Keep advertised, requested and final page URLs separately. The retained capture
records an HTTP-to-HTTPS upgrade. Preserve unavailable HTTP status/headers for
the two originally received Notion pages as unavailable. The merchant does not
recapture those pages or manufacture missing transport receipts.

The distinct `datasette-analysis/` customer application consumes the original
source edition or prepared/finalized DatasetDelivery through its existing
AnalysisWorkspace. This attachment receives that application’s files when they
are retained in the source workspace, and receives its complete archive when the
owner includes it in the native delivery. It does not create a second Analysis
store or silently copy an unrelated outside directory into the source.

## Prepare complete receiving

First complete the intended native source/publisher/customer operations. If the
customer needs an editable workspace, call the original `workspace.export`
once through its existing owner and retain its returned archive identity. A
source edition alone uses `source.export`. Both return `retainedFile` when
the export is inside the original workspace. The maintained native
`workspace.receive` or `source.receive` later consumes that exact archive
and its SHA-256.

Then call:

```json
{
  "workspace": "geothermal",
  "workspaceId": "THE_ORIGINAL_WORKSPACE_ID"
}
```

with `merchant_datasette_export_prepare`. An optional `prefix` restricts the
selection to an original relative prefix such as `exports/` or `captures/`.
Omitting it includes the complete original retained-file inventory. No source
export is generated by this receiving action.

The adapter receives every inventory page, requires the terminal native cursor,
and compares a second complete inventory. If files change between these reads,
preparation fails explicitly. The resulting content-addressed `exportId`
binds every path, byte count and SHA. Repeating preparation for identical native
inventory produces the same export and verifies the same saved record.

The saved package contains:

* `Datasette-Download.json`: the complete receiving manifest and persistent
  workspace identity.
* `native-manifest.json`: a deterministic receiving record containing all
  original `files.list` responses, their pagination and complete descriptors.
  This is generated from returned native identities; it is not represented as a
  raw provider HTTP response.
* `files/<original-relative-path>`: each original native file with unchanged
  bytes, including source responses, reviews, edition history, publisher and
  dataset output, and the existing portable archives selected by the inventory.

The native inventory currently supports 30,000 files of up to 2 GiB each.
Manifest limits are 64 MiB. Original file byte counts arrive as explicit decimal
strings; the receiver verifies their safe integer range for filesystem access.
There is no preview-row or shortened-file substitution. Unsupported names or
limits cause an explicit error rather than dropping a member.

## Download, resume and reopen

`merchant_datasette_export_inventory` pages the saved manifest for inspection.
`merchant_datasette_export_manifest` returns its complete byte identity.
`merchant_datasette_export_file` uses the existing retained reader; it accepts
the original export, manifest SHA, file SHA, offset and optional `readId`.
The corresponding release tool closes only that receiving file handle.

The first read streams the complete selected native file through
`files.read`, verifies all original ranges and the whole SHA, and transfers a
private read-only descriptor to the maintained RetainedFileReads engine.
Memory stays bounded while large original files are received. Subsequent chunks
come from that verified descriptor. The original native file can later change
without changing this already-received snapshot. A new reader must still obtain
the originally requested bytes and SHA or fail explicitly.

The customer client uses the original RetainedDownload engine for complete-file
publication, existing partial ranges, exact completion manifests and its normal
Linux `flock` receiving lease. After a reader restart, the same original
manifest/file SHA and offset reopen the same bytes. Completed customer files stay
in the original receiving directory. A different native version never replaces
them silently.

```sh
starforge datasette-mcp download \
  --url http://127.0.0.1:8123/mcp \
  --workspace geothermal \
  --export ORIGINAL_EXPORT_ID \
  --directory /private/customer/geothermal \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256
```

The access token is read from the original `MCP_ACCESS_TOKEN` environment
variable, or from the explicitly selected `--token-env`. Keep its value private.

Run offline verification after the merchant and native listeners close:

```sh
starforge datasette-mcp reopen \
  --export ORIGINAL_EXPORT_ID \
  --directory /private/customer/geothermal \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256
```

This reopens the original receiving lease and verifies every complete local
member against the saved full manifest. It performs no source request, native
publication, buyer action or archive restore. Use the original archive receiving
command separately when opening the editable workspace.

## JavaScript client

```js
import {
  openDatasetteClient,
  reopenDatasetteExport
} from '@tokenjunkielabs/starforge-merchant/operator/datasette';

const client = await openDatasetteClient({
  url: merchantUrl,
  tokenEnv: 'MCP_ACCESS_TOKEN',
  workspace: 'geothermal'
});

const health = await client.health();
const prepared = await client.exportPrepare({
  workspaceId: health.native.workspaceId
});
const received = await client.downloadExport({
  exportId: prepared.exportId,
  expectedManifestSha256: prepared.manifestFile.sha256,
  directory: receivingDirectory
});

const reopened = await reopenDatasetteExport({
  directory: receivingDirectory,
  exportId: received.exportId,
  expectedManifestSha256: prepared.manifestFile.sha256
});
```

A configured client alias cannot be overridden by a later call or download.
The complete original native actions are also exposed as named methods, such as
`sourceInspect({input:{operationId,offset:0,limit:250}})`,
`publisherInspect({input:{runId}})` and
`workspaceExport({input:{outputFile}})`. These forward the unchanged native
input and do not add a replay policy.

## Receiving exercise and ownership

The companion receiving program attaches the existing merchant HTTP tool
handler to the exact source-owned provider, reads its actual advertised names,
inspects the retained source edition, receives all declared native files, closes
and reattaches the merchant component, then verifies complete offline receiving.
When its owner supplies originalUpload, it also inspects and zero-byte replays
that exact completed upload, verifying the unchanged native reply and retained
file. Its report includes actual native workspace/edition/export IDs, advertised
and invoked tool names, upload outcome, calls and file hashes. It does not launch another Python or Node source owner, capture provider
pages, create a new review, dispatch a buyer payment or repeat publication.

The merchant attachment drains its own in-flight callbacks and retained file
handles on close. The original native workspace, publisher and browser remain
with their original owner. Complete native source, publisher and customer
operation results remain separate from this attachment’s receiving report.

### Original source references

* Datasette source/workspace contract and retained-file implementation:
  source owner’s PR 2281 and complete source packet
  `dab756bbcb31fe55da4bfd2265b7e525e8d80f39` in
  `woahwhattheheck/public-commons-sprint-2026`.
* Original WRI retained seven-file source:
  `57fda4e96952ca5c2a28d738f87ba2c774aee194` in the same repository.
* Customer Analysis contribution: PR 2287,
  `12d9a9280d2159ebbfd3a2d45b19de7eb07e9797`.
* Source provider’s `client.mjs`, `workspace.mjs`, `provider.mjs`,
  `editions.mjs` and `archive.mjs` remain authoritative for the installed
  native catalog and exact input shapes.
