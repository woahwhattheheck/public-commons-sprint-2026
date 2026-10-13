# Sampling priorities

Sampling priorities opens from the original operator navigation, immediately after Monitoring. It uses a saved observational context, explicit planning targets and the existing Monitoring design engine. The screen does not infer ecological sensitivity, replace censored measurements, create collected samples, or promise high-flow events.

## Open the original observations

1. Select the original Workspace.
2. Open **Sampling priorities**, then choose a **Saved observational context**.
3. Review the original station bindings, exact analytical cohorts, declared source period and retained context identity.
4. Use **Open original context in Monitoring** to inspect the saved network, original calendar and complete observational support.
5. Enter a historical evidence window, or click **Use the complete declared evidence window** to adopt the original source dates explicitly.

The analytical cohort retains each original characteristic, method, unit, fraction, result-value type, speciation and any additional source metadata used by the compiler. Missing, null and stated metadata remain distinct. A cohort present elsewhere in the original source can be selected for a station with no matching observations.

A month goal counts distinct historical sampling dates in that calendar month across the complete selected evidence window. It is not an annual quota. Replicate measurements do not manufacture additional sampling dates.

## Enter a justified proposal

Complete the recommendation title, responsible operator, recording time with timezone and planning basis. Add a target for each station/cohort requirement.

Each target records:

- An exact original source station and analytical cohort.
- The historical months to inspect and a distinct-date goal.
- A separately entered number of future visits.
- An optional proposed reporting limit in the original cohort unit, with its laboratory or scientific rationale.
- Any-flow or same-station high-flow coverage as an explicit objective.
- Priority, inclusion, station/season/analyte rationale and any operator-supplied sensitivity basis.
- Setup and per-visit costs in USD, with the cost basis.

Blank cost and reporting-limit fields remain unknown. Zero is an explicit value. The preview adds entered setup plus proposed visits times per-visit cost for included targets. It does not silently discount overlapping visits or substitute zero for unknown costs.

Sensitivity text is retained as the operator's rationale. No model information gain or ecological coefficient is calculated from it.

## Review gaps and original evidence

Choose **Preview gaps and costs**.

The review shows an itemized target summary, known entered programme cost, unknown-cost targets and a monthly gap table. Filter the monthly table by source station or unmet goals; these view filters do not change the saved targets or complete export.

Expand an individual target to inspect its rationale, reporting limits, unknown or incompatible limit units, eligible original high-flow episodes and complete observation fields, including original IDs, qualifiers and source locators. Original values remain unchanged.

High-flow support applies only where the retained source explicitly identifies the same station as eligible for the original flow series. An unrelated nearby gauge is not substituted. A calendar cannot ensure a future storm.

The handoff section shows exact required catchments, unbound targets and conflicting station bindings. Those assignments need resolution in the maintained network workflow before preparing a compatible native design.

## Save, revise and reopen

Choose **Save recommendation** to retain the complete selection, original context and calculated support.

Choose an existing entry under **Saved sampling edition**, then **Open saved edition** to reopen that exact source-bound result. Edit the targets and choose **Save new revision** to retain a new immutable child. The request carries the original parent ID as its expected parent identity. **Open original parent edition** returns to the retained preceding edition.

Refreshing the saved catalog does not discard an in-memory draft. Changing the selected context or opening another saved edition asks before replacing unsaved target or design edits. Navigating away and back in the same operator session preserves the Workspace's draft. Closing or reloading the browser warns about unsaved edits; only saved editions are durable Workspace records.

Recording time remains explicit when making a revision. Update it to the time the operator records the revised proposal.

## Prepare the existing Monitoring design

Open **Prepare an original Monitoring design from the saved edition**.

When the observed context refers to an original saved plan, its complete design configuration seeds this form. Otherwise the numeric planning fields remain blank and require explicit input. Review the native programme budget, maximum sites, overhead, setup and visit costs, cost basis, dates, round interval, crews, duration and travel allowance.

Additional original configuration remains visible as a JSON object. Unexposed fields and original default-cost/calendar metadata survive. The visible controls take precedence over their corresponding JSON values. Review cost provenance whenever changing the figures.

The exact required catchments shown from the saved recommendation are included in the submitted configuration. Extra required IDs may be retained through the additional configuration. Station bindings and laboratory/event-trigger requirements remain explicit.

Choose **Prepare Monitoring design**. This invokes the existing native solver with the complete reviewed configuration. Unknown itemized proposal costs do not become invented native costs: the native design still requires its own complete configuration.

Inspect the returned feasibility status and target/calendar comparison. Calendar visits are compared against the proposed visit counts in the chosen months. A feasible geographic design does not itself satisfy every analyte, reporting-limit or future high-flow objective.

Choose **Open design and field calendar** to open the exact saved plan in the original Monitoring component. Reopened sampling editions list their already-prepared designs as **Open saved design and calendar**. The Monitoring component retains responsibility for calendar and campaign preparation.

## Export and receive

**Export saved edition and original sources** prepares the original model's complete report/source package and exposes its authenticated file ticket. It exports the retained saved edition even if separate unsaved form edits exist.

**Export editable study** opens the existing Study transfer workflow with this exact saved recommendation as its selected root. Review the dependency closure and prepare the original study archive there. This is the editable Workspace transfer path; the report/source ZIP is a separate output.

The original context and original field values remain available in the complete export. View filters never reduce source attachments. Reopen or import through the maintained receiving workflow rather than reconstructing a saved recommendation from a summary table.

## Original queued operations

Prepare, design and report export run through the existing operator task queue. **Open retained operation** opens that exact task.

If the HTTP response is uncertain, **Resume original request** reuses the original operation ID and unchanged payload. It does not generate a second submission. If the task itself failed or was cancelled, inspect and resume it through the original task controls. The UI retains its request and draft.

Workspace changes and detached views invalidate outstanding display updates. A late response cannot replace another Workspace's current selection. Accepted work remains in its original Workspace and queue.

## Integration

The additive registry extension is monitoring-recommendations, titled Sampling priorities. The browser factory is attachMonitoringRecommendations and the sources are:

- operator/web/monitoring_recommendations.mjs
- operator/web/monitoring_recommendations.css
- operator/SAMPLING_PRIORITIES.md

The original extension host supplies getState, api, endpoint, showTask, toast and openDesk. No shared app or Monitoring component rewrite is required.

Reads use GET /api/monitoring-recommendations with workspace, action and a JSON payload. Actions are catalog, context, preview, get and list. Mutations use POST /api/actions with monitoring.recommendations.prepare, monitoring.recommendations.design or monitoring.recommendations.export, the original Workspace, complete payload and stable operation_id.

Saved design navigation calls monitoring.openStudy with kind monitoring_plans. Original context navigation uses monitoring_observed_contexts. Editable transfer calls study-transfer.openForStudies with the exact monitoring_recommendations root.

## Verification scope

The maintained browser module was executed with an explicit DOM and host-API adapter for context selection, target entry, preview, ambiguous-response retry, save, immutable revision, native design configuration, export and exact downstream navigation. The course checks zero versus unknown values, original unexposed configuration, source-bound required IDs and workspace-change rejection of stale responses.

This source/controller course is separate from a native Python execution or actual browser-pixel review. The accepting native host should operate the same installed extension with its actual saved context, inspect the report/source package, prepare a justified native design, export an editable study and reopen it through the original receiving route.

## Producing and receiving ownership

Carry the current application AGENTS.md (owner rule version 2026-10-13.1) and CURRENT_OWNER_DIRECTION.md (current read version 2026-10-13.4) into the same producing/receiving operation. Preserve subsequent direct owner instructions and the actual equipped operator's active processes and source choices.

Before presenting the outgoing product, the producing worker must open the exact populated application, LOOK at its actual screen or viewed screenshots at the presentation width and a narrow width, and operate the controls above. Open and use every outgoing attachment, including the HTML report, CSV/JSON sources and editable archive after fresh receiving. Repair actual visible defects in the same source. Keep this inspection focused on the delivered workflow; source execution and API adapters do not substitute for the rendered product.
