# Eighteenmile reported load and wastewater volume

Edition: ECHO-POINT-SOURCE-LOAD-VOLUME-20261013-r1

This additive source component uses the original EPA monitoring-period values already retained with the complete Eighteenmile source cohort and historical explorer. It provides an offline HTML report, four CSV tables, complete analysis JSON, the executable original calculation, an input-pinned replay command, and a native Workspace source manifest.

## Receiving

Overlay these files at the current application root after the complete 170-file original source cohort and 24-file historical explorer r2. Keep their original files in place. The three original inputs are pinned in source/point_source_drivers/20261013/input-manifest.json. The existing source_tools/point_source_cohort.mjs CSV parser is a required base module.

Replay with Node.js:

    node source_tools/point_source_load_volume_cli.mjs --root /absolute/current/application

Register the six source entries with the current native interpreter:

    python -B source_tools/import_point_source_load_volume.py --project-root /absolute/current/application --workspace /absolute/existing/workspace

The importer returns the actual collection ID and all six source IDs, and saves receiving/native-import.json beneath this component. It uses the original Workspace.import_sources contract. Opening source/point_source_drivers/20261013/report.html displays the complete offline report. Its buttons export the full analysis and exact summary, monthly and cohort tables. The manifest retains original input companions through the existing content-addressed source store.

## Original data and comparisons

The analysis has 30 series/windows and 295 exact paired months: complete 2024–2025 monthly years and the historical explorer's actual 2025–2026 common-month windows. Every selected pair retains permit, reporting feature, monitoring location, original parameter code, exact period dates and both original response pointers. Middle Eighteenmile current total nitrogen has months 1, 2, 3, 5, 6, 7 and 8. Pendleton–Clemson comparisons cover January–July. The selected upstream phosphorus and suspended-solids cohorts cover January–August. Two quarterly/ineligible windows remain in coverage.csv.

All 30 selected windows have original positive published volume support. The source query uses p_est=N and ND=ZERO. Raw published concentrations, measurement choices, quantity/concentration fields, qualifiers, non-detect, NODI and QC fields remain in the paired-month source projections. Original displayed numeric precision is retained as the calculation input.

## Method and units

M is reported period load in kg. V is reported period wastewater volume in million US gallons. I = M/V is load per million US gallons.

For each matched month:

    volume component = (V1 - V0) * (I0 + I1) / 2
    intensity component = (I1 - I0) * (V0 + V1) / 2
    load change = volume component + intensity component

The displayed comparison sums those paired-month components. The alternative whole-window identity is retained separately because aggregation changes the allocation. These are descriptive accounting components of original reported mass and volume. The original EPA average-concentration value in mg/L remains a separate field with its original measurement choice; plant-level causes need their own operational evidence. Numeric output is rounded to ten decimal places after full-precision arithmetic.

Cohorts sum the three individually calculated series and retain the pollutant parameter. Pendleton–Clemson stays separate under its current downstream relation to USGS-02186702. This component registers original point-source context in the existing source store.

## Result of interest

For Milliken's original T1M phosphorus series, January–August volume falls from 290.28 to 241.31 million US gallons (−16.87%), while load rises from 459.60 to 791.95 kg (+72.31%). Load per volume rises from 1.58330 to 3.28188 kg/Mgal (+107.28%). The exact paired-month volume component is −94.5586655634 kg and intensity component is +426.9086655634 kg, summing to +332.35 kg.

Across the three currently upstream TP series, the same-month change is +292.60 kg. Paired-month components sum to −113.3000341526 kg for volume and +405.9000341526 kg for intensity. Upper and Middle's reported loads both fall; the original Milliken increase accounts for the cohort direction.

## Primary source

EPA Loading Tool field definitions:
https://echo.epa.gov/help/loading-tool/custom-search/custom-search-results-help

EPA technical methodology:
https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology

Complete original API response bodies and their capture identity remain in the established source cohort. This additive component reuses those retained originals and the historical explorer's exact source selection.
