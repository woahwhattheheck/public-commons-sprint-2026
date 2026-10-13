# Geographic figures for saved Conservation portfolios

## Original portfolio to the existing Scientific Reports composer

The geographic producer reads a completed original Conservation study and saved portfolio. It supplies ordinary upstate.scientific-figure-spec/v1 panels to the maintained scientific-map-figures component. Scientific Reports uses the same ReportLab Drawing for SVG and PDF. Existing report selection, preview, PDF/HTML, archive and editable receiving remain the report owner's workflow.

The producer adds no scientific run and does not recompute the optimizer. It retains the existing decision packet, all candidate and selected rows, original sources, complete optimization analysis and source-native execution metadata. Map generation verifies the saved vector geometry and original context interpretation before constructing geographic figures.

## Figure sequence and geographic meaning

| Figure | Grey geometry | Dark geometry | Meaning |
| --- | --- | --- | --- |
| Regional selection | All original reporting footprints | Selected whole-unit union | Where the selection lies within the retained planning inventory |
| Selected footprints | Selected reporting-clipped union | Selected whole-unit union | Difference between within-reporting and whole-source land area |
| Declared context | Selected reporting union | Original selected context within the reporting boundary | Relation explicitly supplied in the original study |
| Selected context intersection | Unioned context intersection | Selected reporting union | Context overlap separated from total selected land area |

The first two figures are always produced for a nonempty completed selection. Each nonempty declared protected-land, drinking-water or high-quality-water context adds its context panel and, when the intersection is nonempty, a separate overlap panel. The context frame uses the shared numbered legend when its entire visible cohort fits within six labels. Larger cohorts retain their complete source-feature register and full report table; an arbitrary six-feature subset is never substituted. Labels use retained native feature IDs and, when supplied by the original source, INTAKE and BUFFER_FT. The full table preserves NAME and FACILITY as well. Label anchors are cartographic positions within the reporting-clipped feature, not observed intake or monitoring sites.

No additional context is inferred from a title, watershed identifier, intake name or apparent proximity. The original full candidate and selected tables remain available for feature names and IDs; there is no arbitrary top-N map selection.

For the operated Upper Savannah protection plan 51de867031a4365cab5090693cc4d534399225c31a3f0731368431ee2b77cc8a, the original 12 selected HUC12 units have a selected union of 137,230.918847 hectares and a source-water overlap of 15,189.437123 hectares in EPSG:5070. These are different quantities. The four published source-water polygons generate four geographic figures: inventory, whole/reporting footprint, context and selected intersection. The independently retained geographic cell-centre mask area of 15,194.43 hectares is a raster sampling result and is not substituted for the vector intersection. The actual source-context plan retains unbound nitrogen, phosphorus and sediment values. Maps do not fill those fields.

These example identities and quantities come from the completed original regional receiving result, retained as libfile_0b72f09311248191a3d06b36628fe972, with full 214,778,005-byte original project archive SHA256 4d4572c7e12e4dd1c21802e98869888e1e1fe71f6aed27953b69947b281d635b. They are operation context, not defaults or fixture data for other projects. A later South Carolina reporting study uses its own actual saved plan, reporting boundary, unit inventory and context bindings through the same functions.

## Original geometry and coordinate rules

Planning features come from the completed study's original geometries.json WKB, whose descriptor hash is bound in the saved plan selection. The original and reporting-clipped geometry are both retained for every selected unit; complete reporting footprints are kept for every candidate. Native candidate IDs, labels, original attributes, source identities, source feature positions and recorded geometry operations travel in the map input.

Selected unions are compared with the saved whole-unit and reporting union totals and with the actual selected_union layer in the original portfolio GeoPackage. The reporting boundary is read from the original bound native grid or source-context selection. Context geometry uses Conservation's same maintained source reader, exact source edition, typed filter, declared buffer and original projected CRS. The renderer does not reproject, simplify or repair geometry. Source-context transformation, union and clipping follow the already-declared Conservation method and remain explicitly recorded.

Every map uses the original projected metre analysis CRS, its WKT and XY axes. Geographic coordinates, feet and Web Mercator area are not silently accepted as metric analysis. Grid north is positive projected Y. The scale bar is projected grid distance, not a ground-distance or geodesic correction. Display margins alter the frame extent only; original coordinates and holes are retained. Grey fill and dark outlines distinguish the exact printed geographic roles rather than quantitative intensity. No basemap, interpolated surface, satellite image or undocumented reference geometry is inserted.

The saved-area agreement tolerance is max(0.000001 hectare, abs(saved area) × 0.000000001). This is a numerical agreement check between retained results, not a claim of survey or positional accuracy. For LineString/MultiLineString high-quality-water context, the original high_quality_contact_length_m is checked separately with max(0.0001 metre, abs(saved length) × 0.000000001). A line's zero area does not mean that its contact length is absent. Polygon perimeter is not labelled as stream contact, and no spatial intersection is relabelled as documented hydrologic connectivity.

## Exact producer interface

model.conservation_report_maps.capture(workspace, state, plan) returns upstate.conservation-report-map-inputs/v1. It retains project/study/plan/selected identities, analysis CRS, saved-area checks, original input descriptors, context source selections, native library and reader identities, full candidate reporting geometry, selected original/reporting geometries and unions, reporting boundary, context features/unions and selected intersections.

model.conservation_report_maps.prepare(workspace, state, plan, directory) writes and verifies:

- figures/conservation-map-inputs.json: the complete original geographic input and method record.
- figures/conservation-map-context-features.json: the complete original source-feature register and declared cartographic anchors.
- figures/conservation-map-spec.json: the ordinary shared figure specification and exact geometry bank.
- figures/conservation-*.svg: the shared renderer's actual vector figures.
- figures/conservation-map-members.json: immutable identity, every figure file descriptor and summary.

The geometry bank is keyed by the existing common.digest(GeoJSON geometry). Each layer's source descriptor points to the complete retained map input, with its project/plan and geometry location. Bounds contain all original XY vertices. Panels use the maintained projected_geometry_map kind and explicit role_labels to preserve the producer's geographic meaning; default shared renderer labels remain unchanged for other producers.

The completed report recipe declares figure_spec and ordered figures, and includes every map member among its ordinary hashed inputs and source companions. The full original planning/context sources and sidecars also remain in the existing report source namespace. There is no source-view path or unretained external map dependency in the recipe.

## Identity, retries and receiving

The source's edition is conservation-saved-plan-report/3. Map inclusion is the default and is a strict boolean include_maps choice. Its immutable identity includes the map capture, shared renderer/dispatcher, geometry-reader source hashes, PyProj/Shapely/ReportLab versions and drawing width. Original study, plan, native execution, packet, optimizer analysis and source bindings retain their existing identity rules. Different installed rendering source produces a new source edition while earlier retained figures and receipts stay readable.

The map inventory is written last. A repeated preparation verifies every existing map member against the saved original descriptor before reuse. The existing report-source lock owns the operation; completed report receipts are likewise written last. A partial operation retains its complete files and resumes under the same original identity. Mapped and source-only report sources are separate identities. Use --no-maps only when a source-only report is intended.

On the existing equipped application, continue the same original course:

~~~sh
/opt/pyvenv/bin/python -m model.conservation_report_source_cli \
  --workspace /mnt/data/eco-cohort-resume/received/workspace \
  prepare --plan-id 51de867031a4365cab5090693cc4d534399225c31a3f0731368431ee2b77cc8a
~~~

Inspect the returned source ID through the same CLI, open the returned exact source_collection_id/source_id in Scientific Reports and use its existing preview/render entrypoint. Confirm the four figures for this actual one-context study, full coordinate/source companions, distinct selected and overlap areas, readable labels/scale/Grid N/CRS, actual SVG and PDF outputs, and unchanged optimizer files. Reopen the receipt and renderer result in a fresh Workspace and through the existing independent archive receiving course. An installed source file or a successful static guard check does not establish that native rendering has completed; retain the actual native result with its original source/report IDs.

Source-only preparation remains:

~~~sh
/opt/pyvenv/bin/python -m model.conservation_report_source_cli \
  --workspace /ABSOLUTE/EXISTING/WORKSPACE \
  prepare --plan-id ORIGINAL_64_HEX_PLAN_ID --no-maps
~~~

## Component closure

The existing conservation-scientific-report-source component adds this helper and guide and depends on scientific-map-figures. Keep the map owner's current component/dependency split, ordinary observed-context/source-report renderer and original Scientific Reports transfer family. No shared application controller, alternate geometry parser or alternate PDF renderer is introduced by this consumer.
