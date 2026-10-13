# Published field-study workspace

The ECSA extension turns the existing Eighteenmile 2023 companion into a retained, filterable study. It imports the original source files through the current Workspace source registry, displays original station datums and published statistics, produces selected reports, and exports a complete ZIP that the same intake can reopen in another workspace.

## Included study

The ten original OBS12 files are included byte for byte at observations/eighteenmile_2023/.

| Component | Rows |
| --- | ---: |
| Stations | 5 |
| Seasonal concentration summaries | 26 |
| Monthly dissolved oxygen summaries | 14 |
| Monthly pH summaries | 14 |
| Surface field range rows | 5 |
| Permits identified in the report | 4 |
| Original source notes | 9 |

Seasonal concentrations retain mg/L or ug/L, sample counts, the source's standard-deviation token, detection-limit treatment, depth interval, parameter formula, statistical basis and full sampling campaign. Continuous monthly counts represent days. Station coordinates retain WGS84/EPSG:4326 or NAD83/EPSG:4269 exactly as provided, with separate rounded report coordinates.

The Table 7 visual companion records the original printed n values of 4 for SV-374 and 4 for SV-840. The original report is technical report 010-2023, December 2023:

https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf

Table 7 appears on printed page 14, PDF viewer page 21, zero-index page 20. The methods statement of 75 successfully analyzed chlorophyll samples appears on printed page 6, PDF viewer page 13. Both are retained. The visual JSON also records the arithmetic consistency check for SV-374: with printed mean 10.7, extrema 5.6 and 18.7, and n=4, the minimum population SD is 4.8532205802; allowing one-decimal rounding lowers the bound only to 4.8046852134, above the printed SD 4.3.

## Install into the maintained application

From this source carrier:

    python install_published_studies.py --application "$UPSTATE_APP_ROOT"

The installer checks that the current Workspace and ECSA extension registry exist. It installs one provider, one extension descriptor, the study core, the desk assets and the original study files. Identical existing files are reused. Earlier versions of this extension's code are backed up before replacement. An existing different edition of a published source remains visible as a source conflict to resolve before installation.

The installer extends the current native archive inventory with the study module, observation sources and study tools. Native project backup and restore therefore carry the same desk and sources, and the restored source-manifest path resolves under the receiving workspace.

The installed application discovers operator/extensions/published-studies.json through its current registry. The view is Published studies. Use its Import installed study button for the included Eighteenmile data. The original host continues to own authentication, queued tasks, retained source collections and download tickets.

## Native source and task contracts

Provider factory:

    PublishedStudyProvider(operator, fault, source_roots)

The provider uses operator.ws(workspace_key), the actual Workspace.root, Workspace.import_sources(manifest_path), and Workspace.source_file(collection_id, source_id). Downloads use model.common.describe_file and operator._ticket.

Queue tasks through the existing POST /api/actions route:

    {
      "workspace": "ACTUAL_WORKSPACE_KEY",
      "action": "published-study.import",
      "operation_id": "published-study-import-20261013",
      "payload": {"builtin_id": "scdes-eighteenmile-lake-2023"}
    }

The existing task service manages lifecycle and retries. Other source forms are:

    {"source": {"root_id": "CATALOG_ROOT_ID", "relative_path": "study/source.json"}}
    {"source": {"source_collection_id": "COLLECTION_ID", "source_id": "SOURCE_ID"}}
    {"source_json": "FULL_ORIGINAL_OBS12_COMPANION_JSON"}

A source-root selection can refer to a companion JSON, a complete study ZIP, or a materialized study directory. Original PDF and PNG evidence can be supplied in the same import:

    {
      "source": {"root_id": "CATALOG_ROOT_ID", "relative_path": "study/source.json"},
      "evidence": [
        {
          "filename": "2023LakeProgramFinalReport.pdf",
          "source": {"source_collection_id": "REPORT_COLLECTION", "source_id": "REPORT_SOURCE"}
        },
        {
          "filename": "table7-page21.png",
          "source": {"root_id": "CATALOG_ROOT_ID", "relative_path": "study/table7-page21.png"}
        }
      ]
    }

Import returns the actual retained record, source collection ID, per-file source IDs, stable study version, and source-manifest location. Published-study versions are keyed by the exact retained source bytes.

Read routes use POST bodies with workspace alongside their fields:

- /api/published-studies/catalog: installed and imported studies, registered source folders.
- /api/published-studies/study: study_id and optional version_id.
- /api/published-studies/context: study_id, optional version_id and selection.

Example selection:

    {
      "workspace": "ACTUAL_WORKSPACE_KEY",
      "study_id": "scdes-eighteenmile-lake-2023",
      "selection": {
        "site_ids": ["SV-374", "SV-840"],
        "parameters": ["total_chlorophyll_a"],
        "strata": ["surface"],
        "year": null,
        "months": []
      }
    }

The desk keeps input drafts intact during host refreshes and cancels read requests on detach. Station, parameter and depth filters operate on the original rows. The month and year controls apply to the continuous summaries; seasonal support remains the complete published campaign.

## Reports and portable studies

Queue published-study.report with the same study and selection payload to create:

- selected-context.json, including original source selectors and source notes;
- one CSV per original table, retaining its original column names and selected raw cells;
- study-report.html, a grayscale printable report with seasonal, continuous, station, field-range and permit tables.

The HTML report embeds retained Table 7 PNGs when supplied. The original standard-deviation dash and below-detection-limit minima remain explicit.

Queue published-study.export with study_id and optional version_id for a complete ZIP. It contains every retained source byte, source manifest, typed study context, and export manifest. Importing the ZIP verifies those original hashes and registers the originals with the receiving Workspace, giving them actual local collection/source identifiers.

Original files are also available individually through the existing native download tickets. The report and complete export use the same retained source version.

## Connect the existing geography operation

After intake, record.source_manifest.path is an actual upstate.sources/v1 manifest. Every original source is registered with study ID, study version, original relative filename, observational support and one-based PDF page convention.

Pass that path as a repeated --context-manifest argument to the existing ASSESSMENT-GEOGRAPHY12 operation. It already provides the original 87-station geography and mixed native CRS handling. The published-study station table joins through site_id and monitoring_location_id; station datum and report-coordinate columns remain distinct.

Published summary rows have statistic_basis=published_seasonal_sample_summary. The existing measurement intake continues to supply individual WQX chemistry and daily USGS flows.

## Retain the original Table 7 images

Download the original report from its publisher URL, then render its page in an equipped PDF runtime:

    python tools/attach_published_report.py \
      --pdf /actual/source/2023LakeProgramFinalReport.pdf \
      --study-directory "$UPSTATE_APP_ROOT/observations/eighteenmile_2023"

This creates the exact full-page PNG, a tight original Table 7 crop, their original-PDF provenance and the retained report. Import installed study again to register the resulting complete source version. The provider automatically discovers those named evidence files. The renderer exports the original report pixels identified in the visual companion.

## Direct Python use

    from measurement_workspace.published_studies import PublishedStudyStore

    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    imported = store.import_source(original_companion_path, evidence=original_evidence_bytes)
    context = store.context(
        imported["record"]["study_id"],
        imported["record"]["version_id"],
        site_ids=["SV-374"],
        parameters=["total_chlorophyll_a"],
    )
    exported = store.export_study(context["record"]["study_id"], actual_export_path)
    reopened = receiving_store.import_source(exported["path"])

The CLI exposes import, list, get, context, report and export:

    python measurement_workspace/published_studies.py \
      --application "$UPSTATE_APP_ROOT" --workspace "$ACTUAL_WORKSPACE_PATH" \
      import "$STUDY_SOURCE_PATH"

The complete original data files were matched to all ten published SHA-256 hashes while building this carrier. The authored browser module was parsed with the JavaScript engine. Native intake and UI startup should be run by the receiving equipped session against its current registered application; the cloud executor was unavailable during assembly.

## Original map and dated-source registration

Installed source manifests are followed from their original locations. Each body and companion is retained with its original bytes, native source ID, metadata and coordinate reference system. The current 44-file study edition has a 17-entry parent manifest at `observations/eighteenmile_2023/model-sources.json`. The study importer also accepts that complete source bank directly; its data-source owner maintains the edition.

The two original study vectors retain WGS84/EPSG:4326 for SV-268 and SV-374 and NAD83/EPSG:4269 for SV-838, SV-839 and SV-840. The current source edition also has observed chlorophyll points in those two native CRSs. The existing geography receiver performs display projection. Supply the imported `record.source_manifest.path` to its `--context-manifest` argument to use the same Workspace sources.

Importing an already retained source version refreshes its registration to the current contract. The preceding immutable collection and original source bytes remain available. When several manifests identify the same native source, the importer compares resolved body bytes and retains the union of identical companions.

## Report comparison and original WQP context

The **Report comparison** tab places original activity counts, dates, methods, depths, detection limits and quantified-only statistics beside the published seasonal rows. Its active source follows the most complete installed edition:

- The earlier twelve-file WQP companion supplies 88 original activities from SV-838, SV-839 and SV-840.
- The separately maintained reconciled cohort adds all 75 chlorophyll activities across five lake stations, giving 118 comparison activities with the earlier 43 microcystin records.
- The current 44-file edition retains 920 original results and 225 activity/project groups across nine source queries. Its comparison adopts the same 75 selected chlorophyll activities and all 85 original campaign microcystin activities. The two long-running stations have additional microcystin visits; exact calendars, counts and detection limits remain visible. All 85 original microcystin rows have distinct activity IDs, project SCDHEC-MICRO, source activity type Sample-Other, Water media and Final result status. Counts by SV-268/SV-374/SV-838/SV-839/SV-840 are 21/21/14/15/14. The comparison labels these as microcystin campaign context and retains the printed report analytical cohort separately. Source project and activity type define separate comparison series, preserving original QC/replicate distinctions if a source edition contains them.

The **WQP source context** tab exposes the complete acquired result year, the original 167 analyte/fraction/unit coverage groups, and each original row. Station and parameter filters select these rows. The original project, fraction, unit, sample depth, detection condition, qualifier, method, activity ID and source-record identity remain attached. Both the normalized row and its original publisher response are downloadable through the authenticated Workspace source registry.

The original station table contains five lake coordinates. The selector additionally includes the four original upstream source-query stations, without assigning coordinates from another station. The SV-591 source query returns an original header-only CSV, which stays visible as an empty source result. The current individual-measurement desk independently owns its native observation admission and series display; this study view provides the report, cohort and source-context relationship.

Original blank measured values remain blank. Each result keeps its own detection limit and unit; quantified-only statistics do not substitute a detection fraction. The calendar table shows missing chlorophyll-visit dates and extra microcystin dates. Continuous month/year filters apply to the continuous summaries; original dated rows retain their full acquired source year and the comparison retains the published grab campaign.

### Reconciled chlorophyll and the printed report

All five selected series contain fifteen original chlorophyll activities at 0.3 m, spanning April 5 through October 17, 2023. Their arithmetic means and sample standard deviations are:

| Station | Original activities | Mean (ug/L) | Sample SD (ug/L) | Printed Table 7 n |
| --- | ---: | ---: | ---: | ---: |
| SV-268 | 15 | 7.406666667 | 8.036293270 | 15 |
| SV-374 | 15 | 10.675333333 | 4.264115830 | 4 |
| SV-838 | 15 | 24.097333333 | 8.583679253 | 15 |
| SV-839 | 15 | 15.415333333 | 7.429484568 | 15 |
| SV-840 | 15 | 6.065333333 | 1.751321406 | 4 |

These reproduce every printed mean, SD and range at the report's displayed precision. Original Table 7, printed page 14 / PDF viewer page 21, retains n=4 for SV-374 and SV-840.

SV-268 and SV-374 have extra same-date chlorophyll activities. The source selection is an explicit inference from the agency project/calendar and publisher-displayed local clocks, supported by reproduction of all five summaries. SV-268 retains July 11 at 09:50 (15.76 ug/L); its extra routine visit is at 13:08. SV-374 retains August 8 at 10:54 (10.91 ug/L); its extra routine visit is at 10:59. Original EST and EDT labels remain unchanged. Every included and excluded source activity remains in the complete WQP context.

## Upstream flow on sample dates

The **Upstream flow** tab uses the current source edition's sixteen-date laboratory/flow table. It joins the original reporting dates to USGS-02186702 agency daily mean discharge, with original qualifiers and exact source response/record indices. The preceding three- and seven-day windows exclude the sample reporting date. Values remain in ft³/s.

The table displays same-date discharge, annual percentile, antecedent means and maxima, maximum dates, valid/expected day counts and the retained annual p95. Source methods and every antecedent response index are available in row details. Selected activity dates outside the retained sixteen-date table are listed explicitly. The hydrology source owner supplies the complete daily-flow edition and its own reusable calculation.

## Complete exports and native receiving

Selected report output includes report comparisons, activity chronology and calendar, original WQP coverage, upstream flow and original page imagery when installed. The following CSV files retain the exact selected original cells and headers:

- `original-activities-selected.csv` for the earlier normalized activity edition.
- `chlorophyll-cohort-selected.csv` for the separately maintained full-column cohort.
- `reconciled-chlorophyll-selected.csv` and `campaign-microcystin-selected.csv` for the current source edition.
- `wqp-results-selected.csv`, `wqp-coverage-selected.csv` and `upstream-flow-selected.csv` for complete dated context.

Full study ZIPs retain every source member, manifest, original response, reusable source calculation, report and image. Re-import that ZIP into a new actual Workspace to reopen the identical source version. Native project archives include the same application extensions and observation sources.

From a maintained checkout, install the extension into the actual registered ECSA application:

    python install_published_studies.py --application "$ACTUAL_APP"

If the current original study bank is not materialized in that application, import its complete JSON bank directly:

    python "$ACTUAL_APP/measurement_workspace/published_studies.py" \
      --application "$ACTUAL_APP" --workspace "$ACTUAL_WORKSPACE" \
      import "$CURRENT_STUDY_BANK"

Use the returned study/version in the native desk. A selected report and complete-study export can also be produced from that same Workspace:

    python "$ACTUAL_APP/measurement_workspace/published_studies.py" \
      --application "$ACTUAL_APP" --workspace "$ACTUAL_WORKSPACE" \
      report scdes-eighteenmile-lake-2023 --site SV-374 \
      --parameter total_chlorophyll_a --destination "$ACTUAL_REPORT_DIRECTORY"

    python "$ACTUAL_APP/measurement_workspace/published_studies.py" \
      --application "$ACTUAL_APP" --workspace "$ACTUAL_WORKSPACE" \
      export scdes-eighteenmile-lake-2023 --destination "$ACTUAL_STUDY_ZIP"

The standalone installer checks original source conflicts before writing and retains backups of changed consumer code. Importing a different edition directly into Workspace creates another complete retained version.

## Executed source calculation

The original cohort reconciliation module was executed against its four retained input CSVs. Its 75-row cohort CSV (43,187 bytes), five-row summary CSV (644 bytes) and reconciliation JSON (8,067 bytes) reproduced the source edition byte for byte.

The current nine-source `normalize_core.mjs` was also executed against all exact original capture CSVs. All six derived CSVs and `summary.json` matched their retained bytes: 920 measurements, 225 activities, 167 coverage groups, fifteen calendar dates, 75 selected chlorophyll records and five summaries. All 44 source member hashes and the complete source-bank hash matched. The authored browser module parses in JavaScript. The complete Python Workspace/operator/browser workflow is the native receiver exercise.
