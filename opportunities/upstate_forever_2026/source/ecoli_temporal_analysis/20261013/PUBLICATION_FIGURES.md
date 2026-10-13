# Original microbial publication figures

These figures accompany the retained 730-activity microbial study and its temporal/calendar/flow explorer. They use the existing application scientific-figure contract and ReportLab vector renderer.

## What the figures show

**Sampling coverage.** The two panels retain the five original annual routine-record counts (174, 105, 119, 144, 187), annual station counts (18, 15, 14, 16, 21), first appearance within this source edition (18, 1, 2, 5, 10), and records contributed by the same eleven stations (103, 80, 93, 92, 82). The 729 routine observations cover 36 stations. The single original field replicate stays separate. Five Georgia lake stations have only Information Only records in 2025, so excluding those comments changes the all-years panel to six SC stations.

**SV-833 calendar support.** All-date 2021/2025 sample medians are 419.6 and 387.3 MPN/100 mL (9 and 11 records). The eight shared months—January, February, April, May, July, August, November and December—give medians 298.9 and 666.8 (8 records each). Both retained interval-median endpoints coincide at these four values. The connecting lines join endpoint summaries; the original rows and exact selected memberships are in calendar-support-source-rows.csv. Matching months does not match dates, weather, flow or management.

**Same-station flow.** The three panels retain all 365 original 2022 daily means at USGS-02177000, all sixteen sample-date joins, and separate concentration-versus-same-day and concentration-versus-seven-prior-day context. Fourteen results are numeric; two original non-detects retain 0–20 MPN/100 mL censoring bounds and open limit markers. Their limits are not substituted numerical observations. None of the sixteen dates reaches the original annual P95 of 1,284 ft3/s. All sample-date discharge qualifiers are A. The prior window for 8 March contains the original A;e qualifiers on 1–4 March. The window excludes the sample day.

The 445 retained plot positions include repeated appearances of the same original observations across explanatory panels and censoring-bound endpoints. They are not a count of independent samples. The figure-point CSV keeps original source-row references, dates and activity IDs where applicable. Correlation sensitivities remain in the underlying report and full source tables. Concentration and daily flow retain their original units and temporal support.

## Reproduce

From the application root, with the existing original companions installed:

```sh
node source/ecoli_temporal_analysis/20261013/build-publication-figures.mjs
python -B source/ecoli_temporal_analysis/20261013/render-publication-figures.py --output /tmp/microbial-publication-native-figures
```

The JavaScript command reads four retained CSVs, produces the figure specification and point-membership CSV, and checks the original edition counts, censoring shape, finite coordinates and axis coverage. The same JavaScript command uses the application’s retained D3-path 3.1.0 / D3-shape 3.2.0 and shared scientific SVG renderer to produce the three report SVGs and offline gallery. The Python command uses model/scientific_figures.py and the installed ReportLab package to create a separate native rendering of three SVGs and three standalone PDFs. It also writes rendered-manifest.json and rendered-svg-bank.json with complete SVG bodies and output SHA-256 values. The application’s native report renderer consumes the same numeric panels directly for PDF output.

The source specification follows upstate.scientific-figure-spec/v1. The existing observed-report recipe selects the three figure IDs and retained SVG paths. Its root upstate.sources/v1 manifest retains each figure companion; the existing Published studies adapter binds those paths under application-context/microbial/ and preserves them through report export and portable restore.

## Source files

- annual-sampling-coverage.csv: original temporal analysis, one row per year.
- calendar-support-comparisons.csv: station/method/unit/comment/calendar comparisons; figures select SV-833, all_original and the two calendar modes.
- flow-daily-2022.csv: original USGS 00060/00003 daily series, all 365 dates and qualifiers.
- flow-sample-join.csv: exact USGS-02177000 activity/date joins and the seven complete prior days.
- calendar-support-source-rows.csv and the unchanged record-intervals.csv provide full membership and original comments alongside the plotted summaries.

The original agency response and all original microbial records remain in the existing source family. Each report edition retains its complete source descriptors and actual generated vector files.

The report’s retained SVGs are the deterministic D3 rendering. Native PDF draws the same numeric panels with ReportLab. The separate native-render output directory preserves both renderings. The shared renderer and its four pinned D3 code/license bodies are included in this report’s source-companion closure.
