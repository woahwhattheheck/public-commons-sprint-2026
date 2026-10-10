# SF-46 atomic catalog integration

This release candidate composes the existing PR451 Bazaar catalog, SF-27 trust
boundary and SF-21 lifecycle model. It closes two concrete source-derived
integration defects:

- parsing now computes the eventual catalog key without mutation, so exact
  replay, stale sequence and ownership rejection do not advance the public
  search cursor generation;
- lifecycle retirement removes the corresponding live discovery projection,
  while accepted corrections advance the generation and invalidate old cursors.

`AtomicCatalogIntegration` stages lifecycle history and a cloned live catalog,
runs the SF-27 trust decision against the same immutable candidate, and swaps
the staged objects into service only after every decision accepts. Readers must
use the coordinator's `list` and `search` methods (or pass it to the existing
`createDiscoveryServer`) rather than retaining the internal catalog instance.

Focused check:

```sh
node --test stellar-forge/product-integration/atomic-catalog.test.mjs
```

The check imports the real current modules. It verifies cursor continuity after
exact replay, invalid sequence and signer rejection; cursor invalidation after
an accepted correction; and removal of a retired resource from the live list.

## Boundaries

This code does not verify a signature, Soroban authorization, settlement,
finality, seller legal ownership, or SCF eligibility. Its `authority` and
`provenance` inputs must come from the canonical authenticated facilitator hook.
It performs no network calls, wallet actions, payments or external registration.
