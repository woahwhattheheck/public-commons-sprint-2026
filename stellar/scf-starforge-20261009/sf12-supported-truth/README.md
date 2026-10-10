# SF-12 — Truthful Stellar x402 v2 facilitator `/supported`

This MIT Node.js 22+ module implements an **operator-side capability filter** around the **actual registered canonical x402 facilitator SDK**. It does not replace `/verify` or `/settle`, create a wallet, claim fee sponsorship, make a mainnet RPC request, or magically make a payment scheme deployable. The goal is to stop prematurely advertising `upto`, `stellar:pubnet`, unavailable token contracts, keys, or signer/fee capacity while still publishing the exact canonical `/supported` wire shape when genuinely ready.

## Original upstream source pins (2026-10-10)

1. [x402 Foundation `x402Facilitator.getSupported()`](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/facilitator/x402Facilitator.ts), Git blob **`4b724cdf4da5894e40127e2f03a561aeafe69da2`**: its `getSupported()` constructs `kinds` (`x402Version`, `scheme`, `network`, `extra`), global `extensions`, and `signers` keyed by `stellar:*` from *actually registered* scheme networks and signer objects.
2. [Foundation Stellar `ExactStellarScheme`](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/exact/facilitator/scheme.ts), Git blob **`b454b15451b2d4cdd20e59646274f143909e6226`**: real `getExtra()` returns `{areFeesSponsored}` from instance setting; real `getSigners()` returns its configured sender and fee-bump signer addresses. This module never flips `areFeesSponsored:false` to `true`.
3. [Official Stellar example facilitator](https://github.com/stellar/x402-stellar/blob/main/examples/facilitator/src/app.ts), Git blob **`bc1d7540de5f3ee8be427ed6417da99faed1a4eb`**: `GET /supported` simply emits real `facilitator.getSupported()`, behind existing API-key and rate-limit protections.
4. [Stellar canonical CAIP-2 constants](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/constants.ts), blob **`e3ef92198a89f1192658de92837ef0ede08e8118`**: `stellar:testnet`, `stellar:pubnet`, `stellar:*`, USDC testnet `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, pubnet `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`, seven decimals.
5. x402 Foundation [open Stellar `upto` scheme proposal #3134](https://github.com/x402-foundation/x402/pull/3134), head `aa268ec942575be8caa69a2b5afb774a6ec4c09e`, distinct from today's registered exact scheme. **Do not advertise `upto`** unless an actual upgraded x402 SDK registered the scheme, trusted pinned contract agrees, and live operator proof attests it is operable.

## Wiring into actual facilitator (no new keys)

```js
import {TruthfulSupported,createSupportedServer} from './supported.mjs';
// `canonicalFacilitator` MUST be the very SAME already-created real
// `x402Facilitator` instance that handles /verify and /settle. It is populated
// through real `@x402/stellar/exact/facilitator` schemes and their existing
// signer objects; do not replace it with a new throwaway registry.
const gateway=new TruthfulSupported({
  facilitator: canonicalFacilitator,
  config:{'stellar:testnet':{
    enabled:true, schemes:['exact'],
    assets:[{symbol:'USDC',decimals:7,
      asset:'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'}]
  }},
  probe: async({network,assets,schemes})=>{
    // REQUIRED OPERATOR-IMPLEMENTED REAL NO-SPEND HEALTH PROBE.
    // Check target Soroban RPC latest ledger, correct network passphrase,
    // active signer availability without exposing private keys, funded
    // tx-fee payer/fee-bump account, and token metadata/trustline validity.
    // Return proof {network,checkedAtUnix,rpcReachable,signingReady,feeReady,
    //    signers:[...real public addresses],readyAssets:[...verified contracts],
    //    uptoContractReady:false} only when all have been actually checked.
    return await operatorRealProbe(network,assets,schemes);
  }
});
const http=createSupportedServer({gateway});
http.listen(8787,'127.0.0.1'); // loopback only; existing gateway handles auth
```

The snippet references the operator's existing `canonicalFacilitator` and `operatorRealProbe`. Those are **required real integrations**, not substitute payment/signature logic. If the probe is absent, throws, has stale time, reports wrong network/signer/asset, or reports insufficient fee capacity, the module returns **no capability**. A configuration flag alone cannot activate anything. `stellar:pubnet` defaults OFF when absent and is never inferred from testnet settings. All states refresh on each GET; cache disabled.

`GET /supported` returns exactly upstream `SupportedResponse` fields `{kinds,extensions,signers}` with v2-only filtered kinds, supported family `stellar:*`, and `extra.areFeesSponsored` copied from SDK. Unproven extensions are withheld rather than claimed. A separate, explicitly nonstandard `GET /supported/assets` reports the readiness-probed SEP41 asset allowlist without injecting noncanonical asset fields into x402's `/supported`. `GET /health` reports 503 when no kinds are ready.

### Ownership boundary and production follow-up

This standalone loopback server does not expose `/verify`/`/settle` itself. The **existing** real facilitator handles payments. The real deployment should route its `/supported` request to this read-only capability snapshot under the same authentication/rate limits as the original official example. Avoid separate public unauthenticated service deployment, stale cache or broad CORS. Operator must implement bounded RPC probe with explicit timeout; the module's trust assumptions are limited to that operator boundary. For mainnet activation, prove signer availability, fee sponsorship budget and correct live network/asset addresses first. Upstream `signers['stellar:*']` is a shared CAIP family list; this filter intersects it with observed *per-network ready* signers so disabling one network never implicitly promises those signer IDs on it. Identity validation here is address-shape only; upstream signatures and testnet ledger verification remain exclusively the canonical SDK's job.

## Focused execution

```sh
node --test stellar/scf-starforge-20261009/sf12-supported-truth/test/supported.test.mjs
```

**6/6 passed** in Node v22.16.0 against the exact documented `getSupported` wire shape and actual stdlib loopback GET/POST HTTP, including non-advertisement after RPC/fee/signer failure, policy filtering, future-upstream contract gating, assets, duplicates, clock drift, and no unauthorized network carryover. Tests use inert fixture signers and mocked readiness to exercise product boundary. They are **not** a live authenticated signer, an SDK runtime import, an RPC result, a proof of supported mainnet service, or a settled x402 transaction.

Next independent proof: authenticated approved operator boot existing `@x402/core/facilitator` with installed `@x402/stellar` on an existing VM, import this module, and compare its actual GET `/supported` JSON to current canonical SDK registered output and **fresh original network probe**. Archive exact package-lock / commit / RPC ledger and redacted source response. Ask Muse for source-exact broad conformance on authorized non-paying probes. No funds or grant form submitted here; neither historical testnet transactions nor the proposed `upto` profile are advertised as this deployment's success.
