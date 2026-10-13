# Eighteenmile 2023: original laboratory CSV into fieldwork

This package opens the original three-lake sampling records in **Implementation & fieldwork** and receives their original WQP result CSV through the laboratory importer. The source is the retained 2023 SCDES Water Quality Portal edition already used by the lake observation report.

## Original records

There are **3 stations, 48 distinct station/collection-time events, 88 original sample activities and 88 laboratory result rows**. All results join to exactly one activity by the original `ActivityIdentifier` and the same `MonitoringLocationIdentifier`. The expected import has **82 numeric results and 6 censored results**.

The supplied `plan.json` contains sites, historical collection events and the original sample activities, with an empty observation collection ready for the original result file. It retains all original station/activity columns inside their source records. Native activity IDs are stable hashes; the full original WQP activity identifier remains the sample ID used for the CSV join. Event grouping uses the exact station/date/time/timezone tuple.

## Open and receive

1. Open the maintained **Implementation & fieldwork** desk in the actual scientific workspace.
2. Choose **Open JSON**, select `plan.json`, and save its first native revision. Its title is **Eighteenmile 2023 — original lake samples**.
3. Choose **Import laboratory CSV** in **Field records**. Select the original `three-lake-results-2023-original.csv` from the parent WQP source directory then choose **Open mapping JSON** and load the supplied `mapping.json`. Choose **Preview laboratory results** (or **Save plan and preview laboratory results** if the plan has edits).
4. Review the 88 matching rows. The mapping uses the exact existing sample and site identities. Numeric rows take their original numeric text and reported unit. For the six censored rows, explicitly configured fallback columns use the original detection-condition text and original reporting-limit unit.
5. Choose **Import reviewed results** to save one native revision, then choose **Review saved field observations** and **Register saved field observations**. Open the actual observed edition or choose **Prepare client report** from that completed import.

The import preserves the complete original result file. Its underlying provider and browser guide are `docs/IMPLEMENTATION_LAB_RESULTS.md` in the laboratory intake component.

## Source interpretation

All 88 activity records explicitly label their local clock **EST**, including summer records. Preparation encodes that stated fixed offset as `-05:00` and retains the original date, time and timezone strings alongside it. It does not replace the source code with a daylight-saving zone.

Station latitude/longitude retain their original **NAD83** datum, recorded as `EPSG:4269` on each site. Site and activity source records retain every original metadata column.

The six below-reporting-limit rows have blank numeric measurement and result-unit cells. The selected mapping uses the original `ResultDetectionConditionText` as their result text and `DetectionQuantitationLimitMeasure/MeasureUnitCode` as their displayed unit. That choice is explicit in `fallback_columns`; original blank cells remain in the uploaded CSV.

All original limit records are labelled **Lower Reporting Limit**. The mapping leaves the native detection-limit and quantitation-limit fields unmapped, preserving the original limit type/value/unit in the retained result file. It does not equate those differently named limit concepts.

The 48 visit records are original **collection events**, grouped from the original sample activities. Their timestamp is the original sample collection time; their observer is the original conducting-organization field when supplied. No scheduling tasks, project budgets, or original custody reference are inferred.

## Receive the complete original case in an existing native Workspace

The installed Python worker can perform this actual source workflow independently of a watershed model run:

```sh
python source_tools/receive_wqp_field_results.py --workspace ACTUAL_EXISTING_WORKSPACE
```

The command opens that real workspace, receives the prepared original sample plan, previews and imports the raw result file as one saved revision, registers that revision in the native observation/source registries, and creates a retained field-report edition. It returns the actual saved plan/revision, original operation, observation IDs and report/source locations. The report's as-of date is the package preparation date; its sample dates remain the original 2023 times.

A resumed run uses the original seed revision and the same reviewed source operation. It reconnects a completed laboratory commit, preserves any later plan revision, and retains an interrupted report directory before rebuilding that same report. Its result is saved inside the existing workspace under `implementation/wqp-receiving/`. Open the resulting plan and observation IDs in the current operator; **Prepare client report** carries the original observed source into the normal delivery form.

## Reproduce the package

From the application source root:

```sh
node source_tools/build_wqp_field_intake.mjs \
  --source observations/eighteenmile_2023/wqp_20261013 \
  --output NEW_FIELD_INTAKE_DIRECTORY \
  --created-at 2026-10-13T05:21:28Z
```

The preparation timestamp identifies this generated package. It is separate from the original 2023 collection times. The builder reads and checks the exact retained original station, activity and result CSV hashes before producing `plan.json`, `mapping.json`, `coverage.json`, and copies of those three original source files into the new directory. The supplied plan passes the maintained browser plan validator against its original relationships and timestamps.

| Original source file | SHA256 |
|---|---|
| three-lake-stations-original.csv | `85a33ed59d36327d6ec127e9d2f83cf688095103ef887b7ab1d408b45d4ec8e3` |
| three-lake-activities-2023-original.csv | `8118f52771b1bc87822e821f52c4980bdd8ab3471c8a5b790a9c8129ccf72f85` |
| three-lake-results-2023-original.csv | `5b22e3de1a4311963b2ed616886273788bd485897f276663157a7137ce0aaa61` |

Original public source: [retained WQP edition](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/901998901297e02412f414dfbac9f0222f5f6f75/opportunities/upstate_forever_2026/observations/eighteenmile_2023/wqp_20261013). The original source-acquisition metadata and full lake observation report remain in that directory.
