# Original native-study releases

This implementation adds an explicit complete-study release path alongside the existing regional RFP delivery. The default delivery mode remains regional_rfp. The original regional audit.py and raster_checks.py continue to enforce their original grid, upstream buffer, source roles, and seven-map-family requirements.

## Complete operation on an equipped worker

The application needs its existing original InVEST 3.20.0 GIS interpreter and retained source packages. The maintained receiver checks the official native module fingerprints. Use the same existing application, workspace and input directory as the successful original Gura receiver.

Run the complete original study, planning alternatives and release:

    "$GIS_PYTHON" "$APPLICATION/source_tools/receive_gura_study.py" \
      --application "$APPLICATION" \
      --workspace "$GURA_WORKSPACE" \
      --inputs "$GURA_INPUTS" \
      --run-planning

The operation reuses completed original reference/planning/native runs. Its planning continuation checks original class 5 agriculture and class 8 forest against the retained biophysical tables before any declared conversion. The release includes the whole-watershed treatment and, when the optimizer selects a feasible beneficial portfolio, the separately executed combined subwatershed treatment.

When planning is already complete, omit --run-planning. The receiver reads gura-receiving/gura-planning-state.json and validates the actual native baseline against both original release parameter files, raster inputs, original watershed geometries and the 15 m grid. The operation records each stage in gura-receiving/gura-native-study-state.json; errors include the actual execution stage and traceback.

To select a different completed ordered cohort:

    "$GIS_PYTHON" "$APPLICATION/source_tools/receive_gura_study.py" \
      --application "$APPLICATION" --workspace "$GURA_WORKSPACE" --inputs "$GURA_INPUTS" \
      --baseline-run-id "$BASELINE_RUN_ID" \
      --alternative-run-id "$FIRST_ALTERNATIVE_RUN_ID" \
      --alternative-run-id "$SECOND_ALTERNATIVE_RUN_ID"

If the native Economic desk already contains a completed edition for those exact ordered runs, add:

    --economic-edition-id "$ECONOMIC_EDITION_ID"

This binds the source watershed report and its exact bytes, grid, original profile, selected economic zone and ordered alternatives. The original supplied costs and cost basis, physical response, budgets, economic assumptions and complete economic decision package then travel with the scientific release. An edition using a different cohort is rejected before release construction. A new economic cost assumption must be entered explicitly in the existing Economic desk.

Optional --source-report-id reuses a saved same-cohort watershed report. Otherwise, the command builds a watershed report directly from the completed native stages for the actual retained reporting area and model domain. The two areas retain their independent valid-cell supports. --paper and --dpi select print layout; optional contact fields carry actual supplied metadata.

## Operator workflow

In Map atlas and delivery, choose Original native study as the delivery mode. Enter the actual study title and purpose. Select completed same-grid, same-profile NDR/SDR baseline and explicit land-cover alternatives. Original-study contact and contextual source overlays are optional.

The source step includes original context only when selected. The release always retains actual modeled inputs, original reporting/model-domain polygons, reporting mask and biophysical table. Additional drinking-water or high-quality-water map families are produced when their source geometry or actual receiving-water contribution product is supplied.

The saved watershed-report screen also provides the delivery-mode selection and the exact-cohort economic edition selector. It opens the same atlas builder with the source report and ordered cohort intact.

## Delivered products

The native study provides five physical map families: current annual nitrogen/phosphorus exports, current annual sediment export, combined weighted export priority, future sediment changes and future nitrogen/phosphorus changes. Every additional alternative receives its own future map sheets on shared pollutant scales. Optional original source-water/context families are included when selected.

The complete release includes:
- Separate original quantitative GeoTIFFs and spatial metadata.
- Combined PDF atlas, individual map sheets, ordered JSON/CSV index and offline atlas browser.
- Scientific PDF, HTML, Markdown and structured report-data.json using the maintained scientific-report renderer.
- Existing source watershed report, scenario-analysis attachments and an exact linked economic edition when selected.
- Original-study context, source domain/reporting geometries, mask and biophysical table.
- Native scientific workspace archive and complete portable GIS package.

The new manifest schema is commons.native-study-delivery/v1, with delivery_mode=native_study and commons.native-study-context/v1 source metadata. Its package schema is commons.native-study-package/v1.

The original Gura reference is EPSG:32737 at 15 m. Each cell is 0.0225 hectares, and its original upstream buffer is zero. Native per-hectare annual rates become annual mass per pixel exactly once. Nitrogen and phosphorus remain kg/pixel/year; sediment remains metric_tonnes/pixel/year. The application preserves actual source affine alignment and NoData. Combined normalized priorities retain their own dimensionless units.

## Native-study package inspection

The explicit native-study auditor reads the retained original context, verifies official InVEST source metadata, ordered native run/grid/profile/scenario lineage, original study source files, model table, physical artifact hashes, unit tags, grid affine/CRS/shape and per-pollutant valid-cell totals. It inspects original mass GeoTIFFs blockwise and verifies the map/report PDFs. Regional RFP manifests continue through the original regional auditor.

The packager retains fresh scalable capture budgets and explicit source-member selection. Delivery construction captures into an owned sibling directory outside the source delivery, preserving the packager's original source/output separation. A completed capture is then moved into the delivery's final package directory. A failed capture remains at the path recorded in delivery-state.json for direct correction.

## Source integration

Every postimage in the accompanying source packet is complete. Existing-file entries declare base_sha256 from their actual retrieved public predecessor. New source files declare new_file=true. Preserve subsequent peer changes when rebasing. The report/delivery postimages compose the fresh scientific-report, scenario-analysis, economic, receiving-water and interactive atlas work already present on main.

No global dependencies, network requests or Actions are introduced by these source changes. Runtime scientific execution uses the existing original equipped worker and data. Complete receiving installers can compile these Python sources before directory promotion; the two changed operator modules also passed JavaScript parser checks during composition.
