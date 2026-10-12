# Cloud Delivery: installed operation and remote receiving

The client, browser and installed launch operate the same original DuckDB Cloud workspace. The native edition store, comparison and reviews, query authoring, merchant packages and received sources keep their original IDs and typed values. The host chooses existing private workspace UUIDs; remote tools select aliases.

## Entrypoints

| Installed entry | Purpose |
|---|---|
| `cloud-workspace init / inspect / serve` | Initialize an empty original workspace, inspect its UUID/source, or open it |
| `cloud-mcp init / inspect` | Bind existing workspaces into the original merchant MCP provider |
| `cloud-remote` | Typed calls, original operation recovery, streamed upload/download and complete archive receiving |
| `customer/cloud` | Typed `connectCloudClient` and `CloudClient` |
| `customer/cloud/download` | Inspect, download and locally reopen an original immutable artifact |
| `customer/cloud/upload` | Inspect a local file and stream it into an existing native intake |
| `seller/duckdb/cloud/launch` | Saved launch functions for the original workspace |
| `merchant/cloud/provider` | Source-owned provider and lifecycle declaration |

These join the existing `duckdb` contribution. Its original five commands, ten exports and `duckdb-agent` application remain available. The new application ID is `coinmetrics-cloud`, and the merchant provider ID is `coinmetrics-cloud-workspaces`.

## Initialize and open one original workspace

Select an existing Python interpreter with the original DuckDB dependency. These commands install no interpreter or provider credentials.

```sh
starforge cloud-workspace init \
  --directory /private/cloud-workspace \
  --python /private/duckdb-runtime/bin/python
starforge cloud-workspace inspect --directory /private/cloud-workspace
```

The result includes the actual `workspaceId`, retained `sourceFile` and launch `source.sha256`. Existing work reopens with the same UUID. A missing initialized database is reported rather than silently replaced. Interrupted owned initialization retains its own marker.

```sh
starforge cloud-workspace serve \
  --directory /private/cloud-workspace \
  --workspace-id RETURNED_UUID \
  --source-sha256 RETURNED_SOURCE_SHA256 \
  --python /private/duckdb-runtime/bin/python \
  --startup-json --port 0
```

Keep the returned authenticated loopback URL private. The original Applications console offers the same saved launch: it pins the source and workspace UUID and verifies the actual authenticated listener before displaying the URL.

One native owner holds the workspace at a time. To combine browser and remote operation, open it through MCP and use that owner's `browserUrl`; do not open a second direct process against the same directory.

A private connection file uses this shape; replace the UUID and paths with the actual initialized values:

```json
{
  "schema": "stellar-forge.coinmetrics-cloud-connection.v1",
  "workspaces": {
    "research": {
      "label": "Retained source research",
      "directory": "/private/cloud-workspace",
      "workspaceId": "RETURNED_UUID",
      "python": "/private/duckdb-runtime/bin/python",
      "environmentFile": "/private/cloud-environment.json"
    }
  }
}
```

The label, Python and environment file are optional. The private environment is a JSON object of environment-name/string pairs, pinned by SHA256 and never returned as client metadata. Keep the host directory outside every selected source workspace.

```sh
starforge cloud-mcp inspect --connection /private/cloud-connection.json
starforge cloud-mcp init \
  --directory /private/cloud-mcp-host \
  --connection /private/cloud-connection.json --name "Cloud Delivery"
starforge merchant-mcp serve \
  --config /private/cloud-mcp-host/merchant-mcp.json \
  --port 0 --token-env MCP_ACCESS_TOKEN
```

The original merchant server owns authentication, framing and provider lifecycle. Supply an existing host-issued token through the selected environment variable. Token values are not accepted in command arguments or retained request records.

## Typed source, comparison and merchant tools

`client.d.mts` maps every tool name to its request/result. The runtime catalog is the same declaration the host installs. Revisions and bounded counts are safe integers. Source byte counts, large integer/decimal values, nanosecond timestamps and exact nested JSON stay in their native string representation; missing fields remain absent keys.

```js
import {connectCloudClient} from 'YOUR_INSTALLED_PACKAGE/customer/cloud';
const client = await connectCloudClient({
  url: process.env.REVIEWED_MCP_URL, tokenEnv: 'MCP_ACCESS_TOKEN'
});
try {
  const opened = await client.openWorkspace('research');
  const current = await client.status('research');
  const editions = await client.call('merchant_cloud_records', {
    workspace: 'research', kind: 'editions', offset: 0, limit: 50
  });
  // Continue using the actual returned IDs, source SHA and native revisions.
} finally {
  await client.close();
}
```

| Family | Native tools, all prefixed `merchant_cloud_` |
|---|---|
| Ownership | `workspaces`, `open`, `status`, `close` |
| Source | `records`, `edition`, `intake`, `upload_status`, `upload_chunk`, `commit` |
| Comparison | `compare`, `comparison`, `review`, `operation` |
| Query authoring | `select`, `catalog`, `author_review`, `author_reopen`, `draft`, `draft_save`, `plan_review`, `preview` |
| Merchant | `prepare`, `inspect`, `start`, `runtime`, `stop` |
| Delivery and editing | `export`, `receive`, `received_draft`, `draft_adopt` |
| Retained files | `artifact_read`, `artifact_release` |

Use `cloud-remote tools EXACT_TOOL` to inspect the actual argument schema. Cloud revision, comparison review revision and merchant draft revision are separate fields.

Client close aborts/drains its outgoing calls and releases known retained file descriptors. It does not close the remote workspace. `closeWorkspace(alias, workspaceInstanceId)` explicitly closes that original browser/model and its owned seller. Failed cleanup preserves handles for a same-instance close retry.

## Retain commands before dispatch

```sh
starforge cloud-remote call merchant_cloud_compare \
  --url "$REVIEWED_MCP_URL" \
  --arguments /private/comparison-request.json \
  --operation-dir /private/commands/original-comparison-0001 \
  --output /private/comparison-response.json
```

Every declared Cloud action requires a command directory, including prepare/start/stop. The CLI retains original argument bytes and their hash, tool and workspace UUID, a dispatch marker, and the full response. A completed repeat reads its saved result locally. A dispatch marker without a saved response inspects the original native operation and never resends it.

```sh
starforge cloud-remote recover \
  --url "$REVIEWED_MCP_URL" \
  --operation-dir /private/commands/original-comparison-0001
```

Recover reads the actual Cloud record, saved draft/package or merchant runtime. A new endpoint after restart must still name the original workspace UUID. Review this result before an explicit supported continuation:

```sh
starforge cloud-remote retry \
  --url "$REVIEWED_MCP_URL" \
  --operation-dir /private/commands/original-comparison-0001 \
  --workspace-instance-id CURRENT_ORIGINAL_OWNER_UUID
```

Retry preserves the native operation ID and input. Only the current owner-instance binding may change, and both original and actual attempt are retained. The original native operation still validates its saved request and state. An incomplete package remains incomplete unless its original verifier establishes completion. Start/stop have no generic retry: inspect the actual runtime and choose its original explicit control.

## Stream uploads

Source manifests declare every file's exact path, bytes and SHA256. Source SHA256 is mandatory. Archive intake may omit the outer hash for browser upload; native streaming computes it before receiving verifies the internal source inventory.

The Node helper retains a held file descriptor, hashes the original file and the remote committed prefix, then sends remaining ranges. It checks the original file identity during transfer. MCP chunks are at most 196,608 bytes; browser `File.slice` chunks are at most 8 MiB. Browser resume rechecks retained ranges against the reselected file because WebCrypto does not offer an incremental hash.

```js
import {uploadCloudFile} from 'YOUR_INSTALLED_PACKAGE/customer/cloud/upload';
await uploadCloudFile({
  client, workspace: 'research', workspaceInstanceId: opened.instanceId,
  editionId: originalEditionId, fileId: originalFileId,
  path: '/private/exact-source.parquet',
  expectedBytes: selectedFile.bytes, expectedSha256: selectedFile.sha256
});
```

The native writer verifies the chunk digest, fsyncs accepted bytes, then advances its saved prefix. Recovery verifies that prefix before retiring only an uncommitted tail. Whole-file publication checks the original expected SHA and reconciles its own same-inode stage. Reading an existing request does not allocate another immutable request file per chunk.

CLI `UPLOAD.json` contains `workspace`, `workspaceInstanceId`, `editionId`, `fileId`, absolute local `path`, decimal-string `bytes` and exact `sha256`:

```sh
starforge cloud-remote upload \
  --url "$REVIEWED_MCP_URL" --arguments /private/upload.json \
  --operation-dir /private/commands/source-upload-0001
```

No intake or commit is implicit in upload. The same command verifies original local bytes and the native prefix after a missing reply. A restarted owner can be explicitly supplied with `--workspace-instance-id`; the workspace UUID stays bound.

## Inspect, download and reopen exact native files

Artifacts are `source`, `comparison`, `delivery` or `package`. Source requires its original file ID. Package requires an original allowed artifact such as `plan.json`. Comparison accepts `--kind summary` or `--kind full`, including the complete finding report.

```sh
starforge cloud-remote inspect --url "$REVIEWED_MCP_URL" \
  --workspace research --artifact delivery --id ORIGINAL_DELIVERY_ID \
  --out /private/delivery-selection.json
starforge cloud-remote download --url "$REVIEWED_MCP_URL" \
  --selection /private/delivery-selection.json --out /private/delivery-transfer
starforge cloud-remote reopen --directory /private/delivery-transfer
```

The selection binds the original workspace UUID, artifact identity, size, media type and SHA256. The unchanged original retained-download writer stores a transfer manifest and `payload`, verifies ranges and resumes the same file. It is a client selection, not a new provider receipt.

Only the native `CLOUD_ARTIFACT_READ_NOT_FOUND` outcome allows reopening an expired read descriptor; artifact/hash and exact offset stay unchanged. Local reopen verifies all retained bytes without opening an endpoint.

## Complete receiving and editable draft adoption

First initialize/open the explicit receiving workspace through the same original model. Preserve its new workspace UUID separately from the original delivery UUID.

The receiving argument document contains:

```json
{
  "workspace": "recipient",
  "workspaceInstanceId": "CURRENT_RECEIVING_OWNER_UUID",
  "intakeOperationId": "original-archive-intake-0001",
  "expectedRevision": 0,
  "receiveOperationId": "original-archive-receive-0001"
}
```

Use the actual current Cloud revision rather than the example 0 for existing work.

```sh
starforge cloud-remote receive \
  --url "$REVIEWED_MCP_URL" \
  --directory /private/delivery-transfer \
  --arguments /private/receiving.json \
  --operation-dir /private/commands/original-receiving-0001
```

Receive accepts only a locally verified delivery transfer. It retains the complete selection, invokes original archive intake, streams exact bytes, reads the actual revision, freezes the native receive request, and invokes original receiving. Native mutation records are under `intake/` and `receive/`. If a child reply is missing, the workflow stops at that exact child inspection. Review/retry the child explicitly, then repeat the parent to consume its retained result.

Native receiving validates the source inventory, original edition and comparison requests, typed source inspection and complete report hashes. IDs, reviews and lineage remain retained. Data selection is explicit. When the export includes a merchant package, it carries the original editable draft and its SHA256.

To adopt it:

1. Read `merchant_cloud_received_draft` for the actual receiving ID.
2. Select one of its retained edition IDs and exact relation IDs through `merchant_cloud_select`.
3. Edit query authoring against the selected source's real table/relation identifiers.
4. Save through `merchant_cloud_draft_adopt` with the current draft revision/source SHA, receiving ID and original draft SHA.
5. Review, preview and prepare the edited local draft with original merchant methods.

The browser exposes the same flow. Choosing a received draft requires an explicit save/discard choice for current dirty edits. The original editor then opens the complete plan and authoring choices; its save records the exact original handover/draft provenance. Old seller and payment/runtime identities are not activated.

## Source scope, limits and operating evidence

The native contract supports 2 GiB per source file, 8 GiB total selected source/archive input, 4,096 files, 2 MiB manifests, 1,000,000 inspected rows and 256 columns. Archive expansion/export enforce their native bounds too; a nearly full source selection does not grant additional space for copied package files or metadata. Actual limit errors remain visible.

Daily reference catalog snapshots retain their original versions even when the provider overwrites the catalog. `dt`, declared intervals and original page links remain source fields. Job start times do not establish completion. S3 list pages, Snowflake partitions, API pages and explicit omitted fields remain separate source/coverage evidence. This application requests no requester-pays data and creates no data subscription.

The original operated development source was Community API BTC `ReferenceRateUSD` at 1h frequency: three HTTP 200 pages, 168 observations, and API/CSV comparison with 168 matches and zero differences or duplicate/invalid keys. The first observed row was 2026-10-05T02:00Z despite the selected start at 01:00Z; completed native pagination describes the returned population. Values stay in private custody and retain Community rights. They are not a licensed Cloud sample. The original browser/query/merchant continuation is separate from publication of this new remote product and is not repeated here.

See [API.md](API.md), [README.md](README.md), `types.d.mts` and original `native.py` for exact native fields.
