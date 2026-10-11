# Twelve Data merchant and customer workflow

This adapter turns an operator's approved Twelve Data `time_series`, `quote` and
`price` selections into the original SF30 merchant service and generated customer
client. A durable operator workspace retains each requested response under a
stable capture ID. `MarketDataDelivery` consumes that capture or a successful
original SF88 `BuyerResult`, then exports a portable, hash-checked customer folder.

The maintained SF30 upstream, admission, request deadline, payment lifecycle and
seller compiler remain in use. The maintained SF88 buyer remains responsible for
review, approval, signing, execution, payment uncertainty and recovery. The market
adapter adds provider query semantics, account-local request admission, retained
market data and customer consumption. It does not contain another payment engine.

## Source contract

The implemented provider contract was recovered on 2026-10-11 from the official
[OpenAPI document](https://api.twelvedata.com/doc/swagger/openapi.json):
3,447,575 bytes, SHA-256
`d613c91f4a4e51600960858ae8ce30325d8b485be6489bc4fdf5ede254fc2995`.
The original 187-path document includes many operations; this adapter implements
only the three explicit operations below. `config.mjs` retains the source URLs,
source hashes and the upstream MCP source revision. `contract --openapi FILE`
compares a locally retained complete document to that exact contract.

| Native endpoint | Returned unit | Important interpretation |
| --- | --- | --- |
| `GET /time_series` | One symbol's ordered `values` array plus intact native metadata | `outputsize` limits returned bars. This is the returned request window, without an assertion of complete history. |
| `GET /quote` | One full native quote object | Native `timestamp` and `datetime` describe the quote/bar. Optional latest-quote fields remain intact. |
| `GET /price` | The full native price object | The endpoint supplies no price timestamp; the separate response observation time is not a manufactured market timestamp. |

Native price, OHLC and volume strings remain strings. Nulls remain null and absent
fields remain absent. No arithmetic, currency conversion or timezone conversion
is performed. Intraday timestamps retain the selected `timezone` (default
`Exchange`) and returned exchange timezone. The native daily, weekly and monthly
bar contract ignores the timezone parameter and uses exchange-local dates. Native
bar opening times and local capture times are stored separately.

Supporting primary sources:

- [Official documentation index and authentication](https://twelvedata.com/llms.txt)
- [Native API documentation](https://twelvedata.com/docs)
- [Published demo evaluation](https://support.twelvedata.com/en/articles/5335783-trial)
- [Official single-operator and multi-user MCP deployment guidance](https://github.com/twelvedata/mcp/blob/main/PARTNERS.md)
- [API quota-position headers](https://support.twelvedata.com/en/articles/5713553-control-over-api-usage)
- [Per-request credit header](https://twelvedata.com/news/jan-2025-updates)

## Configure the actual operator service

Start with `examples/evaluation-plan.json`. The example selects AAPL through the
provider's published demo key and a one-day internal evaluation retention policy.
It contains no market data and no private API key. Set `TWELVE_DATA_API_KEY` through
your process's secret environment. Native authentication uses
`Authorization: apikey KEY`, never `Bearer KEY`.

The plan is public configuration; `apiKeyEnv` is an environment variable name.
Choose actual permitted data use and retention in `usage`. `internal-evaluation`
keeps the supplied CLI in challenge mode. An `authorized-service` deployment
records the operator's actual authorization reference and uses its configured
native facilitator and payment terms. The selected policy records permitted
intended use; it does not itself grant market-data redistribution rights. This
single-account adapter does not implement the vendor's separate multi-user OAuth
server. Vendor demo data remains in private evaluation folders.

Each product has a stable public ID and route, one native endpoint, an approved
symbol list, explicit buyer-controlled `inputs`, fixed/default native parameters,
and `maxRows`. Public IDs such as `aapl-bars` stay intact; valid internal SF30
handler names are derived deterministically. Product paths cannot enter
`/_seller/` or contain query parameters. Public merchant origins must be HTTPS.

For example, the bar product permits a buyer to choose one approved symbol and
request up to 30 bars; the operator fixes its one-minute interval, exchange time,
descending order and split adjustment. Changing `inputs` is an explicit product
change. Unknown parameters, repeated parameters, multiple symbols, unapproved
symbols or intervals, incompatible dates and invalid native scalar values fail
before provider dispatch. `format=JSON` is fixed internally and API-key query
parameters cannot be supplied by customers.

| Plan setting | Meaning |
| --- | --- |
| `timeoutMs` | Native upstream request deadline, 1–120,000 ms; default 30,000. |
| `maxResponseBytes` | Native SF30 retained JSON ceiling, 1–1,048,576 bytes. |
| `maxInFlight` | This source instance's concurrent provider requests, 1–32. |
| `maxCallsPerMinute` | Sliding 60-second request ceiling across all this instance's products. |
| `products[].maxRows` | Native time-series `outputsize` ceiling, 1–5,000; examples use 30. |
| `usage.retentionSeconds` | Operator-selected retention duration recorded from receipt time. |

The request ceiling is local admission, not a global provider-account quota.
Other processes can consume the same account's quota, and a restarted process
starts a fresh local window. Admission runs before original payment admission and
again immediately before the provider request. Original SF30 handles a subsequent
capacity/error outcome through its existing lifecycle. There are no automatic
provider retries and no extra `/api_usage` call.

The current original upstream wrapper retains only its supported response
headers. This adapter requests `content-type`; quota values unavailable through
that wrapper remain null. When an operator imports a native HTTP observation that
actually contains them, `api-credits-used` and `api-credits-left` describe quota
position. `api-credits-request` is the separate observed per-request amount.
No absent value is inferred from the plan or from a successful response.

## Capture and retain an operator response

Run these commands from this directory in a complete Stellar Forge source or
installed distribution. Choose private absolute workspace and output paths.

```sh
node cli.mjs plan --plan examples/evaluation-plan.json
node cli.mjs capture --workspace /private/market --id aapl-window-001 \
  --plan examples/evaluation-plan.json --product aapl-bars \
  --query '{"symbol":"AAPL"}'
node cli.mjs inspect --workspace /private/market --id aapl-window-001
node cli.mjs export --workspace /private/market --id aapl-window-001 \
  --out /private/deliveries/aapl-window-001
node cli.mjs read --delivery /private/deliveries/aapl-window-001 --offset 0 --limit 10
```

`capture` makes one native request. Its normalized plan, request, contract and
query determine the capture identity. The create-only dispatch marker precedes
network dispatch. An existing completed or failed capture returns its retained
outcome; it does not call the provider again. A dispatch with no retained terminal
manifest remains an unknown outcome and cannot be silently replayed under the
same ID. A new explicit ID represents a new operator request.

`inspect`, `list`, `export` and `read` never query the provider. `list` includes
capture state and retention expiry. Retention metadata is visible after reopen;
this package does not install a background deletion service. The operator's data
lifecycle manages expiry of the capture and every exported copy.

The original native SF30 transport requires direct DNS/TLS connectivity to the
provider. It does not honor a process `HTTPS_PROXY` variable. Where the operator's
approved acquisition environment uses a standard proxy, the retained-response
import below can consume its exact HTTP response without replacing the seller's
payment or transport implementation.

### Import a retained original HTTP response

Keep the unchanged body bytes and a separate observation JSON file. The request
URL must match the selected normalized endpoint and every explicit query
parameter, including `format=JSON`. The input must exclude authorization headers
and API-key query parameters. Retain credentials in the acquisition environment.

```json
{
  "schema": "stellar-forge.twelvedata-http-observation.v1",
  "request": {
    "method": "GET",
    "url": "https://api.twelvedata.com/time_series?interval=1min&outputsize=30&timezone=Exchange&order=desc&adjust=splits&symbol=AAPL&format=JSON"
  },
  "response": {
    "status": 200,
    "headers": {"content-type": "application/json; charset=utf-8"}
  },
  "startedAt": "RETAINED_REQUEST_TIME_WITH_UTC_OFFSET",
  "finishedAt": "RETAINED_RECEIPT_TIME_WITH_UTC_OFFSET",
  "bodySha256": "SHA256_OF_UNCHANGED_BODY_BYTES",
  "bodyBytes": 0
}
```

Replace all observation fields with actual source values; `bodyBytes` above is a
placeholder. Accepted response headers are `content-type`, `date`,
`api-credits-used`, `api-credits-left`, `api-credits-request`, `retry-after` and
`cache-control`. Duplicate, unsupported or malformed headers are rejected. The
source observation is retained unchanged and its own hash is bound into the
capture request identity.

```sh
node cli.mjs import-response --workspace /private/market --id aapl-import-001 \
  --plan examples/evaluation-plan.json --product aapl-bars \
  --query '{"symbol":"AAPL"}' --response /private/acquisition/response.json \
  --source /private/acquisition/observation.json
```

This command makes no HTTP call. Both successful bodies and error responses are
retained; only native HTTP 200 data matching the endpoint's actual response
contract can become a successful customer delivery. Imported capture provenance
is explicitly `OPERATOR_IMPORTED_HTTP_RESPONSE`. It never becomes an SF88 payment
attempt or receipt. Retain a failed direct capture under its original ID and use
a distinct ID for a separate imported acquisition.

## Compile and serve the original merchant

The supplied `examples/challenge-terms.json` uses deliberately nonpayable
illustrative Stellar testnet recipient and asset identifiers. Replace the full
payment terms and origin with the actual merchant's configuration for deployment.
Ordered `paymentOptions` remain in the original offer. Per-product terms can
override the top-level terms using `products.<productId>`.

```sh
node cli.mjs package --plan examples/evaluation-plan.json \
  --terms examples/challenge-terms.json --out /private/merchant-package
node cli.mjs serve --package /private/merchant-package --check
node cli.mjs serve --package /private/merchant-package --port 8423
```

The package contains the plan, original SF30 service configuration, exact provider
contract, generated OpenAPI, JavaScript/TypeScript customer client, request examples
and a run guide. Its identity includes the exact compiled service and generated
client bytes. Hash-checked reuse cannot silently accept an older differently
compiled package. No API keys or captured market data are included.

`--check` is offline and needs no key. Serving uses the named API-key environment
variable and binds to `127.0.0.1`. The operator's normal HTTPS reverse proxy exposes
the saved public origin. The original `/_seller/ready`, `/_seller/health`,
`/_seller/offers`, `/_seller/openapi.json` and `/_seller/docs` surfaces remain usable.
A challenge-only unpaid request returns the original 402 without fetching market
data. A configured authorized-service plan can add `--facilitator HTTPS_URL`, with
the original runtime's `@x402/core` dependencies available. The original service
owns payment verification, application dispatch and settlement/cancellation.

The generated `buyer/README.md` is the source of truth for its maintained request
API and payment-option selection. An actual Node customer can prepare through the
original SF88 buyer:

```js
import { buildRequest } from '/private/merchant-package/buyer/seller-client.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';

const buyer = new Buyer(yourExistingPrivateBuyerConfig);
const request = buildRequest('aapl-bars', { query: { symbol: 'AAPL' } }, {
  intentId: yourStableIntentId,
  acceptIndex: yourSelectedPaymentOption,
  maxAtomic: yourExplicitAtomicSpendCeiling,
});
const operation = await buyer.fromRequest(request, {
  responseFile: { maxBytes: 1048576, expectedContentType: 'application/json' },
});
const review = await operation.review();
// Continue the application's existing review/approval flow. For a new authorized
// operation only: await operation.execute({ review }). Reopen/recover the same
// original intent on interruption; an unknown outcome is not a new purchase.
```

Original `expectedContentType` matching follows the installed buyer's native
contract. If the deployed vendor/seller content type differs, configure its exact
expected type or omit that optional constraint; the market consumer still checks
the actual JSON framing and native fields.

## Consume a completed original buyer result

```js
import { MarketDataDelivery } from './customer.mjs';
import { loadMarketPlan } from './workspace.mjs';

const delivery = await MarketDataDelivery.fromOperation(
  buyer.operation(yourStableIntentId),
  { plan: await loadMarketPlan('/private/merchant-package/plan.json'),
    productId: 'aapl-bars' },
);
const firstPage = delivery.rows({ offset: 0, limit: 20 });
await delivery.export('/private/customer/market-window');
```

`fromOperation` calls the original operation's `recover`, checks the saved config
hash against the actual native result and binds the original GET/product path and
query. It never executes a request. The original buyer result and a sanitized
request record remain attached to the portable delivery. A caller already holding
an actual successful `BuyerResult` can use
`MarketDataDelivery.fromBuyerResult(result, {endpoint, query, usage})` directly;
that caller supplies the actual product/query context. The response file's exact
original native hash is checked in both paths.

The corresponding command is:

```sh
node cli.mjs consume-buyer --buyer-config /private/buyer-config.json \
  --intent original-intent-id --plan /private/merchant-package/plan.json \
  --product aapl-bars --out /private/customer/market-window
```

For an operator capture use `MarketDataDelivery.fromCapture(captureDirectory)`.
Both paths share the same read/export implementation and preserve their distinct
provenance. The library methods `bytes()`, `json()`, `metadata` and `rows()` read only
the retained response. Row paging is local paging within that response, with no
provider continuation or broader-history inference.

### Portable customer files

| File | Contents |
| --- | --- |
| `response.json` | Unchanged original provider response bytes. |
| `metadata.json` | Original source identity, query, native metadata, decimal/time semantics and observation/retention context. |
| `records.jsonl` | Complete native records, retaining values, JSON types, nulls and absence. |
| `records.csv` | The same columns and scalar strings, quoted for CSV. Nested values are JSON text. |
| `csv-semantics.json` | Column order, explicit null/absent cell coordinates and import-as-text instructions. |
| `original-*` | Actual original capture/request/HTTP observation or original native buyer result provenance. |
| `manifest.json` | Identity and exact size/SHA-256 for every retained file. |

Import CSV columns as text to preserve decimal strings and identifiers. JSON is
authoritative for distinguishing null, absent and empty-string values. The adapter
does not add spreadsheet formulas or modify provider values to make them look like
numbers. The provider's unchanged `response.json` always remains available.

Exports are create-only, atomically published private directories. A destination
containing a different identity fails. The aggregate 32 MiB/128-file bound is
checked before publishing and when reopening; each supported export remains
reopenable. Move the whole folder, then use:

```js
const reopened = await MarketDataDelivery.open('/another/private/market-window');
const values = reopened.rows({ offset: 0, limit: 30 });
await reopened.export('/another/private/handoff');
```

Opening checks every file hash. Exporting the same identity to its existing folder
returns `reused: true` and makes no HTTP or payment call.

## Native implementation operation

The implementation was operated on 2026-10-11 against the provider's published
AAPL demo: one actual HTTP 200 response, 4,004 unchanged bytes and 30 one-minute
bars. Its SHA-256 was
`04349c5874e0ca65884c078f9db4ff7820c83dffb750b6080f55e96532cc8912`.
The original direct SF30 socket attempt encountered this container's DNS failure
and remains retained under its failed capture ID. An ordinary proxy-aware request
obtained the actual response; that exact response and observation were imported
under a distinct ID. This establishes the retained-response acquisition path;
it does not claim a successful direct SF30 provider dispatch in this container.

The resulting eight-file customer delivery reopened in a fresh process with the
same response and manifest hashes. Repeat export reused its existing identity.
The original three-route SF30 merchant served native ready/offers and a 402
challenge with zero provider calls. Its original generated client prepared a real
SF88 offline review with the exact saved request/payment fields. No purchase or
settlement was performed. The native response and customer/capture directories
are private evaluation artifacts and are excluded from this source release.

MIT. Use with the maintained original Stellar Forge runtime.
