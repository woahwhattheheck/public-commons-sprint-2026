# Invoice payment requests on Stellar

This collection workflow starts with an issued customer invoice, produces a reviewed Stellar wallet request, and brings the returned transaction into the same customer receipts and invoice allocations used by merchant accounting. The browser, command line, HTTP client, and native workspace share the original accounting directory and operation journal.

Open the merchant receivables workspace and select an issued invoice with an amount due. Choose **Payment requests** to review the selected invoice amount, the exact Stellar destination and asset, the wallet amount, memo, and expiry. The issued request retains the original invoice document identity and its balance at review.

## Collection terms

Each request has two explicit amounts:

| Term | Meaning |
| --- | --- |
| `invoiceAmount` | The amount of the invoice currency this collection will settle. It defaults to the current amount due. |
| `stellarAmount` | The exact amount the merchant must receive on Stellar, expressed as a decimal string with up to seven decimal places. |
| `valuationNote` | The merchant's recorded basis for applying that Stellar payment to the selected invoice amount. |

The original invoice remains in its own currency. For example, a USD invoice may select an agreed amount of a specifically issued Stellar asset. Enter its exact asset code and issuer and record the agreed valuation. Native XLM at the exact face amount of an XLM invoice supplies its own face-value description.

The destination is the merchant's existing Stellar G account. The asset is either `{kind:"native"}` or `{kind:"credit",code,issuer}`. Issued assets with the same code and different issuers are distinct assets.

The default memo is a unique `MEMO_HASH` bound to this request and the original invoice. Keep that memo in the wallet transaction. A supplied memo supports `MEMO_TEXT`, `MEMO_ID`, `MEMO_HASH`, or `MEMO_RETURN`; hash and return memo values are canonical base64 of 32 bytes. The wallet message, `msg`, is separate from the transaction memo.

The wallet handoff follows the original [Stellar SEP-7 payment URI standard](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md). It uses an unsigned `web+stellar:pay` URI containing the exact destination, amount, asset and memo. The customer opens that URI in their selected wallet and reviews the transaction there. The selected Stellar test network is carried explicitly in the URI's network passphrase.

## Review and issue a request

A preview returns the complete canonical `proposal`, its `reviewSha256`, the current invoice summary, and the workspace `revision`. Issuing uses those exact returned proposal bytes and review digest together with the operator and a stable operation identifier.

The native controller rereads the original issued invoice before issuing. A changed invoice balance, version, or collection term requires a current review. Outstanding active requests on the same invoice and network reserve their selected invoice amounts; their sum must fit the amount due. Withdraw a replaced request before issuing a replacement for its reserved amount.

Example collection terms for an issued USD 125 invoice:

```json
{
  "invoiceAmount": "125.00",
  "network": "stellar:pubnet",
  "destination": "YOUR_EXISTING_MERCHANT_G_ACCOUNT",
  "asset": {
    "kind": "credit",
    "code": "USD",
    "issuer": "THE_EXACT_AGREED_ASSET_ISSUER_G_ACCOUNT"
  },
  "stellarAmount": "125.0000000",
  "msg": "Payment for the issued invoice",
  "valuationNote": "USD 125.00 of this invoice is settled by receipt of 125.0000000 units of the selected issued asset."
}
```

Replace the account placeholders with the actual existing destination and agreed issuer. For native XLM, use `{"kind":"native"}`. An optional expiry is a future UTC timestamp, such as an operator-selected date ending in `Z`.

### Command line

The installed `starforge` command uses the existing receivables entrypoint. Reopen the original accounting directory.

```sh
starforge receivables payment-preview --directory /private/accounting --invoice INVOICE_UUID --input /private/payment-terms.json --out /private/payment-review.json
```

The review file is created exclusively: an existing file is preserved. Inspect the returned proposal and wallet URI. Build the issue input from that same review:

```js
import {readFile, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const reviewed = JSON.parse(await readFile('/private/payment-review.json', 'utf8'));
const issue = {
  revision: reviewed.revision,
  actor: 'Merchant accounts',
  requestId: randomUUID(),
  proposal: reviewed.proposal,
  reviewSha256: reviewed.reviewSha256,
};
await writeFile('/private/payment-issue.json', JSON.stringify(issue, null, 2) + '\n',
  {flag: 'wx', mode: 0o600});
```

Issue the reviewed request:

```sh
starforge receivables payment-create --directory /private/accounting --invoice INVOICE_UUID --input /private/payment-issue.json
```

The result includes `paymentRequest.id`, the updated invoice, workspace revision and original operation. Retain the input for recovery. Download the customer handoff using the returned request ID:

```sh
starforge receivables payment-file --directory /private/accounting --id PAYMENT_REQUEST_UUID --name payment-request.html --out /private/customer-payment-request.html
starforge receivables payment-file --directory /private/accounting --id PAYMENT_REQUEST_UUID --name payment-request.uri --out /private/customer-payment-request.uri
```

The HTML shows the invoice, selected invoice amount, exact wallet terms and current request status. Its wallet button is available when the request remains payable. The URI file contains the original wallet handoff with one terminating newline.

## Receive the returned wallet transaction

Record the original 64-character lowercase transaction hash supplied by the wallet. The sender's Stellar G account is an optional exact constraint. When it is omitted, the verifier derives the paying account from the matching original operation; this also handles a separate transaction fee payer.

The return record captures the reference and operator note. Receiving then reads the original Stellar network and transaction response through the configured native verifier. The transfer must match the saved network, merchant destination, asset, received amount and transaction memo. The original ledger result and operation identify the transfer.

For a public-network transfer, successful receiving creates an ordinary customer receipt with its original ledger close date, recorded invoice valuation and complete source references. The default allocation applies as much of that invoice-valued receipt as fits the invoice's current and retained dated balances. Any remaining receipt amount stays available in the existing customer account.

The receipt and allocation are committed with the verification observation in the same accounting operation. The same transaction cannot become a second receipt through another request or another import. Reopening a received reference returns its original receipt and allocation.

### Return input

Read the current workspace revision with `starforge receivables state` and put it in the input together with a newly generated request ID:

```json
{
  "revision": 42,
  "actor": "Merchant accounts",
  "requestId": "A_NEW_OPERATION_UUID",
  "transaction": "THE_EXACT_64_CHARACTER_LOWERCASE_TRANSACTION_HASH",
  "note": "Wallet transaction returned for this invoice."
}
```

Use the actual revision and generated UUID from this workspace, then record the reference:

```sh
starforge receivables payment-return --directory /private/accounting --id PAYMENT_REQUEST_UUID --input /private/payment-return.json
```

The result supplies `paymentReturn.id`. Use it with the returned current revision in the receiving operation:

```json
{
  "revision": 43,
  "actor": "Merchant accounts",
  "requestId": "ANOTHER_NEW_OPERATION_UUID",
  "returnId": "PAYMENT_RETURN_UUID",
  "allocate": true
}
```

```sh
starforge receivables payment-receive --directory /private/accounting --id PAYMENT_REQUEST_UUID --input /private/payment-receive.json
```

Optional `allocatedDate` chooses the accounting allocation date. It must be on or after the invoice issue date and original ledger close date. Optional `allocationAmount` chooses an exact amount that fits the received value and the retained invoice balances. Set `allocate:false` to record the verified customer receipt for later allocation; omit `allocationAmount` in that case.

The merchant's selected `invoiceAmount` determines the invoice-currency receipt value. The complete original asset, atomic amount, destination, payer, memo, network, ledger, transaction fingerprint and valuation note remain attached to its source.

### Correct a reported transaction or sending account

In the operator workspace, open the invoice's payment request and its transaction receiving history.

- **Transaction reported against the wrong invoice:** keep that report in its original history. Open the correct invoice's issued request and record the same transaction hash there. An unverified or unsuccessful report does not reserve the payment. Receiving checks the selected request's exact wallet terms.
- **Transaction reported as a refund by mistake:** open the correct invoice's issued request, record the original hash and receive it there. An unverified or unsuccessful refund report remains in its history and does not reserve the payment. A refund whose outgoing transfer was verified keeps ownership while its funding or accounting record is reconciled; use [the original refund return](./REFUNDS_AND_CREDITS.md#reconcile-an-outgoing-transfer-that-already-happened) for that recovery.
- **Incorrect transaction hash:** record the correct hash as another transaction reference. Each reference keeps its original hash, operator note and observations.
- **Incorrect optional sending account:** choose **Correct sending account** on the saved reference, enter the correct G account or leave it blank to use the payment's actual sender, and provide the reason. Then choose **Inspect and receive** again.

The sending account can be corrected before the reference has a verified transfer. Its returned-reference ID, original hash, original report note and previous observations remain in place. The request history records the previous account, new account, operator, correction time and reason. A successful public-network receipt or test-network verification keeps the verified account fixed.

The same correction is available through the existing `payment-return` command and `reportPaymentReturn` client method. Reuse the saved payment-request ID and transaction hash, with the current revision and a new operation ID. Include an explicit account string to change the sender constraint, or `"payer": null` to clear it:

```json
{
  "revision": 44,
  "actor": "Merchant accounts",
  "requestId": "A_NEW_CORRECTION_OPERATION_UUID",
  "transaction": "THE_ORIGINAL_SAVED_64_CHARACTER_TRANSACTION_HASH",
  "payer": null,
  "note": "Use the account that sent the payment; the earlier optional account was entered incorrectly."
}
```

Omitting `payer` preserves the saved account constraint. Replaying an uncertain correction uses the same operation ID and unchanged input. A further correction uses a new operation ID and current revision.

Verified receiving owns the transfer. A transaction already recorded as a receipt, including a later reversed receipt, cannot create another receipt. Accepted test-network receiving also remains unique. The receiver compares both inner and outer transaction hashes for fee-bump transactions, so changing the reported form of the same transaction does not duplicate it. Open the existing receiving result to reconcile an already verified payment.

### Test network and incomplete observations

The same reviewed request and original-network verification are available on `stellar:testnet`. A matching test-network transfer produces `TESTNET_VERIFIED` and retains its original observation and proof. The commercial receipt and allocation path applies to verified public-network transfers.

The receiving result keeps the actual observation:

| Observation | Operator action |
| --- | --- |
| `NOT_FOUND` | Keep the original return and receive it again after the transaction becomes available. |
| `VERIFICATION_UNAVAILABLE` | Reopen the original return, resolve the reported transport or response problem, and perform another receiving observation. |
| `FAILED` | Inspect the original failed ledger result. The still-current request can present its wallet handoff for a new transaction. |
| `TRANSFER_PRECEDES_REQUEST` | Inspect the supplied transaction against the request's original issue time. |
| `TRANSFER_AFTER_EXPIRY` or `TRANSFER_AFTER_CANCELLATION` | Use the retained ledger close time and request history to resolve the late transfer. |
| `TESTNET_VERIFIED` | Open the retained test-network proof for the demonstration or integration record. |

Each new receiving observation uses a new operation ID. Recovery of an uncertain existing operation reuses its original operation ID and unchanged input.

## Reopen, withdraw and reconcile

List requests for an invoice or customer:

```sh
starforge receivables payment-requests --directory /private/accounting --invoice INVOICE_UUID --offset 0 --limit 100
starforge receivables payment-requests --directory /private/accounting --customer CUSTOMER_UUID --as-of 2026-10-12
```

The page returns its total, offset, limit and workspace revision. Use the next offset to continue the same query. The maximum page size is 500.

Open an existing request with all returned references, receipt links, allocations and history:

```sh
starforge receivables payment-request --directory /private/accounting --id PAYMENT_REQUEST_UUID
```

The summary shows selected invoice value, current amount due, received, applied and unapplied amounts. `balanceChanged` identifies a balance change since the reviewed invoice snapshot. Request status is calculated from the original receipt and allocation records. Releasing an allocation or voiding a receipt through the normal receivables commands is reflected when the request is reopened.

Dated `asOf` views use the selected accounting date for balances. Expiry and payable status use the response's explicit `observedAt` timestamp. Keep those two times with an exported report.

To withdraw a request, use `payment-cancel` with the current mutation context and a clear reason:

```json
{
  "revision": 44,
  "actor": "Merchant accounts",
  "requestId": "A_NEW_WITHDRAWAL_OPERATION_UUID",
  "reason": "Replaced with the customer's reviewed asset and collection terms."
}
```

```sh
starforge receivables payment-cancel --directory /private/accounting --id PAYMENT_REQUEST_UUID --input /private/payment-withdrawal.json
```

Withdrawal records its time and reason, preserves the issued request and returns, and releases that request's active reservation. Reopen the same ID to inspect it later. Issue any replacement from a new current preview. Existing receipts and allocations retain their ordinary accounting history.

## TypeScript and JavaScript client

The default distribution package is `@tokenjunkielabs/starforge-merchant`. If the installed package's `package.json` declares a different name, use that name with the same export suffix:

```ts
import {
  createReceivablesClient,
  type PaymentRequestInput,
  type PaymentRequestDetail,
} from '@tokenjunkielabs/starforge-merchant/merchant/receivables/client';

const client = createReceivablesClient({
  baseUrl: 'http://127.0.0.1:8448/api/receivables',
});

const terms: PaymentRequestInput = {
  network: 'stellar:pubnet',
  destination: merchantReceivingAccount,
  asset: {kind: 'native'},
  stellarAmount: agreedStellarAmount,
  invoiceAmount: agreedInvoiceAmount,
  valuationNote: agreedValuation,
};

const review = await client.previewPaymentRequest(invoiceId, terms);
// Present review.proposal to the operator and retain this exact review.
const created = await client.createPaymentRequest(invoiceId, {
  revision: review.revision,
  actor: 'Merchant accounts',
  requestId: crypto.randomUUID(),
  proposal: review.proposal,
  reviewSha256: review.reviewSha256,
});

const returned = await client.reportPaymentReturn(created.paymentRequest.id, {
  revision: created.revision,
  actor: 'Merchant accounts',
  requestId: crypto.randomUUID(),
  transaction: walletTransactionHash,
});

const received = await client.receivePaymentRequest(created.paymentRequest.id, {
  revision: returned.revision,
  actor: 'Merchant accounts',
  requestId: crypto.randomUUID(),
  returnId: returned.paymentReturn.id,
  allocate: true,
});

const detail: PaymentRequestDetail = await client.paymentRequest(created.paymentRequest.id);
const printable = await client.paymentRequestBytes(created.paymentRequest.id, 'payment-request.html');
const receiving = await client.paymentRequestBytes(created.paymentRequest.id, 'receiving.json');
```

The example uses variables supplied by the actual invoice, merchant configuration and wallet result. Amounts stay decimal strings throughout.

All new client methods accept an optional `{signal}` in the final argument. `paymentRequestFile` returns the original HTTP `Response`; `paymentRequestBytes` reads it into a `Uint8Array` and returns its name and media type. The client preserves the server's error code, details, request identifier and response.

The browser uses the default same-origin API base. A Node caller supplies the full local API URL and, if required by its environment, a fetch implementation. The client sends each mutation once. A transport interruption retains the same mutation input for reconciliation and retry; constructing a new operation would create a different request.

### Methods and routes

| Client method | HTTP route |
| --- | --- |
| `previewPaymentRequest(invoiceId, terms)` | `POST /invoices/:invoiceId/payment-requests/preview` |
| `createPaymentRequest(invoiceId, input)` | `POST /invoices/:invoiceId/payment-requests` |
| `paymentRequests(query)` | `GET /payment-requests` |
| `paymentRequest(id, query)` | `GET /payment-requests/:id` |
| `cancelPaymentRequest(id, input)` | `POST /payment-requests/:id/cancel` |
| `reportPaymentReturn(id, input)` | `POST /payment-requests/:id/returns` |
| `receivePaymentRequest(id, input)` | `POST /payment-requests/:id/receive` |
| `paymentRequestFile(id, name)` | `GET /payment-requests/:id/files/:name` |

Routes are relative to `/api/receivables`. Preview is a read-only calculation submitted as JSON. The mutation routes use `actor`, stable `requestId` and current `revision`; create additionally requires the original reviewed proposal and digest.

Existing automation using `receivables apply` can select `payment-create`, `payment-cancel`, `payment-return`, or `payment-receive`. Its `--id` is the invoice ID for `payment-create` and the payment-request ID for the other three actions.

## Original files and workspace recovery

| File selector | Content |
| --- | --- |
| `payment-request.json` | Exact immutable issued request, original proposal and review digest. |
| `payment-request.html` | Printable customer request with current summary and wallet handoff. |
| `payment-request.uri` | Original SEP-7 URI. |
| `status.json` | Current summary, request history and accounting revision. |
| `receiving.json` | Original request, request history, returns, complete original proofs, receipts and allocations. |
| `proof-RETURN_UUID.json` | One returned transaction with its complete native observations and resulting receipt and allocations. |

The request record holds compact proof references. Complete original verification responses are retained under the original accounting workspace's `exports` directory as `transfer-proof.json`, with byte length and SHA-256. The receiving and proof downloads verify and hydrate those originals.

Keep the original accounting workspace, including its existing `exports` files, when moving or backing up the workspace. Download the customer account through the existing `receivables export` command and retain the corresponding request and receiving files for the collection handoff.

Reopening the same workspace restores the request register and original operation journal. If a mutation response is lost, first reopen the invoice or request and retain the unchanged input. Reusing its stable operation ID recovers the original operation instead of duplicating its issued request or received payment. A definitive revision or review conflict calls for a current view and a newly reviewed operation.

## Native integration

The maintained distribution exposes:

| Export | Use |
| --- | --- |
| `@tokenjunkielabs/starforge-merchant/merchant/receivables/client` | Typed HTTP client for browser and local integrations. |
| `@tokenjunkielabs/starforge-merchant/merchant/receivables/payment-requests` | Original proposal, URI, document and summary model. |
| `@tokenjunkielabs/starforge-merchant/merchant/receivables/payment-requests-workspace` | Payment request controller over an existing receivables workspace. |
| `@tokenjunkielabs/starforge-merchant/merchant/receivables/payment-requests-verifier` | Native Stellar SDK and original-network transfer verification. |

The normal `ReceivablesWorkspace` supplies these operations through its facade, so embedded callers use the same receipt, allocation and history behavior as the HTTP server. The lower-level workspace accepts a `verifyTransfer` implementation for an existing native host; its result must preserve the original network and transaction observations required by the model.

The selected source distribution includes the native network catalog and maintained SDK package anchor. Runtime installation uses the existing Stellar SDK 16.3.0 dependency profile and the original [Stellar RPC transaction interface](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction).
