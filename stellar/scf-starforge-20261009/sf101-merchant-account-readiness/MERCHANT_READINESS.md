# Merchant receiving setup for Stellar asset contracts

The merchant command opens the original SF30 seller configuration, retains the native compiled route order and every original payment choice in order, and checks the exact network, token contract, recipient and amount. It connects the original SF101 account evaluator to deployed StellarAssetContract state and exposes a receiving verifier for the original SF16 asset engine.

The result answers a practical setup question: **can this account currently receive the amount this seller advertises, in this exact asset?** Each option retains its own result. Reserve and fee headroom appear separately because a sponsored recipient does not pay the sender's transaction fee.

## Run from the existing source checkout

Use Node 22+ and the original pinned `@stellar/stellar-sdk` 16.3.1. A checkout with that SDK already installed can run directly. Otherwise install the component's declared dependency once:

```sh
npm install --prefix stellar/scf-starforge-20261009/sf101-merchant-account-readiness --ignore-scripts
```

The command can discover the exact classic asset directly from a deployed SAC. It reads its decimals, name and symbol with the native SDK, confirms the built-in SAC executable, and verifies the derived code/issuer/network contract ID against the actual advertised C-address. The resulting map is retained as `asset-map.json`.

An existing operator asset map remains supported and is validated before native discovery. Review the example asset map against the actual asset choices in your seller configuration. It contains the official testnet USDC asset and native XLM SACs for testnet/public. Add other approved classic assets using their exact code, issuer and advertised contract address. The SDK derives the reserved contract address from the code/issuer and network passphrase and rejects an inconsistent mapping before reading the network.

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/merchant-cli.mjs \
  --config /private/merchant/seller-service.json \
  --asset-map /private/merchant/sac-assets.json \
  --out /private/merchant/receiving-review-2026-10-11
```

Omit `--asset-map` to discover SAC mappings from deployed metadata. If the configuration has no `publicOrigin`, supply its actual running `http://127.0.0.1:PORT` origin with `--origin`; the command compiles the same imported and response-asset offers as the running SF30 seller.

The existing private parent directory must exist; the named output directory must be new. Open `review.html` to compare options, then use the report's account or configuration action before re-running into a new directory. Reopen any previous report directly from its directory. Input files and earlier reports retain their bytes.

| Output | Contents |
| --- | --- |
| `review.json` | All route/option results, exact terms, classic account results, contract state and source hashes |
| `review.html` | Grayscale printable review with receiving state, exact asset identity, capacity, reserve and both observed ledger numbers |
| `options.csv` | One row per original payment option, retaining order, method, amount and recipient |
| `plan.json` | Original compiled resources and every complete normalized payment option |
| `asset-map.json` | Supplied and SDK-verified discovered SAC mappings |
| `capture.json` | Exact HTTP request identities, original response bytes, observations and selected endpoints for replay |
| `manifest.json` | Original input paths, byte lengths and SHA-256 digests, projected plan digest and output hashes |

Output directories use mode 0700 and all seven files use 0600. An interrupted write removes only the newly created incomplete report directory. An existing directory is rejected before it can be changed. Reports project public payment choices and account state; merchant response bodies, file-product bytes and upstream settings are excluded from the projection.

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

For native XLM set `classicAsset` to `"native"` and supply its exact SAC contract. Every code is case-sensitive; classic codes retain their original ASCII case and contain 1–12 alphanumeric characters. Each mapped SAC uses seven decimal places. G-account balances have signed int64 limits, so the receiving check rejects a larger amount even though a generic SEP-41 interface uses int128. Atomic values remain strings and BigInt throughout.

SACs represent the underlying classic asset. An ordinary SEP-41 Wasm token requires its own contract-aware recipient resolver; an asset label or a balance getter alone cannot substitute for that resolver. This component checks both the derived SAC ID and the actual instance's built-in `contractExecutableStellarAsset` executable.

## RPC selection and existing proxy support

Testnet defaults to `https://soroban-testnet.stellar.org`. Select an existing operator-approved public-network or provider endpoint with a private `--rpc-map` JSON file:

```json
{
  "stellar:testnet": { "url": "https://soroban-rpc.testnet.stellar.gateway.fm" },
  "stellar:pubnet": { "urlEnv": "MERCHANT_STELLAR_PUBNET_RPC_URL" }
}
```

The named environment variable may contain a provider's credential-bearing URL. The operator report retains only its origin and a digest of the full endpoint. The private capture retains the exact endpoint URL, including any credential-bearing path/query, so keep the full capture directory with the operator's private inputs. RPC error bodies and raw endpoint paths are suppressed. Endpoint profiles accept HTTPS, preserve certificate verification, reject URL userinfo/fragments, and never follow redirects. `getNetwork` must return the exact selected network passphrase before a contract entry is requested.

For a host already using an explicitly configured HTTP CONNECT proxy, add:

```sh
--https-proxy-env HTTPS_PROXY
```

This composes the original SF31/SF85 transport, pinning each request to its actual HTTPS origin and retaining end-to-end TLS. The environment variable is selected explicitly at launch. It is neither captured in the report nor automatically detected. Dependencies on the original public transport/proxy source remain in the source checkout or maintained distribution package.

## Receiving checks and result meanings

The reader performs `getNetwork` and `getLedgerEntries` reads, native SDK `simulateTransaction` getter calls for decimals/name/symbol/balance/authorization, and the original official Horizon account/latest-ledger GETs. Getter transactions use the SDK null account and remain unsigned; their returned authorization and write footprint must be empty. It verifies the actual entry key and contract address, persistent instance key, built-in SAC executable, modified ledger and instance lifetime. It then calls the original `evaluateSnapshots` for the account's exact classic asset, trustline authorization, liabilities, inbound capacity and dynamic reserve.

One command shares original response bytes for identical serialized requests across native discovery and the original SAC reader. The embedding reviewer retains its original 30-second cache; a receiving verdict requires the oldest contributing request to have started within 60 seconds and the actual Horizon ledger head to meet the original freshness check. RPC and Horizon heads must differ by at most 12 ledgers. Provider failures remain separate from absent entries, unauthorized trustlines and missing operator configuration.

| Status | Operator meaning |
| --- | --- |
| `SAC_RECIPIENT_READY` | This exact option's observed deployed SAC and account receiving checks passed |
| `ACTION_REQUIRED` | Inspect the specific contract, capacity, authorization or freshness reason |
| `CONFIGURATION_REQUIRED` | Supply the missing exact asset/endpoint mapping or a supported G-account amount/profile |
| `READ_FAILED` | A provider or input-data read failed; the report retains a stable error code |
| `REVIEW_REQUIRED` | Read captured state, reconcile changed observations, or apply the custom contract's receiving policy |

The command exits 0 when all options are ready, 2 for merchant actions/configuration/source review, 1 when any provider read failed, and 3 for command/input/output failure. Missing map entries are resolved from exact deployed SAC metadata where available. Custom contracts remain visible with native metadata, exact decimals and observed balances plus their receiving policy review. SAC contract recipients use native authorization and signed int128 balance capacity; G-account SAC recipients continue through the original classic evaluator. Atomic values above the JavaScript safe-integer limit remain exact decimal strings. An unsupported or unreadable choice stays in the report. A failed option does not suppress the remaining routes.

`--fee-operations` defaults to 0. Set it to the number of classic operations the merchant intends to fund if a nominal base-fee comparison helps the operator. That calculation and any reserve shortfall remain account advisories alongside the receiving result. The original classic-only CLI retains its prior combined account-readiness behavior.

Capacity is reviewed for each advertised request amount independently. Concurrent or future incoming payments can consume it. Re-run after changing seller terms, recipient accounts, asset mappings or trustline state. Issuer-recipient transfers retain the original explicit issuer-policy review because their native semantics burn the issued asset. Native XLM receiving also checks the signed int64 balance ceiling, including buying liabilities.

## Capture replay and comparison

After account or seller changes, use a new directory and compare the resulting option states with a saved report:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/merchant-cli.mjs \
  --config /private/merchant/seller-service.json \
  --previous /private/merchant/receiving-review-2026-10-11 \
  --out /private/merchant/receiving-review-next
```

Comparison binds each choice to its full original terms and resource. A changed price, asset, recipient or timeout is a new choice; a reordered choice retains its identity. The report identifies introduced and resolved receiving reasons.

Reopen the original capture with zero network requests:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/merchant-cli.mjs \
  --config /private/merchant/seller-service.json \
  --from-capture /private/merchant/receiving-review-2026-10-11 \
  --out /private/merchant/receiving-review-replay
```

Replay verifies the private manifest's exact byte lengths and SHA-256 digests, original seller bytes, complete compiled plan, asset mapping, fee-operation setting and endpoint selection. It matches every read to the original serialized request and original response bytes. Replay results carry `RETAINED_NETWORK_READS`; caller-injected transports carry `CALLER_TRANSPORT_READS`, while the command's native or original explicit CONNECT transport carries `LIVE_NETWORK_READS`. Configuration changes during a run, aged observations or divergent native/classic balances appear as explicit review reasons.

Concrete receiving reasons point to the required account action: create the exact missing code/issuer trustline, request the issuer's authorization, increase its remaining limit, correct the configured network or address, or restore the identified archived contract state through the existing operator process. Custom contract semantics stay attached to that exact token choice.

`inspectMerchantReceiving({configPath, ...options})` in `receiving-session.mjs` returns `{plan, report, resolvedAssetMap, capture}`. It composes the same `createSacRecipientReviewer` for every SAC G-account option. `writeMerchantReview(directory, report, sources, bundle)` preserves the original three-argument embedding API and accepts the optional complete session bundle.

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
- [SDK contract invocation and read-only results](https://stellar.github.io/js-stellar-sdk/guides/06-invoke-a-contract/)
- [RPC network passphrase](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork)
- [Official Stellar x402 testnet USDC metadata](https://developers.stellar.org/docs/build/agentic-payments/x402#testnet-usdc)

The SDK owns address derivation and XDR decoding. SF30 owns payment normalization, SF101 owns classic account arithmetic, SF16 owns accepted asset terms, and the existing seller/facilitator owns transaction execution.
