# Original water-context intake

This source adapter joins the existing Upper Savannah workbench's source intake.
It assembles retained NHDPlus HR stream-order and South Carolina freshwater
responses into ordinary `upstate.sources/v1` source editions, then returns the
real workspace collection/source selectors for the parcel and watershed consumers.

## Inputs

The receiver consumes an original capture descriptor alongside its original
response files. Relative paths stay inside the descriptor's directory.
Each selected layer supplies its complete metadata, original count and object-ID
responses, and all native feature pages. A layer may use several count/ID queries;
their union handles overlapping masks while each original selection stays available.

```json
{
  "schema": "upstate.water-context-capture/v1",
  "title": "Upper Savannah original stream order and freshwaters",
  "captured_at": "ACTUAL_CAPTURE_UTC",
  "scope": {
    "reporting": "Original Upper Savannah reporting mask",
    "model_domain": "Original selected 217-HUC12 domain"
  },
  "layers": [
    {
      "kind": "stream_order",
      "source_id": "nhdplus-hr-network",
      "uri": "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3",
      "metadata": "nhd/layer.json",
      "queries": [
        {
          "count": "nhd/count.json",
          "ids": "nhd/ids.json",
          "request": "nhd/request.json"
        }
      ],
      "pages": ["nhd/page-0001.json", "nhd/page-0002.json"]
    },
    {
      "kind": "freshwater",
      "source_id": "sc-hydroclass-fw",
      "uri": "https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2",
      "metadata": "fw/layer.json",
      "queries": [
        {
          "count": "fw/count.json",
          "ids": "fw/ids.json",
          "request": "fw/request.json",
          "selection": {"H2OCLASS": "FW"}
        }
      ],
      "pages": ["fw/page-0001.json"],
      "huc_ids": "domain-huc12s.json",
      "expected_huc_count": 217
    }
  ]
}
```

Use the original observed publisher URL and capture timestamp in the descriptor.
The HUC file accepts a plain list of twelve-digit source strings, or an object
whose `huc12s`, `domain_huc12s`, `HUC_12`, or `ids` member contains that list.
JSON responses may be plain or gzip compressed.

The source capture should request all native attributes, complete geometry and
a provider linear representation (`returnTrueCurves=false`) without a
generalization tolerance. Source `streamorde`, `nhdplusid`,
`permanent_identifier`, `H2OCLASS`, `HUC_12`, and native object-ID field
spellings come from the original layer metadata. The adapter retains them.

When acquisition uses an envelope before an exact polygon intersection, add
these fields to the layer descriptor:

```json
{
  "selected_ids": "nhd/domain-selected-object-ids.json",
  "selection_geometry": "domain/original-domain.geojson",
  "selection_method": "Original returned flowline geometry intersects the retained original domain polygon"
}
```

`selected_ids` is the exact resulting native integer ID list or an original
`objectIds` object. Every selected ID must belong to the complete acquired query.
All acquired responses accompany the source edition. The resulting vector keeps
the entire original selected feature geometry, and the intake record carries
both the provider candidate count and the selected feature count.

## Physical-domain freshwater selection

Freshwater defaults to `huc_selection_mode: "publisher"`. In that mode each
selected feature's original `HUC_12` must belong to the retained HUC12 list,
preserving the existing publisher-membership operation.

Use `huc_selection_mode: "geometry"` for a capture selected against the actual
retained watershed polygons:

```json
{
  "kind": "freshwater",
  "source_id": "sc-hydroclass-fw-physical-domain",
  "huc_selection_mode": "geometry",
  "huc_ids": "retained/domain-huc12s.json",
  "expected_huc_count": 217,
  "selected_ids": "comparison/physical-selected-ids.json",
  "selection_geometry": "domain/model-domain.esri.json.gz",
  "selection_method": "Union of original native-ID intersection queries against every retained domain polygon"
}
```

These fields extend a complete layer descriptor containing the original metadata,
count/ID queries, pages and companions. Geometry mode requires all three of
`selected_ids`, `selection_geometry` and `selection_method`. The selected IDs
must be a subset of the full original query union; every acquired ID must still
have its original geometry page. Unknown selection modes are rejected.

A selected reach can physically intersect the retained study while its original
publisher HUC label names another watershed, or is null or blank. Geometry mode
preserves that native label and retains the selected reach's full geometry.
The layer-intake record contains:

- The explicit selection mode and retained original selection geometry reference.
- `publisher_huc_inventory`, an ordered inventory of original values and feature counts.
- `publisher_huc_mismatches`, with native object ID, original publisher HUC value and reason.
- `publisher_huc_mismatch_count`, also exposed in the source manifest, binding and intake summary.

Native nulls and blanks remain distinct values. Their JSON ordering is explicit
and does not convert original labels into new HUC identifiers. The separate
many-HUC relationships and physical/publisher cohort comparisons can travel as
source companions. The consumer uses the retained polygon relationships for
spatial interpretation.

The acquisition companion `source_tools/freshwater_domain_coverage.py` reuses
the complete original publisher-HUC pages, captures count/ID intersections for
the original domain polygons, downloads geometry only for additional native IDs,
and supplies this geometry-mode descriptor to the ordinary `assemble`,
`export_edition` and `bind_workspace` interfaces.

A genuine zero-result original ArcGIS response containing `objectIds: null`
is accepted only alongside an original integer count of zero. Missing ID fields,
truncated responses and inconsistent nonzero counts are rejected. Original
response bytes remain retained unchanged.

## Recovered response times and native geometry

If a process retained all original response bodies but every original query
receipt lost its capture timestamp, use `captured_at: null` with
`capture_time_status: "unavailable_after_response_recovery"` in the capture
descriptor. This explicit recovery case remains null through the intake,
bindings and original source metadata. The manifest's required nonempty vintage
uses the label `Capture time unavailable after response recovery`. Retained
responses with actual timestamps continue to use their original capture time.

The intake preserves provider-returned linear paths from the selected
`returnTrueCurves=false` responses. Curved native `curvePaths` or
`curveRings` require a separately retained provider linear representation;
the receiver does not flatten them locally. All original response bytes and
declared Z/M dimensions remain companions to the assembled vector.

## Build and import

Install the file as `source_tools/water_context_intake.py` in the current
application. The assembler itself uses the Python standard library. An equipped
application supplies its normal GIS readers and `model.workspace` for import.

```sh
python -B -m source_tools.water_context_intake \
  --capture /owned/original-water-capture/capture.json \
  --output /owned/sources/water-context-20261013
```

To import that same edition into an existing workspace:

```sh
python -B -m source_tools.water_context_intake \
  --capture /owned/original-water-capture/capture.json \
  --output /owned/sources/water-context-20261013 \
  --workspace /owned/upper-savannah-study \
  --bindings-output /owned/water-context-bindings.json
```

The second command reuses the existing edition after checking its retained files.
It then invokes the ordinary `Workspace.import_sources` operation.
`bindings-output` contains the actual returned `source_collection_id`
and original source IDs, field names, roles and the freshwater selector.

The public Python interface also accepts an existing workspace object:

```python
from source_tools.water_context_intake import assemble, bind_workspace

receipt = assemble(capture_path, edition_directory)
bindings = bind_workspace(workspace, edition_directory)
stream_order = bindings["bindings"]["stream_order"]
freshwater = bindings["bindings"]["freshwater"]

stream_source = {
    "source_collection_id": stream_order["source_collection_id"],
    "source_id": stream_order["source_id"],
}
freshwater_source = {
    "source_collection_id": freshwater["source_collection_id"],
    "source_id": freshwater["source_id"],
    "where": freshwater["where"],
}
```

The stream-order source carries role `NHD_STREAM_ORDER` and default ID
`nhdplus-hr-network`. The freshwater source carries role
`WATER_CLASSIFICATION` and default ID `sc-hydroclass-fw`.
The adapter adds a source collection; the previous NHD edition, the existing
1,886 selected-class features, and separate impairment sources keep their own
source identities.

The same collection/source selector can feed the current
`watershed.context.analyze` action. Use the exact native field binding when
a consumer asks for the StreamOrder or HUC field. A derived high-quality-water
selection should use the separately retained designation source and the
consumer's saved relationship method.

## Receiving outputs

- `model-sources.json`: ordinary workbench source manifest.
- `bindings.json`: original source IDs and field bindings before workspace import.
- `SOURCE_ID/features.esri.json.gz`: complete selected feature collection with
  its actual returned CRS and original attributes/geometry.
- `SOURCE_ID/layer-intake.json`: original query membership, domain selection,
  counts, source references and native field bindings.
- `SOURCE_ID/original/`: exact original metadata, count, ID, feature, selection
  and companion files, retained under content-derived directories.
- `intake.json`: the complete source-edition member inventory for reopen.
- The optional external binding file: live workspace collection and source
  selectors returned by the existing importer.

The receiver requires complete count/ID/page membership, detects changed duplicate
objects between responses, keeps a valid zero-feature selection, preserves the
retained 217-HUC selection and explicit membership mode, and records null
StreamOrder values as original nulls. Geometry pages use one declared coordinate reference and consistent Z/M
dimensions. Source acquisition and scientific interpretation stay explicit in
the retained study.

## Exact native domain selection

`source_tools/water_context_geometry.py` reads the original `model-domain.esri.json.gz` and `feature-bindings.json` directly from the retained domain ZIP. Its `select_domain_objects(domain_archive, pages, output, metadata=..., capture_root=...)` entry point returns native selected IDs and descriptor-ready original domain companions. Returned paths are relative to the original capture directory; `capture_root` defaults to the output directory's parent. It uses the maintained acquisition parser's polygon assembly and Shapely intersections; the original source geometry remains available unchanged. The helper requires Shapely 2, and uses pyproj when the original domain and flowlines have different coordinate references.

```sh
python -B -m source_tools.water_context_geometry \
  --domain-archive /owned/dbc61-upstate-model-domain-20261012.zip \
  --metadata /owned/original-water-capture/nhd/layer.json \
  --pages-json /owned/original-water-capture/nhd/pages.json \
  --output /owned/original-water-capture/domain-selection \
  --capture-root /owned/original-water-capture
```

The page-list JSON contains the actual original feature-page paths, relative to that list file. Merge the helper's result into the stream-order layer descriptor. Its selected IDs, geometry and companion paths are already relative to the capture directory used by `assemble`. Domain selection includes boundary intersections and retains the entire original selected flowline feature. Polygon holes follow the original acquisition parser's ring assembly; additional native flowline ordinates are preserved while the selection uses XY coordinates in the declared CRS.

## Native model selections and complete transfer

The importer returns both selector spellings used by the existing product.
Each binding contains `source_collection_id` for the regional provider and
`native_reference` for source-native model APIs:

```json
{
  "collection_id": "<actual imported collection identity>",
  "source_id": "nhdplus-hr-network",
  "id_field": "OBJECTID"
}
```

The freshwater native reference also retains the exact
`where: {"H2OCLASS": "FW"}` selection. Native reference identities come
from the returned Workspace source collection and are checked against the
imported body hash and role. The original binding fields remain available.

The current Water and Habitat Context computational core, ECO-CONTEXT13
revision 3, accepts the returned stream-order reference directly:

```python
from model.workspace import Workspace
from model import water_context
from source_tools.water_context_intake import bind_workspace, water_context_spec

workspace = Workspace("/path/to/existing/workspace")
bindings = bind_workspace(workspace, "/path/to/prepared-water-edition")
boundary = {
    "collection_id": "<existing retained polygon collection>",
    "source_id": "<existing reporting-boundary source>",
}
selection = water_context_spec(
    bindings,
    boundary,
    title="Upper Savannah native stream-order context",
    overlays=current_retained_overlays,
    relations=current_retained_huc_and_utility_references,
)
result = water_context.build(workspace, selection)
```

`water_context_spec` adds the imported source to the original
`overlays.stream_order` slot. It preserves supplied NWI, hydrography,
waterbody and protected-land selections and rejects conflicting stream-order
editions. The existing core reads the original native `streamorde` field,
`NHD_STREAM_ORDER` role and gzip Esri body through
`model.rasters.native_vector_path`. Its original model owns measurements,
intersections, saved assessments, and exports.

The raw source edition can now travel as one complete archive. The exporter
streams all original page bodies, exact metadata/query responses, assembled
native bodies, manifest and bindings into a single ZIP. Already compressed
agency bodies retain their compressed bytes. Every member is checked against
the intake inventory while being packaged.

```bash
python -m source_tools.water_context_intake \
  --capture /path/to/original/capture.json \
  --output /path/to/prepared-water-edition \
  --archive-output /path/to/upper-savannah-original-water.zip
```

On the receiving machine:

```bash
python -m source_tools.water_context_intake \
  --receive /path/to/upper-savannah-original-water.zip \
  --output /path/to/received-water-edition \
  --workspace /path/to/existing/workspace \
  --bindings-output /path/to/imported-water-bindings.json
```

The receiver checks exact membership, paths, original lengths and hashes
before publishing the restored edition directory. Its Workspace import
retains the complete original companion relationships, so the normal
scientific workspace archive carries the sources onward.

For a queue-ready Water and Habitat Context selection, supply a JSON file
containing the existing polygon reference:

```bash
python -m source_tools.water_context_intake \
  --capture /path/to/original/capture.json \
  --output /path/to/prepared-water-edition \
  --workspace /path/to/existing/workspace \
  --water-context-boundary /path/to/reporting-boundary-reference.json \
  --water-context-spec-output /path/to/water-context-selection.json
```

The regional watershed context edition continues through the maintained
47DB `source_tools/prepare_watershed_context.py` bridge. Its full-domain
context, NRCS CSV, exact HUC array and classification coverage use their
source entry and companion reconstruction. The sources in this module join
that workflow as the independently selectable native NHDPlus stream-order
and South Carolina freshwater editions.

## Freshwater source context for parcel criteria

Every freshwater intake entry declares its actual `FW` class scope and native
classification field under `metadata.parcel_criteria`. The maintained parcel
source profile recognizes this edition as a freshwater classification source.
The shared SCHydroClass service URI does not cause a freshwater-only edition
to replace the separate ORW/TN/TPGT source.

A complete physical-domain capture may additionally declare:

~~~json
{
  "criteria_coverage": {
    "method": "provider_intersects_each_original_domain_polygon",
    "huc12_field": "HUC12",
    "uri": "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6",
    "vintage": "Original retained model-domain polygon edition"
  }
}
~~~

Use the exact field present in the retained domain. Intake checks the original
HUC set, every queried polygon, native query count/ID union and selected source
IDs. It adds a `SOURCE_COVERAGE` vector entry that points to the unchanged original
domain gzip already retained in the edition. Its exact source reference,
geometry hash and criterion class scope travel in `parcel-coverage.json`.

The freshwater entry's `metadata.criteria_coverage.source` initially contains
only its related `source_id`. This explicitly means the same imported source
collection. The parcel resolver supplies that collection's actual immutable ID;
a supplied cross-collection reference remains explicit. Export and receive keep
the original polygon bytes and relative source relationship intact.

`bind_workspace` returns `parcel_criteria_sources.classifications` with real
collection/source IDs, native fields, `class_scope: ["FW"]`, the original
attribute filter and, for physical captures, its original coverage binding.
Pass this object as the `sources.classifications` override to the existing
parcel-criteria builder. Automatic selection prefers the complete physical
freshwater context over the publisher-HUC-only freshwater edition.

A parcel with a retained SCDES FW intersection is positive. A negative inside
complete queried coverage means no matching retained FW feature in this source
inventory. It does not establish ecological freshwater absence where another
state's inventory is missing. Outside the queried coverage the classification
criterion remains unknown. Publisher-HUC captures without the complete physical
query retain no inferred polygon coverage.

The source metadata and explicit selector preserve this meaning and original
reference alongside class scope. Parcel decision JSON carries that scope and
each requested classification result in the row evidence, with the complete
source/coverage bindings in the same export. Original high-quality, impairment
and freshwater sources retain their separate class scope and scientific meaning.
