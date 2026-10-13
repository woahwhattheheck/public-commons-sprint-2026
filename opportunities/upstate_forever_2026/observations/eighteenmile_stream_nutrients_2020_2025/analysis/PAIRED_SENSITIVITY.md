# Eighteenmile paired sampling sensitivity

Open paired-sensitivity.html for the complete offline companion to the original Eighteenmile nutrient-and-flow study. It carries 148 retained selections, an interactive station/analyte and scenario selector, static year and influence tables, all source-row selectors, and downloadable JSON/CSV.

## Scientific result

The unchanged source contains 116 analyte comparisons: 58 station-pair/date combinations on 36 sampling dates. Each of the six station-pair × analyte cohorts is evaluated separately. All 146 nonempty selections retain their original definite mean direction across removal of each individual paired date, each represented calendar year, year-specific cohorts and exclusion of annual upper-decile reference-flow days.

Two selections are empty: the SV-233/SV-375 cohort has 11 paired dates, all in 2024, so removing 2024 leaves no paired observations. The complete parent study spans 2020–2025; this paired subset spans 2023–2025. Original same-date sampling clocks differ by 29–204 minutes for SV-233/SV-376, 54–77 for SV-233/SV-375, and 25–49 for SV-375/SV-376.

Direction and magnitude have different sensitivities. Removing 2023-10-02 changes the SV-233→SV-376 reconstructed-N mean from (-0.295833333333, -0.245833333333) to (-0.193478260870, -0.141304347826) mg/L. Removing 2024-07-16 changes the SV-233→SV-375 mean from (0.058181818182, 0.103636363636) to (0.161, 0.211) mg/L. These two dates have low reference-flow percentiles, approximately 1.23 and 12.70 respectively. The report preserves them and exposes their effect separately from the upper-decile flow selection.

## Rebuild the complete study and companion

From the application root with Node 18 or later:

    node observations/eighteenmile_stream_nutrients_2020_2025/analysis/build_paired_sensitivity.mjs --output /owned/new-paired-study

The destination must be new and its parent must exist. The command verifies the original paired CSV, invokes the maintained original study builder, verifies the rebuilt paired CSV, and writes the companion into that complete self-contained application layout. The original builder checks all twelve retained input bodies and carries its sources, original reports, tables and rebuilding code. This companion adds its pure calculation/rendering modules, CLI, source pin, guide, three result files and the native eighteenmile_paired_sensitivity.sources.json manifest. That manifest retains the complete parent study as companions, and the rebuild refreshes its byte counts and hashes against the newly produced complete layout. Node built-ins are sufficient.

Open observations/eighteenmile_stream_nutrients_2020_2025/analysis/paired-sensitivity.html inside the new destination. Its link to nutrient-flow-study.html opens the complete original study beside it. The same relative rebuild command works from the new application root.

The pure analyzePairedSensitivity(rows, source) function accepts the original paired CSV parsed by the retained csv.mjs module. renderPairedSensitivity(result) produces the offline report without filesystem or network access.

## Retained calculation

Each interval is station B minus station A, in the original mg/L concentration units. Lower and upper endpoints are summed as exact integers at twelve decimal places; JSON retains those integer sums, their scale and the number of pairs. Endpoint openness propagates by the original censor flags. Mean display values are rounded only after division. An empty selection keeps null means and the explicit no-retained-pairs state.

All rows remain traceable to the unchanged paired-station-contrasts.csv by one-based data-row number, excluding its header. That CSV retains activity IDs, original clocks/timezones, original component interval endpoints, flow values and original flow qualifiers. Each generated selection records its included and excluded source rows. No observations are pooled across overlapping station pairs.

The flow selection keeps a recorded original annual midrank percentile below 90 at reference gauge 02186702. Missing percentiles are separately counted and excluded from this selection; the retained source has none. Gauge discharge supplies basin context. Individual station discharge, mass loads, sampling uncertainty and causal explanations require their corresponding scientific analyses.

The influence table selects the date producing the largest absolute change in either mean interval endpoint. Its selection uses the same rounded display means; exact endpoint sums accompany every case. It describes influence among observed paired dates. Stable cohort mean direction can coexist with individual contrasts in the opposite direction.

## Source and review

The source pin is paired-sensitivity-input.json. The original paired CSV is 23,431 bytes, SHA-256 1e40329d943a79c93079d970c888f59e6cfd9ed4a0512fcebdc012cc8f6116d7, from original study merge 463917ad1af43b305125279426d15353b946c0e7 (PR3163).

The pure calculation and report were executed on all 116 actual paired comparisons. A separate reviewer reconstructed all original difference endpoints and independently recomputed all 148 selections using exact thousandths arithmetic. Counts, exact scaled sums, all nonempty means, endpoint openness and directions agree. The two empty selections are retained explicitly. The embedded browser script was syntax checked, and report/source links were checked against the complete rebuilding layout.

## Related sampling coverage

The separate sampling-calendar and high-flow coverage study accompanies the same retained Eighteenmile observations: https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/9d5ccd5be6d158ffaf0e69ce0207f9a89f015c54/opportunities/upstate_forever_2026/source/eighteenmile-stream-nutrients-20261013/flow-analysis/report.html . The present companion defines its flow subset by the original annual midrank percentile below 90; its exact selection is retained in every result.
