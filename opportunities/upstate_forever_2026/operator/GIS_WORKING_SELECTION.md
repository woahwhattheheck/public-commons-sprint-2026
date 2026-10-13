# Editable GIS working selections

This module supports the existing Editable GIS projects pane. Its portable working file retains the scientist's complete unfinished export selection across original source collections. The original `gis.project.export`, task queue, GIS archive receiving and explicit source-adoption writers keep their existing contracts.

## Installed files and original contract

Load `operator/web/gis-working-selection.mjs` as an ordinary ES module. It has no dependencies, network calls, browser storage or native writes. Its functions operate on detached JSON values and do not mutate their inputs.

The original native catalogue is `upstate.gis-catalogue/v1`: `project_id`, `sources[]` with collection `id/title/entries[]`, and each entry's original `id/title/kind/role/units/gis_context_group/gis_required_context`. The actual native `gis_workspace.request` remains authoritative for original source hashes, complete companion files, supported geometry/raster semantics, CRS and completed native artifacts. The catalogue labels in a working file help the user recognize missing originals; they do not establish that those bytes are present.

## Whole file

`upstate.gis-working-selection/v1` contains:

- `project_id`: exact original Workspace project.
- `selection`: complete original export selection, preserving every source row and all other current/future selection fields.
- `active_source_collection_id`: current browsing collection or null. Changing it does not select sources.
- `source_descriptions[]`: one retained description per selected [collection,source] pair, including original collection summary and source catalogue entry, or null for an unavailable source.
- `import_history[]`: full earlier working documents displaced by explicit file opening, with the actual timezone-qualified import time.

Native layer settings such as `id`, `title`, `layer`, `where`, `band`, `metric`, `direction`, `group`, `purpose`, `units` and `visible` remain unchanged. Native-study, delivery, grid, run, comparison, contact and other settings remain in the same selection. Unknown JSON selection fields are preserved. A source pair may occur in multiple original layer rows, for example different bands with distinct native layer IDs; all variants survive source-checkbox changes.

## API

`pairKey(row)` returns JSON encoding of the two exact original IDs. Never use source_id alone or concatenate delimiters that can collide.

`normalizeSelectionSources(selection,catalogue)` materializes the original legacy whole-collection fallback from the complete catalogue and resolves inherited collection IDs. Once explicit rows exist it removes legacy `source_collection_id`. An unavailable legacy all-source selection is retained unresolved, never converted to an empty successful selection.

`reconcileSources(selection,catalogue)` returns:

- `selection`: detached normalized full selection.
- `selected[]`: each full original selection row, compact collection, actual entry or null, and `available`.
- `missing[]`: selected rows whose exact original pair is unavailable.
- `missing_collections[]`: unresolved legacy whole-collection selections.
- `required_context[]`: original native implicit context rows, with exact collection/source IDs and original catalogue metadata.
- `has_spatial_source`: a selected source or required context entry is a vector/raster.
- `has_other_spatial_selection`: an existing native-study/delivery/grid/run/comparison selector is present.
- `can_submit_sources`: no unavailable source selection and at least one potential spatial input. This is a chooser readiness indication. The original native writer still validates the full selection and actual completed source.

Context expansion mirrors the native one-pass rule: within each original collection, collect the nonempty context groups of explicitly selected entries, then include required entries in those same groups. It does not combine equal group labels across collections or recursively expand newly included entries.

`replaceCollectionSources(selection,collectionId,selectedIds,catalogue)` changes only the named collection. Existing selected source rows retain all fields and their relative ordering, including multiple layer variants. Newly checked IDs are added as original [collection,source] pairs; newly selected unavailable IDs are rejected. Missing originals and required-context entries have no ordinary checkbox and stay retained when the visible collection checkboxes change. Use the separate explicit basket-removal action to remove those original selections. Rows from all other collections stay unchanged. Removing the last source deletes the legacy fallback, so an empty basket cannot accidentally export every item from the browsed collection.

`createWorking({projectId,selection,activeSourceCollectionId,catalogue,importHistory=[],sourceDescriptions=[]})` produces the complete portable value. Pass the currently retained `source_descriptions` when rebuilding it after catalogue refresh; missing-source descriptions are then kept. It verifies catalogue/project identity. Do not use the active chooser value as a native fallback.

`validateWorking(value,{projectId}={})` validates and returns a detached complete value. It accepts incomplete drafts, including an empty explicit source basket. It rejects a different original project, malformed source pairs/descriptions and non-JSON or nonfinite values.

`importWorking(current,incoming,{projectId,at})` explicitly opens the complete incoming working document. UI must first resolve its existing unsaved/pending operation. It preserves the complete displaced working document as an import-history entry and retains incoming history. Reopening the same exact parsed document, including replaying an already recorded import, is a no-op. An original task/request remains with its original pane; portable draft opening does not transplant task state between hosts.

`serializeWorking(value)` returns complete pretty JSON plus a final newline. UTF-8 encoding, file download/open, file-input reset and working-size display belong to the UI.

`removeSourcePair(selection,collectionId,sourceId,catalogue)` is the explicit basket-removal action. It removes every retained layer variant for that exact original pair, preserving all other selections. The native exporter may still include required companions/context for another selected layer.

## Installed UI sequence

1. Read the current catalogue for the actual selected Workspace.
2. Recover the existing complete selection. Normalize legacy fallback only using that actual catalogue.
3. Render all retained selected pairs and missing originals, then browse any collection independently.
4. Use replaceCollectionSources for explicit checkbox changes. Keep other source rows and non-source selectors.
5. Save a complete working file using createWorking, carrying import history and source descriptions.
6. For opening, check the original project and preserve pending native-operation recovery before applying the imported document. Keep every missing selection visible; the user may locate the original source, retain the unfinished file, or explicitly remove its selection.
7. Before ordinary export, show the source/context summary. Missing collections/pairs prevent submission. Source-only table/document selections need a vector/raster; original grid/run/delivery/native-study selectors may provide the map layers.
8. Submit the full selection through the existing queue and preserve its actual task/recovery identities. Receive/open/seal/adopt the resulting complete GIS project through existing controls.

## Source and receiving scope

The implementation was composed against full native `model/gis_workspace.py` a07e327f7e95b6533b65f6455b1b3a147202266b and the catalogue/provider contract. A focused source operation exercised colliding source IDs in two collections, original layer variants, required context, one-collection editing, missing-source labels, legacy all-source fallback, empty explicit basket, whole-file reopening and exact import replay. Those authored API diagnostics are not scientific input or native GIS results.

The installed browser and receiving course use the existing real C5AE county/source Workspace and original GIS export/receive operation. Producer opens the installed pane at desktop and narrow widths, saves/reopens complete unfinished choices, continues an interrupted original request, opens all emitted GIS/source attachments and independently reopens the complete Workspace. No new model calculation is needed for this chooser capability.

## Complete file capacity

`WORK_BYTES` is the shared 16 MiB limit. `validateWorking` measures the complete pretty-printed JSON plus final newline in UTF-8, including every preserved prior document. Both opening and saving use this same limit. A proposed import whose full retained history exceeds it fails before replacing the current working copy; preserve the original file and explicitly reduce the intended portable selection. Frozen `run_revision` and `native_study` selections remain available through their original native export paths.
