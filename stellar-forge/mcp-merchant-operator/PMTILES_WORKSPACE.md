# PMTiles release operations through merchant MCP

The PMTiles merchant provider opens the original saved map workspace and its
browser server. Source capture, native inspection, edition review, publication,
Martin readiness, restoration and complete receiving use that product's original
controller and files.

Use the [PMTiles product guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/README.md)
for native source/runtime setup and the
[portable receiving guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/PORTABLE_HANDOVER.md)
for the complete source/runtime/workspace archive. The
[upstream source bundle](../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/sources/README.md)
retains the native package versions, original archive format, sample and attribution.

## Install the complete operator source

The MCP provider is registered by
`stellar/scf-starforge-20261009/distribution/contributions/pmtiles-merchant-mcp.json`.
It adds the `pmtiles-workspaces` provider, `pmtiles-mcp` command and named PMTiles
exports to the existing merchant distribution.

Build from a committed checkout containing that contribution and the PMTiles
product:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/starforge-checkout --ref ORIGINAL_COMMIT_SHA \
  --out /absolute/pmtiles-merchant-source
~~~

Keep the returned archive path and SHA-256. Prepare its existing runtime with
the native, operator, schema, OpenAPI and MCP selections:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /private/pmtiles-merchant-runtime \
  --archive /absolute/pmtiles-merchant-source/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /private/pmtiles-merchant-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /private/pmtiles-merchant-runtime --load --source
~~~

The maintained installer requires Linux, Node 22.16 or newer, Python 3.11 or
newer, npm and `flock`. It retains the exact selected source, dependency
profile and lock. The native selection supplies Stellar/x402 peers; MCP's
source-owned manifests supply SDK 1.32.1 and their declared dependencies.
Use `install --offline --cache /absolute/original-npm-cache` for an existing
complete package cache, or the maintained `install --adopt-existing` route for
an already received complete dependency tree and lock.

The PMTiles native runtime is a separate original profile. Its pinned PMTiles
and Martin executables, validator/browser bundles, worker and process launcher
are selected by `runtime` in the connection below. Its compatible Linux
Python host contract retains each host's actual interpreter identity.

The full merchant installation includes both repository-root
`stellar-forge/mcp-merchant-operator` source and the SCF product/import closure.
A PMTiles portable operations ZIP declares its own SCF source, native runtime
and frozen workspace. Use the full merchant installation to serve this MCP
provider alongside a received workspace.

The examples use `starforge` from that READY installation. The installed
forwarder is equivalent:

~~~sh
node /absolute/starforge-checkout/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs \
  run --dir /private/pmtiles-merchant-runtime -- merchant-mcp providers inspect pmtiles-workspaces
~~~

## Select the original workspace and sources

First create or select the original PMTiles workspace with its native CLI.
Retain the returned `id`:

~~~sh
node /absolute/starforge-checkout/stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/cli.mjs \
  init --workspace /private/regional-maps --title "Regional map releases"
~~~

Use the original runtime builder/profile from the product guide. The
connection is an owned `0600` UTF-8 JSON file. Workspace, export and receiving
directories are private `0700` directories with canonical paths.

~~~json
{
  "schema": "stellar-forge.pmtiles-workspace-connection.v1",
  "workspaces": {
    "regional": {
      "label": "Regional map releases",
      "directory": "/private/regional-maps",
      "expectedWorkspaceId": "ACTUAL_WORKSPACE_ID",
      "runtime": "/private/pmtiles-native/runtime.json",
      "imports": {
        "archive": {
          "path": "/private/source/region.pmtiles",
          "name": "region.pmtiles",
          "kind": "pmtiles",
          "rights": {
            "license": "ORIGINAL_LICENSE",
            "attribution": "ORIGINAL_REQUIRED_ATTRIBUTION",
            "sourceUrl": "https://original.example/source"
          },
          "expected": {
            "bytes": 716052,
            "sha256": "ACTUAL_COMPLETE_SOURCE_SHA256"
          }
        },
        "style": {
          "path": "/private/source/style.json",
          "name": "style.json",
          "kind": "style",
          "rights": {
            "license": "ORIGINAL_STYLE_LICENSE",
            "attribution": "ORIGINAL_STYLE_ATTRIBUTION",
            "sourceUrl": "https://original.example/style"
          }
        }
      },
      "sf88Objects": {},
      "receivingTargets": {
        "customer": { "directory": "/private/map-receiving" }
      }
    }
  }
}
~~~

Replace the example byte count, digest, identity and rights with the selected
original sources. `imports` and `sf88Objects` are optional host aliases;
`receivingTargets` is optional until receiving. Each receiving root is separate
from the original workspaces and merchant exports. A receiving request creates
its own `REQUEST_ID/installation` and `REQUEST_ID/workspace` beneath that root.

For an already acquired SF88 object, configure a source under `sf88Objects`
with `name`, `kind`, `rights`, `report` and `reportSha256`. The report file
contains the original complete ObjectReport (`record` and its original
`process` when retained), or its original record containing
`mode: "ORIGINAL_PYTHON_OBJECT"`. The provider verifies the selected report's
full SHA-256 and passes it to the original `ObjectReport`/`ObjectDelivery`
classes. Its assembly must have the original recorded receipt and matching
session, snapshot, destination, complete bytes and digest.

Create `/private/pmtiles-setup.json`:

~~~json
{
  "directory": "/private/pmtiles-mcp",
  "connection": "/private/pmtiles-connection.json",
  "name": "Regional map release operator"
}
~~~

Then initialize and serve:

~~~sh
starforge merchant-mcp init-provider pmtiles-workspaces \
  --options /private/pmtiles-setup.json

starforge merchant-mcp serve \
  --config /private/pmtiles-mcp/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

The host supplies its existing bearer token through `MCP_ACCESS_TOKEN`.
Setup retains its exact source selection and resumes original release-store
initialization after interruption. Repeating the same setup reopens its matching
configuration.

## Operate one saved release

Each `pmtiles-mcp call` reads an owned private request JSON. Use the suffix
listed below; the full `merchant_pmtiles_` tool name is also accepted.

~~~sh
starforge pmtiles-mcp call open \
  --url http://127.0.0.1:3211 --request /private/open.json
~~~

`open.json` contains:

~~~json
{ "workspace": "regional" }
~~~

`status` lists aliases, configured source names, saved edition versions,
original operations, current release, runtime identity and retained reads.
`console` returns the original private browser link. Opening that link displays
the same saved workspace. Port `0` retains its authoring origin across ordinary
Stop and Start; a reopened session supplies its new private token fragment.

### Capture and save

Import the host-selected archive and style with distinct stable requests:

~~~json
{
  "workspace": "regional",
  "requestId": "regional-archive-20261012",
  "source": "archive"
}
~~~

Call `import`, then repeat for `style` with its own request ID. `acquire` accepts
an original public HTTPS `url`, `name`, `kind`, `rights`, and optional
`expected`, `maxBytes` or ETag. Its original transport retains the complete
response and original headers. `adopt_object` selects a configured SF88 source
alias.

Read `resources` to select the returned original resource IDs. Save the
complete edition:

~~~json
{
  "workspace": "regional",
  "requestId": "regional-edition-20261012",
  "editionId": "regional-basemap",
  "expectedVersion": 0,
  "edition": {
    "name": "Regional basemap",
    "style": "ACTUAL_STYLE_RESOURCE_ID",
    "archives": [
      {
        "sourceId": "ORIGINAL_STYLE_SOURCE_ID",
        "resourceId": "ACTUAL_ARCHIVE_RESOURCE_ID",
        "type": "raster"
      }
    ],
    "notes": "Original source and selected publication scope"
  }
}
~~~

Call `save`. `sourceId` is the source key in the original MapLibre style; select
the actual `vector`, `raster` or `raster-dem` type. The native model preserves
the original source text and checks archive format compatibility. Later edits
use the latest saved version as `expectedVersion`.

### Inspect, review and prepare

Call `inspect` with:

~~~json
{
  "workspace": "regional",
  "requestId": "regional-inspection-20261012",
  "editionId": "regional-basemap",
  "version": 1
}
~~~

This is the original native archive/style inspection. It retains complete
verifier output, section/range checks, original directory/tile selection,
native bytes, style validation, source/layer decisions and attribution.

Record the actual selected current release in `review`:

~~~json
{
  "workspace": "regional",
  "requestId": "regional-review-20261012",
  "editionId": "regional-basemap",
  "version": 1,
  "inspectionRequestId": "regional-inspection-20261012",
  "expectedCurrentRelease": null,
  "reviewer": "ACTUAL_REVIEWER",
  "note": "Selected original source and layer decisions"
}
~~~

Use `null` for a workspace with no published release. An established workspace
uses its actual current release ID. `prepare` consumes the returned exact
review:

~~~json
{
  "workspace": "regional",
  "requestId": "regional-package-release-20261012",
  "reviewId": "ACTUAL_REVIEW_ID",
  "reviewSha256": "ACTUAL_REVIEW_SHA256"
}
~~~

The resulting immutable release contains the reviewed source files, native
runtime identity and manifest SHA-256.

### Publish and restore

Call `publish` with the prepared `releaseId`, its `manifestSha256`, the original
`expectedCurrentRelease` and a stable request ID. The original controller
drains its previous Martin process, changes the saved pointer under its
original comparison, and starts the selected native release. READY includes
actual health, catalog, TileJSON and a known-present tile.

The result retains publication independently from preview readiness.
If `previewError` is present, inspect the saved release and original runtime,
then use `preview` for that release with its own request ID. The saved
publication remains recoverable.

`restore` accepts the currently selected `fromReleaseId` and its exact
`manifestSha256`. It restores that release's original saved predecessor.
`preview` and `stop_preview` operate the same controller's native process.
Use `console` for the current browser link.

## Complete package download and receiving

`export` creates the original frozen workspace handover.
`package` creates the original portable source/runtime/workspace ZIP.
Both use the host's private exports root and the durable request ID:

~~~json
{
  "workspace": "regional",
  "requestId": "regional-complete-handover-20261012"
}
~~~

After a lost response, repeat `package` with that JSON or use `package_info`.
The original retained package request and complete archive are verified before
the same download descriptor is returned.

The descriptor supplies `exportId`, archive bytes/hash, the original package
manifest hash and `downloadManifestSha256`. Receive the exact package:

~~~sh
starforge pmtiles-mcp inspect-package \
  --url http://127.0.0.1:3211 \
  --export-id regional:regional-complete-handover-20261012

starforge pmtiles-mcp download-package \
  --url http://127.0.0.1:3211 \
  --export-id regional:regional-complete-handover-20261012 \
  --manifest-sha256 ACTUAL_DOWNLOAD_MANIFEST_SHA256 \
  --directory /private/customer-map-package
~~~

The output contains `pmtiles-download.json` and `pmtiles-operations.zip`.
The client binds the endpoint, export ID, complete manifest, file hash and saved
byte prefix. It fsyncs progress and publishes the final file create-only after
the complete hash matches. Repeat the same command and directory after an
interruption. Completed original bytes are reused.

The shared retained MCP reader supports native immutable files up to 8 GiB,
four simultaneous reads and 196,608-byte chunks. It streams a selected open
descriptor with bounded memory and closes it at EOF, explicit release or
inactivity. Resume an expired read with the same digest and byte offset.
The original product's browser/native package route handles its declared
larger archive limits.

A host-selected receiving target can receive the same package directly:

~~~json
{
  "workspace": "regional",
  "requestId": "customer-receiving-20261012",
  "packageRequestId": "regional-complete-handover-20261012",
  "archiveSha256": "ACTUAL_ARCHIVE_SHA256",
  "target": "customer"
}
~~~

Call `receive`. The original receiver verifies the archive, complete source and
runtime file map, frozen workspace and selected release files. It returns the
actual received runtime profile, current workspace and `serveCommand`.
Replaying that request preserves work already saved in the receiving
workspace.

For another receiving host, use the downloaded ZIP with the original installed
PMTiles CLI and this private input:

~~~json
{
  "requestId": "customer-receiving-20261012",
  "archive": "/private/customer-map-package/pmtiles-operations.zip",
  "directory": "/private/received-map-product",
  "workspaceDirectory": "/private/received-map-workspace",
  "pythonExecutable": "/usr/bin/python3",
  "expectedArchiveSha256": "ACTUAL_ARCHIVE_SHA256",
  "expectedWorkspaceId": "ACTUAL_WORKSPACE_ID"
}
~~~

~~~sh
node /absolute/starforge-checkout/stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/cli.mjs \
  receive-package --input /private/map-receiving.json
~~~

Use that host's actual compatible Python path. The original receiver binds its
observed interpreter hash/version while preserving the exact
content-producing runtime identity. Run the returned original `serveCommand`
and reopen the received browser. The full edition history, captures, source
rights, reviews, releases and predecessor chain remain available.

## Recovery and tool catalog

Every saved mutation uses a stable `requestId` and the host-selected original
workspace identity. Changed inputs under a previously used request ID are
rejected by the original owner. Reopen an interrupted request, read the saved
current version or release, and continue its actual retained selection.

`close` waits for this provider's accepted workspace calls, releases retained
file descriptors and closes its original browser/Martin owner. The complete
MCP shutdown stops admission, cancels/drains original native work and waits for
the owned handles. A later `open` reuses the saved authoring origin and data.

| Workflow | Tool suffixes |
| --- | --- |
| Workspace and browser | `status`, `open`, `close`, `console` |
| Original sources | `resources`, `resource`, `resource_file`, `file_release`, `import`, `acquire`, `adopt_object` |
| Immutable editions | `save`, `edition`, `compare` |
| Native review | `inspect`, `request`, `review`, `review_status` |
| Release lifecycle | `prepare`, `release`, `publish`, `restore`, `preview`, `stop_preview` |
| Complete handover | `export`, `package`, `package_info`, `receive` |
| Resumable download | `download_manifest`, `download_file`, `download_file_release` |

The full names have the `merchant_pmtiles_` prefix. Individual record tools
return the original native records; callers can choose their own concise view.
The authenticated CLI accepts responses up to 32 MiB and a configurable
1-second to 1-hour call timeout. Its default native-operation timeout is
10 minutes.
