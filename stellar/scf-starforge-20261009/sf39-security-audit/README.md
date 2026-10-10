# SF-39 — source-exact discovery integrity audit: alias correction / withdrawal

**Status:** Original security defect reproduced from the merged production source's key contracts and repaired with a staged-public-projection invariant; dedicated real-source Node regression included. No live payment or customer execution.

## Audited source versions

- `stellar-forge/product-integration/atomic-catalog.mjs` before repair, blob `8878165d54215749a903a626bd497f607c25e717` (SF-46).
- `scf46-stellar-bazaar/src/catalog.mjs` blob `66beed7c3a4b617ab90680ec5fe8318e934e74f7` (original PR451 plus SF-22).
- `stellar-forge/catalog-lifecycle/lifecycle.mjs` blob `663fa7e6abcbd5e7facfe45a052ff598d865adc2` (SF-21).
- `stellar-forge/route-identity/identity.mjs` blob `d67976f6ab1dea20b676807cc4e9dc0439316022` (SF-28).
- `stellar-forge/catalog-trust/catalog-trust.mjs` blob `eac3ec14eb5c88861c31889eb688fad641dda11f` (SF-27).

## Observed implementation defect / precise trigger

The *public* BazaarCatalog HTTP key contains `origin + normalized route-template/path + concrete URL query + method`. The independently accepted LifecycleCatalog identity for a **valid** `routeTemplate` is `method + origin + template`, without the concrete URL query.

An authorized seller can update the **same lifecycle ID** from `/weather?units=metric` to `/weather?units=imperial` (same valid `routeTemplate: '/weather'` and increasing accepted sequence). SF-46 previously inserted the new public key and overwrote `#catalogKeys[lifecycleId]`, but did **not** remove the old public key. The old row, including obsolete payment terms/metadata, remained in `/discovery/resources` and `/discovery/search`. A later `retire(lifecycleId)` removed only the latest key, leaving the earlier retired offer discoverable. A consumer following that stale listing might receive outdated price or payment instructions.

This is a **public discovery integrity defect**, not evidence that a payment settled incorrectly or that an untrusted seller bypassed authentication. The affected path requires a trusted lifecycle correction; it nonetheless violates seller withdrawal semantics.

## Repair

Within SF-46's already staged clone, determine the prior public key for the accepted canonical lifecycle ID; if the new key differs, remove the previous public alias in the *same staged clone*. Missing old projections fail before the trust commit. Only after the existing trust gate accepts is the revised catalog pointer published. No code calls a signer, payment network, remote provider or workflow.

The dedicated `alias-retirement.test.mjs` imports the **actual shipped AtomicCatalogIntegration**, not a replacement model. It covers a sequence of four live-key variants for one canonical lifecycle ID, exact row/price visibility after each authorized correction, rejected signer preserving the public generation, and eventual retirement leaving **zero** rows on both actual discovery methods.

Run the single relevant focused check in a Node 22 environment:

```sh
node --test stellar/scf-starforge-20261009/sf39-security-audit/alias-retirement.test.mjs
```

No broad repository CI, hosted GitHub Actions, on-chain settlement, mainnet deployment or public external outreach is required or included.

## Other review boundaries (not closed by this patch)

- SF-27 trust maintains its own per-key historical resource map; alias retirement in the public projection does not itself compact the trust audit history. That map is not the public discovery API.
- This patch does **not** independently authenticate settlement, seller ownership or the originating facilitator; that established caller contract remains mandatory. Keep seller/recipient/network binding with the upstream canonical hook.
- A source-complete payment and agent conformance review, including permissioned on-chain receipts and cross-network behavior, remains a separate SCF milestone. This module is not an independent third-party security audit.

The audit is original to SF-39, not a duplicate SF-23 ranking, SF-42 indexing, SF-50 402 quote comparison or SF-26 MCP binding implementation.
