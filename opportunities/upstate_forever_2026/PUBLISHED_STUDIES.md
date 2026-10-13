# Published field-study workspace

The ECSA extension retains the original lake, stream-nutrient and utility-microbial source cohorts as separate filterable studies. It imports the original source files through the current Workspace source registry, displays original station datums and published statistics, produces selected reports, and exports a complete ZIP that the same intake can reopen in another workspace.

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
      import "$CURRENT_STUDY_BANK" --with-installed-context

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

## Direct original Canvas intake and existing illustrated report

The same intake accepts a downloaded Canvas Markdown file. It reads the complete ordered base64 fences as one original gzip source bank, enforces the decompressed size limit and verifies every original member hash. It also accepts the earlier plain JSON companion fence. Source scripts in the Canvas are retained as source data; intake only decodes the original data blocks.

When the maintained application includes `eighteenmile_lake_observation_report.sources.json` from PR2880, installed-study intake follows its six native entries and all original WQP/cohort companions. Repeated native IDs keep their original body and collect the full companion set. The existing illustrated observation report is linked from Report comparison and Sources and methods. Selected exports retain its exact original HTML as `original-lake-observation-report.html`; complete study and native project archives retain its original report, generator and both source trees.

The optional application-root `eighteenmile_lake_paired_analysis.sources.json` follows the same source-registration path when installed. Its original station/date/activity-matched analysis, source inputs and method files remain under the study directory; native identifiers and declared companions travel with the retained study and project archive.


## Complete scientific figures and reporting-limit support (1.3.0)

The current 62-file source edition retains the same original agency CSV bodies, 75 selected chlorophyll activities and 16 flow dates. Its four scientific SVGs have an additional seven-entry native manifest at `figures/model-sources.json`. Installed intake and the standalone installer follow that manifest alongside the original study manifests and both maintained standalone flow manifests. The original full flow-method document remains preferred when the public-source flow companion is also present. Relative companions such as `../wqp/study_flow_dates.csv` resolve inside the study tree; paths outside that tree are rejected. Original SVGs, data tables, scientific figure specification, pinned local D3 code and licenses remain together.

Scientific figures displays the four retained source figures in the existing Published studies desk. The figures cover the complete original cohort and preserve their original scope when the table selection changes. All numeric axes, units and source activity identifiers remain in the original SVG/specification. Report exports carry those same figures and their reconstruction inputs.

The corrected source edition identifies four E. coli records above their original upper quantitation limits. Their measured-value fields stay blank. The original detection condition, limit type and limit are preserved; the study context honors the source's `censored_above` flag and exposes the direction and upper-censored coverage count. The 75 selected chlorophyll and 85 microcystin records are unchanged by that correction.

ASTRA13's original `measurement_workspace/observation_support.py` now enriches each existing concentration series with all-row mean intervals, quantified/below-limit counts and original result selectors. The calculation keeps every station/parameter/project/activity-type group separate. Below-limit values contribute [0, their original limit), conditional on nonnegative concentration. These are arithmetic bounds on the retained rows, and original values stay blank. Selected-context JSON, the existing HTML report, the desk comparison and `observation-support-selected.csv` expose the same support. The module's command-line report avoids adding its section twice when the maintained exporter already includes it.

The optional paired-analysis source is composed as a separate original module and seven-entry manifest. It uses the exact source date, displayed clock and time-zone label for cross-analyte matching. Its 67 links retain separate source activities and the different depth support: chlorophyll is reported at 0.3 m, while microcystin depth is blank. The paired report and every linked table, five original station CSVs, normalizer and executable analysis remain under `paired_analysis/`.

Selected report export now includes `selected-study-report.zip`. Extract that package and open `study-report.html`: linked illustrated reports, scientific SVGs, paired-analysis report/downloads, selected original-cell tables and reconstruction files keep their relative paths. The complete-study ZIP remains the native re-import carrier. Application/source installation preserves existing originals and requires an explicit new source edition through native import when source bytes differ.

### Source execution for this edition

All 62 source-bank members match their declared byte lengths and SHA256 values. The exact updated normalizer reproduces all seven derived output files, and the pinned original D3 modules plus figure core reproduce all four SVGs, both figure tables and the complete figure specification byte for byte. The original study and figure manifests resolve 24 native entries with all referenced source hashes intact. The separate paired-analysis module was independently executed from its retained five original WQP CSVs (533 rows) through the original normalizer and actual analysis/report functions. All eleven published output files reproduced byte for byte. An independent decimal interval calculation checked all 128 microcystin contrast endpoints, endpoint inclusion and directions; all agreed. The seven-entry paired manifest resolves all 154 references to 22 unchanged source/output bodies, and its ten local report downloads resolve within the package.

Native receiving continues through the same Workspace import, queued operator actions, browser source/detail links, report export, complete-study re-import and project archive reopen commands above.


## Compose a received edition with installed original context (1.4.0)

A study import saves one immutable source version. Sequential imports select separate versions. To retain the current original source edition and the installed reports together, use the explicit composition option on the same import:

```sh
python "$ACTUAL_APP/measurement_workspace/published_studies.py" \
  --application "$ACTUAL_APP" --workspace "$ACTUAL_WORKSPACE" \
  import "$CURRENT62_BANK_OR_CANVAS" --with-installed-context
```

The native import form has the equivalent **Include installed Eighteenmile reports and analyses** checkbox. The queued `published-study.import` action accepts `include_installed_context: true`. An API caller that omits the field keeps its existing source-only import behavior. Repeated `--context-manifest PATH` arguments allow an explicit subset.

Composition follows the installed chlorophyll cohort, illustrated observation report, paired analysis and microcystin report reconciliation manifests. It also follows the two maintained standalone flow manifests and the earlier WQP observation manifest when installed. Every referenced body and companion retains its original bytes, SHA256 and native source ID. Identical overlaps are reused; differing overlaps are reported before any study version is created. All retained paths resolve within the original study directory. The record retains each included manifest identity and source inventory, and the Sources and methods tab and exported report list the included context.

The new `eighteenmile_lake_microcystin_reconciliation.sources.json` preserves the separate inferred Table 8 candidate cohort: 73 selected original rows and 12 exclusions from the 85-row campaign. Its five native entries retain the report, selected/excluded tables, decimal-precision comparison, original date/clock comparisons, executable calculation and all original inputs. The broader campaign remains the original observed support in the existing comparison table. The candidate cohort and its inference are available through their own retained report and downloads.

The complete study ZIP retains this composed source version for re-import. A selected report ZIP retains every original linked report and its declared companions under their original relative tree. Existing native source registration, queued actions, authentication, report sandbox and portable-project behavior remain part of the receiving host.

### Cold installation of the entire Published Studies family

A receiver whose application does not already contain this extension should obtain the complete source at the delivery commit. `published_studies_family.json` enumerates the exact family files and hashes for this revision. Its paths are relative to `opportunities/upstate_forever_2026`; the inventory itself is additional. The original current62 bank remains a separately versioned data edition and can be imported directly after installation.

The complete authored code family consists of:

| Component | Required paths |
| --- | --- |
| Study and original concentration model | `measurement_workspace/published_studies.py`, `measurement_workspace/observation_support.py`, `measurement_workspace/OBSERVATION_SUPPORT.md` |
| Native operator | `operator/published_study_operator.py`, `operator/extensions/published-studies.json` |
| Native browser | `operator/web/published_studies.mjs`, `operator/web/published_studies.css` |
| Install, receive, original page rendering | `install_published_studies.py`, `receive_published_studies.py`, `tools/attach_published_report.py` |
| Guide and complete inventory | `PUBLISHED_STUDIES.md`, `published_studies_family.json` |

The source tree also includes all original study root files, the earlier WQP report family, the reconciled cohort, standalone observed-flow family, paired analysis, Table 8 reconciliation, concentration-support result and the four application-root source manifests. The installer traverses their native manifests and copies the complete referenced closure. It creates the measurement package initializer when missing and extends the receiver’s current portable application inventory while preserving its other entries. Existing source conflicts are checked before installing code. Run the maintained installer from that complete source tree:

```sh
python "$PUBLISHED_STUDY_SOURCE/install_published_studies.py" --application "$ACTUAL_APP"
```

The receiving ECSA host must provide its current Workspace, extension registry, native queue, authenticated file tickets and extension file routes. A complete application checkout supplies those shared components. After installation, import the current bank with `--with-installed-context`, open its returned study/version in Published studies, produce `selected-study-report.zip` and a complete-study ZIP, then re-import that complete ZIP and use the original project archive/reopen workflow.

## Stream observations and scientific analysis (1.5.1)

The independent stream builtin `scdes-eighteenmile-streams-2020-2025` retains all 589 original results and their 153 activity identities. It joins the installed six-entry stream nutrient/flow analysis with its unchanged original files. See [STREAM_OBSERVATIONS.md](measurement_workspace/STREAM_OBSERVATIONS.md) for the native import, full report, selection behavior, source conventions, and complete offline rebuild. The lake study continues to use its own original source edition and context manifests.

## Physical observations and sampling-flow reports (1.7.0)

The installed source context now includes the complete physical water-quality study and the six-year sampling-calendar/flow-coverage report. Native intake and the installer use the same `measurement_workspace/study_context.py` registry and exact source-byte validation. Each original application-root manifest remains unchanged inside the retained edition. Repeated declarations of the same original path must agree on both its byte count and SHA256.

| Native source family | Included with | Retained application root |
| --- | --- | --- |
| Nutrient and gauge-flow analysis, 2020–2025 | Stream cohort | `application-context/stream-nutrients/` |
| Sampling calendar and flow coverage, 2020–2025 | Stream cohort | `application-context/stream-nutrients/` |
| Paired sampling sensitivity, original 2023–2025 paired subset | Stream cohort | `application-context/stream-nutrients/` |
| Physical water quality and sampling context, 2023 | Lake or stream cohort | `application-context/physical-water-quality/` |

The original source manifests supply the report titles shown in the desk. Each report keeps its stated full source scope when the observations table is filtered. Adding the physical report does not replace the selected cohort's original activities or observation index. Its 51 activities, including 49 routine activities and two separately identified PFAS activities, remain the scope of that report.

Both the physical study and sampling-flow report require original sources outside their report directory. The physical report uses the retained 2023 daily gauge response from the stream analysis; sampling-flow coverage uses the original hydrology daily-flow table and the original network-location responses. The registry retains those files at their original application-relative locations beneath the roots above. Original relative report links, SVG resources, source-row references, and rebuild paths therefore survive report export and complete-study reopening.

The maintained stream builtin automatically includes its installed context. A received lake source edition can add the physical study with `--with-installed-context` or the native import checkbox, alongside its existing lake reports. An explicit subset may use the following argument on the same import command:

```sh
--context-manifest "$ACTUAL_APP/eighteenmile_physical_context.sources.json"
```

Original report HTML and every declared companion travel together in `selected-study-report.zip`. Extract the package, then open `study-report.html` or the original report within `original-sources/`. The original application-root source manifest is included beside the retained application tree. For example, the physical reconstruction entry point is:

```sh
node original-sources/application-context/physical-water-quality/observations/eighteenmile_2023/physical_context/build_study.mjs --output NEW_PHYSICAL_STUDY
```

The complete study ZIP preserves the same immutable source edition for native re-import. The current Workspace source registration and portable project archive retain these additional source families with the original collection/source identifiers and declared bytes.

## Study task continuity (1.7.1)

Queued imports and exports keep their task and operation identities when the desk closes. The visible task response belongs to the Workspace and mounted view that submitted it: late responses, refreshes and errors leave a remounted or different Workspace unchanged. Reopen the accepted task from the existing task list to inspect its retained result.

The [stream observations guide](measurement_workspace/STREAM_OBSERVATIONS.md#sampling-coverage-and-original-network-context) describes the original nutrient and sampling-coverage reports, their separate percentile methods, upstream/downstream source identities and complete export/reopen path. Original report titles, the physical study, all current source registrations and the complete scientific companion tree remain part of this edition.

## Paired sensitivity companion (1.8.1)

The original stream study now retains its complete paired-sampling sensitivity report through the same context registry. Its 116 comparisons and 148 selections preserve station/analyte cohorts, source-row membership, censored interval bounds and the original parent report. Open **Eighteenmile paired sampling sensitivity**, inspect an original selection, then use the existing report/complete-study exports. The complete rebuilding layout and both original source manifests reopen together. See the [stream guide](measurement_workspace/STREAM_OBSERVATIONS.md#paired-sampling-sensitivity-in-the-retained-study) for the exact source and offline command.
