# Merchant receiving setup for Stellar asset contracts

The merchant command opens the original SF30 seller configuration, retains every payment choice in its declared order, and checks the exact network, token contract, recipient and amount. It connects the original SF101 account evaluator to deployed StellarAssetContract state and exposes a receiving verifier for the original SF16 asset engine.

The result answers a practical setup question: **can this account currently receive the amount this seller advertises, in this exact asset?** Each option retains its own result. Reserve and fee headroom appear separately because a sponsored recipient does not pay the sender's transaction fee.

## Run from the existing source checkout

Use Node 22+ and the original pinned `@stellar/stellar-sdk` 16.3.1. A checkout with that SDK already installed can run directly. Otherwise install the component's declared dependency once:

```sh
npm install --prefix stellar/scf-starforge-20261009/sf101-merchant-account-readiness --ignore-scripts
```

Review the example asset map against the actual asset choices in your seller configuration. It contains the official testnet USDC asset and native XLM SACs for testnet/public. Add other approved classic assets using their exact code, issuer and advertised contract address. The SDK derives the reserved contract address from the code/issuer and network passphrase and rejects an inconsistent mapping before reading the network.

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/merchant-cli.mjs \
  --config /private/merchant/seller-service.json \
  --asset-map /private/merchant/sac-assets.json \
  --out /private/merchant/receiving-review-2026-10-11
```

The existing private parent directory must exist; the named output directory must be new. Open `review.html` to compare options, then use the report's account or configuration action before re-running into a new directory. Reopen any previous report directly from its directory. Input files and earlier reports retain their bytes.

| Output | Contents |
| --- | --- |
| `review.json` | All route/option results, exact terms, classic account results, contract state and source hashes |
| `review.html` | Grayscale printable review with receiving state, exact asset identity, capacity, reserve and both observed ledger numbers |
| `options.csv` | One row per original payment option, retaining order, method, amount and recipient |
| `manifest.json` | Original input paths, byte lengths and SHA-256 digests, projected plan digest and output hashes |

Output directories use mode 0700 and all four files use 0600. An interrupted write removes only the newly created incomplete report directory. An existing directory is rejected before it can be changed. Reports project public payment choices and account state; merchant response bodies, file-product bytes and upstream settings are excluded from the projection.

## Asset identity

```json
{
  "schema": "stellar-forge.sac-asset-map.v1",
  "assets": [{
    "network": "stellar:testnet",
    "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "classicAsset": {
      "code": "USDC",
      "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    },
    "source": "https://developers.stellar.org/docs/build/agentic-payments/x402#testnet-usdc"
  }]
}
```

For native XLM set `classicAsset` to `"native"` and supply its exact SAC contract. Every code is case-sensitive; this component follows the original SF101/SF16 uppercase 1–12 alphanumeric code profile. Each mapped SAC uses seven decimal places. G-account balances have signed int64 limits, so the receiving check rejects a larger amount even though a generic SEP-41 interface uses int128. Atomic values remain strings and BigInt throughout.

SACs represent the underlying classic asset. An ordinary SEP-41 Wasm token requires its own contract-aware recipient resolver; an asset label or a balance getter alone cannot substitute for that resolver. This component checks both the derived SAC ID and the actual instance's built-in `contractExecutableStellarAsset` executable.

## RPC selection and existing proxy support

Testnet defaults to `https://soroban-testnet.stellar.org`. Select an existing operator-approved public-network or provider endpoint with a private `--rpc-map` JSON file:

```json
{
  "stellar:testnet": { "url": "https://soroban-rpc.testnet.stellar.gateway.fm" },
  "stellar:pubnet": { "urlEnv": "MERCHANT_STELLAR_PUBNET_RPC_URL" }
}
```

The named environment variable may contain a provider's credential-bearing URL. The report retains only its origin and a digest of the full endpoint. RPC error bodies and raw endpoint paths are suppressed. Endpoint profiles accept HTTPS, preserve certificate verification, reject URL userinfo/fragments, and never follow redirects. `getNetwork` must return the exact selected network passphrase before a contract entry is requested.

For a host already using an explicitly configured HTTP CONNECT proxy, add:

```sh
--https-proxy-env HTTPS_PROXY
```

This composes the original SF31/SF85 transport, pinning each request to its actual HTTPS origin and retaining end-to-end TLS. The environment variable is selected explicitly at launch. It is neither captured in the report nor automatically detected. Dependencies on the original public transport/proxy source remain in the source checkout or maintained distribution package.

## Receiving checks and result meanings

The reader performs `getNetwork` and `getLedgerEntries` reads, plus the original two official Horizon account/latest-ledger GETs. It verifies the actual entry key and contract address, persistent instance key, built-in SAC executable, modified ledger and instance lifetime. It then calls the original `evaluateSnapshots` for the account's exact classic asset, trustline authorization, liabilities, inbound capacity and dynamic reserve.

One run shares reads for identical network/account and endpoint/contract pairs. Cached reads expire after 30 seconds; a receiving verdict requires the oldest contributing request to have started within 60 seconds and the actual Horizon ledger head to meet the original freshness check. RPC and Horizon heads must differ by at most 12 ledgers. Provider failures remain separate from absent entries, unauthorized trustlines and missing operator configuration.

| Status | Operator meaning |
| --- | --- |
| `SAC_RECIPIENT_READY` | This exact option's observed deployed SAC and account receiving checks passed |
| `ACTION_REQUIRED` | Inspect the specific contract, capacity, authorization or freshness reason |
| `CONFIGURATION_REQUIRED` | Supply the missing exact asset/endpoint mapping or a supported G-account amount/profile |
| `READ_FAILED` | A provider or input-data read failed; the report retains a stable error code |

The command exits 0 when all options are ready, 2 for merchant actions/configuration, 1 when any provider read failed, and 3 for command/input/output failure. Missing map entries do not remove the corresponding payment option. A failed option does not suppress the remaining routes.

`--fee-operations` defaults to 0. Set it to the number of classic operations the merchant intends to fund if a nominal base-fee comparison helps the operator. That calculation and any reserve shortfall remain account advisories alongside the receiving result. The original classic-only CLI retains its prior combined account-readiness behavior.

Capacity is reviewed for each advertised request amount independently. Concurrent or future incoming payments can consume it. Re-run after changing seller terms, recipient accounts, asset mappings or trustline state. Issuer-recipient transfers retain the original explicit issuer-policy review because their native semantics burn the issued asset. Native XLM receiving also checks the signed int64 balance ceiling, including buying liabilities.

## Embedding with original SF16

```js
import { AssetRegistry } from '../sf16-asset-engine/assets.mjs';
import { createSacRecipientReviewer } from './sac.mjs';

const registry = new AssetRegistry(originalVerifiedAssetMetadata);
const reviewer = await createSacRecipientReviewer({
  assetMap: originalApprovedAssetMap,
  rpcEndpoints: originalApprovedRpcEndpoints,
});

// The wrapper snapshots this exact amount before the first asynchronous read.
const accepted = await reviewer.validate(originalPaymentRequirements, registry);
// accepted.terms is returned by original SF16 validatePaymentTerms.
// accepted.readiness contains the matching native receiving result.
```

`reviewer.review(terms)` returns the complete diagnostic report. `reviewer.validate(terms, registry)` requires a ready result, then calls the original SF16 function with the exact same immutable terms and the captured network/asset/recipient. Its internal callback is kept private so a result for a smaller amount cannot accidentally be handed to a different amount's validation. `reviewer.clear()` clears run-local read caching. For merchant configuration projection use `reviewSellerSacReadiness(config, options)` from `merchant.mjs`.

## Primary sources

- [Stellar Asset Contract identity, executable and classic account semantics](https://developers.stellar.org/docs/tokens/stellar-asset-contract)
- [Official trustline authorization and capacity guidance](https://developers.stellar.org/docs/build/guides/basics/verify-trustlines)
- [RPC getLedgerEntries and contract instance keys](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries)
- [RPC network passphrase](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork)
- [Official Stellar x402 testnet USDC metadata](https://developers.stellar.org/docs/build/agentic-payments/x402#testnet-usdc)

The SDK owns address derivation and XDR decoding. SF30 owns payment normalization, SF101 owns classic account arithmetic, SF16 owns accepted asset terms, and the existing seller/facilitator owns transaction execution.
