# Saved studies → calibration → physical decisions

This component joins the existing Upper Savannah scientific services. The source-profile comparison and native parameter study remain the scientific starting point. Completed baseline candidates can now enter the maintained annual-load calibration and published-source uncertainty routines. Completed land-cover runs can enter the original scenario decision desk, together with their own same-profile baseline and the other completed profile members.

The consumer creates ordinary retained Workspace comparisons and consumer handoff records. It launches no NDR or SDR job. Continue native execution with the original saved ensemble or programme; inspect these consumer records again as additional members finish.

## Component and original owners

| File | Responsibility |
| --- | --- |
| model/decision_analysis.py | Existing physical/economic analysis, with original common-output scope carried through Workspace comparisons and explicit packet projection |
| model/decision_cli.py | Existing CLI, adding explicit output selection and retained sensitivity comparisons |
| model/ensemble_consumers.py | Saved-study metadata, same-profile decision cohorts, baseline calibration selection, actual existing producer calls and recoverable result records |
| model/ensemble_consumers_cli.py | Complete inspect, prepare, evaluate, export and resume commands |
| model/ENSEMBLE_CONSUMERS.md | Scientific interpretation and actual receiving commands |
| operator/ensemble_service.py | Existing serial task queue, real consumer catalog/result reads and original file tickets |
| operator/extensions/ensembles.json | Maintained registry actions and routes for these consumers |
| operator/web/ensembles.mjs | Original saved-design detail, explicit scientific selectors, calibration/decision actions and result reopening |

The current Economic desk and bulk cost worksheet keep their existing provider/browser owner. This component reuses the original decision renderer, source-bound cost definitions, targets, budget, parcel references, support comparison and portable export. Native parameters, original observations, estimators, source editions and IDs remain under their current producers.


## Use the existing operator

Open **Scenario sensitivity**, then open the actual saved design. Its existing detail now offers **Physical decisions** and **Evaluate annual loads**, alongside the original native run and report actions.

Physical decisions displays completed profile members, the actual reference profile, original land-cover scenarios and common available pollutants. Select the profiles and outputs, optionally supply existing sourced cost/criteria JSON, then choose **Build decision report**. The existing authenticated serial operation queue invokes the original comparison/report producers. The design's **Calibration and decision results** table reopens the saved handoff and complete downloads.

Evaluate annual loads offers actual retained observations and vector source editions. Select the matching original catchment identity field, or reuse a saved calibration selection to retain its exact original source, record filters, objective and holdout groups. The optional reference-options editor accepts those same maintained scientific fields. An explicit source-error multiplier invokes the existing uncertainty calculation after a complete calibration. The same task queue and Workspace selection are used.

Saved results show native calibration/profile IDs, original report/ZIP links, source-error sensitivity status, candidate failures and pending members. **Continue same handoff** resumes that retained consumer selection. A source-error multiplier is retained in the consumer result state and reused when continuing the same calibration.

Browser asynchronous reads are tied to the actual Workspace and current form version. The existing form/queue preserves its operation ID and handles submission retries. The module retains the current source-profile prepare handoff, parameter study chooser, model-scope filter and original native report controls.

Actions: ensemble.decision, ensemble.calibration and ensemble.consumer.resume. Read routes: GET /api/ensembles/consumers?ensemble_id=... and GET /api/ensembles/consumer?consumer_id=.... These are registered on the existing Ensembles provider; no second controller or operation queue is installed.

## Read a saved study

From the complete installed application root, using its actual Python and existing scientific Workspace:

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" inspect --ensemble-id "$ENSEMBLE_ID"
~~~

The JSON identifies the actual Workspace UUID, saved study, grid, baseline scenario, selected native models and expected artifacts. Each member retains its profile, native baseline/run IDs, completion states, errors, selected scenarios and available outputs. Read-only inspection uses retained metadata and does not read large raster bodies.

Use repeated --profile-id to select original members in a deliberate order. Use repeated --scenario-id to select original land-cover alternatives. Omitting these options retains the saved design's selections. No profile or scenario is manufactured.

A member can enter calibration once its baseline finishes. A member can enter scenario decisions once its baseline and at least one selected land-cover alternative finish. Other member/scenario states remain explicit in the consumer snapshot. Decision analysis defaults to the saved design's first selected profile as reference; --reference-profile-id explicitly chooses another actual completed member if that reference has not finished.

## Build physical decisions from completed land-cover runs

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" decision \
  --ensemble-id "$ENSEMBLE_ID"
~~~

For each completed profile member, the adapter calls the original Workspace.compare_runs with that member's original baseline followed by its completed selected alternatives. This produces ordinary comparison IDs and native difference artifacts. The decision producer then reads the completed rasters and computes a shared finite-cell mask across every included alternative in that comparison.

The first selected profile's comparison is primary. The other selected profile comparisons enter the original sensitivity routine. Scenario matching retains the original semantic scenario definition. Cross-profile sensitivity includes a member only when the original decision consumer finds the same scenario and identical measured support. Different valid-cell counts or geography are not treated as equivalent.

The command prints:

- the immutable consumer plan ID and original comparison IDs;
- planned/selected profile counts and exact pending members;
- the actual selected physical output roles;
- the original decision report ID;
- absolute index.html and decision-package.zip paths;
- Workspace-relative original report, physical-input, manifest and archive descriptors;
- the physical decision scope and result state.

Each report exports the existing HTML desk, report JSON, original physical-input packet, original selection, scenario/parameter sensitivity CSVs, cost CSV, sources CSV and complete portable ZIP. It carries the existing source companion and rendering application. A repeated export reuses an unchanged edition after verifying its original file descriptors and every ZIP member. A failed publication retains the actual exception and original handoff for resumption.

### Explicit physical output selection

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" decision \
  --ensemble-id "$ENSEMBLE_ID" \
  --pollutant nitrogen_export
~~~

Repeat --pollutant for more than one output. Valid roles are nitrogen_export, phosphorus_export and sediment_export.

The selected outputs must exist in every included completed comparison and must be within the saved design's model scope. NDR-only output cannot become a sediment result. Selecting only nitrogen narrows the downstream analysis; it does not rerun the original NDR model or change its calc_n/calc_p arguments.

If output selection is omitted, the consumer uses the actual common intersection. The native comparison's common_artifacts and model_scopes remain authoritative, together with its actual retained run and comparison artifacts. A combined NDR/SDR baseline compared with a completed NDR-only alternative therefore supplies its legitimate common nutrient outputs. The absent sediment output is omitted from the physical axes.

### Retain supplied costs and criteria

Pass an existing JSON file with --criteria. It may contain title, costs, targets, budget, notes, top_parcels_per_pollutant and delivery_id. These fields use the current decision consumer's original schemas and source requirements. Costs remain bound to the original primary alternative run IDs.

Start with an empty object when preparing a purely physical edition:

~~~json
{}
~~~

Use the original decision catalog and retained comparison IDs to join sourced costs; no default price, capital cost, discount rate, time horizon or budget is inserted here. The original cost worksheet remains available through the maintained Economic desk.

A target for an output outside the selected physical scope retains the existing unavailable-target status. It does not become a zero quantity or a satisfied target.

### Prepare and resume the same handoff

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" decision \
  --ensemble-id "$ENSEMBLE_ID" --prepare-only

"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" decision-resume \
  --consumer-id "$CONSUMER_ID"
~~~

--prepare-only creates the original comparison records and validates a metadata/summary intake before retaining the handoff. It does not execute native nutrient or sediment models. The final decision-resume performs the original raster-based shared-support analysis and full export.

--summary-only intentionally uses the current decision producer's recorded-sums path. Its original report leaves common-support percentages and a supported shortlist undefined. Use the ordinary default command for quantitative scenario comparison on measured common support.

When more native members complete, prepare a new handoff from the same ensemble ID to include those actual newly completed runs. The older immutable plan remains a record of the members and inputs used for its edition. Resuming an older consumer ID preserves that original selection.

## Evaluate baseline profiles against original annual loads

The calibration selection must identify retained annual-load observations and original catchment geography. The adapter supplies the completed baseline run IDs from the saved study. Land-cover alternatives are excluded from parameter fitting.

Prepare a reference-selection JSON using the maintained calibration schema. The following is a field template; replace its ID markers with actual saved Workspace identities:

~~~json
{
  "title": "Annual-load evaluation of the retained source profiles",
  "observation_id": "ACTUAL_RETAINED_OBSERVATION_ID",
  "catchments": {
    "source_collection_id": "ACTUAL_RETAINED_SOURCE_COLLECTION_ID",
    "source_id": "ACTUAL_CATCHMENT_SOURCE_ID",
    "id_field": "ORIGINAL_CATCHMENT_ID_FIELD"
  }
}
~~~

The current calibration service also accepts observation_record_ids, catchment_groups, calibration_group_ids, validation_group_ids, objective, delivered_external_loads, notes, leave_group_out and temporal_weighting. Preserve actual original source identities, estimator meaning, model/observation periods, held-out groups and external-load assumptions.

Run:

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" calibration \
  --ensemble-id "$ENSEMBLE_ID" \
  --references "$ANNUAL_REFERENCE_SELECTION"
~~~

Optional --pollutant narrows the original outputs to evaluate. The consumer intersects those selected native outputs with the actual admitted observation parameters when generating the original equal-weight objective. Supplying objective in the reference selection preserves its positive weights, normalization scales and source/rationale. A positive-weight objective outside the selected actual outputs is rejected with the concrete parameter name.

The original calibration implementation handles source-period means, catchment grouping, temporal weighting, normalization, prediction support, candidate ranking, held-out evaluation and reference uncertainty. Its existing observation comparison cache and progress record are reused.

No hydrochemical estimator is introduced by this adapter. The contemporaneous USGS daily-discharge acquisition remains original source hydrology: the maintained hydrology/observation pipeline joins discharge with its concentration data and source estimator before producing annual-load observations for admission. Original provisional/estimated qualifiers, dates and coverage stay with that source pipeline.

### Published source uncertainty

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" calibration \
  --ensemble-id "$ENSEMBLE_ID" \
  --references "$ANNUAL_REFERENCE_SELECTION" \
  --standard-errors "$DECLARED_STANDARD_ERROR_MULTIPLIER"
~~~

The multiplier is an explicit analysis choice. The adapter calls the existing calibration_uncertainty.analyze on the completed original calibration. That routine retains the saved objective, groups, native predictions, source units and original published standard errors. Its source-error sensitivity box and possible preference reversal have the meanings in model/CALIBRATION_UNCERTAINTY.md.

The JSON returns the actual calibration plan/result IDs, selected original native run/profile IDs, evaluated parameters, candidate failures, uncertainty ID/state and selection-sensitivity summary. The result does not replace the saved source profile or alter the native ensemble.

Prepare and resume with the same original plan:

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" calibration \
  --ensemble-id "$ENSEMBLE_ID" \
  --references "$ANNUAL_REFERENCE_SELECTION" --prepare-only

"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" calibration-resume \
  --consumer-id "$CONSUMER_ID" \
  --standard-errors "$DECLARED_STANDARD_ERROR_MULTIPLIER"
~~~

## Existing decision CLI compatibility

The existing command accepts explicit pollutants and optional original sensitivity comparisons:

~~~sh
"$PYTHON" -B -m model.decision_cli selection \
  --workspace "$WORKSPACE" \
  --comparison-id "$COMPARISON_ID" \
  --sensitivity-comparison-id "$OTHER_PROFILE_COMPARISON_ID" \
  --pollutant nitrogen_export \
  --output "$NEW_SELECTION_JSON"

"$PYTHON" -B -m model.decision_cli build \
  --workspace "$WORKSPACE" --selection "$NEW_SELECTION_JSON" \
  --output "$NEW_DECISION_DIRECTORY"
~~~

Existing scenario-selection also accepts repeated --pollutant to narrow an original source report/zone. Packet analysis projects an explicit output subset on an in-memory copy; the original source packet/report remains in the export and its source references remain attached.

Existing commands without the new option keep their original available-output behavior, now using the original common comparison scope for the Workspace route. Original complete-model run and comparison identities remain unchanged.

## Physical meaning and units

| Quantity | Meaning |
| --- | --- |
| Native comparison delta | Alternative annual export minus baseline annual export |
| Decision avoided export | Baseline annual export minus alternative annual export; positive is reduction |
| Nitrogen and phosphorus | kg/year |
| Sediment | metric tonnes/year, displayed canonically as t/year by the existing decision desk |
| Per-pixel annual mass raster | Sum directly on the measured common mask |
| Per-hectare annual export raster | Multiply by the actual projected pixel area once |
| Reduction percentage | Avoided export divided by the same-cell baseline; undefined for a zero baseline |
| Profile sensitivity | Range/quantiles across selected actual profiles with matching scenario/support, without an assigned probability distribution |
| Missing output | Omitted/unavailable, never numeric zero |

The decision kernel, unit-normalization factors, support hashing and sign calculations are unchanged by this source join. Its existing same-cell analysis checks dimensions, CRS, alignment, finite nonnegative source exports, actual mask coverage and file changes during reading.

Official model methods:

- InVEST 3.20 NDR: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- InVEST 3.20 SDR: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html
- InVEST freshwater calibration: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html

## Retained records and receiving

Immutable handoffs: ensemble-consumer-plans/ID.json.

Original decision comparisons: comparisons/ORIGINAL_ID/comparison.json and their producer-owned original difference artifacts.

Consumer progress/results: ensemble-consumer-results/CONSUMER_ID/state.json.

Complete decision editions: ensemble-consumer-results/CONSUMER_ID/editions/REPORT_ID/.

Original calibration plans/results: calibration-plans/ID.json, calibrations/ID.json and calibration-analysis/PLAN_ID/progress.json.

Original uncertainty results: calibration-uncertainties/ID.json.

All paths remain under the original scientific Workspace and travel through its existing portable inventory. Use the current full application, not a stand-alone copy of these five files without their maintained model/report dependencies. The current shared extension host discovers the updated descriptor through its ordinary application installation/restart. Preserve the complete existing ensembles.mjs body so the source-profile → native-study handoff remains available.

Join these commands to the existing original native operation with its actual interpreter, saved Workspace and study IDs. The source-only profile receiver and completed watershed-context receiver can run first in the same Workspace; scientific raster consumers then use the original completed native selections when those results are retained. Keep the original Gura source edition/grid/context distinct from the Upper Savannah regional study.

An accepting native receiver should return the actual command, application/interpreter, Workspace UUID, study and consumer IDs, output JSON/report paths, and the first exception if one occurs. The source authors can then patch the same complete component and resume its original handoff.


## Original annual import to a saved native study

The current Annual load references desk now offers **Evaluate saved study** beside its existing **Open calibration** action. This continuation uses the completed original import's retained binding. It opens the actual saved studies in the same Workspace, then the existing scientific-consumer form with that source preselected. Review the completed baseline profiles and outputs, original annual estimator, source period and catchment support, then submit the existing calibration action.

From Scenario sensitivity, **Evaluate annual loads** also lists completed imported annual sources alongside previous calibration selections. Choosing an imported source fixes its original observation ID, source collection, catchment source and matching identity field. The form disables manual replacement of that binding. Choosing a prior evaluation retains its original groups, objective, record filters and held-out choices. Advanced analysis options remain available; they cannot replace an imported source's observation or spatial binding.

### Headless original-source selection

List the actual completed imports, source methods and periods:

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" annual-references
~~~

Use the returned original import task ID with an existing saved study:

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" calibration \
  --ensemble-id "$ENSEMBLE_ID" \
  --annual-import-id "$ANNUAL_IMPORT_TASK_ID"
~~~

Optional `--reference-options "$ANALYSIS_OPTIONS"` accepts the existing analysis choices: title, observation_record_ids, catchment_groups, calibration_group_ids, validation_group_ids, objective, delivered_external_loads, notes, leave_group_out and temporal_weighting. The original binding's recommended temporal weighting supplies the default. Source-period means and study-period compatibility are still evaluated by the existing calibration implementation. Optional `--pollutant`, `--profile-id`, `--prepare-only` and `--standard-errors` keep their original meanings. The existing `--references "$ANNUAL_REFERENCE_SELECTION"` route is preserved and mutually exclusive with `--annual-import-id`.

The imported source may use the maintained F7DN436B original annual-estimator edition or the current Southeast SPARROW calibration-target edition. Both are admitted by their original producers and retain their own source release, estimation method, units, catchment choice, period semantics and uncertainty. The new adapter does not convert a source-global reference horizon into station-specific sampling dates. It displays the original producer's notes and distinct period/method groups, including the exclusive end date retained by observations. Original units and comparison units appear separately. Missing published standard errors remain missing; their availability is counted from actual admitted observation records.

The original daily-discharge and concentration acquisitions continue through their established source and estimator owners. Contextual rows are not turned into annual-load references by this continuation.

### Retention and native operation

The adapter reads `annual-references/IMPORT_ID/operation.json`, requires its completed original import, verifies the Workspace, preparation and observation identities, and resolves the catchment vector from the exact retained source collection. On submission it verifies the original producer's prepared document descriptors and preparation identity. The saved scientific handoff adds `annual_reference` with its original binding, relative operation descriptor, catchment source descriptor and source summary. Existing consumer result pages display this context alongside the actual calibration and source-error results.

No raster is opened and no model is launched to list imports or choose a study. The original calibration queue runs only when the operator submits the review form. Its existing source checks, spatial overlap groups, held-out evaluation and physical units remain authoritative. Imported records and their companions already travel in the complete original Workspace; all adapter file paths are relative to the current Workspace root.

For the original receiving operation, open Annual load references → a completed import → Evaluate saved study → an existing completed native study. Confirm the original source and catchments remain selected, choose its actual baseline candidates/outputs, run the original queue, and reopen the resulting annual-reference context and calibration IDs. Then export/restore the same Workspace and repeat the retained-result opening. The CLI alternative above uses the same producer and retained IDs.


### Exact original records for hydrology support

The `annual-references` CLI includes each imported source's `reference_records`. Each admitted record retains its native `id`/`record_id`, observation and preparation IDs, original station/catchment IDs, parameter/method, period_start and exclusive period_end, original/comparison units, and complete `source_records`. When the original source explicitly names a flow_station_id, that identity is exposed separately; absence remains null. A water-quality station is not implicitly treated as its flow station.

The existing hydrology support consumer can intersect those exact periods with retained daily dates, preserve unmatched station/series requests, and report captured versus requested support. Its available daily-flow edition and the annual estimate keep their separate source periods. A period-support summary describes the actual date/flow coverage; it does not supply a new annual pollutant estimate. The compact browser catalogue omits this potentially large per-record list; the saved scientific handoff and CLI keep the complete records. Applied observation_record_ids and objective filters remain in the original saved calibration selection.


## Link original daily-flow support to the admitted annual reference

The existing Scenario sensitivity evaluation form now offers **Original daily-flow
context** whenever an imported annual-reference edition is selected. The
reference keeps its admitted observation, original catchment, record IDs,
constituents, methods and exclusive date intervals. The original hydrology
processor supplies daily coverage for those exact records.

**Prepare original flow context** queues the original source replay and registers
its complete source family in the same Workspace. Open the task's original
JSON/CSV and printable source-context report, then reopen the study's evaluation
form and select that retained support. **Prepare original support and evaluate**
performs the same source preparation and calibration in the existing evaluation
task. Saved results show the chosen daily context and original downloads beside
the annual-load evaluation. Both paths retain the original action queue and
resumption behavior.

The source producer is the maintained
source/hydrology-huc05-07-20261013/rebuild_reference_support.mjs, introduced with
the complete source family in PR3183 / 1e393eb649f9858476fb5d1a603e612e57419125.
It replays the original captured daily responses with Node.js and verifies the
unchanged original calendar outputs before deriving exact reference-period
support. The receiving runtime supplies Node.js; the Workspace retains the
original command, stdout/stderr, source collection, preparation state and all
source bodies. Its original Python consumer adds no daily-flow estimator.

The complete command-line workflow is:

~~~sh
"$PYTHON" -B -m model.ensemble_consumers_cli --workspace "$WORKSPACE" \
  flow-support --annual-import-id "$ANNUAL_IMPORT_TASK_ID"

"$PYTHON" -B -m model.ensemble_consumers_cli --workspace "$WORKSPACE" \
  flow-support-sources

"$PYTHON" -B -m model.ensemble_consumers_cli --workspace "$WORKSPACE" \
  calibration --ensemble-id "$ENSEMBLE_ID" \
  --annual-import-id "$ANNUAL_IMPORT_TASK_ID" --prepare-flow-support
~~~

The standalone flow command accepts --source-root for the complete original
hydrology source directory and --node for the actual Node.js interpreter.
Calibration's --flow-source-root applies only with --prepare-flow-support.
For an already registered source, save its actual catalogue source object
(collection_id, source_id, source_sha256) and use --flow-support-source FILE
instead. Existing --prepare-only, --standard-errors and calibration-resume
continue to operate on the same original saved handoff.

Source support is matched by the original import, Workspace, observation,
preparation and each complete admitted record. The consumer checks original
station/flow-station identity, method, constituent and [start,end) interval, then
retains only the records chosen by the actual positive-weight calibration
objectives. The complete original support JSON and CSV remain attached.

Interpret the context table using its original daily support:

- Numeric/requested days describes the exact reference interval. Days outside the
  captured source period remain separate from dates absent within that period.
- Approved, estimated and provisional flags are independent original qualifiers;
  a complete numeric interval can contain estimated or provisional values.
- Covered-days volume sums available original daily means. A complete-period
  volume appears only when every requested date has numeric support.
- Original explicit flow_station_id takes precedence. Otherwise the producer
  uses only the same exact original USGS station ID. Unresolved or uncaptured
  stations remain visible.
- Annual calibration keeps its admitted load, spatial binding, objective and
  temporal weighting. Daily context accompanies the reference and selected
  native profile; it does not alter those retained scientific choices.

The consumer saves readable companions under ensemble-flow-reports and resumable
preparation under ensemble-flow-operations. Every published descriptor is
Workspace-relative. Original source bodies, the scientific handoff, the linked
context and its report travel in the maintained complete Workspace backup.
