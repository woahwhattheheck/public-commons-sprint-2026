# Eighteenmile discharge history and comparable-period explorer

Edition: ECHO-POINT-SOURCE-HISTORY-20261013-r2. Source capture: 2026-10-13T01:22:10Z.

Open source/point_source_history/20261013/report.html directly in a browser. The complete report works offline: original-series chart, seven selectable tables, original-row inspection, source links, CSV/JSON exports, SVG download and print. Its presentation uses neutral industrial typography and monochrome charts. The package includes complete prepared outputs, reproducible analysis source, four exact replay inputs and an ordinary native source manifest.

## Findings from the retained original reporting records

The source spans four permits, 20 nutrient/TSS reporting series, 321 series-year rows and 3,046 distinct original monitoring-period records. A series retains permit, reporting feature, monitoring location and parameter code. Of those series-year rows, 199 have twelve unique numeric monthly periods in a completed historical year. Fifteen original series support both the 2024–2025 full-year and the 2025–2026 same-month comparisons.

Current original DES/NHD routing places Upper Eighteenmile SC0042994, Middle Eighteenmile SC0047856 and Milliken SC0000477 upstream of USGS-02186702. Pendleton–Clemson SC0035700 is mapped downstream. The history uses that present mapping as a contextual cohort label and retains each original EPA reporting-feature identity.

| Three current upstream permits, total phosphorus | Earlier period kg | Later period kg | Change |
| --- | ---: | ---: | ---: |
| Complete 2024 → complete 2025 | 520.70 | 955.70 | +83.54% |
| Same January–August, 2025 → 2026 | 655.73 | 948.33 | +44.62% |

The 2025 upstream phosphorus total is close to 2023's 949.71 kg. The complete current three-permit cohort ranges from 520.70 to 985.58 kg across 2021–2025, with 2024 the low year. Thus +83.54% describes the specific 2024-to-2025 comparison.

Each complete-year total contains twelve numeric monthly records for each of the same three original reporting series. Each current-year total contains the same eight months for every member.

| Original phosphorus series | 2024 kg | 2025 kg | January–August 2025 kg | January–August 2026 kg |
| --- | ---: | ---: | ---: | ---: |
| Upper Eighteenmile / 001 | 80.81 | 133.74 | 98.24 | 74.65 |
| Middle Eighteenmile / 001 | 53.80 | 128.17 | 97.89 | 81.73 |
| Milliken / T1M | 386.09 | 693.79 | 459.60 | 791.95 |

The current common-month increase is concentrated in Milliken's original T1M series; the two municipal upstream series decline over the same eight months. The report allows inspection of every included original period and source pointer.

Pendleton–Clemson's phosphorus series rises from 248.60 kg in 2024 to 411.65 kg in 2025. Its available comparable 2026 coverage is January–July: 242.31 kg for those months in 2025 and 308.43 kg in 2026. Its downstream relationship is preserved and its seven-month window stays separate from the three-permit eight-month window.

For suspended solids, the three current upstream full-year period sums are 44,237.84 kg in 2024 and 50,000.63 kg in 2025. The common January–August subtotal is 31,438.88 kg in 2025 and 43,918.24 kg in 2026. The distinct TSS parameter remains available in the same tables and original-series chart.

## Annual values and reporting support

All 303 selected series-year rows with a single numeric annual value under both p_est=N and p_est=Y returned equal displayed values. Seventeen selected series-years contain multiple original annual rows; those arrays remain intact and are not silently summed into a single annual value. One additional selected row has no scalar numeric value.

The source's annual values can exceed the available monitoring-period sum under either estimation selector. For 2026 Milliken T1M phosphorus, both original annual selectors return 1,189 kg; its eight available numeric monthly periods sum to 791.95 kg. The Y response carries EstFactor 1.5. The program keeps the annual values, original factors, period subtotals and differences in separate columns; it does not multiply an already published annual value again.

The original load requests select p_nd=ZERO. Original numerical values are retained under that setting, with original NdFlag, NodiDesc, qualifiers, source IDs and JSON pointers. Nonnumeric original periods remain missing and affect the support classification. Percent change uses a nonzero earlier-period subtotal; unsupported or zero denominators produce null.

The analysis follows the source's reporting-period-ending year. Full-year comparisons require twelve distinct numeric single-month reports with exact calendar-month starts and ends. Same-month comparisons use the intersection of those valid months in both years. Three-permit comparisons intersect the month sets across all three original series. Quarterly intervals, cross-year periods, duplicates and future source placeholders remain inspectable.

The historical period-sum calculation and the existing calendar-weighted science calculation each retain their physical basis. For 2023 the upstream phosphorus period sum is 949.71 kg, while the separately maintained calendar-weighted science result is 949.31580872 kg. Historical comparisons use the former consistently. These discharge quantities remain point-source context alongside gauge observations and watershed model exports.

## Files and use

- source_tools/point_source_history.mjs: pure original-record analysis and CSV writer.
- source_tools/point_source_history_build.mjs: complete source/output/manifest builder.
- source_tools/point_source_history_report.mjs and point_source_history_browser.mjs: offline report renderer and interactive browser.
- source_tools/point_source_history_cli.mjs: Node standard-library input verification and atomic output generation.
- source_tools/import_point_source_history.py: ordinary Workspace.import_sources intake, returning actual saved collection and source IDs.
- source/point_source_history/20261013/input-manifest.json: exact four input paths, byte sizes and SHA-256 values.
- source/point_source_history/20261013/analysis.json: all analysis rows and original source references.
- Seven CSV files in the same directory: annual coverage, series inventory, full-year changes, same-month changes, full-year upstream cohort, same-month upstream cohort, original selected monitoring periods.
- source/point_source_history/20261013/report.html: complete offline report.
- point_source_history.sources.json: nine native entries, with CSV primaries and original-input companions.

Replay from the current application root:

    node source_tools/point_source_history_cli.mjs --root /absolute/current/application

The program verifies all four pinned source inputs, regenerates all ten output files and prints actual output identities. It uses the original cohort CSV parser retained alongside the source.

Register the prepared history in the existing workspace:

    python -B source_tools/import_point_source_history.py \
      --project-root /absolute/current/application \
      --workspace /absolute/existing/workspace

The native import writes source/point_source_history/20261013/receiving/native-import.json with actual source collection ID and nine source bindings. Use the existing source inspector or retrieve the registered HTML document. The source-only historical import needs the existing Workspace source engine.

## Current retained-source desk intake correction

This package also includes the complete corrected source_tools/import_point_source_cohort.py. The already-shipped 170-file cohort contains all five original routing source entries and every required companion. The corrected wrapper imports both the root 22-entry cohort manifest and observations/eighteenmile_2023/npdes/routing-model-sources.json, then returns four actual desk bindings under point_source_context_bindings:

- periods → root collection / upstate-eighteenmile-2023-dmr-period-loads-872d4183e2e5
- annual → routing collection / upstate-eighteenmile-dmr-gauge-routing-annual-62ad3646420b
- relations → routing collection / upstate-eighteenmile-dmr-gauge-routing-relations-6d76f4cc627d
- cohorts → routing collection / upstate-eighteenmile-dmr-gauge-routing-cohorts-aa755c73bf33

Run the existing importer command against the received complete source:

    python -B source_tools/import_point_source_cohort.py \
      --project-root /absolute/current/application \
      --workspace /absolute/existing/workspace --source-only

The current retained point-source desk can consume the returned four-binding object as its selection, preview the actual retained cohort and pass the preview's source_signature to its original observations.point_sources.bind action. The existing original science/import owner retains that action. The wrapper preserves its seven earlier source_bindings and its original optional 230-row context import.

## Provenance and package composition

Four exact replay inputs are included at their original paths. The completed 170-file source cohort remains the companion delivery for all 70 original EPA response bodies, original detailed 2023 measurements and native outfall/routing closure. The historical explorer is an additive source and uses no alternate downloads.

Original source access:
- EPA ECHO load services: https://echo.epa.gov/tools/web-services/loading-tool
- Original endpoint: https://echodata.epa.gov/echo/dmr_rest_services.get_custom_data_monitor_pd
- Original annual endpoint: https://echodata.epa.gov/echo/dmr_rest_services.get_custom_data_annual
- Current gauge upstream context: https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-02186702/navigation/UT/flowlines?f=json&distance=100&excludeGeometry=true

Full parameterized original requests and response hashes are retained in source/echo_dmr/20261013/capture-manifest.json and the report's embedded source catalog. Each annual record includes its original N and Y row arrays; each comparison includes precise original period response IDs and JSON pointers.

Complete source cohort delivery:
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791866570315059?thread_ts=1791724121.853269

The pure original-source analysis and output generation were executed in the source runtime using all four complete retained inputs. The saved bank includes those exact outputs. Native Workspace registration runs on the receiving application's existing Python/GIS environment.
