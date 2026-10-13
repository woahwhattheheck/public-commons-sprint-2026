# Saved Monitoring budget choices

The Monitoring design desk opens completed native budget frontiers and saves comparisons without running the optimizer again. Each row retains its own native plan, selected catchments, calendar, cost calculation and original source objective.

## Open the actual saved plans

1. Open **Monitoring design** in the Workspace that contains the native network and frontier.
2. In **Saved budget choices**, choose **Saved frontier**. The desk reads the complete saved frontier and each ordered original plan. It previews a comparison against the first plan.
3. Choose **Baseline plan** and a meaningful **Comparison title**, then select **Preview comparison**. A baseline may be any original frontier plan. If that plan has no feasible result, unavailable differences stay unavailable.
4. Select **Open original plan and calendar** on a row. The existing native map, calendar, constraints, original report controls and fieldwork workflow now use that exact plan.
5. Campaign buttons appear only when the campaign's current revision names that exact plan. A different campaign with the same budget or number of search areas does not become associated with the frontier.

The saved regional six-search-area campaign and the frontier's six-area plan can have different IDs because the frontier retains its own job metadata. Open the exact desired native record. The comparison reads the original frontier rather than pairing records by similar titles or costs.

## Read the differences

The first table shows budget, solver status, selected search areas, total cost, total covered weight, new covered weight, change from the chosen comparison baseline, and planned visits. Monetary values come from native integer cents and the saved currency. Missing results are displayed as **Unavailable**.

**Total covered weight** includes the original existing-station baseline. **New covered weight** excludes that baseline. The separate comparison difference measures the change between two independently optimized plans. All three measures use the retained network's weight basis. A source objective expressed as catchment area differs from a source priority score; the desk displays the exact original objective.

Each plan includes the original scenario maximum sites, calendar site capacity, calendar period and overhead. Expand **Selected search-area changes** to inspect the actual added, removed and retained catchment IDs. Independent budget solutions can replace locations, so a larger-budget plan need not contain every location in the baseline.

Selected catchments are search areas. Existing station coordinates inside those areas remain candidate locations until the native campaign records explicit station bindings. A count of candidate stations or historical samples does not assign future field visits to those stations.

## Attach original observed support

The per-plan **Observed support** selector accepts a saved context only when it belongs to that exact network and plan. A context tied to an earlier campaign revision remains identified as that recorded revision even if the campaign later advances.

To prepare a context:

1. Select **Open plan and observed support** for the desired budget row.
2. In the existing **Observed support for this network** panel, choose the retained original source edition.
3. Enter any necessary explicit source station mapping, preview it, and inspect unmatched sources, original sample periods and calendar support.
4. Save the context using the original panel.
5. Return to **Saved budget choices**, select **Refresh saved choices**, and select the saved context for that plan.
6. Repeat for the other plans, then preview the comparison.

For the retained Eighteenmile nutrient context and original 87-station network, the documented exact mapping is:

```json
{
  "21SC60WQ_WQX-SV-233": "SV-233",
  "21SC60WQ_WQX-SV-376": "SV-376"
}
```

The original coordinates for those two source/native pairs match. SV-245 and SV-375 are absent from that network and remain unmatched. Confirm the selected source edition and network before using this mapping. The original context engine preserves activity IDs, observation qualifiers and time/flow scope; the comparison does not rewrite them.

For each attached context the comparison displays the original source period, candidate source station count, activities and observations in selected search areas, and whether its source, mapping and flow scope equal the chosen baseline's. **Open retained observed support** reopens the exact saved context in the original panel. Full source identities and the recorded campaign revision remain in expandable details and the exported record.

## Save, export and reopen

Select **Save comparison** to write the immutable native comparison through the original task queue. It then appears in **Saved comparison**. Title, baseline and context changes create a new saved comparison when saved; they leave the prior edition available.

Select **Download complete comparison** after saving or reopening. The existing authenticated file ticket delivers a ZIP containing:

- A printable HTML report and exact CSV summary.
- The complete comparison and its original selection recipe.
- Original frontier, network and every saved native plan.
- Full original source members and any attached observed-context source/report family.
- A member manifest with original byte counts and hashes.

Use the application's full Workspace backup/restore for an editable received project. Reopen **Monitoring design → Saved comparison** in the receiving Workspace. The original comparison verifier reopens the exact retained plans and source/context identities.

Queued preparation and export use the maintained Monitoring request ledger. If an HTTP reply is lost, retry the same operation to recover its original task. Failed or interrupted tasks remain visible in the native task panel for resumption. Unrelated task refreshes preserve the chosen title, baseline and per-plan context choices. Workspace switches keep each workspace's desk state separate.

## Integration

The frontend adds `monitoring-frontiers.mjs` and `monitoring-frontiers.css` through the existing Monitoring descriptor. The existing adapter registers three reads (`comparison.preview`, `comparison.get`, `comparison.list`) and reuses the original queued actions for `comparison.prepare` and `comparison.export`.

The original native frontier button still runs the same `frontier` request. Its completed result now opens in the saved comparison workflow. Opening saved choices does not invoke that button or queue a new solve.

WATERLINK open-network behavior, observed-context mapping and reports, campaign field returns, implementation/fieldwork and study transfer remain on their original components. Their current source is preserved; the helper composes through the native adapter lifecycle and existing saved-plan/source controls.
