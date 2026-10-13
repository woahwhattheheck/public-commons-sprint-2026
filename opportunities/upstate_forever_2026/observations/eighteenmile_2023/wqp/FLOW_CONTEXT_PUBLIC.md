# Original lake-study dates in the observed Eighteenmile hydrograph

This companion joins the actual agency laboratory dates to USGS Eighteenmile gauge 02186702, keeping original daily means, source record links, annual flow position and the preceding three and seven calendar days.

## Actual recovered dates

The three complete original Water Quality Portal files for SV-838, SV-839 and SV-840 contain 88 laboratory records: 45 CHLA results and 43 SCDHEC-MICRO results. Each site has fifteen chlorophyll activities at the same fifteen dates between April 5 and October 17, 2023. Microcystin activities have a different date pattern, including August 24. All sixteen distinct original dates are retained in study_flow_dates.csv, with separate station lists for each project.

The special chlorophyll dates have mean same-day upstream flow 49.113333 cfs, median 43.7 cfs and range 21.1–96.2 cfs. The complete 196-day study-window mean is 63.523980 cfs; the complete 2023 annual mean is 68.420548 cfs. All fifteen chlorophyll dates fall below the annual daily-flow 95th percentile of 134.8 cfs.

Four of those dates follow a daily mean at or above that annual threshold within the preceding seven calendar days:

| Study date | Same-day mean, cfs | Prior seven-day maximum, cfs | Date of maximum |
| --- | ---: | ---: | --- |
| 2023-05-02 | 96.2 | 687 | 2023-04-28 |
| 2023-06-14 | 83 | 604 | 2023-06-12 |
| 2023-06-27 | 66.5 | 142 | 2023-06-21 |
| 2023-08-08 | 43.2 | 155 | 2023-08-03 |

For June 14, the previous three-day mean is 257.833333 cfs, while the sample-date daily mean is 83 cfs. These measured antecedent conditions support interpretation of the laboratory dates after elevated flows. Each lake sampling station retains its own physical location, depth, collection time, and reported time zone in the original source and the study's measurement tables.

## Reproduce and import

From this companion directory:

```sh
node reproduce_study_flow.mjs --output-dir /absolute/path/to/rebuilt-study-flow
```

The program verifies the original three laboratory CSVs and the included 2023 USGS daily-mean response, reads their original reporting dates, then rebuilds the sixteen-date CSV. Its result must exactly match the retained CSV hash. flow_context.mjs is the unchanged source-owner calculation core. The original complete multigauge-table option remains available through --flow-csv DAILY_FLOW_CSV; its original hash is retained in flow_context_methods.public.json.

flow-context-public-sources.json is an ordinary upstate.sources/v1 table manifest. The existing Measurements desk can join study_flow_dates.csv to every actual laboratory activity by its original reporting date. It keeps CHLA and SCDHEC-MICRO activities distinct. Three-day and seven-day windows exclude the sample date; their valid and expected counts and every original USGS record index are retained.

The source laboratory CSVs are unchanged copies of the existing study source bank and install at its existing originals/SV-838-2023.csv, originals/SV-839-2023.csv and originals/SV-840-2023.csv paths. The upstream flow is the original USGS daily-mean response included at originals/usgs_02186702_2023_2023.json. Its 365 source values reproduce the same dated context as the original complete multigauge table.

The source window uses original reporting calendar dates. Agency timezone strings remain as reported in the original laboratory records. The flow context describes the upstream gauge; the lake measurements keep their original station identities.

Exact source URLs, bytes, SHA256s, dates and methods are in flow_context_methods.public.json. The source body hashes and exact public WQP/USGS query URLs identify the retained editions. This public companion omits internal transport/page metadata; original government responses, the calculation core, and the full dated output are unchanged.

## Native study import and source inspection

The installed Published studies desk traverses this exact manifest with the
other original study manifests. Built-in import retains the complete flow table,
methods, calculation source and original responses. The table keeps native
source ID `eighteenmile-study-dates-observed-flow-2023` and its original USGS URI.
An existing retained study stays immutable; import the installed study again to
create the complete source edition, then open that new edition in Measurements.

The existing dated view joins the selected laboratory reporting dates and exports
`upstream-flow-selected.csv` with each original gauge/source-record reference.
The full study ZIP retains every source companion for reopening. Laboratory
activity and project IDs remain distinct; the upstream gauge does not change a
lake sample into a gauge measurement. Same-date discharge and preceding three-
and seven-day discharge summaries are hydrological context in ft³/s. Annual
model export retains its separate kg/year or metric-tonnes/year support.

This is an additive public reproduction companion. It leaves the complete
source owner's existing `model-sources.json`, `flow-context-sources.json`,
`flow_context_methods.json`, `build_flow_context.mjs` and original guide intact.
That complete source edition already includes the flow entry through its top
manifest. Public metadata and reproduction scripts use distinct filenames, so
existing source hashes remain valid. When both method documents are retained,
the consumer continues to display the original method document.
