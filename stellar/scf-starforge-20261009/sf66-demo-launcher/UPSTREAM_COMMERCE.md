# Operate an existing HTTP backend through the native commerce session

An existing API merchant can use its original SF30 seller configuration and
declarative upstream bindings in the same retained commerce session as its
buyers. The original upstream application provides transport, admission,
availability, response contracts, optional read caching and durable POST
operations. The commerce session starts that application through the existing
native seller/facilitator and keeps the original buyer inbox and usage history.

Use the Node/Python installation, native SDK packages, facilitator configuration,
operator account and aggregate spending limits in [OPERATOR.md](OPERATOR.md).
The merchant keeps its real backend credentials and operation-ticket key in its
existing runtime environment. Review and preparation read their configured
variable names; values are captured by the original upstream factory at startup.

## Prepare the merchant's actual inputs

Keep the original seller and upstream JSON in a private directory. Follow
[the original HTTP upstream guide](../sf30-seller-sdk/UPSTREAM.md) for route,
method, path, query, credential and response configuration. Each handler name in
the seller must select its matching original binding. The same source can retain
ordinary static routes alongside those bound handlers.

For a durable POST, configure its matching idempotency admission and private
state directory using [the merchant operation guide](../sf30-seller-sdk/IDEMPOTENCY.md).
Issue the exact operation with the original `upstream-operation.mjs issue`
command and retain its private ticket file. This session imports that file; the
merchant's existing issuer remains responsible for the operation identity,
request binding and expiry.

The buyer body file contains the HTTP JSON body alone. For example, the issuer's
request description may contain method, URL, path values and a `body` object;
the buyer body file contains that object alone. Preserve the actual source URL,
query order and merchant-forwarded headers from issuance. Ticket files and body
files must be private regular files. Neither a ticket nor a wallet secret belongs
in the setup JSON.

This setup selects one actual POST from the merchant's saved configuration.
Replace all paths, route/intent IDs, account and budgets with the operator's
existing inputs:

```json
{
  "schema": "stellar-forge.commerce-setup.v1",
  "seller": {
    "config": "/private/merchant/seller.json",
    "upstreams": "/private/merchant/upstreams.json",
    "availabilityDirectory": "/private/merchant/product-availability",
    "facilitatorConfig": "/private/merchant/facilitator.json",
    "port": 8423
  },
  "operationsPort": 0,
  "operationControls": true,
  "operator": {
    "actor": "merchant-order-operator",
    "service": "merchant-orders",
    "python": "/usr/bin/python3",
    "payer": "REPLACE_WITH_ACTUAL_TESTNET_G_ACCOUNT",
    "secretEnv": "SCF_BUYER_SECRET",
    "totalAtomic": "200000",
    "dailyAtomic": "200000"
  },
  "purchases": [
    {
      "routeId": "create-order",
      "acceptIndex": 0,
      "intentId": "merchant-order-17",
      "method": "POST",
      "bodyFile": "/private/merchant/order-body.json",
      "ticketFile": "/private/merchant/order-ticket.json"
    }
  ]
}
```

The default ticket header is `x-merchant-operation`. If that binding configures
another header, add the matching lowercase `ticketHeader` to the purchase.
The original SF88 reader checks the private envelope and current expiry. A
selected idempotent upstream requires its ticket and matching header before a
workspace is created. The original merchant admission verifies the ticket's
HMAC and exact request when the request arrives.

Ordinary GET/HEAD/DELETE and JSON POST/PUT/PATCH upstreams use the original
six-method selection rules. A binding without merchant idempotency does not
require an operation ticket. All selected buyers still share the original one
workspace and aggregate SF36 budget.

For the maintained loopback order example, explicitly set
`"allowLoopbackUpstream": true` inside `seller` and use its actual
`http://127.0.0.1:PORT` backend origin. This retains the original upstream
transport's loopback option; it does not change the merchant's advertised public
HTTPS URL or the buyer's verified transport. Public backends use the original
public-HTTPS origin and DNS policy by default.

## Review, prepare and execute the same operation

From the original checkout:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs review \
  --config /private/merchant/setup.json --directory /private/order-commerce

node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs prepare \
  --config /private/merchant/setup.json --directory /private/order-commerce

node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs start \
  --directory /private/order-commerce/session
```

Review uses the original SF82 upstream-inspection export and SF30 compiler. It
checks the declared binding and route contract without importing an application,
resolving backend credentials, opening an operation ledger or making a request.
The result includes original payment terms, request/body identity and safe
ticket metadata. Preparation creates the original private workspace once and
copies the exact upstream declaration, bodies and ticket files into retained
private source. The original inbox snapshots each selected request and ticket.

Before startup, supply the merchant's named backend/operation-key variables and
the operator's existing buyer/facilitator variables through its normal private
environment. The original factory captures backend values once per session.
The retained source contains their names, not their values.

Use the original terminal's `review merchant-order-17` and
`execute merchant-order-17` commands. The original approval, reservation, signer,
buyer transport, merchant admission and native facilitator own the payment
journey. The backend's actual result is retained by the original response writer
with its byte count, digest and outcome. Setup and ticket issuance themselves
make no payment.

Read the original chain observation and saved-response result together. With a
response file enabled, its writer consumes the response stream and the original
evidence capture does not read that body again. The chain report can therefore
say `TRANSFER_VERIFIED_DELIVERY_UNCONFIRMED` while `outcome.responseFile` says
`SAVED` with the actual path, byte count and digest. Preserve both records: the
first reports the independently observed transfer, and the second records the
bytes delivered to this buyer. Neither a saved body nor the merchant operation's
`COMPLETE` state substitutes for a chain observation or settlement accounting.

For an installed merchant package, the same entrypoints are
`starforge commerce-setup` and `starforge commerce`. Use the original release
containing this workflow and its existing native dependencies. The original
package's commands forward the same arguments to these modules.

## Inspect and reopen retained state

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs inspect \
  --directory /private/order-commerce

node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs start \
  --directory /private/order-commerce/session
```

Reopen uses the retained seller, upstream and facilitator configuration and the
same original inbox. The original input delivery files can be archived after
preparation. A changed retained upstream declaration is rejected before launch;
deliberately changed merchant terms belong in a new prepared setup. Preserve
the previous operator ledger and merchant operation state for reconciliation.

The configured merchant operation directory stays at its existing private path.
It is not copied into a release or replaced by session initialization. Keep its
scope and operation-ticket key across ordinary restarts. The original GET/HEAD
cache and backend-availability counters retain their original process-lifetime
behavior; the durable operation ledger retains POST identities across restarts.
Shutdown drains original buyer and merchant work, closes the original upstream
cache controllers, then completes the existing operations history. An incomplete
cache drain contributes to the original session's incomplete-shutdown result.

## Reconcile the backend and buyer using their original records

With `operationControls:true`, the original commerce CLI prints the merchant
recovery capability URL at startup. Open that complete private URL to use the
[existing merchant recovery console](../sf30-seller-sdk/operations/MERCHANT_OPERATIONS.md).
The ordinary status view links to read-only merchant operations and does not
publish the recovery token. Reopen the private startup URL after a listener
restart or browser refresh.

Find the ticket's exact operation key, use the displayed backend key in the
merchant's actual order lookup, and import its recorded response or explicitly
permit one later attempt. The original request hash and generation govern that
decision. Inspecting or reconciling the merchant record makes no backend or
payment request. The original queue's `recover` command retains the buyer's
financial attempt; use its existing accounting workflow for an uncertain
payment. Merchant replay does not grant a free paid retry or create another
buyer intent.

Omit `operationControls` for the original read-only operations listener. Its
write capability is meaningful only for an idempotent upstream binding; the
existing traffic, history and export paths keep their original behavior.

### Pause products through the original availability desk

The optional `seller.availabilityDirectory` above retains the original
[product availability policy](../sf30-seller-sdk/availability/README.md) at its
existing private location. This option also applies to the session's configured,
Python and paid-file merchants. It is separate from the upstream binding's
backend-health circuit: the operator selects product IDs and a current policy
revision to pause or resume sales.

The CLI prints the original private `availabilityControlUrl` at startup. The
ordinary status view exposes only its read-only `availabilityUrl`. A paused
product rejects new requests before native payment handling, admitted work
drains, and the saved pauses survive a session restart with the same merchant
origin. The original seller owns the writer lease through shutdown. Reuse this
directory when reopening; initialization does not copy or reset its policy.

## Use an existing prepared buyer workspace

Operators who already have a reviewed SF88 configuration can retain it through
the original `commerce-cli.mjs init` command instead of creating another
workspace. In the existing commerce plan, add the private `upstreams` path and
optional `allowLoopbackUpstream` beside `seller.config`, keep the existing
facilitator choice, and list the original buyer `config` and `workspace` paths.
Use the same root `operationControls` flag when merchant reconciliation is
required. The original plan still supports its other merchant modes; upstream
bindings select the SF30 factory for this configured API merchant.
