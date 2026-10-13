# Saved plan comparison

Compare the funding, delivery and capacity consequences of two retained grant plan revisions. The comparison supports revisions of one plan and revisions of separate named alternatives. Browser, CLI and Merchant MCP use the same Python implementation.

## Work through a change

1. Open the grant planning workspace and choose the baseline plan.
2. Open **Compare saved plans**. Select its before revision, an after plan, and that plan's after revision. The initial selection compares the previous revision with the latest saved revision.
3. Choose **Compare selected revisions**. Funding and capacity shows the original retained values and exact decimal changes.
4. Work through Work packages, Milestones, Contributors and Delivery scope. Each row includes its full before and after saved values. Work packages include payment terms, pricing and every assignment. Contributors include their assignments and retained capacity result. Milestones include delivery notes and retained payout rows.
5. Use All field changes to inspect any saved JSON field, including metadata and original array ordering. Filter by scenario, planning or report, search values, and page through the full result.
6. Use Daily cash to compare original project-day results. Download the receiving package when ready to carry the comparison and its original plans into another workspace.

The selected source panel shows plan IDs, saved revision numbers and notes, original source hashes, saved input hashes, retained report hashes and calculator hashes. Both selected snapshots are retained in the exported JSON.

Saved plan comparison works with retained revisions. Any current draft remains available in the planning tabs. Save a draft through the normal workspace controls when it should become a selected revision.

## Reading the impact

All numeric deltas are **after minus before**. Python Decimal performs subtraction on the exact saved values. Funding measures distinguish the original accrual model from the payment-timing cash model and the gap after an entered capital amount. Capacity includes total and unassigned hours, contributors with overloaded days, and the sum of overloaded contributor days.

A missing day or unset capital field has no numeric delta. It remains null in the complete JSON. Day rows align by project day and retain both original calendar dates, allowing changes to the plan's calendar start to be inspected without relabeling the saved timeline.

Each revision contributes its original retained report. Different source documents or calculator versions are identified in the view and package. The complete field changes include retained report differences, including lag comparison outputs. The comparison's identity covers the selected snapshots and all derived comparison fields; later saves to either plan do not change the selected revisions.

Domain rows match work-package and contributor IDs and milestone tranche numbers. Assignment arrays retain every saved entry. The all-fields view uses JSON Pointer paths, including array positions. Added and removed values carry their full content and explicit presence flags so a removed field can be distinguished from a field set to null.

## Complete exports

| File | Contents |
| --- | --- |
| comparison.json | Complete comparison, both selected source snapshots, exact changes and native outcome deltas |
| report.html | Standalone readable comparison with every source field change, domain row and modeled day |
| changes.csv | Every changed JSON value, its pointer and explicit before/after presence |
| impact.csv | Complete funding and capacity metric values and decimal deltas |
| daily.csv | Every project day with both original dates, presence flags and all retained cash fields |
| before.json / after.json | Complete selected saved revisions |
| CONTENTS.json | Selected comparison identity and mapping of each side to its original plan ZIP |
| plans/plan-ID.zip | Each unique plan's original native export, with original source bytes and complete retained history at export |
| MANIFEST.json | SHA-256 and byte count for each other package member |

The browser pages the display. Exports contain the complete comparison. CSV uses the workspace's spreadsheet-safe UTF-8 format; comparison.json carries exact machine-readable values and decimal strings.

To continue in another workspace, extract the comparison package and use **Import planning scenario or workspace** for each unique plan ZIP under plans/. Native import returns a new local plan ID. Open the comparison view, choose those imported IDs and the saved revision numbers recorded in CONTENTS.json. Match the selected source/input/report hashes to the original comparison. The original comparison JSON and readable report remain in the package.

## Command line

Run these commands from the repository root. Supply the actual plan ID returned by list.

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py compare \
  --workspace /absolute/private/scf-delivery-planning \
  --plan plan-00000000000000000000000000000000 \
  --from-revision 2 --to-revision 3
~~~

Add --to-plan with another saved plan ID to compare a named alternative. JSON is printed to stdout unless --output is supplied. File formats are json, zip, html, changes-csv, impact-csv and daily-csv. Formats other than JSON require --output.

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py compare \
  --workspace /absolute/private/scf-delivery-planning \
  --plan plan-00000000000000000000000000000000 \
  --from-revision 2 --to-revision 3 \
  --expected-comparison-sha256 COMPARISON_SHA_FROM_READ \
  --format zip --output /absolute/private/revision-comparison.zip
~~~

Outputs use the CLI's existing atomic private-file publisher. Select a new output filename for each delivered file.

## Typed client and Merchant MCP

The maintained client provides:

~~~js
const selected = {
  planId: baselinePlan.id,
  fromRevision: 2,
  toRevision: 3,
  // toPlanId: alternativePlan.id,
};
const response = await client.read('plan-comparison', selected);
const result = response.value;
const receiving = await client.download('plan-comparison', {
  ...selected,
  expectedComparisonSha256: result.comparisonSha256,
});
~~~

Download kinds also include plan-comparison-report, plan-comparison-changes, plan-comparison-impact and plan-comparison-daily. Each requires the comparison hash from the selected read. TypeScript declarations describe selections, source identities, domain rows, exact field changes, metrics, days and complete snapshots.

Merchant MCP exposes merchant_grant_plan_comparison with workspace, planId, fromRevision, toRevision and optional toPlanId. The complete result enters the normal retained snapshot workflow for exact JSON, row and byte access. merchant_grant_export accepts the comparison download kinds with the same selected revisions and expectedComparisonSha256.

The HTTP route is GET /api/plans/PLAN_ID/comparison?fromRevision=N&toRevision=M. Optional toPlanId selects another saved plan. Append /export.zip, /report.html, /changes.csv, /impact.csv or /daily.csv before the query for a complete file. expectedComparisonSha256 checks that the export matches the selected comparison. Existing local workspace authentication applies to every route.
