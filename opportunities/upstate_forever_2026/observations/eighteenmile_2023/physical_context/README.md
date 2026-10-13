# Eighteenmile 2023 physical water-quality context

This complete study reads five unchanged South Carolina Water Quality Portal result CSVs and the unchanged USGS 02186702 daily-mean discharge response for 2023. It delivers an offline HTML report, two SVG figures, ten CSV tables, a machine-readable summary, rebuild code, and an application-native source manifest.

## Main findings

- 832 original result rows support 521 selected physical/nutrient rows and 51 physical activities. The study separates 49 routine SWS-2023 activities from two PFAS activities.
- Twelve SV-268/SV-376 shared dates show SV-376 cooler on all 12 dates, dissolved oxygen higher on 11, turbidity higher on 11, and E. coli higher on 9. SV-376 was sampled 129–235 minutes earlier on every date.
- Phosphorus is lower at SV-376 on 10 of 12 dates, but the full mean difference SV-376 minus SV-268 is [0.00525,0.01025) mg/L. The median is [−0.042,−0.036] mg/L.
- June 12 contributes +0.58 mg/L phosphorus and +580 NTU turbidity. Excluding this date only as a sensitivity calculation changes the phosphorus mean difference to [−0.047,−0.041545454545)mg/L across the other 11 dates.
- The June 12 reference gauge daily mean is 604 ft³/s with approved qualifier A and annual empirical percentile 99.315068493151.
- Four upper-censored E. coli results retain their true reporting intervals. The main paired E. coli mean has an unbounded upper endpoint, while its median is exactly 523.75 MPN/100mL.
- Within-activity temperature/oxygen Spearman coefficients at the four repeatedly sampled stations are −0.559440559441 to −0.961278120390. Each coefficient uses original matching activity IDs and average ranks for ties.
- All 51 activities have exact same-date original daily gauge records with qualifier A. Gauge discharge is daily basin context for the field records.

## Rebuild

Use Node.js 18 or later. From the application root:

```bash
node observations/eighteenmile_2023/physical_context/build_study.mjs --output /owned/new-physical-study
```

The destination must not exist. The command reads the six application-relative paths in input-manifest.json, checks exact byte lengths and SHA-256 values, executes the analysis, and writes all 14 outputs. It also copies every original, rebuild module, this README, the input manifest, and the application-root native manifest into the same application-relative layout in the new destination. No external package is required.

Open:
`/owned/new-physical-study/observations/eighteenmile_2023/physical_context/physical-water-quality-study.html`

The HTML embeds both SVG figures, so figures remain visible when the application uses a sandboxed document viewer. Separate SVG downloads are included for reuse.

## Original source closure

Five originals are shared with the existing 2023 published-observation family:
`observations/eighteenmile_2023/wqp/originals/SV-{245,268,374,375,376}-2023.csv`.

The daily source is shared with the merged six-year nutrient study, PR #3163:
`observations/eighteenmile_stream_nutrients_2020_2025/analysis/original/daily/usgs_02186702_2023_2023.json`.

The complete physical study source bank carries these unchanged originals together with every derived report, figure, table, and rebuild file. This permits offline reproduction without retrieving another family.

## Observation rules

The analysis parses the original CSV fields directly. It selects temperature, dissolved oxygen, turbidity, biochemical oxygen demand, E. coli, total suspended solids, measured depth, Secchi depth, TKN, nitrate/nitrite, phosphorus, ammonia, and total alkalinity. Reconstruction adds total nitrogen only when TKN and nitrate/nitrite share the exact original activity.

Every original selected row retains its agency URI, original file path, SHA-256, and 1-based data-row number excluding the header. Source record IDs are `SHA256:row`. Activity joins require matching station, calendar date, clock, timezone, and project within the exact ActivityIdentifier. Duplicate activity/analyte values cause an error.

Forty-nine SWS-2023 activities supply station, seasonal, correlation, and paired summaries. The two PFAS records share station/date/time but have separate activity identifiers, so their temperature and oxygen are not joined. Their original values remain in the 51-row activity export.

The 21 Depth characteristic values are all 0.3 m. They remain measured characteristics; original activity-depth/result-depth fields remain blank. No physical activity shares the ActivityIdentifier of a chlorophyll-a result. Shared dates or similar clocks do not manufacture a same-activity chlorophyll cohort.

## Reporting intervals

- Exact reported values are closed point intervals.
- Present Below Quantification Limit with blank result and a Lower Quantitation Limit is [0,limit).
- Present Above Quantification Limit with blank result and an Upper Quantitation Limit is (limit,+Infinity).
- Numeric reported values remain numeric, including numeric values whose original condition says Present Above Quantification Limit.
- Units use original result units for numerical values and original limit units for censored values. Original conditions, result/limit units, method identifiers, fractions, and value types remain in physical-result-index.csv.

For an existing interval, null lower means negative infinity and null upper means positive infinity. CSV serializes null as a blank field. In the activity-wide table, absent analytes have blank record IDs as well as blank bound fields; an above-censored measurement has a nonblank record ID, explicit censoring value "above", a finite lower endpoint, and a blank unbounded upper endpoint.

Interval means average the endpoint bounds. Median bounds use the corresponding endpoint order statistics; infinite endpoints remain ordered at the appropriate tail, allowing finite medians even when the mean is unbounded. Endpoint openness follows the contributing observations, including tied endpoint ordering. Original reporting uncertainty is preserved; these bounds are not sampling-confidence intervals.

For each date and routine station pair A/B, the difference is B−A:
lower=B.lower−A.upper; upper=B.upper−A.lower.
A positive lower endpoint, including an open zero endpoint, establishes B higher. A negative upper endpoint, including an open zero endpoint, establishes B lower. Remaining intervals spanning zero are unresolved. Exact zero is equal.

Total nitrogen uses same-activity unfiltered TKN(method 10-107-06-2-E) plus nitrate/nitrite(method 10-107-04-1-C). These methods and fractions are checked. All interval arithmetic is rounded to 12 decimal places in exports.

## Time, flow, and association interpretation

Original timezone labels are preserved exactly, including EDT labels reported on winter observations. No timezone normalization is invented. The clock separation is computed only when the original labels agree. SV-376 is sampled earlier than SV-268 on all 12 shared dates; sampling-time and site differences are confounded.

The USGS source must be station 02186702, parameter 00060, statistic 00003. All 365 original 2023 daily records are retained with source array selectors. The annual percentile is 100 ×(number below +0.5×number equal)/365. Flow is matched by original observation calendar date. It is a daily reference-gauge measurement, not site-specific instantaneous discharge.

Spearman correlations use average ranks for ties within each routine station and only exact numerical pairs. Available pairs and excluded censored pairs are explicit. Fewer than 3 exact pairs produce a blank coefficient. Associations are descriptive; there are no significance tests or source-attribution claims.

Single-observation influence is calculated for paired characteristic cohorts with at least 10 observations and finite bounds. It selects the observation with the largest absolute interval endpoint, breaking ties by date. The table presents the full mean and median first, then the mean after removing that single observation. It does not discard that observation from the principal data, report, or conclusions.

## Outputs

- physical-result-index.csv: 521 original selected records.
- activity-physical-context.csv: 51 activity records with all selected measurements and original daily flow.
- paired-activity-dates.csv: 16 original station/date pairs.
- paired-characteristic-contrasts.csv: 180 characteristic differences, including 84 physical contrasts.
- paired-cohort-summaries.csv: 44 paired characteristic summaries.
- station-season-summaries.csv: 276 routine station/season characteristic summaries.
- within-station-associations.csv: 30 coefficient and coverage summaries.
- single-observation-influence.csv: 10 finite-bound cohort comparisons.
- june-12-original-activity-context.csv: 2 original June 12 activities.
- daily-gauge-flow-2023.csv: 365 original daily values and annual midranks.
- study-summary.json:complete counts, method conventions, source inventory, and summaries.
- temperature-oxygen.svg: 47 matching activities from four repeatedly sampled stations; SV-245 singleton remains in the data.
- paired-physical-contrasts.svg: 12 exact original paired dates.
- physical-water-quality-study.html:complete offline report with figures and station detail tables.

## Primary method references

- USGS, Dissolved Oxygen and Water: https://www.usgs.gov/water-science-school/science/dissolved-oxygen-and-water
- USGS, Biochemical Oxygen Demand and Water: https://www.usgs.gov/water-science-school/science/biochemical-oxygen-demand-bod-and-water
- USGS, Diurnal Variations in Water Quality: https://www.usgs.gov/centers/new-jersey-water-science-center/science/diurnal-variations-water-quality-surface-water
- EPA, WQX Web User Guide 3.0.1: https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P101G8UE.txt

Compiled 2026-10-13 from retained original agency responses.
