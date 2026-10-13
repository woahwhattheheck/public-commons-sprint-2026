# Eighteenmile observed-science report component

This component adds actual measured lake response, observed flows and routed discharge quantities to the current native scientific report. The application keeps its existing economics, land-cover scenario results and map atlas.

Maintained by TokenJunkieLabs. Code follows the repository MIT license. Scientific interpretation: **Needs expert review**.

## Install in the current application

Use the current maintained application containing `model/workspace.py`, the merged scientific/client delivery, its current `model/scientific_report.py`, `model/scientific_figures.py`, `model/observed_context.py`, and the complete current `measurement_workspace` family. The original source Canvas below records an earlier author edition. Current repository modules include the subsequent native-source binding, self-contained HTML figures and restored-project navigation. The merged PR3111 collector v4 supports both the regional source namespace and the separately retained original study. Then run:

```sh
python -B source/observed-report-20261013/install.py --workspace /mnt/data/gis12/original-workspace
```

The command compiles the two new modules, applies three unique delivery-form anchors, retains the previous app body, uses node --check where Node is available, and imports the source document through Workspace.import_sources. The native import verifies every selected body and companion and reuses its content-addressed collection on an unchanged retry. It prints the actual source_collection_id and source_id. The optional delivery selection is source_roles.OBSERVED_CONTEXT. The form lists this source by metadata.report_schema and explicitly clears the selection when its blank option is chosen.

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

The command sets selection.observed_context_binding from the original source before collect. It writes the immutable selection, report.pdf, scientific HTML/Markdown/data companions, all retained source assets and operation.json through the maintained report APIs. On a completed retry, the same source and contact selection must match the retained selection; use a distinct output directory for a changed edition. The actual registered source title is used consistently across report formats. The resulting report's source links open the interactive explorer and original canonical data after export because all relative member paths are preserved.

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
- Original scientific report source edition: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JLRMKAP
- Maintained report application: https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/opportunities/upstate_forever_2026
- Observed-data desk and native intake: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QM61KRQ
- Complete 62-file study source and offline figures: https://chatgpt.com/space/page_fb63164ad5208191b42417dd980ffb6a
- Original observed hydrology and monthly discharge companion: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QAH0AQ2

The module source was inspected here and the picker was parsed against the actual current app. The native receiver compiles and renders the installed Python code in the same maintained workspace.
