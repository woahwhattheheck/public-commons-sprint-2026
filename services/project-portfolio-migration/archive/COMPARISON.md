# Compare retained Portfolio reporting publications

The Archive desk now compares two completed publications from the original Project Portfolio workspace. Each side keeps its own reviewed project selection, original edition identities, reporting profile, complete selected totals, approval and full source ZIP. Reading or reopening a comparison makes no native model, project, target or ledger change.

## Open the original workflow

Open the maintained Project Portfolio application, select **Portfolio archive**, and use **Compare retained publications**.

1. Select a saved cohort and completed publication for the left side. Select the right side independently. Older publications use their own original definition and review even when their cohort has since changed.
2. Read the selected publications. The original authenticated API reads every page of projects, scalar totals, and any native period totals/series/period tables. The panel shows actual row progress and supports cancellation.
3. Confirm business-project correspondence. Equal project keys are offered visibly as a starting choice; edit them if the publications used different authored keys. Choose each project at most once. A blank choice keeps that left project unmatched, and every unmatched right project remains in the output.
4. Compare the confirmed projects. The panel displays 50 groups at a time, including missing counterparts and unavailable or partial support. Every original row is available in its disclosure.
5. Download the complete comparison JSON, printable HTML and all-row CSV. Download both original portfolio ZIPs from the same result for independent native source reopening.

Cohort/publication choices and project correspondences remain in the original workspace browser draft. Full result bytes belong in the comparison JSON; they are not silently placed in browser storage. A changed selection invalidates the visible result. Late reads cannot populate a different selected pair or workspace.

## Interpret the result

**Change** is the exact right total minus the exact left total. Decimal arithmetic operates on the original decimal strings; it does not pass amounts through binary floating-point. Zero, negative values, very large amounts and fractional native amounts remain exact. It performs no currency or duration conversion and calculates no percentage change.

| Original source relationship | Comparison |
| --- | --- |
| Same selected project correspondence, metric/series, native field definition, grain, currency, units and elapsed meaning | Exact change when both totals exist |
| A total has missing or unsupported source rows | The exact difference is labeled a **partial subtotal change**, with both original coverage states/counts retained |
| A project or group exists on one side only | The complete original row is retained as unmatched; the missing side is not zero |
| Native field definition, grain or other measure meaning differs | The report identifies incompatible meaning and supplies no numeric change |
| A currency is unspecified | Original amounts remain visible without a numeric change |
| Period key is reused with different original start/finish bounds | The report identifies the different bounds; values are not shifted or prorated |
| Material totals refer to different native resource identities | They stay separate. Equal material labels do not establish resource identity across editions |

Scalar groups align by the authored metric name and native currency/unit/elapsed group inside the selected project correspondence. A changed field or grain under the same metric name is shown explicitly. Renamed metrics remain distinct groups.

Native period groups additionally retain the original series, period key, start/finish bounds, native method, calendar basis and boundary semantics. A calendar or source edition can legitimately change the resulting quantity; both full source contexts remain available. This is a comparison of saved reported amounts, not an attribution of why the project changed, a row-matched work analysis, or earned-value computation.

No cross-project grand total is produced. This avoids combining independently selected projects, currencies, material resources or aggregation grains into an assumed portfolio-wide quantity.

## Source integrity and full reopening

The original object read can return its exact verified UTF-8 source text through `representation=source`; the default JSON read is unchanged. The comparison hashes both original definition/review texts and checks their parsed values, retaining numeric spellings from the original Python writer.

The reader checks complete pagination against the selected publication's row counts and column order. Before calculation or reopening it checks the original per-table SHA-256, using the same ASCII JSON header/row sequence as the original Python reporting writer. A truncated table, changed cell, duplicate project correspondence or altered saved comparison is rejected.

The comparison JSON contains both complete captured definitions/reviews, publication/archive descriptors, every selected original reporting table, the explicit correspondence and every comparison row. **Open saved comparison JSON** recomputes the comparison from those retained tables and checks the whole result identity. It needs no native JVM or remote target call.

This JSON is the complete reporting comparison, not a replacement for either full native source ZIP. To continue editing native projects independently:

1. Receive each original ZIP through the existing **Archive → Inspect → Receive** workflow, preserving its original manifest and operator decision.
2. Open the received original cohorts and publications.
3. Select the same original publication identities and project correspondence to read and compare them again.

Both original archive SHA-256 values appear in the HTML and JSON. Full native inputs, companion files, source models and period-calculation captures remain in those original archives. No source file is reconstructed from summary totals.

## Existing typed client and CLI

The maintained client has a read-only `archiveComparison(selection)` method. It uses only the existing cohort, object and reporting-table routes:

~~~js
const result = await client.archiveComparison({
  left: {cohort_id: actualLeftCohortId, publication_id: actualLeftPublicationId},
  right: {cohort_id: actualRightCohortId, publication_id: actualRightPublicationId},
  project_pairs: [{left: actualLeftProjectKey, right: actualRightProjectKey}]
});
~~~

Use the complete same selection in a UTF-8 JSON file:

~~~sh
project-portfolio compare \
  --connection /absolute/private/portfolio-project-portfolio-host/connection.json \
  --arguments /absolute/selection/publications.json \
  --output /absolute/delivery/portfolio-comparison.json
~~~

The output uses the existing immutable JSON writer. Repeating the same output path only reuses exact bytes. Supply actual IDs from the original cohort/publication catalogue; the example names are placeholders, not a prepared customer project.

The shared source module `source/archive/web/comparison.mjs` exports `comparePublications`, `reopenComparison`, `comparisonHTML`, and `comparisonCSV` for the browser and original typed client. New files enter the maintained product's full source selection and distribution. The authenticated service gains three static asset routes and an optional `representation=source` response on its existing object-read route. That response supplies verified original JSON bytes; the default parsed-JSON response is unchanged. No action or server-side mutation is introduced.

## Continue the original receiving course

Use the existing PROJECT-PORTFOLIO-NATIVE-B9D2-20261012 workspace and its retained Archive/timephased publications. The original operation already has real MPXJ sources, completed publications and cold-received copies. Do not create substitute native projects or start another JVM merely to exercise this read-only chapter.

Select two meaningful retained publications. If only one reporting snapshot is available, the ordinary same-publication comparison can establish zero changes, but it is not evidence of a real project change. A later reporting snapshot must be an explicitly authored original cohort/publication using the existing workflow.

The producing native peer must open and use the exact final populated Archive panel at desktop and relevant narrow width, inspect loading/error/unmatched/incompatible states, open all three produced downloads, and reopen the full comparison JSON. Inspect the original source ZIP contents through the maintained source receiver. Read the actual screenshots and complete report output, then fix any clipped, cramped or unreadable result within this same course.

Source review, table hashes, HTTP success, controller checks and another worker's approval do not establish rendered acceptance. Source publication may precede that original receiving result; report the two states separately. Use readable industrial tables, restrained controls and complete original source details. Preserve current runtime ownership, native operation identities and all existing spending/Actions controls. No new native host, controller, outreach, commercial promise or approval queue is required by this chapter.
