# Compare saved Economic editions

Open **Economic desk → Saved inputs and completed editions → Compare saved editions**. **Compare this edition** starts with that completed edition as the first side. Choose the second original edition explicitly, in the intended comparison direction.

The comparison reads two immutable completed editions. It preserves each edition’s original modeled outcomes, sourced costs, criteria, reporting zone and decision results. It does not rerun physical models, edit either edition, convert currencies, scale costs by area, or replace the Economic input draft.

## Choose the two original editions

The selectors show each edition’s title, reporting zone and original ID. Use **First original edition** for the earlier or reference edition and **Second original edition** for the later or reviewed edition when that is the intended comparison. Every delta is **second minus first**.

Enter a useful comparison title, or leave it blank for the native default, then choose **Preview original edition changes**. The native preview verifies the two complete original editions and returns the source-bound comparison identity. Changing either edition or the title invalidates that preview; preview the current selection again before saving.

Comparisons have their own native task and recovery state. Opening the comparison dialog leaves the underlying Economic form and its original pending save/build request intact. Closing the dialog returns to that same desk.

## Read the source checks first

**Physical source comparability** shows whether the original producer report, report bytes, reporting zone, cohort and other retained definitions establish a comparable physical source. Expand **Original source checks** for the exact first and second definitions and the native reasons for any difference.

Different source definitions remain visible as different originals. A change in outputs across incompatible sources is not presented as a treatment effect or cost-only improvement. A missing original scenario remains added or removed; matching uses its original run ID, not a similar label.

The edition identity panels retain each original edition ID, producer report, reporting zone and complete source summary. The comparison report and full package retain the underlying complete sources.

## Review original criteria and decisions

**Criteria and affordability** shows original field changes, with first and second values and their JSON-pointer paths. Expand either original criteria panel for the complete prepared assessment. **Eligibility and Pareto frontier changes** retains the original membership and decision definitions from each edition.

Different criteria can change eligibility even when the physical outcomes are unchanged. The comparison reports those original decisions and criteria together. It does not infer that an eligible or Pareto scenario is an approved project, or substitute a new ranking for either saved edition.

## Inspect scenario costs and footprints

The scenario list shows original labels and run IDs, added/removed/changed status, each edition’s annualized cost and its prepared decision. Search by original label or run ID, or filter to changed, unchanged, added, removed, cost-change or decision-change records.

The count and page controls apply to the same matching set. **Download all matching original scenarios** exports every matching complete scenario comparison, including records beyond the current 25-row page.

Choose an original scenario to review:

- Original upfront capital, annual operating, annualized cost and present value.
- Each edition’s own currency and source cost definition.
- Whether currency, footprint, horizon and real discount rate match.
- Exact comparable deltas and the native reason when a delta is unavailable.
- Original cost source metadata and retained footprint.
- Original eligibility/Pareto decisions and their changed fields.
- Baseline, scenario and signed avoided-export values with their original metric units and support definitions.

Signed decimal deltas come directly from the native comparison. They are displayed without browser subtraction or rounding. Unknown or noncomparable values stay unavailable with their stated reason; they do not become zero. Negative modeled reductions remain negative.

**First original cost and source** and **Second original cost and source** show their complete retained definitions. Scope compatibility matters separately from matching currency: the original whole-scenario footprint and a reporting-zone estimate are not silently treated as the same basis.

**Download complete original scenario comparison** includes the full first and second records, original changes and source identities for the selected run.

## Preserve complete original values

**Complete selection field changes** retains the original selection, source and provenance differences. Arrays remain complete original values in the native comparison; they are not treated as a series of inferred partial edits.

Long values use an explicitly labeled text preview in the browser to keep the dialog usable. **Download complete original comparison** and the saved comparison package retain every value and full array without the display preview limit.

## Save, open and hand over

From a valid current preview choose **Save complete comparison**. The ordinary native queue retains the exact selected edition IDs, title, preview identity and original request ID.

When complete, the saved comparison appears in **Saved comparisons**. Select it to reopen its original result, or use:

- **Open complete comparison report** to view the retained client-readable report.
- Its original file/download links for the complete comparison and both full Economic packages.
- **Refresh original saved comparison** to verify and refresh its actual retained result.
- **Review this original pair** to put that pair back into the chooser; a new preview is required before saving another selection.
- **Open last completed comparison** or **Download original completion** to return to the most recently completed native operation.

The complete package contains this saved comparison and both original Economic editions and packages. Use it when the recipient needs the full before/after source, rather than only the matching-row JSON.

## Recover the same native request

The comparison uses the same complete-request storage as the Economic desk and field-cost review, under its own Workspace/owner key. The full request commits to IndexedDB before submission; local storage carries only a compact pointer.

An uncertain response leaves **Recover original request** available. Once the task ID is known, **Check original task** reads that original task and verifies its Workspace, ID, action, operation ID and full payload. Recovery does not create a replacement comparison operation.

**Open original task** exposes the maintained native queue and logs. **Resume original interrupted task** resumes that same task. A definitively failed or cancelled task can be retained with **Retain failed request and return to selection**. Active and uncertain operations stay fixed.

If persistent browser storage fails, the pending request is kept in the open dialog without being submitted. Use **Download exact recovery file**, retain the JSON, and then **Open original recovery file**. The complete hash, original Workspace and request identity are checked. The opened file permits only its exact original request to continue if browser storage remains unavailable. Keep the file and download the latest completion before closing.

A recovery file does not replace another active request or authorize a new request under a different payload. A completed recovery file may be opened for review without available browser storage; a new native request still needs its own complete retained identity.

## Native integration

The native-only browser helper is operator/web/economic_comparison.mjs. The existing Economic desk loads it from its saved-editions controls and closes it with its own lifecycle. No additional navigation desk or portable field-plan interface is introduced.

The provider supplies:

- GET /api/economic-comparison/catalog.
- POST /api/economic-comparison/preview with first_edition_id, second_edition_id and optional title.
- Queued action economic.comparison.build with the exact native preview input and expected_comparison_id.
- GET /api/economic-comparison/detail with the original saved comparison ID.

The helper uses operator/web/economic_request_store.mjs with owner economic-comparison. Its native action is explicitly included in that shared original-request validator. The original Economic save/build and field-cost owners retain their separate state.

## Inspect the actual outgoing product

Follow the current repository’s product receiving instructions on the existing native host. Open actual completed editions and operate this exact dialog at desktop and narrow widths. View the rendered source checks, original criteria, scenario details and report; exercise applicable empty/loading/error states, save through the original queue, download the full actual package, reopen it, and inspect the resulting screenshots and report pages.

Source-runtime checks alone do not establish that this outgoing product was opened and viewed. Preserve the actual original edition, comparison and task IDs with the same receiving course, and repair concrete visible faults before calling that delivered product ready.
