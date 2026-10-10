# SCF SF-09 — grant-track decision and commercial positioning (UNSENT)

**Campaign:** SCF-STARFORGE-20261009 / SF-09  
**Source snapshot:** October 9, 2026 (EDT)  
**Owner:** GPT-6 cloud, distinct from SF-01 eligibility, SF-03 acceptance, SF-05 competitive census, SF-08 economics, and x402 product implementation.  
**Status:** Research/decision delivered. No interest form, grant application, partner contact, sale, fund transfer, mainnet transaction, or workflow executed.

## Executive decision

**Build a differentiated Stellar-native, agent-safe commerce discovery product now, but do not claim that the July 2026 x402 RFP is active for SCF #46.** Do not present a generic x402 facilitator/Bazaar clone as differentiated or grant-ready. Maintain two separate commercial and funding hypotheses:

1. **Product/business:** an open-source cross-facilitator discovery-quality layer with seller/price provenance, verified freshness, reproducible real-resource ranking, standardized MCP access, and configurable agent spending policy; run the actual canonical x402 Stellar SDK rather than rebuilding settled payment flow. Self-host by default; paid hosted operations/integrations only after verified cost and buyer interest.
2. **Grant:** RFP Track **only if the SCF team explicitly confirms** the specific x402/Bazaar RFP is current-quarter active for the invited submission; otherwise investigate Open Track **only for independently novel Stellar-native capability outside an RFP**, with demonstrated user need, team track record, and distinct utility. Integration Track is **not** a fallback for a greenfield developer tool without an existing product/user traction and a listed SCF integration. Earlier-stage incubation or a later quarter may be more realistic than shoehorning into the wrong track.

This is a **decision gate, not a submission instruction**. The owner's SCF-form/contact/submission hold remains in effect.

## First-party facts (as of October 9, 2026)

| Fact | Evidence | Consequence |
|---|---|---|
| SCF #46 Build submission deadline November 8, 2026; invitation after expression of interest | [SCF #46 round](https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg), [Build handbook](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award) | This is a **deadline for eligible invited submissions**, not proof a new applicant can directly submit now |
| RFP proposals must fit a **current-quarter open RFP** | [RFP Track handbook, Requirements](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track) | Application path fails if x402 RFP is no longer open in the relevant quarter |
| The still-visible x402/Bazaar RFP is introduced by **July 23, 2026 — Q3, SCF #45** | [same RFP document, current open RFPs](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track) | **No verified x402 RFP eligibility for #46**. SF-01 staged one exact clarification; do not send without owner authorization |
| SCF #45 already awarded x402/Bazaar work: Rail402 $125,000, AgentSmith x402 $122,000, Rumble Fish $78,000 | [Official Stellar Community SCF #45 recap, Sep 23](https://medium.com/stellar-community/scf-45-round-recap-1ecf281821ab) | $325,000 in XLM-valued awards across three relevant funded teams; facilitator replication has significant prior-art and funding overlap |
| Existing exact settlement already supported by Apache-2.0 `@x402/stellar`; RFP explicitly prioritizes the Bazaar, agent interfaces, `upto` and conformance | [x402 RFP §§1–5](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track), [upstream x402](https://github.com/x402-foundation/x402), [Stellar reference](https://github.com/stellar/x402-stellar) | New code should focus on persistent unsolved discovery/buyer problems and wire-level interoperability, not reimplement existing settlement |
| Open Track expects novel products, strong team, onchain value, market analysis and verified evidence | [Open Track handbook](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/open-track) | Open Track cannot be treated as a label change for an RFP clone. Its criteria include disclosure obligations regarding AI-assisted artifacts for an eventual application |
| Integration Track requires existing traction and a listed building block; majority integration-focused budget; final 40% award tranche tied to a credible, panel-ratified onchain metric | [Integration Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track), [current integration list](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track/integration-list) | A brand-new developer discovery engine is not currently an established fit; do not invent existing customers or an integration |
| Reviewer sees only the submission; needs complete, self-contained technical details, deliverables, budget and evidence; non-qualifying submissions prescreened | [Build submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria) | Future draft must contain concise primary evidence itself, not outsource core claims to links |
| Team or organization must authorize an eligible natural-person representative and at least two eligible individuals for listed participation; KYC/KYB compliance applies | [Official rules §1](https://stellar.gitbook.io/scf-handbook/scf-awards/official-rules-for-submissions), [Build eligibility](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award) | Many software-agent seats are **not** substitutes for human eligibility. No assertion is made that this requirement is fulfilled |

## Grant-path gate matrix

| Path | Product fit | Submission gate | Recommendation |
|---|---|---|---|
| **RFP #46 — x402/Bazaar** | Technically strongest if still invited/current-quarter, but three teams funded for same RFP #45 | Current-quarter status verified by SCF; invitation; original technical/conformance delta; eligible human team | **CONDITIONAL / HOLD** until actual confirmation |
| **Open #46** | Possible **only** for a distinct product that enables demonstrable onchain user value beyond already-funded x402 plumbing | Novel non-RFP scope, validated need, real product evidence, appropriate team history and market analysis; invitation; community vote | **SECONDARY CONDITIONAL**; do not disguise RFP tooling |
| **Integration #46** | Poor for fresh developer tool | Existing product traction, selected current Integration List item, credible attributable onchain final-tranche threshold | **NO-GO** for current greenfield Bazaar thesis; revisit only if genuine traction and integration emerge |
| **Local Instawards / incubation** | Possible early execution route if founders are new to Stellar | Local Ambassador Chapter relationship, ongoing community participation, chapter-driven opening; owner contact approval | **LATER**; not an instant substitute or open form |
| **Later-quarter RFP** | Plausible if the ecosystem renews or opens a new RFP around cross-provider discovery/agent controls | New posted RFP/quarter and invitation, evidence of unmet need despite funded incumbents | **CONTINGENCY**; build evidence independent of speculative future award |
| **Pure commercial business** | Open-source self-hosted core + usage-priced managed search/verification and paid integration work | Measured cost, actual willing customers, operator safety and legal review | **PARALLEL PRIMARY**; do not depend on grant receipt |

## Proposed defensible product boundary

**Working concept:** *Stellar Discovery Trust Layer* — interoperable resource search and buyer-side decision support across canonical x402-compatible catalogs, with Stellar-first asset/network/fee/spending semantics.

**Features to prioritize, distinct from funded facilitator replicas:**
1. **Search relevance:** ingest *real opt-in public* HTTP and MCP resource metadata; provenance-preserving normalized records; reproducible lexical baseline; natural-language ranking with measurable relevance and failure categories. Report NDCG@10, MRR, Recall@10, query p50/p95, empty-result and broken-link rates against a frozen, original-source corpus. This is an evaluation plan, not completed metric claims.
2. **Freshness and seller proof:** canonical URL / owner evidence, observed endpoint status, metadata timestamp, price/asset/network consistency, seller-controlled opt-in and update path. Treat unverified metadata as unverified; no automatic claims of seller identity.
3. **Buyer safety:** agent policy checks *before* a paid call (allowed networks/assets, estimated cap, rolling budget, seller allowlist, dynamic-price drift, disallowed methods, idempotent intent). A signed settlement outcome must still be checked with the canonical SDK; a policy engine is not a wallet, facilitator or escrow.
4. **Multi-Bazaar compatibility:** import/export schema/version boundaries; x402 spec filters and pagination; MCP tools discover and pay with structured errors. Preserve canonical `GET /discovery/resources`, `GET /discovery/search`, automatic cataloging and `EXTENSION-RESPONSES`; never falsely mark them conformance-complete until end-to-end verified.
5. **Self-host:** local Postgres/SQLite-backed open core and portable search adapter; privacy-friendly deploy/runbook; optional paid managed host. Do not place an AGPL relayer dependency into the RFP-target path.
6. **Source-exact conformance:** separately maintain upstream protocol commit, dependency versions, real payment/ledger receipts for each required network/scheme where permitted; do not fabricate a testnet or mainnet transaction. Later production acceptance checks need user-authorized external credentials/funds and focused checks for the affected behavior.

**Novelty falsifiers (trigger pivot rather than a cloned grant pitch):**
- Funded competitors already ship equal or better multi-provider discovery quality, metadata provenance and buyer policy, under usable licenses.
- No owner-controlled seller allows indexing, or independent real users do not find the product useful.
- Search gains vanish on a held-out original corpus or degrade freshness/precision.
- Development costs and operated service economics cannot be sustained without continued awards.
- Current RFP is closed and the only technical deliverable is a generic tool covered by an already-funded project.

## 1:1 evaluation and adoption protocol

1. **Corpus:** collect seller-permitted original listing URLs, HTTP 402 discovery-extension payloads, MCP tool metadata and price/asset/network declarations. Record URL, retrieval time, original content hash, version/commit if applicable, permission status, stale/invalid evidence and raw original metadata. No invented traffic or hand-coded pretend real sellers.
2. **Baseline:** use existing production-equivalent canonical Bazaar discovery implementation or stock x402 client where supported; pin source and wire response. A static hand-made fixture can exercise a local parser, but never becomes a claimed real-world ranking benchmark.
3. **Query relevance:** use real public documentation/capability texts and independently judged intended resources; report paired original queries and same candidates, same metric implementation. Run broad, genuine Muse sweeps if beneficial; prohibit shifting datasets, post-hoc cherry-picking and fake provenance.
4. **Product acceptance:** independently demonstrate seller metadata -> facilitator or catalog ingestion -> searchable entry -> agent discovery -> permitted paid call -> canonical settlement (testnet first) and structured failure paths. One network/scheme never stands in for both. Exact receipts and source versions required before saying complete.
5. **Commercial buyer discovery:** identify 10 publicly grounded sellers/integrators with concrete discovery, catalog-maintenance or agent-payment friction, then rank 3 potential pilots by integration cost and buying authority; prepare owner-review unsent approaches. **No automated outreach, personal commitment or claimed pilot until approval and actual consent.**

## Proposed milestone envelope (not a priced grant request)

Actual grant budgets and human execution obligations are **unverified** and must not be fabricated. SCF Build allows up to $150,000 in XLM-valued awards and requires costed measurable tranches; this is an engineering sequencing proposal, not an award or entitlement.

- **Pre-award:** source-pinned design and software ownership; working retrieval/normalization on real permitted corpus, preliminary benchmark, developer guide; human applicant eligibility and an invited track.
- **MVP / tranche 1 candidate:** deployable open catalog/search implementation, real listing import, ranking comparator, provenance/price freshness, reproducible dev demo.
- **Testnet / tranche 2 candidate:** authentic Stellar x402 testnet test, signed noncustodial wallet interop where authorized, threat model, performance, error taxonomy and monitoring; paid MCP agent prototype.
- **Mainnet / tranche 3 candidate:** reviewed security, actual user-tested integration, documented support/maintenance, real operator costs, canonical network/scheme receipts only if authorized and performed. Integration Track, if chosen, has an additional onchain success-metric condition; cannot substitute a launch checklist for it.

Budget authoring rule: allocate distinct human engineering, indexing/hosting, security and operational work by traceable hours/rates and primary quoted costs, mark missing inputs UNKNOWN rather than zero; separate optional paid hosted service revenue from grant spending. SF-08 independently owns the cost model.

## Commercialization while grant eligibility is uncertain

**Offer A — Discovery audit:** compare a merchant's real x402/MCP endpoint discoverability across public catalogs, identify bad metadata, broken routes, non-searchable services, missing price context and agent purchase friction. Deliver fixed-price evidence/repair plan; no promise of grant funding.

**Offer B — Agent commerce integration:** package seller onboarding, real discoverability and budget-controlled agent calls as an implementation service, with open components and clear operator controls.

**Offer C — Managed index/operator:** sell SLA-backed indexing/search and developer support after actual capacity costs, privacy, abuse and incident response are established. Permit self-hosted or customer-run alternatives and avoid custodial payment handling.

Proof of demand is a signed customer commitment or actual observed use, not a Slack work order, GitHub stars, a demo fixture or a grant proposal. Cross-sell only with explicit buyer permission and human-approved terms.

## Reviewer red-team / objections

- **"Why fund another x402 Bazaar when three already won?"** Answer only with a demonstrated, measurable cross-provider discovery/agent policy gap; otherwise do not request grant.
- **"Is this x402 RFP open for #46?"** Currently unverified. Its posted heading states Q3/#45; SF-01 has an UNSENT clarification. No application until owner authorizes and current-quarter eligibility is resolved.
- **"Who is the applicant and accountable human team?"** Unknown until actual authorized eligible individuals, business status and required event availability are confirmed. Software agents are not legal applicant representatives.
- **"Show traction and market need."** Publish source-verified independent seller/buyer use and relevance before citing any as adoption. No invented metrics.
- **"How does Stellar materially improve it?"** Correct Stellar asset/CAIP-2/fee/authorization behavior, real canonical x402 payment path and validated onchain outcomes, not simply an index database with a Stellar brand.
- **"What if grant is declined?"** Keep the open core useful and seek licensed professional integration/hosted revenue only after buyer validation.
- **"Are the budget and milestones credible?"** Require SF-08 first-party unit economics, per-person allocation and acceptance criteria; never infer approval of 3–5 months of work from application limits.
- **"Why trust this search engine?"** Show corpus provenance, independent rankings, stale-price handling, integrity tamper outcomes and permission controls.

## Owner-held decision checklist

- [ ] Bryce approves **whether** SCF contact/interest submission is permitted; current state HOLD.
- [ ] Confirm the applicable **current-quarter RFP** from SDF before any RFP claim.
- [ ] Confirm authorized eligible human representative and at least two eligible participating individuals, organization/KYC facts and IP ownership.
- [ ] Merge SF-03 traceability, SF-05 funded-competitor delta, SF-08 economic assumptions and separate producer code into one real demo/readme.
- [ ] Gather genuine opt-in sellers, independently judged original query corpus, current upstream x402 versions and target metrics.
- [ ] Verify Source ownership, software license, tool dependency licenses, noncustodial constraints and audit scope.
- [ ] Use one owner-approved and complete **UNSENT** reviewer packet; no interest form, full application, marketing promise or financial action until separately released.

## Official sources

- SCF #46 round: https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg
- Build guidance: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award
- RFP scope / quarter: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track
- Open Track: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/open-track
- Integration Track: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track
- Integration List: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track/integration-list
- Submission criteria: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria
- Official eligibility: https://stellar.gitbook.io/scf-handbook/scf-awards/official-rules-for-submissions
- SCF #45 recap (first-party author): https://medium.com/stellar-community/scf-45-round-recap-1ecf281821ab
- x402 upstream: https://github.com/x402-foundation/x402
- Stellar x402 reference: https://github.com/stellar/x402-stellar

**Source and scope note:** These are public rules and public reference materials, not user-specific account verification; every go/no-go condition is labeled. This artifact contains no private Commons source, personally identifying lead data or credentials. GitHub publishing actor is connected @woahwhattheheck because both presently available GitHub credentials resolve to that account; routine @tokenjunkielabs was not available in this session. No Actions/workflows created or invoked.
