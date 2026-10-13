# Receive the original three stations and 48 collection events

This receiving workflow uses the exact public WQP station and activity CSVs already retained in the application. It exercises the completed bulk site/visit operation on a separately named native field plan: first the station CSV, then the visit-only follow-up CSV. The existing Eighteenmile laboratory plan and its 88 results remain separate.

## Original sources

| Source | Original bytes | SHA256 |
|---|---:|---|
| three-lake-stations-original.csv | 1,764 | 85a33ed59d36327d6ec127e9d2f83cf688095103ef887b7ab1d408b45d4ec8e3 |
| three-lake-activities-2023-original.csv | 32,166 | 8118f52771b1bc87822e821f52c4980bdd8ab3471c8a5b790a9c8129ccf72f85 |

Both files are under observations/eighteenmile_2023/wqp_20261013. They are original published CSV bytes, including their absence of a terminal newline. The receiving command verifies both hashes before preparing any plan.

The actual station table has three rows. The actual activity table has 88 rows and 48 distinct combinations of station identifier, original date, original clock time and original timezone code. The command retains all 88 rows and records their explicit event grouping; it does not treat each analyte/sample activity as a separate site visit.

## Run in the existing native application

From the application root, use the available original Python interpreter:

```sh
python -B -m source_tools.receive_wqp_sites_visits \
  --workspace /absolute/path/to/original-workspace
```

To explicitly create a dedicated receiving Workspace:

```sh
python -B -m source_tools.receive_wqp_sites_visits \
  --workspace /absolute/path/to/eighteenmile-source-onboarding \
  --create-workspace
```

The optional --source-root selects an existing application root containing the original source directory. The command accepts no replacement source hash or fabricated input fixture.

## Actual mapping and interpretation

Station IDs are generated from the explicit WQP station namespace and exact original MonitoringLocationIdentifier. The original identifier remains in original_source. LatitudeMeasure and LongitudeMeasure are retained as original numeric degrees with the explicitly declared NAD83 -> EPSG:4269 mapping. No projection or datum transformation occurs.

The follow-up visit CSV uses source_id binding to resolve those exact original identifiers from the already saved sites. ActivityStartDate and ActivityStartTime/Time provide the actual recorded collection timestamp. Every original timezone is EST, retained as fixed UTC-05:00 even on summer dates. No daylight-saving reinterpretation is introduced.

Each original activity row receives an explicit reviewed native event ID from its exact station/date/time/timezone tuple. The first row for each event appends a visit. The other 40 rows are identical native event definitions; they remain individually present in the original activity CSV and complete row-decision audit. The command records original-event-groups.json with every original activity identifier and CSV record number.

These are historical collection events. The explicit complete status follows the actual activity timestamp in the retained public source. No planned schedule, observer, custody completion, new sample collection, laboratory result or pollutant load is inferred.

## Saved output and restart

The operation creates one deterministic separately named plan. Its original empty seed is revision 1; the reviewed three-site batch commits revision 2, and the reviewed 48-event batch commits revision 3. Each batch goes through preview_site_visit_intake and import_site_visit_intake with its exact reviewed operation ID. The two-stage workflow deliberately verifies that visit-only follow-up resolves the original source lineage of previously saved sites.

The retained operation directory is implementation/site-visit-receiving/<operation-id>. It contains the exact source identities, complete explicit mappings, event grouping, both native previews, original seed, applied plan and final result. Native intake stores both complete raw CSVs and both row audits as ordinary plan attachments and source links.

The command creates and retains the maintained field-plan HTML/CSV report for the applied revision. Its historical report date is 2023-10-17, the last actual source activity date. The final result lists every source/audit/report descriptor with actual bytes and hashes, the two native import IDs and the saved plan/revision.

A retry imports the same original seed through the maintained historical import path, explicitly reopens seed revision 1 and reconnects the exact originally applied batch revisions. It does not substitute the current live head. Later plan edits remain intact and the response names the current revision separately. Interrupted report directories remain available; a later attempt creates a fresh report directory and retains the complete edition through the original store.

## Installed source

Add source_tools/receive_wqp_sites_visits.py and this guide to the existing installation source inventory. The runner uses the original Workspace, ImplementationStore, CSV source reader, native bulk model and portable report inspector. It needs standard Python and the installed application; this workflow has no InVEST or GIS runtime requirement.
