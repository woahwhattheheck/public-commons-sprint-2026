# Eighteenmile flow volume and sampling coverage

## Scientific result

The complete approved daily-mean record at USGS 02186702 contains 365 dates in 2023.
The 19 dates at or above the annual 95th-percentile threshold (134.8 ft3/s) carried 25.3508719% of the year's observed gauge water volume. The 37 dates at or above the 90th-percentile threshold (98.94 ft3/s) carried 33.4618696%.

The 15 lake CHLA visits ran from 5 April through 17 October. All 15 visits were below the annual 90th percentile. In that 196-day study window, nine dates at or above the annual 95th percentile carried 24.0629041% of gauge water volume. Mean daily discharge on the 15 visit dates was 49.1133 ft3/s, compared with 63.5240 ft3/s across that study window.

The routine SWS-2023 nutrient cohort has 24 activities at two stations on 23 calendar dates. One date, 12 June, coincided with a high-flow day: 604 ft3/s. The corresponding routine visit was at SV-268. SV-374's 12 routine visits contained no annual 95th-percentile dates.

These results explain temporal sampling support. Lake samples describe spatial and seasonal concentration/biological response. Event-aware nutrient and suspended-sediment monitoring can add evidence during high-volume flow conditions. Quantitative constituent load calculations require compatible concentration, discharge, contributing area, and time support. A gauge reporting date is not an exact-time lake discharge measurement.

## Source and method

Nine complete retained input bodies are supplied: the 365-day USGS response, selected 75-row CHLA table, its five original WQP responses, and two original SWS nutrient responses. The rebuild checks every source byte count and SHA-256, then compares all 75 selected CHLA rows with their exact original WQP records across nine fields, including activity/station identifiers, project, date, displayed clock/timezone, characteristic, concentration and unit.

The original selected CHLA table uses 1-based data-record numbers excluding the CSV header. Routine and flow indices are 0-based. The activity output explicitly records index bases and original source hashes. Original EST/EDT labels are retained; the calendar join applies no timezone conversion.

Annual quantiles use linear interpolation at (n-1)*p (R7). Annual threshold boundaries are reused in both reporting windows; bands include their lower bound and exclude their upper bound. Discharge decimal strings are summed as safe integers before conversion. Gauge water volumes use 86, 400 nominal seconds per reporting day and 0.028316846592 cubic metres per cubic foot. Each cohort visit date counts once across stations. All 365 source daily means carry approved qualifier A.

A high-flow spell is a consecutive run of dates at or above the annual 95th percentile. The 11 spells are threshold runs; additional event separation or hydrograph assumptions are unnecessary for these tables. Spell output preserves original daily values, indices and qualifiers plus nearest preceding/following visits.

The field gauge is upstream of lake sites. Use the retained original gauge catchment to evaluate area support. The CHLA cohort has 75 observations but only 15 shared hydrologic dates. The routine cohort has 24 activities but 23 dates. Gauge water volume occurring on sampled calendar days is a calendar-coverage statistic; interpreting it as the portion of water or pollutant mass sampled would change its meaning.

## Reproduce from retained originals

Node.js 18 or later; all numerical and D3 dependencies are supplied locally. No network request or package install is required.

```sh
node observations/eighteenmile_2023/sampling_flow_coverage/rebuild.mjs --verify-only
node observations/eighteenmile_2023/sampling_flow_coverage/rebuild.mjs --out /mnt/data/eighteenmile-flow-coverage
```

The first command verifies original bytes, rejoins original CHLA rows, recalculates every output and compares the 10 generated output hashes. The second also writes them into the named directory. The native Node command is the receiving host operation; the exact calculation/core and pinned D3 figure source were already executed in V8 on 2026-10-13.

## Outputs

- derived/duration.csv: 12 flow-band rows, six each for calendar year and lake study window, with exact volume/date numerators and denominators.
- derived/sampling.csv: 8 cohort summaries, including both routine stations separately.
- derived/ranked.csv: 9 ranked high-flow-volume summaries with original selected dates.
- derived/spells.csv: 11 consecutive high-flow spells with peak dates, source rows and visit relationships.
- derived/activities.csv: 99 source-linked sampling activities with exact same-calendar-date discharge context.
- derived/daily.csv: 365 original daily means with flow bands, gauge volumes and cohort activity IDs.
- derived/results.json:complete numerical result preserving nested source records.
- derived/summary.json:annual result, source methods and both study-cohort contexts.
- flow_volume_and_sampling.svg:two-panel scientific export made with pinned D3.
- figure-spec.json:the same 36 plotted values and supporting denominators in the maintained native scientific-report schema.

Nested CSV values are JSON inside properly quoted CSV cells, preserving each source record and original index. Source URLs, body hashes and index conventions are in source-index.json. model-sources.json is an ordinary upstate.sources/v1 manifest; register it through the existing source-import workflow and keep its companions with the source family. The SVG's native_report_spec metadata points to figure-spec.json. Current model/scientific_figures.py can render the figure in the maintained report.

## Integration

Install this entire directory as an additive source component. Import model-sources.json through the existing workspace source importer; it carries six table entries, the complete result document and the scientific figure documents, each with full source/rebuild companions. Add the manifest to the maintained report intake and source catalogue. Existing regional/gauge and Eighteenmile scientific manifests retain their separate identities.

Use the current application selected-source catalogue and complete observed_context/scientific_figures/PublishedStudies family. The preserved study package and current receiving intake are linked on the Eighteenmile scientific study Page.
