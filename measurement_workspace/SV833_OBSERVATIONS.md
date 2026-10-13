# SV-833 original observations in Published studies

The installed cohort is **scdes-sv833-water-quality-2021-2026**. It retains the complete original SV-833 report family and admits all **610 ResultIdentifiers across 56 activities** into the existing Published studies desk. The original ResultIdentifiers remain visible in the chronology, detail panel and selected-row export.

## Source and analytical support

The cohort consists of three unchanged WQP **NarrowResult** CSV bodies: 342 Physical, 208 Nutrient and 60 Microbiological records, each with its original 78 columns. Their characteristic sets are disjoint. The shared station and query date window therefore describe one explicit cohort without duplicate profile admission. The separate default Result CSVs and period-of-record summary remain original reconciliation companions.

The original Activity CSV supplies project, activity type, comments and activity depth through an exact ActivityIdentifier join. Station, organization, original date, displayed clock and time zone must agree. The original ResultDetectionQuantitationLimit CSV supplies limits through an exact ResultIdentifier join; station, organization, activity and characteristic must also agree. All 606 limit records and 56 activity records remain retained. Four uncensored physical measurements have no limit record. Each admitted result carries its original metadata CSV path, SHA256, row number and registered Workspace source selector.

There are 557 quantified results, 49 below-limit results and four above-limit results. Blank result values remain blank. The native parser keeps lower and upper censor direction and the original limit type and unit. Ammonia’s original “as NH3” specification remains distinct from “as N”; the desk does not convert these quantities or infer a nitrogen total.

The desk displays every original result, including the 34 agreeing repeated activity-characteristic values with distinct ResultIdentifiers. Its summaries count original result rows. The separately retained scientific report groups those repeated values into 576 activity-characteristic measurements and quantifies the weighting difference. The desk states this distinction in the study selection notes. NPS-2013 and SWS-2024 are the original activity project names.

Original query dates are 2021-01-01 through 2026-10-13. Actual sampling dates run from 2021-01-20 through 2026-06-24. The original station catalogue supplies the unchanged WGS84 coordinates and a derived EPSG:4326 point source. The station remains Three and Twenty Creek at Highway 88.

## Native operation

Install the maintained family into the actual application:

    python APP/install_published_studies.py --application APP

In the original operator, open **Published studies**, import the installed SV-833 cohort, select a characteristic and calendar interval, and inspect **Original row**. The detail panel shows the unchanged 78 result fields, followed by the separately retained activity and reporting-limit records. The original scientific HTML report opens from the retained report selector. When the maintained microbial temporal source is installed, the same selector also includes its unchanged multi-station calendar and flow explorer. That report and its separate bound observed-report recipe retain the author's own scope and complete source closure; they do not add rows to this SV-833 cohort.

The same journey can be run through the maintained CLI:

    python APP/measurement_workspace/sv833_observations.py --application APP --output RECEIVING/sv833-source
    python APP/measurement_workspace/published_studies.py --application APP --workspace WORKSPACE import RECEIVING/sv833-source
    python APP/measurement_workspace/published_studies.py --application APP --workspace WORKSPACE context scdes-sv833-water-quality-2021-2026 --site SV-833 --year 2025 --parameter "Escherichia coli"
    python APP/measurement_workspace/published_studies.py --application APP --workspace WORKSPACE report scdes-sv833-water-quality-2021-2026 --destination RECEIVING/sv833-selected --site SV-833 --year 2025 --parameter "Escherichia coli"
    python APP/measurement_workspace/published_studies.py --application APP --workspace WORKSPACE export scdes-sv833-water-quality-2021-2026 --destination RECEIVING/sv833-study.zip
    python APP/measurement_workspace/published_studies.py --application APP --workspace WORKSPACE import RECEIVING/sv833-study.zip

The Workspace must already exist. The operator uses its original action queue, authenticated source access and export tickets.

## Export and reopen

Selected NarrowResult CSVs preserve their original headers and cell values. Selected activity and limit metadata CSVs preserve their own original headers and rows. The selected-activities/index.json file connects every selected ResultIdentifier to its original result CSV row and exact metadata source rows; metadata exports include original-to-selected row mappings. The selected report ZIP also retains the complete offline scientific report, figures and declared original companions with relative links intact.

A complete study export retains the exact source edition and all original native source IDs, titles, roles and metadata. Reopening the same archive uses the original Workspace import and identity rules. The current application-root sv833_water_quality.sources.json and its declared member hashes determine the report edition; figure corrections can create a new source edition without replacing older saved study versions.

## Reader contract

wqp_profiles.py handles the original NarrowResult-to-metadata join. source_observations.py validates original source bytes and declared station/characteristic/date scopes, preserves all record IDs, and groups method specification alongside fraction, analytical method, result type, measurement basis and original unit. Other WQP Result cohorts use their existing parser.

sv833_observations.py builds the installed cohort from the maintained forty-file native source family. study_context.py supplies the same complete source closure to import, cold installation and transfer. No profile is inferred from a filename: the observation index declares the format, original source scope, role, byte length, hash and metadata dependencies.


## One resumable native receiving command

The maintained receiver performs the complete original-data journey in the actual application: import, original result/metadata inspection, selected report export, complete-study re-import, full Workspace archive, and restored original source access. It uses the existing Workspace, PublishedStudyStore and portable-project implementation.

    python APP/source_tools/receive_sv833_study.py --application APP --workspace RECEIVING/sv833-observed-workspace --output RECEIVING/sv833-native --create-workspace

Use the existing Workspace path when one has already been chosen. The explicit create flag creates that Workspace only when its workspace.json does not exist. The output and Workspace must be outside the application tree, and the output must be outside the Workspace. The default selection is SV-833, Escherichia coli, 2025; --year and --parameter select another original subset.

The command prints its actual PID, operation ID, Workspace identity and each completed phase immediately. operation.json retains the exact source edition and selection. A rerun reconnects those same identities, preserves saved selected-report/complete-study outputs, and resumes project receiving. Changed source editions or selections use a new output directory. Original source files and saved Workspace histories remain under their native ownership.

Selected files remain in Workspace/published_study_exports/OPERATION_ID. The complete project archive and reopened-project directory are under the explicit output path. The receiving result returns actual study/version/collection IDs and resolves the first original CSV through the restored Workspace source selector. Open the restored application and original Published studies view to inspect the same source-bound records and report/figure links.

## Original hydrologic context

When the application contains `sv833_hydrologic_context.sources.json`, the SV-833 builtin imports the seven original native entries and their complete 26-file source family. The four vectors, HTML report, SVG map and downstream site table retain their application-relative paths, original coordinates and immutable native source selectors. The existing cold installer uses the same source registry, so its installed study, complete study ZIP and portable Workspace retain the same report closure.

The network context contains 45 whole upstream reaches and an unsimplified whole-catchment polygon. Its original 100 km navigation responses contain zero upstream NWIS sites and 14 downstream indexed sites. The downstream stations remain separate monitoring locations. This context leaves the observation cohort at 610 original results, 56 activities and 606 original limit records.

Import the installed cohort again to create the new source edition. For a native receiving continuation, use the same Workspace with a new `--output` directory: the completed operation preserves its exact earlier source edition. In Published studies, choose the hydrologic report under retained reports, inspect its original map/source table, export the complete study and reopen it. The report links resolve within the retained application layout.
