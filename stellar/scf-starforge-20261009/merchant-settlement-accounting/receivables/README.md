# Merchant receivables

A complete local invoice and customer-payment workspace over the existing merchant accounting directory. It shares the original accounting lease, saved revision, customer UUIDs, order bindings, history and recovery. The browser uses a plain grayscale operator layout and produces offline printable customer documents.

## Open the workspace

Use Node 22+ and the maintained source distribution.

```sh
starforge receivables serve --directory /private/merchant/accounting --port 8448
```

Open the printed local URL. **Customers and statements** opens the existing customer manager through the same process. Save the merchant name, document prefixes and payment instructions in Settings. Reopening an initialized workspace needs only its original directory. Initial merchant setup additionally accepts the original `--outbox`, `--proof-dir`, and `--terms` options.

In Applications, select **Merchant receivables**, choose the initialized private accounting directory, then use the existing Review, Save, Start and Open workflow. The selected source, original workspace identity and source configuration are checked again inside the accounting lease. Stop the current accounting process before opening this same directory in another standalone process.

## Invoice to payment

1. Select an existing accounting customer and create a draft. Choose the currency code and its explicit precision, invoice/due dates, purchase order and line descriptions. Quantities support six decimal places; monetary inputs are decimal strings. Enter line discounts and tax amounts explicitly.
2. Save, then review the current preview. Issue creates a numbered, frozen JSON document, line CSV, printable HTML and file manifest. The number uses the configured prefix, issue year and monotonically increasing workspace sequence. Changing customer or merchant details requires a new preview before issue.
3. Record a payment with the customer, currency, received date, method and unique payment reference. Partial and excess payments remain visible as available funds. Select an invoice and allocate a specific amount on a specific date.
4. Correct an allocation with a dated release and reason. The original allocation remains in history; its payment becomes available from the release date. Invoice and payment voids require all applicable allocations to have been released.
5. Issue a line-item credit note when reducing an issued invoice. Each credit selects original invoice lines and explicit net/tax amounts. Cumulative credits cannot exceed their original line amounts. A credit issued after payment creates a customer credit balance.
6. Select an as-of date for balances and aging. Download the complete customer account packet, including its original invoice and credit-note files, as one TAR archive. JSON, CSV and printable account views are also available. The export includes current, 1–30, 31–60, 61–90 and 91+ day amounts separately for each currency and precision.

Editable drafts stay private to the operator. Customer exports include issued documents, payment references and dated allocations; internal notes, source records and operator histories stay in the workspace.

## Original SF74 quotation import

Download the existing quotation's **QUOTE_JSON**, or use its original retained **QUOTE** material. To attach the selected customer response, also download the original **RESPONSE** material for that same quotation edition.

Choose the original files, the existing accounting customer and one billing scope:

| Scope | Billing selection |
| --- | --- |
| `IMPLEMENTATION` | The original one-time implementation lines, once. |
| `RECURRING` | Original service and planned route-usage lines multiplied by an explicit positive count of monthly periods. Enter a specific period label, such as October 2026. |

The importer validates the original quote seal, saved draft, calculation review, complete line totals and response-to-quote binding. It retains both raw source files and the full calculation mapping. A chosen original ACCEPTED response appears in the operator review. Planned route usage keeps that description.

The original extended USD amounts are multiplied by the selected period count, then rounded half up **once per selected line** to the chosen invoice precision. The imported draft uses quantity one for each resulting charge. The review shows the original quantities, rates, selected extended amounts and rounding difference.

A retained quote import creates an editable invoice draft. Review its dates, customer mapping, tax, purchase order and charges before issue. Changes to the imported draft are recorded. The same quote scope and recurring period cannot be imported again while its invoice remains active. The operator can download original quote, response, source and review JSON from that invoice's source record.

## Import a Stellar settlement

Choose a completed original accounting run, then select a ledger event already assigned to the accounting customer through its original order binding. The selector pages through the actual retained report and shows its adjustment summary.

An import requires the original public-network transfer match and official public RPC verification. It retains the original event, report digest, transaction fingerprint, asset/atomic amount, order binding, and adjustment snapshot. An already imported transaction is recognized across later accounting runs.

Enter the amount in the invoice's commercial currency and a valuation basis explicitly. The exact Stellar atomic amount stays with its original asset identity. Subsequent allocation follows the same customer, currency and date rules as a manual receipt.

## Retained data and recovery

All new state lives at `workspace.json.receivables`. Original customer identities stay at `workspace.json.customerStatements`. Issued documents and private quotation captures use unique directories under the existing `exports/` tree, so the original accounting backup captures the whole workspace.

Every receivables mutation carries the current workspace revision, a named operator and a stable request ID. Retrying the same saved request returns its existing operation; using that ID for different content is rejected. A stale draft retains its editor contents so the operator can review the current state. Issued files are checked against their recorded lengths and hashes on download.

The original accounting writer manages atomic saves and uncertain commit outcomes. If that writer requests reopening, close and reopen the same directory, then retry the unchanged request ID. The original journal determines whether the operation already completed.

Historical allocations are checked across every affected date interval, including previously entered future allocations. A backdated allocation cannot spend funds already allocated in a later interval. Amounts are kept as exact integers at the explicitly chosen currency precision.

## CLI and programmatic operation

```sh
starforge receivables state --directory /private/merchant/accounting --as-of 2026-10-31
starforge receivables preview --directory /private/merchant/accounting --id INVOICE_UUID
starforge receivables apply --directory /private/merchant/accounting --action draft --input /private/draft-request.json
starforge receivables export --directory /private/merchant/accounting --customer CUSTOMER_UUID --as-of 2026-10-31 --out /private/new-customer-export
starforge registrations --source merchant-receivables
```

Run `starforge receivables help` for every command and action. File and customer-export outputs are create-only.

Source interfaces:

- `ReceivablesWorkspace` in `store.mjs`: the complete invoice, credit, payment, quote-import, allocation, account-export and retained-file controller.
- `core.mjs`: exact decimal arithmetic, document compilation, balance/aging projections and printable output.
- `quote-import.mjs`: pure original SF74 quote/response-to-draft compiler with source and review.
- `client.mjs` and `client.d.ts`: the HTTP client and typed request/result contract.
- `server.mjs`: standalone listener and embeddable handler over an already-open accounting workspace.

For a native development walkthrough, run the isolated `EXERCISE.mjs` from this directory. It uses the real accounting controller and private files to exercise invoice issue, credits, payments, dated reversals, export and reopening. No hosted CI is required.

## Accounting scope

Needs expert review: apply the merchant's actual invoicing, tax and retention requirements when operating the application. The configurable issuer fields and explicit tax amounts support recording those choices. Currency precision, invoice dates, payment valuation and customer assignment are operator inputs. Credit notes and allocation corrections retain their own dates and reasons.

Original source owners remain the accounting workspace, customer statements, SF74 quotation engine, SF98 delivery journal, SF86 verifier, Applications lifecycle and maintained distribution builder. This component adds the receivables product to those existing interfaces.
