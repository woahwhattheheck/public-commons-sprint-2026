# Observed-science report component

This component adds actual measured lake response, observed flows and routed discharge quantities to the current native scientific report. The application keeps its existing economics, land-cover scenario results and map atlas.

Maintained by TokenJunkieLabs. Code follows the repository MIT license. Scientific interpretation: **Needs expert review**.

## Install in the current application

Use the maintained application with the original observation sources merged in [PR3046](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3046) and receiving workflow merged in [PR2920](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2920), containing `model/workspace.py`, the merged scientific/client delivery, its current `model/scientific_report.py`, `model/scientific_figures.py`, `model/observed_context.py`, and the complete current `measurement_workspace` family. The original source Canvas below records an earlier author edition. Current repository modules include the subsequent native-source binding, self-contained HTML figures and restored-project navigation. The merged PR3111 collector v4 supports both the regional source namespace and the separately retained original study. Then run:

```sh
python -B source/observed-report-20261013/install.py --workspace /mnt/data/gis12/original-workspace
```

The command compiles the maintained collector and figure modules and recognizes the current ordered-report picker by its import, mount, selection and serialization hooks. It preserves that installed picker and verifies its module/static registration. On an earlier single-report application it applies the three original delivery-form anchors, retaining the previous app body. It uses node --check where Node is available and imports the source document through Workspace.import_sources. The native import verifies every selected body and companion and reuses its content-addressed collection on an unchanged retry. It prints the actual source_collection_id and source_id. The legacy optional delivery selection is source_roles.OBSERVED_CONTEXT. The delivery form lists original report documents by metadata.report_schema and can include several selected report editions. Clearing all observed report choices removes this optional context. The complete multiple-source contract is described below.

The application-root observed_hydrology_context.sources.json registers observed_hydrology_context.report.json as the retained source document. Its canonical companions keep the original study under observations/eighteenmile_2023, regional hydrology under observations/observed_hydrology_20261013, and the interactive daily-flow explorer under observations/calibration_context_20261013. The recipe preserves the five original scientific sections and four figures and adds the regional source explorer. The retained source is bound before delivery identity. collect returns the same binding, source assets and native report sections. Current delivery includes those assets in the same portable project archive. The installer accepts --manifest for a separately retained source edition; the default resolves against --application, independent of the command's working directory.

## Scientific contents

The 75 selected CHLA records retain all original activity identifiers, project, depth, date, displayed local clock and timezone labels. The complete 920-result study edition includes the original 676 numeric, 240 below-threshold and four above-threshold result classifications. Five-site distributions include observed minimum/maximum, R-7 quartiles, median, mean and sample SD.

The six-year gauge component was executed from six original agency daily-mean responses: 2,192 records, six complete calendar years, 72 complete months and the actual 196-day study window. The program uses original decimal sums and preserves agency flags. The original inventories and stream-network reference are retained with the gauge edition.

The monthly discharge companion was executed from 230 original reporting periods, four source routes and all 365 approved gauge days. It preserves actual reporting-period overlap and selected source identifiers. The three upstream volume and phosphorus cohorts are complete in every month. Species-specific nitrogen coverage remains explicit.

PDF output uses ReportLab vector Drawings from the exact figure specification (one 252-point-high drawing per panel). HTML carries the verified original D3 SVG bytes for standalone viewing; Markdown links to the same retained package SVGs. These are four scientific figures with 5, 1, 1 and 5 panels. The figure spec, original SVGs, offline D3 renderer and pinned licensed dependencies are included.

## Reproduce source calculations

```sh
node observations/eighteenmile_2023/figures/rebuild_figures.mjs observations/eighteenmile_2023 /tmp/eighteenmile-figure-rebuild
node observations/observed_hydrology_20261013/rebuild_hydrology.mjs --output-dir /tmp/upper-savannah-hydrology-rebuild
node observations/eighteenmile_2023/npdes/flow_context/rebuild_monthly_flow.mjs --output-dir /tmp/eighteenmile-monthly-flow-rebuild
```

The first command reproduces four SVGs and three supporting numerical files from the retained observations and pinned D3 modules. The second reproduces the full regional hydrology edition: 33,459 daily-discharge records at 16 gauges during 2020–2025 and the original annual, monthly and study-window summaries. The third reproduces the original dated monthly discharge/flow tables. All input SHA-256 identities are recorded in their existing indices. The recipe's inputs list binds every retained companion. Filtering the regional daily, annual, monthly and study-window CSVs to site02186702 exactly reproduces the original Eighteenmile subset bytes, so the five curated scientific sections retain their original numerical support.

## Native report execution

Run the existing paired-model delivery with the returned observed source role. Also render this observed context through the current report_pdf/write_companions APIs in the same native workspace to review original SVG links, vector panel pagination and source tables. The existing current-report successor carries the import and smoke-render guidance. Its source binding is preserved in report-data.

For a direct native rendering into a new retained output directory, run from the application root:

```sh
python -B source/observed-report-20261013/render.py \
  --app-root "$PWD" \
  --workspace /mnt/data/gis12/original-workspace \
  --manifest "$PWD/observed_hydrology_context.sources.json" \
  --output /mnt/data/gis12/observed-report-canonical-20261013
```

The command sets selection.observed_context_binding from the original source before collect. It writes the immutable selection, report.pdf, scientific HTML/Markdown/data companions, all retained source assets and operation.json through the maintained report APIs. On a completed retry, the same source and contact selection must match the retained selection; use a distinct output directory for a changed edition. A single report uses its actual registered source title consistently across formats. Multiple reports use an explicit --title or an ordered combination of their registered titles. The resulting report's source links open the interactive explorer and original canonical data after export because all relative member paths are preserved.

### Several original reports in one scientific document

Repeat `--manifest` in the order the original reports should appear. Each manifest must identify exactly one document with `metadata.report_schema = upstate.observed-report/v1`. Each report retains its own original source collection, recipe, figures, input hashes and concentration-study namespace. The renderer appends the report sections in selection order through the same maintained collector and PDF/HTML/Markdown formatter.

After the stream-report provider is installed, this command combines its retained recipe with the regional context:

```sh
python -B source/observed-report-20261013/render.py \
  --app-root "$PWD" \
  --workspace /mnt/data/gis12/original-workspace \
  --manifest "$PWD/observed_hydrology_context.sources.json" \
  --manifest "$PWD/eighteenmile_stream_observed_report.sources.json" \
  --title "Upper Savannah observed science and Eighteenmile stream context" \
  --output /mnt/data/gis12/observed-report-regional-stream-20261013
```

The stream source is supplied by its maintained source provider; select its actual installed manifest. Add another retained microbial or station report by repeating `--manifest` with that provider's manifest. An explicit manifest list replaces the default: the regional context is automatically selected only when no `--manifest` is given. An identical selected collection/source pair repeated in the command is rejected.

Composition preserves each recipe's quantities and scope. Reports may discuss some of the same original monitoring records. Their sample counts, series and summaries stay attached to their individual source contexts; composition does not add counts across reports, create an enlarged statistical sample or recompute native catchment exports. Select the report editions needed for the intended document and inspect their retained source descriptions.

### Preview exact imported source selections

Use `--preview` with the same manifests, title and contact options before rendering:

```sh
python -B source/observed-report-20261013/render.py \
  --app-root "$PWD" \
  --workspace /mnt/data/gis12/original-workspace \
  --manifest "$PWD/observed_hydrology_context.sources.json" \
  --manifest "$PWD/eighteenmile_stream_observed_report.sources.json" \
  --title "Upper Savannah observed science and Eighteenmile stream context" \
  --preview
```

Preview imports and verifies the original sources in the selected Workspace. It returns their absolute input manifest paths, actual source collection/source IDs, titles, body hashes, complete bound member identities and ordered selection. It does not write report output. `--output` is optional for preview and required for rendering. When supplied during preview, it is reported as the intended output directory. Using the same source editions, title and contact produces the same proposed operation identity.

For a normal delivery selection, the additive field is an ordered list of full original source selectors:

```json
{
  "source_roles": {
    "OBSERVED_CONTEXT": {
      "source_collection_id": "FIRST_ACTUAL_COLLECTION_ID",
      "source_id": "FIRST_ACTUAL_REPORT_SOURCE_ID"
    }
  },
  "observed_context_sources": [
    {
      "source_collection_id": "FIRST_ACTUAL_COLLECTION_ID",
      "source_id": "FIRST_ACTUAL_REPORT_SOURCE_ID"
    },
    {
      "source_collection_id": "SECOND_ACTUAL_COLLECTION_ID",
      "source_id": "SECOND_ACTUAL_REPORT_SOURCE_ID"
    }
  ]
}
```

Use the actual IDs returned by preview. If `observed_context_sources` is present, it defines **all** selected observed reports in order; the legacy role is not an additional report. The first selector remains in the legacy role for compatible readers. With one report, the CLI preserves the existing single-role selection without adding the list. With no list, existing delivery selections continue using their original single role. The native collector binds the selected report editions before delivery identity is created and verifies that same binding when collecting their assets.

### Outputs and continuation

The standalone command writes `report.pdf`, the maintained scientific HTML/Markdown/data companions, all selected original source assets, the immutable `selection.json`, and `operation.json`. The operation contains `sources` in selection order, `source_count`, actual section/figure counts and complete file descriptors. The existing top-level `source_collection_id` and `source_id` refer to the first report for compatible readers; the full ordered source list and binding describe the complete document.

The first default single-report invocation keeps the historical identity shape. An explicit title is included in the identity, as is the composed title for multiple reports. Source editions, order, report title, formatter version and contact are retained choices: use a distinct output directory after changing them. A retry against the same directory must match its immutable selection. Existing imported source collections are reused through the ordinary Workspace importer.

A receiving worker can use `--create-workspace` with its own new Workspace and output directories, then import the same original manifests. The report does not launch NDR or SDR. A complete native delivery retains these report assets in its existing working-project archive; the standalone command returns its output directory and file descriptors.

### Original Eighteenmile study edition

The separately retained [PR3046](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3046) edition uses `observations/eighteenmile_2023/report_context/model-sources.json` as its report-document manifest. Its companion `original-study-model-sources.json` preserves the original 17-entry study catalog; the recipe references that exact companion. To render this specific original study edition, select it explicitly:

```sh
python -B source/observed-report-20261013/render.py \
  --app-root "$PWD" \
  --workspace /mnt/data/gis12/original-workspace \
  --manifest "$PWD/observations/eighteenmile_2023/report_context/model-sources.json" \
  --output /mnt/data/gis12/observed-report-eighteenmile-20261013
```

The installer also accepts `--manifest observations/eighteenmile_2023/report_context/model-sources.json` to register that edition in the existing delivery picker.

### Another native worker

The renderer defaults to `observed_hydrology_context.sources.json` beneath `--app-root`, matching the installer's regional context. An explicit renderer `--manifest` path resolves from the current working directory. Add `--create-workspace` with the worker's own fresh `--workspace` and `--output` paths to run the same retained source on another Linux worker. Existing workspaces remain selected when this option is omitted. The output operation records the actual collection and source IDs, report section and figure counts, and file descriptors.

Related maintained source:
- Maintained scientific report: [model/scientific_report.py](../../model/scientific_report.py)
- Maintained complete delivery and receiving guide: [model/CLIENT_REPORT.md](../../model/CLIENT_REPORT.md)
- Observed-data desk and native intake: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QM61KRQ
- Complete 62-file study source and offline figures: https://chatgpt.com/space/page_fb63164ad5208191b42417dd980ffb6a
- Original observed hydrology and monthly discharge companion: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QAH0AQ2

The module source was inspected here and the picker was parsed against the actual current app. The native receiver compiles and renders the installed Python code in the same maintained workspace.


## Complete report archive and independent reopening

The same renderer can finish a completed observed report as a complete editable
Workspace archive. Keep the original manifest order, contact, title, Workspace
and output directory, then add the archive and receiving paths:

```sh
python -B source/observed-report-20261013/render.py \
  --app-root "$APPLICATION" \
  --workspace "$WORKSPACE" \
  --manifest "$APPLICATION/observations/eighteenmile_2023/report_context/model-sources.json" \
  --output "$REPORT_OUTPUT" \
  --archive "$OPERATION/observed-science-complete.zip" \
  --receive-directory "$OPERATION/observed-science-received"
```

For a report already completed with an earlier application edition, keep its original
`--app-root` and formatter version while invoking this updated renderer script.
The immutable selection includes `scientific_report.REPORT_VERSION`; switching to
a newer application requires a separate output edition. This permits an existing
31d report to complete archive receiving without regenerating its PDF.

For a new observed-source Workspace, add `--create-workspace`. For a composed
report, repeat every original `--manifest` in its saved order and retain the same
explicit title and contact options. Preview remains a source-selection operation;
archive receiving requires the completed report.

The renderer first verifies the saved `selection.json`, completed
`operation.json` and every declared report/source asset. A completed report is
reused byte for byte, including its PDF, HTML, Markdown, report data and original
source companions. Its scientific calculations and rendering are not repeated
during packaging.

The complete report files, original operation and selected source binding are
retained under `observed-reports/<capture-id>` in the existing Workspace.
The maintained `Workspace.backup` captures that report with the full original
Workspace and application. Archive inspection verifies every declared member and
matches the exact captured report. This uses the observed report's own identity;
it does not create a modeled-delivery record.

`--receive-directory` calls the ordinary native restore into an independent
directory. It reopens the original Workspace, verifies the same project,
source selections, report operation and every report asset, and returns the
actual received report paths. Open the returned `receiving.received.files`
HTML/PDF members in the existing browser/native reader. The received Markdown
and source links retain their relative layout.

Both archive and receiving paths must be outside the original Workspace,
application and report directory. Keep the archive outside its receiving
directory. A repeat verifies and reuses the same archive. If a process stops
after native restoration publishes its destination, a repeated invocation
reconciles every original archive member before completing that same receive.

The archive receipt is saved beside the ZIP as
`<archive-name>.observed-report.json`; the restored directory retains
`observed-report-receiving.json`. These record the original operation,
archive identity and actual report paths. The original report's
`operation.json` remains unchanged. Packaging without
`--receive-directory` can be followed later by the same command with that
option to complete independent reopening.
