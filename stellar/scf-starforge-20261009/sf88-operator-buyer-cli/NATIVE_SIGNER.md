# Native Stellar signer for an approved buyer operation

SF88 can now execute with the official Stellar SDK directly. The operator chooses
a runtime key or existing wallet integration, reviews the public payer and quote,
then uses the existing SF81 terminal approval and SF36 budget reservation. SF31
continues to make the unsigned request and its single signed retry; SF82 records
the outcome and performs the existing independent testnet checks.

The adapter uses official `x402Client`, `ExactStellarScheme` and
`createEd25519Signer`. It pins `@x402/core` and `@x402/stellar` to **2.28.0** and
checks the installed versions at runtime. Review, discovery and preparation
remain available without those optional execution dependencies.

## Install the execution dependencies

From the repository root, using Node 22 or later:

```sh
npm --prefix stellar/scf-starforge-20261009/sf88-operator-buyer-cli ci --ignore-scripts --no-audit --no-fund
```

The package has no install scripts, build command or default test runner. Keep the
lockfile with the original source when preparing an operator checkout.

## Choose a runtime source

Start with the original reviewed SF88 operation, operator policy/ledger and
evidence directory. Replace its `signerModule` property with one `nativeSigner`
configuration. Both properties together are rejected. `operation.expect.network`
selects the signing network, so a second network field cannot drift independently.

For an existing secret supplied to the process environment:

```json
{
  "nativeSigner": {"secretEnvironment": "SF88_STELLAR_SECRET"},
  "trustedPayer": "THE_REVIEWED_PUBLIC_STELLAR_ACCOUNT"
}
```

This is a configuration fragment with an illustrative public-account placeholder.
Keep the complete original `operation`, `operator` and `evidenceDir` settings.
Supply the environment value through the operator's existing credential facility.
The configuration stores its variable name only. During explicit execution,
the official `createEd25519Signer(secret, network)` derives the public account;
it must equal `trustedPayer` before any RPC or signing callback.

For an established wallet or smart-account integration:

```json
{
  "nativeSigner": {"walletModule": "/private/operator/stellar-wallet.mjs"},
  "trustedPayer": "THE_REVIEWED_PUBLIC_STELLAR_ACCOUNT"
}
```

That trusted local module exports:

```js
export async function createSigner({network, rpcUrl}) {
  // Connect to your existing wallet through its maintained integration.
  // Return its official ClientStellarSigner, with address and signAuthEntry.
}
```

`createSigner` must return a supported SEP-43 signer. Its `signAuthEntry` method
signs the supplied authorization entry; it must not submit a transaction itself.
The adapter fixes the returned public address and callback for the operation.
Account changes require constructing a new signer and reviewing that payer.
The wallet module is executable trusted operator code and is loaded only for
`--execute`. `--diagnose` checks that the file exists without importing it.

Exactly one `secretEnvironment` or `walletModule` is required. This source
selection creates no account and stores no private key, authorization payload or
wallet data in the configuration.

## Network and RPC

Supported networks are `stellar:testnet` and `stellar:pubnet`. Testnet uses the
official SDK's canonical RPC by default. Pubnet requires an explicit `rpcUrl`:

```json
"nativeSigner": {
  "secretEnvironment": "SF88_STELLAR_SECRET",
  "rpcUrl": "https://your-operator-selected-stellar-rpc.example"
}
```

HTTPS is required except for explicit `http://127.0.0.1` or `http://[::1]`
testnet RPC endpoints used by a local operator. URL credentials and fragments
are rejected. The public review displays the RPC origin only; private service
tokens in a configured path or query are not printed. The official SDK also
reads canonical Horizon for its estimated ledger interval, independently of a
custom RPC, and uses its native fallback when that estimate is unavailable.

The configured account and selected token need the balance and trustline required
by the actual native transfer simulation. The signer does not fund accounts or
establish trustlines automatically.

## Inspect, review and execute

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --diagnose --config /private/pilot.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --review --config /private/pilot.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs --execute --config /private/pilot.json
```

Diagnosis checks the pinned SDK exports, source presence and configured public
payer. It makes no RPC request, imports no wallet module and does not read or
validate the secret's value. `READY_TO_LOAD_SIGNER` describes setup availability;
the account and real network are checked during execution. A missing dependency,
source or payer produces `SETUP_REQUIRED` and exit status 1.

Review displays the exact operation, caps, body digest, public payer, network and
source name. It neither loads the SDK dependencies nor reads credentials. The
existing terminal workflow approves the current seller challenge during execution.

Before native signing, the adapter compares all accepted terms with SF31's
approved immutable intent and finds exactly one matching option in the original
challenge. It checks the original resource, network, asset, recipient, positive
i128 amount, timeout and atomic cap. `extra.areFeesSponsored` must be `true`;
only the native authorization flow is accepted.

The official client's per-asset atomic limit is set from `intent.maxAtomic`.
Its default dollar limit cannot silently replace the operator's approved cap.
The canonical SDK builds and simulates the SEP-41 transfer, obtains the wallet's
authorization entry signature, then simulates the result. The returned v2 envelope
must preserve the approved option, resource and extensions before SF31 can send it.

## Operational errors

| Code | Operator action |
| --- | --- |
| `NATIVE_X402_SDK_UNAVAILABLE` | Install the pinned dependencies in this SF88 directory. |
| `NATIVE_X402_SDK_VERSION_MISMATCH` | Restore the included lockfile and pinned SDK versions. |
| `NATIVE_SECRET_ENVIRONMENT_MISSING` | Supply the configured variable through existing runtime custody. |
| `NATIVE_SECRET_KEY_INVALID` | Correct the key source; no raw key or SDK exception is printed. |
| `NATIVE_WALLET_FACTORY_REQUIRED` | Export `createSigner` from the trusted wallet module. |
| `NATIVE_SIGNER_PAYER_MISMATCH` | Reconcile the configured public payer with the selected wallet. |
| `NATIVE_SIGNER_AUTHORIZATION_SPONSORSHIP_REQUIRED` | Review the merchant's actual supported scheme and fee terms. |
| `NATIVE_STELLAR_PAYLOAD_FAILED` | Inspect the original operation and native RPC/wallet state before any further attempt. |

The signer creates the payment payload; it does not send the seller retry or
submit a ledger transaction. A signed payload alone does not establish settlement.
Existing SF31, SF36 and SF82 reports remain the source for transport, reservation,
settlement and returned-resource outcomes. Use their existing reconciliation
procedure after an uncertain attempt; the adapter installs no retry loop.

## Official source

- [Stellar x402 quickstart](https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide)
- [Official x402 Stellar implementation](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/stellar)
- [Official core client](https://github.com/x402-foundation/x402/tree/main/typescript/packages/core)

The grant and commercial owners can use this as an implemented native signer
connection. Deployment, merchant acceptance and received revenue continue to
depend on their actual external outcomes.
