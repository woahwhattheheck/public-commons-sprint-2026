# Original utility E. coli: temporal support, censoring and same-station flow

Operation: `ECO-MICROBIAL-TEMPORAL-FLOW-20261013-ASTRA`. Source edition: 13 October 2026. Requested sample period: 1 January 2021 through 31 December 2025.

## Findings for the Ecosystem Sciences study

The complete published utility cohort contains **730 original observations at 36 stations: 729 routine samples and one field replicate**. The analysis keeps the original station, activity, date, analytical method, detection condition, reporting limit, result comment and original CSV row. The generated outputs support station-specific interpretation, season and calendar-year comparisons, and a reproducible hydrology join.

**Changing station coverage matters.** The number of observed stations is 18 in 2021, 15 in 2022, 14 in 2023, 16 in 2024 and 21 in 2025. Ten stations first enter this captured cohort in 2025. Eleven stations occur in every requested year, accounting for 450 routine observations. A pooled year-to-year difference would therefore combine changes in concentration with changes in which stations were sampled. Use the retained station/year rows or the repeated 11-station panel for a like-for-like temporal view; retain the unequal sample counts beside it.

**Original comments affect interpretation.** Seventy-two records explicitly contain an “Information Only” marker (including the publisher's “Infomation” spelling). Three records mention interrupted ECOL analysis after a power failure; one comment refers to BOD, a different analyte. All original values remain available, with a separate station summary excluding only the 72 information-only records. The reported 24,000 MPN per 100 mL result at Georgia Eastanollee station RV_01_14 on 24 March 2025, activity A00462846, has an information-only comment about analysis after eight hours. Display its comment alongside its value. The source's MeasureQualifierCode column is blank; examining only that field would miss this context.

**The exact same-station flow join is complete for all 16 samples at USGS-02177000 in 2022.** The original daily mean discharge series contains all 365 calendar dates. Every sampled date has an approved “A” daily value, and all seven preceding days are available for each sample. This is a station-ID and calendar-date join; the original sample clock time and time zone remain in the output.

| Flow comparison | Fourteen numerical samples | All 16 samples, conservative censoring ranks | All 16 samples, strict below-20 ranks |
|---|---:|---:|---:|
| Sample-day daily mean | Spearman 0.6057 | 0.2489 to 0.5107 | 0.2489 to 0.4963 |
| Mean of seven complete preceding days | Spearman -0.1938 | -0.3932 to -0.1690 | -0.3932 to -0.1811 |

Two observations are reported as not detected with a limit of 20 MPN per 100 mL. The rank ranges enumerate their permissible ordering relative to measured values, including ties, using either conservative closed [0,20] or strict [0,20) bounds. They describe censoring sensitivity. They are not sampling confidence intervals. The positive same-day and negative antecedent associations show that the hydrologic time window changes this small-sample description.

**High-flow conditions are poorly represented in the microbial samples.** The full original 2022 daily-flow series has a median of 495 ft³/s, mean of 635.05 ft³/s, range of 192–6,990 ft³/s and a linearly interpolated 95th percentile of 1,284 ft³/s. None of the 16 sample dates reaches that 95th-percentile value. Samples occur in March, May, June, July, August and November; the annual maximum is on 4 February. These observed sampling gaps belong beside the correlation result.

## Analysis method

### Selection and original identity

The source cohort comes from the original Water Quality Portal responses in the adjacent `ecoli_utility_context/20261013` edition. ARJWS membership uses unchanged WGS84 station coordinates inside four original WBD HUC12 polygons. PRWD membership uses original publisher HUC8 03060102, corresponding to the retained 32-HUC upstream selection. The exact selection and publisher URLs are retained in `source-manifest.json`.

Only `Sample-Routine` enters routine summaries. The original field replicate is retained separately. No duplicate station/date routine observations or within-station analytical-method switches occur in this captured cohort. Aggregation nevertheless keeps station, method context, analytical method and common physical unit as separate keys.

The routine source status counts are 553 numerical results, 6 above-limit results, 67 below-limit results, 102 non-detects and one not-reported result. An original numerical result remains numerical even if a different source reporting-limit field is larger than its value.

### Censored observations

A numerical observation has interval [value,value]. A below-limit or not-detected result with an interpretable original limit has conservative interval [0,limit]. An above-limit result has [limit,infinity]. The median lower bound is the median of lower endpoints and the upper bound is the median of upper endpoints. Unreported results and uninterpretable intervals are counted separately. This retains censoring without replacing observations by half a limit or zero.

The station outputs also keep numerical-result-only medians, minima and maxima. Overall and utility-wide outputs report sampling support rather than a concentration pooled across different stations and analytical methods. Original unit spellings are retained; MPN/100mL and MPN/100 ml express the common MPN per 100 mL quantity.

Calendar-year groups follow original dates. Seasonal groups are DJF, MAM, JJA and SON pooled across the requested five-year period; monthly groups similarly pool the same calendar month. These are descriptive summaries of observed dates, with counts and first/last dates in every row.

### Same-station discharge

The original USGS WaterML series is `USGS:02177000:00060:00003`: discharge, daily mean, ft³/s. The source request covers 2022–2023; this analysis retains the complete 2022 series for the 16 available microbial sample dates. Same-day flow is a calendar-date daily mean. The antecedent seven-day mean excludes the sample day. Sample time, time zone, daily qualifiers and original source datetime remain available.

Spearman correlation uses average ranks for ties. For the two non-detects, each interval between measured values receives two distinct representatives, admitting either ordering or a tie between the unknown values. Endpoints are included for the conservative calculation and 20 is excluded for the strict calculation. The module evaluates 256 closed-bound assignments and 225 strict-bound assignments. No instantaneous microbial load is computed from a daily mean and a grab concentration.

## Files and use

| File | Contents |
|---|---|
| `analysis.mjs` | Dependency-free parsing, interval summaries, original-comment flags, sampling coverage and same-station flow analysis |
| `reproduce.mjs` | CLI using the exact retained source inputs and verifying every output against the source manifest |
| `source-manifest.json` | Original source URLs, commit/blob identifiers, SHA-256 and byte lengths, output hashes |
| `analysis-summary.json` | Compact selection, support, methods, annual coverage and flow findings |
| `station-summary.csv` | 36 station/method summaries |
| `station-year-summary.csv` | 84 station/year summaries |
| `station-season-summary.csv` | 136 station/season summaries |
| `station-month-summary.csv` | 357 station/month summaries |
| `record-intervals.csv` | All 730 original observations with interpreted bounds, flags and original row references |
| `comment-sensitivity.csv` | 36 station summaries excluding explicit information-only records |
| `flagged-source-comments.csv` | All 76 records with the explicit comment markers, original text retained |
| `field-replicates.csv` | The original field replicate |
| `annual-sampling-coverage.csv` | Five calendar years, observed/new station counts and repeated-panel counts |
| `flow-daily-2022.csv` | All 365 original 2022 daily means and qualifiers |
| `flow-sample-join.csv` | All 16 exact sample-date joins and antecedent means |

CSV arrays are encoded as JSON inside quoted cells. Empty cells represent null or undefined; `upper_unbounded=true` explicitly identifies an infinite upper endpoint.

From this directory, on a Node.js runtime:

```sh
node reproduce.mjs --output ./reproduced
```

Optional `--source` points to the complete original microbial CSV directory and `--flow` to the exact original WaterML JSON. The CLI hashes each original before analyzing it and checks all 12 generated output hashes before writing. It uses only built-in Node.js modules. The pure analysis functions can also be imported directly by a source/UI consumer.

## Verification and integration

The complete 730-record computation and all 365 flow dates were executed in the available JavaScript runtime. An independent agent reproduced the status counts, station summaries, source comment findings, exact station join and both censoring-rank endpoints from the retained originals. The CLI is supplied for direct reproduction on a Node.js host; it was not executed as a separate Node process in this session.

Integrate `station-summary.csv`, the temporal summaries and `flow-sample-join.csv` with the existing microbial Station study desk. Preserve `source_file`, `source_row`, `activity_id`, method, detection status, source comment and sample time in inspect/export. Put the coverage counts beside temporal comparisons and show the information-only sensitivity as an explicit alternative view.

## Sources

- [Complete microbial source edition](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/817335bc6d2a9130e203a48e63ecab91e0094003/opportunities/upstate_forever_2026/source/ecoli_utility_context/20261013).
- [Complete original same-station USGS response](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/904ac1340507365a897ca846e7cfab3577898507/opportunities/upstate_forever_2026/observations/observed_hydrology_20261013/original/daily/usgs_02177000_2022_2023.json).
- [Publisher's daily mean discharge query](https://waterservices.usgs.gov/nwis/dv/?format=json&sites=02177000&startDT=2022-01-01&endDT=2023-12-31&parameterCd=00060&statCd=00003&siteStatus=all).
- All original Water Quality Portal request URLs and the original WBD selection are listed in `source-manifest.json`.
