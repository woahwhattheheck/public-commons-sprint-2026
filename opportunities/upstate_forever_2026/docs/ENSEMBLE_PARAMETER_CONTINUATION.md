# Continue original Ensemble runs as Parameter studies

Open **Scenario sensitivity**, open a saved ensemble, then choose **Parameter results by scenario**. The preview lists every original land-cover scenario, its original reference profile and the number of retained parameter cases. After all original native runs complete, **Prepare scenario parameter studies** queues the existing aggregation and reporting workflow.

For each original base-profile group and selected scenario, the continuation holds that land cover fixed and compares its original parameter profiles. The original ensemble remains available for land-cover contrasts. Parameter changes are case minus the original reference profile; each result retains its own paired valid support. Nitrogen and phosphorus annual mass and sediment annual mass retain their original model units and source descriptors.

## What the saved continuation contains

The saved Parameter studies bind every generated case to its exact original completed native run, profile, model selection, scenario and grid. Their immutable selections retain the original ensemble identity, complete original axis references, member assignments and native selection bodies. The original saved ensemble plan is independently copied into each study's original export members. Summaries, difference rasters, charts and scientific report sources use the maintained Parameter engines.

The bridge accepts a coherent original factorial or one-at-a-time scalar design. Every expected profile must match exactly one original member, including its coefficient table hash and original source identifiers. It preserves separate original base-profile groups. A design with missing, duplicated or unmatched cases requires its existing ensemble reporting workflow; the bridge does not substitute profiles.

The completed task opens each scenario's Parameter study and its scientific report composer. Within the study, use the saved result filters, case console, source selection and exports normally. The report includes original selected rows, coordinate tables, figure specifications, SVGs and source companions. Completed task links are recreated from the saved operation when the operator restarts.

## Original native receiving

From the actual application root in its equipped GIS environment:

```sh
python -B -m model.ensemble_parameter_studies --workspace ACTUAL_WORKSPACE --ensemble-id ORIGINAL_ENSEMBLE_ID --preview
python -B -m model.ensemble_parameter_studies --workspace ACTUAL_WORKSPACE --ensemble-id ORIGINAL_ENSEMBLE_ID
```

The second command prepares all original scenario studies, aggregates completed raster outputs and prepares their scientific report sources. It invokes no native InVEST solve and creates no new native profile or run. Use `--difference-maps` to retain the original pairwise difference rasters, or `--no-report` to prepare the native Parameter results and exports before choosing report sources individually. Optional `--selection selection.json` accepts `scenario_ids`, `reporting_areas`, `difference_maps`, `render_reports`, `title` and `purpose`; the required CLI ensemble ID binds that request.

SAME5156's completed simulated headwaters Ensemble `8cb02b0fe3b6a96782525e8aa5607621dd0a456719c6651ce07a675d9cae1ff4` contains four original profiles across three original scenarios. Its coherent routing/L-factor design continues as three four-case Parameter studies. Its 30 m, 1,296 ha square and simulated inputs remain that original demonstration geography. Actual Upper Savannah geographic modeling uses its own regional source and native operation.

## Resuming, sharing and reopening

Repeat the identical selection to reopen the same continuation. Each study ID is saved before its aggregation, and original complete result artifacts and report sources reopen without repeating finished work. An interrupted summary resumes through the existing Parameter summary checkpoints. A report failure leaves the completed native study available and the continuation partial for the same request.

The operation lives under `ensemble-parameter-studies/<operation-id>`; each ordinary Parameter study remains under `experiments/<study-id>`. Whole-Workspace export acquires the continuation lock before study/run locks and retains every original selection, copied source plan, completed output and report companion. The receiver opens the original ensemble and its saved continuation normally. Each study's own ZIP retains the original ensemble plan and its complete case-to-native-run provenance.

## API contracts

The existing queued action is `parameter-study.ensemble.continue`; payload fields match the selection above with `ensemble_id` required. The result contains the immutable continuation `id`, `ensemble_id`, `selection`, `state` and `studies[]`. Each study provides `experiment_id`, `scenario_id`, `scenario_title`, `base_profile_id`, current state/progress and its original source operation when prepared.

`GET /api/parameter-studies/ensemble-studies?workspace=WORKSPACE_KEY&id=ENSEMBLE_ID` returns the exact design preview and latest saved continuation. `model.ensemble_parameter_studies.preview`, `continue_studies`, `get` and `latest` expose the same retained workflow to original native callers. `parameter_studies.prepare_retained` is the lower-level source-bound adoption seam; it requires a complete exact case/run mapping and original source descriptors.

## Receiving the product

Use the completed original run owner and Workspace. Preview the three scenario studies, prepare them, then actually open the result tables, original annual-mass/change figures, maps when selected, HTML/PDF and ZIP members. Export and cold reopen the same Workspace; open the ensemble continuation and each saved report again. Record actual commands, run IDs and observed failures. The source/controller checks used during authoring do not substitute for that populated native/browser receiving.
