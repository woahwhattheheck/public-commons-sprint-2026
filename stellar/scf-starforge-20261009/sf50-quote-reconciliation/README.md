# SF-50 — Discovery-to-live-quote reconciliation

Status: original **buyer-side pre-signature policy gate**, not a facilitator, wallet, settlement client, KYC process, issuer service, or claim of cryptographic seller authentication. MIT. Part of `SCF-STARFORGE-20261009`.

## The real failure mode

A Bazaar's asynchronously discovered catalog row may be old, wrong, or maliciously associated with a resource. A buyer agent that signs from the marketplace listing alone can authorize a different payee, token, amount, network, scheme, or route than the HTTP origin currently requests. The x402 v2 HTTP transport defines **`PAYMENT-REQUIRED` (base64 JSON) on an HTTP 402** as the current PaymentRequired; Bazaar exposes `resource.url`, `accepts` and the advertised method. The reconciliation step here takes both real shapes, checks exact identity and terms, then returns the *live* payment requirement **only if buyer-supplied network/scheme/asset/payee and a hard atomic-unit ceiling match**. The caller must still invoke a proper x402 SDK and its independent permission/ledger-spend controls.

## Complement to the already-merged SF-50 quote commitment

Accepted [PR #469](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/469) already binds a selected Bazaar intention and compares a **decoded, caller-supplied** x402 v2 challenge against the actual invocation; it remains the canonical local quote commitment, with its original author, API and integration ownership unchanged. This follow-on adds the **missing HTTP response boundary and buyer-policy enforcement**: consumes an actual 402 `Response` and `PAYMENT-REQUIRED` header, refuses redirected or non-402 responses, requires the requested URL/method and a previously chosen payee/asset/network/scheme, applies a hard positive atomic-unit ceiling and checks the live requirement. It is not another catalog, wallet, signer or settlement implementation. In an SF-31 integration, keep PR469's quote-id/expiry selection check AND use this origin-envelope gate before consent/signing; do not substitute one for the other.

## Protocol/source pins (fetched 2026-10-10)

- First-party product input `scf46-stellar-bazaar/src/catalog.mjs`, Git blob `66beed7c3a4b617ab90680ec5fe8318e934e74f7` (PR451, current main at integration authoring). Actual BazaarCatalog and GET handler are invoked in `quote-guard.integration.test.mjs`.
- [x402 Foundation specification v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md), Git blob `3b4631af0684748966eafcdf6a6a90a8cbbf7198`.
- [x402 HTTP transport v2](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md), Git blob `a21213c02706208b2268a5fdab7dc6d5b468edbd`.
- [x402 Bazaar extension](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md), Git blob `442708e76d5a129e0c1393471d8ed71e3604c94e`.

## Integration (upstream SF-31 and SF-46; do not duplicate owners)

1. Use the accepted Bazaar catalog GET `/discovery/resources` or `/discovery/search` response. Treat the row as an untrusted *hint*, not consent or a settlement receipt.
2. Issue the actual intended **unpaid** HTTP request with `redirect: 'error'`. Pass its untouched HTTP 402 `Response`, exact request URL, method, catalog row, explicit preselected Stellar payment tuple, permitted networks/schemes, and maximum atomic-unit spend into `reconcileHttpQuote` **before requesting a signature**. No auto-select of asset, scheme, seller or network.
3. Only on `decision: 'allow'`, forward the returned fresh `paymentRequirement` into the versioned x402 buyer SDK **after** the separate authorization/spend-governor approval. If the resource is not 402, redirected, changed identity, changed offer, or over budget, stop; never downgrade to cached listing terms. Re-fetch and re-approve if time or request inputs change.
4. Record `receiptSha256` with the origin response and request trace. It is a deterministic local evidence fingerprint, **not** a server signature or chain receipt.

```js
import { reconcileHttpQuote } from './quote-guard.mjs';
const decision = reconcileHttpQuote({
  catalogEntry: discoveredRow, requestUrl, method: 'GET',
  response: unpaidOriginResponse,
  selection: { scheme:'exact', network:'stellar:testnet', asset:approvedAsset, payTo:approvedPayee },
  allowedNetworks:['stellar:testnet'], allowedSchemes:['exact'],
  maxAtomicUnits:'30000'
});
if (decision.decision !== 'allow') throw new Error(decision.reason);
// Next stage (separate owner): human/agent spending authorization, signer, retries and receipts.
```

## Boundaries and limitations

- The gate does **not** authenticate who controls the hostname, cryptographically prove seller ownership, validate Stellar addresses/signatures, ensure wallet solvency, prevent the origin from changing terms after this check, or prove transaction settlement; it must be coupled to TLS/origin security, SF-27 trusted catalog ingestion, SF-36 spending governor, and SF-31 canonical buyer SDK.
- Catalog entries or payment requests without `amount`, `asset`, `payTo`, `maxTimeoutSeconds`, and the exact Bazaar method/route identity are refused; this is intentionally stricter than optional-metadata discovery. Unknown/duplicate alternatives and malformed header bytes are not silently ignored.
- This slice gates **HTTP only**, not MCP `structuredContent`; integrate with SF-26's MCP metadata and canonical MCP transport separately. `upto` is recognized but disabled by default; even when explicitly enabled, settlement-phase actual amounts need independent enforcement. Pubnet and non-TLS are disabled by default; `allowLocalHttp` permits only loopback for the focused HTTP integration check.
- A matching 402 does not imply the Bazaar is correct for *other* callers, stable over time, or a project-wide uptime/service claim. No keys, funds, RPC, grant submission, partner outreach, private repo edits or GitHub Actions were used.

## Focused local checks

`node --test stellar/scf-starforge-20261009/sf50-quote-reconciliation/*.test.mjs` from the public repo root. A single changed-behavior suite exercises 9 isolated reconciliation cases and the actual PR451 HTTP/catalog source path. This is not a full x402 conformance certification. Preserve any upstream SHA changes and re-run this same one check when integrating.
