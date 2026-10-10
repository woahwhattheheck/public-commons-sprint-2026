# Stellar Forge SF-28 — Bazaar route and resource identity guard

An original, dependency-free, **catalog-ingestion safety layer** for HTTP route templates, concrete URL identities and MCP tools. Not a facilitator, crypto verifier, payment handler, seller authenticator or deployed index. Public module: [identity.mjs](identity.mjs); focused checks: [identity.test.mjs](identity.test.mjs).

## First-party baseline (pinned October 9, 2026)

- Official [Bazaar extension contract](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/specs/extensions/bazaar.md), blob `442708e76d5a129e0c1393471d8ed71e3604c94e`.
- Existing [TypeScript facilitator](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/extensions/src/bazaar/facilitator.ts), blob `083013ee19544e182c2e3185d7853309c34b9d9c`.
- Existing [Go facilitator](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/go/extensions/bazaar/facilitator.go), blob `04bfbef800bd183c5dfaf7316a285c3fa55fb12d`.
- The upstream SDKs already check bounded fixed-point percent-decoding (five passes); the prior double-encoding traversal defect is upstream-fixed (TypeScript #3213; Go #3441). **This module does not claim that fix as novel.**
- The official contract says invalid route templates must fall back to concrete URL path cataloging; template validation is not a seller control proof.

## New integration boundary

1. **Structural template vs real resource path.** A valid-looking `/users/:id` cannot index a concrete `/admin/42` under the `/users/:id` key. Path segment count, literal segments and optional echoed pathParams are checked.
2. **Stable identity across domain/method/ports.** Normalizes host case and default ports using WHATWG URL; keeps non-default ports, path case, static query variations and HTTP methods distinct. For dynamic routes, path params and query variants map to the declared pattern key.
3. **MCP-safe identity.** Distinguishes multiple paid tools served from one MCP URL using the pair (`resource.url`, `input.toolName`). An implementation-private prefixed key is returned and must not be passed off as an x402 wire field.
4. **Canonical route guard and deterministic reasons.** Rejects encoded slashes, ambiguous dot paths before WHATWG normalization, repeated/invalid route parameter names, malformed percent escapes, userinfo, fragments, parser-rewritten backslashes and pathological encoding. **Some legitimate unusual paths are conservatively excluded**; invalid templates get concrete fallbacks, but unsafe concrete URLs are omitted from the catalog.
5. **No payment change.** `status: fallback` means safe concrete identity; `status: rejected` means do not catalog at all. Neither is a judgment of transaction verification or settlement. Catalog mutation and authorization are deliberately outside this module.

## Minimal integration

```js
import { resolveCatalogIdentity } from './identity.mjs';

const identity = resolveCatalogIdentity({
  resourceURL: 'https://API.example.com:443/users/42?mode=basic',
  routeTemplate: '/users/:id',
  input: { type: 'http', method: 'GET', pathParams: { id: '42' } },
});
// { status:'accepted', catalogKey:'http|GET|https://api.example.com/users/:id', ... }
```

**Required pipeline before any catalog write:** canonical x402 payment and Bazaar info JSON Schema validation → independent seller/resource ownership and payTo authorization → this identity guard → server-controlled update authorization/quarantine and durable ledger/event provenance. Never derive seller authority from echoed client metadata alone. This module does not perform network requests, spend funds, validate Soroban signatures, settle testnet payments, or prove ownership.

## Focused verification

```bash
node --test stellar-forge/route-identity/identity.test.mjs
```

Thirteen independent focused behavioral checks cover canonical pattern matching, disjoint authorities/methods, path mismatch, claimed-parameter mismatch, the already-fixed encoded traversal, percent encoding, URL parser rewrites, MCP multiplexing, fallback behavior and protection against overwriting unrelated catalog records. These are software checks, **not** official cross-network conformance, live provider benchmark, signed payment proof, security certification, or grant approval. No Actions/workflows added or run.

## Integration contract / next owners

- **SF-21/22:** store method-qualified private catalog keys separately from resource metadata and authenticated seller/price/asset/network provenance. Never grant update authority from key equality.
- **SF-27:** enforce signed ownership, authenticated seller pricing and quarantine over this parser; this module alone is NOT poisoning resistance.
- **SF-29:** do not merge conflicting facilitator sources solely by URL identity; carry operator and seller provenance.
- **SF-46:** integrate behind official Bazaar extension verification, never make a catalog failure reverse an already-confirmed payment; next exercise original provider payloads and authoritative catalog before/after state.

No SCF interest form, application, award representation, outbound contact, mainnet/testnet money movement, private repo change, CI workflow or external deployment was performed for this artifact.
