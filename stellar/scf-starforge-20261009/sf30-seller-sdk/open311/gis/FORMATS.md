# GIS file interoperability

The GIS desk exports four editable handoff formats and a complete printable report. The immutable original row is retained beside separate analyst fields. A complete GIS workspace JSON also carries every original source file, uploaded analyst file, historical handoff, saved decision and dispatch.

## GeoPackage

The writer uses the [OGC GeoPackage 1.4.0 standard](https://www.geopackage.org/spec140/index.html), implemented through Node's built-in SQLite database. The file has application_id 0x47504B47 and user_version 10400.

| Table | Purpose |
| --- | --- |
| gpkg_spatial_ref_sys | Required undefined Cartesian/geographic systems and EPSG:4326 WGS84 |
| gpkg_contents | Registered feature and attribute tables, UTC last-change values and feature extent |
| gpkg_geometry_columns | open311_features.geom as two-dimensional EPSG:4326 POINT |
| open311_features | Integer fid, standard binary Point or SQL NULL, original columns and analyst fields |
| open311_handoff | Complete saved handoff/dispatch metadata, source identity and return binding |
| open311_sources | Complete unchanged imported collection/report texts and their original file hashes |
| open311_coverage | Original collection selections, provider/window coverage and attribution |

Located geometry uses the standard GP header followed by ordinary two-dimensional Point WKB, with X=longitude and Y=latitude. This order follows the GeoPackage requirement even where an authority's general SRS definition lists axes differently. The reader understands little- or big-endian header and WKB independently, with either no envelope or an XY envelope. It accepts the standard empty-Point representation as NULL and preserves unlocated features as ordinary rows.

The source's latitude and longitude must both be finite values within WGS84 bounds. Missing or invalid source coordinates create NULL geometry. The original coordinate values remain in source_latitude/source_longitude and the complete source_json. Top-level original x/y appear literally in source_projected_x/source_projected_y; nested projected attributes remain in source_json. A transform requires an explicitly implemented and selected source-coordinate contract.

Open open311_features in a GIS application that supports GeoPackage feature editing. Preserve its source/identity columns and edit geom plus the analyst columns. The original attribute tables can be inspected alongside the layer. A returned layer must retain the standard source columns and its EPSG:4326 declaration. The importer retains invalid rows as conflicts. A re-export with one renamed compatible layer is accepted when its complete original columns identify it unambiguously.

The reader opens the selected SQLite file read-only with extensions disabled and trusted_schema off. It reads an ordinary feature table and its declared geometry metadata. Source lineage is checked against the saved handoff after decoding.

## GeoJSON

The file is an [RFC 7946 FeatureCollection](https://www.rfc-editor.org/rfc/rfc7946.html), with WGS84 Point coordinates [longitude, latitude] or geometry:null. A bbox is present only when the complete selection contains located geometry.

Feature id and feature_key identify the saved source identity. Properties contain the full original source columns and separate analyst fields. The foreign member open311 carries the selected handoff ID/hash, source-file descriptions and original coverage. Edited returns preserve the row identity/source columns. CRS reprojection must be completed explicitly before returning RFC 7946 coordinates.

## Analyst JSON

The schema is commons.open311.gis-analyst.v1. It contains handoffId, handoffSha256, original source/coverage metadata and a rows array. Each row has the same flat original/analyst columns plus a geometry Point or NULL.

This format is convenient for scripted analyst tools. Use the saved original handoff fields and change only geometry or the documented analyst columns. Dispatch JSON instead contains the complete sealed reviewed-dispatch record and source descriptions.

## CSV

CSV uses UTF-8, quoted RFC 4180-style fields, doubled quotes inside quoted values and CRLF record separators. Embedded commas, quotes, Unicode and line breaks remain in their original fields. Point geometry uses longitude and latitude; two empty cells represent NULL. Both coordinate columns are required in an analyst return.

The columns include the original source values, canonical source_json/source_review_json/report_context_json and these editable fields:

| Column | Meaning |
| --- | --- |
| assigned_team | Operator-selected responsible team |
| asset_id | Selected asset reference |
| work_order_id | Selected work-order reference |
| priority | Explicit operator priority text |
| action | review, dispatch, defer or dismiss |
| due_date | A real YYYY-MM-DD date or empty |
| analyst_note | Analyst's operating note |
| longitude / latitude | WGS84 geometry, or two empty cells |

The final open311_csv_encoding column is reserved and contains apostrophe-v1 on every row. Text beginning with an apostrophe, or a spreadsheet formula prefix =, +, -, @ after leading whitespace, is prefixed with one apostrophe when written. The declared decoder removes that one protective prefix when importing. A literal initial apostrophe therefore appears doubled in the raw CSV. This convention keeps exported source text inert in common spreadsheet workflows while preserving an exact reversible representation.

Keep the encoding column when editing this exported CSV. GIS/CSV tools that display the literal protective apostrophe retain it in the returned file; the importer applies the declared decoding. A separately produced unmarked CSV is read literally. Source-field equality is checked after decoding.

Reviewed dispatch CSV uses the selected destination column names, four forced source/handoff identity columns and the same encoding marker. Dispatch column names must be distinct and cannot use any reserved identity/encoding name.

## Returned changes and source geometry

The source_geometry_state describes the original source: SOURCE_POINT, MISSING_COORDINATES or INVALID_COORDINATES. The current geometry and geometryOrigin distinguish a later accepted analyst location from that original state.

Source column changes, duplicate keys, unknown features, missing columns and invalid coordinates remain individual conflicts. Missing rows are listed separately. A returned file can contain both valid proposals and conflicts; a supervisor selects the proposals to decide.

The original returned file bytes remain downloadable through kind returned. This includes invalid structural files retained for review, their errors and the original handoff selection. Current source versions and competing analyst fields are checked again when applying a decision.

## Complete original attribution

Each imported source's publisher, title, license, license URL and source URL are retained. GeoPackage attribute tables and the complete GIS workspace preserve the original collection/report text. HTML includes the original source selection, coverage, attribution, literal status notes and original selected records. The file formats retain those distinctions through subsequent receiving and reopening.
