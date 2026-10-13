# Continue selected decisions in the native scenario analysis desk

This joined source bank contains the complete ten-file OP12 V3 scenario analysis implementation and the decision handoff. The original selected-model engine, retained analysis records, form controls and scenario.analyze action remain the active implementation. The new public create(request) entry point opens that form with the original native run identities behind selected decision cases.

## Complete current source

The source bank contains twelve complete UTF-8 files. Paths are relative to opportunities/upstate_forever_2026.

| Path | Role |
| --- | --- |
| model/scenario_analysis.py | Current V3 physical reporting and fixed-baseline planning calculations. |
| model/scenario_cli.py | Original command-line entry point. |
| operator/scenario_analysis_operator.py | Current extension API/action/state adapter. |
| operator/extensions/scenario-analysis.json | Current shared-host registration. |
| operator/apply_scenario_analysis.py | Guarded installer accepting this source bank or an original source dictionary. |
| operator/web/scenario_analysis.mjs | Current V3 desk, plus public create intake and same-version selection. |
| operator/web/scenario_analysis_bridge.mjs | Current lifecycle bridge, plus public create forwarding. |
| operator/web/scenario_analysis.css | Original V3 stylesheet. |
| operator/SCENARIO_OPERATOR.md | Original V3 operator documentation. |
| operator/SCENARIO_ANALYSIS.md | Original V3 scientific and command-line documentation. |
| operator/web/scenario_handoff.mjs | Current decision-case to native-cohort selection adapter. |
| operator/SCENARIO_HANDOFF.md | This receiving and integration guide. |

The authoritative source-owner bank is the current V3 edition in Canvas F0C8PH8BVMY, decoded payload SHA256 5dccf9903c35edbf8e6beaa6ed35e6d22954ba617817bafb5180e305e85cc3ba. Its model/scenario_analysis.py is 55,255 bytes, SHA256 03f2159ab3127fdb9f41da095411df18a0287d01b645bd1931511d850b678c46. This complete joined edition replaces the earlier four-file V2 continuation package.

The application also supplies the selected-native runtime in model/model_selection.py. The source read for this join is 4,689 bytes, SHA256 34e2d6f3ff7b540ab43161626e876fb3c62c9ee3be7c3f4006b2db8a996eb914, in the native-model scope bank F0C8JJQ2JBX. It provides validate_completed_run and common_comparison_outputs. The installed native runtime owns this dependency; the complete receiving application includes it with the original workspace and raster modules.

## Build a continuation from the current selection

Import buildScenarioAnalysisSeed from /web/scenario_handoff.mjs:

~~~js
const handoff = buildScenarioAnalysisSeed({
  data: currentDecisionInput,
  selection: controller.getState(),
  nativeRuns: getState().data.runs,
  workspaceKey: getState().workspace_key,
  title: "Selected watershed scenarios"
});
~~~

currentDecisionInput is the exact input behind the displayed assessment. Its alternatives[].id identifies a decision case; alternatives[].run_id identifies that case's original native run. nativeRuns comes from the current workspace, so an assessment reopened from a retained source snapshot is checked against the current native catalog. Metric and catchment selection identities remain in source_context for the host to display with the originating assessment.

The result has this structure:

~~~js
{
  ready,
  target_extension_id: "scenario-analysis",
  target_method: "create",
  request: {
    workspace_key,
    selection: {title, baseline_run_id, scenario_run_ids}
  },
  baseline_issues: [],
  cohort_issues: [],
  accepted_cases: [
    {case_id, run_id, label, available_metric_ids}
  ],
  rejected_cases: [
    {case_id, run_id, label, available_metric_ids, reasons: []}
  ],
  selected_case_count,
  accepted_run_count,
  target_metric_ids: [],
  compatible_cohorts: [
    {
      id: "ndr", // or "sdr"
      title: "Nutrient scenarios", // or "Sediment scenarios"
      metric_ids: [],
      baseline_run_id,
      scenario_run_ids: [],
      case_ids: [],
      case_count,
      alternative_count,
      request: {
        workspace_key,
        selection: {title, baseline_run_id, scenario_run_ids}
      }
    }
  ],
  source_context: {
    workspace_id, baseline_case_id, alternative_case_ids,
    metric_ids, catchment_ids
  },
  method
}
~~~

The helper deduplicates native alternative IDs while retaining all selected case references and their order. Partial acceptance remains visible through accepted_cases and rejected_cases. ready requires a valid baseline, an actual output shared by the entire accepted native cohort, and an accepted alternative when the operator selected alternatives. Selecting no alternatives intentionally supports a baseline-only analysis. If every requested alternative is rejected, the helper reports that result instead of silently changing the request into baseline-only analysis.

A mixed cohort can contain valid NDR-only and SDR-only alternatives against a combined baseline. Each pair is meaningful, but the whole selection has no common pollutant. In that case ready is false, cohort_issues explains the selection, and compatible_cohorts supplies explicit maximal nutrient and sediment continuations. A combined alternative may appear in both continuations. Each choice lists its exact native IDs, case IDs and actual shared outputs. The host renders separate buttons, allowing the operator to choose the intended cohort.

## Actual native compatibility and form behavior

The helper mirrors the current V3 native-output contract:

| Native model selection | Required completed outputs |
| --- | --- |
| ndr | nitrogen_export and phosphorus_export |
| sdr | sediment_export |
| ndr and sdr | All three outputs |
| Absent legacy models field | Original combined NDR and SDR selection |

Each retained artifact requires a path string, positive finite bytes, a lowercase 64-character SHA256 and the original units. Nutrient rasters use kg/pixel/year; sediment rasters use metric_tonnes/pixel/year. The run must be complete and its reported model_scope.selected_models_complete must not be false. An incomplete declared combined run is excluded even if it has one completed model output. The native engine verifies its original full stages and files when executing the analysis.

Every selected run must use the same actual grid and InVEST version as the baseline. Parameter-profile changes remain selectable, with the target engine's original comparison classification. The current form now labels model version and filters alternatives by it as well as grid and native output compatibility.

create(request) rechecks workspace, native IDs, completed selected models, grid, version and the whole-cohort output intersection at invocation. The original form rechecks the selected cohort again at submission. A missing supplied baseline produces an actionable error. create() without an argument preserves the ordinary New analysis form.

The form enables weights and cap inputs for the cohort's actual shared outputs. Unavailable pollutant weights are zero. The default remains the current 95th-percentile fixed-baseline configuration, with explicit optional physical caps, sensitivity weights and source-bound planning areas.

## Physical meaning and source areas

The fixed-scale analysis computes each pollutant over the actual raster support common to the entire selected native cohort. Its fixed reference caps come from the baseline reporting raster before that cohort support intersection. These original physical calculations and the V3 selected-model runtime are included in this bank.

The decision workbench's optional cohort min/max priority and the target's fixed-baseline planning method retain their own settings and results. The handoff carries native run identities into the target's existing form. It does not translate a decision score into a physical cap.

The target engine always includes the original baseline grid reporting area, using its retained source reference. Additional planning areas are optional retained vector selections with source_collection_id, source_id, and any original layer/filter/buffer/rank-group settings. A decision catchment ID alone cannot define those retained vectors. The operator can complete a real baseline or scenario analysis using the already retained reporting area, then add source-bound planning areas through the same form.

## Shared-host integration

The current Scenario decisions descriptor adds scenario_handoff.mjs to its assets. The root-owned decision_bridge.mjs imports the helper, shows current accepted/rejected cases and cohort issues, and invokes the existing host capability:

~~~js
if (handoff.ready) {
  await openExtension("scenario-analysis", "create", handoff.request);
}

// Each explicit compatible-cohort button uses that cohort's own request:
await openExtension("scenario-analysis", "create", cohort.request);
~~~

openExtension is passed directly to the factory through the normal shared-host capabilities. The host obtains the registered target instance and checks workspace continuity. The target's public create method opens the original global form even if the Scenario analysis desk has not yet mounted. An unloaded controller from getExtension is therefore not a capability test.

The completed original operation is scenario.analyze. The existing scenario-analysis descriptor owns its action, state, native item view and result files. The root retains the current decisions bridge and descriptor when composing this bank.

## Receive the complete source

The current receiving bank includes the complete saved-decision workbench, shared host and Scenario analysis source. Its commons.source-bank/v1 entries carry full base64 bodies, byte counts, SHA256 hashes and regular-file modes. The installer_packet and predecessor_history fields preserve the original Scenario analysis joins and exact known source editions.

Use the complete application from public PR 2672 or a later integrated main checkout:
https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2672

The receiving application must include its original model/workspace.py, model/model_selection.py, operator/server.py and native model dependencies. The shared host installer composes the host's hooks and assets; the complete application assembler supplies the rest of the application.

Stage the complete bank with the existing source assembler into the current application, preserving independently authored current files. Then run the included installers against that same application. Substitute the actual application directory and saved bank path:

~~~sh
python -B APP/install_extensions.py --application APP --source-root APP
python -B APP/operator/apply_scenario_analysis.py --root APP --bundle FULL_SOURCE_BANK.json --integration extensions
~~~

For a complete application that already has the shared host installed, the Scenario analysis installer also accepts the full outer bank directly. Stage its included operator/apply_scenario_analysis.py and run it with --root APP, --bundle FULL_SOURCE_BANK.json and --integration extensions. Then run APP/install_extensions.py against APP to compose the current navigation joins.

The source decoder verifies every included file's bytes, SHA256, UTF-8 encoding, regular-file mode and relative path. It accepts UTF-8 with an optional BOM at the outer JSON boundary. Exact predecessor metadata permits authored upgrades while keeping unrelated current changes available for composition. The original plaintext files dictionary and --carrier/--receiver route remain available to original source packets.

The Scenario analysis installer migrates its own authored legacy joins into the registered desk. Run it after the host installer so the original task queue, retained-item transport and shared form stay the operation's execution path.

### Navigation between desks

The shared installer puts registered dispatch immediately after the global two-space navigation loop, ahead of existing Experiments and Spatial early returns. Render-entry cleanup detaches a previously registered desk for built-in views and detaches Experiments or Diagnostics when leaving those views. This also handles an Experiments installer run after the host installer. The registered branch retains Community, Customer reviews, Spatial and Programmes cleanup and also detaches Conservation. The original Scenario analysis cleanup stays in place until its own installer migrates the legacy joins.

## Focused executed behavior

The actual updated V3 desk and helper were executed with a focused form adapter. Six selected decision cases included repeated references to the same native run, a changed parameter profile, mixed NDR/SDR/combined models, a different InVEST version and a declared combined run missing sediment output. Three unique native alternatives were accepted; the two incompatible cases retained explicit reasons.

The mixed cohort exposed two continuations. The nutrient continuation submitted the original scenario.analyze action with nitrogen/phosphorus weights 1/1 and sediment weight 0. The sediment continuation submitted 0/0/1. A baseline-only SDR request opened and submitted with zero alternatives, and an NDR baseline with a combined alternative retained the nutrient intersection. The actual create entry point and form rejected a later model-version or whole-cohort incompatibility.

These checks exercise the current original form intake and action dispatch. The receiving journey selects actual completed native runs, opens the continuation, completes the original analysis against the retained reporting area, and opens its retained results and original downloads.

## Integrated decision workbench

The current decision_bridge.mjs implements the continuation and names every available native group before opening the original form. It uses the exact current native records behind the displayed assessment cases, including when that assessment retains an earlier source snapshot. The main continuation follows the helper's readiness, including a valid baseline-only selection. Nutrient and sediment group buttons pass their explicit original native run lists. A queued saved assessment that completes while another desk is open retains its saved parent and reopens the exact saved record when the decision desk is revisited.

The final original installer reads --bundle as UTF-8 with optional BOM, matching ordinary UTF-8 source banks and native text exports. Base64 file decoding, byte counts, source hashes and original predecessor checks stay authoritative.

The current helper and full decision bridge were exercised together through the original host capability with a minimal DOM and retained-record fixtures. The focused journey covered unavailable mixed full-cohort selection, both explicit group controls, preservation of the requested native alternative, saved revision retention while detached, and reopening the saved record on return. Native model execution and the full installed browser journey continue through the existing receiving application.
