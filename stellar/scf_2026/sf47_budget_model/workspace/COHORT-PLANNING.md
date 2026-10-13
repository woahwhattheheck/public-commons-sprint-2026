# Customer adoption planning

Use **Delivery operations → Customer adoption plan** to turn a customer's useful operations, operating calendar, payment model and delivery effort into an operating plan. The same dependency-free engine runs in the browser and through the installed **starforge grant-cohort-plan** command.

The complete plan retains the original case identity, scenario content SHA-256 and deployment rule. Its report compares scheduled capacity with the original tranche targets, shows independent and returning operator coverage, and calculates service contribution and commissioning sensitivity. Every result is reproducible from the retained JSON.

## Start with the customer's useful work

Choose an operation the customer needs: a daily data refresh, recurring reconciliation, a paid API result, a complete deliverable or ongoing research. Give it an agreed scope and complete expected output. Enter its normal cadence and quantity.

| Quantity | Meaning |
| --- | --- |
| Useful task | One complete customer job, such as a daily report |
| Underlying request | One operation or part needed to complete the job |
| New paid purchase | One priced request, or one newly acquired prepaid pass |

For per-request pricing, every counted request represents its own intended purchased operation. Retries, reopened results, sessions and status checks stay with their original operation. A prepaid acquisition contributes one planned purchase; its allowance can fund several requests and tasks.

Start from original deployment and workorder identities. Sessions, wallets or deployments under one accountable operator share one operator ID. Use separate schedules when the customer has separate work, and explain the distinction in the operation scope and source period.

## Original windows and targets

The engine reads the complete rule supplied by the original case. The proposal currently pinned in **sf10_current_candidate.json** defines:

| Tranche | Purchase window | Scheduled outcomes |
| --- | --- | --- |
| 2 | Seven consecutive UTC calendar days | Two external buyers, ten complete testnet purchases, two independent facilitators serving the same operation |
| 3 | Fourteen consecutive UTC calendar days | Two external mainnet merchants, two external buyers, thirty complete mainnet purchases, two returning external buyers |

The proposal also contains recovery, restore/cutover and independent support requirements. Those rows remain visible with **OUTSIDE_SCHEDULE_SCOPE**. Complete that work in the original delivery case and evaluate its actual outcome through [Cohort acceptance](OPERATIONS-COHORT.md).

A fourteen-day window normally contains ten Monday–Friday operating dates. Two customers making one individually priced useful operation per working date provide twenty planned purchases. Three individually priced useful operations across the cohort per working date provide thirty before exclusions. A holiday removes that date's scheduled operations. Compare the target with the customer's full calendar, service model and delivery time.

Original tranche deadlines and award-relative timing remain in the retained rule. The planner derives the purchase window from its selected start and the original consecutive-day length. Award, recovery and acceptance clocks continue in the existing Operations lifecycle.

## Case workflow

1. Open the existing **Delivery operations** case and **Customer adoption plan**.
2. Select tranche 2 or 3 and load its current native cohort seed.
3. Choose the intended first UTC date and retain the explicit observation time.
4. Review the original buyer and merchant deployments and accountable operators.
5. Define useful operations, facilitator services, schedules, prices, allowances and costs.
6. Review daily quantities, original target gaps, returning buyer dates and same-operation facilitator coverage.
7. Save a complete planning edition in the original case.
8. Use the edition JSON for continued planning and the complete case export for receiving the original case.

An edition contains the caller's editable plan and evaluated report. The **report.input** object is the normalized evaluation input; the surrounding edition preserves the original caller plan. This keeps the editing choices and evaluation revision available together.

The integration stores the complete edition JSON as an original case source using **source.add**, kind **other**, MIME type **application/json**. Its edition identity, actor and creation time belong to that source. Complete case export/import carries those exact source bytes and relationships.

If a save response is interrupted, continue the exact retained command and request identity. An intentional new edition gets a new request identity. Reopen a saved edition from its original case source rather than reconstructing it from a displayed subtotal.

### Current source and older plans

When a current native seed is supplied, **sourceComparison** reports:

- Saved and current programId, version and planContentSha256, with a match for each field.
- Optional planId and planRevision comparisons when both sources supply them.
- A complete retained-rule/current-rule comparison.
- The current source and rule actually supplied to this comparison.

Its status is **MATCH**, **CHANGED** or **NOT_COMPARED**. Differences produce **COHORT_PLAN_SOURCE_CHANGED** and/or **COHORT_PLAN_RULE_CHANGED** findings. An older plan remains readable and evaluates with its own complete original rule. An intentional source revision creates a new edition while preserving the earlier one.

Adding a source or another case record can advance the case version while leaving the scenario hash and rule unchanged. The report displays those fields separately.

## Calendar behavior

Dates use the UTC calendar. Weekdays use ISO numbers: Monday 1 through Sunday 7.

**windowStart** is inclusive. The original rule supplies the consecutive-day length, and the engine derives the inclusive end. Weekend and holiday exclusions reduce scheduled work while preserving the original window.

The global calendar has open weekdays and named excluded dates. Schedules can add their own named exclusions. Each cadence intersects the global calendar:

| Cadence kind | Required fields | Behavior |
| --- | --- | --- |
| WEEKDAYS | weekdays | Selected ISO weekdays within the original window |
| EVERY_N_DAYS | intervalDays, anchorDate | On or after the anchor whenever elapsed calendar days are divisible by the interval |
| EXPLICIT_DATES | dates | Listed dates falling inside the original window |

An explicitly selected Sunday requires Sunday to be open globally. Open all seven weekdays for continuous operations; retain the actual office weekdays for office work.

Every calendar day appears in **report.days**, including zero-work dates. **report.excluded** identifies matching schedule dates removed by global or schedule exclusions. Explicit dates outside the selected window generate no occurrence within that window; the full cadence remains in the retained plan.

Each occurrence starts at **timeUtc**, default 12:00. **deliveryDelayMinutes** is elapsed time until its complete useful output. A schedule remains in workload and economic totals when completion lands after the final date, while in-window completion quantities exclude it.

The explicit **asOfAt** retains the original timezone and up to thirty fractional-second digits, including the native seed's microsecond timestamp. UTC date classification uses the corresponding millisecond instant while preserving the original text. It labels dates **PAST**, **AS_OF_DAY** or **FUTURE**. Advancing the time preserves the plan and its assumptions. Actual observed purchases continue through the existing native Cohort acceptance records.

## Accountable operators and coverage

Buyer and merchant entries retain a plan row ID, accountable operator ID, participation class, environment and optional original deployment ID. Facilitators retain their operator and service URL.

Classes are **INDEPENDENT_OPERATOR**, **CUSTOMER**, **TEAM_OPERATED** and **UNKNOWN**. Deployment environments retain the original **LOCAL**, **TESTNET**, **MAINNET** and **OTHER** classifications; **UNKNOWN** is available for an unassigned draft. Independent planned purchase capacity requires an independent/customer buyer and merchant, nonempty operator IDs, the tranche's TESTNET or MAINNET environment, defined useful scope/output and completion inside the window.

One operator ID counts once across multiple rows. Leading and trailing operator-ID whitespace is normalized. Remaining identifiers are explicit and case sensitive; use the original accountable identity consistently.

The report groups work by buyer operator, merchant operator, useful operation and facilitator operator. A returning buyer has at least two independent planned purchases across at least two UTC completion dates. Completion dates determine returning coverage.

Same-operation facilitator coverage is the largest count of independent facilitator operators serving one operation ID through qualifying planned purchases. Different merchant operations remain different operation groups. Several URLs under one facilitator operator count once.

**BUYER_MERCHANT_SHARED_OPERATOR** identifies shared buyer/merchant identities for relationship review. **OVERLAPPING_TASK_SLOT** identifies schedules placing the same buyer and operation at the same time. Entered quantities remain visible so the operator can explain or correct the separate intended task.

Blank operator IDs and empty operation scope/output are valid draft values. Findings identify missing definitions, and the rows retain their scheduled work without independent purchase capacity.

## Prices and allowances

### Per-request work

~~~json
{
  "kind": "PER_REQUEST",
  "atomicUnitPrice": "1000000",
  "network": "selected-network",
  "asset": "selected-asset"
}
~~~

Replace network, asset and price with the selected customer's intended terms. Requests equal tasksPerDate multiplied by requestsPerTask. Each request generates one payment request; a positive atomic price generates one paid purchase opportunity.

Zero price retains request counts and yields zero paid purchases. **UNPAID** requires atomicUnitPrice "0" and generates tasks with zero payment requests.

Atomic amounts remain separate for each network/asset pair and use integer text throughout. A currency-denominated valuation stays an explicit separate assumption.

### Prepaid work

~~~json
{
  "kind": "PREPAID",
  "atomicUnitPrice": "5000000",
  "network": "selected-network",
  "asset": "selected-asset",
  "passCapacity": 100,
  "openingUnits": 20,
  "allowanceUnitsPerRequest": 2,
  "passGroupId": "customer-data-pass"
}
~~~

The price is the acquisition price of a complete pass. **passCapacity** is the allowance on one new pass. **openingUnits** is the available balance on the currently selected pass at window start. Each underlying request consumes **allowanceUnitsPerRequest**.

The planner consumes the current pass before acquiring the additional whole passes needed for the requests. A new pass contributes one planned purchase on its acquisition occurrence. Subsequent allowance use contributes requests and useful work.

Schedules sharing **passGroupId** use one balance, ordered by scheduled UTC time and then schedule ID. They must retain the same buyer row, merchant row, network, asset, capacity, opening balance, atomic acquisition price, unitRevenue, feePerPayment and currency. Per-request supplier costs and per-task effort can differ. Without passGroupId, the schedule owns its own balance across dates.

For example, opening allowance of four units, requests needing two units, and new passes containing eight units fund eighteen requests with the opening balance and four new passes. The request count is eighteen; new paid purchases are four.

A request consumes an indivisible number of units. When the current balance cannot cover a request, a new pass is selected and the old remainder is retained under **retainedUnusedPreviousUnits**. Later requests continue with the selected current pass. Record any intended switching among earlier passes in the customer's operating assumptions.

**report.passGroups** shows opening, consumed, current remaining, retained previous and new acquisition quantities. Report IDs use **shared:** for explicit groups and **schedule:** for schedule-local balances.

## Service economics

Amounts and hours are ordinary decimal strings with up to 24 fractional digits. Unknown values can be null; "0" is a known zero.

Each schedule's economics uses one explicit uppercase currency code:

| Field | Multiplier | Interpretation |
| --- | --- | --- |
| unitRevenue | New payment requests/pass acquisitions | Value per newly charged operation or complete pass |
| unitCost | Underlying requests | Supplier cost per served request |
| feePerPayment | New payment requests/pass acquisitions | Variable payment cost |
| activeHoursPerTask | Useful tasks | Active effort per complete customer job |
| hourlyCost | Active hours | Selected labor or opportunity-cost rate |

Revenue equals payment requests times unit revenue. Supplier cost equals requests times unit cost. Fees equal payment requests times fee. Labor equals tasks times active hours per task times hourly cost. Contribution equals revenue less supplier cost, fees and labor.

Economics cover all selected operating work, including late-completing tasks. Completion capacity stays separate. A late task's required effort therefore remains visible.

An opening prepaid balance can support work without new acquisition revenue during the selected window. Retain earlier cash and any deferred-revenue accounting in the customer's original commercial records.

Currency totals cover schedules assigned economics in that currency. Unspecified schedule economics generate **ECONOMICS_UNSPECIFIED**. Add the complete cost assumptions before using that currency subtotal as the whole cohort's economics.

Unknown components stay null in complete totals. Known subtotals and counts of unknown records remain available. Zero activity contributes known zero for its relevant multiplier. Currencies are calculated separately.

Calculations use integer-backed decimal arithmetic. Addition and multiplication remain exact, including generated values beyond 24 fractional places. Margin percentages round half up to six places; break-even hours round half up to twelve. Whole-purchase sensitivity uses explicit integer floor/ceiling.

### Commissioning workshares

~~~json
{
  "id": "commissioning-option",
  "label": "Customer commissioning scope",
  "currency": "USD",
  "fee": "4200",
  "hours": "36",
  "hourlyCost": "95",
  "otherCosts": "0",
  "sourceIds": [],
  "sourceNote": "Retain the original scoped proposal and cost basis."
}
~~~

These entered assumptions give $3,420 base labor and $780 contribution. At 20% additional effort, labor is $4,104 and contribution is $96. At 25% additional effort, labor is $4,275 and contribution is -$75. Break-even effort is approximately 44.210526315789 hours.

Enter the complete commissioning scope: preparation, source/terms integration, installation, mainnet operation, recovery and receiving handover as applicable. The rate may be the selected $95/hour planning allocation or another explicit cost assumption; retain its economic interpretation in the workshare source.

Each option remains separate from recurring service economics. Its complete original fee/cost/hour inputs, effort cases and break-even hours remain in the report.

### Sensitivity

**effortIncreasesPct** defaults to "0", "20" and "25". It scales active hours and labor while retaining the entered revenue, supplier cost and payment fee assumptions. The report provides adjusted labor, total cost and contribution by currency and workshare.

**completionSharesPct** defaults to "100", "90" and "75". It multiplies independent purchase opportunities by the selected completion share and floors whole completed purchases. Required opportunities use the ceiling of target divided by share.

Thirty complete purchases at 90% require thirty-four opportunities; at 75% they require forty. These are explicit capacity assumptions. Operator, facilitator, recovery and support coverage retain their own target rows.

## Public ESM contract

Installed export:

~~~js
import {
  COHORT_PLAN_SCHEMA,
  COHORT_PLAN_REPORT_SCHEMA,
  CohortPlanningError,
  selectCohortPlanningRule,
  normalizeCohortPlan,
  seedCohortPlan,
  evaluateCohortPlan,
  exportCohortPlanCsv
} from "@tokenjunkielabs/starforge-merchant/grant/cohort-planning";

const plan = seedCohortPlan(nativeSeed, {
  draftId: "cohortplan-original-draft",
  planId: "original-plan-id",
  planRevision: 1,
  asOfAt: "2026-10-12T12:00:00Z",
  windowStart: "2026-10-12"
});
const report = evaluateCohortPlan(plan, { nativeSeed });
const csv = exportCohortPlanCsv(report);
~~~

Use the actual native seed, original plan identity/revision and chosen interval. Source checkouts can import the same exports from **./cohort_planning.mjs**. The adjacent **cohort_planning.d.mts** describes the complete public contract.

Optional **name** sets the title. An omitted draftId derives deterministically from source hash, tranche and explicit seed time. Pass a new explicit ID for a deliberately separate draft with the same source/time.

**selectCohortPlanningRule(originalDeploymentAcceptancePlan, tranche)** selects the native-shaped rule from the original scenario. For an existing case, prefer its current **cohort-seed** response.

### Plan schema

The schema is **stellar-forge.sf47-cohort-plan.v1**.

| Field | Content |
| --- | --- |
| draftId, name | Stable draft identity and title |
| source | programId, positive integer version, 64-character lowercase planContentSha256; optional planId and planRevision |
| rule | Complete original native deployment rule with selected target |
| asOfAt, windowStart | Explicit ISO timestamp and first UTC date |
| calendar | timezone UTC, weekday array, and date/label exclusions |
| buyers, merchants | Original or planned participant rows |
| facilitators | Service/operator rows |
| operations | Useful operation rows |
| schedules | Cadence, workload, payment and economics rows |
| workshares | Scoped fee/cost/hour options |
| sensitivity | Decimal-text effortIncreasesPct and completionSharesPct arrays |
| note | Full planning explanation |

Buyer/merchant fields: **id, label, operatorId, participantClass, environment, deploymentId, sourceIds, sourceNote**. A planned installation can use deploymentId null. Facilitators replace environment and deploymentId with **serviceUrl**.

Operation fields: **id, label, merchantId, scope, expectedOutput, sourcePeriod, sourceIds, sourceNote**.

Schedule fields: **id, label, operationId, buyerId, facilitatorId, cadence, tasksPerDate, requestsPerTask, timeUtc, deliveryDelayMinutes, excludedDates, payment, economics, note**. facilitatorId and economics can be null. References select existing plan row IDs. Tasks, requests, delays and allowance quantities use safe integers.

Stable row/source IDs use up to 200 ASCII letters, digits, period, underscore, colon or hyphen, beginning with a letter or digit. Accountable operator IDs are separate explicit text. IDs and references are case sensitive.

**normalizeCohortPlan** returns canonical decimals, sorted/deduplicated weekdays, defaults and validated references. It retains the complete original rule. Unsupported fields in typed plan objects return **UNKNOWN_PLAN_FIELD**, preserving the original import for an explicit migration. Cadence and payment objects accept only fields belonging to their selected kind.

### Report schema

The schema is **stellar-forge.sf47-cohort-plan-report.v1**, with **kind: PLAN**.

| Section | Content |
| --- | --- |
| source, rule, input | Source binding, retained rule and normalized evaluation input |
| sourceComparison | Saved/current fields, rule match and supplied current source/rule |
| window | Inclusive start/end, original length, tranche/environment, as-of time |
| summary | Work/payment quantities and operator coverage |
| days, occurrences, excluded | Complete day grid, schedule dates and removed matching dates |
| buyers, merchants, operations, facilitators | Accountable-operator and operation groupings |
| targets | All original targets with expected, planned, gap and status |
| currencies, assets | Service economics and separate native quantities |
| passGroups | Allowance conservation and new pass quantities |
| workshares | Complete scoped options and effort cases |
| sensitivity | Completion/effort assumptions and calculated effects |
| findings | Code, severity, scope, ID and actionable explanation |

Summary keys are **scheduledTasks, scheduledRequests, plannedPaymentRequests, plannedPaidPurchases, plannedCompleteTasks, plannedCompletePurchases, independentPurchaseOpportunities, allowanceUnits, independentBuyerOperators, independentMerchantOperators, returningBuyerOperators, sameOperationFacilitatorOperators, excludedScheduleDates, completionOutsideWindow, elapsedScheduledDates**.

completionOutsideWindow counts paid purchases completing after the window. elapsedScheduledDates counts unique task dates before the explicit as-of date. Occurrences retain schedule/completion timestamps, qualification gaps, atomic amounts and economic components.

Target statuses are **PLANNED_CAPACITY**, **SHORTFALL** and **OUTSIDE_SCHEDULE_SCOPE**. The last has planned null and gap null, retaining the requirement for the corresponding native delivery workflow.

Errors are **CohortPlanningError** with code, message and field path. Structural errors identify the input to correct. Incomplete task definitions, unassigned operators, source changes and target gaps remain complete, readable reports with findings.

## Local CLI

The CLI uses Node's built-in file, path and crypto modules plus the shared engine. It reads complete original JSON and creates local planning artifacts. The maintained merchant contribution registers **starforge grant-cohort-plan**.

First obtain the original case's native seed. Close the browser's workspace owner before the headless command opens that same workspace.

~~~sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning cohort-seed --case operation-EXACT_ID --expected-version CURRENT_VERSION --tranche 3 --output /absolute/private/cohort-seed.json
~~~

Replace the case, version and paths with the retained original values.

~~~sh
starforge grant-cohort-plan seed --native-seed /absolute/private/cohort-seed.json --as-of 2026-10-12T12:00:00Z --window-start 2026-10-12 --draft-id cohortplan-original-draft --plan-id ORIGINAL_PLAN_ID --plan-revision 1 --output /absolute/private/customer-plan.json
starforge grant-cohort-plan evaluate --input /absolute/private/customer-plan.json --native-seed /absolute/private/cohort-seed.json --output /absolute/private/customer-plan-report.json
starforge grant-cohort-plan csv --input /absolute/private/customer-plan-report.json --output /absolute/private/customer-plan-report.csv
~~~

Edit the complete customer plan between seed and evaluate. Replace example dates and IDs with the selected original case and interval.

Source checkouts use the same arguments through:

~~~sh
node cohort_planning_cli.mjs seed --native-seed /absolute/private/cohort-seed.json --output /absolute/private/customer-plan.json
node cohort_planning_cli.mjs evaluate --input /absolute/private/customer-plan.json --output /absolute/private/customer-plan-report.json
node cohort_planning_cli.mjs csv --input /absolute/private/customer-plan-report.json --output /absolute/private/customer-plan-report.csv
~~~

**seed** accepts --native-seed, --name, --as-of, --window-start, --draft-id, --plan-id, --plan-revision and --output. Its time defaults to the native seed's time; start defaults to the seed's selected start or that UTC date.

**evaluate** accepts a plan, complete report or saved **stellar-forge.sf47-cohort-plan-edition.v1** edition. It evaluates a report's input or an edition's caller plan. Optional --native-seed supplies the current comparison.

**csv** accepts a complete report or edition containing its report. It exports that retained report; run evaluate first to deliberately calculate a new revision.

Omit --output or use --output - for the complete result on stdout. Use --input - for JSON from stdin; the native seed must be a separate file. Complete input is limited to 64 MiB with an explicit size error above that bound.

Output parents must exist. The CLI writes a temporary file in the destination directory, flushes it, and atomically links it to a new output name. Existing destinations remain intact; use a new edition filename. A successful file write prints JSON with saved absolute path and byte count. Errors use JSON on stderr with error.code, message and path, and a nonzero process exit.

The engine accepts up to 5,000 entries in ordinary lists, 1,000 schedules and 100,000 expanded schedule-date rows. Counts must remain safe integers. An exceeded limit returns an explicit error with the full caller input retained.

## Exports and receiving

**exportCohortPlanCsv(report)** returns one UTF-8 CSV string with CRLF lines:

~~~text
rowType,id,date,metric,value,currency,network,asset,detail
~~~

Rows cover plan/source comparison, summary, targets, days, occurrences, schedule economics, accountable participant groups, exclusions, assets, currencies, workshares, prepaid balances, sensitivity and findings. Detail fields carry explanatory text or structured JSON.

Text cells with spreadsheet formula prefixes are escaped. Canonical negative numeric values remain numeric text. Import large atomic quantities as text in spreadsheet software to preserve every digit. Complete JSON retains exact types and amount strings.

The complete edition JSON is the editable receiving artifact. HTML and CSV provide readable views; complete case export preserves original source bytes and case relationships. The original source.add channel supports up to 8 MiB per source and 24 MiB across all case sources. Choose a realistic cohort and retain large material in the established case receiving workflow when needed.

## Source relationships

This planner builds on [sf10_current_candidate.json](../sf10_current_candidate.json), the native [Cohort acceptance](OPERATIONS-COHORT.md) seed/rule contract and the original Grant Operations source/export workflow.

The pinned proposal spans the existing six packages: merchant integration, authority/handover, provider/ledger deployment, deployed threat response, mainnet rollout, and recovery/handover. Those packages total 400 hours and $38,000 in the application model. Customer workload and commissioning economics can now be compared with that scope in the same original case.

Carry actual purchases, transfers, complete output and deployed support outcomes into their maintained records as operations proceed. Revisit the same plan with the customer's observed cadence, effort and terms, then retain the next complete edition in the original case.

## Shared delivery capacity and service prices

Use **Capacity & pricing** after defining the customer's recurring schedules.
Name each shared delivery pool once, retain its source and availability basis,
and assign schedules to that pool. A pool is a set of active staff hours available
for the work; the same person's hours must not be entered again in another pool.

Enter the total available hours for Monday through Sunday. Date overrides
replace the selected weekday amount. A closure uses `"0"`; a blank value is
unknown. Overrides can add capacity on a normally closed day or record reduced
availability without changing the customer's original task calendar.

~~~json
{
  "id": "customer-delivery-team",
  "label": "Selected customer delivery team",
  "hoursByWeekday": {
    "1": "2", "2": "2", "3": "2", "4": "2", "5": "2",
    "6": "0", "7": "0"
  },
  "dateOverrides": [
    {
      "date": "2026-10-26",
      "availableHours": "1",
      "label": "Explicit reduced-availability planning assumption"
    }
  ],
  "sourceIds": [],
  "sourceNote": "Replace this illustration with the selected team's sourced availability."
}
~~~

Place the row in **capacityPools**. Set each selected schedule's
**capacityPoolId** to its ID and enter **economics.activeHoursPerTask**.
Effort is measured per complete useful task, independently of the number of
paid routes, pages or allowance calls needed to produce it.

### Daily allocation and the actual window

The engine combines every assigned schedule's active hours on the same UTC
date. Two simultaneous schedules drawing on one pool therefore share its
available hours. A date with three required hours and two available hours has
one additional hour needed.

All dates in the original seven- or fourteen-day window remain visible.
Weekly rows include only dates inside that window and state their exact
start/end and number of included days. They never extrapolate a partial week.
The report provides both net headroom and the sum of individual daily deficits.
Spare hours on Tuesday cannot cancel a Monday shortage.

For an illustrative fourteen-day Monday–Sunday window with ten business days,
two customers each doing two daily tasks provide forty tasks. At 0.25 and
0.75 active hours per task, their combined requirement is two hours per business
day, or twenty hours. The pool above supplies nineteen hours because one Monday
has only one hour available; the report identifies that date and its one-hour
shortfall. With a 25% effort increase, demand rises to twenty-five hours, and
the sum of daily shortfalls is six hours.

The global task calendar determines which customer occurrences exist. Pool
weekday hours and overrides define staff availability separately. Active work
is assigned to the scheduled task date. The original explicit completion delay
continues to describe when the useful output completes. Operators can change
a cadence, quantity, effort estimate, pool assignment or date availability and
recalculate the complete plan.

### Unknown and unassigned effort

A missing task-effort estimate remains unknown even when the price is entered.
A pool with missing availability or assigned unknown effort reports
**INCOMPLETE**. Its known effort and known minimum shortage remain visible.
Positive known demand above available hours reports **OVERALLOCATED** even
when additional effort is still unknown.

Positive or unknown effort without a pool appears under **Unassigned delivery
effort**. Explicit zero-effort tasks can remain unassigned. Once capacity is
configured, unassigned positive/unknown work keeps the overall assessment
incomplete. A plan with no pools reports **NOT_CONFIGURED**.

The complete report retains **capacity.pools**, every daily and weekly row,
unassigned work, and each selected effort-increase sensitivity. Original
customer tasks, payment quantities, source rule and recorded acceptance remain
in their existing records. Staffing deficits are displayed with the original
target report so an operator can plan the work needed to support those targets.

### Price the full recurring service

The **Service price floors** report totals the selected-window supplier cost,
payment fees and active labor cost for each schedule. Schedules sharing a
prepaid pass group are valued together, so the costs of later allowance usage
remain with the group's newly acquired passes.

**breakEvenUnitRevenue** is the group's total cost divided by its count of
newly charged requests or acquired passes. **targetUnitRevenue** applies the
optional **sensitivity.minimumMarginPct**:

~~~text
target unit revenue = total cost / (new charge units × (1 − target margin / 100))
~~~

The selected margin must be below 100%. All arithmetic uses the original
integer-backed decimals; price floors round upward to twelve fractional places.
The estimate currency remains separate from the native atomic payment terms.
Changing a displayed price floor changes no merchant price or payment record.

For example, a group's four new charges, USD 12 supplier cost, USD 2 fees and
USD 6 active labor have USD 20 total cost. Break-even is USD 5 per new charge.
At a selected 20% margin, the required value is USD 6.25. An entered USD 4 unit
revenue produces USD 16 revenue, USD 4 uncovered cost, and a USD 2.25 increase
per charge to reach the selected margin.

A prepaid group supported entirely by its opening allowance can have service
cost and zero new charge units. The report returns **NO_NEW_CHARGES**, retains
the cost, and leaves a unit price undetermined. Its earlier acquisition and
deferred revenue belong in the original commercial accounting period.
Missing cost inputs retain **INCOMPLETE**, while complete costs with an
unknown revenue estimate still provide the cost-based price floor.

### Edit, export and continue

The same fields travel through the original plan JSON, complete saved edition,
case source attachment and complete case ZIP. Earlier plans open with an empty
capacity selection and no chosen margin; earlier report editions remain
readable.

Editable rows CSV adds **capacityPools** rows with complete JSON
**hoursByWeekday** and **dateOverrides** cells, and schedules add
**capacityPoolId**. Existing row IDs and source bindings remain the import
keys. Full plan JSON carries the selected minimum margin.

The installed **starforge grant-cohort-plan evaluate** command calculates the
same capacity and service prices from the same plan. Its report CSV includes
**CAPACITY_DAY**, **CAPACITY_WEEK**, **CAPACITY_UNASSIGNED**,
**CAPACITY_SENSITIVITY** and **SERVICE_PRICING** rows. The readable HTML export
includes the complete capacity, effort and price reports with the retained
original plan.


## Receive a saved Customer-use Calendar

Open the actual case's **Customer use** tab, choose the exact saved Installation
editions and original dated window, then select **Plan staffing and pricing**.
The workspace reads the complete native Customer-use Cohort seed for that
selection and opens a new editable adoption plan.

The receiver compares the case ID/version, plan content SHA-256, original rule,
dated window, and every selected Installation ID/revision/SHA-256. The saved
window must span the original tranche's consecutive-calendar-day rule. Its
native useful-operation identities are retained in the planner.

Earlier local planning drafts remain in **Saved editions**. An outstanding
original edition save is completed through its existing recovery control; the
received calendar remains available to open after that save. The new plan uses
the existing edition writer, source attachment, complete case export and
independent receiving workflows.

### Dated tasks and explicit funding

The plan contains one schedule per native dated use and one **fundingGroups**
row per original DIRECT or PREPAID settlement group. The full original calendar
selection and matching Cohort seed remain in **calendarSource**, including the
selected immutable editions, useful task definitions, native receipt references
and their retained states.

| Native source | Editable planning representation |
|---|---|
| Original useful task | The native Cohort operation ID, merchant, complete request, useful output and source references. |
| PURCHASE or ALLOWANCE_USE | An explicit-date schedule with payment.kind FUNDED and the original fundingGroupIds. |
| REOPEN or FREE_USE | An explicit-date UNPAID schedule. |
| CANCELLED entry | The original dated schedule retained with zero useful tasks. |
| DIRECT settlement group | One named explicit funding group, even when several useful results refer to it. |
| PREPAID settlement group | One named explicit funding group covering all its selected allowance-use results. |
| Original purchase references | Retained in the original calendar source and group source note. |
| Absent numeric commercial terms | Null atomic price and unvalued currency estimates, ready for explicit entry. |

The native calendar carries UTC civil dates. Imported schedules use 12:00 UTC
as an editable planning placement within each source date, recorded in their
notes. Exact dates are retained, with all weekdays enabled so the entered date
rows determine the workload. The native calendar already selected its actual
included and excluded dates. Original native purchase and completion timestamps
remain in the retained source.

Each funding group contributes at most one planned settlement, on its first
whole useful-result date. A funding date before the window supplies existing
funding and creates zero new settlements in this window. An unused or wholly
cancelled group creates zero new settlements. A result shared by multiple
funding groups keeps all of those group identities.

Funding belongs to its original purchased operation. Later allowance uses can
select a different useful task from the same buyer and merchant. The report
retains that distinction and applies facilitator planning to the original
funding operation and explicitly entered settlement facilitator.

### Enter commercial terms and delivery effort

Use **Funding groups** to enter the native network, asset, atomic price, selected
facilitator, currency revenue and payment fee for each settlement. A blank
atomic price stays **UNPRICED**; an entered zero is a known zero price. The
report shows priced and unpriced groups separately. A target which could be
reached only after pricing those groups shows **PRICE_UNSPECIFIED** and its
additional unpriced opportunities.

Use **Schedules** for supplier cost, active hours per useful task, hourly labor
cost and shared capacity assignment. A FUNDED schedule obtains revenue and
payment fees from its funding groups. Use the existing **Capacity & pricing**
tab for daily staff hours, date overrides, minimum margin and effort sensitivity.

Explicit funding preserves the source grouping. It does not infer a numerical
pass capacity or invent additional pass acquisitions from a named calendar
group. Recurring per-request and quantified prepaid schedules remain available
for separately authored workflows with those actual terms.

The service-cost report joins funding groups connected through shared useful
results. Each task's cost enters that complete component once. Each new
funding group's revenue and payment fee also enter once. A component's price
floor is its average required currency value per new funding group; individual
DIRECT/PREPAID group prices remain editable. Different or unspecified estimate
currencies keep the combined price floor incomplete until an explicit common
pricing basis is entered. The currency report continues to show each entered
currency separately.

### Receive through the maintained CLI or module

Retain the full JSON responses from the original **customer-use-calendar** read
and **customer-use-calendar-cohort** seed, selected at the same current case
version. Use their actual window ID:

~~~sh
node cohort_planning_cli.mjs calendar \
  --native-seed customer-use-cohort-seed.json \
  --calendar customer-use-calendar.json \
  --group "$GROUP_ID" \
  --output customer-adoption-plan.json

node cohort_planning_cli.mjs evaluate \
  --input customer-adoption-plan.json \
  --output customer-adoption-report.json
~~~

The installed launcher forwards the same **calendar** operation through
**starforge grant-cohort-plan**. Output files retain the existing atomic
create-new-file behavior. The default group ID comes from the native seed;
**--group** selects that same explicit original window.

The pure module supports the same receiving operation:

~~~js
import { seedCohortPlanFromCalendar } from './cohort_planning_calendar.mjs';

const plan = seedCohortPlanFromCalendar(nativeSeed, calendarSelection, {
  groupId: nativeSeed.customerUse.groupId,
  draftId: 'cohort-plan-received-calendar',
  name: 'Received customer-use delivery plan',
});
~~~

Editable rows CSV includes **fundingGroups**, **fundingKind**, **date**,
**fundingGroupIds** and complete **origin** JSON. It supports filling commercial
terms and schedule effort across the original named rows in one import. The
complete plan JSON retains the full original calendar and seed. Report CSV
adds **EXPLICIT_FUNDING** and **FUNDING_ECONOMICS** rows; readable HTML includes
the funding report. The Funding tab also downloads both original JSON inputs
directly for another operator.


## Compare complete alternatives

Use **Compare plans** to answer a practical delivery question: how does a
different customer mix, normal operating schedule, delivery delay, prepaid
allowance, quoted workshare or effort assumption change the same programme?

The comparison works alongside the existing plan editor. Capturing a baseline or
candidate leaves the working plan and its unfinished row edits in place. Each side
retains the complete selected plan, planning report or saved edition. The engine
recalculates both alternatives with their own full original rules; it does not
rewrite either rule or select a preferred commercial option.

### Saved edition → comparison → selected plan

1. In **Saved editions**, choose **Use as baseline** beside an original plan, or
   open **Compare plans** and select a saved edition, the current working draft,
   or a retained earlier draft.
2. Capture the candidate in the other column. **Import source JSON** accepts a
   complete plan, report or saved edition when the source is outside the current
   case. Sources from the native case still use the existing full byte-count and
   SHA-256 readback before selection.
3. Review **Summary & targets**, **Calendar & completions**, **Revenue & costs**,
   **Input changes**, and **Operators & prepaid**. The two named source cards and
   comparison-basis table remain explicit. Add a comparison title and review
   notes for the proposed delivery choice.
4. Use **Open baseline for editing** or **Open candidate for editing** to continue
   the selected source through the original editor. The current working plan is
   retained in the existing prior-draft history. A source still present in this
   case reopens through its original source record; an imported document keeps
   its complete source identity and uses the same existing plan-import flow.
5. **Save comparison in this case** attaches one immutable full JSON comparison
   using the existing `source.add` command, current case version, recording
   operator and stable original request ID. The native comparison save leaves
   the working plan's saved-edition and parent-source bindings in place.
6. Download the complete comparison JSON, comparative CSV and readable HTML.
   **Import complete comparison** reopens both full sources, restores the title
   and notes, and recalculates every comparison value. The complete native case
   ZIP carries saved comparisons with the original sources and case history.

A current-draft capture is a snapshot. If the working draft changes afterward,
its comparison card says so; capture it again to include the new input. Replacing
a side, swapping sides, importing a comparison or restoring an earlier one retains
the previous local comparison. A source/file read that completes after a newer
selection or a disposed view stays under **Received sources awaiting adoption**.
It does not replace newer edits.

The original pending-request recovery also covers comparison saves. Access or
route failures during a retry preserve the same request because they do not settle
the outcome of an earlier native attempt. An accepted source remains recoverable
if retaining the final browser checkpoint fails. The browser uses the original
request and full source readback when continuing that save.

### Reading the differences

All deltas are **candidate minus baseline**. Higher counts, additional dates or
larger amounts are described as changes, not automatically as improvements.

- The basis includes programme, plan, native source version and plan-content
  identity, tranche, environment, complete calendar window, observation time and
  full original rule. Different cases, rules and durations remain visible;
  absolute values are not silently rescaled or treated as interchangeable.
- Target rows preserve each side's original required count, planned count,
  shortfall and status. A target outside the schedule model remains unvalued.
- Calendar rows use actual UTC dates. A date outside one selected window is
  absent in that plan, so its delta is unvalued. The complete schedule-date
  changes include original schedule and buyer identities, actual planned
  completion timestamps, payment groups, qualification gaps and economic inputs.
- Currency rows use exact decimal text. Different currencies are separate
  groups. An absent group or an unknown amount produces an unvalued delta.
  Margin changes use percentage points; effort continues to use hours.
- **Recurring schedule economics** covers the selected schedule window.
  **One-time commissioning workshares** totals the original fee, effort, other
  cost, labor cost, total cost and contribution once, using the unadjusted
  commissioning effort. These two scopes are never silently added together.
- Coverage reports how many schedule-date rows contain economic assumptions and
  how many omit them. Currency totals cover the entered rows; missing economic
  assumptions remain visible. Each currency/workshare group also retains known
  subtotals and unknown-record counts.
- Authored rows are matched by their original stable IDs. Added, removed,
  changed and moved rows show full before/after values and original positions.
  Operator, prepaid and sensitivity changes retain the existing evaluator's
  original grouping and completion semantics. Changed findings remain separate
  from the two complete original reports.

The screen pages long changed-row and calendar tables. CSV and JSON export every
row. Readable HTML includes the complete comparative tables and both original
input documents, with neutral print styles. CSV text remains formula-safe while
negative numeric deltas retain their numeric meaning.

### Installed command

The existing installed command forwards these operations to the same ESM engine:

```sh
starforge grant-cohort-plan compare \
  --baseline original-edition.json \
  --candidate revised-plan.json \
  --name "Customer schedule alternatives" \
  --note "Review the entered delivery calendar and commissioning effort." \
  --output customer-comparison.json

starforge grant-cohort-plan csv \
  --input customer-comparison.json \
  --output customer-comparison.csv
```

The direct source command is equivalent:

```sh
node cohort_planning_cli.mjs compare \
  --baseline original-edition.json \
  --candidate revised-plan.json \
  --output customer-comparison.json
```

Either comparison source can use `-` for stdin; the other must be a file.
The existing 64 MiB JSON input bound and atomic new-output publication remain.
No file is overwritten. The comparison browser importer accepts a complete JSON
file up to 64 MiB. Saving through the native case retains its existing 8 MiB
attachment limit; a larger full comparison can still be downloaded and reopened
as JSON.

### Public comparison contract

```js
import {
  compareCohortPlans,
  reopenCohortPlanComparison,
  exportCohortPlanComparisonCsv
} from "./cohort_planning.mjs";

const comparison = compareCohortPlans(baselineDocument, candidateDocument, {
  title: "Customer schedule alternatives",
  note: "Review the original named workshares and complete UTC calendars."
});
const reopened = reopenCohortPlanComparison(comparison);
const csv = exportCohortPlanComparisonCsv(reopened);
```

The output schema is
`stellar-forge.sf47-cohort-plan-comparison.v1`, kind
`PLAN_COMPARISON`. `documents.before` and `documents.after` contain both
complete caller documents, including original edition metadata and reports when
supplied. `before` and `after` are freshly calculated full planning reports.
`review` retains the title, note and optional original source references.

The remaining sections are `basis`, `summary`, `targets`, `currencies`,
`workshareTotals`, `economicsCoverage`, `assets`, `days`, `inputChanges`,
`occurrences`, `participants`, `passGroups`, `workshares`, `sensitivity`
and `findings`. Number and decimal changes contain `before`, `after` and
`delta`; absent/unvalued values use JSON null. Changed rows carry complete
before/after records, source positions and explicit changed fields. Unchanged
records remain present in the complete retained inputs/reports.

Reopening validates the supported schema, both complete input documents, review
fields and original source-reference shapes before recalculation. Derived values
in an edited incoming comparison are recalculated from its carried source
documents. Unknown top-level fields are reported so they can be preserved and
reviewed explicitly. The installed `./grant/cohort-planning` typed export
includes the full comparison document and public functions.


### Compare the complete capacity and service-price result

The comparison composes the maintained **Capacity & pricing** planner. It
retains both complete delivery-pool definitions, schedule assignments, weekday
hours and exact date overrides. Pool totals compare available hours, required
effort, known subtotals, headroom and the sum of daily staffing shortages.
Unknown inputs stay unvalued. Daily and partial-week changes retain their
original dates, boundaries, schedule identities and source assumptions.

The service-price comparison retains each schedule or shared-prepaid group,
charge units, costs, revenue, uncovered costs, break-even and chosen-margin
prices. Monetary differences are calculated only when both groups use the same
known currency. A changed currency is shown on each side without converting or
subtracting the monetary values. Charge counts and margin percentages retain
their own units.

Full JSON and comparative CSV carry daily, weekly, unassigned-effort,
capacity-sensitivity and service-price results. The readable HTML contains all
eight calendar measures, independent of the currently selected browser measure,
alongside the complete comparative capacity and price sections.


## Schedule the complete delivery workload

Open **Schedule delivery** after entering each service’s active effort and shared
delivery pool in **Capacity & pricing**. This operation allocates the complete
existing workload to those daily hours. The original cohort calculator still
owns the useful-task counts, payment groups, allowance use, source rule, economics
and target comparison.

### Set the service commitments

Choose **Edit service rule** for each service that can move. New rules default to
fixed dates. Enter the actual permitted movement and retain its basis:

| Input | Operating meaning |
| --- | --- |
| Permit date movement | Allows future occurrences to use a reviewed date allocation. Fixed rows reserve their existing dates. |
| Days earlier / later | The permitted range around each original cadence date, including an occurrence moved in an earlier plan. A successor cannot reset that original tolerance. |
| Release date | Earliest date the service can start. Each named funding group’s purchase date is an additional lower bound. |
| Complete output due by | The whole output must arrive by the end of this UTC date, including the original delivery delay. The original cohort completion window also applies. |
| Permitted weekdays | Intersects the original plan calendar and service exclusions. |
| Minimum days between occurrences | Minimum calendar-day spacing between this service’s whole occurrences. |
| Priority | Larger values receive shared capacity first. |
| Note | The original commitment, permission or planning assumption supporting these choices. |

The date preference selects **Nearest original service date** or **Earliest
permitted date**. Capacity stays at its entered daily precision, including
explicit date overrides. Unknown availability or effort is returned as a field
to complete. One whole occurrence must fit one pool/day; its useful tasks are
kept together.

Work scheduled at or before the plan’s exact cutoff retains its current date.
Cancelled/zero-task entries remain in the plan. Named funding groups keep their
IDs, purchase dates, purchased operation, price, facilitator and full original
Installation source. A useful result can move only on or after all of its named
funding dates.

### Review the actual allocation

Choose **Calculate delivery dates**. The result shows every original occurrence,
its former and proposed dates, complete-output timestamp, effort, pool, funding
IDs and status. Open **Complete dates and constraints** for the service policy,
all permitted dates and exact rejected-date reasons. **Edit service rule**,
**Edit effort and pool**, and **Edit capacity and pricing** return to those
original inputs in the same application.

The allocator reserves all fixed and unresolved work. It considers service
groups by descending priority, the earliest end of a permitted occurrence
window, then the original occurrence order. Within a group it uses the selected
date preference. Implicit prepaid sequences retain their original chronological
consumption order. A sequence linked by prepaid use or minimum spacing is placed
together; if its continuation cannot fit, the whole sequence retains its original
dates and capacity reservation.

**Complete** means the active future occurrences fit the entered constraints.
**Unresolved** preserves the full work and identifies the remaining decision
under this allocation order. Adjust the original capacity, service window,
spacing or priority and calculate another complete alternative. The existing
capacity report separately retains unknown availability on unused dates and
the original historical workload.

Scheduling keeps useful tasks and underlying requests exact. It also checks that
new payment requests, paid purchases, allowance consumption, explicit funding
groups and full currency totals remain identical to the source plan. The
original completion dates and cohort opportunity results are recalculated from
the proposed delivery dates.

### Resolve competing delivery dates

Choose **Resolve competing dates** in the existing Schedule delivery tab when
flexible services compete for the same available days. The calculation first
retains the original ordered allocation, then revisits complete service groups
that share possible delivery capacity. It can move an earlier flexible service
to another permitted day so a later service also fits its actual commitment.

For example, a higher-priority service may permit Tuesday or Wednesday while
another service permits Tuesday only. The reviewed successor can place the first
service on Wednesday and the second on Tuesday, retaining both complete jobs,
their prices and the same entered daily capacity. All entered priority, release,
deadline, funding-date, weekday, cutoff and sequence rules still apply.

Each linked prepaid/spacing group stays together. The calculation releases only
the flexible members of the competing groups while preserving all fixed, past,
unknown and otherwise unplaceable work in the capacity ledger. It searches in
the original priority and service order, using the selected date preference.
Only a complete placement of that whole competing set replaces the retained
allocation. The result lists each attempted set, its result and any changed
dates. A set without a complete accepted placement keeps its previous dates and
full constraints; other independent sets can still receive a complete solution.

**Standard** uses up to 100,000 candidate placements; **Extended** uses up to
1,000,000. The limit and exact visited count travel in the complete result. The
result identifies a completed placement, an exhausted search, or a search that
used its selected effort. These describe the deterministic operation under the
entered constraints. Edit the original service or capacity inputs to calculate
another complete alternative.

The original **Original service order** method remains available. Saved results
from that method preserve their original JSON representation and calculation.
Selecting another method or effort makes the displayed result require a fresh
calculation before its dates are adopted. Opening a saved allocation restores
its actual method and effort.

A complete plan file or saved source that finishes opening after newer edits
stays in **Compare plans → Received sources**. The current draft and selected
allocation method remain selected. Choose **Adopt received source** to open that
complete original deliberately. An invalid saved allocation is rejected before
it can replace the editable plan.

The existing **Use dated successor**, **Open full comparison**, and **Save
successor and comparison** actions use the selected complete result. The one
source edition retains the original source, exact funding groups, full
allocation and comparison. JSON and readable HTML include every competing-date
decision. Allocation CSV adds the selected method, effort, component result and
previous allocated date to each row. Service-choice JSON retains the original
service constraints; complete allocation JSON retains those choices together
with its selected method.

The same installed command operates this method:

~~~sh
starforge grant-cohort-plan schedule \
  --input original-plan.json --constraints delivery-choices.json \
  --method resolve-conflicts --max-search-steps 100000 \
  --output resolved-delivery-allocation.json
~~~

Use **--method first-fit** for the original method. The typed ESM operation takes
**{method: "RESOLVE_CONFLICTS", maxSearchSteps: 100000}** as its third argument,
alongside an optional successor name. The default is **FIRST_FIT**.
**maxSearchSteps** accepts a whole number from 1 through 1,000,000 for conflict
resolution. Complete results retain these fields in **resolution**, and the
existing reopener recalculates the same original source and selected method.

### Keep occurrence identities when dates coincide

A schedule retains its original cadence, exclusions, useful-task count, payment
and cost inputs. Its optional dateAllocations array maps an original occurrence
to its reviewed date:

~~~json
{
  "dateAllocations": [
    {"sourceDate": "2026-10-19", "date": "2026-10-21"},
    {"sourceDate": "2026-10-20", "date": "2026-10-21"}
  ]
}
~~~

These are two complete occurrences on October 21. Their IDs remain
SCHEDULE_ID:2026-10-19 and SCHEDULE_ID:2026-10-20; neither row disappears when the
dates coincide. Each report row includes its original sourceDate and
originalScheduledAt alongside the actual planned timestamp. A source date must
still identify an active occurrence of the retained cadence/calendar, and an
allocated date must be open and inside the same original rule window.

The normal schedule editor exposes **Reviewed date allocations**, one original
date | allocated date per line. An empty list restores the original dates.
Editable row CSV retains the complete mapping as JSON. Changing a cadence or
calendar so that an allocated source occurrence no longer exists returns that
exact mismatch for review.

### Save the successor and comparison together

Choose **Use dated successor** to continue the full candidate in the existing
editor. **Open full comparison** shows the original plan and complete candidate
through the maintained comparison, including stable occurrence changes, daily
capacity, service pricing, funding, participants and original targets.

**Save successor and comparison** applies the reviewed candidate and saves one
normal cohort-plan source edition. It contains the editable successor, its
current report, the complete original scheduling operation and both full
comparison documents/reports. The existing expected case version, original
request UUID, exact attachment readback and interrupted-save recovery apply to
that one source write.

Opening that edition restores its editable scheduling choices and original
allocation. Complete case export/import carries it through the original
Operations source store. The original Customer-use Calendar and Cohort seed
remain inside calendarSource. The scheduling plan is a reviewed delivery
alternative; operating Calendar changes continue through the existing
Installation editor with their actual current revision.

Download **Complete scheduling JSON** to retain the original input document,
choices, complete candidate/report and every assignment. **Allocation CSV**
includes all row-level constraints and rejected dates. **Readable allocation**
contains the entire table and original/candidate input documents. A saved
successor’s ordinary plan JSON carries the allocation and comparison together.

### Installed CLI and typed ESM

Use the existing grant-cohort-plan command:

~~~sh
starforge grant-cohort-plan schedule-seed \
  --input original-plan.json --output delivery-choices.json

starforge grant-cohort-plan schedule \
  --input original-plan.json --constraints delivery-choices.json \
  --name "Customer service delivery" --output delivery-allocation.json

starforge grant-cohort-plan schedule-plan \
  --input delivery-allocation.json --output delivery-successor.json

starforge grant-cohort-plan schedule-compare \
  --input delivery-allocation.json --output delivery-comparison.json

starforge grant-cohort-plan csv \
  --input delivery-allocation.json --output delivery-allocation.csv
~~~

Edit the complete choices returned by schedule-seed before calculating. Omitting
--constraints uses the plan’s existing saved choices, with fixed defaults for
new services. schedule-plan and schedule-compare recalculate the retained source
and choices before producing their complete output. Each CLI destination uses
the existing atomic create-only publisher.

The source module and its adjacent declaration expose the same pure operation:

~~~js
import {
  seedCohortDeliveryScheduling,
  scheduleCohortDelivery,
  reopenCohortDeliverySchedule,
  exportCohortDeliveryScheduleCsv
} from './cohort_planning_scheduling.mjs';

const choices = seedCohortDeliveryScheduling(originalPlan);
const selected = choices.schedules.find(row => row.scheduleId === originalScheduleId);
selected.flexible = true;
selected.delayDays = 3;
selected.dueDate = originalCompletionDeadline;
selected.note = originalFlexibilityBasis;

const allocation = scheduleCohortDelivery(originalPlan, choices);
const completeOriginal = reopenCohortDeliverySchedule(allocation);
const editableSuccessor = completeOriginal.candidate;
const allAssignmentsCsv = exportCohortDeliveryScheduleCsv(completeOriginal);
~~~

The installed export is
@tokenjunkielabs/starforge-merchant/grant/cohort-scheduling.
The scheduling choices live in optional plan.deliveryScheduling. Plans without
this field or date allocations keep their original normalized shape, occurrence
IDs and calculated result. Both maintained launchers and the authenticated
browser source route include the same scheduling module.

## Complete adoption work through Merchant MCP

The existing Merchant Grant workspace owner provides the same adoption calculator, saved Calendar bridge, pricing editor and capacity allocator to agents. It uses its declared workspace connection and retains complete original inputs and outputs through the existing snapshot and file tools. The installed module is `@tokenjunkielabs/starforge-merchant/grant/cohort-agent`; its adjacent declaration covers the full operation.

| Tool | Complete operation |
| --- | --- |
| merchant_grant_adoption_seed | Read the current native case and tranche seed, or one saved Calendar group with its exact Installation editions. Return the full native source, editable plan, report and scheduling choices. |
| merchant_grant_adoption_review | Recalculate the whole plan against the current native case and seed. Retain the entered rule and show the actual source differences. |
| merchant_grant_adoption_edit | Apply explicit plan edits or keyed row updates, additions and removals. Return the successor, calculated result and complete predecessor comparison. |
| merchant_grant_adoption_rebase | Explicitly adopt the current source and proposed rule in the original case while retaining the previous complete document and all editable rows. |
| merchant_grant_adoption_schedule | Allocate every original occurrence using the complete selected flexibility, dates, weekdays, spacing, priorities and capacity. |
| merchant_grant_adoption_compare | Compare complete plans, reports, editions or delivery allocations with both original documents attached. |
| merchant_grant_adoption_prepare | Retain one complete reviewed edition and its exact original save request. |
| merchant_grant_adoption_save | Submit that prepared request through the original source attachment operation, retain its native response and reopen every saved byte. |
| merchant_grant_adoption_request | Reopen the original prepared request and any returned response, and inspect the exact native version event. |
| merchant_grant_adoption_open | Open the full native source by case, source ID and SHA256, including a source carried in an imported case. |
| merchant_grant_adoption_export | Retain complete JSON, CSV or readable HTML through the original file reader. |

### Select, author and allocate the whole source

Use source CASE with tranche 2 or 3. Use source CALENDAR with the saved groupId and, when selecting particular editions, each original Installation id, revision and SHA256. Calendar groups keep their original window. Original funding groups, allowance uses, cancelled work, prices and unknown commercial terms all travel with the source plan.

An input can be the full inline inputs object or one verified input reference. References select a declared hostInput, complete snapshotId or committed transferId and the exact whole-file expectedInputSha256. An optional inputPointer selects a complete object within that verified original file. The file is verified before selection. The owner reads the full retained document, including arrays that were presented as counts in chat.

Edits address buyers, merchants, facilitators, operations, schedules, workshares, capacityPools and fundingGroups by their original row ID. UPDATE merges the explicitly supplied nested object fields and replaces supplied arrays in full. Original id and origin stay attached to the row. ADD supplies a complete distinct row; REMOVE names the exact row. PLAN edits the name, observation date, window start, operating calendar, sensitivity, note or complete scheduling choices. Rebase is the explicit operation for changing the native source and rule.

Enter delivery effort and commercial terms in those complete rows. Null remains unpriced or unspecified; a zero is an entered zero. Funding revenue and shared fees remain on the original funding group. Scheduling uses the existing capacity operation described above, including fixed defaults, original source dates, purchased funding and every unresolved constraint. Its full result can be scheduled again or compared without stripping the previous allocation.

### Carry the retained result through one native save

The following sequence uses an already configured Merchant owner and real values read from its existing workspace. `changes` and `constraints` are the operator's complete selected edits and scheduling choices.

~~~js
const call = (name, args) => merchant.call('merchant_grant_' + name, {workspace, ...args});
const input = snapshot => ({
  input: {snapshotId: snapshot.id},
  expectedInputSha256: snapshot.file.sha256
});

const seed = await call('adoption_seed', {
  caseId, expectedVersion, source: 'CALENDAR', groupId, installationRefs, asOfAt
});
const authored = await call('adoption_edit', {...input(seed), changes});
const allocated = await call('adoption_schedule', {...input(authored), constraints});
const reviewed = await call('adoption_review', {caseId, expectedVersion, ...input(allocated)});

// Retain these original values and reuse the same complete input on a retry.
const prepared = await call('adoption_prepare', {
  caseId, expectedVersion, ...input(reviewed), requestId, actor, note, createdAt
});
const fingerprint = await call('snapshot', {
  snapshotId: prepared.id, expectedSha256: prepared.file.sha256,
  pointer: '/preparedSha256'
});
const saved = await call('adoption_save', {
  ...input(prepared), expectedPreparedSha256: fingerprint.value
});
~~~

Prepare retains the original case creation identity, selected native seed, complete edition bytes, file hash, exact source.add body and deterministic edition identity. A plan edition contains its plan and calculated report, full native seed, allocation and original comparison. Select parentSourceId and expectedParentSha256 together when saving a successor to a particular existing source.

The Merchant owner stores the complete prepared request in its existing private workspace directory. After the native attachment returns, it retains the original response before source readback. Repeating the same prepare input returns the original prepared document even after the case advances. Repeating save first reconciles the original case event and retained response. If the response was lost, the same native request identity recovers its original result. A changed case/version or differing request body produces the actual conflict and original request to review.

Use adoption_request with caseId, requestId and expectedPreparedSha256 to inspect that original request. Use adoption_open with the returned source ID and SHA256 to reopen its complete edition. The existing browser opens the same saved source.

### Deliver the complete result

JSON preserves the full selected original wrapper and its source, plan, allocation or comparison. CSV uses the existing complete plan, scheduling or comparison exporter. HTML includes the full workload, original target rows, currencies, service pricing, every daily capacity row, funding groups, occurrences, allocation constraints and original editable JSON. Retrieve every byte with merchant_grant_file_read and its returned file identity.

For another operator's editable case, use the existing merchant_grant_export with kind case and the original case_import operation. The saved adoption source travels with the native case package. A receiving case keeps its own identity while adoption_open preserves the source edition's original identities.

Applications using the module directly pass their existing GrantWorkspaceClient to the exported functions. saveGrantCohortAdoption also takes a retainResponse callback that durably stores the complete native response before resolving; the Merchant owner supplies this using its existing immutable file writer.


## Continue the complete working session

Open **Cohort planning → Saved editions → Complete working session**. Choose
**Download working session** to carry the complete editor to another browser
that opens the same original Operations case. The file contains the current
plan and report, every unfinished row and its literal input text, earlier
drafts, both selected comparison sources, comparison history, incoming source
documents, allocation choices and full decisions, opened source bytes, and
the original pending or accepted source-attachment request.

Choose **Open working-session JSON** in that case. The complete file enters
**Incoming working sessions** while the current editor stays selected. Review
its case/source version, unfinished-row and history counts, allocation method,
original request identity and complete snapshot identity. **Open as working
session** opens that exact state and retains the predecessor under **Earlier
working sessions**. Each retained state has a complete-session download, and
the main download includes the full earlier/incoming history. Reopening the
same file reuses its original entry identities.

A source file that finishes reading after another edit or a panel remount
still enters the incoming list. Its arrival does not replace the current
editor. Partial numeric/date text stays editable; the original row editor
validates it when the operator applies the row. Changed calculated reports,
allocation decisions, source snapshot identities, unsupported schemas and
another case's working file are rejected before selection changes. Existing
foreign-case comparison documents remain attached to their original sources.

An original save travels with its exact actor, case version, request ID,
source filename, original JSON and encoded request body. When the opened
state contains a pending request, use **Continue original save**. When it
contains an accepted result, use **Read back saved source**. These controls
use the original `source.add` writer and verify the saved source bytes. The
working-file reader accepts only that attachment action for restored native
requests. Finish a currently selected request before opening a different
working editor; a file can still be retained in the incoming list meanwhile.

The browser retains immutable earlier/incoming snapshots in its larger
IndexedDB archive and keeps their exact identities in the compact session
cache. Complete snapshot writes finish before a successor is selected.
A cache/archive failure preserves the currently selected editor and reports
the failure. Keep the downloaded working-session JSON when moving browsers
or clearing site data. A complete working file may contain up to 64 MiB; a
native source attachment keeps the original 8 MiB limit.

The portable schema is `stellar-forge.sf47-cohort-working-session.v1`.
It contains one current entry, flat earlier/incoming entries and complete
SHA-256-identified snapshots. Identical snapshots share one body. Each snapshot
retains the original editor state, including the full documents behind its
comparison and native request. Export/import validates all retained snapshots
and exact request bytes; each full calculated report and saved allocation is
checked with the original calculator. The session helper is
`cohort_planning_session.mjs`, with its adjacent declaration. The original
controller imports it directly, so the installed source closure carries this
complete workflow.


## Use recorded costs to prepare a future service plan

The **Recorded cost basis** panel closes the loop between a complete saved delivery
reconciliation and the next adoption plan. It uses the same capacity, funding,
pricing and comparison engine as the rest of this desk.

### Operator workflow

1. Open the intended future plan in Customer adoption plan. Keep its actual
   cadence, purchased funding groups, prices, capacity pools and source identities.
   Every occurrence of a selected target schedule must be after the recorded
   comparison's UTC cutoff day.
2. Open **Recorded cost basis**, select the complete saved delivery comparison and
   choose **Open original commercial result**. The complete current plan is
   retained as the future baseline. **Capture current plan as future baseline**
   explicitly replaces that baseline after you finish changing future dates.
3. Add one allocation for each future schedule. Choose the original service, enter
   the actual useful-output quantity, its unit and the original measurement basis.
   This quantity is an entered operational measurement. The desk does not derive it
   from payment count, purchased groups, scheduled tasks or requests.
4. Enter the portion of each relevant original cost as a decimal share from zero to
   one; leave other rows empty. Supplier and other delivery costs contribute to the
   nonlabor estimate. Labor contributes its actual hours and calculated cost.
   All selected rows must belong to the chosen original service. Payment fees stay
   in the future plan's original payment model.
5. State whether supplier and labor coverage are **PARTIAL** or **COMPLETE** for
   the measured output, and enter the coverage explanation. Incomplete coverage or
   an unknown selected cost remains unknown in the resulting estimate. A known
   zero requires explicit complete coverage; the absence of a row alone does not
   turn a partial category into zero.
6. **Calculate complete successor** shows supplier cost per useful task and per
   underlying request, the retained task/request conversion, hours per task and
   hourly cost, selected/unselected source shares, full financial report,
   capacity and price floors. Resolve an invalid source, cost share, currency,
   measured output, or future-date constraint in the same retained form.
7. Review **Open before / after comparison**, then **Apply to editable future
   plan** or **Apply and save complete edition**. Further manual edits remain
   editable in the original planning desk. The immutable original cost proposal
   and its separate comparison to the saved successor travel with the edition.
   Save uses the current original case version, the existing source attachment
   action, retained request recovery and exact source readback.

The browser working session includes the source, complete baseline, choices,
unfinished allocation fields, earlier source selections and calculated/applied
proposals. Saved editions and imported proposal JSON reopen that same source
basis. Whole JSON and CSV exports retain the full original comparisons and
derivations. The full case export includes the saved native source edition.

### Cost and quantity meaning

An allocation selects cost shares across a measured useful-output quantity.
For example, an explicitly selected $12 materials cost and 1.25 actual labor
hours at $4/hour, assigned to two measured useful results, produce $6 materials
and 0.625 active hours per result at $4/hour. Running two future results costs
$17 before the plan's original payment fees. The two measured results need not
equal a payment count. The original payment and funding identities remain
untouched. If each future task uses three requests, the same $6 materials per task
becomes $2 per underlying request. Two tasks then use six requests and still cost
$12 materials plus $5 labor, rather than charging the materials three times.
The entered or saved measured unit must represent one complete future task; keep
that relationship explicit in the original measurement/source basis.

For each selected actual cost, the shares across *all* target allocations must
sum to at most one. Unselected shares remain visible. Every selected contribution
retains its whole original cost row, including any native Work, invoice,
contributor, attachment and reviewed overlap witnesses. Resolve invoice-linked
Work overlap in the original commercial reconciliation before deriving a plan.

Supplier cost per completed task is selected supplier/other cost divided by measured
completed tasks. The original planner charges `unitCost` per underlying request,
so the derived `unitCost` additionally divides by the selected future schedule's
`requestsPerTask`. The complete derivation retains both quantities, the exact
corresponding request count and the supplier cost per task. Hours per task are
selected labor hours divided by measured completed tasks.
Hourly cost is selected labor cost divided by selected labor hours. Derived
nonnegative rates are ceiling-rounded to twelve decimal places, while the
underlying amounts, hours and shares remain exact decimal values. The original
calculator then evaluates every future occurrence and its capacity allocation.
Explicit complete zero labor cost and hours produces zero rates. Unknown labor
valuation suppresses hourly cost while known hours can still inform capacity.

The operation changes only the selected schedules' `economics.unitCost`,
`economics.activeHoursPerTask`, `economics.hourlyCost` and the successor name.
A schedule whose economics were absent receives the source currency with unknown revenue and payment-fee estimates; its cost and hours can then be reviewed without inventing sale terms. All other rows and fields are preserved. An already purchased group reused for
future delivery is still prepaid; the calculator does not count another sale.

### Complete source API

`cohort_delivery_comparison.mjs` exports:

- `seedCohortRecordedCostPlan(recordedDocument, planDocument)`
- `planCohortFromRecordedCosts(recordedDocument, planDocument, choices)`
- `reopenCohortRecordedCostPlan(document)`
- `exportCohortRecordedCostPlanCsv(document)`

A complete result has schema
`stellar-forge.sf47-cohort-recorded-cost-plan.v1`, the whole `sourceDocument`,
whole `planDocument`, normalized `choices`, `candidate`, `report`,
`comparison`, per-allocation `derivations` and all `costBalances`.
New normalized choices carry `quantityBasis: "COMPLETED_TASKS"`. Each derivation
includes its completed tasks, requests per task, corresponding requests and
supplier cost per task. A complete historical document without that marker reopens
with its original calculation and bytes. Explicitly calculating a successor uses
the current unit conversion; the browser retains the earlier complete proposal.
Reopen recalculates and compares the complete result with these originals.
The existing 8 MiB native attachment bound applies to the whole saved edition;
source is never silently omitted to fit it.

An illustrative allocation, using IDs from the selected original documents:

```json
{
  "name": "Next customer service window",
  "note": "Original measured output and dated actual-cost basis reviewed",
  "quantityBasis": "COMPLETED_TASKS",
  "allocations": [{
    "id": "report-service-basis",
    "targetScheduleId": "future-report-service",
    "sourceServiceId": "funded:original-service",
    "outputQuantity": "2",
    "outputUnit": "completed useful report",
    "outputSource": "Original completion register and reviewed source reference",
    "supplierCoverage": "COMPLETE",
    "laborCoverage": "COMPLETE",
    "coverageNote": "Selected invoice portion is materials; selected Work is separately paid labor.",
    "costs": [
      {"costId": "original:materials-portion", "share": "1"},
      {"costId": "original:labor-portion", "share": "1"}
    ]
  }]
}
```

The maintained MCP `merchant_grant_adoption_edit` operation accepts
`FROM_RECORDED_COSTS` as its sole change, with `recordedDocument` and
`choices`. Its main document is the complete intended future plan. Review,
prepare, save, request-status, open and export continue through the existing
adoption tool family. Before native preparation, the complete original saved
plan bytes and frozen review are checked against the original case. A prepared
source edition retains `recordedCostPlan` and
`recordedCostPlanComparison`; ordinary subsequent plan edits retain the basis.

```sh
node cohort_planning_cli.mjs recorded-cost-seed --recorded delivery.json --baseline future-plan.json --output choices.json
node cohort_planning_cli.mjs recorded-cost-plan --recorded delivery.json --baseline future-plan.json --choices choices.json --output cost-plan.json
node cohort_planning_cli.mjs recorded-cost-reopen --input cost-plan.json --output reopened-cost-plan.json
node cohort_planning_cli.mjs evaluate --input cost-plan.json --output future-report.json
node cohort_planning_cli.mjs csv --input cost-plan.json --output complete-cost-basis.csv
```

### Focused source exercise

The maintained comparison, planning, adoption agent, browser and CLI modules were
executed in V8 against the original native source contract, using an in-memory
native-client/API transport and an in-memory browser adapter. The controlled
two-result case above produced $6/result, 0.625 hours/result and $4/hour; preserved
both original prepaid funding groups; surfaced the original no-new-charges result;
retained unknowns for partial coverage; and rejected an excessive cost share, a
past target schedule and a changed retained result. The original adoption
prepare/save/request/open flow attached one complete 779,545-byte edition in the
in-memory transport and reopened it exactly. The original browser form saved and
reopened its complete source, and the working-session validator retained its cost
basis. CLI calculation, complete reopen and CSV used the same production core.

## Use saved Customer task outcomes as the output basis

The **Recorded cost basis** allocation form can receive the original saved
Customer task outcomes comparison. This connects the useful result to its
selected delivery costs without retyping the completed-task count or losing the
original population, period, output, quality and customer response.

1. Open the intended future adoption plan and its original commercial
   reconciliation as described above.
2. In the allocation form, choose the **Saved measurement edition** and open
   it. The source selector includes every original saved comparison revision,
   including historical editions.
3. Select **Initial installed method** or one exact recurring observation.
   Review its whole task, completed count, stable unit, measurement basis,
   scope, operator review and original customer response.
4. Explain why that complete task and the selected commercial service costs
   describe the same output. The product does not infer this relationship from
   a matching customer name, purchase count or overlapping dates.
5. Choose **Use this complete measurement in allocation**. Its count, unit and
   original reference now come from that saved source. Select the actual cost
   portions and coverage, then **Keep complete allocation**.
6. Calculate the full successor, review its original measured scope alongside
   the financial/capacity result, and apply or save the complete edition.

A selected measurement keeps its **OBSERVED**, **ESTIMATED** or **MIXED** basis.
The source's Draft/Reviewed decision and Pending/Accepted/Declined customer
response remain separately visible. Selecting an estimate does not turn it into
an observed result, and using a completed-task count does not record a sale or
customer acceptance. A missing or zero count cannot divide the selected cost;
complete that measurement through its original Customer task outcomes desk.
The prior baseline is retained inside the original comparison but is not offered
as the installed-service output denominator.

Opening a source or refreshing the case does not replace the allocation's
selected measurement. To use a later comparison revision, open that exact
edition, review it and explicitly use it in the allocation. The complete former
selection remains in **Earlier retained measurement choices**. The original
count/unit/reference fields stay read-only while bound. **Continue with a manual
denominator** retains the former measurement and makes the denominator editable
for a separately explained planning assumption.

The complete native response includes its original source metadata, saved
comparison, original case/Installation/source selection and history directory.
The retained planning document carries all of it. Native review and preparation
reopen each selected comparison revision through the original Task Outcomes
reader, which validates the original source and calculation. Newer comparison
history can coexist with a pinned earlier edition. After complete case receiving,
the measurement retains its original producer case identity. The planning desk
records the selected receiving case separately and verifies the same original
source through that case's native inventory and reader. An altered selected source
requires explicit re-selection; the existing allocation and entered cost
portions remain available for review.

The full working-session download also retains an opened measurement that has
not yet been applied, its selected observation and unfinished service explanation.
The complete JSON and CSV retain every selected and earlier source. Readable
HTML shows the original basis, review, customer response and scope beside the
future schedule. The existing source.add request, recovery, saved-plan reopening
and complete case transfer carry this operation without a separate source store.

### Installed command and Merchant continuation

Use the original Task Outcomes reader to export the complete response, including
`source`, `edition` and `history`. Keep the original case and selected revision.
Do not use `--inputs-only`, which intentionally omits its saved source.

~~~sh
starforge grant-workspace operations task-outcomes-show \
  --workspace /absolute/private/grant --case ORIGINAL_CASE_ID \
  --comparison ORIGINAL_COMPARISON_ID --revision SAVED_REVISION \
  --output /absolute/working/saved-task-response.json

node cohort_planning_cli.mjs task-measurements \
  --input /absolute/working/saved-task-response.json \
  --output /absolute/working/measurement-selection.json

node cohort_planning_cli.mjs recorded-cost-bind \
  --choices /absolute/working/cost-choices.json \
  --allocation ORIGINAL_ALLOCATION_ID \
  --measurement /absolute/working/saved-task-response.json \
  --kind FOLLOWUP --observation ORIGINAL_OBSERVATION_ID \
  --service-basis "Original scope and selected service-cost relationship" \
  --output /absolute/working/bound-cost-choices.json

node cohort_planning_cli.mjs recorded-cost-plan \
  --recorded /absolute/working/commercial-result.json \
  --baseline /absolute/working/future-plan.json \
  --choices /absolute/working/bound-cost-choices.json \
  --output /absolute/working/measured-cost-plan.json
~~~

Choose `--kind INSTALLED` and omit `--observation` for the original installed
method. For a comparison opened from an independently received case, include
`--case RECEIVING_CASE_ID`; the original producer identity remains in the saved
source. The browser supplies its current selected case automatically. The source and choices commands keep existing destinations intact.

The pure module exposes `inspectCohortTaskMeasurements` and
`bindCohortRecordedCostMeasurement`. The latter receives the complete allocation,
native saved response and explicit `{kind, observationId, serviceBasis, caseId?}`; it
returns the complete editable allocation and retains an earlier selected
measurement before accepting another. `planCohortFromRecordedCosts` checks the
bound count/unit/reference and calculates through the same existing engine.

Merchant agents obtain the full selected response through
`merchant_grant_task_outcome`. In the existing adoption edit operation, select
`FROM_RECORDED_COSTS` and keep the full original reconciliation and choices.
An allocation's optional `measurement` is:

~~~json
{
  "schema": "stellar-forge.sf47-cohort-task-measurement.v1",
  "original": {"source": {}, "edition": {}, "history": []},
  "kind": "FOLLOWUP",
  "caseId": "ORIGINAL_OR_RECEIVING_CASE_ID",
  "observationId": "ORIGINAL_OBSERVATION_ID",
  "serviceBasis": "Original measured task and selected cost relationship"
}
~~~

The empty objects above identify the fields; supply the entire native source,
edition and history. Optional `caseId` names the selected case holding that source;
omission retains the original producer case. Native preparation verifies the
actual selected source and saved revision in that case. The operation derives `outputQuantity`, `outputUnit` and
`outputSource` when omitted; supplied values must equal that original selection.
Continue the existing adoption review, prepare, save, request recovery and open
tools. The Task Outcomes writer, its original revisions and any measurement
workbook remain in their own native workflow.

The multi-request continuation used the same maintained modules and in-memory
source/browser adapters: two measured tasks, three requests per future task,
$12 selected materials and 1.25 hours at $4/hour produced $2/request,
0.625 hours/task and $17 total for six requests. Purchased funding stayed exact.
The full independently received-case prepare/save/recovery/reopen retained
826,748 bytes, with both original and selected case identities unchanged.
Earlier complete proposal documents reopened exactly with their original
calculation; an explicit new calculation selected the current quantity basis.
