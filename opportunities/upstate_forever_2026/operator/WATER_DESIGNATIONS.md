# Water designations

This desk turns retained source classes or selected feature identities into a reusable GIS layer and an original map-delivery choice. It keeps the native source edition, exact class values, selected IDs, rule reference, original geometry, and exports together in the scientific workspace.

## Operator workflow

1. Open **Water designations** and choose a retained source edition. The source list shows its title, role and edition. Inspect the native ID field and class field before selecting records. Where an edition supplies its authoritative ID binding, that binding is used. The ID override supports another verified native field.
2. Choose exact classes, individual features, or the complete source. Search and bulk selection operate on the loaded page; use **Load more** to inspect additional records. The displayed class totals cover the complete retained source. An explicit exclusion removes that exact feature from the selection.
3. Preview the choice. The map uses original source geometry in longitude and latitude. The selection summary reports complete feature counts, class counts, mapped line length, and mapped polygon area. Preview geometry is paged; the GeoJSON and CSV export actions include every selected record.
4. Record a meaningful title and the classification rule's title, source URL, edition and section. High-quality-water saves require the rule title, source and edition. A revised selection retains its original saved-selection reference.
5. Save the selection. This uses the original operator task queue and retains a native GeoPackage, full GeoJSON and CSV, original feature identities, rule reference, readable HTML report and source manifest.
6. Reopen a saved selection from the desk. **Use in delivery** opens the existing delivery form with the selected overlay already populated. Complete the original form's run and scenario choices. The original delivery engine reads the selected source directly.
7. Transfer the scientific workspace through its normal backup and receiving workflow. The saved designation, its original source, GIS output, rule reference and extension source travel with the workspace.

## Class and reach choices

A waterbody name can span multiple designations. The captured Chattooga and Chauga edition contains these exact source groups:

| River | Exact class | Features | Native mapped line length |
|---|---|---:|---:|
| Chattooga | ORW | 248 | 64.652 km |
| Chattooga | FW | 3 | 0.567 km |
| Chauga | ORW | 84 | 66.869 km |
| Chauga | FW | 42 | 33.965 km |

Selecting ORW gives 332 features and approximately 131.521 km in the publisher's stored line-length field. The desk separately calculates ellipsoidal mapped line length from the selected coordinates. Both banks and shorelines occur in this source, so the metric describes the total mapped linework.

R.61-69 lists the Chattooga ORW reach from the North Carolina line to Opossum Creek, followed by FW to the Tugaloo. It lists the Chauga ORW reach from its headwaters to one mile above U.S. Route 76, followed by FW to the Tugaloo. Its notation in parentheses after ORW or ONRW records the previous class. Its sp annotation records site-specific standards.

Use exact source values when selecting. The legal-source crosswalk and source-review desk explain class meaning and retain the associated legal context. The current shared crosswalk is source_tools/high_quality_water_crosswalk.py v1.1.0, paired with source-review v1.3.0 in operator/water_source_review.py and operator/WATER_SOURCE_REVIEW.md. It handles SFH and attached sp notation and binds each layer to its native OID and retained publisher metadata.

## Source editions and geometry

The included demonstration data is the complete named-river capture from the SCDES Water_Classifications/MapServer/0 provisional service. The original layer uses EPSG:26917; this saved GeoJSON capture uses EPSG:4326. Its authoritative feature ID is OBJECTID_1. The separate SCHydroClass/MapServer/2 edition uses OBJECTID as its native OID. Preserve each edition's own binding and source hash.

The capture contains all 377 feature identities returned by the same service predicate. Its original properties include H2OCLASS, HYDNAME, HYDTYPE and HUC_12. Valid records can have blank Basin or county fields; use the actual source geometry or explicit HUC membership when preparing a larger geographic source edition.

For drinking-water overlays, select an actual protection-area polygon source. Intake points and designated river linework have different purposes. The protected-lands choice likewise uses actual polygon geometry. Area totals add original polygon records, so overlapping source records may contribute more than once. The retained GIS output preserves the actual selected geometry for later union or spatial analysis.

## Run the captured native workflow

Materialize this source bank beneath the current original application root. It supplies fourteen complete files; the shared extension host and original Workspace remain the application dependencies.

Run from the application root with the same Python environment used by the original GIS operator:

```bash
python source_tools/receive_water_designations.py \
  --sources source/water-designations-case \
  --workspace /path/to/chattooga-chauga-workspace \
  --output /path/to/chattooga-chauga-results
```

The command imports the original 377-feature edition, checks its independent provider ID set, selects the 332 ORW records, saves and reopens the native GIS output, exports all rows, feeds the saved source through the original delivery overlay reader, exercises an exact exclusion and an individual feature, retains original driver-FID identity, and transfers/reopens the workspace through the original archive path. It writes water-designation-receiving.json, delivery-overlay.json and a complete workspace archive. Repeating the command reuses an archive only after verifying the same workspace, saved selections and application file hashes; changed application source produces a new content-addressed archive and receiving directory.

The retained data file is chattooga_chauga_classified_water.geojson, SHA-256 eecab9bc33f02ab393c178297d966b35e9c372887b5fd23eaf00cc85817fbcea. The workflow expects those exact original bytes. GIS dependencies are the original application's Fiona, PyProj and Shapely runtime; source-to-delivery operation uses the same original model modules.

## Two-utility protection-area workflow

[Water source decisions](WATER_SOURCE_DECISIONS.md) gives the complete ARJWS and Pioneer example. After the existing public-water preparation imports the original four protection polygons, source_tools/prepare_utility_designations.py saves and reopens both utility selections and their combined selection. Use the combined selection for a map containing both utilities; the original delivery has one drinking_water overlay slot.

## Shared operator integration

Extension ID: water-designations. Descriptor: operator/extensions/water-designations.json. Frontend factory: createWaterDesignationsExtension. Backend module: operator/water_designations.py, imported as the flat module water_designations by the extension host. Native implementation: model/water_designations.py.

On an application with the maintained ECSA shared extension host, materialize the fourteen release files beneath that application root, then launch the original operator. The current complete host source is the 25-file bank in the original Eco coordination thread (Drive file 15Hbqz3vXjiJAzp7ue7bhoka4BVgrByD6), including the nested-GIS route update. The earlier f293 Git source establishes the original host contract.

```bash
python -B operator/server.py \
  --workspace /path/to/chattooga-chauga-workspace \
  --operator-state /path/to/operator-state \
  --source-root /path/to/application/source/water-designations-case \
  --port 0
```

The first standard-output record supplies the actual operator_url, origin and workspace_key. Use the emitted URL for the browser. A new installation of the shared host uses its complete source tree and the actual command `python -B install_extensions.py --application /path/to/application --source-root /path/to/full-host-source`; the installer also supports --dry-run. The descriptor and all release files must be materialized separately.

The desk exposes the original action water-designation.save through /api/actions. It uses /api/task?id=... for the actual task record. Its extension routes are GET /api/water-designations, POST /api/water-designations/inspect, POST /api/water-designations/preview, GET /api/water-designations/item, POST /api/water-designations/export and POST /api/water-designations/apply. The original authentication, workspace registration, task queue and download tickets remain in use.

The source-review handoff calls openSelection with collection_id, source_id, optional layer, id_field/native_oid_field, class_field, expected_source_sha256, source_feature_refs, rule_reference and legal_record_context. Feature references carry their own typed native feature_id and source identity. The method navigates to the designation desk and applies the choice after mounting. The receiving desk validates the exact source identity and hash before previewing. The top-level rule_reference populates the legal fields even when legal_record_context is an array.

The complete incoming handoff is cloned into source_context and retained in the saved native specification. The desk displays the related legal records and their reach associations and can export the complete source context as JSON. Reopening restores that context; choosing a different source edition clears it. This keeps the legal-source relationship attached to the chosen GIS features throughout save, reopen and transfer.

Use-in-delivery calls the original host openDelivery with overlays keyed by the saved purpose, containing the saved source_collection_id, source_id and layer. This preserves the original delivery form's model-run requirements and selection workflow.

## Primary references

- Official RFP: https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf
- R.61-69, Classified Waters, Sections E-F and H: https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf
- R.61-68, Water Classifications and Standards: https://des.sc.gov/sites/des/files/Library/Regulations/R.61-68.pdf
- Captured native service: https://gis.des.sc.gov/gisserver/rest/services/water/Water_Classifications/MapServer/0
- Shared extension host source: https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/f293e68f7f490346280419ae447748ef95ec76a3/opportunities/upstate_forever_2026
