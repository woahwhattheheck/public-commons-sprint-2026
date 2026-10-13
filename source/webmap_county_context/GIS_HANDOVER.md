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
The original attribute table and Census table are retained as typed table
attachments with all their companions, including the county crosswalk, dated
metadata, original feature join and readable population report.

The project manifest also preserves explicit scientific source metadata:
original collection/source identity, parent lineage, original field definitions
and vintages, and the dated table's geography and column metadata. The population
table describes whole counties. These values remain separate from clipped model
geographies and retain their original Census estimate vintage and date.

The existing GIS receive and adoption workflow supports continued work. Receiving
a complete archive creates an independent edition. Adopting its working layer
creates a new native source collection with the associated originals and context.
Re-exporting that working layer automatically includes its retained context.
The adopted CSVs remain native tables. Their original format, columns, per-column
scientific metadata, declared units and conversion, source date, geography and
provenance remain available to the ordinary source catalogue and table profiler.
Each adopted table also retains the exact original collection/source binding and
ordered primary/companion identities under its received GIS provenance.

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
context travels when only the adopted working layer is selected. It also opens
both adopted CSVs through the actual native table profiler, checks all ten rows
against their retained originals, and verifies typed metadata and every declared
companion through re-export. It then
restarts the Operator and reopens the same tasks, source collection, typed table
profiles and archive downloads.

## Resume and use the resulting project

Rerun the same command and GIS version with the same state directory to continue
the recorded original tasks. Interrupted, failed or cancelled tasks are resumed through
`Operator.resume`; completed tasks retain their original IDs and selections.
The state record names the original accepted tasks even when the native queue
coalesced an identical active request.

`webmap-gis-receiving-result.json` records the original source identity, both
receiving fingerprints, the adopted collection, native task IDs and the final
complete ZIP's retained path, length and SHA-256. Its final status becomes
`passed` after the restart and download reopening finish. Each exported and
received edition also appears in the existing GIS desk. Open the layer view or
download the complete ZIP there, then open `project.qgz` in QGIS.


## Receiving earlier GIS editions

GIS builder and adopter version 1.3.0 records explicit attachment types and uses
a distinct scientific source adoption identity. Existing version 1.2 exports can
also be adopted: their retained original request supplies the table type only
after its logical ID, original source metadata and ordered primary/companion
paths, lengths and hashes match the received attachment. File extensions never
determine the scientific source kind.

A source edition already adopted with the earlier document-only behavior remains
unchanged. Running a new adoption uses the current adopter version and produces
a separate typed source edition. The receiving driver records the GIS version
with its original operation identity. Use a separate GIS state directory when
advancing an already completed earlier-version receiving run; its original task
records and deliveries remain available.

Physical files can be shared by several retained logical sources. Context
identity includes its original role, logical source ID, explicit type, metadata
and ordered file bindings, so a generic layer original cannot suppress a typed
table that happens to use the same bytes. Selecting an adopted working layer
continues to carry every required table, document, original file and companion.


## Use the offline source desk

Open `OPEN_GIS.html` directly from the extracted GIS directory and choose
**Sources and tables**. This is the same offline opener as the retained map;
the original layer controls, legends and geographic view remain available under
**Layers**.

The source list includes every layer's original files and every typed table or
document attachment. Search the original title, date, scientific metadata or
filename. Select the Census context to see its original estimate vintage,
whole-county geography, units and column definitions beside the literal rows.
Leading-zero identifiers and empty values remain unchanged. Row search and
pagination work inside the extracted file; clicking a column sorts its displayed
values as text, and **Original row order** restores their source order.

Each source exposes its primary download and every declared companion. These
include the exact original Web Map, extracted features, historical attributes,
geometry provenance, Census metadata, crosswalk, original-feature join and
readable population report. The editable working layer has its own download.

The catalogue embeds complete county tables. For other large sources it embeds
up to 2,000 display rows within a one-million-character display budget, and states
whether the entire table is displayed. Search and sort apply to those displayed
rows. The full original table and all companions always remain in the handover.

**Save this view** retains the selected source or layer, table search, text sort,
page, visible layers and map extent. The view address carries the same selection.
It is bound to the exact GIS selection and edition, so a saved view cannot apply
a source selection from another project edition. Browser storage is optional;
the view address supports reopening when local storage is unavailable.

The original receiving driver checks the embedded offline table values against
both complete ten-row source CSVs before and after native adoption and
working-layer-only re-export. This joins the human-readable opener to the same
typed scientific sources and companion identities checked by the native flow.


## Reuse an original table or document without a working layer

Open **Editable GIS projects → Received independent editions → Use received layers, tables or documents as study sources**. Clear the working-layer selections, then select the original tables or documents you need. Each choice shows its retained kind, date, geography, declared units and number of companions. Give the new source edition a title and reason, then submit through the normal Operations queue.

The new edition uses the original source importer. A selected CSV remains a table with its exact original header, values, primary bytes, ordered companions, URI, vintage, units and scientific metadata. A selected document remains a document. The source record retains the received GIS edition, original source binding and adoption reason. An additional provenance document carries the received project manifest and retained edition history. This mode does not require a vector or raster.

The selected table is directly selectable in the ordinary Sources and Investigations catalogues. **Open original source files** in the GIS desk opens that saved edition through the existing source-item API and refreshes download tickets for every primary and companion. The completed adoption task also links the original source edition and its files. Adoption form selections and the original queue operation ID survive a page reload; a changed selection gets its own operation.

If any working layer is selected, every original context attachment stays selected and is carried with that layer, preserving the existing layer-only re-export behavior. To choose a subset of tables or documents, clear all working layers first. Empty selections, repeated identities and identities absent from the received edition are rejected.

### Native request

The existing action is `gis.project.adopt-sources`:

```json
{
  "receipt_id": "<actual saved receiving ID>",
  "title": "Dated county population source",
  "reason": "Reuse the original whole-county table in this study.",
  "layer_ids": [],
  "attachment_ids": ["<actual attachment ID from the received catalogue>"]
}
```

`GISProjects.catalogue(workspace_key)` returns both `layer_choices` and `attachment_choices` for each received edition. Copy the exact attachment identity. A request with working layers and no `attachment_ids` retains every attachment, as earlier clients expect. When explicit attachment IDs accompany working layers, they must include the complete attachment set.

The immutable adoption selection includes `adoption_format_version: 2`, the original receiving fingerprint, ordered selected IDs and the existing GIS builder version. Earlier cached layer-only adoptions remain intact. The result retains `sources` for working-layer mappings and adds `context_sources` with attachment ID, native source ID, title and kind.

### Continue the original county receiving course

The same `source_tools/receive_webmap_gis.py` now continues through independent table adoption. It checks the actual catalogue choice, admits the original dated Census CSV without working geometry, verifies all original metadata/companions and the complete native profile, and opens the completed native task's source downloads. It then selects the adopted originals and received-edition provenance using the actual Investigations repository references and delegates to the maintained `receiving/eco_intelligence/receive_original_collection.py` for its original export, companion checks, portable re-export and restart/reopen.

This receiver uses `receiving_version: typed-source-selection-v2` and a separate `source-only-collection` state directory beneath the same receiving operation. Preserve any active earlier receiver and its task state. Run the maintained continuation only after that original lifetime is reconciled; use a new state directory for a different receiving/GIS version. The saved result reports `source_only_collection_id`, `source_only_tables`, `source_only_refs` and `source_only_collection_export` alongside the original full GIS course.


## Review received vector edits before source adoption

Each received GIS edition with vector layers now has **Review all vector layers** in the existing Editable GIS desk. This queues `gis.vector.review` through the original Operations queue. The received edition and explicit layer IDs determine the immutable review identity. Retrying the same request reopens the original task and result.

The completed review appears beside that same received edition and source-adoption form. Open it to inspect the original and working CRS, exact paired-feature counts, attribute changes, geometry changes, unresolved identities, and full original source context. Complete JSON, CSV, HTML and a self-contained ZIP use the existing authenticated download tickets. Extract the ZIP and open `review.html` to read every feature offline.

### What the comparison means

The comparison uses the retained original primary and every declared companion, with their exact path, byte length and SHA256. It resolves the original source layer and original selection from `source_request`, and validates the saved `source_field_map` and `source_identity_field`. Feature order and desktop GeoPackage row numbers are not used to infer a match.

A feature with one exact original identity on each side is compared field by field. Literal identifiers, empty strings, nulls and zero values remain distinct. Added and removed fields are shown, and field-type changes remain explicit in the layer schema. An identity appearing only on one side is reported as an added or removed **identity**: editing an ID can produce the same observation as adding or removing a feature. When working IDs are absent, unmatched original features are reported without assuming deletion. Duplicate IDs are shown as ambiguous groups with every original and working feature.

XY geometry uses Shapely topological equality in equivalent declared CRSs, so changing a polygon's ring order alone does not create a spatial edit. Geometry type and Z coordinate changes are recorded separately in the equality result; Z comparison retains the complete coordinate multiset. Measured M coordinates, invalid geometry or differing CRSs produce an explicit unassessed comparison. The review does not repair geometry, reproject it implicitly, convert areas, or derive scientific impact from a desktop edit.

The baseline is the complete retained original source selection. A sealed edition retains previous project metadata and file hashes, but does not retain all former working geometry bodies; the report therefore does not describe a previous editable edition as its baseline.

After reviewing the result, the existing source-adoption form creates a separate native source collection from that exact received edition. The review and adoption remain independently retained and share the original receipt/edition identity. Working layers carry their complete original context as before; original tables and documents can also be adopted separately.

### Native receiving and workspace restore

The existing `source_tools/receive_webmap_gis.py` course now queues the review for its actual, unchanged ten-county received vector, requires ten exact original matches with unchanged attributes and geometry, opens all four original task downloads, and checks the same retained review after Operator restart. Its prior GIS, typed-table, source-only adoption and selected-source collection phases are unchanged.

Review files live under `gis-vector-reviews/<selection-id>/` in the original Workspace. The current portable backup recursively retains that directory and the new model/operator/descriptor files. The extension's original `verify_workspace` callback verifies the review's project, received edition, complete files and full report when restoring. Download tickets are regenerated for the receiving workspace key.

The new component is installed with the normal application source cohort:

- `model/gis_vector_review.py`
- `operator/gis_vector_reviews.py`
- `operator/extensions/gis-vector-reviews.json`
- the complete current `operator/web/gis-projects.mjs`

There is no new parallel GIS workspace, task queue, archive format or scientific solver.
