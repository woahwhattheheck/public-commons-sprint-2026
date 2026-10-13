# Conservation candidate catalog in the existing operator

The Conservation screen reads completed candidate studies through the original source-bound catalog. It retains the same study, candidate and saved-plan identities. The original full study read remains available to existing scientific and regional receiving clients.

## Open and prepare an inventory

Open **Conservation plans**, then a retained study. A completed study without a catalog offers **Prepare candidate search**. This queues the original workspace task that derives a reading index from the complete retained candidates file. Its task links back to the same study. Existing complete catalogs open directly.

Each candidate page reports the number of matching rows and the complete original inventory count. Search and sort apply on the server. Paging displays 25, 50 or 100 rows without limiting the original inventory or filtered export.

Original candidate details open individually and retain source attributes, eligibility reasons, point criteria, native quantities, original alternative values and shared-support comparisons.

## Search and quantitative filters

Search covers original unit identity, name and source attributes. Eligibility choices are all, eligible, excluded, or checked units.

Sorting supports retained rank, saved score, source and reporting areas, recorded cost, protection/water-context fractions, original ID/name, and original baseline nitrogen/phosphorus/sediment quantities. Missing quantities sort after recorded values, with original IDs breaking ties.

**Area, priority, context and quantity filters** applies numeric ranges to the complete source inventory. The controls preserve original nulls. Context and coverage controls use percentages in the browser and original fractions in the model request.

The optional native metric filter chooses the original pollutant, baseline or an actual retained alternative, value or support field, and optional recorded availability. Paired delta/reduction/shared-support fields require an alternative case. All active filters apply together.

## Check units across pages

Manual checks persist through filtering and paging. **Check eligible units on this page** adds the displayed eligible units. **Show → Checked** queries the complete checked selection rather than inspecting only the visible page.

For a large matching cohort, use **Retain all eligible matches**. This queues an immutable source-bound selected-ID record. Open the completed task and choose **Use complete retained selection**. Its original study and source/index identity remain attached.

The browser keeps the cohort reference and small explicit additions/removals. Checking or unchecking a unit on any page adjusts that exact retained cohort. **Show → Checked** and complete filtered export resolve membership on the server. The full selected-ID file remains available through the original task's download ticket.

**Clear checked units** leaves the inventory and clears the current manual/cohort selection. Choose a new filter and retain a new cohort to replace the earlier one.

## Save, reopen and export

**Create portfolio → Use my checked units** saves the exact current manual selection or source-bound cohort. A retained cohort resolves server-side before calling the original conservation plan writer; the full ID list does not make a round trip through the operator's 4 MiB input limit. The original plan records its cohort reference and explicit modifications.

Reopening that saved portfolio restores the same source study, quantities and selection reference. **Use these units in a new portfolio** restores the saved cohort and its original additions/removals before further changes. Ranked selection uses the complete study inventory and the existing original ranking rules.

**Export all matching rows** writes the complete filtered original candidate JSON and CSV, independent of page size. When viewing a retained checked cohort, the export uses that exact membership. **Export candidate inventory** and saved portfolio packet export retain their original complete behavior.

## Source composition

The catalog provider is the existing registered backend extension with exact actions:

- conservation.catalog.prepare
- conservation.catalog.select
- conservation.catalog.plan.save
- conservation.catalog.export

It adds study/status/query/candidate/selection reads under /api/conservation-catalog. The complete backend source is F0C8UBFFAN8. The cumulative source must include model/conservation_catalog.py, operator/conservation_catalog.py, operator/extensions/conservation-catalog.json and its complete method guide before this browser successor is installed.

The browser receiving continuation recognizes the real **Prepare candidate search** control when present, waits for that original queued task and returns to the same study. It checks the same two actual regional units, retains their complete cohort through **Retain all eligible matches**, and saves one original portfolio using the queued catalog selection. It verifies the exact source-bound cohort and original quantities after reloading, then downloads the original packet. An older controller without catalog controls follows its original manual save path. The native experiment-report continuation uses the same original saved scenario and experiment.

## Resume the same original browser course

Use the same receiving output directory after an interrupted process or connection. Before each catalog preparation, cohort retention, portfolio save or packet export request returns, the course records its exact Workspace action, payload and operation identity. A retry resolves that same original request through the existing idempotent queue and retains the original task ID. It validates the task's Workspace, action and original payload, and resumes an interrupted task once through the maintained task-resume control.

Recovery completes the already-requested phases before reopening the browser. The course then checks the same actual regional units, original source-bound cohort, saved portfolio and exported packet. It preserves the selected IDs and task records across retries; a previously accepted operation is not submitted under a new identity. Legacy receiving directories that already contain task IDs continue through those same tasks. Task links use the original global task panel even when another scientific operation's banner is visible.

The successor preserves the active optimizer-panel additions when composed with OP12's current full module. Native model quantities, native grid resolution and scenario/experiment computation remain owned by their existing model modules.
