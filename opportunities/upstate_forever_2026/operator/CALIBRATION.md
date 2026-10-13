# Calibration and validation in the Upper Savannah operator

This extension adds a complete observation-based parameter selection workflow to the existing scientific operator. It compares completed baseline native runs with the retained annual-load observations and original upstream catchments. The interface retains a spatial calibration/validation split, presents the scientific results, and creates a portable comparison package.

The native scientific implementation lives in `model/calibration.py`. Its complete methods, selection schema and command-line reference are in `model/CALIBRATION.md`. The operator presents those records and scores directly. It uses the application's existing task queue, source inspection, original-file downloads, workspace selector, and backup/restore operations.

## Receive one complete application

The calibration cohort contains nine paths:

- `model/calibration.py`
- `model/CALIBRATION.md`
- `operator/calibration.py`
- `operator/web/calibration.mjs`
- `operator/web/calibration.css`
- `operator/extensions/calibration.json`
- `operator/CALIBRATION.md`
- `operator/install_calibration.py`
- `source_tools/calibration_assembly.py`

The original model and scientific guide are the model carrier; the other seven files form the operator carrier. Retain the complete current application, including its native InVEST environment, original observations and source readers. The maintained extension package supplies `operator/extension_registry.py`, `operator/web/extension_host.mjs`, and `install_extensions.py`. Its source-preparation, native-run and other descriptors remain alongside calibration.

### Assemble the complete receiving edition

Use `source_tools/calibration_assembly.py` with the retained current `source_tools/application_assembly.py`. The driver delegates carrier decoding, file identities, ordered composition, directory receiving and ZIP creation to that existing assembler. It normalizes the explicit source file envelopes used by the calibration, terrain, transfer and original-USGS components, then registers the maintained extension host before the final source map and application receipt are written.

First decode the complete operator carrier into a source directory. Run that received driver's actual local path. The model, operator and other `--overlay` arguments select complete retained source-carrier files; these may be original JSON, a saved complete Markdown carrier, or a format handled by the selected current assembler.

Substitute the actual retained paths:

```bash
python -B /path/to/calibration-source/source_tools/calibration_assembly.py \
  /path/to/complete-application-source-map.json \
  --assembler /path/to/current/application/source_tools/application_assembly.py \
  --current /path/to/current/application \
  --extension-installer /path/to/current/application/install_extensions.py \
  --overlay /path/to/terrain-source-carrier.md \
  --overlay /path/to/terrain-transfer-carrier.md \
  --overlay /path/to/original-usgs-contract-carrier.md \
  --model /path/to/calibration-model-carrier.md \
  --operator /path/to/calibration-operator-carrier.md \
  --edition upper-savannah-calibration \
  --output /path/to/new/complete-calibration-application \
  --source-map /path/to/output/complete-calibration-source.json.gz \
  --zip /path/to/output/complete-calibration-application.zip
```

The selected input order is: complete source-map base; current local application source when `--current` is supplied; explicitly selected overlays in their command-line order; model calibration; operator calibration; and the in-memory registration result. A selected overlay is a full-file source edition. Unmentioned current modules remain in the application, including map, programme, scenario, community and customer-review work. These additive terrain/transfer/USGS/calibration carriers leave the current `model/rasters.py` source in place.

The `--current` path uses the maintained assembler's `snapshot_application(root)` API, available in its installed-directory receiving edition. This retains root source files such as `install_extensions.py` and additional application modules in `model/`, `operator/`, `source_tools/`, and `source/`. Binary source members keep the assembler's original external-file records. It validates the selected current file inventory and bytes again immediately before publishing. The original assembler continues to enforce declared predecessor hashes, duplicate-path rules, file identities and immutable receiving behavior. A changed current application causes preparation to return the specific path; rerun with the newly retained complete source.

The receiving directory is a fresh application edition. Use its existing launch command to reopen the same scientific workspace. A repeat receive reuses an identical directory or output file. The final map, directory receipt and ZIP all describe the already registered source. The driver does not modify an earlier immutable source receipt after publication.

Use `--inspect` to prepare that exact composition and display its source inventory, registration and local dependency diagnostics. The `--expect INDEX:SHA256` option pins an original decoded carrier payload: the base is index 0, then overlays in order, then the model and operator carriers. `--source-map` accepts an uncompressed JSON path or a `.gz` path. The assembly result records the actual selected assembler hash and maintained registry dependency hashes.

### Register into an existing editable application

For a retained application whose source is still being edited, use the standalone calibration installer. Install the maintained extension package sources first, then supply this complete calibration cohort:

```bash
python -B /path/to/calibration-source/operator/install_calibration.py \
  --application /path/to/current/application \
  --source /path/to/calibration-source
```

The installer copies the nine extension paths and calls the current application's exact `install_extensions.patch_server` and `patch_app` functions. The descriptor owns calibration's backend, queued actions, authenticated reads, workspace state, downloads, browser navigation, styles and lifecycle. Existing authored navigation and styles remain compatible with the host. No additional calibration-specific shared-file dispatcher is installed.

An application that received the earlier direct calibration edition is migrated by removing only that edition's known calibration registrations before applying the maintained generic hooks. Source and task labels already authored in the original browser remain available. Exact published predecessor hashes also allow the earlier model and registry source cohorts to advance before a local install manifest exists. An independently modified calibration source or join is identified for composition in the actual current source.

The installer prepares the source in memory, checks Python syntax, retains original preimages, and checks current bytes again before replacement. A repeat installation reuses identical files. Extension updates accept the previous installed hashes or the exact published calibration source predecessors. An independently edited extension remains available until its exact source is composed with the selected successor. The `--preview` option displays the same prepared paths and hashes.

Restart the retained operator and open its authenticated browser URL. `GET /api/extensions` includes calibration; **Calibration and validation** appears in the existing navigation. The browser host preserves the selected form through task-only state updates and routes calibration actions through the original application worker.


## Prepare the original scientific inputs

The workspace needs completed native baseline runs and an admitted annual-load observation edition. Each candidate group contains runs from the same original grid and unchanged land-cover baseline. The candidate table shows each run's actual NDR/SDR models and available pollutants alongside its retained parameter profile. A profile may have separately completed partial and combined runs; each retains its original native run identity. Select the original catchment polygon source and ID field used by the observations.

The native catalog exposes compatible runs and the retained observations. A useful selection needs comparable observed annual loads for at least one of nitrogen, phosphorus or sediment. Native nitrogen and phosphorus loads retain kilograms per year; sediment retains metric tonnes per year. The original observation pipeline retains accepted rows, contextual rows, qualifiers, source references and units.

The source edition and catchments must belong to the same scientific workspace. The calibration inspector reads the actual polygon layer. It connects overlapping upstream catchments and repeated station identifiers into whole spatial groups, then retains the source geometry and native references used to derive those groups.

## Select profiles and annual observations

The objective controls follow the original annual observations and the pollutants shared by the selected completed runs. Unsupported pollutants have zero weight. An NDR-only comparison can therefore calibrate nitrogen and phosphorus while an original mixed observation edition keeps its sediment rows and native exclusions. When an output becomes available again, the form restores the weight entered for it. The saved objective remains explicit.

1. Open **Calibration and validation** and choose **New calibration**.
2. Give the selection a study title. Choose the retained grid and baseline, then check the completed candidate runs. Inspect the actual model outputs beside each profile; NDR-only, SDR-only and combined runs stay distinguishable.
3. Choose the original annual-load observation edition. **Inspect original observations** opens its original records and downloads.
4. Choose the catchment source edition and polygon source. Use **Inspect native source fields** to see the actual layer names, field types, feature count and first original features. Select the catchment ID field that matches the observations.
5. If needed, add exact field filters with their real data types. The optional observation record list selects actual retained record IDs, one per line.
6. Choose observation-period weighting. **Complete years** gives complete annual periods equal weight, including leap years. **Elapsed days** uses the original covered duration for documented annualized period rates. Keep this choice consistent with the original annual-estimation method.
7. Set the relative pollutant weights. A zero weight excludes that pollutant from parameter selection. Automatic normalization uses calibration observations only. A study-specific normalization scale must be positive and must include its source or rationale.
8. Choose **Inspect original catchments**. After the original source inspection completes, assign entire groups to calibration or validation. Keep at least one group for calibration. Giving two groups the same name merges them; merged groups must share the same role.
9. Choose **Save calibration selection**. The existing operator task queue retains an immutable calibration plan.

The form retains its draft for the selected workspace in the current browser session, including temporarily invalid entries. Changing source inputs invalidates the previous catchment preview, so the next save inspects the corresponding original source selection. Revising a saved plan creates a new immutable selection.

The advanced panel supports an explicit reference candidate for exact score ties and a delivered external annual load linked to an actual original observation record. Each delivered load requires its annual mass, units and original source reference. The native science module validates this additional contribution before using it with the diffuse-load prediction. Use the observation/source notes to retain reservoir, point-source and annual-period context.

## Analyze and inspect the results

Open a saved selection and choose **Analyze selection**. The single existing operator worker evaluates retained completed native runs. The science module reuses matching original observation comparisons, persists completed candidate work, and resumes from that progress after an interruption.

The analysis ranks eligible profiles using the saved calibration groups, pollutant weights and normalization. Group weighting keeps a repeated station or a dense cluster of related upstream catchments from silently becoming independent replicated evidence. Reserved validation groups assess the selected profile after selection. If the plan reserves no validation groups, the saved evaluation design is calibration only.

Open **Results** from the completed task or saved selection. The interface includes:

| View | What it shows |
| --- | --- |
| Profile ranking | Calibration objective, selected candidate, actual NDR/SDR outputs, completed native run links and retained candidate outcomes. |
| Physical fit | Per-pollutant calibration errors, physical units, catchment/group counts and normalized mean squared error. |
| Independent validation | Selected-profile performance on the reserved spatial groups. |
| Observed and modeled | Each selected-profile catchment/pollutant prediction beside its original annual reference, period and source record IDs. |
| Catchment groups | The retained calibration/validation assignments, original catchments, stations and admitted record counts. |
| Candidate envelope | Annual-load ranges across the calibration Pareto candidates, with original candidate-run counts, distinct-profile counts and expected profiles. |
| Group stability | Selection after leaving out each calibration group, including whether the chosen run and profile remain unchanged, using retained native predictions and normalization from the remaining calibration groups. |
| Exclusions | Original reference exclusions, incomplete native support and candidate-specific errors retained by the scientific analysis. |

The observed-versus-modeled charts keep pollutants separate and use their physical units. Filled circles show calibration catchments; outlined squares show validation catchments. The dashed line marks equality. Every chart point comes from the selected candidate's retained, included prediction rows.

Search, sort and page the result tables to find a profile, catchment, pollutant or source record. Every original row remains in the downloaded CSV and complete JSON records. The **Original complete analysis record** contains the full methods, source vintages, normalization, validation support and candidate outcomes.

A candidate requires the complete declared calibration support before it can enter the ranking. An analysis with no eligible candidate retains an explicit result and reports the native support problem in the operator task. Open the saved selection to inspect that retained result, address the source or native-run outcome, and rerun or revise the selection.

### Interpret the scientific comparisons

A lower normalized calibration objective identifies the selected retained profile. Physical RMSE, mean bias and other pollutant metrics describe its errors in the original annual mass units. Normalization is derived from the calibration references, or from the study-specific scale saved with its rationale.

A reserved spatial split separates parameter selection from the selected-profile validation report. It does not create a new observed time series or add independent years to an annual model. The original period assumptions remain attached to the records.

The candidate envelope describes the calibration Pareto set: candidates whose pollutant scores are not jointly dominated by another candidate. Its range reflects the retained candidate runs and their coverage. A single profile can have separate NDR, SDR or combined run variants, so the result shows both run counts and distinct-profile counts. The median and range retain the original candidate-run weighting recorded in the scientific report. Original run IDs remain available for every comparison.

Leaving one calibration group out evaluates the stability of the selection among the original completed candidates. It uses their retained predictions, with the held calibration group removed from that fold's normalization and selection. Separately reserved validation groups stay outside those folds.

## Export the complete comparison

Choose **Export complete results**. The existing queue produces `calibration-results.zip` in the selected scientific workspace. Open the completed task to download the ZIP or individual result files.

The archive contains:

- `index.html`: a standalone, printable report with every comparison table.
- `report.json`: the exact retained scientific analysis record.
- `selection.json`: the exact retained calibration plan.
- `ranking.csv`, `metrics.csv`, `validation.csv`, `observations.csv`, `groups.csv`, `envelope.csv`, `stability.csv`, and `exclusions.csv`: complete result rows, including extra native fields.
- `manifest.json`: the original workspace, selection and result identifiers, plus the size and SHA-256 of each report member.

Open `index.html` after extracting the archive. It uses local files and embedded monochrome styling. CSV string values that spreadsheet applications could interpret as formulas are exported as literal text. Numeric scientific results retain numeric values.

Exports live under `calibration-exports/<analysis-id>/`. The saved archive descriptor binds the completed ZIP to its exact bytes. Reopening or repeating the export verifies the retained files and reuses the completed package; an interrupted export can finish using the original records.

## Preserve and reopen the workspace

The native workspace archive already walks the retained scientific workspace and includes the original application source. The calibration collections therefore travel with the same archive:

- `calibration-plans/`
- `calibration-analysis/`
- `calibrations/`
- `calibration-exports/`

Use the existing **Create complete backup** and restore workflow. The original workspace identity, plan/result identifiers, completed comparison progress and exported files remain available after restoration. The extension registration lives in the backed-up application source, alongside the native scientific modules and other operator capabilities.

## Open a retained annual-source binding

The annual-source desk can open this existing form through the maintained extension host after its original Workspace import and state refresh:

```javascript
await extensions.openExtension('calibration', 'openForObservations', {
  observation_id: binding.observation_id,
  catchments: binding.catchments,
  temporal_weighting: binding.recommended_temporal_weighting,
  title: 'Annual-load calibration',
  workspace_key: state.workspace_key,
});
```

The optional `workspace_key` guards the selected operator workspace; it is the original operator key, not the internal project UUID. The method verifies that the actual observation edition is admitted in the current catalog and that the selected catchment source is a retained vector entry. The source desk refreshes the ordinary workspace state after its bind task completes, so that new source entry is available.

This opens the normal calibration form with the original observation and catchment identities. It preserves the workspace draft's selected native grid, baseline, candidate run IDs, objective weights, title, notes and catchment-group choices. A new observation edition clears record filters and delivered external loads tied to the preceding observation IDs. Catchment filters come from the new binding. The normal preview resolves the actual spatial groups before a plan is saved.

An explicit saved period-weighting choice remains the user's choice. Otherwise, the form initializes from the supplied binding's weighting or the selected observation metadata's `recommended_temporal_weighting`. Changing observations follows their actual recommendation until the user edits the period control. Saved plans and drafts from earlier editions keep their original weighting.

The binding remains in the workspace draft even if no completed native baseline candidate exists yet. After a baseline finishes, **New calibration** reopens that original observation and catchment selection. Newer form requests supersede earlier pending catalog reads, candidate checkboxes restore by original run ID, and a previous task response leaves a subsequently opened draft intact.

## Operator API

The descriptor registers these routes with the existing authenticated local operator and selected workspace. Its state contribution is `state.data.calibration`, containing `calibration_plans` and `calibrations`. The original `/api/item` route also accepts the registered kinds `calibration-plans` and `calibrations`.

| Method | Route | Selection |
| --- | --- | --- |
| GET | `/api/calibration/catalog?workspace=...` | Compatible completed run groups and admitted original observation editions. |
| POST | `/api/calibration/preview` | JSON body with `workspace` and native `selection`; reads original catchments and derives groups. |
| GET | `/api/calibration/plan?workspace=...&id=...` | Retained plan, persisted progress and original JSON download. |
| GET | `/api/calibration/report?workspace=...&id=...` | Complete scientific result, original plan, presentation rows and downloads. |
| POST | `/api/actions` | Existing task submission with `calibration.prepare`, `calibration.analyze`, or `calibration.export`. |

Queued action payloads are `{"selection": <native-selection>}`, `{"plan_id": <retained-id>}`, and `{"report_id": <retained-id>}`, respectively. The existing request also carries the selected workspace and operation identity. A repeated submission with the same operation identity follows the operator's retained-task semantics.

The original-source preview takes the workspace's existing native-operation gate. The interface can continue displaying retained reports while the worker completes a scientific operation. Source inspection during active native work returns the existing busy response and leaves the form draft available.

## Source layout

`operator/calibration.py` adapts the scientific records and writes comparison exports. `operator/web/calibration.mjs` provides the existing operator's calibration view and forms. `operator/web/calibration.css` supplies scoped monochrome styling. `operator/extensions/calibration.json` binds them to the maintained extension host. `operator/install_calibration.py` performs current-source registration and migration; `source_tools/calibration_assembly.py` composes the complete receiving edition before its final source identities are recorded.

The scientific model API remains `catalog(workspace)`, `preview(workspace, selection)`, `prepare(workspace, selection)`, `inspect(workspace, plan_id)`, and `analyze(workspace, plan_id)`. See the companion model guide for the complete scientific input schema and source-native command-line workflow.

## Published observation-error sensitivity

Open a completed nominal calibration and select **Analyze published observation errors**. The existing task queue reuses its original modeled predictions, selected candidate, catchment groups, pollutant weights and normalization scales. Choose a finite nonnegative standard-error multiplier. The default is **1**; **0** reproduces the nominal comparison.

The source is the standard error retained with each original annual observation. The scientific module retains conversion to annual comparison units and the temporal aggregation already used by the nominal calibration. Missing standard errors remain explicit in source coverage and affected comparison rows. No default percentage or replacement error is supplied.

The completed analysis appears in **Published observation uncertainty** on the original calibration page. Open it to inspect:

- **Ranking sensitivity:** each challenger's nominal, minimum and maximum objective gap relative to the originally selected run. A positive gap favors the original selection. The plot marks zero, the source-error range and the nominal gap; the complete table remains searchable and sortable.
- **First-tie multiplier:** the earliest standard-error multiplier that can produce a tie under the fixed objective and nonnegative source bounds. Missing contributing errors, equivalent predictions and thresholds outside finite numerical representation retain their exact scientific state.
- **Annual reference ranges:** original catchment, hydrologic group, pollutant, annual mass, source record IDs and complete or incomplete uncertainty coverage.
- **Published standard errors:** original source values and units, converted annual standard errors and each retained source issue.
- **Source contributions:** coefficients and endpoints for original records contributing to each challenger comparison. A shared original record ID retains one source perturbation across all references that use it.
- **Selected validation:** modeled annual load and residual ranges for the originally selected model on reserved validation catchments, with native/source coverage retained. No challenger ranking uses these rows.
- **Nominal reproduction:** original and reproduced calibration objective values, absolute differences and numerical tolerance.

These are deterministic sensitivity ranges over the declared marginal source bounds. They do not assign a probability to a possible reversal or change the nominal selected profile. Dependence among distinct original estimates is not assumed away. Validation catchments remain outside challenger ranking; their reference bands and selected-model residual ranges are descriptive. Overall partial coverage can coexist with an exact comparison when the missing record's shared coefficient cancels, or at multiplier zero.

### Retained records and operations

| Action | Payload | Result |
| --- | --- | --- |
| `calibration.uncertainty` | `{"report_id":"<original calibration ID>","standard_errors":1}` | Retained `uncertainty_id`, original `report_id` / `plan_id`, coverage state and selection sensitivity. |
| `calibration.uncertainty.export` | `{"uncertainty_id":"<retained analysis ID>"}` | Complete report package and file inventory. |

`GET /api/calibration/uncertainty?id=<ID>` uses the existing workspace query context and returns the original scientific analysis with retained downloads. The registered item kind is `calibration-uncertainties`. Existing calibration state includes `calibration_uncertainties`, allowing the open nominal result to show newly completed analyses after the ordinary task refresh.

The provider delegates scientific work to:

```python
from model import calibration_uncertainty

analysis = calibration_uncertainty.analyze(
    workspace, original_calibration_id, standard_errors=1.0
)
retained = calibration_uncertainty.inspect(workspace, analysis["id"])
```

The equations, nonnegative bounds, source conversions, shared-record coefficients and nominal reproduction rules are in [CALIBRATION_UNCERTAINTY.md](../model/CALIBRATION_UNCERTAINTY.md).

### Complete sensitivity package

Select **Export sensitivity package** in the sensitivity view. The retained directory is `calibration-uncertainty-exports/<analysis ID>/`; the task exposes the complete ZIP and each individual file through the original verified operator ticket transport.

| File | Content |
| --- | --- |
| `index.html` | Readable printable analysis, signed-gap interpretation, complete result tables and source coverage. |
| `uncertainty.json` | Complete scientific sensitivity record. |
| `calibration.json` | Original nominal calibration, preserved exactly. |
| `selection.json` | Original saved calibration plan, preserved exactly. |
| `pairwise.csv` | Signed challenger gaps, ranking states and first-tie multipliers. |
| `reference_units.csv` | Catchment/pollutant annual reference bounds and source support. |
| `source_records.csv` | Original source standard errors and converted annual mass ranges. |
| `source_attribution.csv` | Original record contributions to each candidate's gap range. |
| `selected_validation.csv` | Selected-model annual predictions and residual ranges on reserved validation catchments. |
| `candidate_scores.csv` | Nominal objective reproduction for each retained candidate. |
| `manifest.json` | Exact member byte lengths, SHA-256s and original analysis identities. |

CSV output retains additional scientific fields, serializes structured source details as JSON and protects spreadsheet cells beginning with formula characters. Reopening an existing export checks retained member and archive identities before offering downloads.

### Install and restore

This edition adds `model/calibration_uncertainty.py` and `model/CALIBRATION_UNCERTAINTY.md` to the complete calibration source cohort. Use the receiving application's maintained `install_extensions.py` through the same calibration installer and cumulative assembly commands described above. The installer records the exact current observation-handoff browser and provider predecessors, preserving independent native core and shared host edits.

The maintained portable workspace inventory walks the complete workspace, including `calibration-uncertainties` and `calibration-uncertainty-exports`. The registered `verify_workspace` hook reopens each retained sensitivity record through the scientific module's `inspect` validator. It checks the original calibration, plan, observation edition, source object bytes, source stamp, selected identities and fixed objective. Restore does not rerun the nominal model or sensitivity calculation.


## Original-catchment residual maps

A completed calibration now opens its original catchment geometry as a retained
map source, grayscale atlas and editable GIS project. The same Calibration desk
owns the selection, queue, saved result and reopening. The source-error page can
also create a map edition using its exact retained standard-error multiplier and
missing-error coverage.

### Operate the complete map workflow

1. Open a completed nominal calibration and choose **Prepare residual maps**.
   From an observation sensitivity result choose **Map these reference ranges**
   to preselect that retained sensitivity edition.
2. Keep the original selected run. Optionally include eligible challenger runs
   from the same saved calibration. The selected run includes calibration and
   held-out descriptive rows; challenger layers contain calibration rows only.
   The form identifies each original native candidate and its calibration loss.
3. Submit **Prepare maps** through the existing workspace task queue. This calls
   the maintained `model.calibration_maps.prepare` and retains the source collection,
   map edition, CSV tables, SVG pages, PDF atlas and original scientific records.
   The completed task exposes those verified file downloads immediately.
4. Return to the same calibration. Its **Catchment residual maps** section lists
   every retained map edition. Open one, filter the layer list by candidate or
   pollutant, and choose **Atlas and files**. The page shows calibration/held-out
   row counts, incomplete native rows, units and the shared per-pollutant residual
   display cap. PDF opens its exact verified file ticket in the existing detail viewer; SVG pages appear directly
   and remain downloadable.
5. **Open source map** uses the original spatial viewer's `spatial-item` action
   with kind `source-info`, exact source collection and source ID. That viewer
   supplies boundaries and original scalar attribute inspection.
6. **Save original spatial review** queues the science module's original
   `SpatialReview.save` join. Calibration overlays are solid; held-out overlays
   are dashed. The immutable `calibration-map-reviews` link retains map, layer and
   original spatial review IDs. The saved-review button appears after the normal
   task/state refresh and reopens the existing spatial desk.
7. **Build editable GIS project** sends the map's exact `gis_selection` directly
   to the maintained `gis.project.export` action. The selected vector sources and
   their required context preserve GeoJSON, CSV, atlas pages and original source
   records in the ordinary GIS project. The existing completed task and
   **Editable GIS projects** view expose its ZIP, QGIS project and offline viewer.
8. Back up and reopen the original workspace. Existing recursive workspace and
   application collection includes `calibration-maps`, `calibration-map-reviews`,
   `calibration-map-exports`, the ordinary source objects and original spatial
   reviews. The extension receiving hook reopens each map through the science
   validator and validates linked reviews through `SpatialReview.validate_saved`.

### Scientific map meaning

A residual is the saved predicted annual load minus the time-weighted original
annual reference. Native modeled load and any explicitly retained delivered
external load remain separate attributes. Pollutant mass units, temporal/source
identities, native support and the calibration/held-out role travel with each
catchment. Incomplete native support stays null.

The atlas uses one absolute-residual display cap per pollutant across the chosen
candidate maps. Each panel retains an original catchment, including holes and
disconnected parts, in the actual saved model-grid CRS. GeoJSON uses EPSG:4326.
Nested or overlapping upstream catchments stay separate; their loads and
residuals are not summed into regional totals. The ordinary spatial source view
shows outline geometry and scalar attributes; the PDF/SVG atlas carries the
signed grayscale residual rendering.

When a source-error analysis is selected, the map retains that exact analysis's
reference bounds and missing-error state. It does not perform another native run,
change the original nominal profile or rank challengers using held-out values.

### Current implementation contract

The extension adds these original queue actions:

- `calibration.maps.prepare`: `{report_id, candidate_run_ids?, uncertainty_id?}`.
  Omitted candidate IDs select only the nominal run. Every explicit selection
  must include that run; all candidates must belong to the retained report.
- `calibration.maps.review`: `{map_id, layer_id}`.

`GET /api/calibration/maps?id=MAP_ID` returns `{workspace_key, map, reviews,
artifacts, _downloads}`. Every `artifacts` entry contains the exact original
relative file descriptor and its verified operator download ticket. Collection
item kind `calibration-maps` uses that same read operation. State includes compact
`calibration_maps` summaries and immutable `calibration_map_reviews` links.

The separate browser source `operator/web/calibration_maps.mjs` is imported by
the existing calibration module and declared in its maintained extension assets.
It owns map view state and narrow controls; the current shared app, spatial
viewer and GIS provider remain their own implementations. Workspace/request
guards discard stale map reads and form submissions. Source and review buttons
use the original app's native action contract.

Receive the complete science files `model/calibration_maps.py` and
`model/CALIBRATION_MAPS.md` with all eight operator/cohort files, then run the
same `operator/install_calibration.py --application ACTUAL_APP --source COHORT`.
The installer knows the exact merged PR2850 predecessors and still rejects
unrecognized competing edits. The cumulative assembly driver includes the new
module and browser asset while treating `model/spatial.py` as a shared native
dependency.

Native preparation needs the application's existing Fiona, Shapely, PyProj and
Matplotlib environment. The maintained original SpatialReview and Editable GIS
1.2.1 providers supply the review and GIS joins. Installed source should include
the current `operator/extensions/gis-projects.json`; no new GIS exporter or
shared-host fork is introduced. Scientific dependency and map-method details are
in [CALIBRATION_MAPS.md](../model/CALIBRATION_MAPS.md).

A focused native receiving check can compile `model/calibration_maps.py` and
`operator/calibration.py`, import the original provider, then prepare one actual
completed calibration's map edition, open its first PDF/SVG and scalar source,
save a review, export its GIS project and reopen the same workspace. Use actual
retained report IDs from that study.


## Complete retained calibration review

The completed comparison now includes **Complete calibration reviews**. Use **Prepare review package** to choose the exact saved error/map editions, title and notes. The existing queue builds one immutable report with all original tables, source records, catchment companions and map artifacts. Open it through **Read report**, or extract its complete ZIP and open `index.html` offline. Its print layout and full source links travel together.

The same calibration extension owns the `calibration.review.prepare` action, `calibration-reviews` item and authenticated nested report-member route. Current source-error and map records keep their original identities. Review selection enforces an exact map/error pairing when a map contains error bands. The full producer, API, restart and source-preservation contract is [Complete calibration review](../model/CALIBRATION_REVIEW.md).


### Complete review receiving and authenticated links

The full workspace archive retains saved `calibration-reviews` plus all files under `calibration-review-exports`, including the independent offline ZIP and copied source/map members. The restored operator calls the registered calibration `verify_workspace` hook before registration; it delegates to the original review inspector. Open the original calibration in the received workspace and select its saved review. Scientific IDs remain unchanged, while file URLs use the new local workspace key.

The report viewer preserves the operator origin so relative CSV, map and source links carry the existing HttpOnly `SameSite=Strict` download cookie. Both the iframe and member response retain a sandbox without scripts, forms, popups or top navigation. The complete native transfer/receive commands and exact member checks are in [CALIBRATION_REVIEW.md](../model/CALIBRATION_REVIEW.md#reopen-the-complete-review-after-a-project-transfer).


## Saved guided review and project handover

The registered calibration controller exposes
`openForReview({workspace_key, review_id, preview:false})` for the original
Guided journey. Navigate to the calibration view first; the controller validates
the selected workspace and opens the saved review through the original
authenticated `/api/calibration/review` route. Setting `preview:true` opens its
readable report after the exact dossier has been loaded. A workspace change or a
newer result request cannot open a stale report.

The optional ninth guided step stores one dossier ID. Its displayed calibration,
plan, native run, profile, uncertainty and map references are derived from that
record. The native saved-view join calls `validate_review_journey(workspace,
journey)`, which uses the original complete review inspector and verifies the
captured dependency context. Old guided selections remain valid.

Run the original native session composition before the calibration installer.
The maintained installer patches only that saved-view validation point and
retains all other current server code. The same function is used by the
cumulative source assembly before its complete source map and archive are
created. Current source-design controls and their exact support source also
travel in the complete calibration component.
