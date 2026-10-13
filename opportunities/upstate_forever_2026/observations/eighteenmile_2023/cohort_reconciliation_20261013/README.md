# Eighteenmile 2023 chlorophyll cohort reconciliation

The original measured cohort contains 75 chlorophyll records: one observation on each of fifteen study dates at all five stations. Its means, sample standard deviations, minima and maxima reproduce the values printed in Table 7 of the [original state report](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf). The printed n fields for SV-374 and SV-840 remain 4 in the publisher transcription; the independently reconstructed observation cohort has n=15 at each site.

## Original records and selection

The maintained original WQP companion in ../wqp_20261013 supplies all 88 original lake-site results and the 42 original SV-268/SV-374 chlorophyll results. Its public source commit is 8b6ddb0a0422647aebfe3e1729a66090862a7625. Fresh public service requests matched its two-station CSV byte for byte and all 45 three-lake chlorophyll records field for field.

The three lake stations supply the same fifteen chlorophyll dates. Selecting those dates at SV-268 and SV-374 gives 32 candidates because each has one additional same-date routine visit. Both competing chlorophyll records have ProjectIdentifier=CHLA. ProjectIdentifier alone therefore cannot select the study sample.

The two original all-characteristic day responses in raw/ show the separate SWS-2023 routine activity at the same displayed local clock time as each extra sample:

| Station/date | Retained study candidate | Separate routine chlorophyll | Independent routine activity |
| --- | --- | --- | --- |
| SV-268 / 2023-07-11 | 09:50, 15.76 ug/L | 13:08, 22.77 ug/L | 21SC60WQ_WQX-AF05218 |
| SV-374 / 2023-08-08 | 10:54, 10.91 ug/L | 10:59, 8.64 ug/L | 21SC60WQ_WQX-AF06949 |

Chlorophyll records label their time zone EST while SWS-2023 routine records label it EDT. Both original labels are retained. This association uses the publisher-displayed local date and clock time, with the original project identities and reproduced summaries; it does not assert equal UTC instants. The routine identities come from the original day responses; the assignment of the other same-date observation to the study is the reconciliation inference. Its resulting fifteen-date cohort reproduces all five published mean/SD/range summaries. Every original candidate remains in its original source file, and cohort_reconciliation.json records the exact included/excluded activity references.

## Reproduced concentrations

| Station | Cohort n | Mean, ug/L | Sample SD, ug/L | Minimum | Maximum | Printed Table 7 n |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SV-268 | 15 | 7.406667 | 8.036293 | 1.19 | 28.59 | 15 |
| SV-838 | 15 | 24.097333 | 8.583679 | 12.35 | 38.88 | 15 |
| SV-839 | 15 | 15.415333 | 7.429485 | 7.52 | 31.25 | 15 |
| SV-374 | 15 | 10.675333 | 4.264116 | 5.59 | 18.72 | 4 |
| SV-840 | 15 | 6.065333 | 1.751321 | 3.36 | 8.55 | 4 |

The primary WQP characteristic is “Chlorophyll a, corrected for pheophytin,” fraction Total, method USEPA 445.0. The source's exact characteristic name and method remain in all selected rows. These are measured concentrations in ug/L. Use the distinct measured catchment load sources for annual nitrogen, phosphorus and sediment comparisons.

## Use and reproduce

study_chlorophyll_cohort.csv preserves all original columns and string values for the selected 75 records. cohort_summary.csv contains the calculated summaries and the separate publisher n fields. source-inputs.json records each original public URL, exact byte length and SHA256.

From the existing application directory:

~~~sh
node observations/eighteenmile_2023/cohort_reconciliation_20261013/reconcile_cli.mjs .
~~~

The standard-library driver verifies the retained original input bytes and regenerates the three derived files. The same pure reconciliation function supplied here was executed on the complete retained source records to produce this edition.

The root manifest eighteenmile_chlorophyll_reconciled.sources.json imports the cohort, summaries and the two original day responses through the existing Workspace source importer, with the original CSVs, source metadata and reproducer retained as companions. Keep this cohort beside the publisher's seasonal_summaries.csv so the original printed sample counts and the measured cohort counts remain visible with their own source basis.
