# North Carolina ambient monitoring evidence

## Scientific purpose

This edition turns the original Horsepasture monitoring exports into a reusable measured source for the existing scientific Workspace. It contains 1,957 results from 28 January 2008 through 3 December 2025, the corresponding 1,957 activities, all 426 detection-limit rows and the original station metadata. Big Creek station metadata is retained as a separate source identity. Measurement counts and summaries refer to the stations that actually have retained result rows.

The result, activity and limit joins use the publisher's organization, activity and result identifiers. Every derived observation carries exact original file and CSV row references. The original CSV columns, comments and values are unchanged in the retained source files. The 2026 query through 13 October returned its header with no rows and is retained.

## Findings that affect the monitoring design

Horsepasture has 106 water-temperature observations. In the 2016–2020 assessment window, 7 of 31 readings exceed 20°C, representing 6 of 30 sampling dates. The 26 August 2016 pair remains two records at its original reported times, 13:45 and 15:45 EST. In 2021–2025, 8 of 26 readings exceed 20°C. Seasonal support changes substantially: June–August contributes 7 readings in the earlier window and 12 in the later window; July contributes zero and four respectively. These counts guide follow-up sampling and do not establish a temporal trend.

The 14 May 2025 temperature result of 7.7°C carries the original J12 calibration-acceptance comment. Excluding this coded-qualified result leaves 25 later readings and the same 8 above 20°C. Generic activity comments, including bridge access and depth-unit conversion, remain sampling context and do not automatically exclude a result.

Total phosphorus has 144 observations under USEPA 365.1, reported as P: 56 uncensored numeric results and 88 non-detections. The plot shows original practical quantitation limits for non-detections, with distinct open triangle markers. Those limits are not substituted concentrations. All 425 censored results across the complete Horsepasture cohort have retained limits. One additional limit belongs to a result without a detection-condition flag; a limit alone does not cause the result to be classified as censored.

Three original 2017 dissolved-oxygen values are 85, 104.1 and 97.8 mg/L. The original records have blank qualifier/comment fields. They remain unchanged and enter an explicit source-value review queue. The 30 mg/L review threshold is an analytical source-check choice, separate from an environmental criterion. Inspect the publisher's value/unit mapping before quantitative use; the software does not convert these values to percent saturation or reinterpret their units.

The fecal-coliform cohort has 138 records and at most two samples in any 30-calendar-day window. The referenced recreation criterion requires at least five consecutive samples in 30 days. The 900 cfu/100mL result of 25 August 2008 carries Q1, with a publisher comment that holding time was exceeded before laboratory receipt. The full source comment remains attached. A recreation campaign should plan the required sampling frequency and holding-time logistics explicitly.

## Original sources and cross-profile reconciliation

Publisher: North Carolina Department of Environmental Quality, Division of Water Resources, supplied through the Water Quality Portal. Exact request URLs, response byte counts and SHA256 values are in provenance.json; source-inventory.json adds row and column counts.

- [Horsepasture original station](https://www.waterqualitydata.us/provider/STORET/21NC03WQ/21NC03WQ-H6000000/)
- [Big Creek original station](https://www.waterqualitydata.us/provider/STORET/21NC03WQ/21NC03WQ-H3200000/)
- [Water Quality Portal user guide](https://www.waterqualitydata.us/portal_userguide/)
- [Current WQX3 service documentation](https://www.waterqualitydata.us/beta/webservices_documentation/)
- [NC 2022 assessment methodology](https://www.deq.nc.gov/water-quality/planning/tmdl/303d/2022/2022-303d-listing-methodology-final/download)

The methodology's printed page 2 describes the 2016–2020 assessment window and quality review; printed pages 4, 5, 6 and 8 describe statistical assessment, dissolved oxygen, temperature and bacterial sampling criteria. The 20°C, 6 mg/L and 10 NTU reference screens in this edition use its trout-water criteria. Source screens remain separate from the agency's assessment categories and procedures.

The principal derivation retains the complete returned legacy WQX2.2 narrowResult, activityAll and detection-limit profiles. Two independently downloaded WQX3 originals cover Horsepasture 2021–2025. All 318 result and 318 activity identities match across profiles. All 21 explicitly mapped result fields and 17 activity fields agree. profile-reconciliation.json retains the mapping and comparison results. Extra WQX3 fields remain in the original WQX3 CSVs; the comparison does not discard or relabel them. The full two-site modern capture manifest from the existing source team is retained as source context, with durable attachment references. Its listed large attachments are separate retained sources, not implicitly imported observations in this edition.

## What is grouped, and what remains separate

comparison-groups.csv separates organization, station, characteristic, fraction, analytical method and context, method specification, unit, media, media subdivision, activity type, value type and measurement basis. The original Ammonia / Ammonia-nitrogen and nitrate/nitrite names remain distinct. Summary statistics use uncensored numeric results within each exact group. Every group's result IDs and all original qualifiers remain available in comparison-groups.json and observations.json.

If a censored result omits its unit, a single consistent original detection-limit unit can label its analytical group; analysis_unit_basis records that choice. No half-limit, zero or full-limit substitution enters the numeric summaries. Multiple original limits are retained as a one-to-many relationship. Detected uppercase code tokens such as Q1, B4 and J12 are indexed for review with the complete original text; their presence does not itself declare a result invalid.

Dates and timezone strings remain original. Figure x-coordinates encode the published calendar date as an epoch-day coordinate for plotting; this does not convert the field measurement time to UTC. Original station coordinates remain NAD83 / EPSG:4269. The native source collection includes these points for actual selected-domain intersection; station-name matching does not assign an assessment unit or study membership.

The acquired physical-flow field is a severity choice list. It is not measured discharge and cannot supply a concentration-to-mass-load calculation. A load study needs appropriate co-located discharge and temporal support.

## Open, reproduce and continue

Open measurement-explorer.html to filter the complete embedded observation table by station, parameter, exact comparison group, sampling window, month, censoring and original comments. Open a row to inspect all joined metadata, source-row links and original detection limits. The three analytical value-review records have a separate visible review label. MEASUREMENT_EXPLORER.md describes the controls, complete selected-row downloads and source links. Selection downloads contain all matching rows and all fields, including nested source and limit objects.

Open report.html for the complete readable scientific report and its original-data figures. The report and its links are portable inside this source family. NATIVE_OPENING.md describes importing the collection into the existing Workspace, saving the native scientific report, exporting its selected study and opening the receiving archive.

From the application directory, run:

```sh
node source/nc_ambient_measurements/20261013/reproduce.mjs --check
```

The producer verifies all original source bytes, runs the actual row joins, rebuilds the derived tables, figure specification and readable report, and compares the resulting files. Use --write to regenerate these outputs after an explicitly updated source edition. There is no network access in the derivation. Original source files remain inputs.

Read thermal-screen.csv and sampling-coverage.csv together when selecting a sampling season. Use quality-and-detection-review.csv and source-value-review.csv before quantitative interpretation. Use the saved NC designation/assessment report to inspect legal classes and parameter-specific assessment labels alongside this measured source.
