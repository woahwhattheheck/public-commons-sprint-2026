# Stellar RPC merchant

Sell selected Stellar RPC reads through the existing native seller, buyer and
operations workspace. Each selected method becomes one priced `POST` route at
`/stellar/METHOD`. Buyers send that method's parameters as a JSON object; the
merchant supplies the fixed JSON-RPC method and correlation ID and preserves the
provider's successful response bytes.

The adapter includes the whole operator path: review public terms, prepare the
original merchant package, check the selected data network, start the seller,
prepare a buyer request, inspect delivery, and pause or resume selected products
with the original persistent availability controls.

For a retained browser workflow, open the [merchant workspace](workspace/README.md):

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/jsonrpc/cli.mjs workspace \
  --dir /absolute/private/rpc-workspace --create --plan /absolute/private/rpc-plan.json
```

The same installed command is `starforge jsonrpc workspace`. The workspace
keeps exact imported plans, immutable saved versions, product/price comparisons,
original prepared packages, explicit provider diagnoses and buyer reviews.
Choose the runtime mode in its launcher to start the same original merchant
and operations desk from the selected saved review, then drain and reopen the
retained workspace.

## 1. Choose the product and payment terms

Run these commands from the source checkout with its existing Node and native
seller dependencies installed:

```sh
RPC=stellar/scf-starforge-20261009/sf30-seller-sdk/jsonrpc/cli.mjs
install -d -m 700 /srv/stellar-rpc
node "$RPC" template > /srv/stellar-rpc/plan.json
```

The adjacent [example-plan.json](example-plan.json) is a three-product starting
point. Replace the origin, recipient, asset contract and every price before
inspection. Prices are positive integer **strings in the selected asset's atomic
units**. Use the merchant's actual payment terms; the example has deliberately
unfinished values.

`dataNetwork` selects `stellar:testnet` or `stellar:pubnet`. `payment.network`
identifies the network on which the buyer pays. Review both explicitly; a
testnet-priced demonstration can read a different declared data network. The
merchant compares the provider's `getNetwork` passphrase with `dataNetwork`
before opening its listeners.

Choose only the methods and per-request prices the merchant intends to sell:

| Method | Buyer body | Returned data and request limits |
| --- | --- | --- |
| `getTransaction` | `hash`; optional `xdrFormat:"base64"` | One lowercase 64-character transaction hash. `SUCCESS`, `FAILED` and `NOT_FOUND` are valid lookup outcomes. |
| `getTransactions` | `startLedger` or `pagination.cursor`; optional `pagination.limit` | Transaction history; maximum 200 records per page, default 50 or the configured lower maximum. |
| `getEvents` | Ledger window or cursor, optional filters and limit | Contract/system events; default 100 per page, configured maximum 500 by default and at most 10,000. |
| `getLedgerEntries` | `keys`; optional `xdrFormat:"base64"` | Current ledger state; 1–200 distinct canonical base64 LedgerKey values, subject to the configured maximum. |
| `getLedgers` | `startLedger` or `pagination.cursor`; optional `pagination.limit` | Ledger history; maximum 200 records per page, default 50 or the configured lower maximum. |
| `getFeeStats` | `{}` | Current inclusion-fee statistics. |
| `getHealth` | `{}` | Node health and available ledger window. |
| `getLatestLedger` | `{}` | Latest known ledger identity and sequence. |
| `getNetwork` | `{}` | Selected network passphrase and protocol version. |
| `getVersionInfo` | `{}` | RPC server version information. |

Requests use named parameter objects. This product fixes XDR-bearing responses
to base64 so the buyer can decode them with its existing Stellar SDK. The event
filter profile supports `system`/`contract`, up to five filters and five contract
IDs across the request, and up to five topic alternatives with one to four
base64 ScVal or `*` segments. The profile's OpenAPI and prepayment admission
describe the exact selected subset of the Stellar methods.

For a first history page, select an actual `startLedger` within the provider's
current retained window. `getEvents.endLedger` is exclusive. For subsequent
pages, use the returned `pagination.cursor` and omit the ledger bounds. Each
page is a separately priced request. The zero hash and ledger 1 in generated
schema examples illustrate input shape; use actual observed identifiers when
preparing a purchase.

```sh
node "$RPC" inspect --plan /srv/stellar-rpc/plan.json
node "$RPC" prepare --plan /srv/stellar-rpc/plan.json \
  --out /srv/stellar-rpc/prepared-v1
```

`inspect` and `prepare` operate offline. Preparation creates a new private
directory containing `plan.json`, `openapi.json`, `selections.json`,
`route-bindings.json`, `seller-offers.json`, a trusted `handlers.mjs`, the
original SF61 `compiled/` output, and an executable-command guide in `RUN.md`.
Its parent directory must already be private, and the destination must be new.
Retain that package and its complete immutable source checkout for the release.

## 2. Supply the original provider connection

`endpointEnv` names the environment variable containing the complete provider
RPC URL. Supply its value through the service's existing private environment or
secret manager. A URL with an API key in its path stays in the launch-time
connection; the plan contains only the variable name.

The endpoint is a canonical public HTTPS URL with a fixed path, separate from
the merchant's origin. Query strings, fragments, user-info and buyer-selected
destinations are outside this connection contract. Normal launch reuses the
original upstream DNS, TLS, redirect, timeout, response-size and concurrency
handling. Local development can explicitly select
`--allow-loopback-upstream` for a local provider.

Providers using credential headers can add the original declaration:

```json
"headerEnv": { "Authorization": "STELLAR_RPC_AUTHORIZATION" }
```

The named variable holds the complete header value. The original `oauth2`
declaration is also supported; use the existing
[upstream authentication guide](../UPSTREAM.md) and the same provider's actual
client-credentials configuration. OAuth owns its authorization header. Caller
payment headers and cookies are not forwarded to the provider.

```sh
node "$RPC" diagnose --plan /srv/stellar-rpc/prepared-v1/plan.json
```

Diagnosis makes one `getNetwork` and one `getHealth` provider read and prints
network, protocol and retention metadata. These use the provider account's
normal request allowance. Repeated diagnosis commands are new processes and
make new reads. Use the reported `oldestLedger`/`latestLedger` to prepare a
current history request.

The response contract follows the current
[Stellar RPC API](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods).
In particular, `getTransaction` includes a numeric `latestLedger` and the queried
`txHash`; current health includes the ledger window. Some provider documentation
still illustrates earlier response formats. Confirm that the selected endpoint
serves the current API when qualifying a deployment. The original response
contract validates the actual returned envelope before accepting a successful
product result.

## 3. Run the merchant and its private desk

Use the same prepared plan, a stable merchant HTTPS origin, and separate private
state directories. Put the public merchant hostname behind the deployment's
existing HTTPS ingress while preserving `/stellar/*` and original discovery
paths. The seller and operations listeners bind locally.

```sh
node "$RPC" serve --plan /srv/stellar-rpc/prepared-v1/plan.json \
  --facilitator https://YOUR_ACTUAL_FACILITATOR \
  --port 8423 --operations-port 8424 \
  --availability-dir /srv/stellar-rpc/availability \
  --history-dir /srv/stellar-rpc/history --history-days 90 \
  --state /srv/stellar-rpc/delivery
```

`--state` attaches the original native delivery outbox and requires the selected
facilitator. Availability uses the existing Linux `flock` single-writer policy.
The operations desk retains the original seller's outcomes and in-flight work.
Capacity defaults to 64 admitted seller requests; each selected RPC binding
defaults to eight provider requests. `--max-in-flight` and
`--drain-grace-ms` configure the original seller lifecycle.

For a challenge preview, replace the facilitator and delivery-state options
with `--challenge-only`. Both modes verify the data network with one provider
read at startup. Challenge mode displays the original payment offers; the paid
delivery path uses the native facilitator mode above.

Startup reports the original discovery and operations URLs, including the
availability desk and its private control URL. Keep the operations listener
private. Open the merchant's `/_seller/docs` explorer for public requests and
offers. Changing an environment variable does not change a running connection:
drain and restart the merchant with the new provider value, the same plan and
the same state directories.

## 4. Prepare and run the original buyer workflow

Save the actual **params object** to a private request file. For a transaction
read it contains `{"hash":"ACTUAL_64_CHARACTER_LOWERCASE_TRANSACTION_HASH"}`.
For a metadata product it contains `{}`. The merchant supplies `jsonrpc`,
`method` and `id` on the provider request.

```sh
node "$RPC" buyer --package /srv/stellar-rpc/prepared-v1 \
  --method getTransaction --body-file /srv/stellar-rpc/request.json \
  --intent-id YOUR_STABLE_PURCHASE_ID \
  --out /srv/stellar-rpc/buyer-review.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /srv/stellar-rpc/buyer-review.json
```

The buyer command applies the same selected input contract and prepares the
existing SF88 review configuration. Continue with that buyer's original native
workspace, signer selection, challenge review and purchase action. Preserve the
original intent and operation when reopening a delivery or reconciling a lost
response. Select a new intent for a deliberately new purchase or next page.

Successful delivery preserves the complete provider JSON-RPC envelope, including
the fixed correlation ID `sf30:METHOD`. Read the method result under `result`.
The original bytes retain large integer literals and extra result fields. A
transaction's `FAILED` or `NOT_FOUND` status describes chain data; merchant
payment and settlement status comes from the original buyer operation.

## 5. Operate, pause and recover

Use the returned private `availabilityControl` URL in
`SELLER_AVAILABILITY_URL`, then inspect the current revision and route IDs:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/availability/cli.mjs" status --url http://127.0.0.1:8424
node "$S/availability/cli.mjs" pause --url-env SELLER_AVAILABILITY_URL \
  --revision REVIEWED_REVISION --route REVIEWED_ROUTE_ID \
  --reason 'Provider maintenance'
```

Use `resume` with the next reviewed revision after restoring service. The same
desk supports selecting several products and reviewing recent changes. Pausing
rejects new requests before payment while admitted requests drain; sibling
products remain available. Saved pauses survive the original service's restart.
A stale revision returns a conflict with current state for deliberate review.
The [availability guide](../availability/README.md) describes the existing API,
CLI, retired route IDs and persistent policy.

| Observed outcome | Operator action |
| --- | --- |
| Invalid parameters (`422`) | Correct the selected params using the published schema and actual retained ledger window. |
| Network preflight fails | Confirm the endpoint, current provider API, access and `dataNetwork`; diagnose that same connection before restart. |
| Provider/RPC/result contract fails or times out (`502`/`504`) | Inspect the original operator outcome and provider status; retain the buyer's current operation while reconciling payment state. |
| Provider admission or capacity (`429`/`503`) | Inspect the existing upstream availability counters and retry delay, then deliberately select the next request. |
| Paused or draining product (`503`) | Read the existing private availability/lifecycle view and resume the intended route when service is restored. |
| Lost response or interrupted buyer | Reopen the original buyer operation and delivery record before starting another purchase. |

The optional `upstreamAvailability` plan section reuses the existing
[upstream health policy](../UPSTREAM_AVAILABILITY.md). It governs provider
admission separately from the operator's durable route pause. `SIGINT` and
`SIGTERM` use the original merchant close path: finish seller payment and
handler work, finish the operations observer, then release the upstream and
OAuth resources.

## Embedding and source composition

Import `startStellarRpcMerchant` from `merchant.mjs` for the combined listener
lifecycle. It accepts the plan, environment, original native factory and the
same availability/history/delivery options and returns the original seller
session plus `operations`, `application` and a combined `close()`.

Trusted existing hosts can use `createStellarRpcApplication` from
`application.mjs`. Await `verifyNetwork()` before admitting work, attach its
`config` and `handlers` to the original seller, and call `close()` after that
seller drains. `diagnose()` adds the original health read; `snapshot()` reports
current method/network/provider counters. The generated trusted handler entry
performs the network check before exporting its handlers and exports cleanup.

Keep the full SF30 source, original SF61 compiler, SF88 buyer and their existing
dependency closure together. `stellar.mjs` imports the already-released request
and admission functions from
`../../partners/getblock-stellar/product.mjs`; that module and its original
SF61 imports are required even when the selected provider is different.

The method contracts were checked against the official
[transaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction),
[transaction history](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransactions),
[events](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents),
[ledger entries](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries),
[ledgers](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgers),
[health](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth)
and [network](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork)
references. The source intentionally uses one existing payment engine,
provider transport, buyer review and operating lifecycle throughout.
