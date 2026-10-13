# Scenario analysis with original discharge source context 1.1

This component adds **Source context** inside the maintained Scenario analysis results. The operator can select an actual saved analysis region, an already retained point-source binding, and its original gauge; inspect their support; retain a contextual report; and open the complete HTML, JSON, native-change CSV, source-calendar CSV and facility-relationship CSV through the existing authenticated file transport.

The component uses the original native analysis quantities and existing observed-source intake. Its backend-only extension registers tasks, state, retained items and file routes. It adds no second application, task queue, scientific solver or navigation desk.

## Installation and receiving order

Receive the original current workbench and Scenario analysis, observation support 1.1, and retained point-source context 1.0.1 first. From the complete component source:

    python operator/install_analysis_source_context.py \
      --application ACTUAL_CURRENT_APP \
      --source-root RECEIVED_COMPONENT

The installer adds its native module, CLI, provider, browser helper and descriptor, then composes eleven exact source seams into the maintained Scenario analysis controller. It also inserts the missing exclusive flock in the existing point-source installer. Shared postimages in this bank are for review; the installer reads the live application and applies guarded edits. Independently changed adjacent logic remains intact. Unknown changed seams require an actual merge.

The installer records every changed preimage, stages pending.json before writing, installs the new descriptor last, and preserves a stable current.json on an identical repeat. The existing point-source installer correction acquires its already opened lock before source changes.

The canonical shared controller preimage is from public-commons-sprint-2026 commit b39554bf4ead42d1fb42af7c21a9e241f384fd41 at opportunities/upstate_forever_2026/operator/web/scenario_analysis.mjs. It includes the original baseline-only path, source-area handoffs and GIS delivery; all remain present after composition.

## Operator workflow

1. Import the original DMR period and routing manifests into the scientific workspace. In Point-source context, select the four retained original table entries, preview them and create their immutable binding.
2. Complete or open an existing native Scenario analysis. Select **Source context**.
3. Choose an actual retained analysis region, original point-source binding and gauge, then add that link. Several explicit links may share one report.
4. Preview the native changes and original source coverage. This verifies the retained inputs and evaluates the actual polygon overlap.
5. Retain the reviewed contextual report. The original task queue writes a content-addressed record and immutable exports. The completed operation has the standard download controls; the report also appears in the analysis's Source context list.
6. Open the printable report or the machine-readable tables. Existing observation edition buttons open the complete annual or quantified-period context in the original observation interface.

Source choices refresh when retained point-source bindings change. Retained report and task changes use the existing workspace state updates. There is no second polling loop. Requests carry the selected workspace/analysis identity; stale and aborted results cannot replace the current desk.

## Native API and unattended receiving command

The API is model.analysis_source_context:

- catalog(workspace, analysis_id): original regions, retained source bindings/gauges and completed contextual editions.
- preview(workspace, selection): exact source and native-analysis binding, actual geometry support, unchanged native physical rows, dated source calendars and observation links.
- create(workspace, selection, expected_signature=...): reopens the exact previewed sources, retains an immutable contextual edition, and writes deterministic exports.
- inspect(workspace, report_id): verifies the saved edition and its declared export bytes.
- artifact(workspace, report_id, name): returns only one declared and verified artifact.
- summaries(workspace, analysis_id=None): compact overview records.

Selection:

    {
      "analysis_id": "ACTUAL_COMPLETE_ANALYSIS_ID",
      "title": "Native scenario changes and original discharge sources",
      "links": [
        {
          "region_id": "ACTUAL_REGION_ID",
          "binding_id": "ACTUAL_POINT_SOURCE_BINDING_ID",
          "gauge_id": "USGS-02186702"
        }
      ]
    }

The CLI supports the same actual selection:

    python -m model.analysis_source_context_cli \
      --workspace ACTUAL_WORKSPACE \
      --selection ACTUAL_CONTEXT_SELECTION.json \
      --retain --output ACTUAL_CONTEXT_RESULT.json

It previews and retains the same original binding without a browser. With --retain omitted, it returns the complete preview only. Select IDs from the actual retained workspace; the example is a field contract.

Registered queued action: scenario.source_context.build, payload {selection, source_signature}. The provider rechecks the exact signature before retaining the report.

## Physical quantities and spatial support

Each native row is copied from the completed analysis's physical array. It preserves the original run, pollutant, units, baseline_common_sum, common_sum, signed change, common valid cells, common area, coverage fraction and original percent status. The builder requires one original row per selected run/pollutant and reconciles change to alternative minus baseline. Nitrogen and phosphorus stay in kg/year; sediment stays in metric_tonnes/year. Baseline-only analyses also work.

The original analysis JSON and consumed physical CSV/region GeoPackage are retained by exact file descriptor. The original run selections, native model/version scope and profile-declared period fields are included. Annual output units alone do not establish a measured calendar-year observation.

The geometry join uses the analysis's actual analysis_regions layer and the source binding's retained gauge_reference.json and gauge_whole_basin.geojson companions. source_file first verifies every original body and companion. The component additionally confirms exact selected companion hashes, original gauge identity and source CRS. The original GeoJSON default is WGS84 when no CRS declaration exists. Both geometries are compared in the analysis's projected metre CRS.

The report retains the reporting-region area, original whole-basin area, their intersection in hectares, both fractional overlaps, and whether the gauge point lies within or on the selected region. A zero-area overlap is rejected. These geometric quantities do not change the selected native raster footprint. Native common-area coverage stays pollutant specific and is displayed separately.

Actual network relationships continue to determine the discharge cohort. Whole-basin polygon membership never becomes an upstream assignment.

## Original Eighteenmile source family

This report consumes the already retained original family observations/eighteenmile_2023/npdes, including:

- derived/period_loads.csv: the selected reporting periods.
- routing/derived/annual_quantities_with_routing.csv: original annual and quantified-period quantities with species and source identities.
- routing/derived/outfall_gauge_relations.csv: actual original source-to-gauge network relationships.
- routing/derived/reported_quantities_by_gauge_relation.csv: declared source cohort membership and quantities.
- routing/originals/gauge_reference.json and gauge_whole_basin.geojson: original spatial context.
- Existing source-calendar outputs, complete original EPA quantity lineage, and retained observation edition IDs.

The original USGS gauge source is https://waterdata.usgs.gov/monitoring-location/USGS-02186702 and its retained NLDI network source is https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-02186702/navigation/UT/flowlines?f=json&distance=100&excludeGeometry=true .

The original network distinguishes Milliken upstream of the gauge on the same reach from Pendleton-Clemson downstream on that reach, although both are inside the original whole-basin polygon. Pickens Upper and Middle are on the original upstream flowline list. Consequently, the complete upstream 2023 phosphorus source amount is 949.31580872 kg, while all four facilities within the whole-basin polygon sum to 1119.47500782 kg. The report obtains these quantities from the selected retained binding; no amounts or membership are inserted into its model code.

The existing source-calendar method allocates original reported mean rate over the actual represented days using Decimal arithmetic. It preserves species and series dimensions, shows unknown days and missing species, and publishes facility shares only for a complete cohort year. The report retains that method and the actual calendar year beside the native model result.

## Interpretation and export stability

The native scenario change is a modeled landscape contribution to streams. The observed records describe facility discharge at the original reporting features. Source calendar timing and native annual scenario reductions are displayed together to support inspection; the component does not add their masses, infer combined river delivery, claim a facility reduction from a landscape intervention, or treat facility effluent as a catchment calibration target.

Each linked reporting region repeats its selected original context explicitly. Neither overlapping native regions nor repeated source records may be summed as disjoint quantities.

The saved edition is content-addressed from the exact selection, original native record/file identities, source binding signature, geometry results and method version. Retry creates the same retained ID. Exports have their own immutable manifest; reopening verifies their bytes and can complete an interrupted first publication without substituting current display code for an already completed report.

The HTML is self-contained, printable, escaped, and served with a restrictive content policy. It includes the complete physical, source, monthly, facility, spatial and lineage content. CSV text fields protect formula-leading characters; numeric native changes remain numeric. Complete source amounts retain their original decimal strings.

## Focused verification

The authored browser helper and complete merged Scenario analysis controller pass V8 grammar parsing. A focused implementation exercise confirmed that an aborted old-workspace catalog request does not overwrite the new selection, and that the exact normalized reviewed selection is submitted with its source signature. The exercise used controller reference records and made no hydrologic quantity claim.

The shared controller's guarded edits apply exactly once to the current original preimage and remain unchanged on repeat. The original current registry accepts backend-only descriptors, declared file-route arguments, standard queued actions, state and item bindings used here. Native GIS execution uses the installed source/runtime and the actual retained workspace; it is an explicit receiving step when that runtime is available.


## Receiving and archive integration in edition 1.1

The current shared controller includes the peer's newer source-area intake pathway. All eleven context seams apply to that current source, preserving the newer behavior. The installer additionally composes one small conditional verifier into the original portable restore before its final directory publication. Its unique inserted block remains idempotent when the programme adopter independently inserts its own verification beside the same final-publication comment.

The backend registers verify_workspace with the maintained extension registry, so operator receiving checks these records before registering the restored workspace. The original portable CLI restore also calls the native verifier when contextual records exist. The explicit receiving command is available:

    python -m model.analysis_source_context_cli \
      --workspace RESTORED_WORKSPACE --verify-workspace \
      --output RESTORED_CONTEXT_VERIFICATION.json

Verification retains the original method and quantities. It checks each content-addressed context record and preview signature; the exact original analysis JSON, physical table, geography descriptor, selected run/profile and physical rows; original retained point-source bindings, observation editions, cohort and calendar quantities; actual gauge identity, reach code, measure and source-capture hashes; and every declared export against its saved physical/source record. It does not rerun native models or recalculate geometry floats on a different GIS library version.

Both registry and native restore integration are additive. Generic original archive inventory already includes context JSON, all five export artifacts and their manifest, the full maintained model/operator/source modules, and all content-addressed source objects. Its deliberate omission of derived source-views is compatible: source_file reconstructs the actual native companion layout from retained objects and verifies every member.

The first report publication acquires the original workspace lock once around its immutable record and exports. The export helper knows when that lock is already owned, preventing nested acquisition. Reading a complete report only verifies its existing immutable export manifest; repairing an interrupted first publication acquires the lock. This uses the same capture boundary as the original workspace archive.

Original routing/capture.json is now included explicitly in each context link. Its gauge identifier must match the reference feature and quantity cohort; its source-file hashes must match both retained gauge companions. The original whole-basin URL and splitCatchment=false selection are retained in the report lineage. Every facility relationship must also agree with the gauge's original COMID, ReachCode and measure.

The actual retained family passed the source-view compatibility check: gauge USGS-02186702 in the reference, all four relationship rows and all seventeen cohort rows; eighteen original relation-entry/body/companion hashes; common native path parent "."; the body view routing/derived/outfall_gauge_relations.csv and basin view routing/originals/gauge_whole_basin.geojson. All source-capture hashes agree and the retained basin request explicitly uses splitCatchment=false.

The browser and complete HTML now display the source-calendar method immediately beside the monthly quantities. Very small nonzero native quantities use scientific notation in the browser instead of rounding to an apparent zero. Existing complete edition1.0 exports retain their original bytes and remain verifiable.
