# SV-833: Three and Twenty Creek original water-quality study

Open **sv833-water-quality-study.html** for the complete offline report. The HTML embeds both exact SVG figures and links to the original source files, tables, manifest, and reproducible code. The station is 21SC60WQ_WQX-SV-833, Three and Twenty Creek at Highway 88, Anderson County, South Carolina. WGS84 coordinates are 34.704792, -82.636966; the retained published assessment identifies HUC12 030601010701.

## Original source scope

The agency request window is January 1, 2021 through October 13, 2026. Actual latest physical/microbial sampling is June 24, 2026. Nutrient coverage ends April 1, 2026. Eleven retained inputs are identified in input-manifest.json:

- Three legacy WQP narrowResult CSV responses: Physical 342 rows, Nutrient 208 rows, Microbiological 60 rows. These are the analytical result records, carrying 610 unique original ResultIdentifiers. Characteristic groups are disjoint while station/date ranges overlap.
- Three default-profile result responses containing the corresponding 610 original result rows, retained for cross-profile reconciliation.
- Original Activity export: 56 records. Original ResultDetectionQuantitationLimit export: 606 records.
- Original physical period-of-record summary for independent annual result-count reconciliation.
- Unchanged shared 47-station Seneca nutrient catalogue containing SV-833.
- Verbatim retained 303(d)/TMDL record extract with exact upstream source-bank hashes, file hashes, record pointers, source page/line references, and publisher URLs.

The source page is https://app.notion.com/p/3f8dd77231008194832bda8cdd7b6c84. Original CSV bodies are retained byte-for-byte. The assessment file is an extract from the retained full bank identified inside it. Every source path is relative to the application root.

## Run the complete study

Requires Node.js 18 or newer; there are no third-party dependencies.

```sh
node observations/sv833_2021_2026/build_study.mjs --output /absolute/path/to/new-sv833-family
```

Run from the application root, or pass the full script path. The script locates originals relative to itself, verifies all eleven SHA-256/byte pairs, regenerates all 19 outputs, and copies every input, module, guide, and app-root native manifest into a **new** destination directory with the original application-relative layout. Existing destination directories are rejected. Open observations/sv833_2021_2026/sv833-water-quality-study.html inside that destination.

## Analytical decisions

ResultIdentifier joins the narrow profiles to exact original detection/quantitation limits. ActivityIdentifier joins date, clock, time zone, project, and station metadata. All 610 narrow result rows also match their default-profile counterparts on original identity and reporting fields. The four result IDs without limit rows are exact numeric DO, pH, temperature, and conductivity measurements on March 26, 2024; every censored record has its exact original limit.

Repeated rows on January-April 2026 have distinct original ResultIdentifiers. Thirty-four groups agree on interval, unit, speciation, fraction, method, source clock, and status. They contribute one measurement per activity/characteristic while all IDs and original row selectors remain retained. The result is 576 activity-characteristic measurements across 56 sampling activities and 56 dates. Raw-row weighting effects are exported explicitly.

Below-limit concentrations use [0,L), where zero is the nonnegative concentration support convention and L is the original lower quantitation limit. Above-limit concentrations use (L,+infinity). Numeric results are singletons. Null upper endpoints in JSON, or blank upper endpoints in CSV, mean positive infinity for an existing measurement. Missing analytes have no original result IDs. Mean and median bounds retain open endpoints. No limit fraction is substituted.

Reconstructed total nitrogen is the sum of unfiltered as-N Kjeldahl nitrogen and nitrate + nitrite from the same activity. Ammonia as NH3 remains separate. The original agency Calculated Nitrogen result is retained separately from the reconstructed sum. Original TKN 11 mg/L on March 13, 2025 remains unchanged. Full-cohort and 2025-only influence comparisons show the effect of that event.

Original pH 724 on November 29, 2023 is retained unchanged, flagged outside the explicit study screen [0,14], and excluded only from pH descriptive statistics. Its activity and other analytes remain eligible. Publisher-provided clock and timezone strings stay unchanged, including winter EDT labels.

Exact-pair Spearman correlations use average ranks for ties and count all censored exclusions. Additional interval-order calculations retain all censored activities. For every unordered pair of activities, strict supported concordance scores +1, discordance -1, ties zero, and unresolved ordering receives conservative [-1,+1] support. The denominator is n*(n-1)/2 as in Kendall tau-a. Joint compatibility can tighten these conservative score bounds; they are descriptive support bounds, not confidence intervals. Every pair classification is exported.

Annual and seasonal statistics describe sampled activities, with actual sample counts. Calendar seasons use DJF/MAM/JJA/SON. The 2026 cohort is partial January-June. The published 2024 303(d) assessment period is 2018-2022; retained 2026-07-28 TMDL status has its own vintage. The 2021-2026 monitoring record partly overlaps that earlier assessment window.

## Outputs

| Output | Purpose |
| --- | --- |
| original-result-index.csv | All 610 IDs, reported values, exact limit joins, source row selectors and hashes |
| activity-characteristic-measurements.csv | 576 grouped measurements preserving every underlying original ID |
| activity-water-quality.csv | All 56 original sampling activities, measurement support, components and IDs |
| repeated-original-results.csv | All 34 agreeing repeated groups and their original result selectors |
| annual-seasonal-summaries.csv | Full, year, season, and assessment-overlap sampled-activity statistics |
| sampling-coverage.csv | Six annual activity/month/characteristic denominators |
| exact-pair-associations.csv | Six exact-pair Spearman calculations with exclusions and selected IDs |
| interval-order-associations.csv | Turbidity/E. coli and turbidity/phosphorus conservative tau-a bounds |
| interval-order-pairs.csv | All 2,811 original activity-pair classifications |
| original-row-weighting-effects.csv | Raw-row versus activity-weighted effects from repeated results |
| single-observation-influence.csv | Largest finite upper-endpoint event influence by eligible analyte |
| quality-screening.csv | Original reported pH anomaly and explicit treatment |
| agency-nitrogen-reconciliation.csv | Agency Calculated Nitrogen beside reconstructed same-activity sum |
| physical-source-count-reconciliation.csv | Original period-of-record counts versus captured result counts |
| highest-turbidity-activities.csv | Ten highest original turbidity activities with all same-activity measurements |
| study-summary.json | Counts, method decisions, source context, summaries, and 2025 nitrogen influence |
| sv833-observation-timeline.svg | Actual concentration timeline with censored support |
| sv833-activity-associations.svg | Three same-activity association plots |
| sv833-water-quality-study.html | Complete offline scientific report, inline figures, linked original inputs |

The app-root sv833_water_quality.sources.json registers six report/data/figure entries with the complete hash-verified companion family. Source-row numbers are one-based data rows excluding the CSV header. Source-backed interpretation and future hydrologic work should preserve the distinct SV-833 catchment and each actual observation's identity.
