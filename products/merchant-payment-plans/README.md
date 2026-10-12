# Merchant payment plans and collections

The [complete merchant financial workflow](../merchant-workspace/FINANCIAL_OPERATIONS.md) connects this desk to original settlement accounting, customer invoices and receipt allocation, Xero handover and complete operating recovery.

Prepare customer installment schedules over the merchant's issued invoices, collect against the same recorded payments and credits, and retain every customer schedule edition. The payment-plan desk brings dated collections, invoice activity, schedule revisions and complete customer files into the existing private accounting workspace.

The `merchant-payment-plans` selection installs the **Customer payment plans** application together with the receivables, customer, accounting and quotation workflows it uses. The `merchant-receivables` selection also includes this desk. Both products use the same source under [merchant-settlement-accounting/receivables/payment-plans](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/payment-plans/README.md), the same customer identities and the same accounting writer.

## Install the selected product

Use the maintained `woahwhattheheck/tjlabs-stellar-merchant-workspace` checkout and the full commit containing the [payment-plan recipe](../../stellar/scf-starforge-20261009/distribution/selections/merchant-payment-plans.json). The existing source builder selects the complete accounting and quotation dependency graph, command and SDK registrations, Applications providers and browser asset maps from that commit.

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout --ref FULL_COMMIT_SHA \
  --selection merchant-payment-plans --out /private/payment-plans-release
~~~

The result names the archive and its SHA-256. Its package version includes the source commit and `selection.merchant-payment-plans`. The output directory belongs to that exact source and selection. Continue the same build after an interruption with:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout \
  --out /private/payment-plans-release --resume

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /private/payment-plans-release --status
~~~

In the Runtime workspace, **Build a product** discovers the committed recipe. Select **Merchant payment plans and collections**, review the selected source, and open the completed archive in **Source & profile**. A completed build's resume returns the retained archive. Choose a new output directory for another source commit or product.

The complete installed profile uses the existing Linux runtime: Node 22.16+, Python 3.11+, npm, `flock` and the original archive utilities. Prepare and receive the returned archive through the maintained runtime installer:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /private/payment-plans-runtime \
  --archive /absolute/returned-package.tgz --sha256 RETURNED_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /private/payment-plans-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /private/payment-plans-runtime --load --source
~~~

The profile retains the existing Stellar verification/recovery dependencies and the schema/OpenAPI dependencies used by the included source and quotation workflows. The selected source supplies their declared versions and original dependency manifests. A matching retained dependency tree can be received through the installer's `--adopt-existing` operation with its original lock. Use `resume --dir /private/payment-plans-runtime` to continue that same prepared installation.

The package is received at `/private/payment-plans-runtime/package/`, beside its selected `node_modules/`. Run the installed command through that layout:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /private/payment-plans-runtime -- payment-plans help
~~~

The remaining examples use the installed `starforge` command. Supply the same arguments after `runtime-install ... run --` when using the managed runtime directly. `starforge registrations --source merchant-payment-plans` displays its installed command, exports, browser contract and Applications provider.

## Open the merchant account

Reopen the merchant's initialized accounting directory:

~~~sh
starforge payment-plans serve \
  --directory /private/merchant/accounting --port 8448
~~~

The startup result opens `http://127.0.0.1:8448/payment-plans/`. The same running server provides **Invoices and payments** at `/receivables/` and **Customers and statements** at `/customer-statements/`. Use those views to maintain customer billing details, issuer settings, issued invoices, actual receipts, allocations and credit notes.

For a new accounting directory, select the merchant's actual source outbox, proof directory and accounting terms:

~~~sh
starforge payment-plans serve \
  --directory /private/merchant/accounting \
  --outbox /private/merchant/source/outbox \
  --proof-dir /private/merchant/source/proofs \
  --terms /private/merchant/source/terms.json \
  --port 8448
~~~

Keep the accounting directory outside its source input directories. Initialization validates those paths and terms before saving. Once initialized, reopen the same directory with its retained source settings.

### Manage the application from Runtime workspace

Attach the installed runtime to the existing operator workspace, or initialize one for this merchant:

~~~sh
starforge runtime-workspace init \
  --workspace /private/payment-plans-operator

starforge runtime-workspace attach \
  --workspace /private/payment-plans-operator \
  --runtime /private/payment-plans-runtime --label "Merchant collections"

starforge runtime-workspace serve \
  --workspace /private/payment-plans-operator --port 8465
~~~

In **Applications**, choose **Customer payment plans**, select the initialized accounting directory, then use **Review**, **Save**, **Start** and **Open**. The provider binds that directory's workspace ID and source configuration, rechecks them under the accounting lease, and receives the original startup URL. Its companion links open invoices and customer statements in the same process.

**Merchant receivables** opens the same combined server at the invoice desk. **Merchant accounting** retains the reconciliation and connection workflow; **Merchant support** retains cases and service quotations. The [receivables operating guide](../merchant-receivables/README.md) covers creating the first invoice and importing a retained implementation or recurring service quotation.

One process owns the accounting directory at a time. Use the running browser or HTTP client for that directory's operations. Before using a standalone CLI operation or another application as its owner, stop the current application through its existing Runtime controls. Reopen the same directory afterward.

## Prepare and issue a customer schedule

A payment plan covers the actual amount still due on one issued invoice at a selected balance date. The invoice supplies its customer, currency code and decimal precision.

1. Select **New payment plan**, choose the issued invoice and set its balance date. Inspect the balance after the original payments, allocation releases and credit notes effective on that date.
2. Enter the installment dates and positive decimal amounts. Alternatively, use **Prepare schedule** with a count, first due date and fixed-day or calendar-month cadence; the generated rows remain editable.
3. Add the customer-facing title, reference and note. The schedule total must exactly equal the selected balance. Every installment date must be on or after the balance date.
4. Save the draft, then review the invoice identity, customer, currency precision, retained balance and complete installment table.
5. Activate that reviewed edition. Open its retained files to print or deliver the customer schedule.

The generator divides exact decimal units and puts the remainder in the final installment. For example, 100.00 divided into three installments produces 33.33, 33.33 and 33.34. Monthly, quarterly and yearly schedules use calendar months from the first due date. Choose the original day of the month or the last day of each month; fixed-day schedules remain available.

Drafts remain editable. An existing active schedule continues while its replacement is being prepared. Activation freezes the reviewed schedule and invoice basis into a new edition, with the current customer and issuer details, reference, note and payment instructions. A changed draft version or invoice basis prompts a fresh review before activation.

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

### Customer files

Every activated edition retains these downloads:

| File | Contents |
| --- | --- |
| `schedule.html` | Printable customer schedule with invoice number, issuer/customer identity, payment instructions, dates and exact amounts. |
| `schedule.csv` | The complete edition's installment rows with currency and precision. |
| `schedule.json` | The retained schedule, original invoice identity and balance basis. |
| `manifest.json` | File names, lengths and SHA-256 identities for the retained schedule output. |

The files belong to that specific edition. Current payment activity changes the dated collection view while the issued customer documents retain their original content. Downloads check the saved file lengths and digests before returning the bytes.

## Run dated collections

Set **As of** to the account date and **Through** to the end of the collection horizon. Through must be on or after As of. Filter by customer when working one account; use search to locate the plan or invoice.

The desk keeps every currency code and decimal precision separate:

| Total | Meaning for the selected account date |
| --- | --- |
| Amount due | The invoice balance in the existing accounting ledger. |
| Overdue | Open scheduled amounts with installment dates before As of. |
| Due today | Open scheduled amounts due on As of. |
| Upcoming | Open installments after As of and through the selected horizon. |
| After horizon | Open installments due after Through. |
| Unscheduled | Invoice balance outside an effective payment schedule. |
| Credit balance | The original invoice's credit balance after effective payments and credits. |

**Due schedule** retains each installment's actual due date. An overdue amount remains associated with that date. **Unscheduled balances** includes invoices awaiting a schedule, cancelled schedules and any invoice amount exceeding the remaining retained schedule.

Use **Export CSV** or **Export JSON** for the complete selected report. The CSV carries every remaining scheduled installment and unscheduled invoice amount, together with its customer, invoice, currency and precision. JSON retains the full report and currency groups. Keep those currency groups separate when using the files in a workbook.

Open a plan to review its account activity alongside the schedule. The detail shows original receipt references, received dates and methods, allocation amounts, release dates/reasons and credit notes. Its collection status follows the chosen account date.

### Payments, releases and credits

Record actual receipts and allocate them in **Invoices and payments**. Those operations use the same original account records observed by the plan desk:

- A net payment increase after the schedule's retained balance date covers the earliest remaining installments first.
- Additional credit notes reduce the latest installments first.
- A dated allocation release changes the invoice balance from its release date. If the remaining invoice balance exceeds the retained schedule, the difference appears as unscheduled.
- A fully settled invoice satisfies its open schedule. An effective invoice void closes its scheduled collection rows.
- A backdated ledger change that alters the retained balance-date basis is flagged for balance review. Its original schedule edition stays available.

For example, an invoice for 1,200.00 with 200.00 already allocated has 1,000.00 left to schedule. Four 250.00 installments cover that amount. Another 300.00 allocation satisfies the first installment and 50.00 of the second. A later 100.00 credit reduces the final installment to 150.00. The scheduled balance and invoice amount due are then both 600.00.

## Reschedule, cancel and review history

To revise an outstanding plan, open it, edit the draft using the new balance date and remaining invoice amount, save, review and activate the replacement. The replacement takes effect on its saved balance date, which must be on or after the previous edition's effective date.

A historical collection report uses the latest retained edition effective on or before its As of date. If two editions take effect on the same date, it selects the later edition. A future edition stays future until its saved balance date; an earlier effective edition continues in the meantime.

**Cancel schedule** records the cancellation date and reason. The cancellation takes effect on that date, including the date itself. Earlier history and every retained customer file remain available. From cancellation onward, the outstanding invoice balance returns to unscheduled collections until a new effective plan covers it.

Each invoice can have one effective plan at a time. Revise the existing plan for a continuing arrangement, or start another plan after the earlier plan's cancellation takes effect. The controller rejects overlapping effective plans.

## Recover an interrupted operation

Before sending a mutation, the browser retains its complete request with the original workspace identity, revision, operator and stable request ID. Saving an existing draft also retains its expected plan version; activation retains the exact review digest.

Use the pending request's operation lookup to recover its saved outcome. **Retry same request** sends its original ID and content, so the accounting journal returns an already completed operation instead of creating another. **Download request** preserves the pending request for continued operation.

If another account change advances the workspace revision, **Recover draft** first checks the original request and saved workspace. It can move an unchanged plan draft to the current revision. If the plan itself changed, it presents the current saved draft and retained local draft so the operator can choose which to continue against the current version.

A retained request belongs to the original accounting workspace. Reopen that workspace before reconciling it. When the accounting writer requests reopening after an uncertain disk save, stop and reopen the same directory, recover the original operation, and continue from its saved result.

## Operate through the CLI

The CLI uses the same controller and journal as the browser. Stop another process holding the accounting directory before using these standalone commands. Use actual customer/invoice/plan IDs and dates from the current workspace.

~~~sh
starforge payment-plans state \
  --directory /private/merchant/accounting \
  --as-of 2026-10-31 --through 2026-12-31 --customer CUSTOMER_UUID

starforge payment-plans detail \
  --directory /private/merchant/accounting --id PLAN_UUID \
  --as-of 2026-10-31
~~~

A generator request is a UTF-8 JSON file such as:

~~~json
{
  "invoiceId": "ORIGINAL_INVOICE_UUID",
  "balanceDate": "2026-10-31",
  "firstDueDate": "2026-11-15",
  "count": 4,
  "intervalDays": 30,
  "title": "Customer payment schedule",
  "reference": "Customer account arrangement",
  "customerNote": "Include the invoice number with each payment."
}
~~~

Generate, save and review through these commands:

~~~sh
starforge payment-plans generate \
  --directory /private/merchant/accounting --input /private/generate.json

starforge payment-plans apply \
  --directory /private/merchant/accounting --action save \
  --input /private/save.json

starforge payment-plans preview \
  --directory /private/merchant/accounting --id PLAN_UUID
~~~

The generator returns `draft`, `revision` and `workspaceId`. Put the returned draft under `plan` in a save request, together with the current revision, workspace ID, actor and a stable request ID. To edit an existing plan, include its ID inside `plan` and its current `expectedVersion` at the top level. For example:

~~~json
{
  "revision": 12,
  "workspaceId": "ORIGINAL_WORKSPACE_ID",
  "requestId": "customer-plan-001-save",
  "actor": "Accounts receivable",
  "plan": {
    "invoiceId": "ORIGINAL_INVOICE_UUID",
    "balanceDate": "2026-10-31",
    "title": "Payment schedule",
    "reference": "Account arrangement",
    "customerNote": "Include the invoice number with each payment.",
    "installments": [
      {"id": "first", "dueDate": "2026-11-15", "amount": "500.00", "label": "First installment"},
      {"id": "second", "dueDate": "2026-12-15", "amount": "500.00", "label": "Final installment"}
    ]
  }
}
~~~

This illustrated draft applies to an actual 1,000.00 remaining balance at two-decimal precision. Use the selected invoice's real balance and precision.

For activation, copy `revision`, `workspaceId`, `planVersion` as `expectedVersion`, and `reviewSha256` from the current preview. Add the operator and a new stable request ID. Cancellation uses the current plan version and replaces the review digest with `cancelledDate` and `reason`.

~~~sh
starforge payment-plans apply \
  --directory /private/merchant/accounting --action activate --id PLAN_UUID \
  --input /private/activate.json

starforge payment-plans apply \
  --directory /private/merchant/accounting --action cancel --id PLAN_UUID \
  --input /private/cancel.json

starforge payment-plans operation \
  --directory /private/merchant/accounting --request ORIGINAL_REQUEST_ID
~~~

A saved original operation is returned with its request identity. If there is no saved operation for that ID, `operation` is null; reconcile or retry the retained request with its unchanged content.

Download a retained edition file or export the dated collections report to a new output:

~~~sh
starforge payment-plans file \
  --directory /private/merchant/accounting --id PLAN_UUID --edition EDITION_UUID \
  --name schedule.html --out /private/new-customer-schedule.html

starforge payment-plans export \
  --directory /private/merchant/accounting --customer CUSTOMER_UUID \
  --as-of 2026-10-31 --through 2026-12-31 \
  --out /private/new-customer-collections
~~~

The collection directory contains `collections.json`, `collections.csv` and a manifest. File/export destinations are create-only; choose an existing private parent and a new destination name.

## Use the installed HTTP and native interfaces

The running combined server exposes `/api/receivables/payment-plans`. The typed client composes the existing receivables transport and its error/file handling.

| Installed package export | Interface |
| --- | --- |
| `@tokenjunkielabs/starforge-merchant/merchant/payment-plans` | `PaymentPlanWorkspace` over the open accounting workspace and shared journal. |
| `@tokenjunkielabs/starforge-merchant/merchant/payment-plans/core` | Exact installment generation, dated projection, schedule rendering and collection exports. |
| `@tokenjunkielabs/starforge-merchant/merchant/payment-plans/client` | `PaymentPlansClient`, its factory, API error and TypeScript declarations. |
| `@tokenjunkielabs/starforge-merchant/merchant/payment-plans/server` | Route handler and browser assets for the original running server. |

A Node client can inspect the existing account while its application owns the directory:

~~~js
import {createPaymentPlansClient} from
  '@tokenjunkielabs/starforge-merchant/merchant/payment-plans/client';

const client = createPaymentPlansClient({
  baseUrl: 'http://127.0.0.1:8448/api/receivables/payment-plans'
});
const state = await client.state({
  asOf: '2026-10-31',
  through: '2026-12-31',
  customerId: 'ORIGINAL_CUSTOMER_UUID'
});
const detail = await client.detail('ORIGINAL_PLAN_UUID', {asOf: state.asOf});
const preview = await client.previewPlan('ORIGINAL_PLAN_UUID');
~~~

Mutations are `savePlan(value)`, `activate(planId, value)` and `cancelPlan(planId, value)`, using the same envelopes described above. `getOperation(requestId)` recovers the original journal result. `scheduleFile(planId, editionId, name)` and `collectionsFile(name, filters)` return the binary download response; `collectionsFiles(filters)` returns the report and file metadata.

Native callers can initialize `PaymentPlanWorkspace` with an already open AccountingWorkspace. The parent workspace retains ownership of its lease and lifecycle. The [source operating guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/payment-plans/README.md) describes the native method shapes and route integration.

## Keep the account through backup and upgrade

Plan records are part of `workspace.json.receivables.paymentPlans`. Each retained schedule has a unique directory under the existing accounting `exports/` tree. The existing accounting backup carries the shared request journal, customer and invoice records, plan history and original schedule documents.

Prepare an upgrade as a new runtime from its exact selected archive, retaining the previous runtime and the existing accounting directory. Use the maintained runtime inspection and compare/recovery workflow. Stop the current account owner, review the same workspace binding in the new application, then reopen the customer account, historical schedule and retained files.

The selected product retains the original accounting, customer, quotation and distribution source paths. The receivables contribution registers the payment-plan browser map alongside its own because its combined server imports that route module at startup. The payment-plan contribution supplies the command, typed interfaces and managed application. The maintained composer coalesces their identical browser registration, so the same assets serve both installed products.
