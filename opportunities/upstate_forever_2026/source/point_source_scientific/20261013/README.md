# Eighteenmile point-source findings in the existing scientific delivery

Edition: ECHO-POINT-SOURCE-SCIENTIFIC-20261013-r1

## Product integration

The current application already provides the required document viewer. Open Original sources → Review retained reports, select this imported source, and choose either the historical explorer or reported-load/volume HTML. The original viewer retains member paths, sandboxed interactive controls, source inspection and a complete source-edition archive.

This component supplies the missing ordered scientific-report source. Its single primary document uses upstate.observed-report/v1, role OBSERVED_CONTEXT and metadata.report_schema. The current complete delivery's ordered study picker therefore recognizes it as an ordinary observed scientific report.

It contains seven scientific sections and two source-driven line figures:
- Original coverage, reporting identity and current geographic context.
- Five complete years of upstream phosphorus and suspended-solids totals.
- Exact common-month current phosphorus comparisons for four facilities.
- Original reported mass, volume and symmetric monthly load-intensity accounting.
- All eight original Milliken monthly phosphorus loads, volumes and published concentrations.
- Exact coverage, original source settings, units and interpretation.
- Working relative links to the two interactive reports, original tables, field guide and capture inventory.
- Native scientific figures preserve the five baseline points and all sixteen original monthly points.

The existing scientific renderer produces its ordinary HTML/PDF and vector figures. It retains both original interactive documents, all source pointers and source tables in the delivered archive.

## Receiving and ordinary use

Overlay this additive component after the complete 170-file original source cohort, historyr2 and fourteen-file load/volume component. The scientific input manifest pins all 183 existing original data/report companions. It reuses those retained bytes; the existing Workspace object store deduplicates identical source bodies.

Replay the complete source producer:

    node source_tools/point_source_scientific_report_cli.mjs --root /absolute/current/application

Import its single scientific report:

    python -B source_tools/import_point_source_report.py --project-root /absolute/current/application --workspace /absolute/existing/workspace

The importer returns the actual source_collection_id/source_id. In the current complete delivery, select the original baseline and add this report in the existing ordered study selector. The existing source import action accepts point_source_scientific.sources.json as well.

To join an explicit existing delivery selection using the native importer, supply its --selection and --selection-output options. All previously ordered studies remain first; the importer appends this original report once and binds the resulting choice through model.observed_context before saving the new selection.

## Standalone source-only scientific rendering

The existing maintained renderer can produce the complete scientific HTML/PDF and a source-bound archive from this one report manifest:

    python -B source/observed-report-20261013/render.py --app-root /absolute/current/application --workspace /absolute/existing/workspace --manifest /absolute/current/application/point_source_scientific.sources.json --output /absolute/report-directory

Its optional --archive /absolute/archive-outside-workspace.zip and --receive-directory /absolute/independent-directory arguments exercise the same retained Workspace transfer and reopen route. This uses the original scientific report consumer and its current renderer. The supplied manifest has exactly one typed observed-report entry, as required by that native command.

## Source closure and native contracts

Primary recipe: source/point_source_scientific/20261013/report-source.json.
Root manifest: point_source_scientific.sources.json.
Native source ID: eighteenmile-point-source-scientific-report.

Every source link is an exact project-relative companion path. All original EPA responses, normalized tables, current routing sources, complete historical and load/volume analyses, and both offline reports remain original retained members. The recipe's inputs pin the two computed original analyses. Original members and both SVG figures are independently declared by byte count and SHA256 in the native manifest.

The consumer is model/observed_context.py observed-context-20261013-v4. It verifies native body/companions, rewrites working relative links into each delivered report's own namespace, and renders scientific figures from their original numeric specification. The importer preserves the existing observed_context_sources ordering and primary OBSERVED_CONTEXT choice.

The existing report viewer is operator/source_reports.py and operator/web/source_reports.mjs. This component adds its scientific source through that maintained workflow.

## Interpretation

The five-year TP values are 2021: 985.58; 2022: 929.25; 2023: 949.71; 2024: 520.70; and 2025: 955.70 kg. The 2024→2025 +83.54% comparison begins with the low year in that window.

Current upstream January–August TP rises 655.73→948.33 kg. Milliken rises 332.35 kg while Upper and Middle decline. Milliken's corresponding published volume falls 290.28→241.31 million US gallons. Paired-month volume and intensity components sum exactly to the original load change.

Original reporting-feature identities, total nitrogen/ammonia/nitrate species, annual versus same-month support and current downstream Pendleton comparison remain separate. The recipe preserves original quantitative values and units. Operational cause attribution requires its own process evidence.
