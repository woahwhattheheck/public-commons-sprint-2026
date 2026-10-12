# Customer refunds and credit disposition

This workflow turns a customer's unapplied receipt value or paid invoice credit into a recorded refund, a reviewed Stellar payout, or payment against another invoice. It uses the existing receivables workspace, original receipts and allocations, and the same operation journal as invoice collection.

The installed command is `starforge merchant-accounting-receivables`. The selected package is normally `@tokenjunkielabs/starforge-merchant`; use the name in the installed package manifest when importing the client. The direct local command is `starforge receivables`. [The receivables guide](./README.md), [invoice payment requests](./PAYMENT_REQUESTS.md), and [the MCP operations guide](../../../../stellar-forge/mcp-merchant-operator/ACCOUNTING_RECEIVABLES.md) describe the surrounding accounting workspace.

## Choose the disposition from the current customer funds

Start with `customer-funds`. With no customer filter it returns the actual customer choices. Selecting a customer returns that customer's receipts, credit-bearing allocations, target invoices and retained sources for a Stellar cash correction.

```sh
starforge merchant-accounting-receivables customer-funds \
  --url http://127.0.0.1:8449/mcp --workspace merchant
```

Connection URLs and workspace aliases come from the existing merchant MCP configuration. The default access token environment variable is `MCP_ACCESS_TOKEN`; `--token-env` selects an existing alternative. For customer-specific inventory, save a private JSON file such as:

```json
{"customerId":"CUSTOMER_UUID","asOf":"2026-10-12"}
```

Then read it:

```sh
starforge merchant-accounting-receivables customer-funds \
  --url http://127.0.0.1:8449/mcp --workspace merchant \
  --request /private/customer-selection.json
```

Replace the example UUID labels with the original IDs returned by the workspace. Use a date appropriate to the accounting record. Inputs and outputs in this guide live in an existing operator-owned private directory; the MCP command expects private regular JSON files and creates output files once.

The inventory fields support a concrete decision:

| Field | Use |
|---|---|
| `receipts` | Select the receipt and its exact currency. `availableToRefund` identifies the current usable value. |
| `eligibleFunding` | Select original allocations against credited invoices when the receipt's value is still allocated. |
| `targetInvoices` | Select invoices that can receive released credit in the same customer and currency. |
| `availableAdjustments` | Select a retained original Stellar adjustment that represents the outgoing cash. |
| `availableRefundReturns` | Select an already verified, unposted outgoing refund return that needs its own cash record. |
| `currencies` | Read original aging totals together with `reservedRefunds` and `refundedPayments`. |

Each funding row names its allocation, receipt, invoice, amount, credit balance and refundable amount. Several rows can share one invoice's credit balance. Review the combined proposal: the native preview checks the total and every affected dated balance, including future allocations.

A useful example is an invoice for 100.00 paid in full, followed by a 20.00 credit note. The paid allocation still contains the customer's value. A 15.00 refund can release 15.00 from that allocation and record 15.00 of refunded receipt value. The remaining 5.00 credit can then fund a different 5.00 invoice. The native proposal shows the original allocation, its replacement amount and IDs, and each receipt and invoice before and after the change.

Money and quantities are exact decimal strings. Copy the currency scale and original record identifiers from the inventory.

## Review and record a bank or other operator-recorded refund

Create the payout using the original banking or payment process, and retain its actual reference. The `OPERATOR_RECORDED` payout records that reference and date in receivables. The customer note becomes part of the refund document; the internal reason explains the accounting decision.

A refund preview input is:

```json
{
  "receiptId": "RECEIPT_UUID",
  "amount": "15.00",
  "effectiveDate": "2026-10-12",
  "reason": "Return part of the credited implementation fee",
  "customerNote": "Refund of the agreed service credit",
  "funding": [
    {"allocationId": "ORIGINAL_ALLOCATION_UUID", "amount": "15.00"}
  ],
  "payout": {
    "kind": "OPERATOR_RECORDED",
    "method": "bank-transfer",
    "reference": "ACTUAL_BANK_REFUND_REFERENCE",
    "refundDate": "2026-10-12"
  }
}
```

For a wholly unapplied receipt, use an empty `funding` array. For a partly unapplied receipt, supply only the original allocation value needed to fund the remainder. The preview determines whether the complete amount fits the dated receipt and invoice balances.

```sh
starforge merchant-accounting-receivables refund-preview \
  --url http://127.0.0.1:8449/mcp --workspace merchant \
  --request /private/refund-input.json --out /private/refund-review.json
```

The saved review contains `proposal`, `reviewSha256`, `balanceEffects`, and `revision`. The review hash binds the complete proposal and balance effects together. Review its customer, original receipt, currency, amount, funding replacements, payout reference and dates. `balanceEffects.receipt` and `balanceEffects.invoices` contain the actual before/after summaries.

Prepare the complete reviewed operation:

```sh
starforge merchant-accounting-receivables prepare \
  --dir /private/refund-bank-operation \
  --url http://127.0.0.1:8449/mcp --workspace merchant \
  --action refund-commit --preview /private/refund-review.json \
  --actor operator-name --request-id refund:bank:20261012:001

starforge merchant-accounting-receivables execute \
  --dir /private/refund-bank-operation
```

Preparation retains the exact proposal, review hash, original workspace revision and operator identity. Commit binds that review to the current original receipt, allocation and refund state. If another operation changes those balances, obtain a fresh preview and review its changed effects before preparing a new operation.

The result contains the refund summary, original receipt, affected invoice summaries, any replacement allocations, and the original operation identity. `RECORDED` identifies the retained payout; `effectiveStatus` and `asOf` describe its effect on the selected accounting date.

## Move released credit to another invoice

A credit disposition releases selected allocation value and applies some or all of the resulting receipt value to other invoices. Any remainder stays unapplied on the original receipt.

Read `customer-funds` again after a refund or other intervening mutation. Select current funding and target invoice IDs from that result. A disposition input has no separately supplied amount:

```json
{
  "receiptId": "RECEIPT_UUID",
  "effectiveDate": "2026-10-12",
  "reason": "Apply the remaining service credit to the next invoice",
  "customerNote": "Remaining credit applied to the replacement service",
  "funding": [
    {"allocationId": "CURRENT_ORIGINAL_INVOICE_ALLOCATION_UUID", "amount": "5.00"}
  ],
  "allocations": [
    {"invoiceId": "TARGET_INVOICE_UUID", "amount": "5.00"}
  ]
}
```

The native proposal computes `released` and `allocated`, retains the original invoice and allocation fingerprints, and assigns the exact replacement/new allocation IDs.

```sh
starforge merchant-accounting-receivables credit-disposition-preview \
  --url http://127.0.0.1:8449/mcp --workspace merchant \
  --request /private/disposition-input.json --out /private/disposition-review.json

starforge merchant-accounting-receivables prepare \
  --dir /private/disposition-operation \
  --url http://127.0.0.1:8449/mcp --workspace merchant \
  --action credit-disposition-apply --preview /private/disposition-review.json \
  --actor operator-name --request-id disposition:20261012:001

starforge merchant-accounting-receivables execute \
  --dir /private/disposition-operation
```

The returned `creditDisposition` summary includes the released and allocated amounts, remaining unapplied value, affected invoice/allocation IDs and creation time. The original invoice, receipt, allocation history and customer export show the resulting balances.

## Review, hand off and receive a Stellar refund

Use a `STELLAR_TRANSFER` payout when the reviewed operation will be paid by a wallet. The source account is part of the review. Native receiving verifies that account as the actual operation sender together with the destination, network, asset, memo and received amount.

The payout portion for a new transfer is:

```json
{
  "kind": "STELLAR_TRANSFER",
  "sourceAccount": "ORIGINAL_MERCHANT_G_ACCOUNT",
  "destination": "CUSTOMER_G_ACCOUNT",
  "network": "stellar:pubnet",
  "asset": {"kind": "native"},
  "stellarAmount": "25.0000000",
  "valuationNote": "The agreed refund value and its exact XLM conversion"
}
```

For a classic issued asset, use `{"kind":"credit","code":"ASSET_CODE","issuer":"ISSUER_G_ACCOUNT"}`. The normal refund input also supplies the exact receipt-currency `amount`, effective date, reason and funding. The reviewed Stellar amount is separate from that commercial amount; the valuation note records their relationship.

Preview and prepare this input with the same `refund-preview` and `refund-commit` commands. An awaiting transfer reserves the reviewed receipt value. Download its `request.html` to hand the operator the original unsigned wallet request. The proposal retains `walletHandoff:true`, the URI and original transfer terms.

A wallet returns a transaction hash. Save that hash with the current revision, actor and stable request ID:

```json
{
  "refundId": "REFUND_UUID",
  "revision": 12,
  "actor": "operator-name",
  "requestId": "refund:return:20261012:001",
  "transaction": "64_LOWERCASE_HEXADECIMAL_CHARACTERS",
  "note": "Original merchant wallet payout"
}
```

```sh
starforge merchant-accounting-receivables refund-return \
  --url http://127.0.0.1:8449/mcp --workspace merchant \
  --request /private/refund-return.json
```

Use the returned `refundReturn.id` and new revision for receiving:

```json
{
  "refundId": "REFUND_UUID",
  "returnId": "RETURN_UUID",
  "revision": 13,
  "actor": "operator-name",
  "requestId": "refund:receive:20261012:001"
}
```

```sh
starforge merchant-accounting-receivables refund-receive \
  --url http://127.0.0.1:8449/mcp --workspace merchant \
  --request /private/refund-receive.json
```

The source account already comes from the reviewed payout, so the returned transaction input consists of the hash and optional note. Receiving retains the native transfer response and its exact proof identity. A verified pubnet payout records the actual refund. Testnet observations remain in the refund history with `accountingScope:TESTNET_OBSERVATION`.

An original return may be `NOT_FOUND` before the RPC has the transaction. Later receiving of that same return uses a new stable operation ID and the current revision, so the next observation is retained separately. A failed or unavailable lookup keeps its original observation. Refund proof filenames use observation IDs because one return can have several observations.

The wallet handoff follows the [original SEP-0007 standard](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md). The selected network, destination, exact received amount, issued-asset code/issuer and memo are retained in the native proposal.

## Correct a reported transaction across refunds and invoice collection

A reported hash and its unsuccessful observations remain in the original history. Ownership follows a verified receiving result, so an unverified report against the wrong refund or invoice can be corrected in the intended workflow.

- **An incoming invoice payment was reported as a refund:** open the correct invoice's issued payment request, report the original hash there and receive it against that invoice's wallet terms. The unsuccessful refund report stays available for review.
- **An outgoing refund was reported against an invoice or another refund:** open the intended reviewed refund, report the original hash and receive it against that refund's source account, beneficiary, network, asset, memo and amount. An unverified or unsuccessful report in the earlier location does not reserve the outgoing payment.
- **Another form of a fee-bump hash was reported:** receiving compares both the inner and outer transaction hashes. A verified return keeps ownership of both forms. Reopen that original return to continue receiving or recover its operation.

A verified outgoing transfer retains ownership even when its observation is `REFUND_FUNDS_CONFLICT`, `REFUND_SOURCE_CONFLICT`, `ADDITIONAL_TRANSFER`, or a timing conflict. The cash has already moved. Use its original return and the cash-reconciliation workflow below to resolve the source, funding or accounting record. The retained transaction must not become a second invoice receipt or unrelated refund.

Recorded incoming receipts, including reversed receipts, accepted test-network invoice observations, recorded refunds and original refund adjustments keep their transfer identities. Changing an entered hash to its fee-bump alias does not release those identities.

## Reconcile an outgoing transfer that already happened

A real early, additional or post-cancellation outgoing transfer can require its own refund record. The original receiving history retains that transaction, and `customer-funds.availableRefundReturns` provides the exact eligible source.

Select the original refund and return from this inventory:

```json
{
  "kind": "STELLAR_TRANSFER",
  "originalRefundId": "ORIGINAL_REFUND_UUID",
  "originalReturnId": "ORIGINAL_RETURN_UUID",
  "valuationNote": "Record the original verified outgoing transfer against the customer receipt"
}
```

Use that payout within a new `refund-preview` input with the receipt, commercial amount, funding, reason and effective date. The native preview derives the original source account, destination, asset, exact Stellar amount, memo, transaction and proof. Its `walletHandoff` is false and its `uri` is null. Its refund date comes from the original ledger close; the effective date must be on or before that cash date.

Review and commit the resulting proposal through the same prepared operation workflow. The new refund adopts the already executed payout, and the original return records its `resolvedRefundId`. Each refund retains one payout, so a distinct extra transfer receives its own reviewed record.

A receipt with a verified outgoing transfer awaiting this cash record reports `unreconciledRefunds`, `unreconciledRefundAmount`, `availableBeforeUnreconciledRefunds` and any `refundDeficit`. Its spending availability reflects that outstanding cash movement. Release, correction and adoption remain the paths for reconciling the original cash and allocations.

When the existing settlement workflow already retained the outgoing cash as an original Stellar adjustment, choose:

```json
{
  "kind": "ORIGINAL_STELLAR_ADJUSTMENT",
  "adjustmentId": "ORIGINAL_ADJUSTMENT_UUID",
  "valuationNote": "Apply the original recorded Stellar adjustment to this customer refund"
}
```

Select the adjustment from `availableAdjustments`, preview its exact effects and commit the complete proposal.

## Withdraw an awaiting refund or correct a dated record

An awaiting transfer can be cancelled with its accounting date and reason. Save a native mutation request:

```json
{
  "refundId": "REFUND_UUID",
  "revision": 14,
  "actor": "operator-name",
  "requestId": "refund:cancel:20261012:001",
  "cancelledDate": "2026-10-12",
  "reason": "Customer selected a different payment method"
}
```

Send it with `refund-cancel`. Cancellation retains the issued request and its observations. If a real outgoing transfer subsequently appears, receive it against the original return and use the inventory's adoption path for its cash record.

A dated correction uses `refund-reverse` with `reversedDate` and a reason. The original record and reversal documents remain available. For an operator-recorded replacement, include `replacesRefundId` in the new `OPERATOR_RECORDED` payout. This links the corrected record while retaining the actual bank reference and `refundDate`. The derived `accountingDate` places the replacement at its effective correction date; ordinary entries use their actual refund date.

For an already paid refund, use the original `reversedDate` as the replacement's `effectiveDate` and retain the factual bank `refundDate`. More generally, the native review requires the replacement effective date to fall between the prior reversal date and the later of that reversal date or the actual bank refund date. This keeps the paid cash accounted for across the correction.

Read the funds again after reversal, preview the replacement and its current balance effects, then prepare and execute the reviewed replacement. Historical `asOf` queries show the effects on their original dates. Current `status` and date-specific `effectiveStatus` are separate fields.

## Recover a lost response using the original operation

The MCP command keeps the original request and connection in the prepared operation directory. `execute` looks up the original request before its single mutation call. A lost response receives an original journal lookup.

```sh
starforge merchant-accounting-receivables reconcile \
  --dir /private/refund-bank-operation
```

The result identifies the original operation and current record projection. An explicit subsequent `execute` uses the same stored request ID, argument strings and revision when that request remains absent. Do not rewrite the retained request to create another refund. The original journal checks the identity and intent of repeated requests.

Direct `refund-commit`, `refund-cancel`, `refund-reverse`, `refund-return`, `refund-receive`, and `credit-disposition-apply` commands accept the corresponding exact private JSON request. They preserve the same mutation context and original journal reconciliation.

## Read and deliver the refund documents

Read `refund-detail` with `{"refundId":"REFUND_UUID"}` and an optional `asOf`. The result contains the complete proposal, refund summary, returns, history, balance effects, revision and logical file identities.

| File | Content |
|---|---|
| `request.json`, `request.html`, `request.csv` | Original reviewed refund request. |
| `refund.json`, `refund.html`, `refund.csv` | Recorded refund document once its payout is recorded. |
| `reversal.json`, `reversal.html`, `reversal.csv` | Original dated reversal document when present. |
| `disposition.json`, `disposition.html`, `disposition.csv` | Original released-credit disposition document, selected with the disposition ID. |
| `status.json` | Current native refund or disposition status. |
| `receiving.json` | Complete receiving history and retained native proofs. |
| `proof-OBSERVATION_UUID.json` | One original observation's retained proof. |

Use a generic file selection:

```json
{"kind":"receivables-refund","refundId":"REFUND_UUID","file":"refund.html"}
```

```sh
starforge merchant-accounting-receivables download \
  --url http://127.0.0.1:8449/mcp --workspace merchant \
  --selection /private/refund-file-selection.json \
  --out /private/customer-refund.html
```

For a credit disposition, use its returned `creditDisposition.id` as the file selection's `refundId` and choose `disposition.json`, `disposition.html` or `disposition.csv`. The original reader serves that disposition's retained documents.

Add `--sha256 ORIGINAL_SHA256` to bind a previously reviewed file identity. The original reader preserves the selectors, retained read ID and SHA across all chunks. The SDK's `refundFile({refundId,file})` offers the same complete-file path.

Use `refund-list` with `customerId`, `receiptId`, `status`, `asOf`, `offset` and `limit` as needed. `--all true` consumes every original page while preserving the revision and accounting date. Its native row property is `refunds`. Customer exports continue to use the original accounting export and archive process. The original workspace backup captures the retained exports and proof artifacts alongside the state.

## HTTP and typed JavaScript integration

The HTTP client is available at `@tokenjunkielabs/starforge-merchant/merchant/receivables/client`. Methods use the existing receivables API prefix:

| Method | HTTP route |
|---|---|
| `customerFunds(query)` | `GET /funds` |
| `previewRefund(input)` | `POST /refunds/preview` |
| `commitRefund(input)` | `POST /refunds` |
| `refunds(query)` | `GET /refunds` |
| `refund(id,query)` | `GET /refunds/:id` |
| `cancelRefund(id,input)` | `POST /refunds/:id/cancel` |
| `reverseRefund(id,input)` | `POST /refunds/:id/reverse` |
| `reportRefundReturn(id,input)` | `POST /refunds/:id/returns` |
| `receiveRefund(id,input)` | `POST /refunds/:id/receive` |
| `refundFile(id,name)` and `refundBytes(id,name)` | `GET /refunds/:id/files/:name` |
| `previewCreditDisposition(input)` | `POST /credit-dispositions/preview` |
| `applyCreditDisposition(input)` | `POST /credit-dispositions` |

Each method accepts an optional final `{signal}`. `refundFile` returns the original successful `Response`; `refundBytes` returns `{name,type,bytes}`. The client preserves original API errors and operation uncertainty.

The MCP typed client uses `@tokenjunkielabs/starforge-merchant/merchant/accounting-receivables`. It exposes the same logical methods with one native argument object; ID-specific methods include `refundId` in that object:

```js
import {
  connectAccountingReceivablesClient,
  accountingRefundArguments,
  accountingCreditDispositionArguments
} from '@tokenjunkielabs/starforge-merchant/merchant/accounting-receivables';

const client = await connectAccountingReceivablesClient({
  url: process.env.MERCHANT_MCP_URL,
  workspace: 'merchant'
});

try {
  await client.open();
  const funds = await client.customerFunds({customerId});
  const refundPreview = await client.previewRefund(refundInput);

  // Retain and review refundPreview before using these arguments.
  const refundArguments = accountingRefundArguments(refundPreview, {
    actor: 'operator-name',
    requestId: 'refund:operator:20261012:001'
  });

  // Commit when this exact review is the approved operation.
  const recorded = await client.commitRefund(refundArguments);
  const original = await client.refund({refundId: recorded.refund.id});
  const document = await client.refundFile({
    refundId: original.refund.id,
    file: 'refund.html'
  });

  const inventory = await client.listAll('refund_list', {customerId});
  console.log({fundsRevision: funds.revision, refunds: inventory.refunds.length,
    document: document.file});

  // A separate reviewed disposition follows the same argument contract.
  // accountingCreditDispositionArguments(dispositionPreview, {actor, requestId})
} finally {
  await client.disconnect();
}
```

The caller supplies the selected `customerId` and complete `refundInput` from its own reviewed workflow. Use `request.html` for an awaiting Stellar refund; the recorded `refund.html` becomes available with its actual cash record. The explicit operation helpers also work with the durable `prepareAccountingReceivablesOperation` API from the `/merchant/accounting-receivables/operations` export. Preparation kinds are `refund_commit` and `credit_disposition_apply`.

Both preview inputs support an optional stable `id`; the original preview generates it when omitted. Optional `customerNote` is limited to 3,000 characters, and a new Stellar payout can include a wallet `msg` of up to 300 characters.

The declarations export the complete preview/proposal, payout variants, original funding replacements, funds inventory, summaries, native return observations, file names and mutation results from both client entrypoints.

## Use the local accounting command

The local command opens the existing accounting directory and uses its original workspace lease:

```sh
starforge receivables funds --directory /private/accounting --customer CUSTOMER_UUID
starforge receivables refund-preview --directory /private/accounting \
  --input /private/refund-input.json --out /private/refund-review.json
starforge receivables refund-commit --directory /private/accounting \
  --input /private/refund-commit.json
starforge receivables refund --directory /private/accounting --id REFUND_UUID
starforge receivables refund-file --directory /private/accounting --id REFUND_UUID \
  --name refund.html --out /private/customer-refund.html
```

Local commit input is the reviewed `proposal`, `reviewSha256` and `revision`, plus `actor` and `requestId`. Local ID-specific commands take `--id`, so their input JSON contains the native mutation fields without the separate MCP `refundId` selector.

Additional local commands are `refunds`, `refund-cancel`, `refund-reverse`, `refund-return`, `refund-receive`, `credit-disposition-preview` and `credit-disposition-apply`. The generic `apply --action` command supports every refund mutation and disposition application. Preview commands can save the complete review with `--out`; file downloads retain the original document bytes and report their SHA-256.
