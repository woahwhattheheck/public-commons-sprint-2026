# EDR / CoverageJSON operator contract

Operation: SCF-EDR-COVERAGEJSON-F1CB-20261013.
Additive root: stellar/scf-starforge-20261009/sf30-seller-sdk/edr/.
Scout owns edr_source.py, edr_workspace.py, deployment.py, merchant/customer/MCP/distribution and original native acquisition/receiving.
Actions owns edr_server.py, cli.py, cli.mjs, public/index.html, public/app.js, public/style.css, delivery/browser-owner.py and delivery/browser-phase.cjs.

## Existing native engine
edr_workspace.Workspace(root, create=False) uses the maintained XML SourceFormat/NativeEngine with EDR source extraction. It exposes the current CSAPI Workspace ABI: add_source, source, source_rows, source_files, source_file, default_mapping, save_plan, plan, start_build/build, build_view, query, compare/comparison_page, export_packet/import_packet, export_dataset, state, records and close. The six-member native project packet, source/plan SHA strings returned by import_packet, immutable build/file identities, native cursor and two-file dataset lineage projection are unchanged. No second native engine or acquisition owner is introduced.

The module exports InputError, ProviderError, MAX_SOURCE, MAX_PACKET, json_bytes, load_json and atomic. Server lifecycle and capability URL use the existing original CSAPI startup()/GET /api/launch format. One borrower never closes a separately owned operator.

## Connections and discovery
save_connection({name,baseUrl,allowedOrigins?,authorizationEnv?}) and connection(id) retain the existing exact origin/environment-header boundary.
browse(connection_id,resource,params=None,operation_id=None) performs one retained GET with an explicit operation ID. It returns {schema,operationId,connectionId,documentId,requestUrl,items,links,nextUrl,numberMatched,numberReturned,resourceType,document,queryTypes}. Item containers include collections, instances, features and items. The full original document and response body remain available through document(id)/document_path(id). Discovery does not auto-follow pages; the operator explicitly continues the returned link with a new retained browse operation.

queryTypes exposes the actual collection data_queries descriptors: type, href, mediaType, variables. Never advertise query types which the selected publisher did not return.

## Saved acquisition query
save_query({
 schema:"stellar-forge.edr-query.v1",
 connectionId,name,collectionUrl,queryType,queryUrl,
 params:[{name,value}],
 limits:{maxPages?,maxRows?,maxBytes?,maxLinkedDocuments?},
 tileSet?:0,
 rights:{license?,attribution?,usage?,sourceUrl?}
}) -> {id,query}.
query_definition(id) returns that complete normalized query.

queryType selects position, radius, area, cube, trajectory, corridor, locations or items from actual discovery. queryUrl is the exact published query resource or selected descendant for locations/items. Parameters are ordered explicit strings: coords WKT, bbox, datetime, z, parameter-name, crs, f, resolution and provider-specific options are retained as supplied. No f, limit, CRS, time zone, observation format or format parameter is injected. Query execution verifies the selected advertised route in the retained collection metadata before data dispatch.

limits default to maxPages16, maxRows100000, maxBytes64MiB, maxLinkedDocuments128. maxRows counts all selected parameter cells, not coordinate tuples. tileSet defaults to0 and selects one declared CoverageJSON tile set when the source actually uses TiledNdArray.

acquire(query_id,operation_id,label=None) retains original request {queryId,label}, every successful metadata/page/linked response and every provider error. It follows actual next links and domain/range/tile URLs within allowed origins, respecting the recorded retry deadline. Retry resumes the same request/step files. Complete result: {schema,operationId,queryId,source,coverage}. The result.source is the full retained source object with id; import_packet still returns source and plan strings.

Coverage: {status:"exhausted"|"page-limit",pages,coverages,values,linkedDocuments,nextUrl,scope:"selected-query-response",consistency:"sequential-responses-not-transactional-snapshot"}. Exhausted means the selected query has no advertised next page; it never means the entire collection history was received.

## Coverage inventory and mapping
source(id).inventory contains schema, endpoint, collection, collectionId, schemaSha256, schemaIdentityPolicy, conformance, queryTypes, coverage, rowCount, coverages, sourceIssues, fields, files, resources, selection, rights, duplicates and valuePolicy.

Each range value becomes one cell in original page/coverage/range order, and in declared row-major axis order within its range. The last range axis varies fastest. Range axes may omit only singleton domain axes. Linked ranges and one explicitly selected tile set retain all complete original linked documents. Original nulls, categories, quality parameters, units, CRS, calendars, coordinates, bounds and unknown source members remain available in the original responses.

A cell has id, coverageId, parameter, indices, coordinates, bounds, value, missing, dataType, unit, parameterMetadata and referencing. Wrapper rows have ordinal, page, coverage, index, cell. Primitive, tuple and polygon axes are supported. Regular axes use exact rational arithmetic; a nonterminating decimal coordinate is represented explicitly as an exact rational object. No floating-point interpolation, reprojection, rescaling, deduplication or inferred timezone is performed.

Mapping schema stellar-forge.edr-mapping.v1 binds endpoint, collectionId and schemaSha256. Column source selectors: cell / ordinal / page / coverage / index. Only cell uses JSON pointer. Encodings plain/json/presence-json retain the same native type/null rules as CSAPI. coveragePolicy is require-exhausted by default or explicit allow-partial. Default mapping retains parameter, coordinates, original value JSON, missing state and unit plus useful coordinate columns; all numeric coercion must be an explicit reviewed native column choice.

## Complete operator and receiving
Retain all current CSAPI original routes with EDR schema/name substitution and the above query form. GET /api/records/<collection> supports all eight collections, offset/limit/viewSha256; state is complete for sources/plans/builds/comparisons/connections/queries and bounded only for recent documents/operations. Activity paging must use the view-pinned API.

The source preview shows actual selected domain/ranges and cell count. Display returned coordinates beside requested query parameters. Show raw time strings and calendars; do not add UTC. Coverage and each raw response are available before building.

Browser continuation consumes the same closed native workspace and original source ZIPs, drives the visible reviewed mapping/coverage policy, validates native build/query/cursor and exact project/dataset files, imports into one independent receiver, and cold reopens it. Preserve the final CSAPI response-body route.fetch/fulfill boundary and complete-stage adoption. Scout owns native seed/acquisition and installed run; Actions starts no separate capture or browser.

## Actual publisher evidence already captured
Publisher https://demo.pygeoapi.io/master/ advertises EDR core1.0; current published standard is EDR1.2 /19-086r9 (2026-09-08), not an inferred server upgrade.
Collection icoads-sst: HTTP200,5764B,SHA9e234141986c61c5273543f1a23fb25f0bc078e9142ef04fda46791809ab23ad.
Position POINT(150 0), SST, 2000: HTTP200,2885B,SHAf97df145b4eac8e45323a8276dee1467f57c9bf23d24bd9c9eb9c6dc8976fd37. Actual domain x151.0,y1.0,12 t values and 12 SST values.
Cube bbox149,-1,153,3, SST+AIRT, Jan–Mar2000: HTTP200,4714B,SHA0b825c426849aabd94878f7e3bee708fc5b639d2694bae541b325f2f1b68a31e. Two [3,3,3] ranges,54cells; regular x149→153 and descending y3→-1.
Unsupported parameter: actual HTTP400 / InvalidParameterValue / "Invalid parameter-name",118B,SHA91b61e28595efe34c788834714d1b513f3439659590e6d32f2568d84ae297a85.
The raw fractional timestamp strings have no zone; retain those source facts.
