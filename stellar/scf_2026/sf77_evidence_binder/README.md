# SCF SF77 | Private operator evidence binder

**Executable grant/merchant-review packet, NOT a grant application.** Node.js 22+, standard library only. Original founder work order: SCF #46 / Stellar Forge SF10; complementary to the existing SF47, SF60, SF61 and SF66 owners.

The original [SF66 native full-catalog capture](../../scf-starforge-20261009/sf66-demo-launcher/capture.mjs) contains complete actual response bytes read from one **already operating** original SF60 durable catalog and the original SF61 Atlas proxy. It is not a public facilitator crawl. The existing [SF47 founder scenario](../sf47_budget_model/sf10_70000_candidate.json) is **illustrative and unsubmitted**, not an award or contractor quote. This module checks both original source files and produces a self-contained review packet without copying seller URLs, catalog rows or private operator paths into the result.

## Original-source operation

Use a Node 22+ machine with a complete original public-sprint checkout and an existing original SF60 operator journal. If you do not have an authorized populated journal, coordinate with the existing SF60/SF66 owner. Do not create an empty catalog and claim it contains real seller observations.

1. Capture from the **existing** SF66 single launcher. It opens the original local SF60 journal service and SF61 Atlas without creating another durable store.

        node stellar/scf-starforge-20261009/sf66-demo-launcher/launch.mjs \
          --directory /private/existing-sf60-journal \
          --capture-full /private/evidence/original-sf66.json \
          --capture-network stellar:testnet --capture-limit 100 --one-shot

2. Run SF77 offline against that **literal original SF66 capture** and the one existing canonical founder JSON.

        node stellar/scf_2026/sf77_evidence_binder/export.mjs \
          --capture /private/evidence/original-sf66.json \
          --scenario stellar/scf_2026/sf47_budget_model/sf10_70000_candidate.json \
          --out /private/evidence/sf77-review-new

3. Read /private/evidence/sf77-review-new/index.html locally. The adjacent manifest.json is the machine-readable counterpart. Keep the **original SF66 input in local custody**; neither output includes original seller rows or the source operator directory. The generated directory is create-only (0700, files 0600); reruns need a different destination.

## Original source claims this tool checks

- Reads every SF66 captured page; recalculates **original native and Atlas byte SHA-256** and checks their decoded arrays/pagination, original offsets, row counts and complete declared total. Verifies SF66 native-health identity before/after capture.
- Requires actual SF60/SF61 identity flags: local durable catalog, read-only Atlas, no paid requests, no auto-payment or on-chain transaction. This supports **local original durable catalog parity at that observation**, not upstream facilitator freshness or a paid delivery.
- Recomputes the existing founder scenario from all future-only costs in integer cents and reconciles totals to its one hypothetical award budget. Renders the original three deliverables, completion days, stage costs and proof language.
- Separates **verified-input** and **not-established-by-inputs** gates for external provider freshness, seller consent, signed Stellar payment, founder eligibility, issuer milestone approval and measured human costs.
- Emits original private input SHA-256 fingerprints plus per-page digests without persisting the private raw catalog/capture. Outputs are for internal review, not issuer acceptance.

This is not an SF65 cross-facilitator comparator, SF71 offer-delta scanner, SF73 merchant adapter, SF74 seller console, SF75 readiness probe, or SF76 merchant repair comparator. It consumes existing owner-produced original evidence, not a second crawler, fixture, simulator, journal or spend path. No additional budget variant, wallet, form submission, hosted Actions, recipient contact, paid settlement, merchant authority or grant application is created.

## Acceptance and failure behavior

| Input | Behavior |
| --- | --- |
| Original complete SF66 capture + unchanged SF47 scenario | New two-file reviewer packet, digest proofs and unverified external gates |
| One original native/Atlas byte changed without recorded SHA update | Reject SOURCE_BYTES_HASH_MISMATCH, no destination created |
| Original page digests correct but Atlas/native resources or pagination differ | Reject NATIVE_ATLAS_PARITY_MISMATCH |
| Incomplete pagination or changing native total | Reject count/coverage errors, no report |
| Original SF60 health changed or source/Atlas read-only identity fails | Reject original-source boundary |
| Historical costs, mismatched USD scenario totals, unordered milestones | Reject scenario invariant |
| Existing output path | Refuse to overwrite it |

Node-only module exports verifyOriginalCapture, verifyOriginalScenario, makeManifest and renderHtml for subsequent owner integration. Validation precedes output creation. A file-system failure during writing may leave the **newly created** directory incomplete; discard that directory and rerun to a **new** destination. Original inputs are never modified.

**Do not submit** manifest or HTML as proof SCF accepted a grant or a live seller was paid. The founder must separately confirm legal eligibility, actual human future-work prices, working-capital feasibility and authorization to file. Use the canonical [SF47 cash-flow calculator](../sf47_budget_model/README.md) for 14/30/60-day sensitivity. This binder does not duplicate its calculations or select a second budget.

MIT. No runtime dependencies.
