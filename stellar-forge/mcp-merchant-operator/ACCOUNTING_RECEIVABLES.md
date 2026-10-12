# Receivables and invoice collection through the merchant MCP

This interface operates the merchant's existing invoices, customer receipts, allocations and Stellar payment requests through the same accounting owner used by the other merchant tools. A quotation can become an editable draft, a reviewed draft can become an issued invoice, and an issued balance can become a printable wallet request. A returned transaction is matched to the original request before the native accounting engine records its receipt and allocation.

The interfaces are:

- Installed command: `starforge merchant-accounting-receivables`.
- Typed JavaScript client: `@tokenjunkielabs/starforge-merchant/merchant/accounting-receivables`.
- Durable operation and download helpers: `@tokenjunkielabs/starforge-merchant/merchant/accounting-receivables/operations`.
- MCP tools: the 46 names beginning with `merchant_accounting_receivables_`, plus the existing accounting owner, customer and file tools.

The selected distribution's package name is `@tokenjunkielabs/starforge-merchant`. Check the installed package manifest if consuming a differently named distribution; the export suffixes above remain the integration points. From a source checkout, the equivalent command is:

```sh
node stellar-forge/mcp-merchant-operator/accounting-receivables-cli.mjs --help
```

See [the payment request guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/PAYMENT_REQUESTS.md) for the underlying browser, HTTP and native workspace workflow. See [ACCOUNTING.md](./ACCOUNTING.md) for the host's existing accounting configuration and lifecycle.

## Connect to the existing accounting owner

Use the host's configured endpoint, workspace alias and access-token environment variable. The CLI stores the variable's name in prepared operations; authentication reads its value from the invoking environment.

The following Bash setup keeps the connection arguments explicit while shortening the remaining examples:

```bash
umask 077
RECEIVABLES_WORK="$PWD/receivables-work"
mkdir -p "$RECEIVABLES_WORK"

rcv=(starforge merchant-accounting-receivables)
rcv_connection=(
  --url "$MERCHANT_MCP_URL"
  --workspace "$MERCHANT_WORKSPACE"
  --token-env MCP_ACCESS_TOKEN
)

"${rcv[@]}" sources "${rcv_connection[@]}"
"${rcv[@]}" open "${rcv_connection[@]}"
"${rcv[@]}" status "${rcv_connection[@]}" > "$RECEIVABLES_WORK/status.json"
```

Use private regular JSON files for `--request`, `--preview` and `--selection`. The CLI verifies their ownership and permissions. The operation and output directories are private directories owned by the invoking account. Download and preview destinations are created once; choose a new filename for a subsequent observation.

Ordinary commands open the existing owner as needed and release this caller's retained file reads when finished. The `close` command explicitly closes the process-owned accounting session and drains its accepted work. Choose it when finishing that owner's operation. A client that only finishes its own work uses `disconnect()`; a failed read drain can be retried with the same client.

The host exposes configured quotation files as `receivablesInputs` source aliases. `sources` reports those aliases with the other accounting inputs. The host reads the selected source through its existing source reader. Quote and response files use the native two-million-byte combined input limit and valid UTF-8.

## Customer, issuer and draft intake

Use the existing customer inventory and profile tools before creating an invoice:

| Existing MCP tool | Purpose |
| --- | --- |
| `merchant_accounting_customer_status` with `view:"customers"` | Page saved customers and choose their original IDs. |
| `merchant_accounting_customer_save` | Create a profile or edit its current `id` and `expectedVersion`. |
| `merchant_accounting_customer_assign` | Bind original paid orders to a customer for settlement-ledger import. |
| `merchant_accounting_receivables_settings` | Save invoice issuer details, document prefixes and payment instructions. |

Customer profile edits retain their existing version-based behavior. Receivables mutations use `actor`, `requestId` and `revision`, described in the recovery section below.

A `draft-save` request contains the customer ID, invoice currency, issue and due dates, and complete line inputs. Currency is `{code,scale}`; code is three uppercase letters and scale is from zero to six. Decimal quantities and monetary values are strings. Each line contains `description`, positive `quantity` and `unitAmount`, with optional `id`, `discountAmount` and `taxAmount`. A draft has one to 250 lines.

Optional draft fields are `purchaseOrder`, `note`, `sourceReference` and `replacesId`. To edit a draft, include its `invoiceId` and current `expectedVersion`; send the complete desired draft. The adapter maps `invoiceId` to the original native draft ID. The native engine calculates totals and enforces precision and line constraints.

Issuer settings include `name`, `address`, `email`, `taxReference`, `paymentInstructions`, `invoicePrefix` and `creditPrefix`. Set the current issuer before previewing the invoice that will carry it.

### Import an original service quotation

A `quote-import` request takes:

- `customerId`, `issueDate`, `dueDate` and `scope`.
- Exactly one of `quoteSource` or `quoteContent`.
- At most one of `responseSource` or `responseContent`.
- Optional `currencyScale`, defaulting to two.
- For `scope:"RECURRING"`, the selected positive `periodCount` and specific `periodLabel`.
- The original mutation identity: `actor`, `requestId` and current `revision`.

Use `scope:"IMPLEMENTATION"` for the quotation's implementation scope. A source alias selects a host-configured original file; inline content contains the original file's complete UTF-8 text. The native importer retains the original quotation, optional response, selected scope and review. Its quotation/customer/scope/period binding prevents accidental duplicate active imports.

Prepare and execute an import using an already assembled private request:

```bash
"${rcv[@]}" prepare "${rcv_connection[@]}" \
  --dir "$RECEIVABLES_WORK/quote-import-01" \
  --action quote-import \
  --request "$RECEIVABLES_WORK/quote-import.arguments.json"

"${rcv[@]}" execute --dir "$RECEIVABLES_WORK/quote-import-01"
```

The result includes the original invoice ID and new revision. Read `invoice-detail` to inspect its draft and quotation binding. The retained quotation files remain accessible after later draft edits; the detail result exposes whether the draft has changed from the imported quotation.

The same preparation pattern works for `settings` and `draft-save` by changing `--action` and providing their exact native arguments.

## Review and issue the invoice

Create a private selection file containing `{"invoiceId":"<the original invoice UUID>"}`. In that description, replace the placeholder with the ID returned by intake.

```bash
"${rcv[@]}" invoice-preview "${rcv_connection[@]}" \
  --request "$RECEIVABLES_WORK/invoice.selection.json" \
  --out "$RECEIVABLES_WORK/invoice.preview.json"
```

The saved preview contains the complete native document, `invoiceId`, `previewSha256`, `expectedVersion` and workspace `revision`. The client obtains the complete document from the original `preview.json` file through the retained file reader. Its file SHA is the same SHA used to issue the invoice.

Review the customer, issuer, dates, currency, lines, discounts, tax, totals and payment instructions in that document. The HTML and CSV previews are also available through the file selectors returned by the MCP preview summary.

Prepare issuance from the complete saved preview:

```bash
"${rcv[@]}" prepare "${rcv_connection[@]}" \
  --dir "$RECEIVABLES_WORK/invoice-issue-01" \
  --action invoice-issue \
  --preview "$RECEIVABLES_WORK/invoice.preview.json" \
  --actor "$MERCHANT_OPERATOR" \
  --request-id invoice-issue-01

"${rcv[@]}" execute --dir "$RECEIVABLES_WORK/invoice-issue-01"
```

The preparer derives the original invoice ID, expected draft version, preview SHA and revision from the saved preview. It retains the complete request in its operation directory. If the draft or relevant state has changed, obtain and review the current preview for a new issuance attempt with a new request identity.

Issuance freezes the native document and original invoice files. Subsequent corrections use credits, dated voids, allocation releases or a replacement draft linked through `replacesId`.

## Turn the issued balance into a wallet request

A `payment-preview` selection identifies the issued invoice and its collection terms:

| Field | Meaning |
| --- | --- |
| `invoiceId` | The original issued invoice. |
| `invoiceAmount` | The invoice-currency value being collected; defaults to its current amount due. |
| `network` | `stellar:pubnet` or `stellar:testnet`. |
| `destination` | The intended classic Stellar destination account. |
| `asset` | `{kind:"native"}`, or `{kind:"credit",code,issuer}`. |
| `stellarAmount` | The exact amount the destination must receive, as a positive decimal string with up to seven places. |
| `valuationNote` | The agreed basis relating the invoice value to the received asset amount; required except for native XLM at the same face amount. |
| `memo` | Optional exact classic memo; omission generates a unique request-bound hash memo. |
| `msg` | Optional wallet message of at most 300 characters. |
| `expiresAt` | Optional future UTC timestamp, or `null`. |

For example, collecting a USD invoice with a selected issued USD asset still records the agreed invoice value, the exact issued asset and its issuer, and the valuation basis. The native engine retains those commercial terms independently of the Stellar asset amount. Classic issued assets use their code and issuer.

```bash
"${rcv[@]}" payment-preview "${rcv_connection[@]}" \
  --request "$RECEIVABLES_WORK/payment.terms.json" \
  --out "$RECEIVABLES_WORK/payment.preview.json"

"${rcv[@]}" prepare "${rcv_connection[@]}" \
  --dir "$RECEIVABLES_WORK/payment-create-01" \
  --action payment-create \
  --preview "$RECEIVABLES_WORK/payment.preview.json" \
  --actor "$MERCHANT_OPERATOR" \
  --request-id payment-create-01

"${rcv[@]}" execute --dir "$RECEIVABLES_WORK/payment-create-01"
```

The complete preview binds the invoice snapshot and balance to the selected asset, network, destination, amount, memo, expiry, valuation and URI. Review those fields before creating the request. The creation result includes the original payment request ID. Use it in later detail, return, receiving and file operations.

The wallet handoff implements the original [Stellar SEP-0007 URI scheme](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md). It is an unsigned `web+stellar:pay` request. The payer opens it in their selected compatible wallet and confirms the actual payment there. The request memo is an on-chain field; the optional message is for the wallet display.

Download the customer-facing HTML or exact URI with a private selection such as:

```json
{
  "kind": "receivables-payment",
  "paymentRequestId": "<the original payment request UUID>",
  "file": "payment-request.html"
}
```

```bash
"${rcv[@]}" download "${rcv_connection[@]}" \
  --selection "$RECEIVABLES_WORK/payment-file.selection.json" \
  --out "$RECEIVABLES_WORK/payment-request.html"
```

Replace the ID placeholder with the returned UUID. Choose `payment-request.uri` to obtain the exact URI text, or `payment-request.json` for the immutable document. The original HTML is printable and contains the customer instructions and request identity. Customer distribution is a separate operator action using the completed file.

## Record the wallet return and receive the original payment

The return operation needs the issued `paymentRequestId`, the wallet's 64-character lowercase transaction hash, and the usual mutation identity. `payer` is optional: supplying it constrains the expected operation sender; omission lets the native verifier derive that sender from the uniquely matching payment operation. This supports transactions whose fee payer differs from the paying operation account.

Prepare `payment-return` with the original hash and retain its result:

```bash
"${rcv[@]}" prepare "${rcv_connection[@]}" \
  --dir "$RECEIVABLES_WORK/payment-return-01" \
  --action payment-return \
  --request "$RECEIVABLES_WORK/payment-return.arguments.json"

"${rcv[@]}" execute --dir "$RECEIVABLES_WORK/payment-return-01"
```

The result contains the original `paymentReturn.id`. The receive request uses that ID as `returnId`, together with `paymentRequestId`, `actor`, a stable new `requestId` and the current revision.

`payment-receive` accepts `allocate`, `allocationAmount`, `allocatedDate` and an optional note. The default receiving path applies the native allocation behavior; set `allocate:false` when the receipt should remain unapplied. A selected allocation amount is an exact invoice-currency string. Native accounting checks the customer's currency and dated available balances.

```bash
"${rcv[@]}" prepare "${rcv_connection[@]}" \
  --dir "$RECEIVABLES_WORK/payment-receive-01" \
  --action payment-receive \
  --request "$RECEIVABLES_WORK/payment-receive.arguments.json"

"${rcv[@]}" execute --dir "$RECEIVABLES_WORK/payment-receive-01"
```

Receiving reads the selected network's actual transaction response and decodes the native transaction envelope, result and memo. It checks the original network, transaction reference, destination, asset, received amount, memo, operation sender when constrained, and transaction timing against the request. A matching public-network transfer creates the original customer receipt and, when selected, its original invoice allocation. Reference deduplication keeps one real transfer from becoming duplicate receipts through another request or the settlement importer.

A test-network transfer records `TESTNET_VERIFIED` and its original proof. It leaves the commercial receipt ledger unchanged. A transaction that has not appeared, a confirmed failed transaction and an unavailable verification each retain their own observation. `VERIFICATION_UNAVAILABLE` preserves the submitted reference for a later receive attempt. A confirmed ledger `FAILED` result permits the original wallet request to be used again. Timing results retain `TRANSFER_PRECEDES_REQUEST`, `TRANSFER_AFTER_EXPIRY` or `TRANSFER_AFTER_CANCELLATION` as applicable.

Use `payment-detail` to inspect the original request and its current receipt/allocation position. The request status is derived from its saved observations and accounting records. An unapplied receipt, a partial allocation, a released allocation and a reversed receipt therefore remain visible as distinct accounting outcomes.

## Correct, reconcile and export the customer account

The same interface supports the rest of the collection lifecycle:

- `payment-cancel` withdraws a request with its reason and preserves the original handoff and observations.
- `allocate` applies a saved customer receipt to an issued invoice at a chosen date.
- `release` releases a saved allocation with its correction date and reason.
- `receipt-void` reverses a receipt after its active allocations are resolved.
- `credit` issues a native credit note against selected original invoice lines.
- `invoice-void` retains the issued document with its void date and reason.
- A new `draft-save` can link a replacement through `replacesId`.
- `settlement-ledger` pages an existing completed reconciliation's native transfer rows; `settlement-import` imports one eligible original public settlement using its exact run/event identity and the customer's invoice-currency valuation.

The ledger import uses the existing order-to-customer assignment. Each imported value carries its selected invoice currency, exact amount, received date and valuation basis. The native engine checks original transfer eligibility and uniqueness before creating its receipt.

Read the customer's dated account and deliver the complete native packet:

```bash
"${rcv[@]}" customer-export "${rcv_connection[@]}" \
  --request "$RECEIVABLES_WORK/customer.selection.json" \
  --out "$RECEIVABLES_WORK/customer-account.tar"
```

The selection contains `customerId` and optional `asOf`. With `--out`, the command downloads the complete native `account.tar` and returns its observed file identity. Without `--out`, it returns the customer account inventory, currencies, counts, original file identities and packet selector.

## Refund customer funds and move paid credit

Use `customer_funds` for the selected customer and accounting date. Its original response includes receipt availability, paid-credit allocations that can fund a refund, outstanding target invoices, and verified original adjustments or unresolved refund returns. Use those retained identities in the preview.

`refund_preview` accepts the original receipt, commercial amount, effective date, reason, selected funding allocations and actual payout route. The native owner returns a complete `proposal`, `reviewSha256`, `revision` and receipt/invoice `balanceEffects`. `refund_commit` preserves that proposal verbatim with the stable mutation context. It records a completed operator refund or adopted original payout, or reserves the amount for a public Stellar wallet request.

For a wallet request, retain the returned transaction with `refund_return` and use `refund_receive`. The original verifier checks the reviewed merchant source account, customer destination, network, asset, exact amount, memo and successful ledger result. A cancelled request can still receive an actual late transfer. A distinct extra or unposted verified transfer appears in `availableRefundReturns`; its original refund and return identifiers select a newly reviewed accounting entry for that actual payout.

A correction to an already recorded bank refund first reverses that original refund, then links the reviewed replacement with `replacesRefundId`. Keep the actual bank `refundDate`; use the original reversal date as the replacement’s `effectiveDate`. The native `accountingDate` records the cash correction without creating an interval in which the paid amount becomes spendable again. Customer advice and accounting schedules retain both dates and the original correction link.

To move paid credit, call `credit_disposition_preview` with the original receipt, effective date, reason, exact credited allocations to release and target invoice amounts. Apply its complete proposal and review SHA with `credit_disposition_apply`. The native operation retains the released allocation and exact residual replacement, applies the chosen amounts and preserves the unused customer balance. It checks every affected later accounting date.

The typed client's refund and disposition preview helpers retain the complete native response. The existing durable preparation, execution and journal reconciliation use those same complete proposals, request IDs and revisions. Retain the original review after an interrupted response and reconcile its request before changing any source input.

`refund_detail` returns the original reviewed proposal, current or dated summary, returns, observations, history, balance effects and exact file inventory. `refund_list` preserves its native `refunds` rows and paging fields. Read retained files with `kind:"receivables-refund"`, `refundId` and the original filename.

The [complete refund and credit guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/REFUNDS_AND_CREDITS.md) provides the three payout routes, verified-return adoption, dated cancellation and operator correction, customer exports, and full CLI and typed-client examples.

## Preserve the original operation across an uncertain response

Every receivables mutation carries:

| Field | Required behavior |
| --- | --- |
| `actor` | Keep the responsible operator with the original request. |
| `requestId` | Use one stable identifier for this exact intended mutation. |
| `revision` | Use the observed workspace revision for its first application. |
| Operation inputs | Preserve the original IDs, strings, dates, preview and selected source content. |

Request IDs match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$`. The native journal checks an existing request before checking revision. Identical replay recovers that operation; reusing its ID for changed intent is rejected. Revision is excluded from the native intent digest, but the prepared operation retains its original revision and exact arguments.

`prepare` creates a new private directory containing the full request, original connection selection and operation state. `execute` looks up that original request first and makes at most one mutation call when absent. A lost mutation reply gets an original-source lookup. `reconcile` only reads the original journal:

```bash
"${rcv[@]}" reconcile --dir "$RECEIVABLES_WORK/payment-receive-01"
```

A found result contains the retained operation record and current native invoice, request, return, receipt or allocation result identities. The lookup record is the original journal record. The direct native mutation response separately identifies whether its call replayed an existing operation.

If an uncertain commit reports `reopenRequired`, retain the request directory and original `commitUncertainty` details. Reopen the same accounting owner through its documented recovery lifecycle, then reconcile the same request. An explicit later `execute` retains the original identity and inputs. A business change after a rejected stale preview becomes a newly reviewed operation with a new request identity.

Configured quote imports reconcile against the original quotation and response bytes archived with the imported invoice. Changing the source file on the host cannot rewrite that retained operation's imported content.

CLI exit statuses are: zero for completed reads/preparation/observed operations, three when the original request is not found, and two for an error. The operation directory retains the request and latest observation for follow-up.

## Typed JavaScript integration

Connect using the actual installed package export:

```js
import {
  connectAccountingReceivablesClient,
  accountingInvoiceIssueArguments,
  accountingPaymentRequestArguments,
} from '@tokenjunkielabs/starforge-merchant/merchant/accounting-receivables';
import {
  prepareAccountingReceivablesOperation,
  runAccountingReceivablesOperation,
  downloadAccountingReceivablesFile,
} from '@tokenjunkielabs/starforge-merchant/merchant/accounting-receivables/operations';
```

`connectAccountingReceivablesClient({url,workspace,tokenEnv,environment,signal,maximumResponseBytes})` uses the configured MCP endpoint. `tokenEnv` defaults to `MCP_ACCESS_TOKEN`. Existing structured MCP consumers can instead call `createAccountingReceivablesClient({workspace,call})` with their original authenticated call implementation.

Each named method receives one native argument object without `workspace`; the configured client adds that selection. An optional second argument supplies `{requestSignal,timeoutMs}`.

The preview helpers keep the original review relationship:

```js
const client = await connectAccountingReceivablesClient({
  url: process.env.MERCHANT_MCP_URL,
  workspace: process.env.MERCHANT_WORKSPACE,
});

try {
  await client.open();

  // Use the existing draft UUID selected by the operator.
  const preview = await client.previewInvoice({invoiceId});
  const issueArguments = accountingInvoiceIssueArguments(preview, {
    actor,
    requestId: originalIssueRequestId,
  });

  // Retain issueArguments before submitting it.
  const issued = await client.issueInvoice(issueArguments);

  // paymentTerms contains the actual destination, asset and agreed amounts.
  const paymentPreview = await client.previewPaymentRequest({
    invoiceId: issued.invoice.id,
    ...paymentTerms,
  });
  const createArguments = accountingPaymentRequestArguments(paymentPreview, {
    actor,
    requestId: originalPaymentRequestId,
  });

  // Retain createArguments before submitting it.
  const created = await client.createPaymentRequest(createArguments);
  const handoff = await client.fileBytes({
    kind: 'receivables-payment',
    paymentRequestId: created.paymentRequest.id,
    file: 'payment-request.html',
  });
  // handoff.bytes is the complete original file; handoff.file is its identity.
} finally {
  await client.disconnect();
}
```

The example's IDs, actor and payment terms come from the calling application's existing operation. Persist the arguments and reviewed previews before their mutation calls. The operation helpers perform that persistence directly:

```js
await prepareAccountingReceivablesOperation({
  directory: operationDirectory,
  url: process.env.MERCHANT_MCP_URL,
  workspace: process.env.MERCHANT_WORKSPACE,
  kind: 'payment_create',
  preview: reviewedPaymentPreview,
  actor,
  requestId: originalPaymentRequestId,
});

const result = await runAccountingReceivablesOperation({
  directory: operationDirectory,
  execute: true,
});
```

Use `execute:false` to reconcile a prepared operation. For application-managed persistence, `client.reconcileOperation(kind,originalArguments)` checks the retained operation against the original native action and intent. `client.lookupOperation({requestId})` exposes the journal lookup itself.

`client.listAll(kind,args)` consumes a complete paged view at one revision and accounting date. `fileBytes` returns a complete original file with a configurable maximum up to 128,000,000 bytes. `fileChunks` streams the original reader's verified chunks. `downloadAccountingReceivablesFile` writes those chunks to a private destination created once. Keep the selected file identity and expected SHA when continuing a reviewed download.

## Operation map

All tool names in this table have the prefix `merchant_accounting_receivables_`. CLI names replace underscores with hyphens.

| Tool suffix | Typed client method | Main selection/result |
| --- | --- | --- |
| `status` | `status` | Summary or paged inventory, aging and complete operation journal. |
| `settings` | `saveSettings` | Original issuer and invoice/credit settings. |
| `draft_save` | `saveDraft` | Complete draft; optional invoice ID and expected version for editing. |
| `quote_import` | `importQuote` | Original quote/response source and selected scope into a draft. |
| `invoice_preview` | `invoicePreviewSummary`, `previewInvoice` | Native document header/lines/files, or complete reviewed document. |
| `invoice_issue` | `issueInvoice` | Invoice ID, expected version and exact preview SHA. |
| `invoice_detail` | `invoice` | Original document, quotation, financial rows and history. |
| `invoice_void` | `voidInvoice` | Invoice ID, void date and reason. |
| `credit` | `issueCredit` | Invoice ID, selected line net/tax amounts and credit reason/date. |
| `receipt_record` | `recordReceipt` | Customer, currency, amount, date, method and reference. |
| `receipt_void` | `voidReceipt` | Receipt ID, void date and reason. |
| `settlement_ledger` | `settlementLedger` | Completed run's original eligible/imported ledger rows. |
| `settlement_import` | `importSettlement` | Exact run/event, customer and selected invoice-currency valuation. |
| `allocate` | `allocate` | Receipt ID, invoice ID, amount and allocation date. |
| `release` | `releaseAllocation` | Allocation ID, release date and reason. |
| `customer_export` | `customerExport` | Dated account and original complete-file inventory. |
| `payment_preview` | `previewPaymentRequest` | Exact issued invoice balance and reviewed wallet proposal. |
| `payment_create` | `createPaymentRequest` | Original proposal and review SHA. |
| `payment_list` | `paymentRequests` | Original requests by invoice/customer and accounting date. |
| `payment_detail` | `paymentRequest` | Proposal, returns, observations, receipts, allocations and history. |
| `payment_cancel` | `cancelPaymentRequest` | Payment request ID and withdrawal reason. |
| `payment_return` | `reportPaymentReturn` | Payment request ID, transaction hash and optional payer. |
| `payment_receive` | `receivePaymentRequest` | Original return ID, native verification and receipt/allocation. |
| `customer_funds` | `customerFunds` | Dated customer cash, refundable paid credits, target invoices and original verified payouts. |
| `refund_preview` | `previewRefund` | Complete original refund proposal, review SHA and before/after account balances. |
| `refund_commit` | `commitRefund` | Exact reviewed proposal and stable original mutation context. |
| `refund_list` | `refunds` | Paged original refunds by customer/receipt, status and accounting date. |
| `refund_detail` | `refund` | Original proposal, dated summary, returns, history and file inventory. |
| `refund_cancel` | `cancelRefund` | Pending wallet refund, cancellation date and retained reason. |
| `refund_reverse` | `reverseRefund` | Dated correction of an operator-recorded refund. |
| `refund_return` | `reportRefundReturn` | Original refund and wallet transaction hash. |
| `refund_receive` | `receiveRefund` | Retained return, native transaction proof and actual customer cash entry. |
| `credit_disposition_preview` | `previewCreditDisposition` | Original credited payment releases, residual replacements and target invoice amounts. |
| `credit_disposition_apply` | `applyCreditDisposition` | Complete reviewed allocation plan and original journal recovery. |
| `bank_accounts` | `bankAccounts` | Paged original bank account identities, currencies and saved source layouts. |
| `bank_account_save` | `saveBankAccount` | Original account identity and currency; id and expectedVersion for editing. |
| `bank_source_inspect` | `inspectBankSource` | Complete original file bytes, actual source sections, columns, parser findings and row sample. |
| `bank_source_import` | `importBankSource` | Exact account, file, selected section and original CSV/MT940 interpretation. |
| `bank_import_list` | `bankImports` | Paged statement summaries, source identities and original disposition counts. |
| `bank_import_detail` | `bankImport` | Original metadata and files, or paged rows, postings and history. |
| `bank_posting_preview` | `previewBankPosting` | Complete customer CREATE/LINK/CORRECT splits and exact dated cash/invoice effects. |
| `bank_receipts_post` | `postBankReceipts` | Complete reviewed proposal, review SHA and original journal context. |
| `bank_rows_ignore` | `ignoreBankRows` | Original row identities and retained exclusion reason. |
| `bank_rows_restore` | `restoreBankRows` | Original ignored rows and reason; an empty selection reopens a closed statement. |
| `bank_import_close` | `closeBankImport` | Close after every original cash credit has a retained disposition. |
| `request_lookup` | `lookupOperation` | Stable request ID and original mutation record/result. |

Direct mutation commands use `--request` with exact native arguments. `invoice-preview`, `payment-preview`, `refund-preview` and `credit-disposition-preview` can save complete previews with `--out`. `status` and `payment-list` can use their default selections without a request file.


## Original bank statement workflow

Use the bank operations in the same declared accounting workspace. They extend the original invoice/receipt journal and file reader. The native source limit is 1,000,000 bytes and 5,000 rows.

1. Save the actual bank account and currency with bank_account_save. Existing accounts retain id and expectedVersion.
2. Inspect the complete original file through bank_source_inspect. Send format, file.name and file.dataBase64, and the selected account when known. CSV inspection accepts an incomplete csvLayout to reveal its actual headers; import requires a complete column mapping. MT940 requires statementOptions with the original profile, encoding, debitCreditProfile, yearWindowStart and VALUE_DATE basis.
3. Retain that exact account, original file, sectionId and interpretation through bank_source_import at the current revision.
4. Page bank_import_detail with view:rows. Apply rowStatus, direction and search to the complete original source. Each row retains actual bank and source identities, conflicts, receipt candidates, invoice candidates and customer matching reasons.
5. Preview complete source credits through bank_posting_preview. Each selection has its original rowId and exact customer splits. CREATE records a receipt; LINK binds all or part of an existing receipt to the source; CORRECT retains the original receipt, released allocations and its explicitly dated replacement.
6. Retain the complete proposal, balanceEffects, reviewSha256 and revision. Post that original review through bank_receipts_post. The native owner checks all affected cash, invoice and refund dates together.
7. Read the original bank files and customer receipt advice through merchant_accounting_file with kind:receivables-bank and bankImportId. Every response preserves the original file inventory and selection.
8. Ignore noncustomer credit rows with their retained reason, restore selected ignored rows when appropriate, and close a fully resolved statement. Reopen preserves previous postings for explicit correction.

A shared original transaction ID cannot create another copy of the same cash. A changed original amount or date needs an authoritative source-resolution reason; distinct-payment reasons apply to separate coincident payments without that shared original ID. Receipt corrections preserve actual bank/received dates separately from accounting dates.

The typed helpers accountingBankPostingPreview and accountingBankPostingArguments retain the original combined proposal and balance-effects seal. Durable prepare/execute/reconcile uses the existing native request ID and revision, including recovery of the original bank posting and all of its receipts, invoices and allocations after a lost response.

Bank account/import/detail reads support up to 500 rows. The complete client reader preserves the native accounts or imports arrays, total, revision and source selections across pages. Source inspection carries its original sample and complete section metadata; the complete parser report is a retained original file.

See [BANK_STATEMENTS.md](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/BANK_STATEMENTS.md) for original source formats, customer splits, dated correction behavior and every HTTP/native route.

## Complete inventory and dated views

| Read | Views and paging |
| --- | --- |
| `status` | `summary`, `invoices`, `receipts`, `credits`, `allocations`, `aging`, `history`. |
| `invoice_preview` | `summary` or `lines`; ordinary CLI preview returns the complete reviewed document. |
| `invoice_detail` | `summary`, `lines`, `credits`, `allocations`, `receipts`, `history`. |
| `payment_detail` | `summary`, `returns`, `observations`, `receipts`, `allocations`, `history`; observations requires `returnId`. |
| `settlement_ledger` | Original ledger rows, optionally scoped to an existing customer. |
| `payment_list` | Original request rows, optionally scoped to an invoice or customer. |

Wrapper views use nonnegative `offset` and a page size of one to 200. Native settlement ledger and payment-list reads accept up to 500. The complete client reader uses 200-row pages and verifies one revision and accounting date throughout.

The CLI's `--all true` consumes a complete paged selection. Choose a non-summary view for status, invoice detail and payment detail. For invoice preview, `--all true` selects its line view; ordinary preview is the complete SHA-bound document.

`asOf` selects the native accounting date for invoice, receipt, allocation, customer and aging amounts. Payment summary also retains the actual observation timing. A dated balance is interpreted alongside the original saved request and transaction observations.

Status history pages the complete original receivables request journal, newest first. Customer-scoped history follows the original resulting invoice, receipt, payment request, refund and credit-disposition identities, including every receipt/invoice identity in a multi-customer bank posting. Aging currency totals state their customer/date scope; text and row-status filters select displayed rows without silently changing that totals scope.

## Original files and proof retention

All files use the existing `merchant_accounting_file` reader. Select one kind and its original identifiers:

| Kind | Selectors | Available files |
| --- | --- | --- |
| `receivables-document` | `documentId` | `invoice.json/csv/html`, `credit.json/csv/html`, `manifest.json`, `status.json`, according to document kind. |
| `receivables-quote` | `invoiceId` | `quote.json`, optional `response.json`, `source.json`, `review.json`. |
| `receivables-preview` | `invoiceId` | `preview.json`, `preview.csv`, `preview.html`. |
| `receivables-payment` | `paymentRequestId`; `returnId` for `proof.json` | `payment-request.json`, `payment-request.html`, `payment-request.uri`, `status.json`, `receiving.json`, `proof.json`. |
| `receivables-refund` | `refundId` | Original `request.json/html/csv`, `refund.json/html/csv`, `reversal.json/html/csv`, `status.json`, `receiving.json`, and each retained `proof-<observationId>.json` from its file inventory. For a credit disposition, select its disposition ID as `refundId` and read `disposition.json/html/csv`. |
| `receivables-bank` | `bankImportId` | Original `source.csv/ofx/mt940`, `import.json`, `rows.json/csv`, `parser-report.json`, `status.json`, `reconciliation.json`, and exact `posting-UUID.json/html/csv` or `receipt-UUID.json/html/csv` members from the returned inventory. |
| `receivables-customer` | `customerId`, optional `asOf` | `account.json`, `invoices.csv`, `account.html`, `manifest.json`, `documents/<original filename>`, `account.tar`. |

Use the original member names from the document or customer inventory. The generic `proof.json` selection maps the selected return to its native `proof-<returnId>.json` export.

The first read retains a file snapshot and reports its `readId`, byte count and SHA. Keep the full kind, file and original selector fields together with that read ID and expected SHA while paging. The native chunk limit is 196,608 bytes. `merchant_accounting_file_release` releases that retained read; the typed client's download and drain helpers manage these read identities.

Full native transaction proofs live in the original workspace's `exports/<observationId>/transfer-proof.json` files. The compact observation and receipt source retain the proof artifact's directory, name, size and SHA. The receiving and per-return downloads hydrate those original proof bytes and verify their identity.

Preserve the complete original accounting workspace, including `exports`, through the existing backup workflow. That keeps invoice and credit documents, original quotation files, customer packets and transaction proofs with their native accounting history.

### Partial source links and receipt corrections

A bank LINK may cover part of an existing receipt, and several actual source credits may cover it within the original receipt amount. Repeated original statement evidence reuses its existing coverage. The link preserves the receipt’s actual received date and accounting date.

For CORRECT, residualAllocations optionally applies remaining original-customer cash to original invoices. The complete reviewed split returns correctedOriginalAmount, replacementReceiptIds and, when needed, residualReceipt with its customer, amount, dates, bank sources and allocations. A receipt covered by 40 and 60 therefore retains the original customer’s 60 when only the 40 is corrected. The native result includes all original, replacement and remaining-cash receipt IDs, and the customer file reader retains their complete advice.
