# Routine nutrient context in the existing scientific report

This continuation adds the executed 2023 routine nutrient interpretation to the maintained observed-science report. It reuses the original six source tables and the existing Observed water quality desk.

## Sources and scientific scope

The original cohort comprises 96 reported nutrient results in 24 SWS-2023 routine activities at SV-268 and SV-374. Twenty-four same-activity total-nitrogen sums retain their TKN and nitrate/nitrite source identities. The two endpoint views each contain the same 120 calculated value rows; their counts represent views of the same sources.

The complete original thirteen-file contribution remains under observations/observed_hydrology_20261013/nutrient_flow_contrasts. Its original model-sources.json is preserved byte-for-byte. The application-root eighteenmile_routine_nutrient_flow.sources.json registers the same six entry IDs and table hashes with canonical app-relative paths. Every entry carries the original thirteen-file analysis and the retained 88-file hydrology source edition as companions, excluding its own primary body. Original agency responses, exact calculation inputs and methods consequently travel with an exported table. Native content-addressed storage reuses identical original objects.

The source processor is executed before composition. All seven calculated CSV/JSON files must match their retained bodies exactly. The formatter retains all four original scientific figures and existing report sections; it appends four sections covering routine cohort/censor bounds, unmatched flow-band contrasts, the single shared sampling date and the June12 constituent response. Below-limit enclosures remain conservative measurement support, rather than substituted measurements or confidence intervals.

## Compose into the current report edition

Run from the existing application after receiving the original thirteen files and both source tools:

```sh
node source_tools/compose_nutrient_flow_report.mjs \
  --application "$PWD" \
  --output /owned/observed-nutrient-report-composition
```

The tool reads the current observed_hydrology_context.report.json and observed_hydrology_context.sources.json, verifies their existing binding, checks every original source hash, and writes four complete postimages into the separate output directory:

- eighteenmile_routine_nutrient_flow.sources.json
- observations/observed_hydrology_20261013/nutrient_flow_contrasts/report-sections.json
- observed_hydrology_context.report.json
- observed_hydrology_context.sources.json

Apply these postimages together through the normal cumulative source publication. The composer preserves existing recipe sections, figure selections, links and companions, including the daily-flow explorer and lake report. Identical recomposition is stable. A changed pre-existing source member or changed same-title routine section produces a specific error before writing a different source edition.

The module source_tools/nutrient_flow_report.mjs also exports composeRoutineContext for in-memory source composition. Pass all original files, the current recipe/source-manifest text and a SHA256 function. Its ORIGINAL_NUTRIENT_FLOW_INPUTS list records the exact 101 original source members. The returned complete recipe and manifest include the original native source IDs and all current companions.

## Receive in the same Workspace

Use the existing receiver or invoke the retained original importer with the canonical manifest:

```sh
python -B observations/observed_hydrology_20261013/nutrient_flow_contrasts/import_into_workspace.py \
  --application "$PWD" \
  --workspace /actual/retained-workspace \
  --manifest "$PWD/eighteenmile_routine_nutrient_flow.sources.json" \
  --output /actual/retained-workspace/routine-nutrient-context-import.json
```

The existing importer identifies observed-hydrology-nutrient-flow-dated-20261013 by its original entry ID and imports lower_mg_l and upper_mg_l as two explicitly labeled context views. Its default relative thirteen-file manifest remains valid for the original edition; the argument above selects complete source closure for this application.

The cumulative receiver resolves the retained importer relative to the imported source collection's view root. Derive that root from body.view_path before joining a companion view_path, because canonical paths are application-relative. Preserve the actual returned collection and observation IDs in the same receiving state.

Re-import the composed observed report source through source/observed-report-20261013/install.py or the maintained native source receiver. Use the actual returned OBSERVED_CONTEXT source role when preparing a new report. Existing captured reports retain their original binding.

## Application transfer

Include eighteenmile_routine_nutrient_flow.sources.json in the existing portable root-file inventory. The maintained observations/ and source_tools/ directories already carry the original source contribution and compositor. Retain the current root report recipe and source manifest alongside the other root source registrations.
