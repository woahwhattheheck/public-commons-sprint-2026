# Original county sources to an editable GIS handover

The **Original map layers** desk now opens the existing **Editable GIS projects**
desk with the admitted county vector, its original attribute table and the dated
Census context selected together. Choose **Prepare complete editable GIS handover**
on a saved admission. The GIS desk refreshes its authoritative source catalogue
before displaying these exact original source IDs.

The display coordinate system starts at EPSG:4326 for these admitted sources.
Working files keep their native coordinates. The form retains ordinary GIS
choices: source files, optional prepared grids and completed native results,
display projection and operator notes. Use **Build complete GIS project** to
submit the original `gis.project.export` operation.

## What travels with the handover

The complete ZIP contains its QGIS project, independently editable working
GeoPackage, original vector and every declared companion. This includes the
full original Web Map, its extracted Esri feature set and geometry provenance.
The original attribute table and Census table are retained as attached documents
with all their companions, including the county crosswalk, dated metadata,
original feature join and readable population report.

The project manifest also preserves explicit scientific source metadata:
original collection/source identity, parent lineage, original field definitions
and vintages, and the dated table's geography and column metadata. The population
table describes whole counties. These values remain separate from clipped model
geographies and retain their original Census estimate vintage and date.

The existing GIS receive and adoption workflow supports continued work. Receiving
a complete archive creates an independent edition. Adopting its working layer
creates a new native source collection with the associated originals and context.
Re-exporting that working layer automatically includes its retained context.

## Continue the original receiving operation

Use the installed maintained application and its actual GIS interpreter. The
original publisher Workspace is project
`c6095eb6-b080-42e5-b89e-0d36accb98f4`. It contains the original ten-county
publisher source. Add the GIS state argument to the existing admission command:

```bash
"$ACTUAL_GIS_PYTHON" -B "$ACTUAL_APP/source_tools/receive_webmap_sources.py" \
  --application "$ACTUAL_APP" --workspace "$ACTUAL_ORIGINAL_WORKSPACE" \
  --state-directory "$ACTUAL_ADMISSION_STATE" \
  --collection-receiver "$ACTUAL_APP/receiving/eco_intelligence/receive_original_collection.py" \
  --collection-state-directory "$ACTUAL_COLLECTION_STATE" \
  --gis-state-directory "$ACTUAL_GIS_STATE"
```

Use a distinct GIS operator state directory. Existing admitted originals are
reused. The optional GIS phase runs after the existing admission and selected
collection procedures have closed their Operators.

For an admission already received, its native source collection ID can be passed
directly:

```bash
"$ACTUAL_GIS_PYTHON" -B "$ACTUAL_APP/source_tools/receive_webmap_gis.py" \
  --application "$ACTUAL_APP" --workspace "$ACTUAL_ORIGINAL_WORKSPACE" \
  --source-collection-id "$ACTUAL_ADMITTED_COLLECTION" \
  --state-directory "$ACTUAL_GIS_STATE"
```

The GIS receiver uses the original queue for export, independent receive,
adoption, re-export and a second independent receive. It validates all ten
county identities, attributes and polygons through the native GeoPackage field
mapping and original county-name binding, checks the source/companion bindings, and verifies that the original
context travels when only the adopted working layer is selected. It then
restarts the Operator and reopens the same tasks, source collection and archive
downloads.

## Resume and use the resulting project

Rerun the same command with the same state directory to continue the recorded
original tasks. Interrupted, failed or cancelled tasks are resumed through
`Operator.resume`; completed tasks retain their original IDs and selections.
The state record names the original accepted tasks even when the native queue
coalesced an identical active request.

`webmap-gis-receiving-result.json` records the original source identity, both
receiving fingerprints, the adopted collection, native task IDs and the final
complete ZIP's retained path, length and SHA-256. Its final status becomes
`passed` after the restart and download reopening finish. Each exported and
received edition also appears in the existing GIS desk. Open the layer view or
download the complete ZIP there, then open `project.qgz` in QGIS.
