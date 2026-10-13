# Find in the current workspace

**Find in workspace** opens a neutral search panel in the original operator header. Use the button or **Ctrl+K** on Windows/Linux and **Command+K** on macOS. It works before an additional desk has been opened.

Search by a desk name, scientific case, parameter profile, task action or original identifier. An exact identifier is ranked ahead of title and metadata matches. Select a **Type** or actual retained **Record state** to narrow workspace records. Saved Studies have a separate catalogue section and their own page controls. The panel shows 25 results per page; all matching retained destinations remain reachable with the page controls.

## Discover, inspect and continue

1. Open a scientific workspace, then open **Find in workspace**.
2. Enter a name or original ID. Native runs include their retained scenario and profile names. Comparisons and deliveries include their original linked run names; operations include their retained action and selected record references.
3. Use Arrow Up/Down to select a result, Page Up/Down to move through longer results, and Enter to open it. Mouse selection uses the same original destination. Escape or Close returns focus to the previous control.
4. A desk uses the current application's navigation, a retained item uses its original detail view, and an operation opens its existing task detail and continuation controls.
5. Successfully opened destinations appear first when the search is empty. **Clear recent destinations** clears that workspace's browser history for this panel.

The panel lists the actually registered navigation desks and the original supported core record types: source editions, profiles, scenarios, model grids, native runs, observations, model/observation comparisons, deliveries, spatial reviews/exports, community tables/plans/reports, planning inventories, portfolios/reports and parameter studies. It also lists the current workspace's retained operation tasks. Individual imported source files and saved Scientific Reports are indexed from the same compact state. Saved Studies use the original on-demand Study catalogue, including modern extension study families. Additional extension records continue to be reached through their registered desks.

Changing a workspace closes the finder and clears its current query and selection. Recent destinations are stored separately for each workspace. They contain only destination keys and opening timestamps; every recent entry is resolved against the current retained catalogue before it can open. A removed destination disappears from search and recent results.

The original operation form retains ownership of an in-progress draft. Close that form before opening Find. A record detail may remain open underneath Find; opening a result follows the original detail/navigation behavior.

## Current state and focus

The index is built locally from the operator's current compact state and actual sidebar destinations. It does not open every native record, inspect raster contents or request a separate polling stream. The Saved Studies section requests one 25-record page when Find opens, the query changes, or its page controls are used. Routine state polling does not repeat that request. The existing state refresh updates an open finder while retaining its search text, filters, selected destination, keyboard focus and text cursor. When the finder is closed, state updates perform only workspace checks; the next opening reads the current catalogue.

Only known original metadata and relationships enter the search index. Scientific data rows, raster values, artifact inventories and arbitrary extension object graphs are left with their existing readers. Full original IDs remain visible on each result.

The selected destination is checked against the current workspace immediately before routing. Finder routing closes the prior detail and invalidates its pending request before opening the chosen destination. The task detail reader now uses the same original request identity guards as the item reader, preventing a delayed task poll from reopening an old modal over the requested destination. A failed open returns to the same finder selection with the actual error. Source state and scientific records remain governed by their existing owners.

## Receiving the complete component

This workflow uses seven maintained source paths:

- `operator/web/workspace_finder.mjs`: local catalogue, ranking, panel and lifecycle.
- `operator/web/workspace_finder.css`: scoped neutral presentation and visible focus.
- `operator/extensions/workspace-finder.json`: the two static assets.
- `operator/web/app.mjs`: original header attachment, fresh-state update and guarded workspace reset.
- `operator/WORKSPACE_FINDER.md`: this workflow.
- `operator/web/extensions/study_transfer.mjs`: read-only focus of an original saved Study.
- `integration/application_components.json`: required `workspace-finder` family and its complete source members.

The descriptor registers assets without adding a new desk, scientific backend, execution action or polling endpoint. The current server's ordinary extension asset transport serves the module and stylesheet. The original app attaches the header/shortcut eagerly; existing additional desk controllers retain their lazy lifecycle.

Receive the complete current application through its maintained cumulative installer, preserving the newer ECSA, guided-journey and scientific-source-root components. The required family includes the new module, stylesheet, descriptor and guide; `core` retains the app and component catalogue. Restart the current operator after source reception so its installed asset registry includes the finder.

Original core destinations remain `navigate(view)`, `openItem(kind, id)` and `showTask(id)`. The added source/report destinations use the original source inspector and saved Scientific Report editor. Saved Studies focus the exact catalogue record in the original Study desk through read-only `openForFinder`, preserving the current export selection. This component does not submit work while searching or opening a result. Native execution, delivery, source operations and continuation occur through those original destination controls.

## Imported sources, Scientific Reports and saved Studies

An imported source result retains both its original collection ID and its original source ID. Source IDs are often descriptive strings, such as an annual land-cover edition; they are not coerced into a hash or assigned a new identity. The result opens the original source inspector, including its existing scientific-reader and download controls. Identically named files in two retained collections remain separate destinations. The matching collection title, source kind, role, vintage and units can also find the file.

A Scientific Report result opens its original saved edition through the existing report editor and export controls. Search includes its title, ID, operation ID and retained source references. Opening a report does not create an edition or submit a task.

With **All types** selected, matching saved Studies appear below workspace records. Choose **Saved Studies** to focus that section. It uses the backend's original literal substring query and order, with 25 results per request and separate **Previous Studies** / **Next Studies** buttons. Record state filters only the locally retained workspace records. Each Study shows its original kind, title, state and full ID. Tab and Enter use ordinary buttons to open it; arrow shortcuts continue to select workspace records. A Study result opens its exact record in the original Study desk, where the existing reader, editing and export controls remain available. The current export title, selected roots, related-record option and pending plan are preserved.

Query changes, closing Find and switching Workspace cancel the prior catalogue request immediately. A delayed response is also checked against request generation, original Workspace, query and current navigation intent before it can display or open a destination. A failed request has an explicit **Retry saved Studies** action. Source inspection and report/Study opening use the same current-intent checks through their original host controllers. Search history stores destination keys, never source bodies or report contents.

### Complete receiving workflow

The source change contains the Finder module, stylesheet, guide and descriptor, together with the original `operator/web/app.mjs` callback wiring and `operator/web/extensions/study_transfer.mjs` read-only catalogue focus. Both controllers remain owned by their existing application families; keep any newer unrelated source when receiving this complete change. Use the maintained application source receiver and restart the isolated receiving operator so its static assets come from one coherent application edition.

On the receiving scientific Workspace, open Find, search an actual imported source by its descriptive ID, inspect it, search and open an actual saved Scientific Report, and search/open a modern saved Study. Use both Study page controls with more than 25 records; change Workspace while a search is pending. Confirm an existing export selection and title survive opening a Study from Find. Open and LOOK at the actual desktop and narrow layouts, use the original destination controls, and correct any visible or functional failure. Existing retained model jobs and their original Workspace remain with their current sole writer.

Source-level JavaScript execution and controller review support this change; the receiving peer's actual browser use determines rendered acceptance. The cutoff remains 2026-10-13 14:00 UTC.

## Full current owner direction

The full current owner brief is retained here so a receiving peer has the end-state and review requirements alongside the source. Re-read the current application copy if a later owner edition is present.

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.

