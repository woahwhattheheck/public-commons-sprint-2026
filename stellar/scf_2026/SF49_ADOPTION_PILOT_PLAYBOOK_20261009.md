# SCF SF-49 — authentic adoption, pilot qualification and open-source sustainability

**Operation:** SCF-STARFORGE-20261009 / SF-49 — delivered as PUBLIC market/product research, not an award submission.  
**Source-custody date:** October 9, 2026 (EDT), provider GitHub REST timestamps may be October 10 UTC.  
**Companion:** [nine-record source-readable issue ledger](./SF49_PUBLIC_SIGNALS_20261009.json).  
**Downstream:** SF-05 competition prior art, SF-09 funding/track gates, SF-08 economics, SF-21–40 distinct technical implementation owners, SF-41/42 real-source benchmarking and SF-46 product integration.  
**Current authority:** research and public software only. **NO** new outreach, grant forms, application, external demo, Michael Clark contact, bounties, former competitions, private repository writes, new workflows/GitHub Actions, mainnet transactions or money movement.

## 1. Product and commercial adoption decision

A world-class Stellar x402 Bazaar wins only if an actual seller and buyer can **discover the intended offer, understand its true cost, authorize it within a real policy, successfully pay, and receive the intended result**. The upstream already has Apache-2.0 `x402` and `x402-stellar` source; SCF #45 already funded three overlapping facilitator/Bazaar grantees. Selling a generic cloned facilitator to the same ecosystem would duplicate effort and obscure useful business differentiation.

Our defensible **open core** is *agent commerce checkout assurance*: original-source catalog/search + stale/malformed listing detection + seller-controlled verification + x402/Stellar wallet/price correctness + noncustodial budget-policies + clear settle-versus-deliver evidence and optional self-host / commercially supported operator packaging. The product must compose with canonical x402 SDKs and not assert that unbuilt or nonworking features are shipping.

**Concrete value proposition to validate, not a revenue claim:** detect the state where "discovered and online" does **not** imply "an agent can purchase and consume the advertised endpoint." This was described by an actual reporter in [x402#3657](https://github.com/x402-foundation/x402/issues/3657), including a reported lost paying buyer. This is a self-reported production account, not an independent reproduction or a buyer's signed statement.

## 2. Source-audited adoption signals (not permission to contact)

All nine records were retrieved from native first-party GitHub Issues metadata/text, with current issue state and original reporter claims; detailed evidence, impact, non-overlapping owner route and pending verification live in the [companion JSON](./SF49_PUBLIC_SIGNALS_20261009.json). Source freshness and issue state are recorded separately from defect resolution and customer status.

| ID and source | Actual reported problem | Commercial diagnostic hypothesis | Verified customer / operator status |
| --- | --- | --- | --- |
| [x402#3657](https://github.com/x402-foundation/x402/issues/3657) **OPEN** | Reporter ran paid routes in production; GET-origin payment retries to POST-only server reportedly lost the only buyer. | *Checkout conversion audit:* one real route x challenge x signed-retry method cross-product; catch paid retries rejected by method policies. | Real reporter self-account; **no contract/consent/ownership verification** |
| [x402#3511](https://github.com/x402-foundation/x402/issues/3511) **OPEN** | Same public paid endpoint's GET probe shows an invalid GET+body schema while POST probe gives valid POST schema; reporter describes agent failure. | *Bazaar schema repair:* stable schema independent of crawler probe and actual executable input contract. | Public issue; named endpoint is **not verified as reporter-owned** |
| [x402#3121](https://github.com/x402-foundation/x402/issues/3121) **OPEN** | `mcp://tool/name` may be mangled to `null/name` in Bazaar canonical URL extraction. | *MCP discoverability audit:* lossless URL normalization; real MCP tool list round-trip. | Technical issue only, no merchant |
| [stellar#55](https://github.com/stellar/x402-stellar/issues/55) **OPEN** | A Stellar testnet paywall's default price display seems one decimal out; minimal setup and screenshot given. | *Price-parity preflight:* shopper USD/USDC display, atomic units and exact client requirements. | Technical reporter, not a verified buyer |
| [stellar#71](https://github.com/stellar/x402-stellar/issues/71) **OPEN** | Stellar `upto` request proposes SEP-41 approvals and documents fee/policy uncertainty. | *Metered agent API feasibility:* bounded intent/actual cost, fee sponsorship and authorization design. | Feature request only; no production commitment |
| [x402#3226](https://github.com/x402-foundation/x402/issues/3226) **OPEN** | A verify-only request produced Bazaar `processing`; issue flags metric provenance ambiguity and explicitly does **not** prove catalog publication. | *Discovery provenance layer:* distinguish submitted, verified, indexed, actually settled and fulfilled. | Protocol evidence only, stronger settlement/indexing assertion not made |
| [stellar#74](https://github.com/stellar/x402-stellar/issues/74) **OPEN** | Source-based Stellar paywall balance/trustline/wallet/receipt UX concerns, shown through scripted DOM checks. | *Wallet/readiness UX review* for real buyers, precise insufficiency warnings and honest receipts. | Public code review only |
| [x402#2942](https://github.com/x402-foundation/x402/issues/2942) **CLOSED** | Reporter says a CoinMarketCap API route failed to enter Bazaar despite successful settled payments while three same-configuration routes appeared. | *Historical indexing postmortem*, eventual publish confirmation and stuck-processing telemetry. | **CLOSED historical report**, reporter not verified as CoinMarketCap authorized representative; not active sales |
| [x402#3500](https://github.com/x402-foundation/x402/issues/3500) **OPEN** | Proposal for machine-readable disputes when automated agent spending violates user intent despite valid signature and successful settlement. | *Agent spend-intent guard:* deny overbudget calls before signing; clear reconciliation evidence. | Proposal, **no proven executed $5 payment** |

**Conversion ranking (not probability or revenue):** P1 practical checkout cases 3657/3511/3121/stellar#55; P2 protocol spend/provenance/wallet studies 71/3226/74/3500; P3 closed historical case 2942. These are nine technically grounded **research signals**, **zero verified consenting pilot customers**, **zero price quotes accepted**, **zero new outreach**. Do not treat a GitHub reporter, another project's bug, or a closed issue as a sales lead without owner and company verification.

### Independent buyer/seller research before any pilot pitch

For each record obtain: actual current protocol version and commit, date of last external observation, route permission/operator status, real impact indicators (buyer sessions, attempted signatures, actual settlement events), reliability of reported defect under *original* current source, decision-maker relation and willingness to opt in, known prior contact, ownership and competitive sensitivity. If issues are closed or affected implementation has changed, retire the pitch rather than exploiting stale data.

Cross-provider and cross-network comparisons must preserve the original payload, exact network, asset decimal rules, HTTP method, extension/scheme version, and actual observed transaction status. An injected fixture can prove code behavior locally but never substitutes for live seller conversion, chain finality or a user acceptance.

## 3. Repeatable deal-discovery workflow — operational case extraction

**Success pattern:** A cross-domain opportunity is identified **before the seller recognizes it**; the fleet verifies the buyer's actual need, identifies a plausible qualified implementer, demonstrates a distinctive fit and sustains useful information exchange until the founder takes direct ownership. This pattern matches the user-described Michael Clark opportunity, which reached a hot human handoff. The contemporaneous UIowa prospect was declined due to timing. Neither represents a signed invoice or cash receipt, and **Michael remains exclusively owner-held: NO contact or new external-demo post**.

**Process applicable to developer markets, procurement, grant-adjacent pilots and traditional commercial services:**

1. **Source original buyer demand, not a generic contact directory.** Collect public issuer RFP or a first-person technical problem; record immutable URL, retrieve date, exact requirements, deadline, code/version or original file SHA. Sample x402#3657 is an issued technical pain statement; not an RFP and not a buying request.
2. **Map the value chain.** Who owns the problem? Who controls purchasing authority? Who has verified delivery capacity? Who is the paid specialist/subcontractor? For Stellar: endpoint operator, wallet integrator, API merchant, agent runtime buyer, spec maintainer and hosting operator are distinct roles; do not interchange their consent.
3. **Qualify with explicit disqualifiers.** Payment requirement, first-party actual use, timing, deployment constraints, licenses, network risk and relevant team skills; mark unknowns. Institutional prospects additionally need documented insurance/vendor qualifications and a legally eligible prime. Red flags include scope already funded by SCF #45, wrong track, closed solicitation, unknown operator, stale issue, competing claimant and contact suppression.
4. **Generate a small proof **before** a pitch.** Original source/actual protocol contract -> reproducible technical acceptance/bug boundary -> narrow repair/benchmark with falsifiable outcome. A source-only demo is an exploratory tool until a real user authorizes their endpoint test.
5. **One-owner, one-message relationship gate.** Search shared Slack claimed IDs, connected sender mailbox threads, past replies/opt-outs, existing PR authorship and contact handoff, then choose ONE approved sender. Draft an exact body for Bryce review; **do not send** until recipient, body and authority expressly released. Never use a generic mandate to contact Michael or write in the paused external demo.
6. **Advance stages only with actual receipts.** `DISCOVERED` -> `FIRST_PARTY_EVIDENCE` -> `PROVIDER_FIT` -> `OWNER_REVIEW_UNSENT` -> `SENT` -> `REPLIED` -> `QUALIFIED_HOT` -> `SCOPE_ACCEPTED` -> `CONTRACTED` -> `DELIVERED` -> `INVOICED` -> `PAID`. Keep earned-but-unbilled and invoiced-but-unpaid separate.
7. **Preserve the handoff.** Identity/role of a human buyer, evidence for acceptance, permission to follow up, next exact step, potential upside, conflicts/deadlines. Owner takes over relationship at appropriate stage. Multiple seats can research distinct companies but must not send competing pitches or assume relationship ownership from discovery alone.
8. **Feed real outcomes back** into prioritization: first-party demand density, response/close rate, cost per qualified lead, delivery gross margin, median days to reply and repeat service demand. Report denominators and UNKNOWN (not 0); never attribute revenue solely because a promising lead exists.

**Value-priced offers to validate, not price promises:**
- *A. Seller discoverability and payment readiness audit:* contract/invoice only if buyer agrees. Includes route/method challenge, catalog reconciliation, price clarity and post-settlement explanation with source-exact evidence; non-custodial, no live funds moved without operator permission.
- *B. Stellar marketplace/MCP integration:* new seller can make a legitimately priced resource discoverable and purchasable by an ordinary agent on actual allowed network; vendor-specific compatibility costs itemized.
- *C. Managed index/provenance and support:* opt-in sellers, per-resource history, filter/rank reliability and audit events; transparent self-host substitute.
- *D. Procurement/partner matching service outside crypto:* buyer RFP original-file custody + qualified implementation-partner sourcing + independent paid QA package, with customer-facing offers only after founder approval and credible provider.

The fleet already shipped source-grounded Catawba ERP, Springfield EAM, Saugatuck and related buyer→implementer studies. Their status is research/proposals until actual agreement and payment receipts. This playbook **does not reclaim** any of those original vendor workstreams.

## 4. Pilot queue — distinct evidence-to-product handoffs

### Pilot H1 — checkout end-to-end truth for real HTTP-method failure

**Research source:** x402#3657, open with detailed production account. **Original test hypothesis:** a GET-catalogued paid route may be healthy and return 402, but a payment-carrying retry method fails, losing actual willing buyers.

**Handoff (owner-approved after operator permission):** produce read-only route/schema observation, native x402 client plan with both original GET and intended POST semantics, seller-controlled no-funds mock first, then a real separately authorized testnet transaction only if a seller is verified and a protocol path permits. Emit a bounded trace `discovered/quoted/intent-approved/signed/verified/settled/delivered`, precise method and encoded payment header, and explanatory seller remediation. Actual seller-run traces cannot be invented or generated against arbitrary third-party paid endpoints.

**Owner/collision:** SF-25/26 protocol/MCP and SF-31/35 buyer guardrail owners build components; SF-49 owns evidence-based willingness and adoption research only.

### Pilot H2 — catalog input/schema and MCP discoverability compatibility

**Research sources:** x402#3511 and #3121, both open. **Hypothesis:** canonical method and URL drift can make an indexed endpoint impossible for an agent to call.

**Handoff:** source-pinned Bazaar `info.input` validation by method; preserve `mcp://` URL meaning; compare advertised schema against actually allowed method and original endpoint specification; record URL identity, submitted/published status, provisional/verified metadata and freshness. Produce a seller-reviewable diagnosis using genuinely observable HTTP/MCP payloads and an independent fixed-upstream comparison.

**Owner/collision:** distinct SF-21–30 discoverability owners implement; SF-49 qualifies legitimate operators and routes genuine adoption.

### Pilot H3 — Stellar-specific buyer checkout confidence

**Research sources:** stellar#55 and #74, both open. **Hypothesis:** displayed USDC/fee/trustline/signer status differs from exact price and real purchase capability, making sellers lose users.

**Handoff:** original exact-price decimal parity, ledger trustline preflight, wallet interop, sponsorship flag truth and actual receipt/failed purchase message. Canonical Stellar source/SDK version pinned; no claim that public issues remain unfixed in newer code until readback.

**Owner/collision:** SF-15, SF-16 and SF-17 own core fixes. SF-49 owns research-to-adoption evidence.

### Pilot H4 — enterprise policy before an agent is allowed to pay

**Research sources:** stellar#71 and x402#3500. **Hypothesis:** metered services need a defensible `upto` limit and user-intent policy, not just valid blockchain settlement.

**Handoff:** match allowed asset/network/seller with budget ceiling, trace actual vs authorized price, reject price drift, record auditable decision and exact canonical scheme support. Do not replace signed crypto receipt with internal log or represent illustrative $5 charges as real incidents. Initial research uses public protocol source only.

**Owner/collision:** SF-31–40 `upto`/security work owners; SF-49 handles consent-driven discovery.

## 5. Open-core engineering and governance charter

**Licenses and reuse:** [x402 Foundation LICENSE](https://github.com/x402-foundation/x402/blob/main/LICENSE) and [Stellar x402 LICENSE](https://github.com/stellar/x402-stellar/blob/main/LICENSE) are Apache-2.0 at current observed blobs `b09cd7856d58590578ee1a4f3ad45d1310a97f87` and `ece1adf90dce5e3c0b1abff7facfc978216293bb`. Publish novel own interfaces under a compatible permissive license after explicit maintainer selection; preserve upstream copyright/license and attribution, never import incompatible AGPL relayer code into the required product. Technical upstream contributions need normal owner/reviewer authorization. Link RFP and core specs; no private Commons source exported.

**Boundaries:** discovery/catalog adapter, canonical SDK execution adapter, wallet/policy layer, evidence/receipt layer, operator backend, and SDK/CLI must have stable versioned contracts. Sell services/support without trapping sellers in proprietary receipts/indexing. Maintain a vendor-neutral export of approved resource metadata and owner-safe deletion mechanism.

**Stewardship proposal:**
- Responsible maintainer + named backup, one source-of-truth public repository for released library, artifact manifests and handoff ledger; preserve original PR authors and HEADs.
- Public proposal/RFC issue style, signed/tagged version boundaries and changelog with upstream x402 schema and Stellar network spec pin, deprecation window and backwards-compatibility contract.
- Trust/reporting policy: vendor must opt in to listing or give valid public permission; allow delisting, correction, seller endpoint verification, indexing-abuse limit and incident contact. Do not publish private keys, paid buyer data, private resource names or sensitive vulnerability disclosures.
- Security response: responsible private report path, ownership, severity and coordinated disclosure path once approved, no open PR exposing exploitable details. Spell out operational authority and escalation time windows before taking real user payments.
- Changelog of protocol differences and external issue references; precision for unsupported scheme/network/asset and stale licenses. Independent actual regression comparisons scoped to changed implementation; **no hosted Actions or broad CI suites**.
- Grant/cash separation: publish free self-host core and docs; optional support/managed hosting contracted separately, with billing and margin measured by actual SF-08 cost model. Vendor counts, user adoption, uptime and revenue must be independently observed.

### Operational measures and truthful vocabulary

| Measure / KPI | Definition | Present status |
| --- | --- | --- |
| Discovery coverage | Confirmed seller-permitted resources discoverable / seller-permitted canonical resources inventoried; exact cohort/date | UNKNOWN, no original opt-in merchant corpus acquired by this SF-49 seat |
| Listing freshness | `observation_at`, canonical source version/ETag; stale ratio over owner-approved set | UNKNOWN; design requirement |
| Paid checkout completion | Delivered resources with matching canonical settle receipt / actual explicit buyer purchase attempts | UNKNOWN; a GitHub issue is not a cohort |
| Catalog provenance | Advertised vs verify-processing vs indexed vs settled vs fulfilled mutually distinguishable in event schema | Research requirement, not deployed |
| Search precision/latency | NDCG@10, Recall@10, p50/p95 measured on same frozen actual labeled resources with evaluator source pins | UNKNOWN; SF-41/42 future experiment |
| Active users / integration partners | Confirmed consenting human/operator counterparties and actual use verified, not GitHub issue authors | **0 verified by this SF-49 seat** |
| Service/operator cost | RPC, storage, crawler, compliance, support and fee sponsorship by measured volume; SF-08 authoritative | UNKNOWN until measured |
| Closed revenue | Contract, invoice and settlement/provider receipt; kept distinct from forecast or lead value | **0 generated/verified by this workstream** |

Do not invent SLAs before service operates. Candidate *goals to negotiate* once measured: data age freshness objective, search p95 at named corpus size, actual success/error budget, private-key isolation, incident acknowledgment and rollback, offboarding/export. A stated target is not an achieved SLO.

## 6. Release and commercialization gates

1. **First-party contract:** current x402 Bazaar wire spec and Stellar SDK version pinned to actual immutable commit; zero hidden required workflows.
2. **Merchant permission and method semantics:** route owner and canonical methods/accepted amounts obtained with consent. No mass probing of third-party paid endpoints.
3. **Original-source search proof:** real allowed corpus, recorded source hash/provenance, frozen query judgments, paired baseline and candidate on identical original data, direct logs/errors.
4. **Checkout success:** a legitimately authorized testnet buyer pays for ordinary seller API and receives result through actual SDK/tool, or the exact missing component stays explicitly unshipped.
5. **Economics:** supported paid unit cost and buyer willingness evidence, separate from SCF award projections.
6. **Human applicant:** independent current SCF track and eligible human persons confirmed; forms stay owner-held.
7. **Contact control:** each outreach draft carries exact owner, buyer, personal suppression, previous relationship search, sender/recipient/body authorization, and measured product evidence; no sender acts from a general grant pivot order.
8. **Mainnet and funds:** operator/legal/security readiness + owner's explicit separate consent before external paid calls, custody, cloud purchases or contract commitments.

## 7. Ready-to-post independent fleet follow-ons (not competing claims)

These are **new suborders for authorization/coordination**, not instructions to overwrite original SF owners or contact firms.

- **SF49-ADOPT-01 — Payment conversion failure evidence, cross-protocol.** Research lead: source-exact, code-version-current comparison of x402#3657 plus x402#3511, identify seller method/schema acceptance gap and an actionable diagnostic format. Coordinate SF-25/26. Exit: runnable *no-paid-call* diagnostic plan with current original client behavior, expected versus observed discrepancy. No customer outreach.
- **SF49-ADOPT-02 — Stellar merchant friction and trustline price parity.** Research lead: genuine current main source review against stellar#55/#74 and whether upstream already corrected behavior. Coordinate SF-15/16. Exit: original mismatch/no-mismatch by current file blob and seller-focused proof of value; no duplicative patch.
- **SF49-ADOPT-03 — Public ecosystem adoption proof census.** Research lead: find five real opt-in Stellar seller APIs and five actual public agent integrations whose source/permission supports cataloging; preserve URL, source hash, current asset/network, rights, independent response and metadata. Coordinate SF-41/42; **do not** invent customers or automatically crawl private data. Exit: original-backed dataset and zero/unknown flags.
- **SF49-ADOPT-04 — Founder-approved commercial pilot conversion.** Business lead: after verified operator willingness, prepare one evidence-specific pilot scope, unit costs, noncustodial trust model and actual owner-held unsent message for two unique, unclaimed counterparties. Coordinate existing sales and suppression log. Exit: owner-reviewed *UNSENT* briefs; delivery/contact only on explicit release.
- **SF49-ADOPT-05 — Public maintenance/sustainability kit.** Maintainer lead: security policy template, independent release matrix, issue triage/protocol-drift ledger and self-host guide, all source-pinned; no Actions, hosted CI, or private repo. Exit: public drop-in maintainer docs with actual upstream versions and update checklist.

### UNSENT sample proof-focused technical introduction (not addressed, not delivered)

> Subject: x402 catalog-to-checkout failure evidence and a narrow fix  
> We have been studying public x402 checkout failures where a listing looks correct but a buyer's signed retry or schema fails. We're preparing a reproducible, source-versioned diagnostic that maps the advertised method, payment challenge, signed retry and delivered result. Before testing anything against a live endpoint, we'd like to confirm whether you are its operator and whether a read-only, explicitly scoped diagnosis would be useful. We can provide a short evidence packet and discuss optional repair/validation terms if there is a fit.

Use only if buyer/operator identity and professional route are **independently verified**, prior relationship and suppression screened, actual evidence is ready, and Bryce has approved the **exact** recipient/sender/message. No mass-send, implied affiliation, paid service without agreement or SCF funding representation.

## Source and decision boundaries

- Official SCF Build/RFP / current-quarter eligibility: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track (listed x402 RFP says Q3/#45; #46 applicability open, no contact)
- Official #46 round: https://communityfund.stellar.org/awards
- Official funded #45 recap: https://medium.com/stellar-community/scf-45-round-recap-1ecf281821ab
- Canonical x402: https://github.com/x402-foundation/x402
- Stellar reference: https://github.com/stellar/x402-stellar
- Relevant issue facts: nine current-issue-state source links in §2 and companion JSON
- SF-09 peer funding strategy: [merged main artifact](./SF09_TRACK_DECISION_20261009.md)

**Evidence quality:** This seat independently retrieved the native GitHub public issue metadata and full summaries and current LICENSE files. This is an actual public first-party problem census; it **does not** claim to have exercised production endpoints, compiled original x402 source, simulated Stellar settlements, validated operator identity, received permission to index, or won a client. Source statements derived from GitHub issues remain marked as reporters' claims pending independent tests. Downstream producers can and should build real exact-original-data acceptance proofs as soon as separate ownership/authorization and actual source availability permit; no arbitrary artificial sample caps.

**Separation:** SF-49 owns adoption truth and sustainable operator/lead process, not competing module patches, grant contact, vendor relationships or application. Done means the plan+issue-ledger were published, not that customer acquisition or commercial outcomes happened.
