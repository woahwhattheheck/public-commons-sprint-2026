# Native vector receiving in the maintained QGIS project

Open a complete **`vector-export.json`** directory in the existing Starforge QGIS receiving workspace. The importer keeps the producer's original GeoPackage and Shapefile layers, source capture, typed field mappings, feature identities, geometry-part bindings and every declared companion file. Saved QGIS maps and complete receiving archives use those retained files.

The original vector producer is in `../vector/`. This QGIS reader consumes its `starforge.vector-export.v1` output. QGIS supplies the existing native map renderer, attribute table, styles, CRS handling, project writer and project reader.

## What travels with a vector layer

The source ID in the QGIS workspace is the SHA-256 of the exact original `vector-export.json` bytes. Its `sourceEdition` object and `selectionSha256` stay unchanged.

| Original input | Retained use |
| --- | --- |
| `source/capture.json` and its complete nested file list | Original selected source files, selection identity and source edition |
| `source/inspection.json` and `source/catalog.sqlite` | Actual source layer IDs, native names, fields, counts and original indexed records |
| `native/native.json` | Exact producer engine, output layer names, geometry, CRS, field mapping and completed native readback |
| `native/source-features.ndjson` | Complete original features, original identity and occurrence, source position and property kinds |
| `native/native-bindings.ndjson` | Original row key and geometry-part key mapped to the actual native output |
| GeoPackage file | Every selected native table remains in the original file; a layer choice pins its actual table name |
| Shapefile components | Geometry, index, attributes, encoding, projection and declared native index/metadata companions travel together |
| Remaining original export members | Full field map, native row IDs, original source files and producer checkpoints stay in the same receiving closure |

A native field's `codec` explains its physical representation. Native numbers, booleans, dates, JSON values, SHA-256 value references and sidecar-only fields retain their original mappings. For a reference or sidecar field, the complete value remains in the original records above. The `sf_key` and `sf_part` attributes connect a native row to those retained records.

The reader validates the original capture/selection/edition relationship and all metadata and file descriptors. The producer's native readback remains attached. The existing QGIS inspector opens the selected native file with QGIS's own provider and reports its actual layers, fields, geometry and CRS.

## Open and inspect in QGIS

Build the maintained plugin from its source directory:

```sh
python3 plugin-package.py --out /private/starforge-qgis-receiving.zip
```

Install that ZIP through **Plugins → Manage and Install Plugins → Install from ZIP** in the existing QGIS installation. Open **Starforge STAC Receiving**, then create or open the intended private project workspace.

Use **Import original receiving** to select the directory containing the original `vector-export.json`. The workspace retains all original source members. The source panel identifies it as a vector export and shows its original source edition and native layer inventory.

Choose an original source layer and inspect its native outputs. Each output identifies its original source, original source-layer ID, native layer ID, format, actual native layer name, field mapping, count and CRS. GeoPackage and Shapefile outputs from the same source retain their separate original native IDs. A Shapefile split into geometry families retains each producer group and its original part bindings.

Add the intended vector outputs to the map. A selected GeoPackage output is bound to the native layer named in the original manifest, including when several outputs share one GeoPackage file. Use the existing QGIS layer properties to change the analyst's label, visibility, opacity, subset filter or style. Capture the current styles through the maintained workspace before saving the map.

If a native layer has no CRS, choose its explicit CRS override in the existing layer dialog before mapping it. Select the map's project CRS separately when saving. The retained source metadata continues to show the producer's actual CRS and any original source assignment or transformation.

## Command-line access

Run the maintained Python commands from this `stac/qgis/` directory. Source and workspace commands use ordinary Python; commands beginning with `native-` use the existing QGIS Python environment.

```sh
python3 -m starforge_stac.cli source-open \
  --directory /private/received-vector-export \
  --expected-sha256 ORIGINAL_VECTOR_MANIFEST_SHA256

python3 -m starforge_stac.cli create \
  --workspace /private/vector-analysis \
  --title "Received vector analysis"
```

The source-open response returns the original source ID, source edition, source-layer rows and native output rows. The established `import`, `layers`, `review` and `native-save` commands take their complete JSON action through `--input`. Use the workspace's current revision and one stable request ID for each original action.

For an exact native layer choice, the reader provides:

```python
from starforge_stac.vector_source import VectorReceivingSource

source = VectorReceivingSource(
    "/private/received-vector-export",
    expected_manifest_sha256="ORIGINAL_VECTOR_MANIFEST_SHA256",
)
for row in source.asset_rows():
    identity = row["nativeIdentity"]
    choice = source.layer_definition(
        identity["sourceId"],
        identity["sourceLayerId"],
        identity["layerId"],
    )
    print(choice)
```

Each returned choice is ready for the existing workspace `layers` action. It includes the exact source manifest identity, stable original tuple and pinned native layer name. The existing `native-inspect` command uses `sourceId`, `collection`, `itemId` and `assetKey` from that choice. Here the three asset-key fields carry the original source ID, original source-layer ID and original native-layer ID; the source and row metadata explicitly identify the vector source kind.

## Review a refreshed edition

Import the successor's complete original vector export into the same workspace. Keep its original selection/source IDs so the existing edition comparison can join the same source layers and native outputs. The successor's manifest SHA, source edition and changed source/native bytes remain distinct.

Review each existing map layer with the maintained **Keep**, **Update** or **Remove** decision:

- **Keep** retains the prior source, native output and analyst choices.
- **Update** selects the same original native output identity from the successor. The new manifest's exact native layer name remains the selected layer.
- **Remove** removes that map layer while keeping the original sources, previous maps and review history.

A Shapefile's `nativeBundleSha256` covers every declared companion descriptor, including its path, byte count and SHA-256. A changed DBF, projection, encoding or native index therefore changes the received native bundle even when the SHP bytes are unchanged. The same bundle identity participates in both the source comparison and the successor review. Changed native bytes reset the previous style dependencies, CRS override and subset selection through the existing review workflow; inspect and capture the intended native choices for the successor.

If a split geometry group or original layer is absent from the successor, keep the prior layer or remove it. The receiver preserves the original IDs and presents that absence directly.

Save the successor as another native QGZ project version. The prior saved map continues to refer to its original retained source edition.

## Complete native operation and receiving

The maintained `native-journey.py` is the receiving entry for both source kinds. Supply the original vector directories and exact asset selections in its existing configuration:

```json
{
  "operationId": "ORIGINAL_OPERATION_ID",
  "outputRoot": "/private/original-vector-qgis-operation",
  "sourceDirectory": "/private/received-vector-export",
  "sourceManifestSha256": "ORIGINAL_VECTOR_MANIFEST_SHA256",
  "title": "Received vector analysis",
  "actor": "Original receiving operator",
  "assetSelections": []
}
```

Populate `assetSelections` with the exact choices returned by `layer_definition` for the intended native outputs. The journey assigns its established map layer IDs, `original-asset-1`, `original-asset-2`, and so on, in that selected order. The vector source uses vector layers throughout this operation.

To include a refreshed edition, add the existing `successorDirectory`, `successorManifestSha256`, `successorDecisions` and `successorNote` fields. Supply one explicit decision for every selected prior map layer. An update may include the actual successor `vectorLayer` and the intended native subset string. Keep the complete configuration unchanged when resuming the same operation.

Run it with the existing QGIS Python:

```sh
"$STARFORGE_QGIS_PYTHON" native-journey.py \
  --config /private/original-vector-qgis-operation.json
```

The same operation performs native inspection, retained layer selection and styles, QGZ save and exact replay, original-map reopening, optional successor review, complete project export, fresh receiving and reopening of every saved map. In a running QGIS desktop it also captures the actual receiving workspace and map window.

Its `complete-project.zip` includes every imported original vector manifest and file, previous and current source editions, analyst choices, saved maps, style resources, review history, original operation records and the maintained plugin source, including this vector reader. Receive that complete archive through the existing workspace receiving flow. A repeated receive of the same archive reopens the original workspace and operation identities.

The equivalent archive commands are:

```sh
python3 -m starforge_stac.cli export \
  --workspace /private/vector-analysis \
  --file /private/vector-analysis-complete.zip \
  --revision CURRENT_REVISION

python3 -m starforge_stac.cli receive \
  --workspace /private/received-vector-analysis \
  --file /private/vector-analysis-complete.zip \
  --expected-sha256 ORIGINAL_ARCHIVE_SHA256
```

Use `native-open --workspace ... --project-id ...` in the QGIS Python environment to reopen any retained map at the receiver. Native maps use relative paths to the receiver's own complete source and style files.

## Maintained source-reader interface

`VectorReceivingSource(root, expected_manifest_sha256=None, progress=None, verify=True)` shares the maintained workspace's file and source interfaces:

| Interface | Vector meaning |
| --- | --- |
| `manifest_name` | `vector-export.json` |
| `manifest`, `manifest_body`, `id` | Complete original object, exact original bytes and their SHA-256 |
| `sourceKind` | `vector` |
| `source`, `edition` | Original source edition, selection, capture descriptor, profile and native engine |
| `files` | Complete original export descriptors |
| `path(name, verify=True)` | Verifies the requested original member; a native primary file verifies its complete companion bundle before opening |
| `scene_rows()` | Source-layer groups with explicit native identities, original feature counts and native formats |
| `asset_rows()` | Exact native output layers, original metadata, pinned native name, file bundle and original receipt |
| `layer_definition(...)` | Exact native vector choice for the existing workspace layer commands |
| `native_inventory()` | Complete original producer engine, native readback, layers and source bindings |

The maintained source factory selects the original manifest filename. Workspace import, later reopening and complete project export/receive use that reader's `manifest_name`. The native renderer and layer controls respect `nativeLayer` for vector outputs. Plugin packaging and complete workspace packaging include `starforge_stac/vector_source.py` and this guide.

Format references: [GDAL Shapefile driver](https://gdal.org/en/stable/drivers/vector/shapefile.html), [GDAL GeoPackage driver](https://gdal.org/en/stable/drivers/vector/gpkg.html), and [OGC GeoPackage 1.4.0](https://www.geopackage.org/spec140/index.html).
