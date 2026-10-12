# Customer collections casework

Use the Collections workbench to turn an overdue invoice into an assigned customer follow-up, retain the actual conversations and invoice questions, and prepare the next customer message. The original merchant receivables account supplies every invoice balance, receipt, allocation, credit and effective date.

The workbench is part of the existing receivables application and the maintained merchant-receivables selection. It shares the original accounting directory, writer, recovery and request journal.

## Open the application

Start the installed application against the merchant's initialized accounting directory:

~~~sh
starforge receivables serve --directory /private/merchant/accounting
~~~

From an exact source checkout, use:

~~~sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/cli.mjs \
  serve --directory /private/merchant/accounting
~~~

Open the printed local address and choose **Collections**. **Customers**, **Invoices**, **Receipts** and **Payment plans** continue in the same running account. In the original Runtime Applications workspace, choose Merchant receivables and open its saved accounting directory.

The selected source's merchant-receivables contribution includes the model, controller, HTTP methods, typed client, command line, guide and browser assets. The existing source builder and Runtime installer receive those files with the rest of the account product. Read the [receivables product operating guide](../../../../products/merchant-receivables/README.md) for the complete installation and accounting startup sequence.

## Assign the outstanding work

Set the account **As of** date, then select a customer or search for an invoice, case title or owner. The workbench shows the collection queue and all overdue invoices in that account view without an open case.

1. Choose **Assign follow-up** beside an overdue invoice, **New case**, or **Open collection case** from an invoice detail.
2. Select the issued invoice and enter the case title, owner, priority, effective date and next follow-up date.
3. Add the internal opening note and save. The saved case retains the original invoice, customer and currency, along with the balance visible on its opening date.
4. Open the case to review its assignment, live dated invoice balance, current promise or dispute, and complete activity history.

Each invoice has one retained case. Reopen that original case for later follow-up. The invoice's customer and currency stay attached to the same original ledger.

The owner and case-status filters help divide the work between operators. Select All owners to include overdue invoices without an open case in the view and JSON export. Amounts remain grouped by currency code and explicit decimal precision. The queue sorts due follow-ups first, then priority and next action date. A customer's new payment, allocation, release, credit or void changes the displayed original invoice balance on its effective date.

## Retain the actual conversation

Open a case and choose **Record contact**. Select the channel, direction, contact name, effective date and original occurred date. Retain the conversation summary and a source reference such as the original email, call record, receipt or internal thread.

**Effective date** is the date the event takes effect in the case history. Events append on or after the latest saved effective date. **Occurred date** can identify an earlier conversation while the case retains when its operational record was added. Events also retain the recording timestamp and operator.

Use **Add note** for internal context. An optional next follow-up date updates the case's next action from that event onward. Assignment changes retain the previous assignment as an earlier event.

The full case history shows future events when viewing an earlier account date and labels them accordingly. The dated queue projects only events effective by the chosen date.

## Manage payment promises

Choose **Record payment promise** and enter the amount, promised payment date, conversation date, note and source reference. The amount uses the invoice's own currency and decimal precision and must fit the outstanding balance on the event's effective date.

The queue displays an open promise as upcoming, due today or overdue. Its due date participates in the next-action date alongside the operator's follow-up date. Open the original Receipts or Invoices view to inspect the actual allocations when checking the promise.

Choose **Record promise outcome** to retain Kept, Broken or Withdrawn with the observed reason and source reference. Resolve the current promise before recording a replacement. Every original promise and outcome remains in the case history. The displayed invoice balance continues to follow the original accounting records.

## Resolve an invoice question

Choose **Record dispute**, select Pricing, Delivery, Duplicate or Other, and enter the amount and source-backed note. The disputed amount must fit the invoice's outstanding balance on the event's effective date.

The case then appears as Disputed. Its owner, next action, original invoice balance and any open payment promise remain visible. Choose **Resolve dispute** to retain the resolution and its reference. If the resolution calls for a financial correction, use the original invoice credit, receipt, refund or allocation workflow and link its record in the resolution note.

An open dispute is retained until its explicit resolution. The original disputed amount remains in history even when later payments or credits reduce the invoice's current amount due.

## Close and reopen

**Close case** records an effective date and reason. The case remains available under Closed or All. Its earlier dated views continue to show the case as open.

**Reopen case** retains the reopening date, reason and next follow-up while preserving the original invoice and all previous activity. An invoice that later becomes settled appears as Account settled in an otherwise open case, so its owner can close the completed follow-up.

Closing a case preserves its recorded promises and disputes. Reopening continues those retained histories; record the appropriate outcome or resolution as the relationship progresses.

## Prepare a customer reminder

Choose **Prepare customer reminder** to review the subject and customer message against the invoice balance at the selected account date. The text includes the original invoice number, due date, outstanding amount, merchant name and configured payment instructions. It also includes the retained promised date or acknowledges an open invoice query when relevant.

The customer text draws from those account fields. Internal notes, owner assignments, contact references and dispute descriptions belong to the separate operator case record.

Choose **Download message** for reminder.txt. Use the prepared text in the existing customer relationship, then retain the actual contact as its own activity. A settled invoice produces an account balance update.

## Export the work

The workbench's **Download CSV** and **Download JSON** export the full selected collections report for the account date, customer, owner, status and search. The JSON also includes overdue invoices without an open case and currency-grouped totals.

Each case offers:

| File | Contents |
| --- | --- |
| case.json | Complete retained case and event records, plus the dated case and original invoice projection. |
| case.csv | All case activities effective by the selected date, including source references and recorded outcomes. |
| case.html | Printable operator case history and, from the case opening date, the prepared customer message. |
| reminder.txt | Prepared customer subject and message, available from the case opening date. |
| manifest.json | Length and SHA-256 of every available generated case file. |

Before the case opening date, the operator JSON, CSV and HTML remain available with that date clearly identified. The HTML explains when customer reminders become available, and the manifest lists the three operator files. A customer reminder requires a date on or after case opening.

The complete JSON retains the full record, including later events, to preserve the original history. Its summary and the CSV/HTML views identify the selected effective date. Export files are produced from the current saved account edition; a later backdated ledger correction can change a regenerated historical balance.

CSV text cells are quoted and protect spreadsheet formula prefixes. Currency precision remains explicit in the full queue CSV. Choose case.html for the readable operator report and reminder.txt for the prepared customer text.

## Command line

Read the queue and an original case:

~~~sh
starforge receivables collections --directory /private/merchant/accounting \
  --as-of 2026-10-31 --status OPEN

starforge receivables collection --directory /private/merchant/accounting \
  --id ORIGINAL_CASE_UUID --as-of 2026-10-31
~~~

The queue and detail return workspaceId and revision. Use those exact values in a save request:

~~~json
{
  "workspaceId": "ORIGINAL_WORKSPACE_ID",
  "revision": 12,
  "requestId": "collections-customer-001-open",
  "actor": "Accounts receivable",
  "invoiceId": "ORIGINAL_INVOICE_UUID",
  "title": "October invoice follow-up",
  "owner": "Accounts receivable",
  "priority": "NORMAL",
  "effectiveDate": "2026-10-31",
  "nextActionDate": "2026-11-03",
  "note": "Opening the customer follow-up after account review."
}
~~~

Save the complete request from a private file:

~~~sh
starforge receivables collection-save --directory /private/merchant/accounting \
  --input /private/collection-case.json
~~~

To update the assignment, include id and expectedVersion from the current case. Activity, close and reopen requests also include expectedVersion, the current workspace revision, original workspace ID, operator and a stable request ID.

A recorded contact uses:

~~~json
{
  "workspaceId": "ORIGINAL_WORKSPACE_ID",
  "revision": 13,
  "requestId": "collections-customer-001-contact",
  "actor": "Accounts receivable",
  "expectedVersion": 1,
  "kind": "CONTACT",
  "effectiveDate": "2026-11-03",
  "occurredDate": "2026-11-03",
  "channel": "EMAIL",
  "direction": "INBOUND",
  "contact": "Customer accounts payable",
  "note": "The customer confirmed the remittance is being prepared.",
  "reference": "ORIGINAL_CONVERSATION_REFERENCE",
  "nextActionDate": "2026-11-06"
}
~~~

Operate and export the same case:

~~~sh
starforge receivables collection-activity --directory /private/merchant/accounting \
  --id ORIGINAL_CASE_UUID --input /private/contact.json

starforge receivables collection-reminder --directory /private/merchant/accounting \
  --id ORIGINAL_CASE_UUID --as-of 2026-11-06

starforge receivables collection-file --directory /private/merchant/accounting \
  --id ORIGINAL_CASE_UUID --name case.html --as-of 2026-11-06 \
  --out /private/new-customer-case.html

starforge receivables collections-export --directory /private/merchant/accounting \
  --name collections.csv --status OPEN --as-of 2026-11-06 \
  --out /private/new-collections.csv
~~~

Use collection-close or collection-reopen with --id and --input for transitions. The request includes effectiveDate and note; reopening also includes nextActionDate. Output paths are create-only.

## HTTP and native interfaces

The existing typed ReceivablesClient provides collectionCases, collectionCase, saveCollectionCase, recordCollectionActivity, closeCollectionCase, reopenCollectionCase, collectionReminder, collectionFile, collectionsFile and collectionOperation.

~~~js
import {createReceivablesClient} from
  '@tokenjunkielabs/starforge-merchant/merchant/receivables/client';

const client = createReceivablesClient({baseUrl:'http://127.0.0.1:8448/api/receivables'});
const report = await client.collectionCases({asOf:'2026-10-31',status:'OPEN'});
const detail = await client.collectionCase('ORIGINAL_CASE_UUID',{asOf:report.asOf});
~~~

The same methods are available on the original ReceivablesWorkspace. Package exports /merchant/receivables/collections and /merchant/receivables/collections-workspace expose the original pure model and controller.

| HTTP route after /api/receivables | Method and operation |
| --- | --- |
| /collections | GET queue; POST save a case or assignment. |
| /collections/:id | GET complete case with dated projection. |
| /collections/:id/activities | POST an immutable case activity. |
| /collections/:id/close or /reopen | POST the dated transition. |
| /collections/:id/reminder | GET prepared subject and customer message. |
| /collections/:id/files/:name | GET the selected case file. |
| /collections/export?name=collections.csv | GET the complete selected report. |
| /collections/operations/:requestId | GET the original saved operation. |

Read routes accept asOf. Queue/export also accept customerId, owner, status and search. Mutations use the original local workspace client headers and retained JSON request.

## Continue an interrupted operation

The browser parks edited collection forms in the current session. Opening a follow-up from a particular invoice restores a new-case draft only when it belongs to that invoice. The generic New case action can resume the parked new-case form and shows its selected invoice. Use **Reset to current values** to discard parked form values and load the current assignment or activity targets.

Before saving, the original pending-operation queue retains the complete request, workspace identity, case version and stable request ID.

**Retry same operation** sends those same arguments to the original journal. A completed operation returns its saved result. For a rejected case version, open the current case history, inspect it and use **Use reviewed current version** when continuing the retained form.

The original operation can also be reconciled through:

~~~sh
starforge receivables collection-operation --directory /private/merchant/accounting \
  --request ORIGINAL_REQUEST_ID
~~~

The response includes the saved operation and its case projection, or operation:null when that ID has not been saved. A request from a different accounting workspace is rejected with COLLECTION_WORKSPACE_CHANGED. An uncertain original accounting save uses the established close/reopen recovery before the retained request continues.

Case records reside in workspace.json.receivables.collectionCases alongside the original requests journal. The existing accounting backup and restore retain the complete case and its customer/invoice lineage.
