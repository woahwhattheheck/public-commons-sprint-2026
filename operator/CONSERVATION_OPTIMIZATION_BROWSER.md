# Conservation optimization browser composition

This complete client uses the original ConservationOptimization provider, original action queue, original Conservation plan store and retained decision-analysis files. It is authored for composition with OP12's current Conservation controls. It changes no science, queue or plan schema.

## Supplied source

- operator/web/conservation_optimization.mjs
- operator/web/conservation_optimization.css
- operator/CONSERVATION_OPTIMIZATION_BROWSER.md

The existing provider and backend descriptor retain the current native Conservation family. The installed source uses conservation_optimization_bridge.mjs to embed this client in the core Conservation panel. The core descriptor declares the added assets, stylesheet and portfolio-optimization- prefix; the optimizer descriptor retains its existing backend-only action ownership. The bridge preserves the original conservation.mjs, including its separately maintained candidate catalog.

## Interface and navigation

The ES module exports attachConservationOptimization(host, options = {}).

The returned controller exposes mount(node), update(), detach(), dispatch(button), taskActions(task), openStudy(study_id, selection = {}), openPlan(plan_id), openAnalysis(study_id, analysis_id), and openResult(task_id).

options.view defaults to conservation-optimization. An owning Conservation panel can provide its existing view and arrange its target node before calling mount/open methods. A registered desk uses the supplied optional client_registration, the same provider ID, and the distinct portfolio-optimization- control prefix. Dispatch this prefix to the controller before the original Conservation prefix branch. Keep one frontend owner for the selected mounting approach.

Required host methods are getState, api, endpoint, openForm, submitAction, detail, fileList, showTask, navigate and closeDetail. Forms use the current operator's #form-body mount and existing stable operation ID handling. The returned taskActions is consumed by the retained-desk v3 host's awaited task-actions seam.

To continue native scenario preparation the client emits original conservation-open-plan with data-plan-id; study links use conservation-open-study with data-study-id. These are the exact current original browser dispatch fields.

## Complete operator journey

1. Load completed original study summaries from the optimizer catalog.
2. Inspect the selected original study. Choose geographic context, available native output or published practice objectives. Paired objectives select an alternative already bound by that study.
3. Set weights only for measurements present in the retained bindings. The queue evaluates actual candidate support and completeness. Choose resource limits explicitly; blank fields impose no invented candidate-count cap. USD budgets require the study's retained USD cost table and preserve the supplied decimal string.
4. Optionally select source filters, original string IDs, solver and named preference profiles.
5. Queue preview through the current form and original action endpoint. Progress uses original tasks already supplied by host state.
6. Open the retained preview task. Inspect all candidate IDs, exclusion reasons, axis quantities/units and support; table pagination changes presentation only. Review additive solver scope, overlap, actual unions, cost availability and named preference outcomes.
7. Save that normalized selection through the original optimizer and Conservation plan service. The original model owns recomputation and identity.
8. Reopen both the original plan and verified retained analysis. Existing non-optimized land plans also open and retain their normal Conservation continuation.
9. Export through the original queue. The completed export task's ZIP tickets are merged into the visible original plan outputs.
10. Open the same original plan in Conservation to prepare the selected-footprint native scenario or experiment.

The catalog also lists retained analyses directly, so a refreshed browser reopens saved decision explanation without recalculating the optimizer.

## Focused verification

Source parses as an ES module body. The authored form/controller was exercised with exact current original study binding shapes and original host callbacks. Checks cover source-context available axes, zero count preservation, original string IDs, native baseline/alternative output intersection, original alternative identity, unrounded USD string, original queued-result action and preventing submission after a workspace change.

The source contains no extra polling, tests or scientific solver. Current native execution belongs to the existing receiving operator session.

## Source compatibility

Current provider actions: conservation.optimization.preview, conservation.optimization.save, conservation.optimization.export.

Reads: /api/conservation-optimization/catalog, /analysis and /plan, plus existing /api/conservation/study and /plan. Completed task detail comes from original /api/task.

The current science author has the independently reported empty-selection published_points unit fallback repair. That compatible science postimage should join the maintained source family through its existing owner.

## Retained integration

The complete source includes the bridge, the original retained_desks factory join and the core Conservation manifest. The bridge mounts the original study browser and this decision client as sibling regions, so core study repainting preserves the decision region. Normal shared-host remounts reuse the same client state. Catalog reads are refreshed after original optimizer task completion and on explicit refresh, rather than on each progress update.

Project credit: TokenJunkieLabs. The repository MIT license applies. **Needs expert review**: scientific, geographic and supplied-cost interpretation remains subject to the original project's domain review.

## Direct host composition

The main operator directly owns the Conservation action family. Its application now creates the same composed Conservation controller, forwards its original form, navigation and detail capabilities, and dispatches both Conservation and optimizer controls to that controller. Its static-file route serves the existing bridge, optimizer module and stylesheet. The bridge loads the stylesheet once when the direct host mounts it. Registry-only hosts retain the existing core descriptor and composed adapter route.

The final retained adapter preserves the bridge while handling same-view navigation, task envelopes and experiment-state changes. Export task tickets are attached only when their original saved plan is still the active plan after asynchronous reads. The adopted completion-based catalog refresh remains intact.
