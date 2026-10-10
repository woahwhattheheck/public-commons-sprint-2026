# SF46 — original-source release assembly

This is an additive, offline-first composition of the current public Stellar Forge source, separate from the SF51 commerce smoke and independently owned protocol engines.

## Delivery

- `index.mjs`: stable import surface for accepted Bazaar, MCP broker, x402 buyer, recovery, metering, conformance, testnet receipt and seller proof modules.
- `pins.json`: eight first-party source paths with observed Git blob SHAs and required export contracts.
- `preflight.mjs`: Node 22 source-accurate CLI calculating actual installed Git blob digests, importing transitive module dependencies, validating public exports and instantiating **only** an empty catalog and operator-approval-denied broker.
- `test/release.test.mjs`: one focused original-source check.

From the public repository root:

```sh
node stellar/scf-starforge-20261009/sf46-release/preflight.mjs
node stellar/scf-starforge-20261009/sf46-release/preflight.mjs --strict-pins
node --test stellar/scf-starforge-20261009/sf46-release/test/release.test.mjs
```

Normal preflight reports source pin drift with a warning because current owners can merge changes in parallel. Strict mode fails any drift. Both fail missing files, unavailable exported APIs and broken transitive imports. Reconcile any drift against current owner-approved implementation before updating `pins.json`; do not simply refresh baselines to hide a broken release.

## Explicit source and authority boundaries

The real `BazaarCatalog.insertValidated` is a **trusted post-verification integration hook**, not a public registration endpoint; callers must establish the actual seller/resource/payee and payment requirements. `McpPaidToolBroker` requires an explicitly configured catalog and operator-provided origins, approval and signing functions. The release facade sets none of these. SF33 controls recovery guidance, SF35 is server-metered with an injected facilitator, SF38 performs read-only official wire/ledger checks, SF43 independently checks an actual testnet receipt, and SF50 seller-origin proof alone is not wallet ownership.

Current SF27/SF28/SF39 catalog trust, SF31 buyer, SF32 MCP, SF35/38/43 payment and ledger, SF44 onramp, SF50 seller-origin and SF51 local smoke owners retain their code, results and responsibilities. No existing protocol file was changed.

| Acceptance step | What the preflight proves |
| --- | --- |
| Original installed source files, imports, exports, empty constructors | Yes, with a full checkout |
| Explicit seller authority and live contract/payee validation | No; needs the original owner acceptance |
| Real provider x402 v2 testnet payment and ledger receipt | No; needs genuine provider and ledger records |
| Mainnet safety, cross-network launch and operational acceptance | No; separate release decision |
| SCF #46 interest, invitation, applicant and final submission | No; founder-controlled |

Source snapshots can move as concurrent work lands; the pin manifest identifies the initial SF46 release review point. Use the established Muse originals for broad exact-protocol experiments, not the focused code check as a performance benchmark. Nothing here sends an application, contacts a customer, initiates payments or enables hosted CI. MIT.
