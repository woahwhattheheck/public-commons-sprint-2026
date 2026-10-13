# Original utility evidence across saved budget choices

A saved Monitoring budget comparison can now explain its original utility objective and evidence alongside every existing solver result. Open the saved comparison in Monitoring and use the existing comparison packet download. Its original budget table, baseline, calendars, figures and selected/removed search-area accounting are preserved.

For a utility network prepared through Regional watersheds, the additional sections identify the exact original whole-HUC utility choice, projected hectare target and historical station source. They use the same completed utility preparation as the ordinary plan/campaign report.

## Read the utility budget table

The table preserves each original comparison row and its solver outcome. Its area columns use the original EPSG:5070 vector overlap-hectare objective:

| Column | Source |
|---|---|
| Total covered (ha) | Saved plan coverage.covered_weight. |
| Existing credit (ha) | Saved plan coverage.baseline_weight. |
| New covered (ha) | Existing native comparison new_covered_weight. |
| Change from baseline (ha) | Existing native comparison delta.covered_weight, available only when the choice and selected baseline are feasible. |
| Historical stations in selected search areas | Original native station assignments whose catchment is in that plan's selected_ids; unavailable if its station source was not selected. |
| Planned visits | The original feasible plan calendar's visit count. |

The source JSON and CSV also retain budget in integer cents, currency, original selected/covered HUC IDs, chosen contextual areas, utility export/preparation IDs and exact plan/context identities. Human-readable HTML prints the original currency amount.

A historical station inside a selected catchment does not become a field commitment or receive existing-programme credit. These frontier plans are plan records, so their calendar has no later campaign event history. Open a saved campaign's ordinary report to inspect planned versus event-effective station choices.

An infeasible, interrupted or otherwise unavailable solver outcome has unavailable coverage and calendar values. The comparison does not replace those quantities with zero or assign it a feasible context. When every choice is unavailable, the original utility evidence and every solver outcome still remain in the packet.

Utility projected overlap hectares and native geodesic catchment square kilometres are distinct definitions. The saved scientific figure's utility axis is labelled Total covered target overlap (ha). It plots the original feasible plan values without interpolation to unsolved budgets or a claim about measured water-quality improvement.

## Original evidence, once per edition

The comparison package includes each original utility source report once under:

    utility-sources/<original-utility-export-id>/

This directory contains the unchanged original selection, source briefing and its ordinary source members at their original relative paths. Several plans reference those same files, avoiding repeated copies of the same source edition.

Each feasible plan retains its own area/station explanation under:

    utility-context/<context-id>/

Its standalone report links back to the shared original source directory. These records preserve the original observation cohort and its geography, dates, method/activity/unit groups, detection states, Information Only markers and source comments. Regional nutrient and flow context keeps its regional scope.

The package root adds utility-comparison.json and utility-budget-context.csv. The JSON binds the original comparison, ordered plans, network, complete original utility preparations, source descriptors and every context. All members remain in the existing native byte-and-hash manifest.

ARJWS and Pioneer remain independent original selections. Neither catchment areas nor observation cohorts are added across potentially overlapping utility scopes.

## Preserve old downloads

The original saved comparison remains immutable. An enriched utility presentation has its own identity, derived from that comparison, its actual source/context records and the installed presentation source.

New packets are retained beneath the original comparison export directory at:

    presentations/<utility-presentation-id>/monitoring-budget-comparison.zip

This gives a new presentation edition an independent path. An earlier packet for the same saved comparison remains intact, including an older generic report. Repeating the same edition reuses and verifies its complete native archive through the existing streamed packet writer.

The result retains the original comparison_id/frontier_id/network_id and adds utility_presentation_id. Existing native download controls consume the same ordinary file result.

## Saved scientific reports

Use the existing Monitoring comparison report-source action. The producer first checks every original archive member, the exact saved comparison/plans/network and selected observed-support contexts. It then validates the utility presentation and each plan-specific context against their original sources and exact calendar.

The ordered scientific report adds:

1. The actual hectare coverage and utility budget table.
2. Shared original utility evidence with its source scope and observation qualifications.
3. Per-feasible-plan catchment and station tables.
4. Original source links and complete offline companion files.

The existing budget/coverage figure, original plan maps and compound observed sources remain in place. Original source cohorts appear once per retained utility preparation in the additional shared evidence section. The actual plan-specific geometry and station joins remain separate.

The report-source identity also binds the utility presentation implementation. Existing saved report directories, previous selections and originals stay readable.

## Maintained APIs

No new user-facing operation is needed.

    from model import monitoring_frontier_comparison
    result = monitoring_frontier_comparison.export_comparison(
        workspace, comparison_id=actual_saved_comparison_id,
        export_root=actual_output_directory)

For the existing ordered report source:

    from model import monitoring_report_source
    result = monitoring_report_source.prepare(
        workspace, {"comparison_id": actual_saved_comparison_id})

Both APIs consume actual previously saved frontier records. The utility extension never calls the solver, changes a budget, supplies dates, assigns a station or rewrites a campaign.

The additional model.utility_monitoring_comparison helper builds the source presentation, streams shared original members, validates the original bundle and supplies ordered report blocks. model.utility_monitoring_report retains its existing default single-plan/campaign behavior while allowing the comparison to select exact context IDs and shared original member locations.

## Continue the same original receiving

Use the existing utility Monitoring Workspace and actual reviewed programme/frontier choices. Download the original saved comparison, open report.html after extracting its complete packet, follow a feasible plan's area/station report, and open its original source briefing.

Prepare the existing comparison scientific source and append it to the current ordered report through the maintained workflow. The original complete Workspace backup/restore remains the editable receiving path.

This extension needs no new receiver, source download or model run. It preserves the source editions and actual plan results already operated by the existing course.

## Original-source work across larger comparisons

A comparison loads its matching completed utility preparations and original report inventories once. Every feasible plan derives its area, station and calendar interpretation from that same operation-local snapshot. Infeasible choices retain their original unavailable values.

Per-plan metadata generation does not reopen or hash the shared original report files. At packet assembly, each original source export is reopened once, its descriptor inventory is compared with the retained snapshot, and each ordinary member is verified and streamed once into the shared utility-sources directory. The maintained packet writer independently verifies the actual streamed byte count and SHA-256.

The source snapshot belongs to one export operation; it is not a persistent cache and is never reused across another Workspace or a later invocation. The saved context still includes original preparation record identities and original source descriptors. A changed source inventory fails assembly before the new complete archive is published. Existing single-plan and campaign exports retain their normal full original-source checks.

This makes original-source loading and archive assembly scale with the distinct source editions rather than with the number of budget choices. Per-plan calculations and metadata still scale with the actual plans, catchments, stations and calendars. No measured runtime is implied.
