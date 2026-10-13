# Microbial temporal and flow explorer

Open `index.html` in a current Chrome, Edge, Firefox or Safari browser. The file is fully standalone and includes all three exact original inputs, the unchanged analytical module, the calendar-support module, and their derived download tables. It requires the browser's standard gzip DecompressionStream support and makes no network requests.

## Working through the source

1. **Coverage** starts with the complete original network and a station-by-year matrix showing selected record counts and sampled months.
2. **Temporal summaries** keeps station, original analytical method and units separate. Choose a station for a dated value/limit plot. Group by year, season, month, or all selected dates. Median lower/upper bounds use original censoring intervals.
3. **Calendar support** compares the original eleven-station repeat panel in 2021 and 2025, using either all observed dates or only calendar months represented in both years. It follows the selected utility/station/method and Information Only policy. Other temporal filters do not redefine this fixed comparison.
4. **Original records** lists every selected observation in pages of 50. Inspect opens all original CSV fields, exact source comment, original sample clock, method, condition, value, limit, source filename and row.
5. **Same-station flow** retains the exact USGS-02177000 2022 case: 365 daily means and all 16 original microbial sample dates. Switch between same-date daily mean and the mean of the seven complete prior calendar days.
6. **Sources and downloads** supplies the three exact originals, all 12 analytical outputs, calendar comparisons and memberships, source manifest and source modules.

The filter controls support original utility, station, method, year, season, month, activity type and text search. Original comments remain searchable. The explicit Information Only sensitivity removes only the literal publisher marker, including its `Infomation Only` spelling. Power-failure and BOD-specific comments remain visible and do not rewrite detection status.

Export selected **original** rows as CSV or the selected station-specific summary groups. Save/open a small view JSON to retain the chosen controls. The view belongs to the pinned source edition; opening another edition is rejected. Local browser storage is optional. The complete HTML can also be downloaded again.

## Interpretation carried into the interface

The source has 730 original activities, 729 routine records and one field replicate. The full repeat panel has eleven stations and 450 routine records. Ten stations first appear in this selected source in 2025. Selecting the field replicate does not silently include it in a routine comparison.

At SV-833, all-date 2021/2025 sample medians are 419.6 and 387.3 MPN per 100 mL. Restricting both years to their eight common calendar months gives 298.9 and 666.8, with eight observations in each year. This is a calendar-support comparison, not a fitted trend. All five Georgia lake panel stations have only Information Only observations in 2025; that explicit sensitivity leaves six SC stations represented in all five years.

All sixteen matched sample-date daily means have the original A qualifier. The seven-prior-day window for 8 March includes four A;e values: 1 March 696, 2 March 647, 3 March 614, 4 March 582 ft³/s. Its remaining three days and all other fifteen prior windows are A. Inspecting the 8 March activity displays all seven original rows and qualifiers. The calculation preserves these estimates.

The full 2022 discharge maximum is 6,990 ft³/s on 4 February. None of the sixteen microbial sample dates reaches the annual 95th percentile, 1,284 ft³/s. January, February, April, September, October and December have no microbial samples. Daily means provide date/week context; no instantaneous load is inferred.

## Rebuild from the original source

From this directory on a Node.js host:

~~~sh
node build-explorer.mjs
~~~

Optional arguments are `--source ORIGINAL_CSV_DIRECTORY`, `--flow ORIGINAL_WATERML_JSON`, and `--output HTML_PATH`. The default source paths come from the unchanged `source-manifest.json`. The builder verifies all three original byte lengths/SHA256 hashes, recomputes and checks all twelve analysis outputs, and compares all three calendar outputs against their retained bodies before creating the HTML. It uses Node's built-in filesystem, crypto and zlib modules.

`explorer.mjs` is a pure HTML builder accepting the complete payload and a gzip encoder. The browser receives the unchanged published analytical/calendaring module bodies as inline source, preserving the same numerical rules. Gzip implementations may encode equivalent payloads differently; input and output identities are checked before HTML construction.

## Native scientific delivery

The application-root manifest `microbial_temporal_observed_report.sources.json` imports this as a separate document source with `metadata.report_schema=upstate.observed-report/v1`. Its body is `source/ecoli_temporal_analysis/20261013/observed-report.json`. All companions keep their complete application-relative namespace, including the original CSVs and USGS response, so the maintained source importer retains correct view paths.

Use the current source import operation with that manifest, then select its observed report in the existing scientific delivery picker. The current ordered `observed_context_sources` contract can retain this alongside other selected studies. It also works as the single `OBSERVED_CONTEXT` source where that existing interface is used.

The recipe carries native report sections/tables and retained links to the actual explorer, original source files and full CSV outputs. It does not replace the original microbial source manifest, Station provider, saved native Station study or its two supported source editions. Their current owners can attach this supplemental collection to the same study.

## Verification

The complete original-source analytical and calendar modules executed in the available JavaScript runtime. The actual controller rendered all six views in a DOM contract harness, including the full 730-record selection, 658-record Information Only exclusion, separate field replicate, SV-833 calendar reversal and original March antecedent qualifiers. Complete script syntax and embedded gzip round-trip were checked. Native browser rendering and the Node process use the published standalone source on the existing receiving host.
