# Haystack building turnover

A complete local workspace for native Haystack site, equipment and point data. Import an original grid, inspect its source-local relationships, prepare typed tag corrections, review them explicitly, save editions and deliver a project that another operator can reopen and continue.

The browser, CLI, typed JavaScript client, native MCP and maintained Merchant provider operate the same saved workspace. The standalone application uses Node builtins and runs with Node 22 or later.

## Start and operate

~~~sh
node cli.mjs init --directory /absolute/private/building --title "Building turnover"
node cli.mjs serve --directory /absolute/private/building --port 0
~~~

Open the printed local URL. The [operator guide](OPERATING.md) covers source selection, the equipment/point register, full typed edit preparation, explicit review, edition comparison, delivery and original-request recovery. The application includes the complete upstream Charlie building example and its source/license record in [fixtures.json](fixtures.json).

The source-owned [Haystack contract](HAYSTACK_CONTRACT.md) describes every supported native JSON value, grid validation and source-local reference behavior. The official [JSON encoding specification](https://project-haystack.org/doc/docHaystack/Json) and [value kinds](https://project-haystack.org/doc/docHaystack/Kinds) govern interpretation.

## Original sources and native values

Each original import retains its complete bytes as well as its original name, supplied URL, SHA-256 and parsed grid identity. Its source ID is the original byte SHA-256. Importing identical bytes retains the existing source and metadata; choose its selection explicitly with `source.select`.

The current view selects an ordered list of original sources. A record key is its complete source SHA-256, a colon and the original zero-based row index. Native ref IDs resolve inside that source. Every candidate remains visible for duplicate IDs; unresolved references retain their original target value and any separate cross-source candidates.

Haystack JSON v4 is the import and export format. Native markers, refs, units, dates, times, zones, coordinates, typed strings, nested lists/dictionaries and grids retain their complete values. Signed zero remains signed through JSON transport, operation history and delivery. Original source bytes remain available through `source.read` and the full package.

JSON dictionary members that the native contract ignores remain in the original input. Original import findings stay on their source metadata. Effective diagnostics describe the currently materialized selected grid, including accepted edits.

## Review and saved editions

A proposal records each exact source row/tag, original presence and value, intended presence and value, title, note and source-material identity. Preparing it leaves the current grid unchanged. Accepting it requires the same reviewed material. Rejection retains the complete proposal and reason.

Changing a selected source or accepting another proposal can make an outstanding proposal stale. Read the current source and prepare the complete intended correction against that view. The original proposal remains in its history.

An edition retains its exact ordered source set, accepted proposal IDs, complete counts and content identity. Original sources and accepted changes reconstruct its grid. Edition comparison shows added, removed, changed and unchanged rows, including every changed typed cell.

For two imports of different original files, pair their sources explicitly using `sourcePairs`. Unique native IDs then align within the chosen pair. An unpaired source keeps its own identity. Ambiguous or missing IDs remain tied to their original rows.

## Native API

Start the application and read `GET /api/identity`. Keep its original workspace and current instance IDs. Native callers send them as `x-haystack-workspace` and `x-haystack-instance` headers. Supply the private token through `Authorization: Bearer …` when configured.

`POST /api/action` accepts `{action,args}`. `GET /api/catalog` returns the exact action declarations used by HTTP, native MCP and Merchant registration.

| Operation | Actions |
| --- | --- |
| Workspace | `workspace.status`, `workspace.rename` |
| Original sources | `sources.list`, `source.read`, `source.import`, `source.select` |
| Native records | `records.list`, `record.read`, `diagnostics.list` |
| Typed corrections | `proposal.preview`, `proposals.list`, `proposal.read`, `proposal.prepare`, `proposal.review` |
| Editions | `editions.list`, `edition.read`, `edition.save`, `edition.compare` |
| Original outcomes | `operations.list`, `operation.read` |
| Complete deliveries | `delivery.prepare`, `delivery.read` |

Paged reads retain `expectedRevision`, return `items`, `total`, `nextOffset` and `hasMore`, and accept up to 250 items per page. Continue while `hasMore` is true. When the workspace revision changes, restart the selection using its new revision.

Mutations carry a UUID `operationId` and the reviewed `expectedRevision`. Keep every original argument after an interrupted response. Repeating that exact request returns its saved original result even when later work has advanced the workspace. `operation.read` returns the original result of a completed mutation or delivery.

The native writer serializes complete state changes. State and original outcomes commit together through a synced atomic file replacement. A live writer returns `HAYSTACK_WRITER`; after it completes, continue the same request. The operator guide describes exact stopped-writer recovery.

## Browser and Node client

`client.mjs` and `client.d.mts` provide the same typed client to Node and browsers. It pins the workspace and server instance, preserves complete JSON values, validates page continuity and verifies every downloaded range plus the complete file SHA-256.

~~~js
import { HaystackClient } from "./client.mjs";

const client = new HaystackClient({
  url: "http://127.0.0.1:8768",
  workspaceId: "THE_ORIGINAL_WORKSPACE_UUID"
});
await client.connect();

const status = await client.request("workspace.status");
for await (const page of client.pages("records.list", {
  expectedRevision: status.revision,
  role: "point",
  limit: 100
})) {
  // Each item carries its original source identity and full native tags.
  consumeCompletePointRecords(page.items);
}
~~~

A deliberate new client can reconnect to the same workspace after a server restart. Keep the original workspace pin and read the newly selected instance. The client sends each mutation once. An interrupted request retains its original operation and arguments for recovery.

`sourceBytes(sourceId)` and `deliveryBytes(operationId)` return complete verified `Uint8Array` values. Node's file writer accepts those values directly. Browser downloads require Web Crypto, available in a secure browser context or the local application origin.

## Reports and complete receiving

`delivery.prepare` creates one immutable completed file under its original UUID. It preserves its request, selected workspace revision and complete payload hash. Repeating it returns that original file after later workspace changes.

| Kind | Complete output |
| --- | --- |
| `workspace` | All original source bytes, workspace history, proposals/reviews, saved editions and every portable application file |
| `register` | JSON, CSV or HTML containing complete selected site/equipment/point records, native tags, source locations and relationships |
| `diagnostics` | JSON, CSV or HTML containing every effective finding with exact source/row/tag context |
| `native-grid` | One selected source's complete materialized native JSON v4 grid, including accepted edits |

CSV exports retain native tag JSON and source identities and protect spreadsheet cells from formula interpretation. HTML reports are complete printable documents. JSON reports retain native typed structures.

Use the operator guide's export and receive commands to install a full workspace package in a new directory. The receiver verifies every original source, saved edition and application file. A received project has its original `workspace.json` and an editable `application/` directory. Start `application/cli.mjs` against that same receiving directory.

Receiving records its original package before writing application files. An interrupted receiving operation continues with that same package and destination. A different existing project keeps its own directory.

## Managed installation and agents

The maintained `haystack-turnover` product selection includes the ordinary `haystack` CLI, the Applications entry, typed native exports, browser assets and the source-owned Merchant provider. [MERCHANT.md](MERCHANT.md) gives complete configuration, native MCP and agent operation. The installed product guide is [products/haystack/OPERATING.md](../../../../products/haystack/OPERATING.md).

The portable customer package includes the standalone application and native Merchant client modules. The managed Applications/provider setup uses the surrounding maintained Starforge installation.

## Capacity and source distribution

An original grid can contain up to 32 MiB. A workspace retains up to 100 original source files and 128 MiB of complete saved state. One proposal can contain up to 2,000 complete typed edits. A full delivery can contain up to 192 MiB. Byte-range reads return up to 4 MiB.

These are whole-file and complete-history limits. Export a complete prior project when starting a new project. HTTP admission and client response capacities are explicit server/client options.

`RECEIVING.mjs` operates the complete native building-turnover journey using the untouched upstream Charlie grid: source intake, full record paging, typed review, saved editions, restart/recovery, native reports, complete application delivery and a reopened recipient. Run it with one owned operation directory and retain that directory when continuing.

~~~sh
node RECEIVING.mjs /absolute/haystack-turnover-operation
~~~

The complete application is MIT-licensed under [LICENSE](LICENSE). Original upstream material retains its accompanying [HAYSTACK_LICENSE.txt](HAYSTACK_LICENSE.txt) and provenance.
