# EDR provider client, merchant and customer receiving

The EDR application receives an explicitly selected Environmental Data Retrieval query and its complete CoverageJSON interpretation into the original SF30 dataset engine. Its MCP client borrows an existing local operator. Merchant publication and buyer receiving use the maintained SF30 version store and SF88 buyer lifecycle.

Start with the [application guide](README.md), the exact [operator contract](OPERATOR_CONTRACT.md), and the publisher's retained [HTTP representations](delivery/publisher-responses.json). Source interpretation follows the [OGC CoverageJSON Community Standard](https://docs.ogc.org/cs/21-069r2/21-069r2.html). The service's own conformance response stays distinct from the [current EDR specification](https://github.com/opengeospatial/ogcapi-environmental-data-retrieval).

## Scientific selection and source interpretation

One native row is one parameter cell, with its original range order, domain indices, coordinates, value and unit. A query returning two parameters over 27 positions supplies 54 rows. Original JSON, linked domains/ranges/tiles, parameter definitions and referencing remain in the source packet.

The default projection preserves numeric tokens in JSON-encoded string cells. It records original nulls, categories, coordinate bounds, CRS, calendar and time strings. Selecting a native number column is an explicit mapping decision. No reprojection, rescaling, interpolation, timezone repair, regridding, deduplication or hidden quality filter is automatic.

Review returned sourceIssues, including the retained publisher example's Gregorian time strings without a zone. A complete receiving result preserves those facts. Resolving an upstream scientific issue needs the publisher's authoritative correction or an explicitly agreed derived product; successful software receiving does not silently resolve it.

## Configure one existing operator

Create or receive an EDR workspace with the application CLI, then start its original server with a private connection file:

~~~bash
edr --workspace /absolute/private/edr-workspace serve \
  --connection-file /absolute/private/edr-operator.json
~~~

The actual startup returns schema stellar-forge.edr-workspace-startup.v1, state LISTENING, the original workspace, instance ID, start time and a private loopback URL. The token is in the URL fragment. Keep that file private; omit it from customer datasets, public source archives and email.

The managed Applications host uses the same server and startup record. The EDR Application provider verifies the actual authenticated /api/launch response before publishing an application URL. Choose one owner for the workspace.

Save a separate private MCP configuration:

~~~json
{
  "schema": "stellar-forge.edr-workspace-connection.v1",
  "workspaces": {
    "environment": {
      "label": "Selected environmental coverage",
      "workspace": "/absolute/private/edr-workspace",
      "connectionFile": "/absolute/private/edr-operator.json",
      "timeoutMs": 180000,
      "maxResponseBytes": 67108864,
      "inputs": {
        "source": {
          "path": "/absolute/receiving/selected.edr.zip",
          "kind": "source",
          "label": "Original selected CoverageJSON source",
          "sha256": "REPLACE_WITH_THE_COMPLETE_ORIGINAL_SOURCE_SHA256"
        },
        "project": {
          "path": "/absolute/receiving/selected.project.zip",
          "kind": "packet",
          "label": "Original customer project",
          "sha256": "REPLACE_WITH_THE_COMPLETE_ORIGINAL_PROJECT_SHA256"
        }
      }
    }
  }
}
~~~

Input aliases are optional. Remove an unused alias, or supply its exact retained path and 64-character SHA-256. The validator rejects placeholders. Relative paths resolve from the configuration file. Workspace and capability files must remain private and owned by the host user.

A workspace may instead name one original host variable with connectionEnv. Choose exactly one of connectionFile and connectionEnv. That variable contains the original startup record. It is separate from an endpoint's authorizationEnv, which names an existing upstream Authorization header. Never place either credential value into an MCP request.

Initialize the existing merchant host with the source-owned function:

~~~javascript
import { initializeEdrMerchant } from './mcp-setup.mjs';

const initialized = await initializeEdrMerchant({
  directory: '/absolute/private/edr-merchant',
  connection: '/absolute/private/edr-workspaces.json',
  name: 'Selected environmental coverage'
});
console.log(initialized.configuration);
~~~

The maintained merchant CLI consumes the returned merchant-mcp.json. The EDR provider declares edrWorkspaceConnection and the normalized edrWorkspaces family through the original provider contract. Repeating setup accepts the exact same configuration and preserves the original release store and exports directory.

## Complete MCP workflow

All tools use the merchant_edr_ prefix. Workspace-scoped tools take a configured workspace alias. Hashes, operation IDs and original file-read IDs come from the product.

| Tools | Purpose and retained inputs |
| --- | --- |
| workspaces, status | Inspect configured operators, borrowed-client state and counts. |
| records | Page any of the eight complete collections with offset, limit and expectedViewSha256. |
| connection_save, connection | Save/read base URL, allowed origins and optional upstream authorization variable name. |
| browse, document | Retain one actual provider GET under an explicit operation ID, then read its receipt/document. |
| query_save, query | Save/read collection URL, actual query type/URL, ordered params, limits, tile set and rights. |
| acquire, operation | Execute/resume the same query, operation and label; inspect success, partial state or provider error. |
| inputs, input_inspect, import | Inspect host-pinned source/project aliases and import a complete file with expected SHA. |
| source, source_files, source_rows | Review coverage metadata, original member inventory and parameter cells. |
| mapping_propose, mapping_save, mapping | Review and retain an endpoint/collection/layout-bound native plan. |
| build, build_read, native_query | Use the original SF30 engine, immutable snapshot and native cursor. |
| compare, changes | Compare mapped editions and page change records; unchanged count is in the summary. |
| file_read, file_release | Receive complete original files using retained read IDs, offsets and full hashes. |
| disconnect | Drain this borrowed client/readers while retaining the actual server and workspace owner. |

### Discover and save the query

Save the endpoint, then browse the actual landing page, collection catalogue and selected collection under explicit operation IDs. Each browse retains one page and its next link. A further browse uses a distinct operation ID for that next resource.

The query menu comes from data_queries in the retained collection. Supported query names are position, radius, area, cube, trajectory, corridor, locations and items, but an unadvertised type is rejected. A locations/items query can select an advertised descendant. The route and existing advertised query parameters are checked before data dispatch.

query_save accepts the complete stellar-forge.edr-query.v1 object from the application guide. Parameters are an ordered array of at most 32 name/value string pairs. Names are at most 128 characters and values at most 4,096. Use the publisher's actual WKT, bbox, datetime, vertical, CRS, parameter-name, format and resolution contracts. No parameter is inserted automatically.

The source label is a separate acquisition input. A continuation uses the same query ID, operation ID and label. Changing the scientific selection creates a new saved query and operation; the original remains available.

### Acquire and interpret

Acquisition retains selected collection metadata, actual coverage pages and all linked domain/range/tile documents needed to interpret them. Links and redirects stay within approved origins. Upstream authorization goes only to the connection's base origin.

Receiving limits apply to the complete response closure. maxRows counts parameter cells; maxLinkedDocuments counts selected external CoverageJSON documents. A page bound can yield a partial source with its actual next link. A byte/cell/linked-document failure retains the response and reports the limit rather than silently trimming a successful dataset.

Every GET has a retained attempt and successful step. If the response was saved before a process ended, continuation verifies its original request URL, HTTP 200 receipt and body before adopting the missing step. Changed requests, corrupted responses, unsupported sources and real provider errors remain explicit.

A provider 429/503 Retry-After deadline is retained by connection and honored after restart. The MCP client does not retry a mutation automatically. After a lost response, read operation or the relevant source/mapping/build identity before choosing the exact continuation.

### Review, build and compare

Use source and source_files to inspect coverage, layout, units, referencing and source issues before saving a mapping. source_rows presents numeric tokens as strings; original raw bytes and kinds remain available.

mapping_propose is read-only. mapping_save records the actual reviewed plan. The default projection includes cell identity, parameter, axis indices, coordinates/bounds, value JSON, missing state, data type, unit and useful individual axes. Its layout identity can accept a later window with changed coordinate values or lengths while retaining the same parameter/reference/range layout.

A partial source needs an explicit allow-partial plan. The ordinary default is require-exhausted. Exhaustion means the selected response chain ended; it does not establish receipt of the collection's whole history.

Build from the exact returned source and plan IDs. Native query parameters are scalar strings. Traverse nextCursor until absent when receiving a whole selection; each page must retain the same snapshot. Native sorting/filtering follow the reviewed mapping. Record-list offsets and native dataset cursors are separate.

Compare two editions using a compatible saved mapping and explicit keys. The summary gives added, removed, changed and unchanged counts. Its complete JSONL file contains add/remove/change records and does not repeat unchanged rows.

### Receive complete files

| file_read kind | Required selection |
| --- | --- |
| source | sourceId and exact member from source_files. |
| document | Original documentId; real error bodies are available too. |
| comparison | Exact comparisonId for the full change file. |
| packet | buildId for the deterministic six-member project. |
| dataset | buildId for original native data/config/lineage ZIP. |

The first read returns a retained read ID, complete SHA-256, total byte count and bounded chunk. Continue with that ID, expected SHA and next offset until all bytes arrive. Verify full hash and length before use. A later reader for the same immutable export receives the same bytes. Release the temporary reader after retaining the complete file.

The source packet stays separate from the merchant dataset projection. Source URLs, timestamps and headers remain actual evidence. The project packet independently reconstructs the original native build.

## Seller and buyer integration

Prepare a seller release only with an original dataset export and explicitly selected public terms and origin:

~~~bash
edr merchant prepare \
  --dataset /absolute/receiving/selected.dataset \
  --payment /absolute/private/public-payment-terms.json \
  --origin https://the-selected-public-origin.example \
  --out /absolute/private/edr-release \
  --path /the-agreed-query-route
~~~

The origin is a placeholder. A commissioning price, public example or grant allocation does not supply dataset payment terms.

Preparation checks native files against EDR lineage and derives the original seller contract through SF30. A release keeps exact CSV, native config, source lineage and seller JSON. Its source-series identity binds endpoint, collection, CoverageJSON layout and mapping. The release reader verifies duplicated source/selection/date metadata against that lineage.

The existing version store owns publication, CAS, retention and request draining. Inspect its actual snapshot and revision before publish. A refresh keeps the public route and terms bound to the original store while selecting a later retained dataset.

The customer module's offer reads the actual seller and selected native snapshot. prepare requires the complete returned offer SHA, explicit payment alternative and intent ID; it creates the original SF88 buyer draft. Subsequent init/run/recover/export/deliver/accounting/finalize commands delegate to the maintained SF88 dataset CLI. Data receiving does not create a payment principal, select an account or run a signer.

## Original native reference and customer acceptance

Run the source-owned reference using its five retained publisher representations:

~~~bash
python3 -B delivery/publisher-native.py \
  --source-root /absolute/source/sf30-seller-sdk/edr \
  --operation-root /absolute/private/edr-original-operation \
  --node /absolute/path/to/node \
  --quarter-window
~~~

The point and cube inputs preserve their captured responses, with the original retrieval dates. The optional quarter-window phase makes a separately identified actual acquisition through the same Workspace. It compares the twelve-cell SST source with the three-month selection, receives that project independently and cold reopens it. Completed native stages return their original retained result; completed downloads keep exact bytes.

For a customer source, use connection/query/acquire and then the native receiver against the selected source or saved query:

~~~bash
python3 -B delivery/native-receive.py \
  --source-root /absolute/source/sf30-seller-sdk/edr \
  --operation-root /absolute/private/customer-edr-operation \
  --operation-id THE_AGREED_ORIGINAL_OPERATION \
  --workspace /absolute/private/customer-edr-workspace \
  --query THE_ACTUAL_SAVED_QUERY_SHA256 \
  --coverage-policy require-exhausted \
  --node /absolute/path/to/node
~~~

An explicit mapping may be supplied. Source IDs or exact source ZIPs may replace a saved query. The receiver preserves the producer and one independent recipient workspace. Browser continuation uses that same closed producer and original input identity; it does not reacquire data.

The receiving agreement identifies:

- named payer, technical contact, scientific reviewer and acceptance owner;
- collection, parameters, geometry/locations, time/vertical window, CRS and declared end condition;
- access, license/attribution, retention and allowed linked origins;
- expected parameter-cell counts, missing values, source issues and permitted conversions;
- useful native queries, ordering and edition comparison;
- receiving environment, private operating paths and exact project/source delivery;
- restart/provider-error behavior and the owner of the original continuation;
- the agreed review/correction cycle and scope of new families or changed outputs.

Receiving evidence is the actual source, reviewed plan, native build/snapshot, full query coverage, exact files and independent reopen. Customer acceptance, contracted work, invoices and collections retain their own records. A public reference or software development run does not supply those commercial outcomes.
