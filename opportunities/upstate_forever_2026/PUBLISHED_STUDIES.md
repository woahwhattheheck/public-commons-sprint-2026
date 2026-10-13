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
