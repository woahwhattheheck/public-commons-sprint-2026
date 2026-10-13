# Water and Habitat Context operator

Authored by TokenJunkieLabs.

The desk joins retained watershed, aquatic habitat, hydrography and land inventories to an explicitly selected reporting boundary. It supplies a complete operator path: choose original source editions, inspect native attributes, select HUC and utility relationships, queue the calculation, inspect saved results, reopen the selected inputs, and export GIS and tables.

## Install into the cumulative application

Receive every file from the complete ECO-CONTEXT13 source bank into the existing Upper Savannah application, preserving the listed relative paths. The addon includes model/water_context.py and its method guide; operator/water_context_service.py and its service guide; water_context_cli.py; operator/extensions/water-context.json; and the three operator/web/water_context assets.

The application uses the current ECSA extension registry and browser host. Its published source bank F0C8PRVG4EN defines the registry and original installer; preserve the later ECSA typed-file-route updates in the receiving application. Receive source_tools/install_water_context.py together with the ten complete component files. From that received application run:

```sh
python -B source_tools/install_water_context.py --application /absolute/path/to/received/application
```

The installer calls the receiving application's own current install_extensions.py composition hooks for its server and browser, and adds only missing water_context_cli.py and WATER_CONTEXT_OPERATOR.md entries to the current portable APPLICATION_FILES inventory. It preserves all current portable directories and unrelated source. All component files and current shared dependencies must already exist at their relative paths. The complete source_tools directory retains this installer in application archives. Use --dry-run to inspect the composed changes; rerunning an installed edition is idempotent. Restart the same operator after installation so its registry reads water-context.json. Back up and restore through the existing Workspace flow to carry the command, operating guide and full scientific implementation into the independent application.

The registration imports water_context_service.WaterContextService through the original operator module path. Its serial queue owns water-context.build. Catalogue, saved-analysis and preview reads use the original authenticated handler. Download links use the existing file-ticket service. The desk is an additional navigation entry called Water and Habitat Context.

## Operator workflow

1. Open the scientific Workspace that holds the retained source editions. Enter Water and Habitat Context in its navigation.
2. Select a reporting polygon source. An unfiltered selection uses the union of all retained source features. Open Native layer and selection to select an actual layer, add native field-equality filters, or select exact native feature IDs.
3. Use Inspect native fields and sample to see the provider's actual field names, types, feature count and first 20 native attribute records. Sample checkboxes populate the exact native ID selection. Keep leading zeros in HUC and utility identifiers by using the Text value type.
4. Select available NWI aquatic inventory, NWI mapping status, NHD flowline, NHD waterbody, PAD-US and authoritative stream-order sources. NHD flowline and waterbody remain independent choices even when both carry the same source role. NWI_CONTEXT is an alternative retained grid input. Its declared paired mapping-status companion is selected automatically when a separate status source is omitted.
5. Add retained HUC and utility polygons under HUC and utility relationships. These source-native footprints may describe a hydrologic catchment, reporting unit or source-water protection buffer; the desk preserves their supplied meaning.
6. Choose Run context analysis. The original task desk reports queued, running, complete or failed status. The form remains available while the operation runs. When its task completes, the desk opens that saved analysis.
7. Read the selected-area inventory and NWI coverage partition. Expand native class tables, boundary relationships and source editions. The map supports per-layer visibility, pan, zoom, fit and clicking a feature for original native attributes.
8. Use the saved-analysis selector to reopen a record. Use this saved selection restores its exact source references and filters into the input controls for another run. Selection JSON can also be saved and opened locally; the completed calculation retains its normalized selection in the scientific Workspace.
9. Download the complete analysis ZIP or individual GeoJSON, CSV and JSON files. Transfer the full scientific Workspace through the existing backup and restore flow to retain the original inputs and continue operating the project.

Refresh analyses and sources updates the source catalogue and saved records without changing the input form. Browser draft storage preserves valid selections under the selected Workspace key. Workspace changes invalidate pending detail reads and detach the current map.

## Reading results

Area measurements use the full source geometry after clipping and geometric union. EPSG:5070 is the default projected area CRS; another selection must use a projected CRS with horizontal metre units. Line measurements use WGS84 ellipsoidal geodesic length after clipping and union.

NWI is an aquatic habitat inventory, including wetlands, ponds, riverine and deepwater classes. Digital-only, provider No_Data-only, conflict and unknown mapping coverage form a disjoint partition. Mapping-status filters are excluded because every retained status record participates in that partition. Positive selected occurrence remains present where separately dated status is unknown, conflicting or No_Data.

Digital coverage without selected NWI occurrence is the complement of the selected retained inventory. Native class and feature filters change that selected inventory. Acquisition scope and source vintage remain visible.

PAD-US inventory overlap uses the unique polygon union and preserves native GAP and manager classes. Manager identity and conservation status retain their distinct source meanings. Flowline length includes the supplied native ftype classes. Authoritative stream order comes from the selected streamorde/streamorder source field.

Each HUC or utility row preserves its full original polygon area and the selected overlap. Share of selection divides overlap by the union of the reporting selection. Share of original boundary divides overlap by the original native polygon area. Local inventory percentages use the selected overlap. Overlapping classes and boundary rows are interpreted independently.

The map shows the saved WGS84 preview. Its feature count and 30 m display simplification are stated beside it; the preview is never used for measurements. The full GeoJSON contains the complete derived geometry. Native vectors retain their original IDs; grid footprints use explicitly derived component identities.

## Automation and command line

water_context_cli.py supplies catalog, list, build, show, preview, export and verify. Commands open the same Workspace and use the same core as the browser. Run --help for the complete argument contract.

The provider accepts the registered build payload {"selection": SPEC}, or a previously retained selection_id. Full spec and result schemas are documented in model/WATER_CONTEXT.md and operator/WATER_CONTEXT_SERVICE.md. There is one original task queue and one scientific Workspace.

## Receiving the complete source

All files carry independent byte counts and SHA-256 hashes in the source bank. Decode files[].content_base64 as UTF-8, verify its bytes, then compose that postimage into the cumulative application. The source is authored by TokenJunkieLabs.

Current source contracts were read from the retained original Workspace/raster bank F0C88M8KM55, domain overlays F0C8TDR500L, maintained operator18 F0C8GLD74CT, and ECSA registry F0C8PRVG4EN. The current cumulative252 carrier F0C8JNZTURK provides the broader application dependencies.

Scientific source review covers the NWI partition, source-native identity, grid footprints, union measurements, boundary denominators, filtered occurrence and original Workspace archive behavior. Core Python compilation and browser module parsing are recorded separately from an actual regional native run. The original input collections and native receiving environment determine the selected regional run.
