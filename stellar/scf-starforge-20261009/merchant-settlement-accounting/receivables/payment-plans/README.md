# Merchant payment plans

Plan and operate customer installments over the existing merchant receivables
workspace. The desk keeps each original issued invoice, customer, payment,
allocation, release and credit note connected to its payment schedule.

Open **Payment plans** from the receivables navigation or run:

```sh
starforge payment-plans serve --directory /private/merchant/accounting --port 8448
```

The printed URL opens the clean local collection desk. The original accounting
process owns the workspace lease, saved revision, mutation journal and backups.
Stop an existing standalone accounting process before opening its directory in a
second process. An already-open accounting runtime can mount the exported
payment-plan route adapter directly.

## Prepare the customer schedule

1. Choose an issued invoice and the date of the balance to schedule. The source
   is the invoice's actual remaining amount after its original dated payments
   and credit notes. The selected currency and decimal precision come from that
   invoice.
2. Enter installment dates and amounts. **Generate installments** divides the
   selected balance into an explicit number of payments on a chosen fixed-day
   or calendar-month cadence. The final installment includes the exact remainder. The
   generated rows stay editable before saving.
3. Add a schedule title, reference and customer note. Save the draft. The total
   of all positive installments must exactly equal the selected invoice balance;
   all dates must fall on or after the balance date.
4. Review the invoice, retained balance and complete installment table. Activate
   the reviewed edition. A changed invoice balance or a newer plan edit requires
   a fresh review.
5. Download the retained schedule as printable HTML, CSV or JSON. The customer
   document includes the original invoice number, merchant and customer details,
   payment instructions, balance date, schedule reference and dated amounts.

Amounts are decimal strings at the invoice's explicit precision. A 100.00
balance divided into three installments produces 33.33, 33.33 and 33.34.

A saved draft and the active customer edition remain separate. Editing a draft
keeps the existing active schedule available until its successor is reviewed
and activated. Every activated edition retains its own original files.

### Calendar scheduling

Choose **Monthly**, **Quarterly**, **Yearly**, or **Custom calendar months** in
the schedule editor. The generator uses the first due date as the anchor for
every installment. A shorter month uses its last day, then the next installment
returns to the original day. For example, a monthly schedule starting on
2027-01-31 produces 2027-01-31, 2027-02-28 and 2027-03-31; one starting on
2027-01-30 returns to 2027-03-30 after February.

Choose **Last day of month** to keep every date at month end. The first due date
must itself be the last day of its month, so a monthly schedule starting on
2027-02-28 continues on 2027-03-31 and 2027-04-30. With **Original day of month**,
the same February start continues on March 28 and April 28. Leap years follow
the calendar: a yearly schedule starting on 2024-02-29 returns to February 29
in 2028.

**Weekly** and **Every two weeks** use fixed intervals of seven and fourteen
days. **Fixed number of days** preserves any explicit interval from one to
3,660 days; omitted intervals in existing API requests still mean 30 days.
Custom calendar spacing accepts one to 120 months. The count includes the
first installment and supports one to 1,000 rows. All dates must remain within
four-digit calendar years.

The generator returns explicit editable dates and exact amounts. Saving,
review, activation, historical collections and customer files continue using
those selected rows. Changing a generation control alone leaves the current
rows as entered; choose **Prepare schedule** to replace them with a new
calculation. The editor keeps the selected cadence while preparing or editing
that draft. Dates and amounts can always be adjusted before saving.

The same HTTP, native and CLI generate request accepts either `intervalDays`
or `intervalMonths`, never both. Calendar-month requests also accept
`monthAnchor: "DAY_OF_MONTH"` (default) or `"END_OF_MONTH"`. A month anchor
on a fixed-day request is rejected.

```json
{
  "invoiceId": "ORIGINAL_INVOICE_UUID",
  "balanceDate": "2027-01-15",
  "firstDueDate": "2027-01-31",
  "count": 4,
  "intervalMonths": 1,
  "monthAnchor": "END_OF_MONTH",
  "title": "Monthly customer schedule"
}
```

Use the original invoice ID and its actual balance date. The request above
selects January 31, February 28, March 31 and April 30. Quarterly and yearly
requests use `intervalMonths: 3` and `intervalMonths: 12`. Keep the returned
draft, workspace ID and revision for the existing save and review steps.

## Operate the collection desk

Choose **As of** and **Through** dates and, optionally, a single customer. Each
currency and precision has its own totals:

| Amount | Meaning |
| --- | --- |
| Amount due | Current balance from the original issued-invoice ledger. |
| Overdue | Remaining scheduled installments with a due date before the as-of date. |
| Due today | Remaining scheduled installments due on the as-of date. |
| Upcoming | Remaining installments after the as-of date through the selected horizon. |
| After horizon | Remaining installments due after the selected horizon. |
| Unscheduled | Issued-invoice balance that currently has no effective schedule, including an increase beyond its retained schedule. |
| Credit balance | The original invoice's credit balance. |

The installment table keeps its original due dates. Overdue rows remain overdue;
the desk does not move them into a future expected-cash date. The unscheduled
table links the remaining invoice balance to the invoice that needs a plan.

**Export collections** downloads complete JSON and CSV for the selected report
dates and customer. The CSV includes every remaining scheduled installment and
each unscheduled invoice amount. It keeps the currency code and precision with
each row. Aggregate amounts across different currencies stay separate.

### How actual payments change installments

Record and allocate payments in the existing **Receivables** view. The plan desk
reads those same dated allocations and releases:

- The net payment increase after the retained schedule balance covers the
  earliest installments first.
- Additional credit notes reduce the latest installments first.
- Released allocations update the original invoice balance. Any remaining
  invoice amount beyond the open schedule appears as an unscheduled amount.
- A fully settled invoice satisfies its remaining schedule. An effective invoice
  void closes its scheduled collection rows.
- Backdated original-ledger changes that alter the retained balance date are
  flagged for a fresh balance review. The original edition and its basis stay
  available.

For example, a 1,200.00 invoice with 200.00 already allocated can have four
250.00 installments for its remaining 1,000.00. Another 300.00 allocated through
Receivables satisfies the first installment and 50.00 of the second. A later
100.00 credit reduces the last installment to 150.00. The remaining scheduled
balance is 600.00, equal to the invoice's original-ledger balance.

Open a plan to inspect its original payment allocations, release dates, receipt
references, credit notes, history and retained editions. A schedule's current
projection is calculated for the chosen report date.

## Revise or cancel a plan

To reschedule an outstanding invoice, open its plan, choose a new balance date
and replace its draft installments with the amounts still due. Save, review and
activate the new edition. The new edition must take effect on or after its
previous edition's effective date.

For a historical report, the desk uses the latest retained edition effective on
or before the selected date. When two editions take effect on the same date,
the later edition is selected. A future edition becomes effective on its saved
balance date; until then, the earlier effective edition continues.

Cancel a plan with an explicit cancellation date and reason. Cancellation takes
effect on that date, including the date itself. Earlier editions and their files
remain accessible. The invoice returns to the unscheduled collection view from
the cancellation date until another effective schedule covers it.

There is one effective schedule per invoice. Another plan can become effective
after the earlier plan's cancellation date. The controller rejects overlapping
effective schedules.

## Recovery and shared operation

Every mutation carries the current accounting revision, a named operator and an
original stable request ID. Updating a draft, activating an edition or cancelling
a plan also carries its expected plan version. Activation sends the exact digest
of the review just shown.

The browser retains the complete pending mutation before sending it, bound to
the original accounting workspace identity. If the connection is interrupted,
read **Operation status** for that original request or retry the unchanged
request. The original receivables journal returns the existing operation if it
already completed. Reusing the request ID for different content is rejected.

If the original accounting writer requests reopening after an uncertain save,
close and reopen the same directory, recover its original operation, and
continue there. A stale revision keeps the operator's draft available for
comparison with the new state.

Payment-plan records live at:

```text
workspace.json.receivables.paymentPlans
```

Every activated edition's files live in a unique directory under the original
accounting `exports/` tree. The original accounting backup therefore carries
the plan history, complete request journal and every retained schedule document.
Downloads compare the actual file lengths and SHA-256 with the saved edition.

## Command-line workflow

The following commands operate the same native controller as the browser:

```sh
starforge payment-plans state --directory /private/accounting --as-of 2026-10-31 --through 2026-12-31
starforge payment-plans generate --directory /private/accounting --input /private/generate.json
starforge payment-plans apply --directory /private/accounting --action save --input /private/save.json
starforge payment-plans preview --directory /private/accounting --id PLAN_UUID
starforge payment-plans apply --directory /private/accounting --action activate --id PLAN_UUID --input /private/activate.json
starforge payment-plans operation --directory /private/accounting --request ORIGINAL_REQUEST_ID
starforge payment-plans file --directory /private/accounting --id PLAN_UUID --edition EDITION_UUID --name schedule.html --out /private/new-schedule.html
starforge payment-plans export --directory /private/accounting --as-of 2026-10-31 --through 2026-12-31 --out /private/new-collections
```

Use the actual IDs, dates and current revision returned by the workspace.
A save request has this shape:

```json
{
  "revision": 12,
  "requestId": "customer-schedule-001-save",
  "actor": "Accounts receivable",
  "workspaceId": "ORIGINAL_WORKSPACE_ID",
  "plan": {
    "invoiceId": "ORIGINAL_INVOICE_UUID",
    "balanceDate": "2026-10-31",
    "title": "Payment schedule",
    "reference": "Customer account schedule",
    "customerNote": "Reference the invoice number with each payment.",
    "installments": [
      {"id": "first", "dueDate": "2026-11-15", "amount": "500.00", "label": "First installment"},
      {"id": "second", "dueDate": "2026-12-15", "amount": "500.00", "label": "Final installment"}
    ]
  }
}
```

For a draft update, include its ID inside `plan` and its current
`expectedVersion` at the top level. `workspaceId` is optional for
direct native callers; when present, the controller checks it before mutation.

An activation request supplies the current `revision`,
`expectedVersion`, `actor`, a new stable `requestId`
and the exact `reviewSha256` from preview. Cancellation replaces the
review digest with `cancelledDate` and `reason`.

The CLI writes selected outputs to new files or directories. A complete
collection export includes its original JSON and CSV plus a file manifest.

## Native interfaces

`PaymentPlanWorkspace` extends the existing receivables controller and
uses its accounting workspace object:

```js
import {PaymentPlanWorkspace} from './store.mjs';

const plans = await new PaymentPlanWorkspace(accountingWorkspace).init();
const current = await plans.state({asOf: '2026-10-31', through: '2026-12-31'});
const detail = await plans.detail(planId, {asOf: '2026-10-31'});
const preview = await plans.previewPlan(planId);
const result = await plans.activate(planId, {
  revision: preview.revision,
  workspaceId: preview.workspaceId,
  expectedVersion: preview.planVersion,
  reviewSha256: preview.reviewSha256,
  requestId: originalActivationRequestId,
  actor: 'Accounts receivable'
});
```

| Interface | Result |
| --- | --- |
| `state({asOf, through, customerId})` | Workspace identity, revision, customer and invoice selectors, saved plans and complete collection report. |
| `detail(planId, {asOf})` | Current projection, editable draft, edition inventory, original ledger links and history. |
| `generate(value)` | Exact editable installment draft and current revision. |
| `savePlan(value)` | Saved draft, current plan projection and original request operation. |
| `previewPlan(planId)` | Invoice source snapshot, complete schedule and review digest. |
| `activate(planId, value)` | Frozen schedule edition and original request operation. |
| `cancelPlan(planId, value)` | Dated cancellation and original request operation. |
| `getOperation(requestId)` | Existing original operation, or a null operation if the journal has no such request. |
| `scheduleFile(planId, editionId, name)` | Original bytes, download name and MIME type. |
| `collectionsFiles(query)` | Complete report, JSON and CSV bytes, workspace identity and revision. |

The pure calculations, schedule renderer and CSV exporters are in
`core.mjs`. HTTP and browser clients use the same model. Parent
runtimes keep their existing request, authentication and lifecycle boundary
when mounting `handlePaymentPlanRequest` and the payment-plan assets.

The source retains the project's MIT license.
