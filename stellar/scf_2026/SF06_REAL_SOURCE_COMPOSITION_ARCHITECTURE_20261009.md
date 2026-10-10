# SF-06 — original-source x402 Stellar Bazaar integration architecture

**Campaign:** SCF-STARFORGE-20261009 / SF-06. **Snapshot:** October 9, 2026 EDT. **Delivery:** actual source-pinned public product architecture and engineering integration orders. **Status:** design / handoff; no existing end-to-end Stellar paid product, complete coordinator, seller consent, SCF submission, award or customer represented.

## Product objective

Build a self-hostable, provider-interoperable Stellar x402 commerce discovery system: seller publishes a genuine resource and pricing declaration; canonical Stellar x402 checks and independently authenticated seller/recipient authorization make it eligible for a catalog; ordinary buyer agent discovers, evaluates capability and true price, obtains spend-policy approval and makes a real noncustodial payment via canonical upstream SDK; fulfillment and payout evidence are independently reconciled. Maintain resource provenance, freshness, correction, retirement and explainable failed purchases. A read-only Bazaar catalog alone cannot fulfill this promise.

The SCF #45 program already funded three neighboring facilitator/Bazaar projects. Reuse official x402 settlement, contribute discovery/agent safety rather than clone the payment rail. No SCF interest form or Q4 x402 RFP eligibility claim: the RFP list still says July 2026 Q3/#45.

### Proposed trust/data flow (integration is NOT built yet)

    Opt-in HTTP/MCP seller
      -> original HTTP 402 / Bazaar bytes, source URL, timestamp and SHA
      -> canonical x402 schema / network / scheme verification
      -> independent seller/origin/payTo authority / permissions
      -> SF-28 safe route and MCP identity guard
      -> SF-27 trust/quarantine/audit
      -> MISSING ATOMIC COORDINATOR (SF-46) !!
          -> SF-21 versioned lifecycle and provenance
          -> PR451 authoritative live search projection
      -> GET discovery/resources / GET discovery/search
      -> SF-36 buyer policy (unintegrated)
      -> actual Stellar x402 signer/SDK/facilitator (unintegrated)
      -> independent settlement confirmation and fulfillment proof
      -> reconciliation and history (unintegrated)

The atomic coordinator and paid-call integration arrows are **proposals**, not existing source. Successful local tests of separately shipped modules do not prove any joined or deployed product.

## Native GitHub verified modules, APIs and exact main blob SHAs

| Component | Actual public source and API | Git blob SHA | Implemented and not implemented |
| --- | --- | --- | --- |
| PR451 core | [scf46-stellar-bazaar/src/catalog.mjs](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/scf46-stellar-bazaar/src/catalog.mjs) — BazaarCatalog.insertValidated, list, search, createDiscoveryServer | f34f38a3af8f1b9e23ff4607812b4ee6297480a5 | Real in-memory lexical search, GET resources/search and versioned cursors, **no** settlement/seller authentication; trusting insertValidated means caller validated independently |
| SF-28 | [stellar-forge/route-identity/identity.mjs](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/route-identity/identity.mjs) — inspectRouteTemplate, inspectResourceURL, resolveCatalogIdentity | d67976f6ab1dea20b676807cc4e9dc0439316022 | Safe HTTP identity, actual route/path match and MCP toolName under HTTP resourceURL; status accepted/fallback/rejected; not a seller signature verifier or generic mcp:// URL handler |
| SF-27 | [stellar-forge/catalog-trust/catalog-trust.mjs](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/catalog-trust/catalog-trust.mjs) — CatalogTrustBoundary.ingest(candidate, authority), auditTrail, auditHead, verifyAuditTrail | 7e8683cfc7ebe8ae2b358e2f20ec014180a63701 | Real PR451 insert path under authenticated-context policy (signer, allowedOrigins/Recipients/Networks/Schemes Sets), sequence, quarantine, SHA audit; does NOT establish trusted auth itself |
| SF-21 | [stellar-forge/catalog-lifecycle/lifecycle.mjs](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/catalog-lifecycle/lifecycle.mjs) — STORAGE_SCHEMA, normalizeDiscoveryRecord, LifecycleCatalog.upsert/retire/get/history/snapshot/fromSnapshot | 663fa7e6abcbd5e7facfe45a052ff598d865adc2 | Real separate in-memory versioned records and authenticated provenance input, corrections/retirement/freshness; NOT automatically synchronized with PR451 live catalog |
| SF-44 | [stellar/scf-starforge-20261009/sf44-developer-onramp](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf-starforge-20261009/sf44-developer-onramp) — loopback CLI importing PR451 | baseline PR451 f34f38a3af8f1b9e23ff4607812b4ee6297480a5 | Original actual HTTP GET 200/200 and error 400/405, with intentionally NONPAYABLE unverified sample; not paid agent integration |
| Upstream | [x402 Foundation](https://github.com/x402-foundation/x402) and [Stellar x402 SDK](https://github.com/stellar/x402-stellar) | immutable upstream versions to be pinned by SF-04/46 before production | Canonical payment and wire conformance, NOT replaced by our catalog; Stellar upto scheme is a separate open issue [#71](https://github.com/stellar/x402-stellar/issues/71) |
| SF-33, SF-36 | Existing separately owned payment-recovery contract and buyer-side spend governor work | source integration not yet proven against these actual modules | Do not mark payment indeterminacy, policy, signature or settlement as integrated from thread receipts alone |

These are actual original code-level provider readbacks on main, not descriptions inferred from file names. The separate module tests remain accepted historical evidence; this SF-06 lane did not rerun builds, tests or hosted Actions.

## P0-1: unresolved catalog identity mismatch

**PR451 private search/index HTTP key** consists of type + origin + canonical path + URL search + HTTP method; **SF-28 private identity key** uses type + method + canonical absolute URL. The two representations are genuinely different for HTTP, especially for valid route template/case/query differences. Both normally identify MCP as server resourceURL plus toolName, but SF-28 explicitly requires HTTP(S) resource URL even when input.type is mcp. This is not the same as canonicalizing direct mcp://tool/name identifiers (see upstream [x402#3121](https://github.com/x402-foundation/x402/issues/3121)).

**Correction:** SF-46 defines a versioned stable LOGICAL resource key based on trusted seller/operator, network, source method, actual source URL/path/template and toolName. Keep separately named projection keys for PR451 and SF-21. SF-28 first validates pattern against actual URL/pathParams; accepted canonical template may dedupe authorized dynamic routes, fallback uses concrete original route, rejected creates no catalog record. Never equate key equality to authenticated ownership. Preserve legacy mapping/migration collisions rather than silently rewriting old IDs.

**Acceptance:** with the *real exact source modules*, HTTP GET vs POST, two seller hosts, query variants, default/nondefault port, dynamic route/encoded separator, multiple MCP tools sharing one HTTP server, replay and change-of-owner resolve correctly across BOTH snapshots. No operator-supplied route can steal a third-party listing.

## P0-2: trust + history + live search are not atomic

**Source fact:** SF-27 CatalogTrustBoundary.ingest calls the actual PR451 catalog.insertValidated before completing some sequence/conflict/replay checks; it restores the prior catalog entry when a late conflict occurs. SF-21 LifecycleCatalog.upsert writes an **independent** record history and requires strictly positive sequence, while SF-27 allows zero. Neither provides atomic journaling across the two views; a simple sequential composition permits live catalog state to diverge from history if lifecycle rejects or process dies between writes. In-memory Maps also do not survive restart merely because snapshot() exists.

**Correction:** Build a single-writer, durable prepared/committed journal keyed by authenticated seller, logical resource ID, positive monotonic sequence and SHA of original source. Separate (a) canonical external authority & schema, (b) safe identity and normalized base-unit payment terms, (c) staged lifecycle projection, and (d) committed searchable snapshot. All-or-nothing visibility: only committed data can surface in GET discovery or history. On crash, replay committed journal deterministically and quarantine dangling prepared operations. Seller handoff and tombstones require original authorized update policy, not an emailed assertion of ownership.

**Do not implement this by merely** calling trust.ingest followed by lifecycle.upsert and assuming success. A lifecycle exception after trust mutation is a broken product. Keep the existing module owners responsible for contract changes and SF-46 as coordinator.

**Acceptance:** inject a lifecycle validation error and a process crash between stages while using PR451 + SF27 + SF28 + SF21 original code. After restart, identical seller/sequence/amount/status across catalog search, lifecycle history and audited committed journal, or the entire candidate absent. Conflicting replay leaves last accepted state untouched; authenticated retirement disappears from public search while preserving history.

## P0-3: discovery does not prove safe paid fulfillment

One must keep these evidentiary states distinct:

1. Untrusted seller-declared endpoint and resource.
2. Original source observed and canonical x402 Bazaar schema validated.
3. Seller/recipients/network/asset/method **independently** authenticated and allowed to index.
4. Catalog published (separate from processing/verified-only).
5. Human-approved buyer intent, spending budget and canonical signer.
6. Signed payment sent, facilitator verification, actual final onchain settlement.
7. HTTP/MCP resource delivered; canonical receipt reconciled.

The first four do not entail the fifth, sixth or seventh. x402 [issue #3226](https://github.com/x402-foundation/x402/issues/3226) reports a real verify-only request yielding Bazaar processing without proving settlement or final catalog publication. x402 [issue #3657](https://github.com/x402-foundation/x402/issues/3657) reports a real lost buyer due to GET-discovered signed retries against a POST-only payment endpoint. That provides concrete original problem evidence for METHOD, quote, buyer-policy, settlement, delivery and effective conversion as distinct UX states. No double-charge retry when settlement is indeterminate: use canonical facilitator/ledger receipt reconciliation.

Preserve amounts as atomic-unit strings, network CAIP2, signed payer/payTo and actual route method. Upstream x402 Stellar exact support cannot be labeled upto live without actual supported scheme proof. A seller-supplied string cannot grant wallet signing authority.

**Acceptance:** ordinary client learns real allowed method and pays on an owner-authorized Stellar testnet endpoint; record original accepted input and actual separate ledger/delivery receipts, price/asset/network authorization proof and failure recovery. No hardcoded mock success, no out-of-band fabricated producer source and no unapproved mainnet/funds.

## Proposed integration boundary contracts (future, not source exports)

| Contract | Trusted inputs | Rejection & output |
| --- | --- | --- |
| SellerDeclaration.v1 | real original bytes/SHA, sourceURL, observedAt, candidate envelope, operator permission | bounded schema, SHA and source provenance; no catalog write on reject |
| OperatorAuthority.v1 | actually verified signer/sellerId, Sets allowedOrigins/Recipients/Networks/Schemes and canonical network scheme support | explicit allowed policy object for SF-27 or quarantine; no implicit inferred identity |
| IdentityMapping.v1 | SF-28 accepted/fallback record and authoritatively bound seller, method, source | versioned logical key plus private PR451 and SF21 projection key mapping |
| CatalogCommit.v1 | staged authorized candidate, monotonic sequence >0, original source digest, committed journal transaction | either both active search/history states updated or neither, with source audit |
| DiscoveryRead.v1 | read-only GET /discovery/resources or /discovery/search, normalized filters and stable pagination/freshness policy | bounded results, explicit stale metadata and original status; 400 invalid/stale cursor, 405 writes |
| BuyerIntent.v1 | human-authorized signer and spend constraints, method, max amount, asset, network, seller binding | policy denial without sign, or canonical SDK invocation with stable intent id |
| CommerceOutcome.v1 | canonical settlement authority, transaction finality, separate delivered result | verified unsettled/settled/fulfilled/indeterminate distinguishable; no blind paid retry |

These are a coordination RFC for SF-46, *not* classes that already exist. The product must not expose write endpoints or publish SDK-level paid agent capabilities until each boundary has actual accepted original-source behavior.

## Source-backed self-host/ops design

Initial operator topology: Node 22+ current PR451 catalog with only safe GET read routes, source-authorized ingestion separate, SF27/28 gate and SF21 history behind a durability adapter yet to be implemented. Prefer portable open storage, versioned migration/export, no private-key custody inside a searchable catalog process, opt-in seller corrections and authenticated retirement. TLS/rate limits/operator access control and backups are deployment responsibilities, not shipped by current Node example. Observability should separately count source-observed, verified, indexed, settled and fulfilled; do not call verify-only events completed purchases.

Real corpora must come from seller-permitted sources or existing owner-approved upstream snapshots with original URL/bytes/time/hash. SF-24 and Muse can compare lexical baseline to enhanced search on the SAME original frozen queries and candidates, report relevance and latency/error/cost evidence at realistic source volumes. Arbitrary corpus truncation is not necessary and must not be mislabeled full ecosystem coverage. Direct live paid API calls remain gated by actual operator approval.

Upstream license and protocol drift: x402 and stellar/x402-stellar LICENSE were verified Apache-2.0; original local source README reports MIT. Preserve notices, maintain pinned current upstream SDK/spec versions and reject unknown discovery/history schema versions. SCF source wants self-host, public development/maintenance and a clear reason for any centralized operator. Costs/tranches must come from SF-47's real-future-only plan with SF-08 actual quotes, not reimburse previous swarm research.

## Hand-off tasks and exact completion condition

**SF06-INT-01 → SF-46 / SF-28 / PR451 owner:** stable logical resource key, source-aligned current wire meaning and cross-projection adapter. Acceptance: deterministic method/query/MCP/route collisions under original module imports.

**SF06-INT-02 → SF-46 / SF-21 / SF-27:** canonical authority and atomic two-view durable commit/rollback after simulated process failure; no late-update catalog pollution. Acceptance: real crashed/recovered snapshots always agree on seller, accepted revision, confidence and source digest.

**SF06-INT-03 → SF-36 & SF-33:** user intent, spend maximum, caller/network/payTo binding, idempotency and settlement outcome reconciliation as a real consumer, not a facade. Acceptance: unauthorized spend denied before sign; indeterminate payment never resubmitted blind.

**SF06-INT-04 → SF-43:** real normal agent discovers and pays seller-approved testnet API with actual signed x402 Stellar settlement and delivered resource; capture precise original-sdk version, fee and receipts. No mainnet before separate owner approval.

**SF06-INT-05 → SF-24/41/42/Muse:** full original available corpus paired search evaluation, degradation/recovery, stale-cursor and metadata poisoning risk, confidence labels; per-source hash and p50/p95 measured where possible, no invented success numbers.

**SF06-INT-06 → SF-44 / SF-49:** update genuine cold-start docs after integrated release; opt-in seller onboarding, noncustodial operator change/delete/export, maintenance and accurate cost burden. No external messages or grant form until owner approval.

**SF-46 has integration authority; SF-06 is design completed.** Do not override previously claimed SF-21/27/28/33/36/43 work, hand over specific differences to their authors. No code/test/workflow launched by this architecture packet.

## Primary authoritative documents

- Current [Stellar SCF RFP Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track), RFP requires recent stable Stellar, source license, architecture visualization, maintenance and decentralization discussion; listed July 23 Q3/#45 does NOT establish Q4/#46 eligibility.
- Current [SCF Build Budget and Deliverable Guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines) says architecture must be ready before application, not reimbursed as tranche 1 retroactive work.
- The five original public implementation/readme refs and exact SHA pins above are source of truth for **currently existing** capabilities, separate from proposed wire contracts.
- This document was prepared with public source only; no private Commons source, provider contract, seller access, grant submission or live payment touched.
