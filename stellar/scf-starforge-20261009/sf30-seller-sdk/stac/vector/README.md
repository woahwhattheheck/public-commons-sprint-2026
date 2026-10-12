# Native vector delivery

This module turns an original retained vector selection into complete GeoPackage
and Shapefile deliveries. It carries the original input files, every selected
feature, source identities, field mappings, native output files and complete
receiving information together. The browser operator and CLI use the same native
engine and the same original destination requests.

It joins the maintained STAC customer receiver and QGIS project engine. Provider
search, WFS acquisition, source selection, orders and customer relationships stay
in their existing controllers. A completed vector export is an additional
portable source for the original QGIS workspace.

## Operate a selected native runtime

Use the Python environment containing the actual Fiona/GDAL installation.
The engine reads its installed versions and available drivers. Its file and
geometry operations enter that Fiona package's own GDAL/PROJ environment; it
uses the package's data directories when they exist.

~~~sh
node stac/vector/cli.mjs capabilities --python /absolute/venv/bin/python
node stac/vector/cli.mjs serve \
  --root /absolute/customer-files \
  --python /absolute/venv/bin/python
~~~

The server prints its local session URL. Keep that process running while using
the browser. Filesystem paths in the browser are relative to the explicit data
directory, or absolute paths within it. The session is local to the operator;
the selected Python executable is configured at startup.

The interface has five views:

1. **Sources:** import a complete original selection, capture its files and open
   its actual native layer/schema inventory.
2. **Native mapping:** review every original field, choose target formats and
   CRS, edit native aliases or explicit representations, and save/import the
   complete profile.
3. **Packages & receiving:** reopen complete native files, create/download the
   full ZIP and receive it at a new directory.
4. **Compare editions:** match original feature identities, inspect added,
   removed or changed features, and retain both complete source editions.
5. **Operations:** read original requests/results and continue the same request
   after an interrupted response.

Mapping drafts are associated with the exact captured manifest. Opening another
source capture keeps its mapping draft separate. Rendering the field table
preserves an imported profile until an operator changes a control.

## Receive original source files

A selection has schema **starforge.vector-selection.v1** and these fields:

| Field | Value |
| --- | --- |
| id | Stable selection ID; letters, digits, dot, underscore or hyphen, at most 96 characters |
| sourceEdition | Complete original edition/binding metadata supplied by the existing source owner |
| sources | Selected original file descriptors and explicit native layer/identity choices |
| sources[].id | Stable logical source ID across comparable editions |
| sources[].path | Original file path relative to the selected source directory |
| sources[].bytes / sha256 | Original byte count and SHA-256 |
| sources[].driver | Optional explicit supported native driver |
| sources[].layer / layers | Original native layer name or selected names; omission selects all native layers |
| sources[].archiveMember | Original selected member when the source is a ZIP |
| sources[].members | Complete original sidecar descriptors for an unpacked Shapefile |
| sources[].identity | Feature ID, declared property fields, or explicit original position |

Supported input drivers are GeoJSON, GeoJSON sequence, GeoPackage, Shapefile and
FlatGeobuf. An unpacked Shapefile needs its original .shp, .shx and .dbf; include
its .prj, encoding file and other source components when they exist. ZIP intake
retains the complete original archive and validates its selected member set.

Identity choices are:

~~~json
{"mode":"feature-id"}
~~~

~~~json
{"mode":"fields","fields":["original_source_id","original_feature_id"]}
~~~

~~~json
{"mode":"position"}
~~~

Feature IDs and declared property keys remain typed. A missing feature ID uses
its original row position and records that choice. Duplicate identities keep
every occurrence. Comparison identifies repeated or incomplete keys explicitly,
including ambiguity present in only one edition. A GeoPackage layer keeps its
logical ID from the selected source and original native layer name; adding a
neighboring layer does not rename its existing features.

~~~sh
node stac/vector/cli.mjs capture \
  --selection /absolute/original-selection.json \
  --source-root /absolute/original-files \
  --out /absolute/vector-capture \
  --python /absolute/venv/bin/python

node stac/vector/cli.mjs inspect \
  --directory /absolute/vector-capture \
  --python /absolute/venv/bin/python
~~~

The capture keeps complete source bytes and an indexed catalog of original
features. Its inspection records each layer's actual native schema, CRS, field
presence, nulls, original value kinds, value capacities, identity multiplicity
and complete sample feature JSON. A GeoJSON stream is read incrementally;
features are not reduced to a sample.

GeoJSON integers and fractional values enter the catalog without first being
rounded to floating point. Original numeric spelling remains in the retained
source file; the catalog keeps exact typed numeric values. Native fields are
used where the target can preserve a value. A fractional value beyond native
double precision uses exact JSON text, or its full original-value reference
when the Shapefile field capacity requires it. An explicit native field rule
that would round such a value returns a field-mapping error.

### Join the original STAC receiver

For a previously received portable STAC directory:

~~~sh
node stac/vector/cli.mjs stac-capture \
  --directory /absolute/portable-stac \
  --out /absolute/vector-capture \
  --selection-id received-scene-footprints \
  --python /absolute/venv/bin/python
~~~

The default selection is the original portable scene-footprints.geojson.
Use --assets with a JSON array of explicit received vector paths to select other
files. An asset path uses its original portable location, such as
edition/original-asset-path. Each selected entry may include a stable id,
native layer choice, identity policy and companion paths.

The bridge asks the original receiver to verify the selected file, then uses
its original declared byte count and digest. A second read is compared with
that same descriptor. It cannot promote changed bytes into a new descriptor
under an older source edition.

For a completed original customer delivery that has not yet been projected
into portable GIS:

~~~sh
node stac/vector/cli.mjs stac-materialize \
  --directory /absolute/original-customer-delivery \
  --portable /absolute/portable-stac \
  --capture /absolute/vector-capture \
  --out /absolute/native-vector-export \
  --operation-id customer-native-vector \
  --python /absolute/venv/bin/python
~~~

This composes the existing StacDelivery and exportPortableStacDelivery with the
same vector capture/export engine. Original bundle, selection, edition and
native binding identities are retained in sourceEdition.

## Review native representation

The complete profile uses schema **starforge.vector-export-profile.v1**:

~~~json
{
  "schema": "starforge.vector-export-profile.v1",
  "formats": ["GPKG", "ESRI Shapefile"],
  "layers": {},
  "shapefile": {
    "longValues": "reference",
    "collections": "split"
  }
}
~~~

Layer rules are keyed by the actual source layer ID shown by inspect. Every
source field remains in the complete delivery. Per-layer rules support name,
label, sourceCrs, assignSourceCrs, targetCrs, fieldOrder and fields. A field rule
may supply mode, physicalType and native names keyed by GPKG or ESRI Shapefile.
Complete extra profile metadata survives import and export.

| Representation | Native result and retained source |
| --- | --- |
| auto | Chooses native storage where the original values are representable; otherwise uses explicit JSON or references |
| native | Uses the operator's explicit physicalType and verifies every native readback value |
| json | Stores typed JSON text where a native scalar field cannot represent the original value |
| reference | Stores the value's SHA-256 beside its complete typed original record |
| sidecar, when required by Shapefile field capacity | Keeps the original field and value in the complete source ledger |

The mapping records original field name, native alias, codec, declared and
observed physical type, original value kinds, presence, nulls and the reason for
the representation.

GeoPackage can retain 64-bit native integers. The browser/Node JSON boundary
retains unsafe JavaScript integers as exact numeric tokens, and file-based
selection/profile input is parsed directly by Python. Native date/time fields,
structured properties, binary values, whitespace-sensitive strings, large
integers and Shapefile overflow retain explicit representations and their
complete original source files.

Shapefile field aliases follow the driver's ten-character name constraint.
Long values use complete source references by default; select longValues:error
to require a representable DBF field. The .shp, .shx, .dbf, .cpg and applicable
.prj travel together, along with emitted native indexes. Native Shapefile
output uses the driver's 2 GB component limit. These are format constraints
described by the [GDAL Shapefile driver](https://gdal.org/en/stable/drivers/vector/shapefile.html).

### Geometry and CRS

The default preserves original coordinates and CRS. A supplied sourceCrs fills
missing metadata and must agree with an existing reported CRS. assignSourceCrs
is an explicit coordinate assignment. targetCrs requests a native transform.
Each layer records original, assigned, source and target CRS, action and x/y
coordinate order. Every original ordinate must have an exact decimal
roundtrip through the native engine's double representation; a value that
would lose precision returns VECTOR_COORDINATE_PRECISION_REQUIRES_REVIEW.
The complete original geometry remains in the captured source.

Receiving checks the declared coordinate mapping against the original source
and saved profile, recalculates the selected transform, and matches every
native geometry or split part to that original feature.

Shapefile output separates geometry families and dimensions. A selected
GeometryCollection split preserves every part's original path, row key and
complete unsplit source geometry. Native row bindings use sf_key and sf_part;
driver-generated feature IDs do not replace the original identity. Unsupported
coordinate dimensions or a failed transform stop that original export with a
retained native error.

The full reopen verifies native field/type/value and geometry against the
original source bindings. Polygon ring orientation/start positions are
normalized for comparison; source geometry and all original ordinates remain
retained. Source CRS assignment and transformation are distinct recorded actions.

Fiona's field schemas, GDAL driver behavior, native feature IDs and x/y geometry
interfaces are documented in the
[Fiona manual](https://fiona.readthedocs.io/en/stable/manual.html).
GeoPackage options and native file behavior are documented by the
[GDAL GeoPackage driver](https://gdal.org/en/stable/drivers/vector/gpkg.html).


## Consume an original WFS download order

The WFS bridge accepts the maintained, already-open WFS application. It uses
its original `query("order")` and `download("features")` methods, retains the
exact complete GeoJSON bytes, checks the original order again after the read,
and supplies a ready source selection plus reviewed native profile.

~~~javascript
import { materializeWfsOrderVectors } from "./stac/vector/index.mjs";

const delivery = await materializeWfsOrderVectors(originalWfsApplication, orderId, {
  sourceDirectory: "/absolute/order-vector-source",
  captureDirectory: "/absolute/order-vector-capture",
  directory: "/absolute/order-native-vector",
  operationId: "original-order-native-delivery",
  sourceCrs: reviewedOriginalSourceCrs,
  coordinateOrder: "x,y",
  python: "/absolute/venv/bin/python"
});
~~~

The original GeoServer order records its literal requested CRS, actual response
CRS and coordinate description. The caller passes the reviewed source CRS and
confirms the original x/y coordinate representation. This becomes an explicit
source assignment in the native profile; a target CRS, when chosen in the
profile, remains a separate transformation. The combined feature download may
omit its native CRS header, so this binding prevents a generic GeoJSON default
from replacing the original order's coordinate meaning.

`retainWfsVectorSource` is available when the WFS application wants to stop at
the complete file boundary and open the existing native operator with
`selection.json` and `profile.json`. Its private source directory retains
`features.geojson`, the original order metadata, the original request and the
download descriptor. The source receipt is committed before the original file,
so a continuation can reuse completed bytes or verify an interrupted download
against its original digest.

The native layer identity derives from the original project, endpoint and
feature type. Successor orders keep that logical identity through service/schema
metadata refreshes and CRS changes while retaining their distinct service,
schema, query, order, capture and coordinate identities in the source edition.
Every feature and original numeric token stays in the downloaded source.
Explicit identity/profile choices remain part of the original retained request.

## Build, reopen and deliver

~~~sh
node stac/vector/cli.mjs export \
  --capture /absolute/vector-capture \
  --out /absolute/native-vector-export \
  --profile /absolute/reviewed-profile.json \
  --operation-id original-vector-export \
  --python /absolute/venv/bin/python

node stac/vector/cli.mjs open \
  --directory /absolute/native-vector-export \
  --expected-manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --python /absolute/venv/bin/python

node stac/vector/cli.mjs bundle \
  --directory /absolute/native-vector-export \
  --out /absolute/delivery/complete-vector.zip \
  --python /absolute/venv/bin/python

node stac/vector/cli.mjs receive-bundle \
  --input /absolute/delivery/complete-vector.zip \
  --out /absolute/received-native-vector \
  --expected-archive-sha256 ORIGINAL_ZIP_SHA256 \
  --expected-manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --python /absolute/venv/bin/python
~~~

The final **vector-export.json** has schema **starforge.vector-export.v1**.
Its files array includes the complete source capture and every native
component. A receiver can bind the exact manifest digest as well as the ZIP
digest. ZIP extraction verifies the exact original member set and each file's
size/hash before publishing the manifest, then reopens the actual GIS drivers.

| File | Purpose |
| --- | --- |
| source/capture.json | Exact original selection, edition identity and capture file descriptors |
| source/sources/... | Complete original input files and sidecars |
| source/catalog.sqlite | Every original source feature and typed identity |
| source/inspection.json | Original layer/schema/CRS/field inventory |
| native/data.gpkg | Actual GeoPackage layers |
| native/shapefiles/... | Complete native Shapefile groups and companions |
| native/source-features.ndjson | Original feature/field values and source identities |
| native/native-bindings.ndjson | Original row/part → actual native layer mapping |
| native/native-row-ids.ndjson | Observed driver feature IDs alongside original keys |
| native/field-map.json | Complete original/native field mapping |
| native/native.json | Actual engine, native layers, provenance and readback |
| vector-export.json | Final complete portable manifest |

A source file is declared once by its original capture. Every derived file is
declared in the final export. The reader checks the nested source capture,
source edition, native manifest and complete native companion set against
those original declarations.

A directory can be received directly with receive. The same bundle command
also packages complete comparisons. Both receiving paths retain the same
original manifest bytes.

## Continue an interrupted original operation

Each capture/export/comparison destination has an original request and an
operating-system file lock. Repeating the same request resumes its original
work. Changing its source, profile or operation identity produces an explicit
request conflict; create a new destination for a changed export.

Native files are built together in a receiving directory. After complete
readback they are published as one native directory, with a complete checkpoint.
If the final manifest response is interrupted, the same export reuses those
native bytes and finishes publication.

The browser retains the original request before dispatch and the complete
result before its status summary. A committed result is authoritative even if
its summary is interrupted. Concurrent submissions of the same original UI
request share one dispatch. Original requests and results can be reopened from
Operations after a browser reload or server restart.

Use --log-directory to retain the complete native process request, stdout,
stderr, exit state and timing. The native engine's own request and file
identities remain the authority for file continuation.

## Compare and receive complete source editions

~~~sh
node stac/vector/cli.mjs compare \
  --before /absolute/previous-capture-or-export \
  --after /absolute/successor-capture-or-export \
  --out /absolute/source-comparison \
  --operation-id original-successor-comparison \
  --python /absolute/venv/bin/python

node stac/vector/cli.mjs changes \
  --directory /absolute/source-comparison \
  --status CHANGED --limit 100 \
  --python /absolute/venv/bin/python
~~~

The comparison records complete before/after features, original identity and
occurrence, changed fields with presence/type/value, geometry changes and other
original members. It retains both complete captures. Properties absent from a
feature, explicitly null, and changed container state remain distinct.

Every occurrence of a duplicate identity is marked repeated. Declared identity
fields that are missing remain explicit. Positional matching is visible so an
operator can interpret a reordered source correctly.

The change index supports layer/status filters and paging. Complete open and
receiving verify both original captures. Page reads bind the selected
comparison manifest and indexed change database, avoiding repeated hashing of
the full source assets for every displayed page.

## Join the existing QGIS project engine

The maintained **VectorReceivingSource** reads the exact vector-export.json
and its full file closure. It uses the manifest SHA as source ID and keeps the
original selection, source layer ID and native output layer ID.

~~~python
from starforge_stac.vector_source import VectorReceivingSource

source = VectorReceivingSource("/absolute/received-native-vector", expected_manifest_sha256)
inventory = source.native_inventory()
layer = source.layer_definition(source_id, source_layer_id, native_layer_id)
~~~

The returned layer definition is consumed by the existing QGIS project
controller. Its native layer selection opens the actual GPKG layer or the
complete Shapefile bundle. The existing project renderer, saved project,
reopen and desktop handover remain in stac/qgis.

See the maintained [QGIS vector receiving guide](../qgis/VECTOR_RECEIVING.md)
for that source factory, selection and project workflow. This exporter also
provides Python open_vector_export and a Node openVectorExport wrapper when
an existing customer application needs only the complete file descriptors and
native receiving result.

## API and original CLI integration

Python exports include capture_selection, open_capture, export_capture,
open_vector_export, receive_vector_export, create_bundle, receive_bundle,
compare_captures, open_comparison, comparison_page and receive_comparison.
The package loads under a private module name through engine.py, so it can be
embedded alongside another application's common.py.

Node index.mjs exposes the corresponding complete operations, the original
STAC bridge, ExactNumber, parseExactJSON and stringifyExactJSON. Use the supplied
encoder for native data round trips. The ordinary JSON.stringify display of an
ExactNumber is a string; stringifyExactJSON emits its original numeric token.

The maintained distribution installs the complete workflow as **stac-vector**.
Use the selected native Python environment with the installed command:

~~~sh
starforge stac-vector help
starforge stac-vector capabilities --python /absolute/venv/bin/python
starforge stac-vector serve \
  --root /absolute/customer-files \
  --python /absolute/venv/bin/python
~~~

The original STAC CLI also dispatches vector-* commands before opening an analyst
workspace. It preserves the native command's exact JSON output and keeps the
original service close and signal handling:

~~~sh
node stac/cli.mjs vector-help
node stac/cli.mjs vector-capture \
  --selection /absolute/original-selection.json \
  --source-root /absolute/original-files \
  --out /absolute/vector-capture \
  --python /absolute/venv/bin/python
~~~

The source-owned [distribution contribution](../../../distribution/contributions/stac-vector.json)
carries all 20 vector files, including the native Python modules, original
receiving examples, browser assets and exact JSON adapter. The server and the
package builder use the same [browser asset manifest](browser-assets.json);
the existing shared asset loader resolves those four routes from the retained
source tree.

| Installed export | Interface |
| --- | --- |
| ./seller/stac/vector | Native file operations, exact JSON and original STAC bridge |
| ./seller/stac/vector/wfs | Original WFS order-to-vector receiving bridge |
| ./seller/stac/vector/operator | Local authenticated browser operator |
| ./buyer/stac/vector | Complete original vector file receiving |

The selected native Python/GDAL environment remains an explicit runtime input.
The vector Node interfaces use the existing distribution dependencies.

## Run the complete native receiving journeys

The native journey accepts an actual original selection and source directory:

~~~sh
/absolute/venv/bin/python stac/vector/examples/native_journey.py \
  --selection /absolute/original-selection.json \
  --source-root /absolute/original-source-files \
  --out /absolute/vector-native-run \
  --qgis-source /absolute/maintained-stac/qgis
~~~

It captures the actual selected source, writes both formats, interrupts the
final manifest after the complete native files are committed, resumes the same
request without changing those native files, reopens every native feature,
creates and receives the complete ZIP, compares original versus received
source and receives that complete comparison. When supplied an actual original
successor selection, it also runs that source-edition comparison. The optional
QGIS source path exercises the maintained vector source reader on the received
package.

The browser journey consumes that completed source capture. Its --out belongs
inside the original native-directory:

~~~sh
node stac/vector/examples/browser_journey.mjs \
  --native-directory /absolute/vector-native-run \
  --out /absolute/vector-native-run/browser \
  --python /absolute/venv/bin/python \
  --playwright-module /absolute/installed/playwright/index.mjs \
  --chromium /absolute/installed/chromium
~~~

It operates the actual browser controls to capture originals, review one
native field alias, export/reopen both formats, recover a committed response
after its status summary is removed, download the complete ZIP, receive it,
compare source identity and reload saved views. It retains the actual
operation IDs, native package hashes, browser output and screenshot.

native-result.json and browser-result.json describe the actual outcome of
each invocation. An interrupted or failed invocation retains its completed
steps and original error for continuation.
