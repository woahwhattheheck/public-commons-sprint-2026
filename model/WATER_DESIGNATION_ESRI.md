# Original polygon designation receiving

## Existing operator and native command

This source completes the existing `source_tools/prepare_utility_designations.py` course. Prepare the same four published SCDES protection polygons through `prepare_public_source_water.py`, then pass that command's actual `public-water-preparation.json` to the utility designation companion. Existing saved water designation controls and `model.water_designations` remain the only selection/export path.

```sh
python -B source_tools/prepare_utility_designations.py --model-root /actual/application --workspace /actual/workspace --preparation /actual/output/public-water-preparation.json --out /actual/utility-output
```

The original ARJWS, Pioneer and combined choices retain native OBJECTIDs 11/12, 131/132 and all four, respectively. They become source-bound reusable overlays through the existing import and delivery APIs. Existing selections remain immutable; the changed reader identity creates a distinct new selection when appropriate.

## Source geometry and attributes

Declared Esri polygons use the same `OriginalEsriFeatures` reader and `esri_polygon` implementation as Receiving waters and Conservation. This interprets native ring parity and retains every required validity operation. The original response bytes, original field declarations, coordinate reference, source hash and original feature-array positions remain saved. Other supported source formats and non-polygon Esri features retain the existing Fiona read path. Invalid polygon source data is not silently diverted to a different reader.

The GeoPackage writer admits both Polygon and MultiPolygon in a generic polygon-family layer. It writes the actual interpreted geometry without flattening, joining or discarding polygon parts. The original input geometry declaration remains in the source metadata. Other native geometry schemas remain unchanged.

Esri scalar declarations map to lossless native storage for the supported integer, double and text fields. Native Esri date fields retain their epoch-millisecond values in integer columns; they are not reformatted as display dates. Original declarations travel in `source.original_fields` and `source.geometry_reader.source_fields`. Unsupported compound field values are rejected rather than converted silently. The source's original OID is used unless the selection explicitly chooses another complete identity field. CSV/JSON exports retain the original selected property values.

`selected-identities.json` contains selected_feature_provenance, with each native feature ID, source-array index, native ID basis and geometry operations. It is retained as a companion of the ordinary derived source, together with the classification rule. The selection report explicitly explains the source interpretation. GeoPackage geometry remains in the original coordinate reference; GeoJSON preview uses longitude/latitude. Geodesic source-area summaries add source records and can include overlap; unduplicated family area comes from a spatial union and remains separately identified.

## Source integration and actual receiving

Receive `model/water_designations.py`, this guide and the owned `integration/component_fragments/water-designation-esri.json` alongside current `model/spatial_esri.py` and `source/capture_upstream_network.py`. The fragment extends the existing water-designations component and preserves the shared component registry.

The actual original four-feature course completed on 13 October 2026 in project b9d5d257-c6bb-4f07-b975-8e8c63705db3. The original source body is 2,389,556 bytes, SHA256 ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285. ARJWS, Pioneer and combined selection save/reopen all completed through the unchanged helper; the full operated result is retained in the companion delivery. This corrects the actual Polygon-versus-MultiPolygon write failure, with the recorded Esri interpretation required for original features 131/132.
