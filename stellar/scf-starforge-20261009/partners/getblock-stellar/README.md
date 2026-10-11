# GetBlock Stellar paid reads

Run selected Stellar JSON-RPC reads as priced merchant operations, with the
GetBlock path token retained entirely in the operator process. The product
builds the original SF61 OpenAPI offers and service, runs through the original
SF30 native x402 merchant, and uses the original SF82 release and SF88 buyer
workflows. There is one backend transport and one payment lifecycle.

The shipped operations serve Stellar **mainnet data**. Payment terms explicitly
choose `stellar:testnet` or `stellar:pubnet`; this is a separate network choice.
The integration is maintained by Commons and does not imply a GetBlock
partnership, deployed service or commercial agreement.

## Prepare the merchant

Use Node 22+ and the complete public sprint checkout. Commands below start at
the checkout root. Create a private working directory, emit the plan template,
then replace its merchant origin, asset contract, recipient and every selected
atomic-unit price with the actual operator choices:

```sh
mkdir -m 700 /private/getblock
node stellar/scf-starforge-20261009/partners/getblock-stellar/cli.mjs template \
  > /private/getblock/plan.json
chmod 600 /private/getblock/plan.json
node stellar/scf-starforge-20261009/partners/getblock-stellar/cli.mjs inspect \
  --plan /private/getblock/plan.json
node stellar/scf-starforge-20261009/partners/getblock-stellar/cli.mjs prepare \
  --plan /private/getblock/plan.json --out /private/getblock/stellar-reads-v1
```

The parent directory must exist with mode `0700`. The output must be new.
Preparation reads no endpoint credential and calls no provider, facilitator,
wallet or catalog. `RUN.md` contains exact commands for this package's absolute
paths; `compiled/` is the actual original SF61 compiler output. Preserve it with
the source checkout. Preparation failures retain the created files for diagnosis;
use a new output directory after correcting the input.

The plan contains only public merchant terms, the name of the endpoint environment
variable and selected operating limits. For example, `endpointEnv` names
`GETBLOCK_STELLAR_RPC_URL`; its value belongs in the operator's existing secret
manager or private service environment, never in the plan. The plan does not
accept a raw provider URL, token, header credential, arbitrary RPC method or
transaction-submission operation.

At startup, the trusted generated handler resolves the variable once. It accepts
the exact dashboard URL with a final slash:

```
https://shared.eu-central-1.getblock.io/<ACCESS-TOKEN>/
https://shared.us-east-1.getblock.io/<ACCESS-TOKEN>/
https://shared.ap-southeast-1.getblock.io/<ACCESS-TOKEN>/
```

Use the endpoint selected for **Stellar mainnet JSON-RPC** in the dashboard.
Current GetBlock documentation retires `go.getblock.io` and places this RPC token
in the path. Credentials in headers, URL userinfo, query strings, extra paths,
redirects and arbitrary hosts are not accepted by this integration. The three
shared-node regions above are the selected deployment scope.

Run the explicit diagnosis before connecting the merchant's HTTPS gateway:

```sh
node stellar/scf-starforge-20261009/partners/getblock-stellar/cli.mjs diagnose \
  --plan /private/getblock/stellar-reads-v1/plan.json
```

This makes `getNetwork`, followed by `getHealth` only after the network matches
Stellar mainnet. It returns the observed ledger range, region and timestamp, with
no URL or credential. It exits unsuccessfully on an unavailable provider, wrong
network or unhealthy response. These are operator-requested provider reads;
their normal account usage applies. Preparation, release staging and buyer
review do not run this diagnosis implicitly.

## Four selected read contracts

The public merchant routes use HTTP POST with a JSON **params object**, without
a JSON-RPC envelope. The handler fixes the RPC method from the route, creates its
own request ID and adds `xdrFormat: "base64"`. It checks the returned ID and
envelope, then returns the original `result` object. Buyers cannot change the
provider method, origin, path token or authentication headers.

| Public route | Parameters | Selected bounds and meaning |
| --- | --- | --- |
| `/stellar/getTransaction` | `hash`; optional `xdrFormat: "base64"` | Lowercase 64-character transaction hash. A valid result can be `SUCCESS`, `FAILED` or `NOT_FOUND`. |
| `/stellar/getTransactions` | `startLedger` **or** `pagination.cursor`; optional `pagination.limit`, `xdrFormat` | The start ledger is inclusive. The provider maximum is 200 records; this product defaults to 50. A cursor excludes `startLedger`. |
| `/stellar/getEvents` | `startLedger` **or** `pagination.cursor`; optional `endLedger`, `filters`, `pagination.limit`, `xdrFormat` | End ledger is exclusive and greater than start. A cursor excludes both ledger bounds. Default page is 100, default merchant cap 500, configurable up to the documented provider maximum 10,000. |
| `/stellar/getLedgerEntries` | `keys`; optional `xdrFormat` | One to 200 distinct canonical base64 LedgerKey values, each at most 4,096 characters. Returns found entries in the latest available ledger state. |

Every event filter contains only `type`, `contractIds` and/or `topics`. The type
is `contract` or `system`. There are at most five filters and five contract-ID
entries across the request. IDs are distinct within each filter; each filter
contains at most five topic filters. Each topic filter has one to four
segments, each a canonical base64 ScVal string or `"*"`. This selection supports
the documented simple topic syntax; compound matchers are outside its contract.
Contract IDs have the Stellar contract StrKey shape. RPC remains authoritative
for StrKey checksums, XDR semantics and the currently retained ledger window.

The original live-schema admission checks object shapes, allowed top-level
fields and sizes before payment. The partner admission checks nested filter
fields, hexadecimal/base64 formats, duplicates, cursor/window relationships and
page bounds in that same stage. The event filter description carries its nested
contract within the existing discovery compiler's metadata depth limit.
An application rejection returns HTTP `422` without entering verification.

Use the current `oldestLedger` and `latestLedger` from diagnosis, or an actual
cursor returned by the preceding read. OpenAPI's zero hash, zero-account key and
ledger `1` are input-format examples, not current chain observations. Retention
belongs to the selected provider; this adapter does not promise historical data
outside the observed range.

Next-page example, using the actual returned cursor:

```json
{"pagination":{"cursor":"REPLACE_WITH_RETURNED_CURSOR","limit":25}}
```

A page is one purchase. Clients keep the returned cursor, omit ledger bounds
when continuing and deduplicate events using their original IDs. The adapter
does not auto-page, resubmit, retry or aggregate hidden paid reads.

## Native merchant and release operations

`RUN.md` provides ready commands for both original launchers. Use the original
SF82 pilot when running a service with saved startup/restart settings, or the
original `sf30-seller-sdk/operations/merchant-launch.mjs` for its native SF98
outbox and local fulfillment dashboard. Choose one launcher for a listener.
Both load the generated `handlers.mjs` and `compiled/seller-service.json`; both
use the operator's explicit facilitator and the original native x402 SDK.

The generated entry contains the complete secret-free plan and imports this
application module from the original checkout. Changing prices or methods
creates a new package. Original SF82 releases take its `openapi.json`,
`selections.json`, `route-bindings.json` and trusted `handlers.mjs` through
`stage --spec ... --config ... --bindings ... --handlers ...`. The package is
not the generic API workspace format accepted by `stage --workspace`.

SF82 retains its native generation checks, price/method comparisons, activation
and rollback. It pins the trusted entry file and saved source inputs. Keep the
transitive source checkout immutable as required by the original release
workflow. An active process retains its launched plan and credential. Stop and
restart it after rotating the environment value; the new process reads the new
token without rewriting public artifacts or historical offers.

The backend uses the original public-DNS check, HTTPS certificate verification,
one socket exchange, cancellation, decompression limits and a shared capacity
budget across all selected operations. Default limits are 10 seconds per upstream
call, 1 MiB response and eight concurrent backend calls. The original upstream
availability admission handles transport outages and capacity; it performs no
background probes or automatic retries. RPC rejections remain visible in
application results and counters and are not treated as HTTP transport outages.

The handler checks JSON-RPC envelopes as well as HTTP status. A provider HTTP
200 containing an RPC error becomes a failure response. Error `-32602` maps to
HTTP `422`; other RPC errors map to `502`. Only the integer code is released,
never provider error text or `error.data`. Malformed IDs, envelopes, result shapes
and oversized result lists return `STELLAR_RPC_RESPONSE_INVALID`. An unexpected
successful response containing the actual path token is rejected with
`STELLAR_RPC_RESPONSE_PRIVATE`.

These application failures enter the original merchant's cancellation/failure
path. Actual settlement headers describe the result of that original native
flow. A read of a failed or absent chain transaction is a valid successful
lookup; its `status` is not used as a payment-settlement claim.

The application snapshot contains region, configured data network, original
transport counters and per-method request/success/failure counts. It retains no
endpoint, credential, request values or response bodies. The normal native
merchant observer and operator dashboard continue to report the original
merchant routes and settlement lifecycle. Public offers, OpenAPI, generated
buyer metadata and release configuration exclude the private provider endpoint
and its token.

## Hand the exact request to the original buyer

Write actual parameters to a private JSON file, then select one prepared method:

```sh
node stellar/scf-starforge-20261009/partners/getblock-stellar/cli.mjs buyer \
  --package /private/getblock/stellar-reads-v1 --method getEvents \
  --body-file /private/getblock/events-request.json \
  --intent-id YOUR_STABLE_PURCHASE_ID --out /private/getblock/events-review.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/getblock/events-review.json
```

This calls the original SF88 preparation function with the selected original
offer, price and private request file. The resulting review retains its source
offer and original method/recipient/network terms. It has no signer or automatic
spend permission. Continue through the existing [native buyer workspace](../../sf88-operator-buyer-cli/README.md)
or the operator's established signer and spend journal. The buyer still obtains
the live challenge and applies its native approval/reservation path.

After an uncertain payment or interrupted response, reconcile the original
buyer operation and merchant record. Do not create a fresh intent to force the
same purchase through. Dataset ingestion uses the returned cursor and original
event IDs; archival and downstream processing remain the customer's application.

## Primary references

- [GetBlock Stellar methods and current shared-region endpoint examples](https://docs.getblock.io/api-reference/stellar-xlm)
- [GetBlock current endpoint and authentication index](https://getblock.io/llms.txt)
- [Stellar getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction)
- [Stellar getTransactions](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransactions)
- [Stellar getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents)
- [Stellar getLedgerEntries](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries)
- [Stellar getNetwork](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork)

Method limits and current endpoint form were checked against these first-party
sources on October 11, 2026. Deployment of an operator-owned GetBlock endpoint,
actual paid requests and any commercial engagement are separate operational
events recorded by their original systems.
