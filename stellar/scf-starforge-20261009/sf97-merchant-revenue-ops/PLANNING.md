# Compare merchant pricing scenarios

Open **Scenario planning** from the existing merchant pricing workspace. The
comparison starts with a saved review: the original seller configuration,
operations capture and commercial terms stay attached to every alternative.

## Complete the workflow

1. Save a review in Merchant pricing, including the costs and paid-volume targets
   you want to use as the baseline. When supplier-cost preparation is part of
   your workflow, save its selected cost edition into that pricing review first.
2. Open Scenario planning, select that review and choose **Load review**.
3. Name a scenario and enter its explicit monthly service volumes, USD quotes,
   quote bases, per-fulfillment costs, per-challenge costs and shared fixed cost.
   Blank optional costs retain the analyzer's unknown-cost behavior. Add or
   duplicate scenarios to compare up to twelve alternatives.
4. Optionally enter a monthly contribution target and a contribution margin
   target after fixed cost. Choose **Calculate comparison** to run each
   alternative through the existing SF97 analyzer.
5. Inspect the comparison, service contribution and target suggestions.
   **Use these assumptions** copies a suggestion into that scenario's editor;
   calculate again to review the changed inputs.
6. Name the comparison and choose **Save comparison**. It retains one immutable
   plan with the source review, all explicit inputs, normalized merchant terms,
   comparison results and the selected scenario.
7. Export the plan JSON, comparison CSV or selected merchant terms. To use the
   plan, choose a scenario and **Use selected scenario in pricing review**.
   The existing pricing form opens with that scenario's commercial assumptions.
   Calculate and save the new review with its current operations capture.
8. If the deployed atomic amounts also need to change, use that new saved review
   in the existing **Prepare seller price change** and retained-release workflow.

Reopen the same workspace and select a saved comparison to continue. Its
calculated values remain attached to the original review. A direct saved-plan
link uses `/planning#PLAN_ID`.

## How the decisions are calculated

The original `merchantTerms` and `analyze` functions validate the saved source,
retain ordered payment options, and calculate every baseline, alternative and
usable suggestion. The planning module uses their decimal results for exact
integer arithmetic in micro-USD.

For each service, unit contribution is the entered USD quote less the entered
fulfillment cost. The monthly plan uses the explicit paid-volume target.
Whole-merchant contribution subtracts the shared fixed cost once. The
comparison displays service margins, total margins and changes from the saved
review; missing relevant costs produce unknown results.

The existing analyzer retains per-challenge costs in its operational review.
Its monthly paid-volume plan uses fulfillment costs for the specified paid
requests. The planning module follows that same cost treatment. A scenario
does not introduce an assumed challenge frequency or turn the original HTTP
observations into a demand estimate.

**Price suggestions** hold the entered service volumes fixed. They calculate
the smallest common USD uplift per paid request that satisfies the selected
contribution and margin targets. Rounding goes upward to the next micro-USD so
the proposed value satisfies the exact inequality. Existing service quotes
keep their relative differences.

**Volume suggestions** keep the service quotes and the entered service mix.
The greatest common divisor of the entered route volumes defines one integer
basket. The suggestion finds the smallest whole number of those baskets that
meets the requested target. A zero-volume service remains at zero. Zero total
volume, insufficient unit contribution, an unattainable margin or a target
exceeding the analyzer's safe-integer volume range produces an explicit
unavailable result with the relevant reason.

Break-even suggestions use a zero contribution target. A target margin must
be at least zero and less than 100 percent; target contribution is a
nonnegative USD amount. Quotes and costs keep six decimal places of precision.
Margin targets support four decimal places.

Changing a USD quote without supplying a replacement quote basis marks its
basis as a planning assumption and retains the original basis in that text.
The merchant's network, asset, recipient and atomic payment amounts retain
their original binding. The existing repricing workflow accepts explicit
atomic changes when the operator is ready to prepare them.

## Saved periods and source changes

A retained-history comparison uses the saved report's actual current route
scope. The editor exposes only those selected services. Other merchant routes
remain in the complete terms and keep their existing assumptions.

A route-filtered saved report retains the original analyzer's treatment of
shared fixed costs. Whole-merchant break-even and after-fixed targets remain
unavailable until the operator uses a whole-merchant review; the planner does
not invent a fixed-cost allocation for a selected route.

Historical observations, removed route variants and retention gaps stay in
the original saved review. All alternatives refer to that same source.
Changing the current seller configuration leaves saved comparisons readable.
Applying a plan checks the current seller against its exact saved source;
create a comparison from a current review when that source has changed.

## Private persistence and recovery

Comparisons live in `scenario-plans/` inside the existing private pricing
workspace. Each plan is an independent immutable record. Distinct browser tabs
can save distinct plans without replacing one another. A complete file is
written and flushed before a create-only hard link publishes its request ID.

Retrying the same save ID and input bytes recovers its original plan. Reusing
that ID for different inputs returns a conflict. Saving also checks the review
identity returned by Calculate comparison. This identity excludes generation
timestamps and binds the immutable source and normalized scenario inputs.

The list shows the most recent hundred comparisons; all saved plans remain
addressable by their original IDs. Each file is checked for its expected type,
private permissions and recorded digest on read. Plans are limited to 8 MiB.
The compact form retains the calculated terms, totals, metrics and suggestions,
with references to the original saved observation instead of repeated copies
of large history exports.

Downloads are produced from those saved values. CSV labels that begin with
spreadsheet formula characters are escaped; exact numeric values keep their
decimal strings. The selected terms JSON uses the existing SF97 merchant terms
schema and can be consumed by its maintained analyzer.

The planner shares the existing loopback listener, origin checks, per-process
workspace header and local static assets. Its application step creates a draft
in the existing pricing page. The normal pricing save retains the current
capture and enforces that workspace's existing revision behavior.

## Application interface

The workspace command and installation procedure are unchanged:

```sh
node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/cli.mjs \
  --config /absolute/private/seller-service.json \
  --snapshot /absolute/private/original-seller-traffic.json \
  --state /absolute/private/pricing-workspace
```

Open the printed origin followed by `/planning`. The same page is included in
the maintained distribution's `revenue-workspace` command because the complete
SF97 source component is packaged together.

`startWorkspace(...)` additionally returns `planningUrl` and its `planning`
model. The original `model.planningSource(version)` reads the saved seller,
terms, observation and selected route scope through the same verified file
reader used by the rest of the workspace.

| Operation | Interface |
| --- | --- |
| Read saved comparison list | `GET /api/planning/state` |
| Load a starting review | `POST /api/planning/source` with `{version}` |
| Calculate alternatives | `POST /api/planning/preview` with `{version,scenarios}` |
| Save a reviewed comparison | `POST /api/planning/save` with `{version,scenarios,requestId,label,selectedScenarioId,reviewSha256}` |
| Reopen a saved comparison | `POST /api/planning/load` with `{planId}` |
| Prepare selected commercial draft | `POST /api/planning/apply` with `{planId,scenarioId}` |
| Download retained plan | `GET /planning-files/PLAN_ID/plan.json` |
| Download comparison table | `GET /planning-files/PLAN_ID/comparison.csv` |
| Download original merchant terms | `GET /planning-files/PLAN_ID/terms-SCENARIO_ID.json` |

All POST requests use the original `x-sf97-workspace` header. Obtain that
per-process token through the existing local `GET /api/state` response.

The pure core export is
`createScenarioReview({seller,observation,terms,scenarios,provenance,includeReports})`
from `planning/scenarios.mjs`. A scenario has a unique ID, a label, optional
`sharedMonthlyFixedUsd`, sparse `routes` patches and an optional
`goal:{monthlyContributionUsd,marginPct}`. Monetary inputs are strings;
`monthlyPaidTarget` is a nonnegative safe integer.

The returned schema is `stellar-forge.merchant-scenario-review.v1`. Each row
contains its normalized inputs, complete commercial terms, original overview,
planning metrics, comparison deltas and target suggestions. A READY suggestion
includes directly usable `commercial` and `terms`. Set
`includeReports:false` when retaining compact comparisons; the review identity
is the same in full and compact modes.


### Startup cost

The merchant workspace loads seller release preparation modules when a price-change or release operation first needs them. Opening merchant reviews and scenario plans does not initialize the complete release adapter graph. The original price-change and release operations retain their native implementations.
