# Original ThinkGIS county intake

This adapter turns a complete retained ThinkGIS attribute index and explicitly selected original feature responses into portable sources for the existing Upper Savannah application. It uses the ordinary `upstate.sources/v1` schema and `Workspace.import_sources` / source preparation composition path. It does not change the ArcGIS county collector or its provider catalogue.

## What it produces

| Stage | Original inputs | Usable output |
| --- | --- | --- |
| Index | Original index manifest and every byte-matched response page | Complete CSV and JSON Lines attribute inventory; native FID/PIN reference map; ordinary table source |
| Capture | Prepared index and explicit native FIDs | Resumable exact `getftr.aspx` requests, original XML bodies, response metadata, per-feature receipts and current capture ledger |
| Geometry | Prepared index and retained feature capture | Complete boundary GeoJSON, whole parcel GeoJSON where topology is unambiguous, original pixel paths, topology inventory and ordinary vector sources |

Every original county attribute remains a string, including blank values, dates and acreage. One native feature ID is the identity. Multiple FIDs carrying the same PIN remain separate features. Recorded acreage is not summed across same-PIN features.

The original county viewer draws overlay `poly` commands with `drawPolyline`, not a polygon fill operation. The adapter therefore has an explicit topology policy: a simple closed ring becomes a Polygon; several simple closed mutually disjoint rings become one MultiPolygon. Nested, intersecting, open or invalid paths remain fully represented in the boundary source. An explicit retained exterior/hole assignment can resolve genuine nested rings. No simplification, automatic repair, clipping, dissolve, synthetic vertices or invented hole rule changes the original boundaries.

## Complete McCormick source already retained

The original county viewer is <https://mccormicksc.wthgis.com/>. Map 5 uses parcel data source 46. Its original index metadata is:

<https://mccormicksc.wthgis.com/tgis/Index.ashx?action=layerIndex&dsid=46&name=Parcels>

The completed source edition contains 12,122 records, 12,122 distinct FIDs and 93 original columns, in 50 original response pages totaling 6,479,539 bytes. Page records use U+001E; fields use U+001F. Each row starts with source ordinal and actual FID, followed by the 93 original string attributes. Source ordinal 0 has a blank PIN and remains identifiable by FID and its separate tax-map number.

The original manifest schema is `upstate.thinkgis-original-index/v1`. It includes `source.county_viewer`, `county_dsid`, `original_capture_pages`, `fields` and `inventory.records`. Each response page has an ordinal interval, byte count and SHA-256. A page's local `path` may be supplied; otherwise the adapter uses the original filename from its retained `file_uri` metadata.

Materialize the already-retained source pages from their existing source bank into one local directory. Preserve each original filename. The adapter consumes those bytes and verifies every page, record count, original field count, ordinal and FID. It never downloads a new county index edition over the retained one.

## Prepare the entire index

Run from the application root containing `model/` and `source_tools/`:

```bash
python -m source_tools.thinkgis_original index \
  --manifest /data/mccormick/mccormick-original-index-manifest.json \
  --original-root /data/mccormick/original \
  --output /data/mccormick/prepared-index \
  --vintage 'Original county responses retained 2026-10-13 UTC'
```

Index preparation uses the Python standard library and existing `model.common` primitives. It creates:

- `county-index.csv`: every original record and column, preceded by namespaced source identity fields.
- `county-index.jsonl`: the same strings without CSV interpretation.
- `index.json`: source identity, full count, blank-PIN count and every reference shared by multiple FIDs.
- `sources.json`: a `kind=table`, `role=PARCEL_INDEX` source entry with all original response pages as companions.

The CSV is a native data file. Import its identifier and original attribute columns as text in spreadsheet software to preserve punctuation, leading zeros and source strings. The JSON Lines companion is lossless.

Retained originals use the existing content-addressed intake primitive and immutable views. Running the same command with the same inputs and edition reuses completed outputs. A different source edition requires a different output directory.

## Receive selected whole features

Select actual FIDs from the prepared index. The original county feature endpoint is:

```text
https://mccormicksc.wthgis.com/tgis/getftr.aspx?D=46&F=5296&Z=1
```

The exact DSID, FID and original URL are kept with every body. An ordinary PIN is never silently substituted for a FID.

```bash
python -m source_tools.thinkgis_original capture \
  --index /data/mccormick/prepared-index \
  --fids 5296,11553,11613 \
  --output /data/mccormick/selected-original-features
```

For a larger explicit selection, pass `--fids @/data/mccormick/selected-fids.txt`, with one native FID per line. Preserve that selection on every resume. Existing source owners can call `capture_features(index_directory, output, feature_ids, ...)` within their current operator queue; the function does not create another queue, application or Workspace.

Successful bodies and receipts are immutable. A completed response is reused. If interruption occurs after body publication but before its receipt, the same original body is recovered with a recorded recovery flag; a second edition is not requested. The capture ledger updates after every feature. Failed requests remain explicit and retry only with `--retry-failed`. A 429 or 503 response preserves its provider Retry-After and returns the current incomplete capture. Resume after that provider interval. The default request interval is one second; use the same source owner's acquisition policy when operating a larger selection.

Only exact successful 200 responses from the requested URL are admitted. XML remains a companion; embedded HTML in its info section is not executed.

## Prepare geometry

```bash
python -m source_tools.thinkgis_original prepare \
  --index /data/mccormick/prepared-index \
  --capture /data/mccormick/selected-original-features \
  --output /data/mccormick/prepared-features
```

Shapely is used to assess polygon topology. The existing GIS runtime already supplies it. The `--boundary-only` mode performs original delta/coordinate decoding using the standard library and emits only the whole-boundary source. Use `--allow-partial` to deliberately prepare the original bodies already received from an incomplete selection; the exact missing FIDs remain in metadata.

The county decoder follows the original `drawPoly` and `z192LL` functions:

1. Read the two original style tokens.
2. Read the first absolute z19 world-pixel coordinate.
3. Accumulate each remaining original integer delta pair.
4. Apply the county's inverse world-pixel projection to WGS84 longitude/latitude.

Every original published position, closing position and duplicate vertex is retained in `original-paths.json`. Coordinate conversion adds no geometric detail. Original z19 pixel coordinates and styles accompany the decoded positions.

### Explicit ring assignments

When an actual retained source establishes exterior and hole roles, supply a JSON file keyed by native FID:

```json
{
  "123": [
    {"exterior": 0, "holes": [1]},
    {"exterior": 2, "holes": []}
  ]
}
```

Pass it through `--ring-assignments`. Assign every original path once. Indices are zero-based in source `poly` order. Invalid assignments or invalid resulting polygon topology are rejected. The exact assignment file is a retained companion. This example explains the schema; it is not a claim about a particular county feature.

## GeoJSON contract for tract tools and native source consumers

Both outputs are GeoJSON FeatureCollections with WGS84 longitude/latitude coordinates. Original ring order and orientation remain intact:

- `boundaries.geojson`: one original LineString or MultiLineString per received FID, with `feature_role=county_parcel_boundary`.
- `parcels.geojson`: one whole Polygon or MultiPolygon per successfully resolved FID, with `feature_role=county_parcel`. This file is present when at least one original feature forms a valid polygon.

Each Feature has:

```json
{
  "type": "Feature",
  "id": "thinkgis:46:5296",
  "properties": {
    "native_dsid": 46,
    "native_fid": "5296",
    "PIN": "original unchanged string",
    "taxMapNumber": "original unchanged string",
    "feature_role": "county_parcel",
    "source_uri": "exact original feature URL",
    "source_sha256": "SHA-256 of original XML",
    "original_xml_path": "original/features/5296.xml",
    "source_index_sha256": "SHA-256 of original index manifest",
    "topology_basis": "simple_closed_mutually_disjoint_original_rings"
  },
  "geometry": {"type": "Polygon", "coordinates": []}
}
```

The shown properties are a subset of the real output; every original county field remains alongside them. The geometry in this schema illustration is intentionally empty; actual output contains all original positions.

A tract comparison must group or join by original PIN only as an explicit reference operation. Multiple FIDs must remain independently identified. County recorded acreages are original attributes, not polygon measurements; geodesic or projected areas should be separate calculated fields.

The boundary source uses `role=PARCEL_BOUNDARY`. The polygon source uses `role=PARCEL` and `id_field=native_fid`. Both retain the complete original XML, index manifest, index pages, index rows, capture plan, receipts and geometry interpretation as companions. A partial geometry selection does not acquire the entire county's polygon coverage merely because its attribute index is complete.

## Import into the existing application

Use the existing source import interface with:

```text
/data/mccormick/prepared-index/sources.json
/data/mccormick/prepared-features/sources.json
```

The original `Workspace.import_sources(path)` method accepts both manifests unchanged. Register these preparation outputs in the existing source workbench or select their manifests through the existing source-plan runner's ordinary import/compose steps. The source collection exposes real CSV/GeoJSON bodies and original companions for reopening and downloads. No second Operator is instantiated over active state.

## Source references and operation

Original viewer: <https://mccormicksc.wthgis.com/>

Original decoder: <https://mccormicksc.wthgis.com/tgis/tgisServer2.js?16122158>

Original index schema: <https://mccormicksc.wthgis.com/tgis/Index.ashx?action=layerIndex&dsid=46&name=Parcels>

Original page endpoint: <https://mccormicksc.wthgis.com/tgis/index.ashx?action=getFtrs&dsid=46&i1=0&cnt=200>

The retained decoder edition is 151,707 bytes, SHA-256 `356edc204ad4606dffe5bc846840ead10c1f4a7efb285e99f73712426e9b05e4`. Its actual drawing operation is a polyline. The complete McCormick source manifest, raw index pages and final reviewed forestry queue remain in the existing source delivery, separate from this reusable code.

Owned operation: ECO12-THINKGIS-ORIGINAL-20261013. The current ArcGIS source collector remains the owner of its existing county pipelines.


## Reproduce the completed forestry screening join

The same retained county index can reproduce the full forestry work queue from the original SCFC grouped response. This stage needs only the standard library and complete original inputs:

```bash
python -m source_tools.thinkgis_original join-screen \
  --index /data/mccormick/prepared-index \
  --screen /data/mccormick/original/scfc-grouped-screen.json \
  --county 'McCormick County' \
  --output /data/mccormick/prepared-screen
```

The source response must contain one original grouped row per tax-map reference and the exact original county value. The command preserves every input screen row; it does not reapply or invent a forestry eligibility criterion. Incomplete provider responses with `exceededTransferLimit` are rejected.

Outputs include a working queue CSV, a complete match-by-match CSV with all original county attributes, the full structured source join, a summary and an ordinary `role=PARCEL_SCREEN` source manifest. Both the original grouped response and all county originals remain companions. Feature IDs, original data-row selectors, source-page hashes and exact whole-feature URLs allow direct original-record reopening.

On the completed original McCormick source, 247 grouped forestry references match 249 native features across 246 references. Three references have two county FIDs; their recorded acreage values repeat and must not be added. Original reference `112-08-01-002.` remains unmatched in the complete index. These are observations of this retained source edition, not hardcoded expectations in the adapter.

The source queue is immediately importable through the existing source manifest path. It can be regenerated on a receiving host without depending on the session that first calculated the screening join.
