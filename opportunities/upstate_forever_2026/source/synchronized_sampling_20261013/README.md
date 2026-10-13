# Upper Savannah same-day sampling support

Complete source-bound analysis and offline review of the original 729 routine E. coli activities at 36 stations, 2021–2025. This arm complements the original monthly atlas and does not change monitoring plans or source observations.

## Open the delivered product

Extract the complete delivery ZIP and open `index.html` in a modern browser. It needs no network, install, or external scripts. A browser that restricts local-file navigation can use an ordinary local static server from the extracted directory: `python -m http.server 8000 --bind 127.0.0.1`, then open `http://127.0.0.1:8000/`. No remote service is involved. `report.html` is the complete readable report. All 630 station pairs, including zero-support pairs, remain in `data/pair-support.csv`; every matched contrast is in `data/paired-contrasts.csv`; every pair/year/method cell is in `data/pair-year-method-support.csv`.

The initial view shows pairs sharing at least one date. Set “Min. shared dates” to zero to retain all original pairs. Method, inclusive year range, original collection-time separation, station search and repeat-support controls recompute the pair review. Full filtered exports include every row, not merely the visible page. Sampling-days view preserves full original date/method event membership; pair minimum and gap filters do not redefine those events.

Select a pair to inspect every retained contrast. “Both source records” opens both complete original CSV records, with activities, original limits, censoring status, timestamp and source-row identity. The displayed difference is B minus A in the retained normalized unit, with station IDs ordered lexically. The map is a sampling-support graph on original station coordinates, not a river-network map.

A working note, filters and selected pair can be saved as a source-bound review JSON. Reopening a foreign or malformed review preserves the current draft. Local browser storage is a convenience; exported JSON is the portable saved review.

## Rebuild from the complete original calendar

Python 3.10 or newer, standard library only:

```sh
python cosample.py --calendar /path/to/regional-calendar-study --output /path/to/new/same-day-edition
```

The `--calendar` directory is the `study` member of the complete `Upper_Savannah_Regional_Monitoring_Complete_v1.1_20261013.zip`. It contains the complete `observed-report.json`, `data/original-routine-observations.csv`, `data/station-support.csv`, original 730-row interval table and publisher source register. Preserve this directory unchanged. The compiler writes a new edition and rejects nonempty output directories, unknown project/cohort identities, changed original cells, ambiguous repeated station/date/method/unit activities and invalid intervals.

The complete four-file implementation (`cosample.py`, `review.html`, `receive_report.py`, `README.md`) is retained inside each delivery. Inputs are copied byte-for-byte. `data/input-manifest.json` names their original paths, sizes and SHA-256 values. `manifest.json` lists the generated deliverable bodies. No observations are acquired or simulated by this compiler.

## Scientific interpretation

Matching requires the same original local date, exact analytical method context/identifier and normalized unit. Same-day does not mean simultaneous, equal flow, equal weather or matched hydrologic exposure. EDT and EST are interpreted from each original record as UTC-4 and UTC-5 respectively. Missing or invalid original times are unavailable, never zero. Maximum-gap filtering excludes unavailable times.

Original concentrations remain intervals. For A=[aL,aU] and B=[bL,bU], the conservative difference enclosure is [bL-aU,bU-aL]. Unbounded upper limits remain unbounded. Missing/not-reported bounds are unavailable. Strictly positive lower difference means “B higher”; strictly negative upper difference means “B lower”; overlapping or zero-touching enclosures remain unresolved. Equal exact reported points are separately identified. Detection limits are not substituted with half-limit estimates, and censoring directions are not statistical significance claims.

There is one activity per station/date/method/unit in this original cohort. The compiler deliberately rejects ambiguous repeats rather than choosing one or introducing an unreviewed weighting rule. Station pairs are not independent observations, since dates and stations recur. Annual support and raw contrasts stay method-specific. Counts across all methods describe sampling support, not a pooled concentration trend.

The original 730-record ledger and the excluded field replicate travel with the 729-routine cohort. Zero-support pairs describe absent joint support in this selected source, not a declaration that no programme ever samples them. Complete original publisher references are in `inputs/publisher-source-register.json`. The original 217-HUC atlas remains the source geography; this study does not assign downstream causality or modify watershed boundaries.

## Native Sources and Scientific Reports

Import `same-day-report.sources.json` from the complete delivery directory through the current Sources workflow. Its single document is `upstate.observed-report/v1`, and every original/input, computed table, offline report and implementation file is a named companion. Choose `regional-same-day-sampling-20261013` in Scientific Reports. Existing report selection, saved reports and queues retain their original owners and behavior.

For an equipped command-line receiver, use the complete retained application and an owned copy of the original Workspace:

```sh
python receive_report.py --application /path/to/application \
  --workspace /path/to/original-workspace-copy \
  --package /path/to/same-day-edition --output /path/to/new/native-report
```

The same helper also opens the complete archive exported by the native Sources desk: extract that archive and use its directory as `--package`. It accepts the byte-identical native `sources.json` manifest (or its collision-safe `report-sources-*.json` name) and preserves every original companion. The outer delivery inventory is verified when present; it is not required for the native export.

This helper imports the complete ordinary source manifest, binds the original project and report schema through existing native APIs, collects sections and source files with `model.observed_context`, renders with the existing scientific renderer and reopens the registered source. It dispatches no scientific model or monitoring plan. Result and selection JSON retain the actual source collection, report source, project and native output identities. The output argument is outside application, Workspace and source package. Use a separate new directory for each report edition.

The saved delivery is ready to join the original regional scientific composer, retaining this source alongside the existing monthly calendar, scientific report and Monitoring campaign. The complete original archive remains unchanged.

## Recipient operation and inspection

Before delivering a changed edition, open the exact generated `index.html` and `report.html`, inspect readable wide and 390-pixel screens, use filters, select a pair, inspect both source records, save/download and reopen a review, and open the resulting native report. Read the complete exported CSV/JSON rows and the extracted archive contents as the recipient would. Fix clipped tables, broken links or controls at source; retain numerical/source identities. Ordinary software validation remains focused, not a broad repository test suite.
