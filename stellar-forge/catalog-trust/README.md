# SF-27 catalog trust boundary

This is a dependency-free ingestion guard for the public Stellar x402 Bazaar prototype. It treats every echoed seller resource block as hostile and calls the real `scf46-stellar-bazaar` parser/indexer only after an authenticated facilitator context authorizes the seller, origin, recipient, network and payment scheme.

The boundary enforces:

- authenticated seller ID and stable signer/origin ownership;
- recipient, network and scheme policy supplied by the trusted facilitator;
- monotonic per-resource sequences, exact replay soft-drop, and conflicting/stale update quarantine;
- document, string, array, depth and node limits before parser entry;
- preservation of the last trusted listing after a race or replay conflict;
- deterministic reason codes and a SHA-256 hash-chained audit trail.

It intentionally does **not** verify Stellar signatures, settlement, Soroban authorization, or legal ownership. Those facts must come from the canonical payment/facilitator layer and are represented by the explicit `authority` argument. A successful local check is not a security audit, deployment, transaction, SCF eligibility decision, or grant submission.

Run the focused changed-behavior checks from the repository root:

```sh
node --test stellar-forge/catalog-trust/catalog-trust.test.mjs
```

The cases exercise the production `BazaarCatalog.insertValidated` path with a valid listing, forged seller, unauthorized recipient, duplicate seller origin, metadata bomb, same-sequence race, exact replay, authorized price update, invalid parser method and tampered audit event. No network, wallet, payment or GitHub workflow is used.

Source boundary: MIT original code, built against public main `0f39db4872c65a01c2f96036a2dfb4a2538eee99`; production catalog blob `f34f38a3af8f1b9e23ff4607812b4ee6297480a5`. SF-28 route identity remains separate and unchanged.
