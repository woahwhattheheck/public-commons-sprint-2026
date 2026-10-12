# Acquired GIS data in the DuckDB customer workspace

The GIS workspace turns geometry already retained in an acquired dataset edition into a reviewed spatial layer. It uses the original customer database, source files, immutable editions, saved operation records, and private browser. The native spatial extension supplies GDAL, PROJ and spatial SQL.

## Install and open

Use Python 3.11 or newer and the existing buyer package with its pinned DuckDB dependency:

    python -m pip install -e './sf88-operator-buyer-cli/python[duckdb]'

Install the signed extension once on the receiving computer, using the same DuckDB 1.5.6 engine:

    python -c "import duckdb; db=duckdb.connect(); db.execute('INSTALL spatial'); db.close()"

The engine uses its installed spatial extension by default. A host can select an existing signed binary explicitly:

    stellar-forge-duckdb --workspace /private/customer \
      --spatial-extension /private/runtime/spatial.duckdb_extension serve --open

The environment variable STARFORGE_DUCKDB_SPATIAL_EXTENSION supplies the same host setting. The browser never chooses executable paths or installs dependencies. The native engine verifies the extension signature. Install the matching build for each operating system and engine version.

The original SQL, source review, dataset editions, downloads, portable handoff and customer-agent entrypoints remain available. GIS workspace is an additional page in that operator.

## Review an original layer

Import an original SF88 delivery report or complete SF100 finalized scan through the existing source review. Preserve the geometry JSON, spatial-reference JSON, raw attribute JSON, record keys, and exact scalar field mappings.

In GIS workspace, select the immutable dataset edition and its geometry source column. Choose ArcGIS geometry JSON, GeoJSON geometry, WKT or hexadecimal WKB. Enter the original CRS and select the original spatial-reference column when present. ArcGIS also requires its original geometry type.

For the retained Suffolk County ArcGIS source, the geometry column is geometry_json, spatial reference is spatial_reference_json, key is object_id, and original CRS is EPSG:3857. Its original ArcGIS reference retains wkid102100 and latestWkid3857. The review compares the stated CRS to that original reference.

    stellar-forge-duckdb --workspace /private/customer spatial review EDITION_ID \
      --geometry-column geometry_json --format esri-json --crs EPSG:3857 \
      --spatial-reference-column spatial_reference_json \
      --geometry-type esriGeometryPolygon --keys object_id

The review records every source row, key uniqueness, original geometry digest, native WKB digest, coordinate inventory, extent, geometry type, and null/empty/valid/invalid counts. GDAL reads the original Esri geometry structure. An independent WKB reader checks that every original XY coordinate survives conversion with its multiplicity. Original raw JSON and attributes stay in the immutable dataset table and original source files.

This version accepts linear XY geometry. Curves and Z/M coordinates require an explicit source conversion appropriate to the customer's use before a separate reviewed layer is created. The application never silently simplifies, repairs, reprojects or removes invalid geometry during source review. A review may retain invalid geometry; a spatial operation that cannot process it returns the native engine's error.

Retain the reviewed layer and select its current alias:

    stellar-forge-duckdb --workspace /private/customer spatial adopt REVIEW_ID
    stellar-forge-duckdb --workspace /private/customer spatial activate current_map LAYER_ID --expected-revision 0

Each immutable layer has a stable SQL table named sf_layer_LAYER_ID. A current alias has a revision and changes only with the expected current revision. A second dataset mapping can produce a second spatial layer while the first remains queryable.

The map displays original coordinates in the reviewed CRS. It uses the retained feature geometry and labels; it does not request external maps. The map is a preview, and its limit is shown.

## Select, analyze and save

The spatial SQL editor runs one read-only SELECT with bound parameters. It can reference original dataset tables, ordinary current views, immutable layer tables and current spatial aliases. Original attributes and raw geometry/reference columns remain alongside the native geometry column.

    SELECT object_id, GEOID, geometry
    FROM current_map
    WHERE ST_Intersects(
      geometry,
      ST_SetCRS(ST_MakeEnvelope(?, ?, ?, ?), 'EPSG:3857')
    )
    ORDER BY object_id

Parameters contain minimum X, minimum Y, maximum X and maximum Y in that layer's source CRS. The browser's bounds form prepares this same query. Clip to bounds prepares a native ST_Intersection result. Review the resulting geometry and save it as its own query.

Area analysis requires a suitable projected analysis CRS. For the United States source, an explicit CONUS equal-area analysis can use:

    SELECT object_id, GEOID,
      ST_Area(ST_Transform(geometry, 'EPSG:5070')) AS area_m2
    FROM current_map
    ORDER BY object_id

Select the projection and units appropriate to each dataset. A Web Mercator source CRS does not make its raw planar polygon area an equal-area measurement. Analysis preserves the original dataset's model attributes and units.

Every native spatial connection explicitly uses X/Y axis order. ST_Transform performs the actual coordinate transformation. Assigning CRS metadata with ST_SetCRS describes coordinates that are already in that CRS.

Save a named spatial query:

    stellar-forge-duckdb --workspace /private/customer spatial save-query selected_features \
      --sql-file selected.sql --parameters '[...]' --expected-revision 0

Saving a changed recipe requires its current revision. Preview results include the exact ordinary-view and spatial-layer bindings, which an export can pin.

## Export complete GIS work

Choose the result's one geometry column and optionally an output CRS. The geometry must carry an explicit native CRS. Selecting a different output CRS transforms coordinates before either GIS file is written.

    stellar-forge-duckdb --workspace /private/customer spatial export QUERY_ID \
      --expected-revision 1 --destination /private/exports/selection \
      --geometry-column geometry --target-crs EPSG:4326

The export runs the captured saved query once into a retained native result. It writes Zstandard-compressed GeoParquet V1 with native CRS metadata, then writes a GeoPackage features layer from those retained Parquet bytes. The GeoPackage includes a spatial index and an explicitly named geometry field.

The complete export directory contains:

| File or directory | Purpose |
| --- | --- |
| result.parquet | Complete GeoParquet result with original SQL field representations where portable |
| result.gpkg | Complete GeoPackage features layer with embedded CRS and spatial index |
| request.json | Original saved SQL revision, bound parameters and source-layer choices |
| execution.json | Native result types, portable file types, exact file descriptors and transformation |
| receiving.json | Fresh independent GDAL/Parquet receiving and full bidirectional row comparison |
| source/EDITION_ID/ | All original retained delivery, manifest, session, pages and source data files |
| RECEIVING.md | Instructions for the receiving analyst |
| manifest.json | Complete member inventory and source/result identity |

DuckDB's wide integer and nested-result representation rules carry through to GeoParquet. GeoPackage's smaller native type system requires exact text for DECIMAL, wide unsigned integers, nested data and other fields that cannot be represented losslessly. Both the browser and execution record show the original SQL type and the GeoPackage field representation. Leading-zero identifiers stay text, and null remains distinct from a non-null empty string or JSON text.

The original saved request owns a destination. If SQL or current layer selection changes later, reopening that destination verifies and returns its existing complete files. It does not substitute a newer query. An interrupted operation resumes from its recorded native Parquet and GeoPackage file identities; it preserves an interrupted uncommitted file separately.

## Independent receiving and portable reopening

Open result.gpkg in a GeoPackage-capable GIS application and select features. Open result.parquet in a GeoParquet-capable analytical reader. The embedded CRS travels with both files.

A receiving computer can run the full native comparison using only the exported directory:

    stellar-forge-duckdb --workspace /private/receiving spatial receive /private/exports/selection

The receiver opens a new native connection with access only to those two GIS files. GDAL reads the GeoPackage, DuckDB reads GeoParquet, and both directions of EXCEPT ALL compare every original typed attribute, null, WKB geometry and duplicate row. It also reads the GeoPackage CRS tables and GeoParquet metadata. A receiving error identifies the unchanged export for repair rather than silently changing its values.

The ordinary workspace handoff now carries the GIS review catalogue, immutable WKB features, current-layer revisions and saved spatial queries because they are retained in the same warehouse:

    stellar-forge-duckdb --workspace /private/customer handoff --destination /private/portable
    stellar-forge-duckdb --workspace /private/portable spatial status
    stellar-forge-duckdb --workspace /private/portable spatial query --sql 'SELECT count(*) FROM current_map'

The extension is a host runtime dependency. Install its matching signed build on the receiver or supply an existing extension path.

## HTTP and agent composition

GIS routes share the original loopback-only service, private capability, stable workspace identity, host/source checks, exact download manifests and retained request storage.

| Method and path | Operation |
| --- | --- |
| GET /api/spatial/state | Retained layers, reviews, recipes and current bindings |
| GET /api/spatial/layers/ID | Original immutable layer record |
| GET /api/spatial/reviews/ID | Original geometry review |
| GET /api/spatial/queries/ID | Current saved spatial recipe |
| POST /api/spatial/runtime | Explicit native extension and GDAL driver inspection |
| POST /api/spatial/reviews | Review the original edition geometry and CRS |
| POST /api/spatial/adopt | Retain an immutable reviewed layer |
| POST /api/spatial/activate | Select the current layer with revision comparison |
| POST /api/spatial/preview | Native-CRS geometry preview |
| POST /api/spatial/query | Bound read-only spatial SELECT |
| POST /api/spatial/queries | Save or revise a spatial recipe |
| POST /api/spatial/exports | Complete retained GIS export with original request_id |
| GET /api/exports/ID/file?name=NAME | Existing exact-manifest download |
| POST /api/requests/ID/resume | Existing saved operation continuation |

The spatial source is additive: duckdb_spatial.py, spatial_cli.py, spatial_http.py and _spatial_ui.py. Narrow hooks compose the existing backend, CLI, HTTP service and operator assets. Original customer-agent identity and request recovery continue to use duckdb_agent.py.

## Native operation

Run the provided native_spatial_operation.py against the original retained four-feature ArcGIS warehouse in a separate owned operation directory. It copies the original closed database under its normal lock and preserves its hash; it never rewrites the prior customer case.

    python -B examples/native_spatial_operation.py \
      --package /checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
      --original-workspace /original/arcgis/portable-receiver \
      --operation-dir /private/arcgis-gis-operation \
      --spatial-extension /private/runtime/spatial.duckdb_extension

The continuation covers reviewed geometry/CRS, immutable layers, native area and selection, complete GIS export, later SQL and layer revisions, reuse of original export bytes, real reprojection, an empty typed GIS result, portable workspace reopening, an independent file-only receiver, installed CLI, private HTTP and exact GIS-file downloads. It retains native-gis-result.json and the same workspace's browser continuation input.

## Primary technical references

- DuckDB spatial extension: https://duckdb.org/docs/current/core_extensions/spatial/overview
- Signed extension distribution: https://duckdb.org/docs/current/extensions/extension_distribution
- Native geometry and CRS: https://duckdb.org/docs/current/sql/data_types/geometry
- Spatial functions and GDAL readers: https://duckdb.org/docs/current/core_extensions/spatial/functions
- GDAL COPY and CRS metadata: https://duckdb.org/docs/current/core_extensions/spatial/gdal
- GeoParquet COPY options: https://duckdb.org/docs/current/sql/statements/copy
