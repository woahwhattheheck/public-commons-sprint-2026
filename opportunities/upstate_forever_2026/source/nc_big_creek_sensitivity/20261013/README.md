# Big Creek original chemistry and laboratory sensitivity

This complete source edition connects original NCDEQ WQX3 results to their exact sample roles, fractions, dates, reporting limits and retained assessment labels. The main entries are [report.html](report.html), [measurement-explorer.html](measurement-explorer.html) and [NATIVE_OPENING.md](NATIVE_OPENING.md).

## Source and findings

Ten complete public fullPhysChem CSV responses contain **943 original rows** from station **21NC03WQ-H3200000**, spanning 24 dates in 2011–2012. The query selects arsenic, beryllium, cadmium, copper, cyanide, lead, mercury, nickel, zinc and field parameters; the field response contains turbidity. Every original 181-column response remains in `original/`. It retains all rows returned for each request, including quality control and both total/dissolved fractions.

The activity roles are 564 routine environmental rows, 336 equipment blanks, 24 field blanks and 19 field replicates. All 915 nondetects keep their original PQLs. Twenty-seven rows have reported numerical values. One turbidity row is Not Reported under Z2; no numerical value or limit is assigned. Analytical-method IDs are blank throughout the captured source.

Three findings are immediately useful:

1. All twelve routine cyanide records have a PQL of 0.02 mg/L (20 µg/L), four times the 5 µg/L value in the explicitly referenced 2022 methodology. This identifies a laboratory-sensitivity question when preparing a new scope. The assessment's literal 5 mg/L label is retained separately.
2. All 72 routine cadmium results have a PQL of 1 µg/L, above the historical 0.4 µg/L label. Forty-eight dissolved and 24 total records remain separate; both cover the same 24 dates. Current dissolved-metal/hardness requirements must be selected for future sampling.
3. Routine mercury retains nine numerical results (1.05–3.69 ng/L) and fifteen nondetects (1 ng/L). The 1.28 ng/L Q2 record remains visibly qualified. Turbidity's fifteen routine numerical values reach 8.7 NTU; its eight nondetects and one Z2 Not Reported row stay distinct.

The 42 Big Creek assessment rows and complete original AU/classification responses are retained. The selected measurement cohort ends in 2012, while some assessment records carry Collection Year 2014. There is no original result-ID linkage from these selected measurements to those agency decisions. The report describes that provenance explicitly.

## Product integration

`nc_big_creek_sensitivity.sources.json` supplies the native Scientific Reports source `nc-big-creek-sensitivity-observed-report`. The shared maintained report receiver uses the existing Workspace, saves a native edition, copies all original companions, exports the selected editable Study and cold-reopens the received application. The complete command is in NATIVE_OPENING.md.

The offline explorer exposes the original activity-type selector, exact groups, dates, comments, qualifiers and complete selected CSV/JSON downloads. Its 36 groups have the same deterministic IDs in the companion comparison table. A lightweight generator composes these activity controls with the maintained ambient explorer; the existing ambient application source remains its original edition.

## Complete working files

- `original/`: ten complete original CSV responses, original station record, and three complete original assessment/classification documents.
- `observations.json/.csv`: all original joined scientific fields and source row selectors.
- `comparison-groups.json/.csv`: activity/fraction/method/unit/media-separated support.
- `quality-control-records.csv`: all 379 blank/replicate records.
- `reference-comparisons.json/.csv`: every historical reference, original agency row, exact unit conversion and routine result comparison.
- `plot-data.csv`, `figure-spec.json`, `figures/`: complete plotted records and three native figure specifications.
- `summary.json`, `sampling-coverage.csv`, `source-inventory.json`: actual roles, detection states and temporal support.
- `derive.mjs`, `present.mjs`, `explorer.mjs`, `source_manifest.mjs`, `reproduce.mjs`: complete deterministic source production.
- `regulatory-context.json`, `provenance.json`: distinct reference vintages and exact captured byte identities.

Run `node source/nc_big_creek_sensitivity/20261013/reproduce.mjs --check` from the complete application. All original source files are read without a network request. The current native renderer and study transfer components are supplied by the actual receiving application.

Current owner brief: `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`. This source complements the ongoing native modeled case and its usable, editable product.
