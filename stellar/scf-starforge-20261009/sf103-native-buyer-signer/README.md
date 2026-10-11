# SF103: native Stellar signer for the existing operator buyer

The existing SF88 buyer can now use the official Stellar x402 client without an
operator writing a new signer module. SF103 supplies that module, a private
configuration setup command, and an inspect/check-signer path. It connects the
original SF43 SDK signing pattern to the existing SF31 → SF81 → SF88 workflow.

The operator's original SF81/SF36 terminal approval and durable reservation still
run before `sign()`. The official `@x402/stellar` exact client creates, simulates
and signs its own transaction. The official `@x402/core` client constructs the
complete payment envelope. The existing SF31 client sends the signed request;
SF82 records the result and SF86 handles independent reconciliation.

## Prepare a configured buyer

Use Node 22+ and a complete checkout. Install the same pinned optional native
dependencies in that checkout, with package scripts disabled:

```sh
npm install --no-save --ignore-scripts @x402/core@2.28.0 @x402/stellar@2.28.0
```

Start with an existing SF88 operator configuration. The existing Atlas or SF88
saved-offer preparation flow can produce it. Complete its real operator paths,
selected payment expectations, and `trustedPayer` using the intended existing
Stellar account. Keep that configuration and any request body private (`0600`).

```sh
# Existing private parent directory, owned by the operator, mode 0700.
node stellar/scf-starforge-20261009/sf103-native-buyer-signer/setup.mjs prepare \
  --buyer-config /private/merchant-pilot.json \
  --out /private/merchant-pilot-native \
  --secret-env STELLAR_SECRET
```

`STELLAR_SECRET` above names an existing secure environment variable. Its value
is never accepted on the command line, placed in a generated configuration, or
printed. Preparation does not read it. No account or key is generated.

The command creates a **new** directory containing `buyer.json` and `signer.json`.
It preserves the complete original operation, operator settings, original
discovery provenance and response destination. The only buyer field it changes
is `signerModule`, pointing to this checkout's `signer.mjs`. It binds the signer
configuration to the exact generated buyer bytes by SHA-256. Existing output
directories are refused. Files are `0600`, the directory is `0700` on POSIX, and
the original input is untouched.

Testnet defaults to the original SDK's `https://soroban-testnet.stellar.org` RPC.
An operator-owned custom endpoint can be supplied with `--rpc https://...`.
Pubnet requires an explicit HTTPS RPC, as the native SDK requires. Credentials,
query parameters and fragments are not accepted in the RPC URL. Network and
payer come from the original buyer configuration, not the merchant challenge.

## Inspect, then use the original commands

```sh
node stellar/scf-starforge-20261009/sf103-native-buyer-signer/setup.mjs inspect \
  --config /private/merchant-pilot-native/signer.json

# Optional: verify installed native versions and load the existing signer.
# This command never calls createPaymentPayload, signAuthEntry or settlement.
node stellar/scf-starforge-20261009/sf103-native-buyer-signer/setup.mjs check-signer \
  --config /private/merchant-pilot-native/signer.json

export SF103_SIGNER_CONFIG=/private/merchant-pilot-native/signer.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/merchant-pilot-native/buyer.json

# Execute only for the intended operation; original terminal approval remains.
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --execute --config /private/merchant-pilot-native/buyer.json
```

`inspect` reads only the original private configuration and request-body files.
It reports the bound operation, public payer, network, body digest, atomic cap,
SDK version requirement and signer source; it does not load native packages or
the signer. `check-signer` additionally checks the actual installed package
versions and the existing signer's derived public account. It reports only
public readiness metadata. Importing `signer.mjs` alone does not load a key.

The native signing call fetches the current ledger, builds the native transfer,
signs the required Soroban authorization and simulates through the configured
RPC. Those native SDK operations occur only when the original buyer invokes
`sign()` after approval. The adapter never invokes `sendTransaction`, an HTTP
payment wrapper, a facilitator settlement endpoint, or an automatic retry.

If the buyer configuration changes, prepare another output directory. A changed
bound file returns `NATIVE_BUYER_CONFIG_CHANGED`. Preserve the original stable
operation ID and ledger when reconciling an interrupted operation; regenerating
configuration does not release a reservation or make an uncertain payment safe
to repeat.

## Use an existing external or hardware signer

For a trusted existing SEP-43 provider, replace `--secret-env` with
`--provider /absolute/operator/stellar-provider.mjs`. The module must export
`createSigner({ network, payer })`, returning the native
`ClientStellarSigner`: `{ address, signAuthEntry, signTransaction? }`. Its address
must exactly equal the buyer's configured `trustedPayer`. The provider's file
must be regular and not group/world writable on POSIX.

`inspect` checks the provider's file without importing it. `check-signer` and
the actual approved signing path load it. A custom provider can have its own
device/network initialization behavior; use the operator's original trusted
provider rather than code supplied by a merchant. The adapter supplies no
hardware signing implementation or separate custody service.

For trusted embedding code, `createNativeBuyerSigner()` in `adapter.mjs` accepts
the original native signer and fixed operation/payer/body expectations; its
returned `sign` has the same argument shape SF31/SF88 already use.

## Exact offer and operation binding

Before the native scheme runs, the adapter matches the configured intent ID,
canonical resource URL, HTTP method, body presence/length/SHA-256, network,
asset, recipient, exact amount and approved atomic cap. The entire accepted
requirement, including its nested `extra` fields, must equal the original
SF31 approved intent and exactly one advertised offer. It retains resource
metadata and extensions in the native complete envelope.

The native core client registers only the configured concrete Stellar network,
selects only that exact offer, and receives the original atomic cap through its
native spend controls. Payment selection defaults to `authorization`. A merchant's
upfront offer requires the operator to select `expect.paymentFlow:'upfront'` in
the same approved operation; the full accepted requirement must still match.
Unsupported `upto`, unsponsored exact requirements and unknown or differently
selected payment flows are refused before native payment construction.
One adapter instance makes at most one payment-creation attempt, including when
the SDK fails. Persistent operation deduplication remains with original SF36.

The source currently requires `@x402/core` and `@x402/stellar` **2.28.0**. It does
not silently replace the pre-existing Muse 2.21.0 conformance environment.
SDK upgrade work should inspect the upstream contract and update this explicit
compatibility target alongside the original runtime owners.

## Source lineage

- Original Commons integration: [SF43 native exemplar](../sf43-agent-commerce/live-stellar-testnet.mjs),
  [SF31 buyer](../sf31-buyer-client/buyer.mjs), [SF81 approval bridge](../sf81-buyer-operator-bridge/bridge.mjs),
  and [SF88 operator CLI](../sf88-operator-buyer-cli/README.md).
- Official [Stellar quickstart](https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide).
- Inspected x402 Foundation commit `7f2b2f1f77fa5317615735e3378a6fad41cccb4e`:
  [native core client](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/core/src/client/x402Client.ts),
  [exact Stellar client](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/mechanisms/stellar/src/exact/client/scheme.ts),
  [signer interface/factory](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/mechanisms/stellar/src/signer.ts).
  Upstream code remains in the Apache-2.0 packages; these MIT files are adapters.
