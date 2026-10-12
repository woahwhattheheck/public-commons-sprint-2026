# Connected Systems operator contract

Source root: `stellar/scf-starforge-20261009/sf30-seller-sdk/connected-systems/`.
Original native engine and retained workspace: sibling `xml/workspace.py`, Git blob `24c4fb7ccf08f6d350bcfb4eae6accc251a60a4e`.
This module is a read-only JSON CSAPI consumer. It does not command connected equipment.

## Modules and imports

`csapi_source.py` interprets exact captured responses. `csapi_workspace.py` composes the original native workspace, while `csapi_server.py`, the CLI and browser files expose that same maintained API.
Import `Workspace, InputError` from `csapi_workspace`. Workspace(root, create=False) is a context manager with close(). The format kind is `connected-systems`.
No shared original XML or ERDDAP source changes are required.

## Original local operator boundary

Reuse the established ERDDAP private server contract: loopback host; cryptographically random token_urlsafe(32) fragment in the private startup URL; bearer capability on API calls; exact-origin and JSON/media checks; CSP/static files; bounded streamed uploads; no secret in HTML, logs or API launch responses.
OperatorServer(workspace, host='127.0.0.1', port=0), startup() includes original private URL plus instanceId/workspace/startedAt. GET /api/launch omits URL/token and returns the same instance facts. API state adds workspace {id: sha256(str(root)),name:root.name} for browser draft scoping.
The provider's optional Authorization header comes only from an operator-selected environment variable at request time. Its value is never returned or saved. It is never forwarded to another origin.

## Workspace methods

All identifiers named source/plan/build/connection/query/document are full SHA256 hex strings. operation_id is an explicit printable identifier matching [A-Za-z0-9][A-Za-z0-9_.-]{0,95}. The caller saves it before sending a request.

### Connection and discovery

- save_connection(raw) -> connection. Input: {name,baseUrl,allowedOrigins:[],authorizationEnv:null}. HTTPS remote bases; HTTP is allowed only for loopback. allowedOrigins contains explicit extra HTTPS origins for public linked resources. The authorization environment name is private configuration, never part of source/customer packets. Connection: {id,name,baseUrl,allowedOrigins,authorizationEnv,authentication:'environment'|'none',created}.
- connection(id) -> that exact retained connection.
- browse(connection_id, resource, params=None, operation_id=None) -> {schema,operationId,connectionId,documentId,requestUrl,items,links,nextUrl,numberMatched,numberReturned,resourceType,document}. resource is a same/explicitly-approved-origin URL or a path relative to the selected base. params is an ordered array of {name,value} string pairs. The complete returned document remains retained. A repeat with the same operation ID and exact request returns its retained result; another request with that ID conflicts. An omitted operation ID is rejected.
- document(id) -> {id,receipt,document}. document_path(id) -> the exact original JSON file, for a streamed download. Discovery returns one complete response page; the caller follows nextUrl explicitly using a new operation ID, preserving the original query.
- save_query(raw) -> {id,query}. Input schema is stellar-forge.connected-systems-query.v1; fields: connectionId, name, datastreamUrl, schemaUrl, observationsUrl, systemUrl (string or null), params (ordered {name,value} pairs), limits {maxPages,maxRows,maxBytes}, rights {license,attribution,usage,sourceUrl}. Rights are plain operator declarations; empty/unknown stays explicit. obsFormat is application/json. Resource paths/URLs are resolved and retained literally. No claim of all-history completeness is inferred.
- query_definition(id) -> the full normalized query.
- acquire(query_id, operation_id, label=None) -> {schema,operationId,queryId,source,coverage}. source is the original Workspace.add_source result. It retains complete metadata/schema/observation response pages and their HTTP receipts in one exact source ZIP. Completed pages, the original request and any failures survive retry. Same operation + different inputs conflicts. Coverage reports returned observations/pages, exhausted vs an explicit bound, and the actual next URL. Schema changes during acquisition reject final publication with the original raw pages retained.
- operation(id) -> {schema,id,kind,status,request,progress,result,error,updated}. request is the exact saved validated request, not a reconstruction from current UI fields. status is prepared/running/complete/failed. result is null until complete. error is a safe structured provider/domain failure with code/status/retryAt when known; no credentials. GET /api/operations/<id> supports lost-response recovery.

### Observation resource selection

`save_query` and `POST /api/queries` accept optional `observationResource: "collection" | "single"`. Default/explicit collection is omitted from the normalized query so existing collection identities remain unchanged. A single-resource query retains `observationResource: "single"`, sets `limits.maxPages` to 1, and does not insert a collection `limit` parameter. Its actual response must be one valid observation object with no next-page link. Capture `selection.observationResource` and `coverage.scope: "single-observation-resource"` preserve the selected scope. Exhausted means that one resource was received, not that the provider collection was traversed.

`schemaUrlPolicy` is optional: `"format-parameter"` (default, omitted from normalized query) or `"exact"` (retained explicitly). The default adds `obsFormat=application/json` to the schema URL when absent; exact preserves the supplied schema URL. An explicitly incompatible format parameter is rejected, and schema/result validation remains required under both policies. Exact policy is also retained in source `selection`. Policy changes produce a new query identity; they cannot mutate an existing acquisition request.

The original `items` collection parser remains unchanged for ordinary queries. The single-resource parser reads the exact object without constructing a replacement collection body. Existing request ID, body hash, source identity and receiving rules apply to both modes.

### Retained source and mapping

- state() -> the original complete {schema,sources,plans,builds,comparisons} plus connections,queries,documents,operations. Source rows retain id,label,name,bytes,created. Documents and operations are the latest 200, with documentCount, operationCount and explicit listCoverage. Use records() for full inventories.
- records(collection,offset=0,limit=100,expected_view_sha256=None) -> {schema,collection,viewSha256,total,offset,returned,nextOffset,items}. Collections: sources,plans,builds,comparisons,connections,queries,documents,operations. Items have the same per-collection shape as state(); documents/operations include all retained rows. Limit is 1..250. Nonzero offsets require the original viewSha256. A changed view raises InputError with code CSAPI_COLLECTION_CHANGED, status 409 and view_sha256.
- add_source(stream,label=None,name=None) -> {id,label,name,bytes,created,inventory}. File is a complete Connected Systems source ZIP, although the original retained internal filename is source.connected-systems.
- source(id) -> that row including inventory. inventory includes schema,endpoint,datastream,system,observationSchema,schemaSha256,coverage,rowCount,fields,duplicates,files,rights,valuePolicy. Full raw documents remain downloadable.
- source_rows(id,offset=0,limit=100) -> {rows:[{ordinal,page,index,observation}],offset,nextOffset,rowCount,representation}. Original JSON number tokens are displayed as strings, explicitly identified by the preserved source schema/field kinds; no binary float conversion.
- source_files(id) -> {source,files:[{name,bytes,sha256,mediaType,requestUrl,status}]}. source_file(id,name) -> {body:bytes,mediaType,name}; names must exactly match retained members, never arbitrary paths.
- default_mapping(source_id,name=None) -> complete normalized mapping, not a saved plan.
- save_plan(raw) -> {id,plan}; plan(id) -> full mapping. Both are original Workspace methods.
- Mapping schema stellar-forge.connected-systems-mapping.v1. Identity fields endpoint,datastreamId,schemaSha256. Standard original mapping fields name,columns,keys,filters,ranges,sorts,defaultLimit,maxLimit,maxRows,maxBytes,maxCellChars,allowEmpty. Additional coveragePolicy is require-exhausted or allow-partial, explicitly selected.
- Each column: {name,source:'observation'|'ordinal'|'page'|'index',pointer,type,nullable,encoding}. pointer is an exact RFC6901 pointer (empty means whole observation) and is used only for source=observation. encoding is plain, json or presence-json. presence-json preserves missing versus explicit null as {present:false} or {present:true,value:...}. json requires a present value. Plain nullable projection is an explicit choice to represent missing/null as an empty native cell. Default mappings preserve the complete observation in a JSON cell and offer original scalar fields without unit conversion or quality filtering. Numeric native column types require operator review; original number tokens remain exact in retained sources and CSV cells.
- Schema identity is a canonical structural hash of the retained schema, distinct from its exact file hash. A changed schema requires a reviewed new mapping.
- Repeated/conflicting observation IDs are retained and reported, never silently deduplicated. Default edition keys are chosen only when actual IDs are nonempty and unique.

### Original build/query/compare/customer receiving

The native build, query, comparison and receiving methods retain the XML workspace 24c4 ABI. Dataset export adds the source-specific merchant lineage; packet export retains its exact build-bound bytes:
- build(source_id,plan_id,expected=None) -> {schema,id,source,plan,rowCount,keys,columns,native,engineBlob,files}.
- build_view(id) -> exact saved build review.
- query(build_id,params) -> original native SF30 response {response,dataset,engineBlob,...}; params maps strings to strings. Preserve actual snapshot/cursor and HTTP result status.
- compare(before_id,after_id) -> {schema,id,before,after,plan,keys,semantics,counts,changesSha256}. Same mapping and explicit unique keys required.
- comparison_page(id,offset=0,limit=50) -> {rows,offset,nextOffset}; comparison_file(id) -> full JSONL path.
- export_dataset(build_id,destination) -> {directory,dataset,build,lineage}; original data.csv, dataset.json and connected-systems-lineage.json. Lineage schema is stellar-forge.connected-systems-lineage.v1; fields include build (SHA string), snapshot, project, files, sources, selection, coverage, duplicates, mapping, rowCount, engineBlob, valuePolicy, created_at. files contains exactly the data.csv/dataset.json projection of build.files; the private rows.sqlite runtime index is not exported as a dataset file.
- export_packet(build_id,output) -> {file,bytes,sha256,build}; exact source/mapping/data/native review, compatible with an independently created connected-systems workspace.
- import_packet(path) -> {source:SHA256_STRING,plan:SHA256_STRING,build:FULL_BUILD,reconstructed:true}; original engine reconstructs the dataset and verifies its expected native snapshot/cells.
- scratch() yields one original private operation directory.

The server exposes the original routes for sources, plans, builds, queries, comparisons, exports and receiving, with /api/connections, /api/browse, /api/documents/<id>, /api/queries, /api/acquisitions, /api/operations/<id>, and GET /api/records/<collection>?offset=0&limit=100&expectedViewSha256=SHA. Failed collection paging returns viewSha256, preserving the core's known identity. Keep request fields faithful to these signatures. Store pending request IDs and exact source/plan selections before a mutation; show recovery for failed/lost responses. A server-side failure never implies an acquisition did not run.

## Browser continuation

One original browser owner consumes --source-root, --operation-root, --workspace (the original closed native workspace), repeated --source-packet, explicit --coverage-policy require-exhausted|allow-partial, optional --temporary-root and --screenshots. It does not perform a second source acquisition or create a replacement native seed. The owner continues the same retained checkpoints, drives actual source/mapping/build/query/compare/export, then opens one independent customer receiving workspace. Source IDs/schema/coverage policy and expected native dataset are checkpoint inputs. It closes both servers and workspaces before returning. Actual provider source paths, source hashes, reviewed mappings and native result are required inputs from that same completed acquisition/build.

## Complete local route map

All API routes require the original capability and apply the same origin checks.

| Method | Route | Original call / body |
| --- | --- | --- |
| GET | `/api/launch` | Token-free current listener identity. |
| GET | `/api/state` | Startup summary plus workspace identity. |
| GET | `/api/records/<collection>` | `records(collection,offset,limit,expectedViewSha256)`. |
| POST | `/api/connections` | `save_connection(raw)`. |
| GET | `/api/connections/<id>` | `connection(id)`. |
| POST | `/api/browse` | `{connectionId,resource,params,operationId}`. |
| GET | `/api/documents/<id>` | `document(id)`. |
| GET | `/api/documents/<id>/body` | Complete original response bytes. |
| POST | `/api/queries` | `save_query(raw)`. |
| GET | `/api/queries/<id>` | `query_definition(id)`. |
| POST | `/api/acquisitions` | `{queryId,operationId,label?}`. |
| GET | `/api/operations/<id>` | Exact original request and retained progress/result. |
| POST | `/api/sources` | Complete application/zip body; encoded source name/label headers. |
| GET | `/api/sources/<id>` | Full source inventory. |
| GET | `/api/sources/<id>/rows` | Original rows by offset/limit. |
| GET | `/api/sources/<id>/files` | Complete original member inventory. |
| GET | `/api/sources/<id>/files?name=MEMBER` | Exact URL-encoded retained member name. |
| POST | `/api/sources/<id>/mapping` | `{name?}`; return the complete proposed mapping without saving it. |
| POST | `/api/plans` | Complete reviewed normalized mapping. |
| GET | `/api/plans/<id>` | Exact saved mapping. |
| POST | `/api/builds` | `{source,plan}`. |
| GET | `/api/builds/<id>` | Full native review. |
| GET | `/api/builds/<id>/query` | Original scalar-string native parameters. |
| GET | `/api/builds/<id>/packet` | Exact six-member project ZIP. |
| GET | `/api/builds/<id>/dataset` | Exact three-member native dataset ZIP. |
| POST | `/api/comparisons` | `{before,after}`. |
| GET | `/api/comparisons/<id>/changes` | Original comparison paging by offset/limit. |
| GET | `/api/comparisons/<id>/file` | Complete original comparison JSONL. |
| POST | `/api/packets` | Complete original project ZIP; independent native reconstruction. |

The default-mapping route returns a proposal; the separate plan save records the reviewed mapping. Error responses preserve the known code, status, documentId, retryAt and viewSha256; HTTP/provider failure is not converted into a completed acquisition.
