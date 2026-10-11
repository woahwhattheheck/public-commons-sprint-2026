# Native Stellar facilitator and self-facilitated seller

Run the official `@x402/stellar` fee-sponsoring facilitator as either a private
HTTP backend for the existing SF58 frontdoor or an in-process backend for the
original SF30 merchant service. The x402 SDK performs transaction parsing,
Soroban simulation, authorization verification, fee signing and settlement.
This directory supplies configuration, merchant policy, service admission and
shutdown; it does not replace that payment implementation.

For the complete host operating workflow, see [RPC readiness and shared signer
ownership](OPERATIONS.md): review and probe the configured RPC, start the same
service with private account ownership, inspect `/readyz`, then drain and restart.

## Install and configure

Use Node 22+ and install these pinned packages from the repository root so the
original SF30 sibling modules resolve the same dependency installation:

```sh
npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund \
  @x402/core@2.28.0 @x402/stellar@2.28.0 @x402/extensions@2.28.0 @stellar/stellar-sdk@16.3.0
```

Keep the following operator JSON outside the source repository, replacing the
address placeholders with the existing configured accounts and token contract.
Load the corresponding existing signing key into `SF_FACILITATOR_SECRET` through
the operator's normal process environment. The JSON contains an environment
variable name, never the signing secret itself.

```json
{
  "schema": "stellar-forge.native-facilitator.v1",
  "network": "stellar:testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "signers": [{"address": "EXISTING_G_ACCOUNT", "secretEnv": "SF_FACILITATOR_SECRET"}],
  "payments": {
    "assets": ["EXISTING_C_TOKEN_CONTRACT"],
    "recipients": ["EXISTING_MERCHANT_G_OR_C_ADDRESS"],
    "maxAtomic": "1000000"
  },
  "limits": {
    "maxTransactionFeeStroops": 50000,
    "inclusionFeeStroops": 100,
    "maxVerifyInFlight": 16,
    "maxSettleInFlight": 1,
    "drainGraceMs": 60000
  }
}
```

The network must be exactly `stellar:testnet` or `stellar:pubnet`. Pubnet also
requires an explicit HTTPS RPC URL. This service uses existing accounts; it has
no account creation, funding or key export command. Each loaded key must derive
the exact public signer address in the configuration. Payments must match the
configured network, exact scheme, allowed token contract and merchant recipient,
and the atomic amount cap. The payload's complete accepted terms must equal the
requirements passed to verification or settlement.

Optional `feeBumpSigner` has the same `{address,secretEnv}` shape and uses a
separate existing account for fee sponsorship. `maxTransactionFeeStroops` is the
total sponsored transaction ceiling. With fee bump enabled the runtime reserves
one additional inclusion fee before giving the ceiling to the native SDK; the
configured total must cover at least two inclusion fees. Integer atomic token
amounts and stroop fees are separate units. Every amount and fee ceiling is
explicit; this service does not choose a merchant price or a spending limit.

Review JSON without loading keys, then check actual SDK construction and its
native supported metadata:

```sh
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs --review --config /private/facilitator.json
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs --check --config /private/facilitator.json
```

Review prints the RPC origin, public accounts, configured environment names and
limits. Check reads the named signing variables and uses the real SDK. Neither
command requests chain data or submits a transaction with the original defaults.
The optional `operations.requireReady` policy adds the documented read-only RPC
probe to native construction. A successful configuration check establishes
loaded-account and protocol compatibility. Use `--probe` or `/readyz` for the
configured RPC's actual network, health and latest-ledger observation.

## Run the native backend

```sh
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs --serve \
  --config /private/facilitator.json --port 5101
```

The listener binds to `127.0.0.1`. `GET /supported` returns the native x402
`kinds`, `extensions` and `signers` metadata, including the original `stellar:*`
signer-family key. `POST /verify` and `/settle` accept the standard JSON envelope
with `paymentPayload` and `paymentRequirements` and optional `x402Version:2`.
The original SDK's `HTTPFacilitatorClient` consumes this interface directly.
HTTP 200 preserves the SDK result, including unsuccessful verification or
settlement. Local admission errors have non-2xx status and a stable error code.

Requests require the listener's exact loopback Host, and requests carrying a
browser Origin are rejected. Keep this backend private. To operate both ledgers,
start two processes with separate network/account configs and connect the
existing [SF58 frontdoor](../sf58-dual-network-frontdoor/README.md):

```sh
SF58_TESTNET_ORIGIN=http://127.0.0.1:5101 \
SF58_PUBNET_ORIGIN=http://127.0.0.1:5102 \
node stellar/scf-starforge-20261009/sf58-dual-network-frontdoor/server.mjs
```

Use SF58's existing gateway authentication and deployment settings for its
ingress. The native backend does not forward caller URLs, expose arbitrary RPC
operations or provide a browser wallet interface.

## Run the original seller in the same process

Use an existing `stellar-forge.seller-service.v1` merchant configuration and its
trusted application module. Every advertised payment option must fit this
facilitator's network, token, recipient and amount policy before startup succeeds.

```sh
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs \
  --seller /private/seller.json --config /private/facilitator.json \
  --handlers /private/application.mjs --port 8423
```

This starts the original SF30 service in `NATIVE_X402` mode with its existing
admission, route compiler, developer portal and native resource server. It uses
`createNativeSellerServer` with this backend as its `facilitatorClient`; there is
no second HTTP facilitator or alternate payment path. Application handlers,
imported offers and supported response types keep their original SF30 contracts.
Use the existing seller deployment tooling for HTTPS exposure.

The module API also exports `createNativeFacilitator(config)` and
`startSelfFacilitatedSeller({facilitatorConfig,config,handlers,port,availabilityDirectory})`.
The native client has async `getSupported`, `verify`, `settle`, `drain`, plus `status()`.
The seller returns the original server, URL, compiled routes and lifecycle,
along with `facilitator` and an idempotent combined `close()`.

Applications can opt into durable product pause and resume by passing an explicit
private absolute `availabilityDirectory`, such as `/srv/merchant/private/availability`.
The original SF30 validator checks this value before facilitator acquisition;
the original seller owns the directory, lease and policy for its configured service
origin. Keep a stable `publicOrigin` and reuse the same directory across restart.
The selected directory requires Linux `flock` and private filesystem permissions.

The returned `seller.availability` is the original controller. Compose that same
seller with `startSellerOperations` from `../sf30-seller-sdk/operations/server.mjs`
to open the existing private availability desk and CLI. A pause rejects new requests
for the selected product before payment while admitted work finishes; offers and
public product metadata stay available. Use the displayed revision when changing
policy, and retain the existing combined `seller.close()` ownership so seller work
finishes before the facilitator drains. The complete [availability operator guide](../sf30-seller-sdk/availability/README.md)
provides startup, private control URLs, revision-guarded CLI commands and restart
instructions.

## Capacity, shutdown and operations

Settlement capacity defaults to one operation. To serve concurrent purchases,
configure distinct existing source accounts and set `limits.maxSettleInFlight`
to an integer from `1` through the number of those accounts (at most `32`). Each
accepted native settlement reserves one available account until its original SDK
call finishes. Selection rotates through the configured accounts and skips those
already in flight. The SDK receives that call's reserved account after its awaited
verification; it still checks every configured signer and fee-bump address through
one complete native safety set. There is no automatic retry or payment queue.

The composed seller uses the same capacity in its original SF30 lifecycle before
executing an application. A long-running request therefore occupies one merchant
request slot; its signing-account slot is reserved when native settlement starts.
Verification keeps its separate `maxVerifyInFlight` limit. Configure that limit
for the merchant workload as well. Raising capacity does not change a transaction's
amount or fee ceiling, and actual throughput still depends on the RPC, ledger,
account balances and application. See the [complete account-capacity rollout](OPERATIONS.md#increase-native-settlement-capacity)
for review, startup, observation, drain and restart.

Use the shared ownership directory in [OPERATIONS.md](OPERATIONS.md) for native
facilitators on the same host. Overlapping configured signing accounts then have
one active process per network, including a fee-bump account. Distinct fee accounts
allow independent services; assign separate accounts to separate hosts.
Standalone HTTP callers receive `FACILITATOR_BUSY` at capacity. They should
reconcile their original operation before deciding to retry settlement.

SIGINT/SIGTERM stop admission and wait for accepted work. The seller closes before
its facilitator; the native HTTP listener also includes incomplete-header TCP
connections in its shutdown deadline. A forced shutdown returns `drained:false`
and exits with status 2. It cannot undo a transaction that the native SDK has
already submitted. Use the existing SF86 chain capture and merchant settlement
accounting against that original operation before another payment attempt.

Status counters distinguish native calls, verification refusals, settlement
refusals and thrown SDK errors. They are process-local operational counts, not
payment or revenue totals. `/healthz`, `status()` and CLI startup expose the
configured `settlementConcurrency`, currently available admission slots and each
public source account's `AVAILABLE` or `IN_FLIGHT` state. In-flight accounts include
their admission time; request contents and signing material stay private. Adapter HTTP errors omit raw provider exceptions;
upstream SDK stderr remains the upstream SDK's logging behavior and should be
handled by the operator's existing private log collection.

## Focused executable check

```sh
node stellar/scf-starforge-20261009/native-facilitator/acceptance.mjs
```

This executes the installed official SDK, its actual HTTP client, and the
original SF30 native seller. It checks supported metadata, native malformed
payment refusals, merchant policy, private transport, the real v2
`PAYMENT-REQUIRED` header and orderly close. Its deterministic unfunded fixture
identities are only for this local journey. It makes no chain request or payment.
Actual deployment uses existing operator accounts, a reachable configured RPC
and the merchant's original transaction reconciliation workflow.

Native API references: [x402 facilitator](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/facilitator/x402Facilitator.ts),
[exact Stellar facilitator](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/exact/facilitator/scheme.ts),
and [Stellar signer](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/signer.ts).


## Choose the merchant payment timing

The operator profile now has an optional `payments.paymentFlows` allowlist. Omitting it retains the existing authorization profile. Select either native timing or enable both explicitly:

```json
"payments": {
  "assets": ["YOUR_EXISTING_ASSET_CONTRACT"],
  "recipients": ["YOUR_EXISTING_MERCHANT_ADDRESS"],
  "maxAtomic": "10000",
  "paymentFlows": ["authorization", "upfront"]
}
```

Keep the original asset, recipient and amount for the deployment. The example placeholders must be replaced by the operator's existing configured addresses. The list must contain one or two distinct values from `authorization` and `upfront`; an empty list, `null`, duplicates and other values are rejected during offline review.

With authorization, the native merchant verifies the buyer authorization, prepares the complete permitted result, then settles and releases it. With upfront, the native merchant settles before starting fulfillment, so it can deliver a finite stream as it arrives. An interrupted upfront response can retain a successful payment and partial output; the buyer's existing payment and output views show those separately. The choice changes when the same original SDK transfer is settled. Native payload validation, amount, recipient, network, signer safety, fees and receipts remain in the SDK.

The existing `review` command exposes `payments.paymentFlows`. Current status exposes `paymentFlows`. The existing `/supported` response preserves its original SDK kinds, sponsored-fee setting, signer addresses and extensions and adds `kinds[*].extra.paymentFlows` for this backend's supported Stellar kind. That array is advisory Starforge operator policy; the native quote still carries one `extra.paymentFlow`. Clients and external merchants should choose a declared timing. The runtime enforces the allowlist before SDK work is admitted.

The in-process merchant refuses an advertised quote outside this profile at startup with `SELLER_FLOW_OUTSIDE_FACILITATOR_POLICY`. The original SF66 customer setup rejects the same mismatch during offline review with `COMMERCE_SETUP_PAYMENT_FLOW_OUTSIDE_FACILITATOR`, before a workspace or listener is created. All advertised options must fit the backend, including options the current customer did not select. An upfront customer selection must also explicitly select `paymentFlow: "upfront"` in the existing setup purchase; the original signer pins preserve that choice.

To change a running profile, complete the existing drain and original payment reconciliation, edit the trusted configuration, review it, and reopen the same deployment through its normal startup. Use the operating procedure in [OPERATIONS.md](OPERATIONS.md#change-the-allowed-payment-timing).
