# Eighteenmile observed-science report component

This component adds actual measured lake response, observed flows and routed discharge quantities to the current native scientific report. The application keeps its existing economics, land-cover scenario results and map atlas.

## Install in the current application

Receive this source package into the maintained application directory containing model/workspace.py. Install the current report successor from https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JLRMKAP, which composes scientific_report.py and delivery.py from the merged current v6 source. Then run:

```sh
python -B source/observed-report-20261013/install.py --workspace /mnt/data/gis12/original-workspace
```

The command compiles the two new modules, applies three unique delivery-form anchors, retains the previous app body, uses node --check where Node is available, and imports the source document through Workspace.import_sources. It prints the actual source_collection_id and source_id. The optional delivery selection is source_roles.OBSERVED_CONTEXT. The form lists this source by metadata.report_schema and explicitly clears the selection when its blank option is chosen.

The source directory is observations/eighteenmile_2023/report_context. Its scientific-context.json has five substantive sections and four actual figures. The retained source is bound before delivery identity. collect returns the same binding, source assets and native report sections. The current successor includes those assets in the same portable project archive.

## Scientific contents

The 75 selected CHLA records retain all original activity identifiers, project, depth, date, displayed local clock and timezone labels. The complete 920-result study edition includes the original 676 numeric, 240 below-threshold and four above-threshold result classifications. Five-site distributions include observed minimum/maximum, R-7 quartiles, median, mean and sample SD.

The six-year gauge component was executed from six original agency daily-mean responses: 2,192 records, six complete calendar years, 72 complete months and the actual 196-day study window. The program uses original decimal sums and preserves agency flags. The original inventories and stream-network reference are retained with the gauge edition.

The monthly discharge companion was executed from 230 original reporting periods, four source routes and all 365 approved gauge days. It preserves actual reporting-period overlap and selected source identifiers. The three upstream volume and phosphorus cohorts are complete in every month. Species-specific nitrogen coverage remains explicit.

PDF output uses ReportLab vector Drawings from the exact figure specification (one 252-point-high drawing per panel). HTML and Markdown use the original D3 SVGs. These are four scientific figures with 5, 1, 1 and 5 panels. The figure spec, original SVGs, offline D3 renderer and pinned licensed dependencies are included.

## Reproduce source calculations

```sh
node observations/eighteenmile_2023/report_context/figures/rebuild_figures.mjs observations/eighteenmile_2023/report_context /tmp/eighteenmile-figure-rebuild
node observations/eighteenmile_2023/report_context/hydrology/rebuild_hydrology.mjs --output-dir /tmp/eighteenmile-hydrology-rebuild
```

The first command reproduces four SVGs and three supporting numerical files from the retained observations and pinned D3 modules. The included monthly-flow README carries its exact rebuild command; use the same script beneath this report_context directory. All input SHA-256 identities are recorded in their existing indices. The report recipe's inputs list binds every retained companion.

## Native report execution

Run the existing paired-model delivery with the returned observed source role. Also render this observed context through the current report_pdf/write_companions APIs in the same native workspace to review original SVG links, vector panel pagination and source tables. The existing current-report successor carries the import and smoke-render guidance. Its source binding is preserved in report-data.

Related maintained source:
- Current scientific report successor: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JLRMKAP
- Observed-data desk and native intake: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QM61KRQ
- Complete 62-file study source and offline figures: https://chatgpt.com/space/page_fb63164ad5208191b42417dd980ffb6a
- Original observed hydrology and monthly discharge companion: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QAH0AQ2

The module source was inspected here and the picker was parsed against the actual current app. The native receiver compiles and renders the installed Python code in the same maintained workspace.
