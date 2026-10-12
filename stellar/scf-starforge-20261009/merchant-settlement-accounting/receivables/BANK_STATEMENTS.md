# Original bank statements and customer receipts

The bank-statement desk completes customer cash collection in the same accounting workspace as invoices, Stellar receiving, customer refunds and paid-credit disposition. Retain an original bank file, review its actual rows and customer matches, then post the selected credits as customer receipts, links to existing receipts or corrections of recorded receipts.

The browser entry is **Receivables → Bank statements**. The same operations are available through the typed receivables HTTP client, the original accounting MCP owner and its durable operation CLI. All mutations retain the original accounting revision, actor and request ID.

## Source account and file intake

Add the bank account with its reference, display name, invoice currency and decimal precision. When the statement supplies bank and account identities, retain those actual values. An imported account's currency and original bank/account identity remain attached to its existing statement sources.

Choose the original CSV, OFX/QFX or MT940 file and inspect it. Inspection exposes the complete section inventory, actual date range, account, currency, opening and closing balances, transaction counts, source observations and up to 50 original sample rows. If there is more than one section, select the intended original account/statement section and inspect that selection.

The source limit is 1,000,000 original bytes and 5,000 rows. The file is sent as complete base64 bytes, preserving the original character encoding. An import retains those source bytes, their SHA256, normalized rows and the complete original parser report. Customer cash changes only when the subsequent posting review is committed.

### CSV columns

Inspect the original header before selecting the mapped columns. An incomplete layout is valid for inspection; importing requires the complete date and amount mapping. The original reader can identify comma, semicolon and tab layouts, and an explicit delimiter is available for the selected source.

| Setting | Supported original conventions |
| --- | --- |
| Delimiter | Comma, semicolon or tab. |
| Date format | YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY or YYYYMMDD. |
| Decimal mark | Period or comma. |
| Digit grouping | None, comma, period or space. |
| Amount columns | One signed amount, or separate credit and debit columns. |
| Credit sign | Positive or negative in the signed-amount layout. |
| Required columns | Booked date plus amount, or booked date plus credit and debit. |
| Optional columns | Transaction ID, payment reference, counterparty, invoice reference, value date and running balance. |

Column names are exact original header strings. Dates must be valid calendar dates; amounts must fit the selected currency's decimal precision. Reinspect after changing the account, source section or column interpretation. The retained statement review uses that exact selection.

### OFX and QFX

The importer invokes the original maintained OFX statement engine. It preserves the original account sections, DTPOSTED local dates, FITID identities, pending transactions and correction relationships. Those facts remain available in the raw row fields and complete parser report.

Choose the bank account that corresponds to the selected original section. Customer matching and cash posting use the normalized eligible credit rows while retaining the complete original file.

### MT940

MT940 interpretation carries explicit source conventions:

| Setting | Values |
| --- | --- |
| Source profile | TEXT_BODY or FIN_ENVELOPE. |
| Character encoding | ASCII, UTF-8 or ISO-8859-1. |
| Debit/credit profile | CD_ONLY or CD_REVERSALS. |
| Year window | An explicit first year from 1900 through 2000, selecting the corresponding 100-year interval. |
| Receipt date basis | VALUE_DATE. |
| Currency decimal places | The selected account supplies its precision; additional source currencies use an explicit currencyScales map. |

The original complete value date becomes the native bank receipt date. An original entry month/day is retained as source data. The engine preserves its original multipart, checksum, reversal and conflict handling. Inspection without a selected account requires the actual source currency precision map.

OFX and MT940 use the retained Python bridge and standalone original parser modules; Python 3.10 or later is required for those two formats. CSV parsing uses the existing Node CSV reader.

## Match customer payments

Open the retained statement and page its source rows. Status, direction and text filters apply to the complete original inventory before paging. Each row shows its original bank date and amount, current disposition, source identity matches, possible recorded receipts, invoice candidates and customer matching reasons.

Use **Match payment** to assign the complete bank credit. A single credit can contain several customer splits, and the sum must equal the original bank amount exactly.

| Treatment | Result |
| --- | --- |
| Create customer receipt | Record a new receipt for the selected customer and original credit amount. Add actual issued invoice allocations or leave the payment available in the customer account. |
| Link recorded receipt | Retain an already recorded receipt and attach the original bank provenance. A split can cover part of that receipt; later source credits can link the remaining amount within the original receipt's capacity. |
| Correct recorded receipt | Retain the original receipt and its correction relationship, release its original allocations on the reviewed dates, and create the replacement receipt with its explicit accounting date and target customer/invoices. |

The source row and existing receipt retain their actual dates. When a linked receipt's received date differs from the bank date, enter the reason. A correction retains the bank date separately from its accounting date; the review shows both.

Partial corrections preserve the rest of an original receipt. If one recorded receipt is covered by bank credits of 40 and 60, correcting the 40 creates its reviewed replacement and a separate receipt retaining the other 60 for the original customer. The review shows the amount of the original receipt being corrected, all replacement relationships, and the remaining cash with its actual received date and accounting date. Original source matches follow the receipt that now carries that source payment.

In **Cash remaining with [customer]**, leave that amount available or choose the original customer's invoices and explicit allocation dates. Add remaining-cash allocations once per original receipt in the complete posting. The equivalent native input is residualAllocations on the CORRECT split. The original owner recalculates the complete source coverage and remaining amount, releases the old allocations once, and retains every resulting receipt and allocation together.

Choose existing issued invoices from the selected customer's original account. Each allocation carries its own amount and date. **Use invoice balance** fills the lesser of that invoice's displayed amount due and the remaining customer split. For a linked receipt, it uses the original receipt's available funds at the selected balance date. Linking preserves the original accounting date; the complete native review recalculates every affected balance.

### Duplicate and changed bank source

A shared original bank transaction ID identifies the same source payment across retained statements. It cannot create the cash a second time. Existing receipts can be linked to their original source; a changed amount or date requires an explicit authoritative source correction and its reason.

A distinct-payment reason applies to coincident date, amount or reference matches belonging to separate actual payments without a shared original transaction ID. The original matching facts and the operator's reason remain in the retained posting.

When several original receipt payments share the same date, amount or reference, choose the exact **Original payment coverage** in the editor. The selection retains the native coverageKey with its original bank source and amount. Agent callers can send that same key on a LINK or CORRECT split.

Ignored credit rows retain their reason and source identity. Restore an ignored row when it needs customer matching. Closing requires every actual cash credit to have a retained disposition; reopening preserves previous postings and permits explicit restoration or correction.

## Review and post

**Review complete posting** loads one native proposal for every prepared source credit and customer split. It shows:

- The original statement and account.
- Total source credits, created receipts, linked receipts, corrected receipts and new invoice allocations.
- Each original bank date, actual receipt date, accounting date, customer and correction reason.
- Original allocations being released, including any prior scheduled release.
- Every new original invoice allocation and its date.
- Before-and-after customer cash and invoice balances, including every affected later date.

The original engine conserves cash across allocations, refund reservations, paid refunds, receipt corrections and source links. A later scheduled allocation or actual refund remains part of the same review.

Post the complete original proposal and its reviewSha256 at the returned revision. This retains the bank posting, receipts, releases, allocations and generated documents together in the original operation journal. A changed workspace is reviewed again before a new operation.

## Original documents

**Original files** lists the retained statement files with their byte counts. The same retained inventory appears in bankImport and bank_import_detail. The dialog also provides direct downloads for the current status.json and reconciliation.json views through the original file reader.

| File | Contents |
| --- | --- |
| source.csv, source.ofx or source.mt940 | Exact retained original file bytes. |
| import.json | Original source, account, section and interpretation. |
| rows.json and rows.csv | Complete normalized source rows. |
| parser-report.json | Complete report from the original source parser. |
| status.json | Current statement status and dispositions. |
| reconciliation.json | Source-to-receipt reconciliation. |
| posting-UUID.json/html/csv | Complete retained customer posting and its original source relationship. |
| receipt-UUID.json/html/csv | Individual original customer receipt advice. |

Use the exact retained file names from the returned inventory, or status.json and reconciliation.json for the current accounting views. Customer account exports include the individual receipt advice, actual received date, accounting date and original replacement relationships.

MCP file selection is:

~~~json
{
  "kind": "receivables-bank",
  "bankImportId": "the-original-import-uuid",
  "file": "source.csv"
}
~~~

The existing accounting file reader preserves the selection and expected SHA256 while reading every chunk. The native HTTP client uses bankImportFile(bankImportId, name) and returns the original response bytes.

## Complete the Xero customer handover

The existing Xero handover workspace uses the same customer cash ledger. Preparing an invoice or credit package now selects receipts by their effective accounting date, includes original commercial refunds and credit dispositions in the account snapshot, and emits their complete dated reconciliation schedules.

For each selected customer it also retains the original bank receipt and refund advice. File bytes remain unchanged. The package uses stable flat filenames and includes customer-cash-files.json to map each handover file to its customer, original filename, byte count and SHA256. That index and those files take part in the original Xero source fingerprint and review.

Use the receipt, allocation, refund and credit-disposition schedules with the package's original Xero document resolutions. A partial bank correction keeps the old receipt, replacement receipts and remaining customer cash visible at their respective dates. The normal Xero package download carries the customer advice and the original returned Xero document files together.

## HTTP and native methods

| Method | HTTP route relative to /api/receivables |
| --- | --- |
| bankAccounts(query) | GET /bank-accounts |
| saveBankAccount(input) | POST /bank-accounts |
| inspectBankSource(input) | POST /bank-imports/inspect |
| importBankSource(input) | POST /bank-imports |
| bankImports(query) | GET /bank-imports |
| bankImport(id, query) | GET /bank-imports/:id |
| previewBankPosting(id, input) | POST /bank-imports/:id/preview |
| postBankReceipts(id, input) | POST /bank-imports/:id/post |
| ignoreBankRows(id, input) | POST /bank-imports/:id/ignore |
| restoreBankRows(id, input) | POST /bank-imports/:id/restore |
| closeBankImport(id, input) | POST /bank-imports/:id/close |
| bankImportFile(id, name) | GET /bank-imports/:id/files/:name |

The native controller is the existing ReceivablesWorkspace. Bank list and detail pages accept up to 500 rows; the default is 100. Review accepts up to 100 selected source credits and up to 100 allocations in each customer split. The complete review must fit the original request transport.

The [MCP guide](../../../../stellar-forge/mcp-merchant-operator/ACCOUNTING_RECEIVABLES.md) documents the corresponding eleven bank operations and durable client workflow.

## Interrupted operations and operating recovery

Save the complete mutation before sending it: original source bytes or reviewed proposal, actor, revision and stable request ID. The browser retains an unfinished operation in its existing session recovery. The MCP CLI uses the existing private prepare/execute/reconcile operation directory.

After an uncertain reply, recover that same request through request_lookup or resend its exact original arguments. The native journal projects the original bank account/import/posting identities and the original receipts, invoices and allocations. A new request ID would be a new operation.

The existing accounting backup preserves workspace state and the private exports tree together. Source files, parser reports, customer receipt advice and original bank posting files remain part of that same recovery. Use the existing accounting owner lifecycle when moving between MCP and the browser.

## Maintained parser lineage

The unchanged original parsers come from woahwhattheheck/smb-showcase-inventory:

- apps/ofx_statement_intake/intake.py, Git blob c19b38f228283c31926fe9eae86a6364a7976943.
- apps/csv_intake_workbench/mt940/engine.py, Git blob ee5a99c5b747e402bfb1f51175e61799859d3121.

They are retained beside the private stdin/stdout bridge under bank-parsers/. The selected product explicitly includes those Python modules and their source documentation. The native matching and accounting layer builds on those original parser results and the existing invoice/receipt/refund journal.
