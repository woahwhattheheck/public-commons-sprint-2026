# OpenSearch merchant workspace

Author a named query, inspect its native OpenSearch contract, capture a durable result edition, and prepare the original Stellar Forge merchant and generated customer client. The workspace uses the same source adapter and merchant compiler as the command-line product.

## Open an existing source

Use the original OpenSearch source declaration and its credential environment. The adapter requires Node 22.16 or later and the supported native OpenSearch version described in the [source guide](../README.md). Workspace storage uses Node's built-in SQLite module and the existing browser.

From the seller SDK directory, run:

    node opensearch/workspace/server.mjs \
      --source /private/opensearch/source.json \
      --plan /private/opensearch/merchant-plan.json \
      --workspace /private/opensearch/working \
      --port 8447

Open the printed loopback URL. The optional plan supplies the existing merchant terms for new drafts. Without it, the editor starts with blank amount, asset and receiving account; fill the intended values before validation or preparation.

The source connection profile is selected by the operator at startup. The browser edits queries, input and merchant terms. Connection values stay in the process's existing environment; saved source files contain the original environment references. A workspace directory stays bound to that connection profile, while each saved draft freezes its own query definition.

Restart the same command with the same workspace directory to reopen drafts, revisions, native result editions, original request outcomes and prepared merchant packages.

## Author and operate a query

1. Select a named source query and choose **New draft**. Edit the title, query declaration, search input and merchant plan. The full original query contract remains visible: selected indices and fields, typed parameters, native sort, page size, result limits and probe input.
2. **Save draft** creates a durable numbered revision. Later edits require the exact revision currently open, so another operator's saved changes cannot be overwritten silently. **Revision history** opens every retained revision.
3. **Validate saved plan** calls the original source and merchant compilers. **Inspect native source** opens the original adapter, performs its actual source preflight and retains the returned description, inspection and status.
4. **Capture search edition** runs the saved query with its saved typed input through the original adapter. Native point-in-time pagination and cleanup stay with that adapter. The complete returned result is saved before the request is reported complete.
5. Open **Result editions** to inspect original documents, page through all captured hits, download the original result or complete edition JSON, and export CSV. Preparing or downloading an edition does not substitute a new search for its original capture.
6. **Prepare merchant** writes a new private package through the original preparation function. Open **Merchant packages** for the exact files, their byte hashes, original launcher information and generated customer handoff. Each request has a separate output directory.

The interface is dependency-free, neutral industrial software. Wide result tables scroll horizontally; the draft and action panels stack on narrow screens. It does not require a frontend build.

## Preserve native search meaning

Document identity is the original pair **[_index, _id]**. Comparison joins that exact pair and returns added, removed, changed and unchanged captured documents. Changes include the complete original hit, including source fields, score, native sort values and exact-integer metadata.

A comparison describes its two retained result editions. Their query, revision, capture time, total relation, truncation status and source/result hashes remain attached. The UI distinguishes an exact provider total from a lower bound and shows when the configured capture limit was reached.

The adapter's original unsafe-integer representation is preserved unchanged: decimal strings, its numberEncoding value, and every hit's exactIntegerPaths. Original numeric tokens therefore remain distinguishable from original string identifiers. JSON downloads come from the retained server result text. The browser's display and table previews are separate views.

CSV contains original index, document ID, score, selected fields, complete source JSON, native sort JSON and exact-integer paths. Formula-like text, leading-zero text and long integer text receive a leading apostrophe for spreadsheet safety and precision. Use the result JSON for the unchanged adapter representation. CSV cell previews in the browser never replace the full download.

For the underlying provider contracts, see [OpenSearch Search](https://docs.opensearch.org/latest/api-reference/search-apis/search/), [Point in Time](https://docs.opensearch.org/latest/api-reference/search-apis/point-in-time-api/) and [Field Capabilities](https://docs.opensearch.org/latest/api-reference/search-apis/field-caps/).

## Recover an interrupted request

Every save, native inspection, capture and preparation uses a caller-generated request ID. The browser retains that ID and exact payload before sending; SQLite records the operation and original draft before native work begins.

If the reply is lost, open **Requests** and choose **Read original result**. **Retry the same request** resends the same ID and bytes. The server returns the existing outcome or pending record rather than dispatching a second native operation. Reusing an ID with different input is rejected.

The workspace preserves pending operations across restart. When the recorded original process has ended, recovery marks its unfinished request **INTERRUPTED** while keeping the exact draft, request and any prepared files. It does not manufacture a result or replay that search. After reading the terminal interruption, choose a new explicit capture or preparation to create a new operation. An original process still present remains represented by its pending request.

Current native source inspection and capture run one at a time within this operator. A closed browser does not cancel an already admitted operation. Normal shutdown waits for this workspace's active operations before closing SQLite.

## Files and retention

The chosen private workspace directory contains:

| Path | Purpose |
| --- | --- |
| workspace.sqlite3 and its SQLite sidecars | Draft revisions, request records, complete result editions and package receipts |
| sources/ | Atomic retained source and merchant-plan editions, identified by draft and revision |
| packages/ | Original generated merchant packages, identified by the preparation request |

Keep the complete workspace directory when moving or backing up work, after its server has closed. Keep the original SDK source or installed distribution with it. Credential environment values remain in their existing secure environment.

Result JSON has its own SHA-256 and byte count. Each prepared file has its actual byte SHA-256; downloads re-read and compare those exact bytes. Previously prepared packages and captured editions are never overwritten by a later draft or result.

The source profile hash binds the workspace to its selected environment-reference policy. The actual remote dataset remains live. A new capture uses that current dataset through the native source; an old edition keeps its original captured result.

## Embedding and API

The maintained entry points are:

| Entry point | Purpose |
| --- | --- |
| createOpenSearchWorkspace({sourceFile, planFile, directory, env}) in service.mjs | Open the original source declaration and retained operator state |
| startOpenSearchWorkspace({workspace, port}) in server.mjs | Serve the loopback workspace |
| main(args) in server.mjs | Original command-line entry, returning the open server and close method |
| compareEditions and editionCsv in store.mjs | Consume complete retained adapter results without another provider call |

The API follows the same local origin and session-token contract as the original merchant workspaces. GET /api/session returns the current workspace identity and operator token; POST calls include the current Origin and x-workspace-token header. A host restart can refresh that token for the same workspace identity.

POST /api/drafts saves a requestId, optional draftId/expectedRevision, title, queryName, query, input and plan. POST /api/validate accepts draftId and expectedRevision. POST /api/inspect, /api/capture and /api/prepare also require requestId. GET /api/operations/ID recovers their original state.

GET /api/editions/ID opens a full saved edition; suffixes result.json, edition.json and results.csv download its retained exports. GET /api/compare?before=ID&after=ID returns the complete identity-based comparison. GET /api/packages/ID supplies its manifest and original handoff; its file route serves only a recorded, checksum-matching package member.

The workspace imports original source and preparation functions directly. Source query compilation, parameter binding, native PIT lifecycle, field-capability checks, seller price/declaration compilation, generated clients and merchant runtime remain in those maintained components.
