# Prepare and operate a Stellar RPC merchant

The original commerce setup accepts `seller.jsonrpc`, an existing
[Stellar RPC merchant plan](../sf30-seller-sdk/jsonrpc/README.md). It prepares
the selected read products, exact request bodies, native testnet buyer workspace,
shared spending limits, inbox and response files together. The existing commerce
CLI and browser console then operate that retained session.

Each launch creates a fresh instance of the original RPC application. It captures
the provider credentials from the current launch environment, checks the actual
RPC network before opening the seller, and closes the provider after the original
buyer, seller and operations work drains. Reopening retains the same requests,
offers, outcomes, response files, usage history and product availability policy.

## Select products and actual purchase inputs

Use the Node, Python and native SDK installation described in
[OPERATOR.md](OPERATOR.md). Keep input files private (0600) in an existing private
directory (0700). Start with the original RPC plan template and supply the actual
merchant HTTPS origin, asset contract, recipient and atomic prices:

```sh
umask 077
node stellar/scf-starforge-20261009/sf30-seller-sdk/jsonrpc/cli.mjs template \
  > /private/merchant/rpc-plan.json
```

The plan selects the RPC **data network** separately from its **payment
network**. The original commerce setup currently prepares native
`stellar:testnet` payments. The data provider may serve either declared Stellar
network. The payment facilitator and buyer continue using their own configured
testnet RPC.

For example, a merchant may select `getLatestLedger` and `getTransaction` in the
plan, each with an explicit positive `amountAtomic`. The public product IDs are
those exact method names and their HTTP routes are respectively
`POST /stellar/getLatestLedger` and `POST /stellar/getTransaction`.

Create a private body file for each selected purchase. A `getLatestLedger` body
contains `{}`. A `getTransaction` body contains `{"hash":"ACTUAL_64_HEX_HASH"}`
with an actual transaction hash on the plan's data network. The body contains
the RPC **params object**; the original application supplies the JSON-RPC
envelope, fixed method and request identity. The original selected method
validator checks these inputs during setup review and again on the live route.

This setup chooses one paid latest-ledger read. Replace the paths, public payer
and budgets with the actual operator inputs. Its route and payment option must
exist in the RPC plan:

```json
{
  "schema": "stellar-forge.commerce-setup.v1",
  "seller": {
    "jsonrpc": "/private/merchant/rpc-plan.json",
    "availabilityDirectory": "/private/merchant/product-availability",
    "facilitatorConfig": "/private/merchant/facilitator.json",
    "port": 8423
  },
  "operationsPort": 0,
  "operator": {
    "actor": "stellar-read-operator",
    "service": "stellar-read-products",
    "python": "/usr/bin/python3",
    "payer": "REPLACE_WITH_ACTUAL_TESTNET_G_ACCOUNT",
    "secretEnv": "SCF_BUYER_SECRET",
    "totalAtomic": "200000",
    "dailyAtomic": "200000"
  },
  "purchases": [
    {
      "routeId": "getLatestLedger",
      "acceptIndex": 0,
      "intentId": "stellar-latest-ledger-01",
      "method": "POST",
      "bodyFile": "/private/merchant/latest-ledger-body.json",
      "responseMaxBytes": 1048576,
      "requestTimeoutMs": 120000
    }
  ]
}
```

Add further explicit purchases to the same `purchases` array. They share one
original operator workspace and aggregate spending ledger; each keeps its own
intent, selected price, body digest and create-only response destination. A new
page of events, transactions or ledgers is a separate purchase with its selected
pagination parameters. Use a new intent for a deliberately new purchase.

Each purchase may select `requestTimeoutMs` as an integer from 1 through 300000.
This is the original buyer's complete HTTP exchange deadline, including DNS,
TLS, response headers and body consumption. The default is 30000 milliseconds.
The original request review, retained buyer configuration and attempt summary
preserve this selection. `responseTimeoutMs` controls the separate saved-body
capture deadline after the response returns. Allow enough request time for the
selected native payment and provider operation to finish; the example selects
120000 milliseconds.

`seller.jsonrpc` supplies the original application's handlers and admissions.
Choose that family alone in this setup. Optional
`seller.allowLoopbackUpstream:true` enables the original provider's explicit
loopback development mode. It preserves the merchant's advertised public HTTPS
origin and the buyer's original verified transport.

## Review and prepare retained source

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs review \
  --config /private/merchant/setup.json --directory /private/rpc-commerce

node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs prepare \
  --config /private/merchant/setup.json --directory /private/rpc-commerce

node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs inspect \
  --directory /private/rpc-commerce
```

Review compiles the original read profile and validates every selected request,
payment option and configured facilitator allowance offline. Its `jsonrpc`
summary reports the plan digest, data/payment networks, selected methods and
credential environment variable names. Preparation retains the exact reviewed
plan bytes as `session/jsonrpc.json`, derives `session/seller.json` through the
original SF61/SF30 compiler, and creates the existing SF88 workspace and inbox.

Keep the provider URL in the plan's named `endpointEnv` variable. This includes
providers whose API key is part of the URL path. Additional header and OAuth
credentials use the original plan's environment references. The plan and saved
session retain those names; provider values are captured at launch. Supply the
buyer and facilitator signing variables through their existing private runtime
environment too.

`inspect` returns the exact `commands.diagnoseJsonrpc` argument list for the
retained plan. Run that original diagnosis command in the configured provider
environment to check its network and health. This is separate from the commerce
console's native facilitator readiness check, which checks the payment network.

## Operate the existing console or terminal

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-console.mjs start \
  --directory /private/rpc-commerce/session
```

Open the complete private URL printed at startup. The existing merchant card
shows the RPC data network, provider verification time, selected read products
and accepted result count. Select the retained buyer, review its exact original
request and payment terms, and execute that selected intent. The original native
signer, facilitator and buyer own payment; the original response writer retains
the delivered JSON-RPC envelope bytes and digest. The console opens the same
saved response and original payment/accounting outcome.

The terminal is the same session with its existing commands:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs start \
  --directory /private/rpc-commerce/session
```

Use `review stellar-latest-ledger-01`, then
`execute stellar-latest-ledger-01`. The original inbox preserves completed or
uncertain attempts, and its recovery/accounting commands operate that same
record. Read the original chain result and the saved-response result together;
they record the payment observation and delivered bytes separately.

The optional availability directory enables the original
[product desk and CLI](../sf30-seller-sdk/availability/README.md). The commerce
launcher prints the private availability control URL once. Select exact product
IDs and the current policy revision to pause or resume. New paused-product
requests are rejected before payment; work already admitted follows the
original drain. Keep the same public origin and availability directory across
restarts.

## Reopen after a provider credential change

Close the running session through its original terminal or console and wait for
its shutdown result. The result includes `jsonrpc.closed` and the final original
RPC counters alongside the existing native, upstream and buyer results. A
provider close failure contributes to the original incomplete-shutdown error.

Update the provider variables through the operator's existing private runtime
environment, then start the same retained session again. A new original RPC
application captures those current values and checks the declared network before
the seller listens. The session never reuses a cached generated handler module.
Original input delivery files may be archived after preparation; reopening uses
the retained plan and exact derived offers.

Changed retained plan bytes are rejected by their saved digest. Changed derived
offers are rejected against the retained plan's original compiler result.
Deliberately changed methods, prices or public origin belong in a new prepared
setup, retaining the previous operator workspace for its original outcomes.

For trusted embedding, `initializeCommerce` also accepts `seller.jsonrpc` in
the existing commerce plan and `openCommerce` retains its original native
factory/environment options. Installed packages use the same `commerce-setup`,
`commerce` and `commerce-console` commands. The maintained distribution must include
`commerce-jsonrpc.mjs`, `commerce-jsonrpc-recovery.mjs`, this guide, the existing
commerce modules, the original `sf30-seller-sdk/jsonrpc` dependency closure and
the original SF88 missing-receipt recovery module with its SF36/SF43 workers.

## Recover an existing payment and its read result

A transport deadline can arrive after the payment has reached the network and
before the original response reaches the buyer. Keep that original intent and
its reservation. The console's recovery controls work on that retained attempt.

Open the same saved session, select the attempted purchase, and enter the
transaction hash for that original payment. **Verify existing payment** joins the
original attempt, configuration, request digest, body, workspace and reservation
through the original SF88/SF36 recovery path. The original Stellar verifier checks
the selected transaction against the recorded network, asset, payer, recipient
and amount. Its successful result appears as **Settled · response recovery
pending**. The original execution outcome remains available alongside the
separate finality record.

Choose **Recover paid read** to call the original provider with the same retained
RPC method and parameters. The original admission, network, private credential,
result schema and size checks apply. The product must be selling for a new
provider read. The original private response writer saves the exact returned
envelope bytes to the buyer's configured destination, and the existing preview
and download controls open that saved result.

The console shows the original request time and the recovery read time
separately. A mutable operation such as `getLatestLedger` returns its value at the
recovery read time. The saved capture records that timing, the original settled
transaction and request identity, and the new response's exact byte digest.

The terminal exposes the same operation:

```text
status
verify-rpc stellar-latest-ledger-01 TRANSACTION_HASH EXPECTED_REQUEST_SHA256
recover-rpc stellar-latest-ledger-01
```

Use the expected request digest shown for that retained attempt. Verification
also compares the current attempt and configuration identities before beginning.
The recovery command uses the successfully verified transaction already joined
to that original intent.

Each provider read has create-only metadata under the original job's
`rpc-response-recovery` directory. The capture retains its own start and response
times and is completed after the original response writer publishes the file.
If shutdown occurs between file publication and completion metadata, reopening
checks the existing file's size and complete digest and completes that same
capture. Reopening a completed capture performs zero provider reads.

Trusted embeddings use the opened session's
`verifyRpcPayment(intentId, {transaction, expectedRequestSha256,
expectedAttemptId, expectedConfigSha256})` and
`recoverRpcResponse(intentId, {transaction, expectedRequestSha256,
expectedAttemptId, expectedConfigSha256})`. The browser uses the original private
console origin and capability token. Admitted recovery operations participate in
the original session drain before the provider is closed.

The original finality worker starts its observer with a scrubbed environment.
Deployments using a system certificate store can select a trusted Node launcher
that starts the installed Node binary with `--use-system-ca`. Both original
start commands accept `--finality-node /absolute/trusted-node`; trusted embeddings
pass `finalityNode` when calling `openCommerce`. This executable is selected by
the local operator at startup. The default is the current Node executable.
