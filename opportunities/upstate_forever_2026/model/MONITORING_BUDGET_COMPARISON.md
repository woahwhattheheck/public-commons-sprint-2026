# Saved Monitoring budget comparisons

Open Monitoring design, select the original network, and reopen a saved budget frontier. Its plans were calculated independently at each retained budget. The comparison uses their original native records; opening, saving or exporting a comparison does not execute the optimizer.

## Original scientific meaning

The native frontier's ordered plan IDs are authoritative. A separately created campaign can use a different plan ID even when its budget, selected count and configuration resemble a frontier plan. Open campaigns by their exact revision plan ID.

The comparison checks that every plan belongs to the original frontier job and network and that configurations differ only in budget. It retains all feasible, infeasible and unfinished solver outcomes. Unavailable cost, coverage and calendar values remain unavailable.

The original default objective is geodesic source-catchment area in square kilometres; a network with a priority property retains that property's original weight basis. Coverage is over the complete model-source network, including upstream contributors. A reporting-boundary intersection has a separately identified geography. The comparison exposes total coverage, existing-station baseline weight, new covered weight, and exact change from the chosen comparison baseline. Higher-budget site sets need not contain lower-budget sites.

Money remains integer cents with the original currency. Native cost records retain overhead, per-site scope, remaining budget and treatment of existing-station costs. The original calendars and solver status/gap remain attached to each plan. The printable table uses four decimal places and scientific notation for smaller nonzero values; the saved JSON and CSV retain the original values.

## Observed support

Attach at most one saved observed context for each exact frontier plan. The native context reader verifies its original source edition, network, plan and any retained campaign revision. A historical campaign context remains an explicitly dated revision even after that campaign advances.

The comparison shows matched original source stations, activities and observations within the selected search areas. It also retains source period, station mapping, flow scope, coordinate review and the full native summary. Observed support can be compared across rows only with its original source/mapping/flow scope visible. Historical flow and observations are never shifted onto later calendar dates.

For the original 87-station regional network and the four-station Eighteenmile source, use the explicit original identifier mapping when preparing contexts:

~~~json
{
  "21SC60WQ_WQX-SV-233": "SV-233",
  "21SC60WQ_WQX-SV-376": "SV-376"
}
~~~

The other two source stations are absent from that network. This mapping comes from the original station IDs and matching retained coordinates, not a nearest-station substitution. Prepare each context against its actual frontier plan through the existing Monitoring observed-context workflow, then attach its returned context ID.

## Native command/API

The existing GET /api/monitoring route exposes:

- comparison.preview: frontier_id, optional baseline_plan_id, context_ids and title.
- comparison.get: comparison_id.
- comparison.list: optional frontier_id.

The existing POST /api/actions queue exposes monitoring.comparison.prepare with the same selection, and monitoring.comparison.export with comparison_id. Exports use the original durable request/operation capture, task completion and file-ticket download flow.

The saved native collection is monitoring_frontier_comparisons. Its schema is upstate.monitoring_frontier_comparisons/v1 and recipe is upstate.monitoring-frontier-comparison/1. Original full-record fingerprints and source identities are rechecked when reopening or exporting. Full Workspace receiving invokes this comparison verification through the maintained Monitoring extension.

Use the actual original regional frontier:

~~~json
{
  "frontier_id": "2c1c770ffb1b00c85995a58ad93823407a628052b7b2b01d58aeced5387d12e5",
  "title": "Upper Savannah saved field-budget comparison",
  "context_ids": []
}
~~~

Omitting baseline_plan_id selects the first original ordered frontier plan. After choosing original contexts, retain their actual IDs in the selection.

~~~sh
python -B -m model.monitoring_frontier_comparison --workspace ACTUAL_WORKSPACE \
  prepare --selection ACTUAL_SELECTION.json --output saved-comparison.json
python -B -m model.monitoring_frontier_comparison --workspace ACTUAL_WORKSPACE \
  inspect --id ACTUAL_COMPARISON_ID
python -B -m model.monitoring_frontier_comparison --workspace ACTUAL_WORKSPACE \
  export --id ACTUAL_COMPARISON_ID --output ACTUAL_EXPORT_DIRECTORY
~~~

The original completed regional result has three optimal budgets: USD4,800 / six sites, USD9,000 / twelve sites, and USD13,200 / eighteen sites. Read all exact plan IDs and quantities from the saved frontier rather than substituting the separate six-site campaign's plan.

## Portable report and source packet

The streamed ZIP includes a printable plain HTML report, exact CSV table, saved comparison and selection JSON, full original frontier/network/plans, every original network source body and companion, plus complete selected observed-context reports/tables/source editions. Repeated observed source bodies share their binding-derived packet directory. Every ZIP member is checked against its retained byte count and SHA-256 during streaming.

Open index.html after extracting the complete ZIP. Its readable directory links the comparison, original plans, each selected observed-context report and table, and every retained source member. File paths, byte counts and SHA-256 values come from the same descriptors used to stream the archive; names with spaces or punctuation remain usable links.

Export edition 2 records index.html as its entrypoint and receives into an edition-specific ZIP directory. Existing saved comparison IDs and numerical records remain unchanged. An earlier completed export keeps its original packet; requesting a new export creates the indexed edition without replacing that packet.

The source/report packet accompanies the full editable Workspace archive. Complete Workspace backup/restore preserves the saved comparison and its original record dependencies. Reopen the comparison through the same native reader after receiving; do not reconstruct plan or campaign identities from labels or totals.

## Receiving verification

Operate this against the existing actual regional Workspace. Reopen its original frontier, compare all three completed plans, save and reopen the comparison, export its complete packet, then receive the full editable Workspace and reopen the same comparison. Add the original observed contexts through their actual plan selections. Check the source units, infeasible-result display and exact selected-set differences while inspecting the normal product flow.

The current implementation preserves the microbial observed-context, fieldwork return, selected study transfer and streamed export features already in the maintained application.
