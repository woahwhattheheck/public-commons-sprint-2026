# STAC customer and agent workspace

Use the existing STAC analyst host from Node, the `starforge stac-workspace`
command, or the original merchant MCP server. All three clients use the same
saved imagery editions, native source pages, item identities, analyst decisions,
asset reviews and processing histories.

The original [STAC workspace](../../stellar/scf-starforge-20261009/sf30-seller-sdk/stac/README.md)
owns catalog discovery, provider requests, page continuation, asset acquisition
and portable receiving. The client attaches to that host through its original
session bootstrap, cookie and CSRF contract. It does not create another imagery
store, processing engine, buyer session or host process.

## Prescient customer access

The same client also exposes the complete original Prescient profile, review,
approval, explicit SDK session and portable customer receiving lifecycle.
[Prescient client operations](./PRESCIENT.md) documents host delivery aliases,
the independent configuration revision, retained commands, Node/CLI/MCP access,
and original operation reconciliation after a lost response.

## Attach the running original host

Use Node 22 or newer. Keep the original host's startup output in a private file.
The native `serve` command prints one JSON record containing `url` and
`workspaceId`. The URL fragment grants access to that local process.

```sh
umask 077
starforge stac serve \
  --directory /private/imagery \
  --processing-workspace /private/processing \
  --processing-config /private/processing-config.json \
  > /private/stac-host.json
```

Omit the two processing flags for imagery alone. The original host remains
running in its terminal. The clients bind to the original loopback address and
workspace ID; they do not start, stop or replace this process.

In another terminal, create the client connection:

```sh
starforge stac-workspace connection-init \
  --out /private/stac-connection.json \
  --console-url-file /private/stac-host.json \
  --workspace imagery

starforge stac-workspace status --connection /private/stac-connection.json
```

The output file must be new and its parent directory must already be private
(mode 0700). Connection files and original startup records require mode 0600
and the current host user. Use `--workspace-id` when the selected private file
contains a plain native URL rather than its complete JSON startup record.

A complete connection can contain several independently owned hosts:

```json
{
  "schema": "stellar-forge.stac-workspace-connection.v1",
  "workspaces": {
    "imagery": {
      "label": "Current imagery review",
      "consoleUrlFile": "./stac-host.json",
      "timeoutMs": 60000,
      "maxResponseBytes": 134217728,
      "inputs": {
        "received-scenes": {
          "path": "./incoming/stac-workspace-handover.json",
          "kind": "imagery-handover"
        },
        "received-processing": {
          "path": "./incoming/processing-handover.json",
          "kind": "processing-handover"
        }
      },
      "processingProfiles": {}
    }
  }
}
```

Relative host paths resolve beside the connection JSON. An input can also pin
its original `sha256`. The permitted input kinds are `imagery-handover`,
`processing-handover`, `processing-source` and `processing-page`.

A host can select `consoleUrlEnv` instead of `consoleUrlFile`. That names one
host environment variable containing the original JSON startup record or URL.
A plain URL also requires the expected `workspaceId`. Agent tool arguments
never contain the private URL, cookie, CSRF token, credential variable value or
input filesystem path.

After the original host restarts, replace its private startup file with the new
native record. The next client request rereads that file, establishes the new
session and verifies the same saved workspace ID. A different workspace is a
specific identity error before a workspace action is dispatched.

## Review and acquire imagery

Start from `status`, which returns the original revision, saved collection
counts and enabled processing capabilities.

```sh
starforge stac-workspace records --connection /private/stac-connection.json \
  --kind collections --offset 0 --limit 50

starforge stac-workspace records --connection /private/stac-connection.json \
  --kind editions --offset 0 --limit 50
```

For another page, pass the returned `nextOffset` and original `revision`.
A changed revision asks you to restart that view, so concurrent edits cannot
silently shift records between pages. Continue until `nextOffset` is null.
Complete JSON is also available through `download --kind state`.

If catalog discovery is needed, use the original operation with the current
revision:

```sh
starforge stac-workspace discover --connection /private/stac-connection.json \
  --operation-id analyst-catalog-20261012 --revision CURRENT_REVISION \
  --wait-ms 60000
```

Prepare a native query JSON file. The following is a spatial/date selection;
the original discovered catalog determines whether its collection and query
extension are available.

```json
{
  "name": "Austin September review",
  "collections": ["sentinel-2-l2a"],
  "bbox": [-98.0, 30.0, -97.5, 30.5],
  "datetime": "2026-09-01T00:00:00Z/2026-09-30T23:59:59Z",
  "cloudCoverMax": 20,
  "pageSize": 100,
  "maxPages": 20
}
```

Exactly one of `bbox` and GeoJSON `intersects` is required. The native query
validator keeps STAC coordinate/date rules, including antimeridian bounds.
`maxPages` is the original acquisition budget. To update a saved query, include
its existing `id`; an existing saved review remains bound to the earlier exact
query values and catalog sources.

```sh
starforge stac-workspace query-save --connection /private/stac-connection.json \
  --query-file /private/query.json --revision CURRENT_REVISION

starforge stac-workspace search-review --connection /private/stac-connection.json \
  --query-id SAVED_QUERY_ID
```

Read the returned review, including the original request, query digest,
collection contracts and page budget. Then choose the original acquisition:

```sh
starforge stac-workspace search-acquire --connection /private/stac-connection.json \
  --review-id SAVED_REVIEW_ID --operation-id analyst-capture-20261012 \
  --wait-ms 60000

starforge stac-workspace operation --connection /private/stac-connection.json \
  --operation-id analyst-capture-20261012
```

The host returns a recent job while the original workspace records the saved
edition and native page progress. Native operations retain their source
identities and outcomes. Inspect the same ID after a connection failure.
No client method automatically retries a mutation.

A client wait timeout or interruption stops waiting; it does not cancel the
original provider operation. Use `search-cancel --edition-id ID` to request
native cancellation. Use `search-resume --edition-id ID --operation-id ID`
for the explicit original continuation. A resume keeps the same edition and
captured pages. After a host restart, its recent in-memory job list can be empty;
`operation` also reads the durable original workspace operation record.

## Inspect scenes, comparisons, decisions and assets

`edition` returns the native edition, coverage and a digest of its complete
item/decision/asset view. `items` returns full original STAC features, not reduced
geometry or rewritten source attributes:

```sh
starforge stac-workspace edition --connection /private/stac-connection.json \
  --edition-id SAVED_EDITION_ID

starforge stac-workspace items --connection /private/stac-connection.json \
  --edition-id SAVED_EDITION_ID --offset 0 --limit 25

starforge stac-workspace item --connection /private/stac-connection.json \
  --edition-id SAVED_EDITION_ID --item-id COLLECTION_QUALIFIED_ITEM_ID
```

Continue item pages with the returned `viewSha256` as `--view-sha`.
An active edition adding pages or changed analyst metadata produces a changed
view digest. Item IDs use the original percent-encoded collection and item ID,
joined by `/`; use the exact `itemId` returned by the client.

Compare two retained editions through the original comparison engine:

```sh
starforge stac-workspace compare --connection /private/stac-connection.json \
  --left-edition-id BASELINE_ID --right-edition-id CURRENT_ID \
  --kind changed --offset 0 --limit 25
```

The result preserves both coverage descriptions, `comparableQuery`, counts for
all four categories, and the original added/removed/changed/unchanged rows.
Page each category with the same view digest. Download the complete comparison
JSON when passing the analysis to another application.

A decision file contains `editionId`, `itemId`, `status`, `actor`,
`note`, `assetKeys` and the current `expectedRevision`. Status is one of
`SELECTED`, `REJECTED` or `REVIEW`. Native validation keeps the item and
selected asset keys attached to the same edition.

```sh
starforge stac-workspace decision-save --connection /private/stac-connection.json \
  --args-file /private/decision.json

starforge stac-workspace asset-review --connection /private/stac-connection.json \
  --edition-id SAVED_EDITION_ID --item-id COLLECTION_QUALIFIED_ITEM_ID \
  --asset-key thumbnail --max-bytes 1048576

starforge stac-workspace asset-acquire --connection /private/stac-connection.json \
  --review-id SAVED_ASSET_REVIEW_ID --operation-id analyst-thumbnail-20261012 \
  --wait-ms 60000

starforge stac-workspace download --connection /private/stac-connection.json \
  --kind asset --asset-id SAVED_ASSET_ID --out /private/received-thumbnail.jpg
```

The original provider controls asset eligibility and the reviewed maximum
bytes. Asset downloads stream to a private temporary file and hash the complete
body before publication, so native assets up to 2 GiB do not require a whole-file
memory buffer. Set the host connection timeout to cover the expected transfer. Completed asset downloads verify original byte length and SHA256.
The client publishes a complete file atomically without replacing an existing
file. A final directory-sync error includes the published filename and digest;
read that actual destination before choosing a continuation.

## Cirrus processing on the same workspace

Processing status comes from the original configured controller. Its capability
list declares the enabled read/action names; unavailable capabilities are
specific native errors.

```sh
starforge stac-workspace processing-status \
  --connection /private/stac-connection.json

starforge stac-workspace processing-read --connection /private/stac-connection.json \
  --name runs --query-file /private/processing-edition-query.json \
  --path runs --offset 0 --limit 25
```

Here `processing-edition-query.json` contains the native `editionId`.
Other original reads include `inventory`, `statistics`, `edition`,
`run` and `associations`. Use the original read's required query fields.
For a large nested array, `--path` selects its own-property path; successive
pages use the returned view digest. Full processing views can be downloaded
as JSON.

Use `processing-action` for the original `discover`, `prepare-inventory`,
`review`, `prepare-capture`, `capture`, `resume`, `cancel`,
`prepare-continuation`, `continue-page`, `associate` and
`export-handover` actions supported by that host. The input JSON uses the
original controller contract. Saved review IDs, edition IDs, task IDs and
expected capture digests pass through unchanged.

```sh
starforge stac-workspace processing-action --connection /private/stac-connection.json \
  --name export-handover --input-file /private/processing-export.json \
  --operation-id analyst-processing-export-20261012 --wait-ms 60000

starforge stac-workspace download --connection /private/stac-connection.json \
  --kind processing-handover --export-id analyst-processing-export-20261012 \
  --out /private/processing-handover.json
```

The export input contains the native `editionIds` and
`includeStacAssets` selection. Processing handover bytes, filename, manifest,
byte count and SHA256 come from the original portable exporter.

Host configuration and full source files have explicit input aliases.
A `processingProfiles` entry contains the unchanged native `deployment`,
a declared `processing-source` `sourceInput`, optional `sourceMetadata`
and a label. The host user supplies those values, including any original auth
environment-variable selection. Agents choose the profile alias, reviewed
source SHA256, current processing revision and stable operation ID:

```sh
starforge stac-workspace processing-configure --connection /private/stac-connection.json \
  --profile DEPLOYMENT_ALIAS --sha256 SOURCE_SHA256 --revision CURRENT_REVISION \
  --operation-id analyst-processing-config-20261012
```

Provider-specific session/S3 adapters stay with the original host. This client
does not interpret their credentials or replace their SDK.

## Complete handover, import and reopen

Download the original imagery handover with its complete captured source files,
editions, item review inputs, decisions and optional saved assets:

```sh
starforge stac-workspace download --connection /private/stac-connection.json \
  --kind handover --edition-ids BASELINE_ID,CURRENT_ID --include-assets true \
  --out /private/stac-workspace-handover.json
```

Create a receiving workspace through the original `stac` commands, run its
original host, and add that host as another alias. Declare the received handover
as an input, inspect it, and import the exact reviewed bytes:

```sh
starforge stac-workspace input-inspect --connection /private/stac-connection.json \
  --workspace received --input received-scenes

starforge stac-workspace input-import --connection /private/stac-connection.json \
  --workspace received --input received-scenes --sha256 REVIEWED_SHA256
```

The native imagery importer verifies its canonical handover digest, every file's
size and SHA256, endpoint compatibility and saved record identities. Reimporting
the same exact handover returns its original import receipt. A conflicting saved
edition or file remains a native conflict.

Processing handover imports additionally require `--operation-id`.
A declared `processing-page` input requires its existing `--edition-id`,
`--task-id` and original metadata JSON; the native importer determines whether
that page can complete the retained task. These operations use the complete
original bytes rather than a truncated tool response.

Reopen the receiving host and inspect the same editions, runs, decisions and
asset digests. Restarting the client does not repeat capture or import.

## Node API and merchant MCP

Installed Node import:

```js
import {
  StacWorkspaceClient,
  nativeStacItemId,
  saveStacFile
} from '@tokenjunkielabs/starforge-merchant/buyer/stac/workspace-client';

const client = new StacWorkspaceClient({
  consoleUrlFile: '/private/stac-host.json'
});
try {
  const { workspace } = await client.state();
  const edition = workspace.editions[0];
  const view = await client.edition(edition.id);
  const firstItemId = nativeStacItemId(view.items[0]);
  console.log({ workspaceId: workspace.id, editionId: edition.id, firstItemId });
  await saveStacFile(client, {
    kind: 'report', editionId: edition.id, format: 'csv'
  }, '/private/imagery-review.csv');
} finally {
  client.close();
}
```

The public declaration file describes native query, edition, item, job,
comparison, decision, file and connection contracts. `client.file()` returns
complete original file bytes and their digest. `client.wait()` polls one native
job with cancellation and a timeout; it never dispatches another acquisition.

Initialize the existing merchant MCP server against the same connection:

```sh
starforge merchant-mcp init-stac-workspaces \
  --dir /private/stac-mcp \
  --connection /private/stac-connection.json

starforge merchant-mcp-stdio --config /private/stac-mcp/merchant-mcp.json
```

An existing merchant configuration can add
`"stacWorkspaceConnection": "/private/stac-connection.json"`.
The original operator tool inventory then includes `merchant_stac_*`.
No additional server or source namespace is required.

| Purpose | Original agent tools |
| --- | --- |
| Connection and saved state | `workspaces`, `status`, `records`, `record`, `operation` |
| Imagery review and capture | `discover`, `query_save`, `search_review`, `search_acquire`, `search_resume`, `search_cancel` |
| Scene and asset work | `edition`, `items`, `item`, `compare`, `asset_review`, `asset_acquire`, `decision_save` |
| Source receiving | `inputs`, `input_inspect`, `input_import` |
| Processing | `processing_status`, `processing_read`, `processing_configure`, `processing_action` |
| Complete files | `file_read`, `asset_range`, `file_release`, `disconnect` |

Every table name uses the `merchant_stac_` prefix. Tool descriptions and
schemas contain the exact original field selections.

`file_read` uses the maintained `RetainedFileReads` implementation. Its first
response returns the original file metadata, digest, `readId` and first base64
chunk. Continue with the same file selection, `readId`, `expectedSha256` and
`nextOffset`. A read snapshots the original export once, so later chunks do
not regenerate a handover. Chunks are at most 196,608 bytes, and the last chunk
automatically releases the snapshot. Use `file_release` when stopping early.
The existing retained reader permits four snapshots totaling 256,000,000 bytes,
with a two-minute idle lifetime.

For large original assets, `merchant_stac_asset_range` reads up to 196,608
bytes directly from the native range endpoint. Each response includes the full
asset SHA256/byte length and the chunk SHA256. Pass the full original
`expectedSha256` on every range after the first and verify the full digest after
assembling all chunks. This uses no retained whole-file snapshot or new asset
store. The CLI `download --kind asset` performs streaming and complete-digest
verification automatically.

Buffered JSON response/download limits default to 128 MiB and can be explicitly configured
up to 512 MiB. The original host separately reports its request byte limit; the
client checks it before transmitting complete imports. For an imagery handover
larger than the native HTTP/retained-reader limit, use the original STAC edition
directory or portable receiving command described in the native guide. Its
source files and validation remain the same.

The source-owned distribution registration is
`stac-workspace-agent`. Inspect it with
`starforge registrations --source stac-workspace-agent`; the builder includes
the original client, CLI, types, guide and MCP implementation in the cumulative
merchant package.
