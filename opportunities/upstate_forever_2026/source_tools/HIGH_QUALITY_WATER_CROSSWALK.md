# Native classified-water geographic crosswalk

This companion turns the retained SC DES classification capture into original-geometry maps, SC Upper Savannah reporting intersections, HUC12 intersections, a legal-record association table, and a source edition accepted by the existing model workspace. Its native feature identity is the exact layer ID plus source object ID. The legal registry's 105 selected records include separate reaches and aliases; they are not a count of unique waterbodies.

## Run with the sprint's original sources

Install the source file at `opportunities/upstate_forever_2026/source_tools/high_quality_water_crosswalk.py`. The existing `source/capture_upstream_network.py` supplies polygon-ring reconstruction; it remains unchanged. The runtime needs Python 3.10+, Shapely 2, pyproj, and Fiona with GeoPackage support. The current producer caches coordinate transforms and batches GeoPackage writes for the native crossing.

From `opportunities/upstate_forever_2026/`:

```bash
python source_tools/high_quality_water_crosswalk.py \
  --capture /data/classified-water-capture \
  --mapping /data/classified-water-mapping.json \
  --project-source /data/original-upstate-source \
  --huc /data/upstream-network/network-selection.json \
  --registry source/high_quality_waters/r61-69-current.selected-reaches.json \
  --output /data/classified-water-crosswalk \
  --workspace /data/upstate-workspace
```

Paths above are local deployment examples. `--project-source` is the retained data root containing `geography/`; it is separate from the Python project directory. `--workspace` names an existing workspace and directly imports the completed local `sources.json`. Omit that argument to produce the same source edition for a different workspace. `--huc` and `--registry` can be repeated.

The module reads the original `geography/planning_basins2023/PlanningBasins2023.shp`, its sidecars, and `geography/wbd_20261012/selected-four-huc12.json.gz`. It checks the pinned original shapefile SHA256, then selects `Basin == "Upper Savannah"`, native record 5. Extra HUC inputs accept original Esri FeatureSets, GeoJSON, a single HUC12 vector layer, or the existing upstream capture's `network-selection.json` with its exact page/feature locators. Duplicate HUC IDs reuse topologically identical geometry. Conflicting geometry editions identify the exact HUC and must be reconciled to one native edition.

The reporting mask is the South Carolina planning boundary. The four focus HUC12 IDs are 030601010703, 030601010704, 030601020507, and 030601020502. Full upstream scope comes from the supplied upstream network selection. A focus HUC polygon alone does not define a utility's complete intake catchment.

## Use geography selected from an existing Workspace

Version 1.2.0 accepts original geography restored by `Workspace.source_file`.
The maintained source workbench can pass the selected files directly:

```python
planning_path, planning_entry = workspace.source_file(
    planning_selection["source_collection_id"], planning_selection["source_id"])
focus_path, focus_entry = workspace.source_file(
    focus_selection["source_collection_id"], focus_selection["source_id"])
network_path, network_entry = workspace.source_file(
    network_selection["source_collection_id"], network_selection["source_id"])

result = build_crosswalk(
    capture_root, mapping_path, None, output_root,
    planning_path=planning_path,
    focus_path=focus_path,
    huc_paths=(network_path,),
    registry_paths=(registry_path,),
    workspace_root=workspace_root,
)
```

The workbench supplies these selected identities and verified paths. Its source
snapshot retains each original body and its companions. A standalone caller can
use `--planning-basins ORIGINAL_SHP --focus-hucs ORIGINAL_FOCUS_RESPONSE` with
the same `--huc`, `--capture`, `--mapping`, `--registry` and output arguments.
When both explicit geography paths are supplied, `--project-source` is optional.
A supplied source directory remains the fallback for either omitted override.

The planning input must still be the pinned original PlanningBasins2023 shapefile.
Its .shx, .dbf and .prj companions must remain adjacent; optional sidecars are
retained when present. The producer still checks the original SHP hash and
selects `Basin == "Upper Savannah"`, native record 5. The focus input remains the
original four-HUC response; its four native IDs are checked before any extra
upstream polygons are loaded. For the complete upstream domain, the selected
`network-selection.json` must retain its original relative geometry pages,
receipts and source manifest companions. A body without those referenced files
cannot supply the actual native geometry.

This input mode preserves the output schema, physical measurements, geographic
roles and legal-association meanings. Complete original source bytes remain in
the emitted source edition. Existing 1.1.0 editions continue to open in the
source-review and designation desks.

## Map actual metadata fields

The input is intake's `upstate.classified-water-capture/v1` root. It preserves original metadata, counts, exact IDs, response pages and complete combined native features. This companion checks the retained page/combined correspondence before crossing geometries.

The external mapping has a `layers` object keyed by exact captured layer ID. Required layer keys are `class_field`, `name_field`, `status` (`current` or `proposed`) and `vintage`. Field names must match the retained metadata exactly. Optional keys are:

| Key | Meaning |
| --- | --- |
| `data_status` | Independent publisher/data label, such as provisional; does not change the legal edition |
| `catalogue_source_id` | Retained catalogue identity, e.g. scdes-water-classification-provisional-20261012 |
| `source_metadata` | Complete original metadata retained once in provenance and the source manifest; feature/HUC rows carry the exact compact reference |
| `description_field` | Original mapped reach description |
| `county_field` | Native county value; original value remains retained |
| `county_values` | Explicit native county label/code to registry county code or list |
| `county_separator` | Regex for splitting a scalar multi-county field; default comma/semicolon |
| `class_values` | Explicit raw class code to literal class label; native metadata codedValues are used when no override exists |
| `previous_class_field`, `previous_class_values` | Separately supplied former-class metadata |
| `site_specific_field`, `site_specific_values` | Separate native site-specific flag and explicit value mapping |
| `ndz_field`, `ndz_values` | Separate no-discharge-zone flag and explicit value mapping |

Retain the actual native field name even when another worker reports a likely field such as H2OCLASS. The captured metadata decides the binding. Codes unresolved by native domains or explicit mappings remain visible in `unparsed_native_class_values`; they do not silently become FW.

`parse_class(raw_value, field_metadata, layer_mapping)` returns `class_raw`, `class_label`, `class_code`, `previous_class`, `site_specific`, `rfp_high_quality_candidate` and `class_resolution`. It decodes native coded domains and literal parenthesized former-class / sp notation. It does not decide downstream applicability. An explicit former-class field and flag retain their own raw values alongside notation-derived values.

## Regulation associations

`--registry` reads intake's `upstate.classified-water-registry/v1` files and retains edition dates, original descriptions, original PDF page/line locators, former classes, site-specific qualifiers, and all current/proposed distinctions.

Optional `--bindings` accepts a list, or an object containing a `bindings` list. Each row supplies `layer_id`, `object_id`, `registry_record_id` and `geometry_relation`:

| Relation | Interpretation |
| --- | --- |
| `coextensive` | The supplied binding explicitly identifies the native geometry as the full regulated reach |
| `partial` | The source feature and legal reach relate but are not asserted to share full extent |
| `candidate` | An association awaiting geographic resolution |

Additional source/notes fields are retained. Bindings cannot mix a proposed legal edition with a current native layer.

Without an explicit binding, exact normalized name + class + at least one mapped county can produce candidates. Normalization changes Unicode form, case and whitespace only. It does not remove river/creek terms, aliases or reach endpoints. Separate legal reaches with the same name remain separate candidates. Neither a name match nor a HUC intersection expands a legal designation over a larger native feature. ECSA's receiving-water applicability module should consume these associations and original descriptions alongside its own flow-network logic.

## Outputs and measurement

The command returns the immutable edition directory, native feature count, crosswalk row count, HUC12 count, GeoPackage path, source manifest path and optional imported source collection. The directory name depends on exact input and producer bytes plus runtime versions. Completed identical editions are reusable; incomplete work retains its staging path with the originating input inventory.

| Output | Consumer use |
| --- | --- |
| `classified_water_maps.gpkg` | Projected layers in EPSG:26917; line, polygon and touch geometry separated |
| `source_reaches.geojson` | Complete source-feature geometries selected by the reporting/loaded HUC domain, with all native attributes |
| `reporting_reaches.geojson` | SC planning-boundary intersections |
| `huc_reaches.geojson` | Independent native HUC12 intersections |
| `domain_reaches.geojson` | Intersections with the union of loaded HUC12 polygons |
| `boundaries.geojson` | Native reporting and HUC boundaries used by the operation |
| `crosswalk.json`, `crosswalk.csv` | Feature-to-region identities, class/status, measures, source fractions and original legal links |
| `native_features.csv` | One row per selected native feature; original attributes retained |
| `coverage_summary.csv` | Source-feature measure sums and dissolved unique coverage by region, status and class scope |
| `legal_associations.json` | Complete supplied legal records with explicit/candidate links and unassociated IDs |
| `provenance.json` | Exact inputs, source geography roles, runtime versions and geometry operations |
| `sources.json` | Existing `upstate.sources/v1` import contract |
| `inputs/` | Original provider pages, metadata, maps, registries, mappings and producer files |

GeoJSON uses RFC 7946 WGS84 coordinates. All measurements and topology operations use EPSG:26917. Line features contribute metres of line; polygon features contribute hectares of area. Polygon perimeter is not water length. Boundary-only contacts remain as touch geometry and contribute zero measure. Original Z/M coordinates, original ring ordering and all attributes remain in native source captures; derived overlays use horizontal two-dimensional geometry.

Each HUC membership is independently valid. A source line lying along a shared HUC boundary can appear in both memberships. Use `loaded-huc12-union` for loaded-domain physical totals, or the reporting region for SC totals. Summary rows expose both feature sums and union geometry measures. The union dissolves coincident geometry within the same region, source status, class scope and geometry dimension. Adding individual HUC totals, different dimensions, or overlapping class totals is not a substitute for the relevant union.

The priority class scope includes ONRW, ORW, TN, TPGT and TPT. Current and proposed rows are separate legal editions. The independent `data_status` and `catalogue_source_id` remain on native and HUC rows, summary status lists, and manifest source labels; a provisional GIS capture stays visibly provisional. `legal_edition_status` is an explicit alias of the existing `status` column. These water lengths/areas describe the mapped classification coverage; they are neither pollutant loads nor InVEST scenario benefits. Pollutant mass and annual scenario interpretation remain governed by `model/invest320_output_semantics.json`.

## Integration API

```python
from source_tools.high_quality_water_crosswalk import build_crosswalk

result = build_crosswalk(
    capture_root,
    mapping_path,
    original_source_directory,
    output_root,
    huc_paths=[upstream_network_selection],
    registry_paths=[current_reach_registry],
    bindings_path=explicit_bindings_or_none,
    workspace_root=existing_workspace_or_none,
)
```

No shared spatial loader is modified. `Workspace.import_sources` receives the actual completed local manifest, and its original body/companion paths remain intact. Report and map consumers can resolve the derived table source ID `classified-water-crosswalk`, vector source ID `classified-water-geographic-maps`, or complete input bundle `classified-water-retained-inputs`. Native layer bodies use `<captured-layer-id>-native`.

## Source references

- Current SC R.61-69: https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf
- Current CWA-effective edition reference: https://www.epa.gov/wqs-tech/water-quality-standards-regulations-south-carolina
- Separate proposal: https://des.sc.gov/sites/des/files/Library/Regulations/5474_R.61-68%20%26%2069%20NPR_Full%20Text.pdf
- Original polygon reconstruction: existing project `source/capture_upstream_network.py`, repository blob `106b648d69c2dbe62839e9b2463fbdae3aa4c792`.
- Existing manifest contract: `model/workspace.py`, repository blob `4785867daaa959ad69a2ca955a3abc3f5ef324a7`.
- Official Shapely geometry operations: https://shapely.readthedocs.io/en/stable/manual.html
- Official Fiona vector layers and schemas: https://fiona.readthedocs.io/en/stable/manual.html

## Version 1.0.2: native class notation

R.61-69 sections E and F identify shellfish harvesting waters as `SFH` and site-specific standards with `sp`. The current parser recognizes `SFH`, `ORW(SFH)`, attached `FWsp` and `SAsp`, and spaced or parenthesized site-specific notation. It retains the original raw and resolved labels. The former `SF` literal is not silently converted to `SFH`; an actual native coded domain or an explicit `class_values` mapping can resolve a publisher code. Section H contains the original attached examples (Ashley River `SAsp`, Ashpole Swamp `FWsp`). Original source: https://www.scstatehouse.gov/coderegs/Chapter%2061-69.pdf . Registry record IDs, geography, current/proposed separation and all APIs are unchanged.

## Version 1.1.0: compact source metadata in geographic rows

The actual active source dictionary is 9,886 canonical UTF-8 bytes. Duplicating it for each of 1,886 features adds 18,644,996 bytes before HUC/region intersections, GeoJSON layers and CSV escaping. Feature and geographic rows now retain a compact source_metadata_ref. Full source metadata remains in provenance.layers and the exact original capture/mapping inputs; source IDs, data_status, raw attributes, classes, legal relations and all geographic measures retain their meanings.

The reference schema is upstate.classified-water-metadata-ref/v1. document is provenance.json, layer_id selects the unique entry in provenance.layers, member is mapping.source_metadata or source_metadata, and sha256 verifies that member encoded with the producer's canonical JSON (UTF-8, sorted object keys, no insignificant whitespace, no non-finite values). The reference is null when no source metadata was supplied. Native source metadata is still complete in the source manifest's per-layer descriptors. Compact row labels are calculated once per captured layer and reused, avoiding a repeated hash calculation inside the feature loop.

Consumers reading full metadata from an old row.source_metadata should now resolve its source_metadata_ref against the existing provenance. The operator source-review feature endpoint reads the complete source-layer metadata from provenance and returns the original metadata plus the compact row reference. ECSA's crosswalk adapter already reads provenance.json alongside native features. This producer version preserves the original output directory and creates its own content-addressed run edition.

### Native selector identity

Each retained native vector entry now declares role WATER_CLASSIFICATION, id_field and native_oid_field from capture.layers[].oid_field, class_field from the explicit mapping, and the complete original field_schema. The compact entry metadata repeats only the selector fields and publisher classification_status needed by the existing designation desk. Full original source metadata remains in its existing per-layer mapping/provenance.

For the active SCHydroClass/2 source this is OBJECTID, declared esriFieldTypeOID. The similarly named OBJECTID_1 remains an original nullable integer field; its publisher alias is preserved. The separate Water_Classifications/0 edition keeps its own native OID. These entry hints bind the existing reader to the original metadata and avoid choosing a field merely because its name resembles an object ID. The original gzip EsriJSON body and all source coordinates are retained unchanged.
