# ERDDAP ocean-data workbench — original operator contract

This is the complete ERDDAP source/edition/native dataset workflow. The domain uses the original XML SourceFormat/Workspace and original SF30 NativeEngine; merchant publication uses the original SF30 versioned dataset store, and customer receiving uses the original SF88 Dataset buyer. One private local server owns one saved workspace.

## Ownership and files

F1CB owns erddap_source.py, erddap_workspace.py, merchant.mjs, customer.mjs, cli.py/cli.mjs and the final source/runtime composition. A complementary owner can take the complete erddap_server.py + public/{index.html,app.js,style.css} + same-owner browser receiving. Preserve the existing SDMX server's host/origin/capability/CSP/streaming-upload/shutdown pattern; no additional service or workspace controller.

Root source: stellar/scf-starforge-20261009/sf30-seller-sdk/erddap/
Original server pattern: ../sdmx/sdmx_server.py (blob88be07645da87fe3676f8fe8565a215c70a4d032).
New Python module exports Workspace, InputError; constructor Workspace(root, create=False), context-manager and close().

## Complete Python ABI

- state(): original sources/plans/builds/comparisons plus metadata, queries, operations.
- search(server, text, page=1, limit=50): actual original ERDDAP catalogue page, complete columns/rows, exact retained HTTP identity, nextPage when full.
- load_metadata(server, dataset_id, protocol): acquire/reopen exact original info JSON, DDS and DAS; returns {id, server, datasetId, protocol, metadata, files, semanticSha256}.
- metadata_item(id): reopen same retained metadata.
- save_query({metadataId, selection, label}): validates exact original variable/dimension order and fixed bounds; returns {id, query, decodedQuery, urls}.
- query_plan(id): reopen same saved query.
- acquire(query_id, operation_id, label=None): complete original metadata/DDS/DAS/JSON/CSV acquisition with preserved partial responses and same-operation recovery; returns {operationId, source, metadataChanged}. Reusing an operationId with another query rejects.
- operation(id): original acquisition status/result, source ID, query ID, request hash, last actual error; retained source requests remain exact on retry.
- source(id): inherited full source inventory including metadata, selected fields, missing/empty counts, original number tokens, quality attributes and JSON/CSV comparison.
- source_rows(id, offset=0, limit=100): exact source row page with original types/units, rowCount and nextOffset.
- source_member(id, name): returns original source response bytes for metadata.json, dataset.dds, dataset.das, data.json, data.csv or manifest.json.
- add_source(stream, label=None, name=None): original SourceFormat source ZIP intake, retained exact source ID.
- default_mapping(source_id, name=None): full exact-lexical native projection with explicit unique edition keys where available.
- save_plan(body): inherited immutable reviewed mapping. Returns {id, plan}.
- plan(id): inherited retained plan.
- build(source_id, plan_id): original full native CSV/config/snapshot build, returns original build review.
- build_view(id): original review with source/plan/rowCount/columns/files/native.snapshot.
- query(build_id, params): original NativeEngine query; params are scalar strings. Returns original {dataset,response,engineBlob}, response status/body unchanged.
- compare(before_build_id, after_build_id): original edition comparison with same mapping/explicit keys.
- changes(comparison_id, offset=0, limit=100): original full comparison paging.
- export_dataset(build_id, destination): original complete data.csv, dataset.json, erddap-lineage.json.
- export_packet(build_id, output_path): original six-member customer packet including full five-response ERDDAP source, mapping and native output.
- import_packet(path): original independent reconstruction from raw source/mapping and exact native dataset/snapshot agreement.

Every mutation uses one exact user-selected input. Save query/mapping/build are immutable and idempotent by content identity. Acquisition uses the explicit operation ID saved by the browser before sending, so loss of a response reopens the original operation.

## Native HTTP routes for the operator

All /api routes use the original private capability and same-origin protection.

GET /api/state
POST /api/search {server,text,page,limit}
POST /api/metadata {server,datasetId,protocol}
GET /api/metadata/{id}
POST /api/queries {metadataId,selection,label}
GET /api/queries/{id}
POST /api/queries/{id}/acquire {operationId,label}
GET /api/operations/{operationId}
POST /api/sources (raw application/zip, X-Source-Name, X-Source-Label)
GET /api/sources/{id}
GET /api/sources/{id}/rows?offset=0&limit=100
GET /api/sources/{id}/files/{name} (exact original bytes)
POST /api/sources/{id}/mapping {name} (returns proposed mapping, does not save)
POST /api/plans (complete reviewed mapping)
GET /api/plans/{id}
POST /api/builds {sourceId,planId}
GET /api/builds/{id}
GET /api/builds/{id}/query?native_scalar_parameters
GET /api/builds/{id}/packet (exact complete original customer ZIP)
GET /api/builds/{id}/dataset (ZIP containing data.csv/dataset.json/erddap-lineage.json)
POST /api/packets (raw application/zip -> inherited import)
POST /api/comparisons {beforeId,afterId}
GET /api/comparisons/{id}/changes?offset=0&limit=100

## Selection schema

For griddap:
{"variables":["analysed_sst","analysis_error","mask","sea_ice_fraction"],"axes":[{"name":"time","mode":"value","start":"2025-06-01T09:00:00Z","stop":"2025-06-03T09:00:00Z","stride":1},{"name":"latitude","mode":"value","start":"36.00","stop":"36.04","stride":2},{"name":"longitude","mode":"value","start":"-123.00","stop":"-122.96","stride":2}]}

Every axis is included in actual DDS order. mode can be value or index. Bounds are explicit values, not moving "last"/"now" expressions. The source retains the exact returned coordinate rows, so nearest-axis selection is visible.

For tabledap:
{"variables":["station","longitude","latitude","time","WD","WSPD","WVHT","ATMP","WTMP"],"constraints":[{"variable":"station","operator":"=","kind":"string","value":"46042"},{"variable":"time","operator":">=","kind":"time","value":"2025-06-01T00:00:00Z"},{"variable":"time","operator":"<","kind":"time","value":"2025-06-02T00:00:00Z"}]}
Optional orderBy is an array of selected exact variable names. Supported constraints = != < <= > >= =~. No hidden row limit or data reduction is appended.

## Mapping and scientific values

Mapping schema stellar-forge.erddap-mapping.v1 binds server/datasetId/protocol, name and columns. Each column has source, native name, native type, nullable, encoding (plain/json), exact sourceType and units. Default numeric columns use native strings, retaining the original JSON decimal/integer token. Explicit number/integer selection uses the original native parser; the operator must review that conversion. Source data is never rescaled, interpolated, quality-filtered or otherwise normalized by this adapter.

Default nonnullable source strings remain plain strings. Nullable source strings use JSON-cell encoding to distinguish JSON null from an empty string. The original complete source always retains every input byte. All attributes, flag masks/values/meanings, missing/fill values, license/history/time coverage and original provider types remain available in source inspection.

csvPolicy is require-equivalent by default. A deliberate canonical-json mapping allows an operator to preserve and inspect a response pair from differing provider editions without treating the CSV as equivalent.

## Complete operator workflow

1. Catalogue search/direct dataset selection, provider metadata and source license/quality review.
2. Metadata-driven griddap axes or tabledap constraints/field selection; explicit decoded request preview.
3. Save query, acquire/recover the same operation, inspect actual returned coverage, values and missing/quality fields.
4. Propose/edit/review/save mapping; original native build and paginated field/filter/query inspection.
5. Acquire later complete source, build with same mapping, inspect added/removed/changed/unchanged rows and original source metadata.
6. Export native seller dataset/publication input or the full portable project; import/rebuild in a fresh customer workspace.
7. Original CLI merchant terms, seller start/publication/reopen, then original SF88 fixed-edition offer review/customer preparation.

Look: clean industrial software, neutral surfaces, precise field labels, readable tables, native errors, real busy/navigation handling. Do not show implementation hashes as the main product flow; source/history detail can expose them on request.
