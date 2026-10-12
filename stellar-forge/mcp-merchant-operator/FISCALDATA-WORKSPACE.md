# Fiscal Data through the Merchant MCP

This adapter operates the original retained Treasury workspace, its industrial browser and its native publisher from the maintained Merchant MCP host. A named operator can capture public Treasury pages, review their meaning, build native CSV editions, compare exact reported values, acquire an original paid delivery and receive a complete source/review checkpoint on another configured host.

The source model, query engine, SF82 release store and SF88 buyer retain their original IDs, revision guards, purchase approval and payment accounting. The adapter supplies declared host bindings, source-workspace recovery and the existing bounded file reader.

## Install and configure

Use the complete Starforge distribution. The package already includes the Fiscal model, browser assets, original publisher and native runtime dependency families. Node22+ and Linux `flock` are required. GNU `tar` is used by the original dataset delivery exporter. Portable workspace packages use native Node gzip streams and do not invoke a shell or extract a tar archive.

Create separate private directories for the active workspace, an empty receiving workspace and the new MCP host. The active and receiving directories must already exist with mode0700. The MCP initializer creates its own new host directory. Keep the connection JSON mode0600.

```json
{
  "schema": "stellar-forge.fiscaldata-workspace-connection.v1",
  "operator": {
    "id": "treasury-analyst-01",
    "label": "Treasury analyst"
  },
  "workspaces": {
    "treasury": {
      "label": "Retained Treasury analysis",
      "directory": "/private/fiscal-data",
      "merchants": {},
      "buyerWorkspaces": {},
      "runtime": {"port": 0}
    },
    "receiving": {
      "label": "Received Treasury analysis",
      "directory": "/private/received-fiscal-data",
      "merchants": {},
      "buyerWorkspaces": {},
      "runtime": {"port": 0}
    }
  }
}
```

```sh
starforge merchant-mcp init-fiscaldata-workspaces \
  --dir /private/fiscal-merchant-host \
  --connection /private/fiscal-connection.json

starforge merchant-mcp serve \
  --config /private/fiscal-merchant-host/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
```

The maintained host accepts either its existing environment bearer token or its OAuth resource configuration. Use the original `merchant-mcp-stdio` and client configuration commands for a stdio client. The adapter does not print or persist the host bearer token.

For an existing Merchant configuration, set `fiscalDataWorkspaceConnection` to the private connection path. The other providers and the existing release store stay composed in that same host.

The operator ID and label identify the person or service account authorized to use this connection. Mutating native actions retain the original ID, timestamp, input and its hash, interface (`mcp` or `browser`), process instance, and observed outcome under `operator-history`. A missing outcome means that the original action's completion still needs to be read from its native source. It does not authorize repeating a purchase or a publication.

### Merchant and buyer bindings

A declared merchant profile contains `label`, `origin`, `path` and the original `payment` object. Copy actual reviewed public terms from the existing merchant configuration. Financial amounts in that object retain their native string representation.

`buyerWorkspaces` maps aliases to `{label,directory}` for existing private SF88 workspaces. These directories already contain their original authority and purchase history. Calls select the alias; arbitrary buyer paths cannot be supplied through an MCP argument.

`runtime` contains `port`, an optional `facilitator`, and optional `allowLocalFacilitator`. An explicitly local facilitator uses `http://127.0.0.1`; otherwise the declared URL uses HTTPS. Release staging applies these original host settings. Browser edits must match the declared merchant/runtime choices.

Optional `limits` passes the original Fiscal model limits unchanged. Optional `imports` maps a package alias to `{label,file,sha256}`. The full expected SHA binds that host file before receiving.

## Capture and review the original source

Start with `merchant_fiscaldata_status {}` and explicitly open an alias with `merchant_fiscaldata_open {workspace:"treasury"}`. Save its returned `instanceId`. Opening takes the original kernel workspace lease; a separate CLI/browser writer must close that same directory first.

A status section is one of `overview`, `catalog`, `sources`, `captures`, `editions`, `comparisons`, `exports` or `packages`. Every paged collection returns `items`, `offset`, `limit`, `total` and `nextOffset`. Follow `nextOffset` until it is null. A small first page is not the whole catalogue.

1. Refresh actual Treasury metadata with `merchant_fiscaldata_catalog`, action `refresh`. Read the retained endpoint list and fields through action `get` or the catalogue status section.
2. Save a source with `merchant_fiscaldata_source`, action `save`, and its native payload: `name, endpoint, filter, sort, pageSize, notes`. Updating an existing source also needs `id` and `expectedRevision`.
3. Probe the original source with action `probe` and `{id,revision}`. Preserve reported labels, formats, sample values and null behavior.
4. Start a capture with `merchant_fiscaldata_capture`, action `start`, payload `{sourceId,sourceRevision,sourceSha256,requestId,name}`. Keep that request ID for the same input after an interrupted response.
5. Read the original capture and its page/attempt histories. Pause or resume by its saved capture ID. Resume continues the original page records and performs the original source-anchor check.

For example, the public Debt to the Penny endpoint can be selected from the actual catalogue. A source filter can use `record_date:gte:2026-10-01,record_date:lte:2026-10-08`, ordered by `record_date`, with pageSize2 for an explicitly paged review. The provider remains the authority for returned dates and rows.

Create an edition using `merchant_fiscaldata_edition`, action `create`, with `{captureId,captureSha256,name,requestId}`. Action `get` exposes every original source field, including fields excluded by an earlier review. DRAFT rows remain readable while the review is edited.

Save action `review` with the native `id,expectedRevision,fields,keyFields,notes` plus optional native filter/range/sort/limit settings. A reviewed field has:

| Field | Meaning |
| --- | --- |
| `source` | Exact provider field name |
| `name` | Selected output field name |
| `label` | Display label |
| `role` | `identifier`, `dimension`, `date` or `measure` |
| `unit` | Actual interpreted unit |
| `scale` | Exact decimal string |
| `notes` | Source meaning and interpretation |
| `nullToken` | Original selected missing-value marker or null |

Preserve textual identifiers and leading zeroes. An integer-looking source field is not automatically a financial measure. Review `src_line_nbr` as an identifier when that is its reported meaning.

Build the native edition with action `build`, payload `{id,expectedRevision,requestId}`. Original prior reviews remain retained. Exclude/reinclude changes use the current revision and original source-field roster.

The native query tool accepts `{workspace,id,query}`. It uses the edition's existing query grammar, filters, projection and paging contract.

## Compare exact financial observations

`merchant_fiscaldata_comparison` forwards `create` and `get` to the original exact-decimal comparison. Creation selects original left/right edition IDs, key fields, measure fields, name and requestId. Read results with `offset`, `limit` and optional `changesOnly` in the native payload.

Keep all monetary and scale values as strings. The model reports source unit/scale, participating rows, exact left/right sums and deltas, plus date-ordered first/last observations and changes. A reviewed numeric null marker is excluded from the arithmetic while remaining unchanged in rows and deliveries.

Debt observations are stocks. A sum over selected daily rows is a row aggregate, not a Treasury period total. The dated first/last stock values and their change carry a different meaning. Preserve the model's interpretation notes when presenting either result.

## Use the original publisher and buyer

`merchant_fiscaldata_merchant` takes `editionId`, a declared `profile`, and `requestId`. The original merchant export retains its exact dataset CSV, contract, seller terms, source metadata, all raw sourceFiles and prior review bytes.

Use `merchant_fiscaldata_publisher` with the original action and payload:

| Operation | Original selection |
| --- | --- |
| `publisher.prepare` | `exportId` from this Fiscal workspace |
| `publisher.preview` | Original draft/snapshot target and query |
| `publisher.reviewDraft`, `publisher.publish` | Draft ID plus expected snapshot/revision |
| `publisher.activateSnapshot` | Snapshot plus expected snapshot/revision |
| `publisher.release.stage` | Draft ID, release ID, label; runtime is host-bound |
| `publisher.release.inspect/activate/rollback/start/stop` | Original release ID or exact generation |
| `publisher.buyer.review` | Snapshot and query |
| `publisher.buyer.prepare` | Original reviewed offer, intent ID, selected accept index and offer SHA |
| `publisher.buyer.session` | Buyer ID, declared `workspaceId`, maxPages and maxTotalAtomic, optional row/page-byte limits |
| `publisher.buyer.run/recover/account/export` | Original session ID |

Inspect the native state after an uncertain reply. The original SF88 approval, paid request, cursor, settlement accounting and interrupted-operation rules remain authoritative. The adapter does not synthesize offers, payments or acquired rows.

After `publisher.buyer.export`, the original model retains a complete acquisition export containing the native SF100 delivery. Download its original archive through the ordinary file reader. An acquisition manifest alone is not the acquired dataset.

## Share the same browser

`merchant_fiscaldata_browser {workspace:"treasury",action:"open",port:0}` opens the original grayscale operator UI on loopback. It borrows this exact model; it does not try to acquire a second workspace lock.

Browser changes run through the same alias queue and original revision guards. The original HTTP Host/Origin checks, capability cookie and CSRF action token remain active. Browser writes retain the same declared operator identity, marked as browser actions.

Closing the browser leaves the native model available to MCP. Closing the exact model instance drains accepted operations, closes its browser and retained read snapshots, then releases the original lease.

Checkpoint, browser close and workspace close reserve the alias before their first asynchronous drain. Calls already admitted to the native queue finish; new queued actions and browser opens receive `FISCALDATA_WORKSPACE_DRAINING` until that transition finishes. Status exposes the original lifecycle and start time. Receiving reserves a closed destination alias before opening its package, so another open or receive cannot race that same destination.

## Checkpoint and receive the source/review workspace

`merchant_fiscaldata_checkpoint` takes the original alias and a stable `operationId`. It first drains the owned browser, stops the original capture worker at its retained page checkpoint, closes the model, and acquires the same kernel lease for a stable source inventory. It then reopens the source model. Unfinished captures are paused; resume the actual capture explicitly when ready.

The immutable package contains:

- Original workspace identity and metadata.
- Every retained catalogue, source revision and probe, capture request/response/receipt and partial-response history.
- Original field reviews, native CSV/query data, sealed builds and comparison files.
- Complete capture/edition/comparison/merchant/acquisition deliveries.
- Retained source-copy recovery files, prior receiving originals and operator history.

The package is a gzip stream of bounded JSON records. Its manifest identifies each original path, exact size and SHA-256; each file is streamed in ordered 48KiB chunks. Receiving verifies the whole compressed digest and every decoded file before publication. Capacity is20,000 files,512MiB original source bytes,256MiB per original file and256,000,000 compressed bytes.

Private publisher process controls, browser sessions, buyer credentials and external buyer directories are host authority. Rebind them through the original configured publisher/buyer on the receiving host. Merchant export and acquired-delivery bytes remain in the portable source history, with their original lineage.

To receive a package produced in this host:

```json
{
  "workspace": "receiving",
  "sourceWorkspace": "treasury",
  "packageId": "FULL_PACKAGE_ID_FROM_CHECKPOINT",
  "expectedSha256": "SHA256_OF_WORKSPACE_FISCAL_GZ",
  "operationId": "receive-treasury-20261012"
}
```

Pass that payload to `merchant_fiscaldata_restore`. The receiving alias must be CLOSED and its directory empty. For a transferred package, select a host-pinned `sourceImport` instead of `sourceWorkspace/packageId`.

Receiving preserves every original record in the package. A capture with unfinished RUNNING intent receives an explicit PAUSED local revision; its exact pre-receiving record is retained under the receiving lineage. The workspace header is published last, after complete source files and the immutable receiving receipt. A process interruption reuses the same receiving operation, manifest and staging records. A completed same-operation retry returns its original receipt.

Each new intent, manifest, promotion list, receipt and seal is first written completely to a private attempt file and synced under the original kernel lease. Only then is its selected metadata name published atomically. Interrupted attempt files remain retained, completed metadata stays immutable, and retries reuse the committed original intent and its creation time.

Open the receiving alias, inspect the original editions and comparisons, query the saved CSV, and read its source/receiving history. Resume only the original captures chosen for additional public observations.

### Native CLI continuation

The same engine is exposed through the existing Fiscal CLI:

```sh
starforge fiscaldata checkpoint --dir /private/fiscal-data \
  --out /private/source-packages --operation checkpoint-20261012 \
  --operator /private/operator.json

starforge fiscaldata package-inspect \
  --package /private/workspace.fiscal.gz --sha256 REVIEWED_SHA256

starforge fiscaldata receive --dir /private/received-fiscal-data \
  --package /private/workspace.fiscal.gz --sha256 REVIEWED_SHA256 \
  --operation receive-20261012 --operator /private/operator.json
```

`operator.json` contains the actual `{id,label}`. Close another writer before invoking the CLI against that same directory.

## Complete file receiving

Use `merchant_fiscaldata_file` with an original `kind,id,filename`. Kinds are `capture`, `edition`, `comparison`, `export`, `publisher` and `package`. A package ID is the checkpoint's full 64-character identity; choose `workspace.fiscal.gz` or `manifest.json`.

The maintained retained reader returns `readId,file,offset,bytesRead,nextOffset,encoding,data`. Decode base64 bytes exactly, append at the returned offset, and carry the original file SHA for each continuation. Stop when `nextOffset` is null, then verify the complete size and SHA. Do not treat a single bounded chunk as the complete artifact.

The reader owns up to four retained file snapshots with a256,000,000-byte combined bound. Read completion releases its snapshot. Use `merchant_fiscaldata_file_release` to abandon a retained read explicitly; reopening a file by its original SHA and offset follows the maintained reader's semantics.

## Original source contracts

- [Treasury Fiscal Data API documentation](https://fiscaldata.treasury.gov/api-documentation/) defines source filters, fields, formats and pagination.
- [Fiscal workspace domain](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/DOMAIN.md) defines the original retained action and exact-decimal contracts.
- [Fiscal operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/README.md) covers the native source/browser workflow.
- [Original publishing guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/PUBLISHING.md) covers the common SF82 release and SF88 buyer path.
- [Merchant MCP host](README.md) covers the maintained authenticated HTTP/stdio transport and installed commands.
