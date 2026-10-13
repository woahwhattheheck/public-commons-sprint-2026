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
requested 217-HUC membership, and records null StreamOrder values as original
nulls. Geometry pages use one declared coordinate reference and consistent Z/M
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
