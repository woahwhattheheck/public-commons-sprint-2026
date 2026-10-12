# Request collections through the native MCP buyer

An agent can operate the same request collections that an operator opens in the private collection browser. The workflow uses the original SF88 request files, inbox, browser-run controller, payment approval panel and saved customer responses. The installed command is `starforge mcp-native`; the existing MCP tool is `sf43_discover_review_and_pay` with `action: "collections"`.

A collection preserves the complete original source review. Spending totals remain strings in atomic units, grouped by network, asset, recipient, scheme and payment flow. The browser, agent and terminal inspect the same retained intent IDs. An interrupted conversation can reopen the original run and finish receiving the original output.

## Connect the existing operator installation

Use the original native buyer workspace described in [NATIVE_WORKSPACE.md](NATIVE_WORKSPACE.md). The collection host may use its existing inbox or another explicitly selected original inbox. Start the maintained collection browser with its real structured announcement retained in a private file:

```sh
umask 077
starforge buyer-collections-workspace \
  --directory /PRIVATE/customer-collections \
  --queue-root /PRIVATE/original-inbox \
  --approval-mode browser --startup-format json \
  > /PRIVATE/collection-launch.json
```

Open the URL from that original announcement in the operator's browser. Keep the listener running while the agent operates requests. On a later host start, write its new announcement to the same private file. The MCP adapter reads that file again and checks the selected store, inbox and approval mode against the live listener.

The installed Applications entry can supply its original `application-url.json` instead. It contains the structured `original` collection selection and private URL saved by the managed operation. A stable private copy of that actual file can be the connection reference when subsequent managed starts produce a new operation directory.

Create a private host registration using actual request files and existing buyer directories:

```json
{
  "name": "monthly",
  "connectionFile": "/PRIVATE/collection-launch.json",
  "sources": {
    "reference": "/PRIVATE/requests/reference.json",
    "report": "/PRIVATE/requests/report.json"
  },
  "buyers": {
    "primary": "/PRIVATE/buyer-reference",
    "reports": "/PRIVATE/buyer-reports"
  }
}
```

Register it through the existing native buyer:

```sh
starforge mcp-native collections-register \
  --dir /PRIVATE/native-mcp \
  --description /PRIVATE/collection-registration.json
```

Registration verifies the original live listener, private store record and inbox. It pins each selected request file and buyer manifest/configuration. Repeating an unchanged registration reuses it. To introduce a changed configuration, register a new explicit alias after reviewing the new host files. When `buyers` is omitted, the native MCP workspace's existing buyer is available as `primary`; an explicit empty object selects no default buyer.

The registration stores the connection file reference. The private listener capability stays in that original file. Agent calls use source and buyer aliases. The existing MCP bearer or OAuth setup continues to govern access to the native buyer tool.

## Review, create and operate a collection

All calls use the same tool. For example:

```json
{
  "action": "collections",
  "collectionWorkspace": "monthly",
  "collectionOperation": "preview",
  "collectionRequest": {
    "sources": ["reference", "report"],
    "limit": 25
  }
}
```

The response has `schema`, `workspace`, `operation` and `value`. The original preview supplies `reviewId`, `previewSha256`, exact grouped totals and paged request descriptions. Host-only paths and configured header values are omitted from the summary; original files retain the complete bytes.

Use those returned values to create the reviewed collection:

```json
{
  "action": "collections",
  "collectionWorkspace": "monthly",
  "collectionOperation": "create",
  "collectionRequest": {
    "id": "monthly-customer-handoff",
    "name": "Monthly customer handoff",
    "reviewId": "RETURNED_32_HEX_REVIEW_ID",
    "expectedPreviewSha256": "RETURNED_PREVIEW_SHA256"
  }
}
```

Keep that stable collection ID after a lost reply. A repeated completed create checks the existing original name and preview hash and returns the same collection. The browser review has its original 15-minute lifetime. If preparation was interrupted and the browser was restarted, preview the same registered sources again, then continue with the returned review and the same collection ID.

The created or inspected collection supplies `manifestSha256`. Pass it as `expectedManifestSha256` for enqueue, execution, cancellation, recovery and export.

| Operation | Required selection | Result |
|---|---|---|
| `workspaces` | No workspace required | Registered collection aliases, approval modes and source/buyer counts |
| `sources` / `buyers` | Workspace alias | Exact source hashes or original buyer aliases and terms |
| `collections` | Workspace alias | Original collections and grouped spending totals |
| `review` | Review ID and preview hash | Another page from the same retained original preview |
| `inspect` | Collection ID | Request states, saved response hashes and original run history |
| `enqueue` | Collection ID and manifest hash | Original intents queued or adopted from the same inbox |
| `cancel` / `recover` | Collection ID, manifest hash and intent IDs | Original inbox cancellation or outcome recovery |
| `run` | Collection ID, manifest hash, intent IDs and stable request UUID | Original native browser-run record |
| `run-status` | Original request UUID; omit for latest | Exact retained run, including after a host restart |
| `pause` | Original request UUID | Pause requested, pending approvals revoked and native drain underway |
| `approval` | Original request UUID and intent ID | The active original payment review |
| `export` | Collection ID, manifest hash and stable 32-hex export ID | Complete original five-file export |
| `export-status` | Same export selection | Saved file identities, including while the browser is stopped |
| `export-file` | Same export selection, filename and exact file hash | Original saved bytes in verified ranges |
| `response-file` | Collection ID, manifest hash, intent ID and saved response hash | Original customer response |

Lists accept `offset` and `limit` (1–100). Collection inspection independently pages request items with those fields and run history with `runOffset` / `runLimit`. Follow the returned next offsets; complete records also travel in the export.

### Run with the original buyer

The request ID is a UUID chosen once for the selected native operation. Reuse it after an interrupted request. An explicit later operation uses another UUID.

```json
{
  "action": "collections",
  "collectionWorkspace": "monthly",
  "collectionOperation": "run",
  "collectionRequest": {
    "id": "monthly-customer-handoff",
    "expectedManifestSha256": "RETURNED_COLLECTION_MANIFEST_SHA256",
    "intentIds": ["reference-request", "report-request"],
    "requestId": "ORIGINAL_REQUEST_UUID",
    "workspaceByIntent": {
      "reference-request": "primary",
      "report-request": "reports"
    }
  }
}
```

Use either one `workspace` alias or a nonempty `workspaceByIntent` mapping. If neither is supplied and a `primary` buyer is registered, it is the default. The original runner checks every selected intent and retains the resolved workspace mapping before dispatch.

Follow `run-status` with that same UUID. When a request reaches payment review, the operator uses the existing collection browser's approval panel. The `approval` operation exposes the active original review and its state. Approval remains attached to the exact active run and intent.

`pause` initiates the original shutdown of remaining work. Follow `run-status` through `PAUSING` until the original run reaches its recorded terminal state. Inspect the collection afterward; use native recovery for an interrupted queue outcome. A new explicit run UUID can continue remaining reviewed requests.

## Retain and receive the complete output

Choose one 32-character lowercase hexadecimal `exportId`, then call `export` with the collection ID and manifest hash. Reusing that export ID returns its original snapshot even if the browser restarted or the first reply was lost. Use a new export ID when deliberately capturing a later snapshot.

The five original files are:

- `collection.json`: retained collection and source bindings.
- `results.json`: complete original queue outcomes, recovery records and run history.
- `requests.csv`: request, spending and delivery details.
- `review.html`: the original readable handoff.
- `manifest.json`: original file lengths and hashes.

`export-status` reads the saved manifest directly from the registered store. Each file read requires its exact returned hash. The original collection manifest hash and the export's `manifest.json` file hash identify different records; keep both.

For complete customer receiving, use the installed client:

```sh
starforge mcp-collections-download inspect \
  --url http://127.0.0.1:3210/mcp --workspace monthly \
  --id monthly-customer-handoff \
  --collection-sha256 COLLECTION_MANIFEST_SHA256 \
  --export-id ORIGINAL_EXPORT_HEX32
```

The client uses `MCP_ACCESS_TOKEN` by default. `--token-env NAME` selects another host-owned bearer-token environment variable. Use the returned export manifest SHA in the download:

```sh
starforge mcp-collections-download download \
  --url http://127.0.0.1:3210/mcp --workspace monthly \
  --id monthly-customer-handoff \
  --collection-sha256 COLLECTION_MANIFEST_SHA256 \
  --export-id ORIGINAL_EXPORT_HEX32 \
  --manifest-sha256 EXPORT_MANIFEST_FILE_SHA256 \
  --dir /PRIVATE/received-monthly-handoff
```

This uses the maintained retained-download engine: one original download directory, Linux file lease, exact manifest, verified partial-file checkpoints, full-file hashes and create-only publication. Repeating the same command resumes that directory. The native saved-file reader supplies ranges of at most 65,536 bytes. The client reassembles original bytes without decoding or reformatting JSON, CSV or HTML.

After completion, the receiving computer can reopen all five files while both source services are stopped:

```sh
starforge mcp-collections-download reopen \
  --workspace monthly --id monthly-customer-handoff \
  --collection-sha256 COLLECTION_MANIFEST_SHA256 \
  --export-id ORIGINAL_EXPORT_HEX32 \
  --manifest-sha256 EXPORT_MANIFEST_FILE_SHA256 \
  --dir /PRIVATE/received-monthly-handoff
```

For an individual purchased response, call `response-file` with `expectedResponseSha256` from the inspected original queue outcome. The first read verifies and retains that saved descriptor. Subsequent ranges can continue after the collection browser closes. Preserve its exact `byteOffset`, `nextByteOffset`, total byte length and SHA256 when reassembling the response.

## SDK and operating ownership

The installed package exposes:

```js
import { createNativeCollections } from '@tokenjunkielabs/starforge-merchant/buyer/mcp/collections';
import {
  openNativeCollectionsClient,
  inspectNativeCollectionExport,
  downloadNativeCollectionExport,
  reopenNativeCollectionExport
} from '@tokenjunkielabs/starforge-merchant/buyer/mcp/collections-download';
```

The native MCP workspace already creates and closes the adapter. Applications owns its selected listener and managed lifecycle. The collection browser owns the original run child and approval broker. Closing the MCP client or native adapter aborts admitted calls while the original browser operation remains available by request ID. Use explicit Pause when you intend to stop that original run.

The collection host advertises `agentApi: 1` for exact run lookup and retained export IDs. The package includes the original SF88 collection source, SF81 approval source, SF43 tool schema, native buyer adapter and shared customer transport together. Standard source manifests and the existing cumulative installer carry this whole workflow.
