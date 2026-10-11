# Prepare a merchant and its native testnet buyers

Use commerce-setup.mjs to turn an original SF30 seller configuration and explicit
purchase selections into a complete private operator session. It creates the
original SF88 workspace, its SF36 spending ledger and operator keys, the native
signer adapter, exact buyer request files, response destinations and the existing
SF66 commerce plan and inbox. The same original commerce CLI or console then
starts the merchant and executes the selected purchases.

Every prepared buyer uses **one shared workspace and spending ledger**. Adding
another request does not create another budget. The largest selected request
sets the single-operation ceiling; the operator explicitly supplies total and
daily ceilings. Each individual request retains its selected original price.
The original workspace currently binds one testnet asset and merchant recipient,
so select purchases sharing those exact terms.

## Inputs from the merchant and operator

Use the same Node 22.16+ / Python 3.11+ installation as the
[commerce session](COMMERCE.md). Native execution uses the original pinned
packages:

    npm install --ignore-scripts --no-audit --no-fund --no-save --package-lock=false @x402/core@2.28.0 @x402/stellar@2.28.0 @x402/extensions@2.28.0 @stellar/stellar-sdk@16.3.0

Keep the input JSON and body files private (0600) under an existing private
directory (0700). Use the actual:

- [SF30 seller configuration](../sf30-seller-sdk/README.md), including its public
  HTTPS origin, route IDs, prices and application or response source.
- [Native facilitator configuration](../native-facilitator/README.md), including
  its testnet RPC, existing fee-signer account, environment variable name, allowed
  assets/recipients and fee ceiling. The setup checks every advertised payment
  alternative against this backend's configured policy.
- Buyer public account, trusted operator identity, executable Python path,
  wallet environment variable name or trusted SEP-43 provider, and aggregate
  atomic spending limits.
- Deliberately selected route, payment-option index, stable intent, HTTP method,
  concrete path/query values and request body when the method requires one.

No wallet secret belongs in the setup JSON. The existing native signer reads
the named variable in the operator process during the original execution flow.
The facilitator loads its separately configured fee-signing variable on startup.
The setup command itself reads neither signing variable.

For example, this private setup file selects two real routes from the supplied
merchant. Replace the public account and all paths with the operator's inputs;
the routes and payment-option indexes must already exist in that merchant:

~~~json
{
  "schema": "stellar-forge.commerce-setup.v1",
  "seller": {
    "config": "/private/merchant/seller.json",
    "handlers": "/private/merchant/application.mjs",
    "facilitatorConfig": "/private/merchant/facilitator.json",
    "port": 8423
  },
  "operationsPort": 0,
  "operator": {
    "actor": "merchant-demo-operator",
    "service": "merchant-demo",
    "python": "/usr/bin/python3",
    "payer": "REPLACE_WITH_ACTUAL_TESTNET_G_ACCOUNT",
    "secretEnv": "SCF_BUYER_SECRET",
    "totalAtomic": "200000",
    "dailyAtomic": "200000"
  },
  "purchases": [
    {
      "routeId": "dataset",
      "acceptIndex": 0,
      "intentId": "merchant-dataset-20261011-01",
      "method": "GET",
      "query": {"region": "north"},
      "responseMaxBytes": 8388608
    },
    {
      "routeId": "update-record",
      "acceptIndex": 0,
      "intentId": "merchant-update-20261011-01",
      "method": "PATCH",
      "path": {"recordId": "record-42"},
      "bodyFile": "/private/merchant/update-record.json"
    }
  ]
}
~~~

Omit the handler path for a merchant using response, responseFile or responseAsset
routes. A route with a handler or application admission export requires its
trusted application module. Setup retains the same absolute module reference;
the original commerce session checks its digest and loads it at startup.

### Initialized Python applications

For an existing [Python merchant](../sf30-seller-sdk/python/README.md), use
`seller.python` instead of `seller.config` and omit JavaScript `handlers`:

~~~json
{
  "python": "/private/merchant/python.json",
  "facilitatorConfig": "/private/merchant/facilitator.json",
  "port": 8423
}
~~~

This object replaces only `seller` in the same setup file. Keep the explicit
operator identity, original shared spending limits and purchase selections.
Each selection's `routeId` is a public function name in that Python declaration;
its method, input and payment-option index must match the original compiled
offer. For a POST function, pass the actual private JSON input as `bodyFile`.
The merchant declaration's `python` executable selects its application runtime;
`operator.python` continues to select the existing buyer approval/governor
runtime.

The same `review` and `prepare` commands below accept this setup. They compile
the original declaration without importing Python, show its actual module
digest, lifecycle hooks and worker limits, and use the existing request builder
and original SF88 workspace for every selected purchase. Preparation retains a
normalized `python.json`, its derived `seller.json` for review, and an original
commerce plan with `seller.python`. The session's retained application digest
must still match the reviewed digest before the prepared workspace is published.
No application startup hook or wallet signing occurs during preparation.

Before serving, initialize and clean up the saved application deliberately:

    node stellar/scf-starforge-20261009/sf30-seller-sdk/python/merchant.mjs diagnose --config /private/new-commerce/session/python.json

Then use the same original session entry:

    node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs start --directory /private/new-commerce/session

The native merchant initializes its persistent workers before readiness and
closes their resources after its in-flight requests drain. Original inbox
outcomes, the shared SF36 budget, saved response files and usage history retain
their existing ownership. See [PYTHON_COMMERCE.md](PYTHON_COMMERCE.md) for
application identity, shutdown diagnostics and reopening after a source change.

For an existing external signer, replace secretEnv with signerProvider, an
absolute path to the existing trusted module. This is the original SF88
provider interface, using the same native SF103 adapter. The buyer RPC comes
from the selected facilitator configuration so both sides use the same explicit
network endpoint.

When the operator host requires its existing HTTP CONNECT proxy, add
`"httpsProxyEnv": "HTTPS_PROXY"` to operator. The original SF88 initializer
retains the variable name and exact merchant HTTPS origin. Each prepared buyer
inherits that same original transport profile. Supply the named environment
variable when running the session; use the environment name for a managed host
whose proxy port changes between processes. Review and preparation neither
resolve that variable nor contact the proxy. Hosts with direct public egress
can omit this option. Verified merchant TLS, origin pinning and the original
single signed request remain in effect.

## Review, prepare and start

From the original checkout:

    node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs review --config /private/setup.json --directory /private/new-commerce

The output shows the compiled original selected payment terms, actual request
URL and method, original ordered payment-option index, body byte count and
SHA-256, public payer/recipient, response destination and shared budgets.
It also shows the original facilitator's public configuration review.
This command creates no directory, ledger, network listener or payment attempt.

The input selections are passed through the original SF30 compiler, developer
request builder and path router. This preserves dynamic path values and repeated
query serialization. Where the merchant enables its original input admission,
the same pure schema check evaluates the supplied request. Examples in a
merchant's advertised schema are never used as request bodies or parameter
values.

Once the selected configuration is correct:

    node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs prepare --config /private/setup.json --directory /private/new-commerce

The destination must be new. Preparation uses the existing SF88 workspace
initializer once and creates the existing SF66 session. It opens no merchant
listener, imports no application handler and performs no wallet, RPC or
settlement operation.

The result includes ready-to-run command arrays with absolute paths:

    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --diagnose-workspace --dir /private/new-commerce/operator
    node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs start --directory /private/new-commerce/session

`commands.console` opens the same prepared `session` directory in the original
browser workspace instead of the foreground terminal. For Python applications,
`commands.diagnosePython` initializes and cleans up the saved application;
`commands.diagnose` continues to inspect the original buyer workspace.

Load the existing wallet and facilitator environment variables through the
operator's normal private environment before starting. The original inbox's
workspace option loads its three stored SF36 keys itself; manually copying or
exporting those keys is unnecessary.

At the original commerce terminal, use the exact intent from preparation:

    review merchant-dataset-20261011-01
    execute merchant-dataset-20261011-01
    status
    quit

Execution invokes the original SF81 approval and SF36 reservation, native SDK
signer, SF31 request, original merchant/facilitator and SF82 result. Read and
answer the original terminal prompt. Preparation does not create consent.
The same original browser console can open the prepared session directory.

## The six request methods

| Method | Explicit request body | Saved response |
| --- | --- | --- |
| GET | None | Enabled by default |
| HEAD | None | Bodyless; disabled |
| POST | Private UTF-8 JSON body file | Enabled by default |
| PUT | Private UTF-8 JSON body file | Enabled by default |
| PATCH | Private UTF-8 JSON body file | Enabled by default |
| DELETE | None | Enabled by default; an actual 204 remains empty |

The method must exactly match the chosen merchant route. Body files are copied
as their original bytes into the private setup and then snapshotted by the
original inbox. No JSON reformatting changes a signed request's bytes.
Each purchase keeps its explicit stable intent; the original inbox prevents
another execution attempt for a previously attempted intent.

Set saveResponse to false when a body is unnecessary. Otherwise the original
response writer saves each intent into a distinct file under responses, using
its existing 64 MiB limit and 30-second response timeout unless
responseMaxBytes / responseTimeoutMs explicitly override them. The original
saved-result metadata supplies the actual content type, byte count and digest;
the .bin filename does not assert a data format.

The review reports whether all selected prices fit the total budget. A smaller
aggregate budget is valid when the operator intends to choose a subset or use
the same workspace across days. Original SF36 enforces the actual remaining
total and daily limits for each purchase. The daily budget must cover any
individual selected purchase and cannot exceed the total budget.

## Public HTTPS and actual testnet deployment

Route the seller's configured public HTTPS origin to its chosen loopback port
using the existing operator ingress. Keep the operations console and operator
workspace local. The original buyer uses that public URL with verified TLS;
changing DNS or replacing its transport with a loopback payment adapter is not
part of preparation.

The seller's own original /_seller/ready, /_seller/offers and developer portal
show its running source and offer. The original commerce operations dashboard
keeps the actual merchant's traffic and retained usage history. After a native
purchase, retain its original buyer outcome, response result and transaction
reference; use the original SF86 chain capture and settlement accounting for
the recorded network and asset.

For an isolated testnet deployment, Stellar's
[network documentation](https://developers.stellar.org/docs/networks) describes
free Friendbot funding and funding additional accounts from the first account
with Create Account. Keep disposable keys private. Use the official SDK to
derive and operate the selected token, and label that token accurately:
native testnet XLM is distinct from Circle's testnet USDC. The
[Stellar asset contract guide](https://developers.stellar.org/docs/tokens/stellar-asset-contract)
explains how each SAC represents its original asset. This preparation command
uses the actual accounts, token contract and exact atomic prices supplied by
the operator.

## Reopen, custody and recovery

Inspect the prepared configuration and existing inbox without loading keys:

    node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs inspect --directory /private/new-commerce

Inspection checks the retained request/configuration bytes and opens the
original workspace and commerce inbox. The same start command reopens the
session. Its original operator ledger, request states, saved resources and
usage history remain in place.

The directory contains seller.json, facilitator.json, explicit request and
buyer files, commerce-plan.json, the original operator workspace and the
original session. prepared.json ties those inputs to their original source
digests and selected complete payment terms. Files are create-only and private.
An unsuccessful preparation removes only the new directory it created; an
existing workspace or destination is never replaced.

Use the original commerce recover command for a retained interrupted intent.
Do not generate a new intent to retry an uncertain payment. Reconcile the
original request against its existing reservation and recorded transaction.
To change merchant terms or request content, prepare a deliberate new setup
while retaining the previous ledger and evidence for that reconciliation.
