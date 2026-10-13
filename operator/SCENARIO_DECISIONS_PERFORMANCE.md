# Large-cohort decision-table behavior

Version 1.1 renders a page of retained physical comparisons while the complete selected alternative, metric and reporting-scope set remains in memory for calculations and exports. It introduces no model run, scientific ranking default or new normalization method.

## Display and calculation membership

The pipeline is:

1. Compute the selected physical comparisons and each reporting scope's complete eligible choice cohort.
2. Apply table search, status and pinned-only filters to every computed row.
3. Order all matching rows, with pinned alternatives first and the selected global sort next.
4. Render the selected page, with 50 rows by default and a selectable maximum of 250.
5. Export the complete calculated comparison, independently of the displayed page or filters.

Scores, Pareto status and method ranges always come from step 1. One comparison row represents one alternative × reporting scope × metric. The status distinguishes row counts, distinct selected alternatives, selected scopes and actual comparable total pairs. The method disclosure names the eligible alternative count separately for its selected scope.

Page navigation includes first, previous, next, last and direct page number controls above and below the table. The top control changes page size. Controls reference the table with aria-controls; table row indices preserve positions in the globally filtered row order. Boundary navigation retains keyboard focus, and horizontal scroll position survives page changes.

Each page keeps actual total units, model-period/reporting-domain labels and original run/grid/profile/scenario/model identities. Missing or excluded quantities preserve their original NoData/exclusion behavior.

## Saved view and API changes

Additional state fields:

| Field | Meaning |
| --- | --- |
| table_page | One-based integer, clamped to available filtered pages. Default 1. |
| table_page_size | 25, 50, 100 or 250. Default 50. |
| method_catchment_id | Current scope displayed in the method disclosure. A missing saved id resolves to a valid current group. |

Search, filters, sort, pins and page size reset the UI to page 1. API setState restores its explicitly supplied page and clamps it after the current display filter. Existing views without these fields receive defaults.

mount and attachScenarioDecisions accept notifyAssessment:false. With this option, onChange receives the copied state and an undefined comparison argument. Hosts can retain lightweight state during navigation and request getComparison only when the complete assessment is needed, such as a save. The default callback preserves its original copied-comparison argument.

getTableView() returns:

    {
      page, page_size, page_count,
      total_rows, filtered_rows, shown_rows, first_row, last_row,
      selected_alternatives, selected_catchments, row_keys
    }

row_keys covers only the displayed page and is copied. getComparison, exportJSON, exportCSV and exportText retain every selected comparison, all reporting groups, complete eligible cohort IDs and full normalization ranges. Export JSON also retains the page and method-scope state in view_state. Printing includes the current table page; full text/CSV exports carry the complete comparison.

## Work avoided during navigation

The component caches globally filtered/sorted row references until the result, filter, sort or pins change. Moving between pages slices this cached array. Calculation keys continue to contain only the actual data revision, selected baseline/alternatives/metrics/scopes, directions and priority settings.

Reporting-scope labels are indexed once during control construction. Search text is indexed lazily for the current rows, and formatting/collation objects are reused. Baseline context and total/native comparison counts are refreshed only when computed results change. A lightweight host callback avoids serializing and copying a full assessment on every table interaction.

Method details construct only the selected reporting scope when expanded. The full eligible alternative ID list, every selected criterion including zero weights, actual min/max ranges and directions remain available. Exclusion lists expand on request. Page changes keep the selected method scope and do not rebuild its content. A changed computed assessment selects its own current group before rendering, so previous ranges cannot be displayed against a new scope.

## Focused scale check

Run the one dependency-free check from the installed application source:

    node operator/web/scenario_decisions.performance.check.mjs

It uses the actual component and a small DOM implementation to measure computation and generated element operations. The fixture contains 121 retained-run-shaped records: one baseline and 120 alternatives, 80 scopes and 3 mass-export metrics. Its 28,800 rows include a missing selected measurement in one scope, so that scope has 119 eligible alternatives and other scopes have 120. These numbers exercise UI behavior; the fixture is mechanical test input.

Observed in the available JavaScript runtime:

| Measurement | Result |
| --- | --- |
| Full comparison rows |28,800 |
| Default rendered physical rows |50 |
| Initial computation and DOM operations | 664 ms |
| Median page change, 20 changes | 19 ms |
| Maximum measured page change | 24 ms |
| Complete JSON, CSV and text export operations combined | 1,696 ms |
| onChange callbacks during the check |29 |
| Assessment copies in those callbacks with notifyAssessment:false |0 |
| JSON export size |64,546,705 characters |
| CSV export size |53,744,636 characters |
| Text export size |26,256,175 characters |

The check passed full-cohort/range/Pareto/score preservation across page changes, global search, pinned ordering, pinned-only filtering and exclusion filtering. It also passed complete exports, saved-page clamping, lazy method details and fallback from a missing saved method scope. The original 12-assertion calculation check remains the earlier accepted result; this change did not repeat or broaden that suite.

These elapsed times measure the JavaScript runtime and the supplied DOM implementation. The receiving browser supplies actual layout, painting, native keyboard behavior and connected data. The purpose of paging is to limit those costs independently of the number of calculated rows.

## Cumulative browser receiving check

Use the cumulative installed application with actual retained comparison/report data. Open Scenario decisions, select its retained baseline and alternatives/scopes, and confirm:

- Current-row status and page navigation cover the full matching selection while the table contains no more than the chosen page size.
- A search or pinned alternative outside the initial page appears with its correct physical values and retained identities.
- Opening method details and changing reporting scope shows that scope's actual eligible cohort, directions and ranges; changing pages preserves the scope and its values.
- A saved assessment reopens with the chosen filters, page size/page and method scope. Downloaded JSON/CSV/text includes every selected row.
- Keyboard navigation crosses page boundaries without losing focus, and horizontal scrolling remains in the same columns.

The receiving bridge already passes notifyAssessment:false and saves the full explicit getComparison result using the original assessment transport. Full exports can exceed 64 MB for this fixture; the table's bounded DOM does not reduce the retained assessment size. Large-assessment upload/download limits belong to that transport.

## Source integration

Replace only the authored component, scoped stylesheet and their documentation/check files under opportunities/upstate_forever_2026. The extension host, backend decisions adapter and decision_bridge.mjs have separate current owners. Their public method/selection contracts remain compatible with version 1.1.


## Export serialization refinement, version 1.1.1

A focused comparison used the exact same previously computed 28,800-row assessment to check the new CSV/text generators against version 1.1.0. Both the joined generators and the original public string functions were byte for byte identical to their predecessors. CSV retains all 53,744,636 characters; accessible text retains all 26,256,175 characters. JSON and the calculated assessment structure are unchanged.

| Export | Original string generation | New chunk generation | Joining chunks, when requested | Chunks | Largest observed chunk |
| --- | --- | --- | --- | --- | --- |
| CSV | 888 ms | 632 ms | 36 ms | 114 | 477,934 characters |
| Accessible text | 289 ms | 122 ms | 20 ms | 81 | 328,283 characters |

These are single-pass JavaScript runtime observations, not browser download timings. Separate invocations of the public complete-string methods measured 629 ms for CSV and 207 ms for text; allocation and runtime scheduling vary between invocations.

The CSV path serializes and escapes each reporting scope's complete common-alternative field once: 80 times instead of once for every one of the 28,800 rows. The text path indexes rows in one pass instead of rescanning all rows for each scope: 28,800 row-index operations replace 2,304,000 scope predicates in this fixture. The browser's default download builds its Blob from the yielded chunks, so it does not first create the additional joined CSV/text string. Required cohort membership still appears in every existing CSV field, preserving downstream consumers. Public string methods and custom onExport callbacks retain their original contract.

This refinement changes serialization and temporary allocation only. The earlier pagination calculation and DOM behavior results above remain the accepted version 1.1 check. It adds no assessment schema and no new scientific method.
