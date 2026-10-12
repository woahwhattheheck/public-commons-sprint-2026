# Complete API merchant package transfer

The original SF61 workspace can retain a complete saved merchant, deliver every
file through the existing resumable merchant client, and receive the same package
in another private workspace. The receiving package preserves the original
merchant UUID, merchant manifest bytes, source, plan, compiled offers and service,
and any source revision or retained cache policy lineage.

The package remains usable after its sending source directory moves or its SF61
console restarts. A retained export owns the selected immutable bytes under the
workspace's private export directory. Its export ID is the SHA-256 of the complete
file manifest and original package identity.

## Select a complete package

Use the original console, then open its configured workspace with the merchant
MCP tools. The host connection binds the printed console URL to a named workspace
and binds local source files and receiving directories to named handles. See
`stellar-forge/mcp-merchant-operator/OPENAPI_WORKSPACES.md` for the shared connection,
authoring, review, cache policy, and merchant lifecycle.

`merchant_openapi_packages` returns `packages`, `nextCursor`, and `complete`.
Continue with the returned cursor until `complete` is true. Package selection
considers the complete directory inventory; unrelated directories do not consume
the package page. Each row carries the original UUID, source and plan hashes,
merchant manifest hash, title, and route count.

`merchant_openapi_package_inspect` reopens a selected package through the original
SF61 reader and SF82 immutable compiled-source reader. It returns the original
manifest, exact file identities, source revision, and compiled manifest, offer,
and service hashes. An absent package returns HTTP 404; an existing incomplete or
changed package returns an error for that existing package.

## Export and download

1. Inspect the saved package and retain its `manifestSha256`.
2. Call `merchant_openapi_export` with the workspace, saved package name, and
   `expectedPackageManifestSha256`.
3. Retain the returned `exportId` and `manifestFile.sha256`.
4. Download that export with `downloadOpenApiPackage` from
   `stellar-forge/mcp-merchant-operator/openapi-workspace-client.mjs`.
5. Inspect the complete local download, then select its configured delivery handle
   in `merchant_openapi_receive`.

The downloader uses the original `createRetainedDownload` transport with
`nestedFiles: true`. It writes private nested directories, retains the verified
prefix of an interrupted file, and resumes against the same export ID, endpoint,
manifest hash, file hash, and byte offset. `package-export.json` becomes the local
completion manifest after every selected file is complete.

A native call from the current source checkout looks like:

~~~js
import { downloadOpenApiPackage } from
  './stellar-forge/mcp-merchant-operator/openapi-workspace-client.mjs';

const result = await downloadOpenApiPackage({
  url: process.env.MERCHANT_MCP_URL,
  workspace: 'authoring',
  exportId: selectedExportId,
  expectedManifestSha256: selectedManifestSha256,
  directory: '/private/receiving/weather-package',
  tokenEnv: 'MCP_ACCESS_TOKEN',
});
console.log(result);
~~~

Keep the same directory and selection after an interruption. A new invocation
checks the saved prefix and completes the original files. A retained export can
also be found with `merchant_openapi_exports` after a lost export response, even
when the original source package has moved.

## Receive and continue operating

The host connection declares a delivery handle such as:

~~~json
{
  "deliveries": {
    "weather": {
      "directory": "/private/receiving/weather-package"
    }
  }
}
~~~

Call `merchant_openapi_receive` with the receiving workspace, `delivery: "weather"`,
a saved package name, and the exact export manifest hash. The MCP resolves the
directory from this host declaration.

Receiving validates the manifest, every declared file size and hash, the original
merchant inputs, compiled source closure, and original planner syntax. It then
uses the same private staging, destination lease, absence check, and atomic
publication as an ordinary SF61 save. A package becomes selectable only when its
complete bytes have passed the original readers.

Receiving the same export under the same name again returns the exact existing
package with `recovered: true`. A different or incomplete destination remains an
existing name and requires another chosen package name. The receiving response
contains the original UUID and new local release commands.

The original `RUN.md` travels byte for byte. Its historical absolute command
paths describe the original location. Use the receiving response's local commands
or select the received package in the original console to operate it at the new
location.

Backend authentication, OAuth grant identities, TLS references, operation-key
references, prices, and cache policy remain in their original source and plan.
Provision the referenced private connections and environment on the receiving
host. Original `/api/start` and release staging validate the current provider
authorization through the existing host registry.

Use `merchant_openapi_stage` with the saved package and a new release ID to stage
either an initial save or a reviewed revision. It uses the operator's configured
original SF82 release store. Continue through the existing merchant inspect,
compare, activate, and start operations with their original release digests and
selection generation.

## What the complete file set contains

| File | Original authority |
| --- | --- |
| `merchant-package.json` | Original package UUID, input hashes, transformations, and preview |
| `original-openapi.json` or `original-openapi.yaml` | Exact original API description |
| `merchant-plan.json` | Selected operations, atomic payment terms, backend references, and policies |
| `facade-openapi.json`, `selections.json`, `route-bindings.json`, `upstreams.json` | Original prepared public facade and compiler inputs |
| `operator-cases.json`, when present | Original saved operator request examples |
| `source-revision.json`, when present | Original source-review decisions and operating policy lineage |
| `compiled/manifest.json`, `compiled/offers.json`, `compiled/seller-service.json` | Original compiled seller and its immutable hashes |
| `compiled/responses/*.json`, when declared | Original response snapshots selected by the SF82 source reader |
| `RUN.md` | Original saved operational guide |

Original runtime, support, cache-history, operation-ticket, customer-session,
credential-store, and process files belong to their existing operating workflows.
The transfer selects files through the original merchant and compiled manifests.
A receiving package starts with an empty private support directory and builds its
own runtime state when the operator starts it.

The complete source may contain values that were already present in the supplied
API description. Keep the saved package and export private. HAR source retains
its original reviewed capture provenance through the generated API document; HAR
capture and decision packet operations remain in the original HAR workflow.

## Original HTTP operations

All operations run inside the existing SF61 host. They require its exact local
Host and Origin and the original `x-workspace-token`. POST operations participate
in the same mutation and shutdown drain as ordinary authoring.

| Method | Route | Selection / result |
| --- | --- | --- |
| GET | `/api/package-transfer/packages` | `after`, `limit` (1–200); complete package page |
| GET | `/api/package-transfer/inspect` | `name`; original package, revision, and complete file identities |
| POST | `/api/package-transfer/export` | `{name, expectedPackageManifestSha256?}`; retained export |
| GET | `/api/package-transfer/exports` | `after`, `limit`; retained exports independent of current source folders |
| GET | `/api/package-transfer/manifest` | `exportId`; `MANIFEST_RETAINED` and exact manifest metadata |
| GET | `/api/package-transfer/file` | `exportId`, `file`, `expectedManifestSha256`, `expectedSha256`, optional `offset`, `limit`, `readId` |
| POST | `/api/package-transfer/file-release` | `{exportId, readId}`; closes the caller's continuation |
| POST | `/api/package-transfer/receive` | `{directory, name, expectedManifestSha256}`; complete received original package |
| POST | `/api/package-transfer/stage` | `{name, store, id, createStore?, expectedPackageManifestSha256?}`; original SF82 staged release |

The HTTP receiving directory and store are trusted host inputs. MCP tools expose
configured aliases and package/release IDs instead of local paths.

A retained file response has this shape:

~~~js
{
  exportId,
  manifestSha256,
  file: { name, bytes, sha256 },
  readId,
  offset,
  bytesRead,
  encoding: 'base64',
  nextOffset, // null when this file is complete
  data
}
~~~

The same endpoint reads `package-export.json`. For that file both expected hashes
equal the manifest file hash. A chunk contains at most 196,608 bytes. Read IDs are
original scoped snapshot identities. The original reader loads and verifies each
file once, then serves its chunks from that verified snapshot. It releases a
completed read, an explicit release, an idle read, or the host's closing lifecycle.
After a host restart the existing downloader reopens the same file hash at its
verified saved offset. The manifest response includes the original read count and
active snapshot status.

The transfer manifest is at most 65,000 bytes. The complete original file set is
at most 128 MiB, an individual transferred file is at most 32 MiB, and the original
compiler/readers keep their own narrower input and compiled-file limits.

## Source-native receiving journey

`workspace/package-transfer-journey.mjs` runs one complete original workflow using
existing compiled initial and retained-policy packages as its inputs. It starts
the original SF61 consoles and the actual merchant MCP server, authors and
reopens a saved source revision, exports the retained policy package, interrupts
and resumes its nested download across restarts, receives it, starts its original
merchant, checks its native cache policy, and stages the initial and received
packages in the original release store.

~~~sh
node sf61-openapi-seller-import/workspace/package-transfer-journey.mjs \
  /private/journey-output \
  /private/original-projects/weather-original \
  /private/original-projects/weather-retained
~~~

Run from `stellar/scf-starforge-20261009` in the current full source checkout with
the installed original dependencies. Use Node 24 for the original SQLite-backed
cache operating workspace. The journey writes its exact source hashes and native
result to a new private output directory.

The complete eight-stage receiving journey passed on Node v24.19.0 on 12 October
2026. It carried 13 original files (53,668 bytes), recovered the interrupted nested
download after both hosts restarted and the source package moved, received the
same complete merchant, and staged both initial and received packages. The received
runtime returned HTTP 402 and retained its original saved cache policy. The scoped
reader served 47 chunk reads from 12 original file loads after restart.

The original integration outcome is retained in the
[SF61/SF82 delivery thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791771808492539?thread_ts=1791730288.879869).
