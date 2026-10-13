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

Refreshing the saved catalog does not discard an in-memory draft. Changing the selected context or opening another saved edition asks before replacing unsaved target or design edits. Navigating away and back in the same operator session preserves the Workspace's draft. Closing or reloading warns about unfinished edits and unresolved requests. Saved recommendations and saved working-copy editions are durable Workspace records. Use the working-copy controls below to retain incomplete planning work.

Recording time remains explicit when making a revision. Update it to the time the operator records the revised proposal.

## Prepare the existing Monitoring design

Open **Review, revise and prepare a Monitoring design**.

When the observed context refers to an original saved plan, its complete design configuration seeds this form. Otherwise the numeric planning fields remain blank and require explicit input. Review the native programme budget, maximum sites, overhead, setup and visit costs, cost basis, dates, round interval, crews, duration and travel allowance.

Additional original configuration remains visible as a JSON object. Unexposed fields and original default-cost/calendar metadata survive. The visible controls take precedence over their corresponding JSON values. Review cost provenance whenever changing the figures.

The exact required catchments shown from the saved recommendation are included in the submitted configuration. Extra required IDs may be retained through the additional configuration. Station bindings and laboratory/event-trigger requirements remain explicit.

Choose **Prepare Monitoring design**. This invokes the existing native solver with the complete reviewed configuration. Unknown itemized proposal costs do not become invented native costs: the native design still requires its own complete configuration.

Inspect the returned feasibility status and target/calendar comparison. Calendar visits are compared against the proposed visit counts in the chosen months. A feasible geographic design does not itself satisfy every analyte, reporting-limit or future high-flow objective.

Choose **Open design and field calendar** to open the exact saved plan in the original Monitoring component. Reopened sampling editions list their already-prepared designs. Select **Retained native design**, then **Use selected design configuration** to load that exact design, including its original cost basis, calendar and unexposed configuration. Review its original feasibility, budget, calculated cost, remaining budget and target/calendar results. The differences table compares the selected design with the current authored inputs; differences do not predict a calculated outcome. Prepare a new design through the original action to calculate the revised choices. **Open saved design and calendar** opens the retained native plan. The Monitoring component retains responsibility for calendar and campaign preparation.

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


## Save and reopen unfinished working copies

**Working copies and exact request recovery** retains the complete current targets and design form. Enter a working-copy title, responsible operator and notes, then choose **Save working copy**. A selected existing working copy produces **Save new working-copy revision** with its exact immutable parent identity. Changing the observational context starts a new family.

A working copy may contain an unfinished rationale, empty targets, unknown costs or incomplete advanced JSON text. It is an editable planning record. Saving it does not validate a new scientific proposal or invoke the Monitoring solver. A saved original design remains unchanged.

Select **Saved working copy**, then **Open saved working copy** to reopen its source-bound editor state. **Download current working JSON** retains current edits and exact unresolved requests even when no working edition has been saved. **Open a working JSON file** first checks its project, observational context, recommendation and selected design against their retained originals. Review the displayed identities, then explicitly choose **Open reviewed working copy**. A rejected or stale opening leaves the current work available.

The original IDs and digests travel together. Opening does not substitute another project's context, fill a missing identity, reconstruct original source values, or dispatch a solver operation. The editor retains zero, blank, null, source labels and full advanced text. The JSON opening limit is 8 MiB.

**Export working copy, review and original sources** exports the selected saved working edition, not later unsaved changes. It includes readable `sampling-working-review.html`, exact `working-copy.json`, immutable history, selected native design/configuration, all referenced original evidence and their declared member identities. The readable comparison records authored input changes; original outputs remain separately identified.

**Export complete editable Workspace** uses the original full Workspace backup, including the working-copy records. Restore that archive through the original application before opening its working JSON on another machine. The selected-Study path remains available for saved scientific recommendations; it does not implicitly include these separate working-copy records.

Native commands, exact file schema, complete source membership and the restore command are documented in [Sampling working-copy CLI and receiving](../source_tools/SAMPLING_WORKING_COPIES.md).

## Continue uncertain operations without losing later work

**Resume original request** uses the exact original operation ID and payload. The current browser may retry an unacknowledged original submission through the maintained idempotent queue. Once a task ID is known, recovery reads that exact original task and verifies its Workspace, action and payload.

**Keep original request and continue editing** retains the request separately and unlocks the current draft. It does not cancel an accepted task. A failed working-copy save can also be retained so its rejected input remains available while you correct the draft.

**Inspect or recover this exact request** requires the confirmed original native task. It never submits an imported request solely because a Workspace label matches. An imported request with a foreign or unavailable task remains in the working file for original operator reconciliation. For an unacknowledged request without a task ID, use **Resume original request** before retaining it when the current original session is available.

Recovering an earlier completed recommendation or design keeps later target/design edits. **Open the completed recommendation** explicitly opens the original result. Saved JSON includes the pending and retained request identities, their payloads, task IDs and original workspace metadata.

Working-file preview is a read-only POST to the existing `/api/monitoring-recommendations` route, so complete files are not put into URL query strings. New queued actions are `monitoring.recommendations.working-save` and `monitoring.recommendations.working-export`. All operations remain in the installed operator, with its original authenticated queue and file tickets.

## Complete receiving course for this continuation

Continue the existing Sampling producing operation on its actual retained observational context and justified proposal. Preserve active native work and the permitted browser boundary.

1. Open a saved recommendation and an actual saved native design. Select **Use selected design configuration** and confirm its title, original configuration, budget, costs, calendar and exact native plan identity.
2. Enter a justified changed budget or field-calendar setting. Check the exact differences, then save a named working copy with the reason and operator. Keep original solver outputs separate.
3. Download working JSON, switch to another saved entry, then open the file and explicitly adopt the reviewed source binding. Confirm all entered fields, including advanced text, are retained.
4. Make a further change and save a working-copy revision. Open the parent and child independently. Confirm the original is unchanged.
5. With a complete valid configuration, prepare the revised Monitoring design through the original queue. Open its native field calendar and compare the actual retained results. Record infeasibility honestly when that is the native result.
6. Export the selected working bundle and the complete editable Workspace. Open every generated HTML/JSON/CSV/source attachment. Restore the full Workspace to a fresh owned directory; reopen the same working ID and verify all original bindings and editor choices. A restored workspace does not prove an original operator task survived.
7. Operate the actual extension at desktop width and 390 pixels, personally view the rendered screens and attachment pages, and repair concrete display or workflow failures in the same source.

The maintained controller course executes the full source callbacks using explicitly authored DOM/API/storage adapters. It checks exact original configuration/provenance, incomplete JSON retention, immutable working save, transactional opening failure, source mismatch, uncertain acknowledgement retention, later-draft preservation during verified older-task recovery and foreign-workspace rejection. This is source execution, not a native solver run or browser-pixel result.


## Producing and receiving ownership

Carry the current application AGENTS.md (owner rule version 2026-10-13.1) and CURRENT_OWNER_DIRECTION.md (current read version 2026-10-13.4) into the same producing/receiving operation. Preserve subsequent direct owner instructions and the actual equipped operator's active processes and source choices.

Before presenting the outgoing product, the producing worker must open the exact populated application, LOOK at its actual screen or viewed screenshots at the presentation width and a narrow width, and operate the controls above. Open and use every outgoing attachment, including the HTML report, CSV/JSON sources and editable archive after fresh receiving. Repair actual visible defects in the same source. Keep this inspection focused on the delivered workflow; source execution and API adapters do not substitute for the rendered product.
