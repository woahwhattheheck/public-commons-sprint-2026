# SF19 · Secretless signer policy and custody design

**Status: independently authored operator admission boundary; not a wallet, custody client, x402 provider, signed transaction, chain settlement, security audit or funded SCF grant.** No private keys, session credentials, bearer values, seed phrases, secure-store export, real assets or mainnet transactions appear in this subtree.

The official [Stellar SCF RFP Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track) calls for fee sponsorship, hosted/self-hostable payment facilitation, canonical scheme support and responsible operations. The actual [Stellar x402 SDK](https://github.com/stellar/x402-stellar) owns cryptographic authorization and settlement behavior. This submodule supplies an admission contract to a separately authenticated and isolated signing service.

## Intended end-to-end boundary

```text
Untrusted agent proposes quoted GET request, without signer handle
  -> Host-pinned resource origin, actor, network, asset, recipient, integer cap
  -> Early synchronous reservation of quote ID (memory only)
  -> Independent operator-owned async approve(normalizedQuote) === true
  -> External isolated sign(normalizedQuote) [no key in this JS runtime]
  -> Validate signer response matches x402 v2 resource + all price terms
  -> SIGNED_ONLY_NOT_SETTLED returned to trusted host
  -> Canonical SF32/SF35 + x402 Stellar SDK send/verify/settle and ledger audit
```

Agent request keys are *exactly* `quoteId, actor, resourceUrl, method, scheme, network, asset, payTo, amount, expiresAt`; any extra `approved:true` or caller-supplied signer is rejected. `amount` and `maxBaseUnits` are exact unsigned base-unit decimal strings and compared with BigInt. The boundary allows only host-configured testnet/public network, asset/payee, specific HTTPS public origins, GET + exact scheme and a short quote TTL (default five minutes). Other schemes and POST must be explicitly implemented and reviewed elsewhere. Host-supplied approver **must not** derive permission from tool args. No env fallback, wallet loader, RPC request, secret logging or network calls. Signing cannot occur with `sign=null`.

The module's in-memory pre-await reservation prevents same-process concurrent duplicate signatures. It is **not crash-safe, distributed or exactly once**. Integration MUST use original SF18 durable idempotency and canonical chain receipt reconciliation before automatic retry. Revocation during approval cancels new signing admission but cannot unsend a signed transaction. Avoid public exposure of the signer callback.

## Secretless configuration example

```js
import { SecretlessSignerBoundary } from './custody.mjs';
const gateway = new SecretlessSignerBoundary({
  actors:['authorized-agent-id'],
  allowedOrigins:['https://merchant.example'],
  assetPolicies:{
    'OPERATOR_VERIFIED_SEP41_ASSET_ID':{
      network:'stellar:testnet',
      payTo:['OPERATOR_VERIFIED_RECIPIENT'],
      maxBaseUnits:'1000000'
    }
  },
  approve: independentOperatorApproval, // host-injected function, not request data
  sign: isolatedCanonicalX402Signer       // host-injected from its authorized service
});
```

All asset, actor and recipient labels shown are configuration placeholders, not verified Stellar addresses or secret/key references. An embedding authorized host may retrieve existing Commons shared credential *references* directly via the existing protected facility, without introducing peer admission/holder gates. That separate isolated process must enforce approved signing privileges, rotation, spend quotas, ACLs and canonical SDK signature validity. This module is deliberately not a new vault or privileged credential intermediary.

## Threat and validation matrix

| Threat / failure | This module's controlled behavior | Required external proof |
|---|---|---|
| Agent supplies `approved:true` or signer | Exact-fields input allowlist denies unexpected keys | Authenticated independent operator approval |
| Price / token / network / payee drift | Exact allowlisted Stellar network/asset/payee and BigInt spend ceiling; signed-envelope match | Original first-party x402 Stellar challenge and SDK settlement verification |
| Origin misrouting / localhost exfiltration | Only configured HTTPS public origins; no HTTP, local or private-name origins | HTTP client redirect=error, DNS rebinding/network egress policy in SF32 |
| Repeated/colliding quote | Pre-await reserve, refuse duplicate or exhausted capacity | SF18 durable atomic dedupe/ledger reconciliation across restarts |
| Expired/withdrawn consent | TTL from host clock, revocation checked before external signer dispatch | Signer-side grant revocation and operator event record |
| Accidental credential field emitted by signer | Top-level x402 envelope validation and recursive sensitive-name rejection | Signer HSM/KMS isolation, secure transport, response DLP |
| Signed but unpaid, unverified or unknown settle | Result `SIGNED_ONLY_NOT_SETTLED` only | Real canonical provider receipts and Stellar testnet ledger acceptance |
| Service crash or malicious host | No secrets in this package | Protected host process, source pin, cross-process audit and backup |

## Real operator rotation and recovery steps

1. Authorized custodian configures a named external signer and fee-account roles under existing secure custody, confirms asset/network policy, and never includes actual secrets in repo/Slack/CI/logs.
2. Host authenticates each operator/agent separately, binds signed operations to exactly approved resource and price, verifies the independent callback rather than trusting agent output.
3. Log sanitized trace ID, outcome class, network and independently verified onchain receipt hash when available. Never log bearer headers, seeds, source private data, signed retry headers or unapproved payment payloads.
4. Stop new signs with `revoke()`, revoke actual signer privileges in its own service, rotate active roles as authorized, check stale grants are rejected, then establish a new signer binding. In-flight signed calls require ledger reconciliation, not blind retry.
5. On restart, consult independent SF18 durable records and provider settlement status before creating any new payment attempt. A new in-memory gateway alone cannot prove absence of prior payments.

Run one source-local focused Node check without CI or network:

```sh
node stellar/scf-starforge-20261009/sf19-secretless-signer-boundary/custody.check.mjs
```

The test deliberately covers security policy and injected callbacks, **not** a real SDK signing key, token spend, cryptographic signature validity, SCF #46 grant eligibility, testnet ledger success, actual x402 /verify or /settle, or a measured capacity limit. For a **source-exact original-provider** acceptance campaign, the designated Muse / actual SDK owner should integrate this with their already accepted SF32/SF35/SF18 sources and prove live testnet outcomes. No duplicate simulation/controller is started by this package.
