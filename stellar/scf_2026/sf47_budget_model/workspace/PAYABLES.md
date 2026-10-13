# Supplier accounts

Supplier accounts brings one original contributor or supplier's work, invoices, source documents and observed payment allocations into a complete dated account. It uses the same original contributor, work, invoice and cash records as the existing Grant Operations desks. Budget performance, Bulk ledger intake and Account statements open directly from the account.

Open **Delivery operations → Supplier accounts**. Select the supplier and period end, optionally enter a period start, and choose **Open selected account**. A blank supplier selects the first original contributor by name. Changing the supplier or dates clears the displayed report and its downloads until that selection opens successfully. A retained original draft keeps its own supplier identity and reviewed version while you navigate accounts.

## Complete operator workflow

### Open or create the supplier

The account summary shows the original name, kind, contact and supplier notes. **New supplier** and **Edit supplier details** use `contributor.save`. Keep the original documents and any reference notes with the contributor. The all-accounts table compares each supplier's open invoices, credits, net paid, work without an invoice link and disputed invoices for the same dates.

The selected report carries the original case identity/version and a report identity. **Refresh original case** opens the latest original records; a retained draft keeps its original reviewed version for deliberate reconciliation.

### Record and review original work

**Work** shows every original work record for this supplier, including later-dated source records and all retained invoice links. Select a work record to read its original sources, funding basis and work package.

**Record work** and **Edit original work** retain the actual description, dates, hours, funding basis, work package and source references through `work.save`. Editing follows the original Logged state. Submit, accept, reopen and void are the existing state transitions and require a reason.

**Start invoice with this work** carries its original description, package and work identity into a new invoice line. Enter the actual invoiced amount from the source. An invoice link establishes an association; it does not establish a rate or prove complete billing. Keep any agreed rates and availability with their original agreement source.

The **Work without invoice link** view means no nonvoid invoice link with an issue date through the account end. Voided work and future work are excluded from this attention count. Every source work record remains available in the full account JSON and CSV.

### Receive and review supplier invoices

**Invoices → Record supplier invoice** records the original invoice number, issue date, optional due date and all source lines. Each line keeps its own description, USD amount, work package and original work links. The invoice's contributor is the selected original account.

Attach the original document or select existing case sources. **Review original change** shows the complete native command before **Save reviewed change**. The original case version, recording operator and stable request ID accompany the save.

Select an invoice to view its full lines, linked work, source documents, recorded state and dated position. The original state actions remain:

| Original state | Available lifecycle actions |
| --- | --- |
| Received | Review, dispute, void, edit original invoice |
| Reviewed | Dispute, reopen, void |
| Disputed | Reopen, void |
| Void | Reopen |

The original case retains the reason for each transition. Reopening returns an invoice to Received so its original source fields can be edited. Voiding an invoice removes its source liability; previously observed payments remain recorded and can produce a credit position.

### Retain observed payments and refunds

Use **Record observed payment**, **Record observed refund**, or the allocation action on an original invoice.

Enter the actual observation date, original reference, positive native quantity, currency, network and asset identifier. A USD observation uses its original amount as its USD value. For another currency or asset, retain the actual recorded USD valuation and its original valuation documents.

Add the original USD allocation for each invoice. Mixed supplier observations retain every allocation and the entire original quantity. At least one allocation must belong to this supplier in the account desk; the original **Cash / issuer** workspace handles observations with no supplier invoice association.

A payment uses the original Out direction. A received supplier refund uses In with Refund category, reducing net paid on its allocated invoices. The source command validates the original reference, distinct invoice allocations, recorded valuation and allocation capacity.

Open any observation to see its complete original quantity, recorded valuation, all supplier allocations, selected-account amount, other-account allocations and unallocated recorded USD value. Cash observations are immutable. Void an erroneous observation with its reason, then record its correction using its actual original source.

**Account statements** opens the current statement desk while retaining this supplier selection, dates and original draft. Return through **Supplier accounts** after receiving a statement to read the updated original cash records. A retained draft keeps its reviewed case version for deliberate reconciliation.

Account Statements receives source statement rows through its own parser and original native cash commands. The supplier account sees those same cash records when they carry original invoice allocations. Bulk ledger intake supplies the same source records from CSV/TSV/native JSON. An unallocated observation gains no inferred supplier identity.

### Retain original documents

The editor's **Attach original document** retains the exact file through the native `source.add` command. A successful attachment is linked back to that same retained draft. The source attachment uses that draft's reviewed case version. A successful attachment advances the same draft to the resulting source version so its later record save follows the original case sequence.

The Sources view and source buttons download the original retained bytes. Each source keeps its native filename, content identity, byte count, media type and observed date. The ordinary source bounds remain 8 MiB per file and 24 MiB / 200 files per case.

## Dates and account arithmetic

The account reuses `operations_performance._financial` for the complete case, then selects the original invoice positions belonging to the requested supplier. It does not sum case-level paid totals over a supplier subset.

| Displayed amount | Original basis |
| --- | --- |
| Opening invoice liability | Nonvoid invoices issued before the selected start |
| Closing invoice liability | Nonvoid invoices issued through the selected end |
| Opening / closing net paid | Original real, valued payment allocations minus refund allocations through the corresponding date |
| Open invoices | Sum of each invoice's positive liability less net paid |
| Invoice credits | Sum of each invoice's positive excess net paid |
| Net balance | Total invoice liability less net paid |
| Period change | Closing less opening for the named amount |

Opening is zero when no start is supplied. Period end is inclusive. Current record states are those retained at the report's selected case version; business dates select its original activity.

Payments made before an invoice issue date remain payments at their original dates. Future source invoices remain visible with their issue dates. An invoice void retains original cash. Negative net paid after an original refund retains the corresponding source balance.

Invoice aging uses each open invoice's original due date and the selected account end. Buckets are Not due, 1–30, 31–60, 61–90, over 90 days and no due date. Credits remain separately visible.

Voided cash and testnet observations do not enter the account's USD balances. Native quantities keep their original currency, network and asset. A mixed payment's entire quantity is displayed as the whole source observation; it is not silently apportioned between suppliers.

Recorded work hours are recognized at the original work end date, using the same original basis as Budget performance. Future work remains visible. The period activity table starts with the opening net balance, then applies original invoice issues, payments and refunds through the selected period. Activity CSV includes every period activity row.

## Retained draft and original-request recovery

The complete browser desk retains the chosen supplier/dates, unfinished original form, original command body/request ID, the latest result and the most recent rejected request. Its schema is `stellar-forge.sf47-supplier-desk.v1`.

- Inputs remain in the shared case session across navigation and are saved in browser IndexedDB.
- A browser save reads and compares the stored revision inside the same write transaction. A newer draft in another tab is preserved. The current tab can download its full input, then open the saved desk.
- **Download desk input** preserves the complete original input and pending request. **Open desk input** receives that desk for the same original case.
- An interrupted response keeps the original command body and request ID. **Retry original request** submits that exact request and receives the native saved result when it already committed.
- A definitive rejected native request can reopen its input at the refreshed case version. The previous complete request remains retained. The current original record is shown beside the earlier input, with an action to load that current record into the form. Review the reconciled form again before a new save.
- An original document from a rejected attachment remains in the retained request. **Record retained source document** can send those complete original bytes without reading the file again.
- Closing a draft downloads the complete desk first. A completed source attachment remains linked to its original draft even if navigation interrupted the response.

The parent application preserves the account session while another tab or case view is open. The native command always owns final validation, record state and concurrency. Browser drafts do not replace the original case.

## Complete account export and receipt

**Download complete account handover** exports the reviewed supplier, selected dates, exact report identity and original case version. The original snapshot remains open across report generation and whole-case export.

The ZIP contains:

| File | Complete content |
| --- | --- |
| `account.html` | Readable offline account, invoices/lines, work, observed cash/all allocations, activity, sources and basis |
| `account.json` | All report rows, native source records, selections, balances, account comparisons and identities |
| `selection.json` | Original contributor identity and selected dates |
| `invoices.csv` | Every original supplier invoice and its dated position, with complete lines |
| `work.csv` | Every original work record and invoice links |
| `cash.csv` | Every associated observation with the complete original allocations |
| `activity.csv` | All dated period activity and running balance |
| `operations-case.zip` | Complete original plan, case, records, source documents, immutable editions and event history |
| `README.txt`, `MANIFEST.json` | Receiving instructions and exact retained file identities |

CSV nested arrays and objects are complete JSON cells. The report HTML is self-contained and uses neutral industrial styling. Complete exports retain the existing 32 MiB bundle bound.

Choose **Import complete case** and select the complete supplier-account ZIP. The importer verifies all original files and rebuilds the full account from its enclosed source case before assigning a receiving case identity or name. The receiving browser opens **Supplier accounts** with the original supplier and dates.

The import receipt and case origin contain `supplierAccount` with the selected period, contributor ID, original source case/version and report identity. The supplied account remains its original issued edition. The receiving case can produce a new dated edition under its own local identity.

An older workspace can receive the inner original `operations-case.zip` through its original importer.

## HTTP and typed client

Read the complete account:

```text
GET /api/operations/{caseId}/supplier-account
  ?contributorId={originalPersonId}
  &startDate=YYYY-MM-DD
  &endDate=YYYY-MM-DD
  &expectedVersion={originalCaseVersion}
```

Contributor, start and expected version are optional. Read end defaults to the current civil date; send an explicit end when preparing a reusable account.

Export exactly the reviewed selection:

```text
GET /api/operations/{caseId}/supplier-account/export.zip
  ?contributorId={originalPersonId}
  &startDate=YYYY-MM-DD
  &endDate=YYYY-MM-DD
  &expectedVersion={reportCaseVersion}
  &expectedReportSha256={reportSha256}
```

The case version and full report identity must match the current native source. An export holds the same source snapshot for the report and complete case.

Original edits use `POST /api/operations/{caseId}/command` with the native `action`, `data`, `expectedVersion`, `actor`, `note` and `requestId`. Original documents use `source.add` or the existing attachment API.

The Grant client exposes typed selections, detailed invoice/work/cash/allocation/activity records and account import receipts:

```js
const response = await client.read('supplier-account', {
  caseId,
  contributorId,
  startDate,
  endDate,
  expectedVersion
});
const account = response.value;
const handover = await client.download('supplier-account', {
  caseId,
  contributorId: account.selection.contributorId,
  startDate: account.selection.startDate,
  endDate: account.selection.endDate,
  expectedVersion: account.case.version,
  expectedReportSha256: account.reportSha256
});
```

Use the original `client.command`, `client.attach` and `client.importBundle('case', ...)` for native mutations, original files and complete account receipt. Keep the existing request identity after an uncertain response.

## Headless CLI

The original headless workspace owner requires its owned service to be closed. Use the live typed client or HTTP adapter when the original service is running.

From the original workspace source directory, read the account:

```sh
python3 cli.py operations --workspace "$GRANT_WORKSPACE" supplier-account \
  --case "$GRANT_CASE_ID" \
  --contributor "$GRANT_SUPPLIER_ID" \
  --start-date "$GRANT_PERIOD_START" \
  --end-date "$GRANT_PERIOD_END" \
  --expected-version "$GRANT_CASE_VERSION" \
  --output "$GRANT_ACCOUNT_JSON"
```

Export the reviewed source account:

```sh
python3 cli.py operations --workspace "$GRANT_WORKSPACE" supplier-account-export \
  --case "$GRANT_CASE_ID" \
  --contributor "$GRANT_SUPPLIER_ID" \
  --start-date "$GRANT_PERIOD_START" \
  --end-date "$GRANT_PERIOD_END" \
  --expected-version "$GRANT_CASE_VERSION" \
  --expected-report-sha256 "$GRANT_ACCOUNT_SHA256" \
  --output "$GRANT_ACCOUNT_ZIP"
```

Original supplier/work/invoice/cash actions continue through `operations command --action ... --data ...` with the original case version, recording actor, note and request ID. Original document upload uses `operations attach`. Complete account ZIPs use the existing `operations import --file ... --name ... --actor ... --request-id ...`.

CLI output paths are create-only private files. The account source engine is the same module used by the browser and live service.

## Merchant MCP and source installation

`merchant_grant_supplier_account` takes the configured original workspace alias, case ID, explicit end date and optional original contributor/start/version selection. Large complete account responses retain the existing snapshot, rows and exact byte paging.

`merchant_grant_export` supports `kind: "supplier-account"` with the reviewed contributor/dates/version/report identity. The original complete ZIP remains available through its native retained file and host download.

Existing `merchant_grant_case_command`, source attachment and case import tools retain the native state transitions and complete source file flow.

Install the complete source release. Both managed source readers include `operations_payables.py`, `operations_payables.mjs` and `operations_payables.css` alongside the original Operations, Performance and Ledger Intake modules. The HTTP adapter, typed client, CLI, Merchant provider and browser mount use the same account routes and source identities.

The existing native receiving owner can continue its actual case through supplier selection, original invoice/work detail, observed payment/refund allocation, reviewed state change, complete export/import and same supplier/date reopening. Use the current original runtime and actual authorized source case for desktop and phone operation.
