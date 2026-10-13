# Find in the current workspace

**Find in workspace** opens a neutral search panel in the original operator header. Use the button or **Ctrl+K** on Windows/Linux and **Command+K** on macOS. It works before an additional desk has been opened.

Search by a desk name, scientific case, parameter profile, task action or original identifier. An exact identifier is ranked ahead of title and metadata matches. Select a **Type** or actual retained **State** to narrow the results. The panel shows 25 results per page; all matching retained destinations remain reachable with the page controls.

## Discover, inspect and continue

1. Open a scientific workspace, then open **Find in workspace**.
2. Enter a name or original ID. Native runs include their retained scenario and profile names. Comparisons and deliveries include their original linked run names; operations include their retained action and selected record references.
3. Use Arrow Up/Down to select a result, Page Up/Down to move through longer results, and Enter to open it. Mouse selection uses the same original destination. Escape or Close returns focus to the previous control.
4. A desk uses the current application's navigation, a retained item uses its original detail view, and an operation opens its existing task detail and continuation controls.
5. Successfully opened destinations appear first when the search is empty. **Clear recent destinations** clears that workspace's browser history for this panel.

The panel lists the actually registered navigation desks and the original supported core record types: source editions, profiles, scenarios, model grids, native runs, observations, model/observation comparisons, deliveries, spatial reviews/exports, community tables/plans/reports, planning inventories, portfolios/reports and parameter studies. It also lists the current workspace's retained operation tasks. Additional extension records continue to be reached through their registered desks.

Changing a workspace closes the finder and clears its current query and selection. Recent destinations are stored separately for each workspace. They contain only destination keys and opening timestamps; every recent entry is resolved against the current retained catalogue before it can open. A removed destination disappears from search and recent results.

The original operation form retains ownership of an in-progress draft. Close that form before opening Find. A record detail may remain open underneath Find; opening a result follows the original detail/navigation behavior.

## Current state and focus

The index is built locally from the operator's current compact state and actual sidebar destinations. It does not open every native record, inspect raster contents or request a separate polling stream. The existing state refresh updates an open finder while retaining its search text, filters, selected destination, keyboard focus and text cursor. When the finder is closed, state updates perform only workspace checks; the next opening reads the current catalogue.

Only known original metadata and relationships enter the search index. Scientific data rows, raster values, artifact inventories and arbitrary extension object graphs are left with their existing readers. Full original IDs remain visible on each result.

The selected destination is checked against the current workspace immediately before routing. Finder routing closes the prior detail and invalidates its pending request before opening the chosen destination. The task detail reader now uses the same original request identity guards as the item reader, preventing a delayed task poll from reopening an old modal over the requested destination. A failed open returns to the same finder selection with the actual error. Source state and scientific records remain governed by their existing owners.

## Receiving the complete component

This component uses six source paths:

- `operator/web/workspace_finder.mjs`: local catalogue, ranking, panel and lifecycle.
- `operator/web/workspace_finder.css`: scoped neutral presentation and visible focus.
- `operator/extensions/workspace-finder.json`: the two static assets.
- `operator/web/app.mjs`: original header attachment, fresh-state update and guarded workspace reset.
- `operator/WORKSPACE_FINDER.md`: this workflow.
- `integration/application_components.json`: required `workspace-finder` family and its complete source members.

The descriptor registers assets without adding a new desk, scientific backend, execution action or polling endpoint. The current server's ordinary extension asset transport serves the module and stylesheet. The original app attaches the header/shortcut eagerly; existing additional desk controllers retain their lazy lifecycle.

Receive the complete current application through its maintained cumulative installer, preserving the newer ECSA, guided-journey and scientific-source-root components. The required family includes the new module, stylesheet, descriptor and guide; `core` retains the app and component catalogue. Restart the current operator after source reception so its installed asset registry includes the finder.

Original destinations remain `navigate(view)`, `openItem(kind, id)` and `showTask(id)`. This component does not submit work while searching or opening a result. Native execution, delivery, source operations and continuation occur through those original destination controls.
