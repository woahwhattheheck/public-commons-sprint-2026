# Merchant cash receipt planning

Use **Cash planning** in the original Receivables application to prepare, retain and compare expected receipt scenarios from the merchant's issued invoices, effective installment schedules and recorded customer promises.

Each saved edition keeps its complete account-date projection, assumptions, original source identities, accounting revision, operator and review digest. Later account changes appear when you recalculate a new edition. Open an earlier edition to read or export the complete plan that was saved at that time.

## Open the workbench

Start the existing installed account:

~~~sh
starforge receivables serve --directory /private/merchant/accounting
~~~

Open the printed local address and select **Cash planning**. The same application provides Invoices, Receipts, Payment plans and Collections. An existing Runtime Applications merchant-receivables instance can use its original saved accounting directory.

From a source checkout:

~~~sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/cli.mjs \
  serve --directory /private/merchant/accounting
~~~

The maintained merchant-receivables contribution includes the complete model, controller, typed client, command line, guide and browser module. The [merchant receivables product guide](../../../../products/merchant-receivables/README.md) gives the full accounting initialization and installation path.

## Build the collection scenario

1. Review current receipts, allocations, invoice credits and open customer questions in the original account. The preview also identifies available customer receipts and credit balances so you can apply existing funds in the account before planning new receipts.
2. Choose **New plan**. Enter a title, owner, account date and planning horizon. Select all customers or one customer.
3. Choose daily, weekly or monthly receipt periods. Weekly periods begin at the selected account date. Monthly periods follow calendar months, including a partial first or last month.
4. Set the timing assumptions. A past-due receipt uses the selected number of days after the account date. A receipt with an original date on or after the account date uses that original date plus the future delay.
5. Choose whether to use open recorded promises and whether to separate open disputed amounts.
6. Choose **Recalculate and review**. Inspect the totals, periods, original invoice allocation, available customer funds and any changed source bases.
7. Enter any invoice-specific date or exclusion assumptions, with their reasons, and recalculate.
8. Choose **Save reviewed edition**. The complete projection is retained in the original accounting workspace.

The account date controls the original balance and effective source records. Expected dates express the selected scenario assumptions. Copying or revising a saved plan keeps its original dates until you edit them.

### Read the totals

| Column | Meaning |
| --- | --- |
| Original due | Remaining issued-invoice balance from the original ledger at the account date. |
| Within horizon | Scenario receipts on or after the account date through the selected final date. |
| After horizon | Scenario receipts assigned a date beyond the selected final date. |
| Separated | Balance kept outside expected receipts, including disputed, explicitly separated and source-review portions. |
| Of separated: awaiting review | The part of Separated awaiting an explicit source or invoice-date decision. |

For each invoice and each currency/precision group:

~~~text
Original due = Within horizon + After horizon + Separated
~~~

The screen and printable report use readable dates; saved times include UTC. Form date values and machine JSON/CSV retain their original exact values. Currency labels state their decimal precision.

Awaiting review is a subset of Separated. Currency codes with different decimal precision remain separate. The period table shows expected receipts and the cumulative amount through each period.

Available customer receipts and invoice credits are shown in their own table. Their original saved allocation determines the invoice balance. Applying those funds through the original account and recalculating creates a plan with the resulting remaining balances.

## How the source becomes a receipt plan

The workbench uses the latest original payment-plan edition effective on the account date. A later edition or future cancellation preserves the earlier dated view. It consumes the original installment projection, which already applies payments to earlier installments, credits to later installments and released amounts to the invoice remainder.

An invoice without an effective payment schedule starts with its original due date. Any amount beyond a retained schedule also keeps that original invoice due date.

When the scenario separates an open dispute, that amount is capped to the current balance and taken from the latest remaining contractual portions. The case, dispute and original event identity remain attached.

When the scenario uses an open recorded promise, payments allocated after the promise's original balance date reduce its remaining amount. The eligible promise amount then replaces the earliest remaining contractual portions. The promise date stays visible beside the expected receipt date. Its explicit Kept, Broken or Withdrawn outcome continues in Collections.

Only an open collection case supplies a promise or dispute to the scenario. Closing the case preserves its history and lets the original invoice and installment dates supply future planning.

### Worked allocation

Suppose an invoice was 100.00 and has two 50.00 installments. The customer recorded a 50.00 promise and a 20.00 dispute, then paid 30.00 through the original invoice allocation.

The account now shows 70.00 due. With the promise inside the selected horizon and the remaining installment after it, the scenario can show:

| Portion | Amount |
| --- | ---: |
| Remaining recorded promise inside the horizon | 20.00 |
| Remaining installment after the horizon | 30.00 |
| Open disputed amount separated | 20.00 |
| Original invoice balance | 70.00 |

The promise replaces scheduled money. Every original remaining unit appears once.

## Changed source bases and invoice decisions

The planner recalculates the invoice at the original installment and promise balance dates. A backdated change can alter those retained bases even when the account's current amount due looks ordinary.

A changed installment or promise basis, overlapping schedules or a schedule/balance mismatch appears on that invoice with its exact current balance under **Of separated: awaiting review**. Other invoices continue to project normally. The original source code and record identity remain in the saved edition.

Use **Set assumption** to assign the whole invoice an expected receipt date after reviewing the current account, or to separate the whole invoice from expected receipts. Enter the operational reason. An explicit invoice assumption covers the full remaining invoice, including any open disputed amount, and supplies its placement in this scenario. Its source warning remains visible in the edition, JSON, CSV and HTML.

Choose **Use source dates** to remove that explicit assumption and recalculate from the original schedules and selected scenario rules. An assumption for an invoice that has become settled or falls outside the chosen customer view stays visible as inactive.

## Revise, copy, compare and archive

Open a saved plan to inspect its complete edition and history.

**Revise latest edition** loads the latest saved assumptions into the workbench. Recalculate against the current account before saving another edition. The earlier editions remain available in the edition selector.

**Copy this edition** starts a separate scenario from the selected edition's assumptions. Adjust delays, customer scope, disputes or individual invoice dates, then review and save.

**Compare saved scenarios** compares the latest saved editions of two selected plans. **Compare to previous edition** compares an edition with its immediate predecessor. Comparisons show both source accounting revisions, account dates, horizons and exact right-minus-left changes by currency and receipt date. Downloaded comparisons stay bound to the same selected edition IDs.

**Archive plan** and **Reopen plan** retain an operator reason and history. An archived plan's original editions, files and comparisons remain available.

## Export a retained edition

| File | Contents |
| --- | --- |
| plan.json | Complete saved edition, assumptions, original invoice/plan/promise bases, customer funds, source issues and projection. |
| plan.csv | Every invoice allocation with source identity, original date, expected date, position, amount, reason and source issue codes. |
| plan.html | Printable operator plan with totals, periods, invoice allocation, available customer funds and source decisions. |
| manifest.json | Length and SHA-256 of the three generated plan files and the original review digest. |

CSV cells protect spreadsheet formula prefixes and retain explicit currency precision. The files come from the chosen retained edition, so a later account correction or plan revision preserves those earlier exported values.

Comparison JSON contains the full two-edition metadata and currency/date differences. Comparison CSV gives the dated receipt differences.

## Command line

Read the account binding and saved plans:

~~~sh
starforge receivables cash-plans --directory /private/merchant/accounting --status ACTIVE
~~~

Use its exact workspaceId in a private preview request:

~~~json
{
  "workspaceId": "ORIGINAL_WORKSPACE_ID",
  "plan": {
    "title": "October receipts",
    "owner": "Accounts receivable",
    "note": "Customer follow-ups reviewed for the monthly operating plan.",
    "asOf": "2026-10-12",
    "through": "2026-10-31",
    "bucket": "WEEK",
    "pastDueDelayDays": 3,
    "futureDelayDays": 0,
    "usePromises": true,
    "disputes": "SEPARATE",
    "overrides": []
  }
}
~~~

~~~sh
starforge receivables cash-plan-preview --directory /private/merchant/accounting \
  --input /private/receipt-assumptions.json --out /private/receipt-review.json
~~~

The returned review includes workspaceId, revision, the normalized plan, complete projection and reviewSha256. A save request carries those exact workspaceId, revision, plan and reviewSha256 values, together with actor and a stable requestId. Updating an existing plan also includes its id and expectedVersion.

~~~sh
starforge receivables cash-plan-save --directory /private/merchant/accounting \
  --input /private/reviewed-receipt-plan.json

starforge receivables cash-plan --directory /private/merchant/accounting \
  --id ORIGINAL_PLAN_UUID --edition ORIGINAL_EDITION_UUID

starforge receivables cash-plan-file --directory /private/merchant/accounting \
  --id ORIGINAL_PLAN_UUID --edition ORIGINAL_EDITION_UUID \
  --name plan.html --out /private/new-receipt-plan.html
~~~

Archive or reopen through cash-plan-archive or cash-plan-reopen with --id and --input. Their request includes workspaceId, revision, actor, requestId, expectedVersion and note.

For comparison, prepare a private query with leftId and rightId. Include leftEditionId and rightEditionId to choose exact retained editions. Omitting an edition selects that plan's latest saved edition for the command.

~~~sh
starforge receivables cash-plan-compare --directory /private/merchant/accounting \
  --input /private/compare-plans.json

starforge receivables cash-plan-comparison-file --directory /private/merchant/accounting \
  --input /private/compare-plans.json --name comparison.csv \
  --out /private/new-receipt-comparison.csv
~~~

Output files are created at new private paths. Keep the original selected edition IDs with an exported comparison.

## Typed client and native methods

~~~js
import {createReceivablesClient} from
  '@tokenjunkielabs/starforge-merchant/merchant/receivables/client';

const client = createReceivablesClient({
  baseUrl: 'http://127.0.0.1:8448/api/receivables'
});
const account = await client.cashPlans();
const review = await client.previewCashPlan({
  workspaceId: account.workspaceId,
  plan: {
    title: 'October receipts',
    owner: 'Accounts receivable',
    asOf: '2026-10-12',
    through: '2026-10-31',
    bucket: 'WEEK',
    pastDueDelayDays: 3,
    futureDelayDays: 0,
    usePromises: true,
    disputes: 'SEPARATE',
    overrides: []
  }
});
const saved = await client.saveCashPlan({
  workspaceId: review.workspaceId,
  revision: review.revision,
  actor: 'Accounts receivable',
  requestId: crypto.randomUUID(),
  plan: review.plan,
  reviewSha256: review.reviewSha256
});
const retained = await client.cashPlan(saved.cashPlan.id, {
  editionId: saved.cashPlanEdition.id
});
~~~

The original ReceivablesWorkspace exposes the same cashPlans, previewCashPlan, cashPlan, saveCashPlan, archiveCashPlan, reopenCashPlan, cashPlanFile, compareCashPlans, cashPlanComparisonFile and cashPlanOperation methods. Package exports /merchant/receivables/cash-planning and /merchant/receivables/cash-planning-workspace expose the original model and controller.

| Route after /api/receivables | Operation |
| --- | --- |
| GET /cash-plans | List retained plans; optional status and search. |
| POST /cash-plans/preview | Review the complete scenario against the current account. |
| POST /cash-plans | Save the exact reviewed plan as a retained edition. |
| GET /cash-plans/:id | Read a retained edition; optional editionId. |
| POST /cash-plans/:id/archive or /reopen | Retain the plan status change and reason. |
| GET /cash-plans/:id/files/:name | Download the selected edition file; optional editionId. |
| GET /cash-plans/compare | Compare selected plans and optional exact editions. |
| GET /cash-plans/compare/export | Download comparison.json or comparison.csv. |
| GET /cash-plans/operations/:requestId | Recover the original saved operation. |

## Continue an interrupted save

The browser parks the current plan assumptions in the session and binds them to the original accounting workspace and saved plan version. Editing assumptions invalidates the preview until you recalculate.

Saving enters the existing receivables pending-operation journal with the exact reviewed plan, source revision, review digest and stable request ID. **Retry same operation** reuses those arguments. A completed request returns its original retained edition.

A changed workspace or plan version requires reopening the correct current plan. A changed account revision or review digest requires recalculating the retained assumptions against the current original records. The earlier input remains available for review.

~~~sh
starforge receivables cash-plan-operation --directory /private/merchant/accounting \
  --request ORIGINAL_REQUEST_ID
~~~

The response contains the saved operation and its retained edition, or operation:null when that request has not been saved. An uncertain accounting commit uses the existing close/reopen recovery before the same pending request continues.

Plans reside in workspace.json.receivables.cashPlans. The original accounting backup includes their complete editions, status history and shared request journal.
