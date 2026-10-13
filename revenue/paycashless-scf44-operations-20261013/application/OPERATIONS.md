# Native Paycashless operations

## Configuration and scope

Use Linux Node 24, an absolute private workspace directory and the complete application source. Configuration lives outside exported application source. The example configuration contains placeholders, not working merchant credentials.

A Paycashless connection has `provider:"paycashless"`, `environment:"sandbox"|"production"`, `baseUrl:"https://api.paycashless.com"`, `apiKey`, `apiSecret`, and an operator-selected merchant `organizationId`. The environment selects the account's actual credential set; the issued API does not advertise a different sandbox hostname. The public descriptor retains a credential binding hash, origin, environment and selected scope. Changing credentials or source scope invalidates an already prepared connection binding.

A Horizon connection has `provider:"horizon"`, the actual base URL and network passphrase, selected environment and account IDs. All Horizon operations are read-only. Retain the actual network response before relying on settlement evidence.

Start with:

```sh
node cli.mjs runtime-retain --destination /private/paycashless-runtime
node cli.mjs describe --directory /private/paycashless --configuration /private/config.json
node cli.mjs serve --directory /private/paycashless --configuration /private/config.json --runtime /private/paycashless-runtime
```

The operator bearer controls the private local API. Provider credentials never need to enter the browser. Keep configuration, retained responses and workspace archives restricted to their authorized recipients.

## Original operation catalogue

The full exact request and response schemas are retained in `sources/paycashless-openapi.json`. The native catalogue exposes these action IDs:

| Family | Actions |
|---|---|
| Collections | `paycashless.payments.list`, `payment.get`, `payment.verify`, `payment.create`, `payment.checkout` |
| Payouts | `paycashless.payouts.list`, `payout.get`, `payout.verify`, `payout.create` |
| Invoices | `paycashless.invoices.list`, `invoice.get`, `invoice.create`, `invoice.cancel`, `invoice-payments.list` |
| Dedicated accounts | `paycashless.dedicated-accounts.list`, `dedicated-account.get`, `dedicated-account.create`, `account-request.get` |
| Tax rates | `paycashless.tax-rates.list`, `tax-rate.get`, `tax-rate.create`, `tax-rate.update` |
| Bank details | `paycashless.banks.list`, `bank-account.lookup` |
| Issued sandbox simulations | `paycashless.payment.simulate`, `dedicated-account.simulate`, `invoice.simulate` |

Every shortened entry in this table has the same `paycashless.` prefix. The catalogue also retains the maintained Horizon network, account, payment, operation, transaction and ledger reads. There is no invented payout approval or Stellar write route.

List captures preserve the exact original filters and cursor. Paycashless completion requires a complete response with original `hasMore:false`; a missing page or stalled cursor cannot become complete. A capture of an invoice's payments requires `params.id` equal to that original invoice ID. Filtered captures prove their selected scope, not a larger population.

## Prepare and issue one exact request

Commands use the original envelope:

```json
{
  "requestId": "operator-selected-unique-request",
  "expectedRevision": 12,
  "method": "operation.prepare",
  "args": {
    "connectionAlias": "merchant-sandbox",
    "action": "paycashless.invoice-payments.list",
    "inputJSON": "{\"params\":{\"id\":\"ORIGINAL_INVOICE_ID\"},\"query\":{\"limit\":100}}"
  }
}
```

Use actual IDs and the current revision. `inputJSON` and `input` are mutually exclusive. Native strict JSON parsing rejects duplicate keys, invalid Unicode, non-finite numbers and numeric values that would change under request serialization. Keep provider-required monetary JSON integers exact and within their supported native range. Ledger amounts, allocations and conversion rates are exact decimal strings in the domain model.

Run a retained envelope using:

```sh
node cli.mjs command --directory /private/paycashless \
  --configuration /private/config.json --request /private/original-request.json
```

Preparation stores the exact operation and request seal before dispatch. A separate `operation.dispatch` uses `{operationId}`. Mutation dispatch also requires explicit `delivery.configure {enabled:true}` in this workspace. The native engine does not automatically enable writes when you open an app or receive an archive.

The issued contract declares no idempotency-key parameter. An uncertain financial write stays attached to its original attempt. `operation.reconcile` reads the original payment or payout reference where that issued route exists. Invoice creation uses the issued exact reference-filtered invoice list; cancellation and simulations use their original selected resource. A match is a retained observed resource, not permission to send the economic action again. `operation.retry-original` refuses financial retries unsupported by this API.

Successful creation responses may be partial. They remain operation-result observations and offer related full-resource reads. They cannot overwrite a previously retained complete payment, invoice or payout snapshot.

## Collect and import whole populations

`capture.start` accepts `{connectionAlias,action,inputJSON}`. Save the returned capture ID. `capture.run {captureId,maxPages}` continues that capture using retained page requests. A bounded run may return RUNNING, and a failed page may leave PARTIAL. Inspect that same capture and continue it with a new explicit command; preserve earlier accepted results and original page history.

`source.import` retains an operator-supplied response without sending a provider request. Select the actual action, original request parameters, observed status/time and body completeness. The browser hashes the whole upload before native intake. CLI:

```sh
node cli.mjs import-source --directory /private/paycashless \
  --configuration /private/config.json --source /private/original-invoice-payments.json \
  --connection merchant-sandbox --action paycashless.invoice-payments.list \
  --input /private/original-request-input.json --request-id original-intake-id
```

The input file is retained as exact JSON text for native parsing. Missing merchant exports or account credentials remain missing; published example amounts are not merchant facts.

## Signed callbacks

Register the real publicly reachable `callbackUrl` through the actual issued request body. Route it to:

`/webhooks/provider/CONNECTION_ALIAS/SUBSCRIPTION_ID`

Select an endpoint under the private connection:

```json
{
  "webhookEndpoints": {
    "merchant": {
      "callbackUrl": "https://your-controlled-host/webhooks/provider/merchant-sandbox/merchant",
      "urlConvention": "exact"
    }
  }
}
```

The connection's API secret is used unless an explicit endpoint `apiSecret` is selected. `urlConvention` must be `exact` or `lowercase`; choose the convention actually established for the registered endpoint. The source documentation differs in its prose and table, so the application does not guess or try multiple messages.

Verification uses the original event.data stringify/HMAC-SHA512, registered full URL including query and original Request-Timestamp. It does not hash the full raw callback as though it were an API request. Optional time-window enforcement requires an explicit `timestampUnit:"seconds"|"milliseconds"` and `maxAgeMs`; the original callback example and API timestamp formats differ.

The complete original body, headers, signature observation, endpoint/source/environment binding and every reception are durably retained before acknowledgment. The envelope event label is not covered by the published signature; it is retained explicitly as unsigned. Signed data, URL and timestamp retain their own authentication scope. The original leased worker projects this full observation without label-driven readbacks. Choose the actual provider resource read explicitly. Arrival order never supplies current payment-state precedence.

## Books, corrections and reports

Use `book.save`, `link.save`, `reconciliation.create` and `report.create` against the same store. Complete fields and evidence semantics are in `PAYCASHLESS_INTEGRATION.json` and the model guide. All normalization and current decision-tip checks occur in the transaction that saves the new edition.

Read `describe`, `list`, `item` and `file` through CLI or native HTTP. Lists are paginated; read to terminal cursor before claiming a whole population. The browser exposes complete history and report artifacts.

## Receiving and recovery

`workspace.export {destination}` creates a complete frozen delivery. `package.inspect` checks every declared body and full application/runtime closure. Archive and receive:

```sh
node cli.mjs archive --source /private/delivery --destination /private/delivery.tar.gz
node cli.mjs unpack --source /private/delivery.tar.gz --destination /private/unpacked
node cli.mjs package-receive --source /private/unpacked \
  --destination /private/received --request-id original-receive-id
```

Received request records keep their original stored result and original workspace identity. The API wraps replayed responses with the current receiving workspace identity plus `originalWorkspaceId`, so the same browser journal can recover them correctly. Native edits after receiving create new immutable editions. Previously accepted request IDs never become replacement business requests.

The standalone commissioning course retains its input, all requests, complete phase artifacts, both actual archives and three selected workspace paths. Read [COMMISSIONING.md](COMMISSIONING.md) before operating it.

## Browser working-copy continuation

The mounted operator now exports and restores `paycashless.browser-working-copy.v1` using its existing workspace-bound journal. All original submitted Files, attempt histories, current editor values and unsubmitted selected-file bytes are included. The restore transaction preserves existing matching requests and archives the previous view. Newly imported requests remain marked for explicit recovery. This local continuation does not change native request IDs, provider operations, dispatch configuration or received-workspace identity.

Keep the complete browser working copy beside the actual native archive; see [BROWSER_WORKING_COPY.md](BROWSER_WORKING_COPY.md). A customer workspace with a new native ID uses its own browser journal. The original producer's working copy cannot be rebound to it.
