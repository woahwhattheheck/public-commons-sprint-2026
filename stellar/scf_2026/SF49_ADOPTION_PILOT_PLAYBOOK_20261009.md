# SCF SF-49 — Merchant adoption, paid implementation and open-source sustainability

**Operation:** SCF-STARFORGE-20261009 / SF-49.  
**Updated:** October 11, 2026.  
**Purpose:** Run the commercial adoption process for the existing Stellar product, and provide the market case for the original SF10 application. The same merchant relationship and original implementation owners continue through delivery and payment.

This playbook supports authorized outbound sales. Use the current owner instructions and the existing private contact record to select the sender, preserve explicit contact exclusions, and avoid a second first-contact message. A historical research-only scope in this file is not a current stop on outreach, internal publication, or completion of authorized work. Customer terms, correspondence, personal relationship history and receiving details belong in the existing private commercial record.

## 1. Customer, job and product

The first customer is an API or data-service operator who already has a useful, legally distributable resource and wants to sell its use to agent applications. Its engineering lead needs a paid operation that works from its current application through the customer's actual client; its commercial lead needs an offer, measured delivery effort and a support model. The second customer is an agent application operator that wants to acquire those resources under a persistent spending policy and keep the purchased output usable after its process or connection stops.

Start with the customer's existing operation. Preserve its selected method, request schema, data access rules, asset, recipient and price. Reuse the original product to join:

| Customer task | Existing source to use | Deliverable for the customer |
| --- | --- | --- |
| Offer an existing API operation | [SF61 OpenAPI importer](../scf-starforge-20261009/sf61-openapi-seller-import/) and [SF30 upstream bindings](../scf-starforge-20261009/sf30-seller-sdk/UPSTREAM.md) | An operation connected to the merchant's application, with its actual input and payment terms |
| Sell permitted data queries | [SF30 dataset API](../scf-starforge-20261009/sf30-seller-sdk/DATASET_API.md) and [read-only SQLite source](../scf-starforge-20261009/sf30-seller-sdk/sqlite/) | Configured fields, filters, pagination and resource limits for the merchant's approved data |
| Make the operation discoverable | [SF60 durable catalog](../scf-starforge-20261009/sf60-durable-catalog-transaction/), [SF73 seller admission](../scf-starforge-20261009/sf73-pinned-seller-admission/) and [SF95 withdrawal](../scf-starforge-20261009/sf95-signed-seller-withdrawal/) | A source-preserved listing that the seller can manage and retire |
| Acquire and keep the output | [SF88 operator buyer](../scf-starforge-20261009/sf88-operator-buyer-cli/) and [SF100 dataset delivery](../scf-starforge-20261009/sf100-buyer-dataset-delivery/) | A reviewed request, durable intent and budget handling, delivered bytes and usable dataset export |
| Reconcile payment and fulfilment | [SF86 transaction reconciliation](../scf-starforge-20261009/sf86-rpc-transfer-reconcile/), [SF98 delivery outbox](../scf-starforge-20261009/sf98-merchant-delivery/) and [SF101 merchant receiver](../scf-starforge-20261009/sf101-merchant-receiver/) | Original transaction evidence linked to the merchant order and the delivered resource |
| Operate and support the service | [SF30 operations](../scf-starforge-20261009/sf30-seller-sdk/operations/), [SF93 support bundle](../scf-starforge-20261009/sf93-seller-support-bundle/) and [SF101 recovery](../scf-starforge-20261009/sf101-merchant-recovery/) | Customer-owned operations, incident diagnosis, export and recovery procedure |
| Review the commercial outcome | [SF77 workorder](../scf-starforge-20261009/sf77-merchant-workorder/) and [SF97 pilot conversion](../scf-starforge-20261009/sf97-merchant-pilot-conversion/) | The original agreed scope, delivery decisions, actual cost assumptions and acceptance record |

These are released source components. A customer deployment establishes the combined product outcome through the customer's actual source, configuration, authorised transaction and result. A collection of component names, local checks or successful merges does not establish an installed commercial service.

**Commercial hypothesis:** the customer buys reduced integration and operating effort. It can keep an existing subscription or API-key product and add an explicitly scoped pay-per-use route where that serves a real buyer. Charge for implementation, accepted migration work, integration support and maintenance; preserve the free self-hostable product. Validate willingness to pay from the actual operator and its purchasing process.

## 2. Public demand signals and their observation dates

The [nine-record companion ledger](./SF49_PUBLIC_SIGNALS_20261009.json) remains the original October 9 research snapshot. The first row and PR3741 were rechecked on October 11; other eight issue states retain their October 9 date. These are technical research sources. Their authors, endpoints and organisations are not automatically customers or current outreach targets.

| ID and source | Actual reported problem | Commercial diagnostic hypothesis | Verified customer / operator status |
| --- | --- | --- | --- |
| [x402#3657](https://github.com/x402-foundation/x402/issues/3657) **OPEN issue; author-reported repair** | Historical method mismatch; author reports repaired GET acceptance and Base mainnet settlement. | *Historical interoperability case:* learn from independent-client coverage; do not pitch the repaired failure. | Self-report, not our reproduction, consent or customer |
| [x402#3511](https://github.com/x402-foundation/x402/issues/3511) **OPEN** | Same public paid endpoint's GET probe shows an invalid GET+body schema while POST probe gives valid POST schema; reporter describes agent failure. | *Bazaar schema repair:* stable schema independent of crawler probe and actual executable input contract. | Public issue; named endpoint is **not verified as reporter-owned** |
| [x402#3121](https://github.com/x402-foundation/x402/issues/3121) **OPEN** | `mcp://tool/name` may be mangled to `null/name` in Bazaar canonical URL extraction. | *MCP discoverability audit:* lossless URL normalization; real MCP tool list round-trip. | Technical issue only, no merchant |
| [stellar#55](https://github.com/stellar/x402-stellar/issues/55) **OPEN** | A Stellar testnet paywall's default price display seems one decimal out; minimal setup and screenshot given. | *Price-parity preflight:* shopper USD/USDC display, atomic units and exact client requirements. | Technical reporter, not a verified buyer |
| [stellar#71](https://github.com/stellar/x402-stellar/issues/71) **OPEN** | Stellar `upto` request proposes SEP-41 approvals and documents fee/policy uncertainty. | *Metered agent API feasibility:* bounded intent/actual cost, fee sponsorship and authorization design. | Feature request only; no production commitment |
| [x402#3226](https://github.com/x402-foundation/x402/issues/3226) **OPEN** | A verify-only request produced Bazaar `processing`; issue flags metric provenance ambiguity and explicitly does **not** prove catalog publication. | *Discovery provenance layer:* distinguish submitted, verified, indexed, actually settled and fulfilled. | Protocol evidence only, stronger settlement/indexing assertion not made |
| [stellar#74](https://github.com/stellar/x402-stellar/issues/74) **OPEN** | Source-based Stellar paywall balance/trustline/wallet/receipt UX concerns, shown through scripted DOM checks. | *Wallet/readiness UX review* for real buyers, precise insufficiency warnings and honest receipts. | Public code review only |
| [x402#2942](https://github.com/x402-foundation/x402/issues/2942) **CLOSED** | Reporter says a CoinMarketCap API route failed to enter Bazaar despite successful settled payments while three same-configuration routes appeared. | *Historical indexing postmortem*, eventual publish confirmation and stuck-processing telemetry. | **CLOSED historical report**, reporter not verified as CoinMarketCap authorized representative; not active sales |
| [x402#3500](https://github.com/x402-foundation/x402/issues/3500) **OPEN** | Proposal for machine-readable disputes when automated agent spending violates user intent despite valid signature and successful settlement. | *Agent spend-intent guard:* deny overbudget calls before signing; clear reconciliation evidence. | Proposal, **no proven executed $5 payment** |

Use a historical issue to form a specific interview question. Before stating that a deployed seller currently has a defect, inspect its current implementation or reproduce the customer's chosen operation with the appropriate access. A repaired issue can still teach a reusable integration lesson. The private sales record is the current source for previous contact, replies, opt-outs, accepted terms and money received.

## 3. Alternatives and the product decision

The native ecosystem already supplies substantial payment, discovery and policy machinery. Current first-party sources support the following comparison; each provider controls its own implementation and deployment.

| Alternative | Already available according to its current source | The customer's remaining decision |
| --- | --- | --- |
| [Canonical x402 client](https://github.com/x402-foundation/x402/blob/f8f83309706b14cc696962f0a002eeeb66c3dc26/typescript/packages/core/src/client/x402Client.ts) | Payment policies, per-payment spending controls and asset caps are present in current core source. | How to integrate persistent operational approval, concurrent budget use, saved output and recovery into the customer's application |
| [Stellar x402 / OpenZeppelin facilitator](https://developers.stellar.org/docs/build/agentic-payments/x402) | Canonical Soroban authorisation and settlement; the documented OpenZeppelin service has testnet and mainnet endpoints. | Which supported provider and operating arrangement meets the merchant's network, fee, availability and support needs |
| [Vellar facilitator](https://github.com/Vellar-Wallet/vellar-facilitator) | Current repository reports live testnet/mainnet, seller-origin ownership checks, durable catalog and policy-governed smart-account compatibility. | Whether a merchant's actual operation and independent buyer work together; how its deployment handles provider migration, ownership changes and delivery |
| [Veridex](https://github.com/Veridex-Protocol/stellar-facilitator) | Its current source reports testnet exact settlement, an HTTPS API gateway, keyless MCP, settlement-backed Bazaar and an experimental provider-quality layer. | Whether the customer needs the provider's full stack or portable operation and reporting across independently selected providers |
| [Periplo](https://github.com/Eras256/Periplo) | Its source reports deployed testnet facilitation, catalog/search and a custom contract-based metered scheme; pubnet remains planned there. | Whether the exact payment scheme, catalog interface and customer integration fit the intended production use |
| [Stellar MPP](https://developers.stellar.org/docs/build/agentic-payments/mpp) | Charge uses native SAC transfers; Session uses a funded one-way channel and cumulative commitments. | Whether individual calls or a repeated workload justify a different rail and its actual operating costs |

**Vellar source correction:** the repository's [mainnet evidence](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/docs/mainnet-evidence.md), blob 9f462eebff843d77c8cabef6addb66ba65e8f497, records 11 team-funded pubnet settlements totalling 3.10 USDC during September 17–21. It explicitly separates those tests from external customer use. Its README, blob 67eb604cf26b349f93eff3f1cea1e95b02cebebd, also describes always-on paid hosting. The Stellar overview still described Vellar as testnet-only/free-tier when read October 11. Use the newer provider implementation record for this comparison; the source report is not an independent ledger replay by SF49.

The candidate advantage is the complete, portable merchant operation: original API or dataset → selected catalog and offer → operator-approved buyer → canonical settlement → useful delivered output → merchant order and ongoing support. An independent merchant should be able to retain the same application contract while changing a compatible provider, and its operator should be able to explain and recover an interrupted purchase from the original records.

This is a product hypothesis to demonstrate on a customer deployment. Basic discovery, gateway wrapping, ownership checks, payment policies and Stellar settlement are existing capabilities across the ecosystem. Custom metered schemes and MPP remain distinct protocol paths; a classifier or cost comparison does not add their execution to the current exact-payment seller.

## 4. Opportunity-to-paid-delivery workflow

**Discovery.** Find a first-party service with a useful paid resource, an explicit customer request or a live procurement need. Read the current API/product documentation and identify what an agent buyer would actually consume. Record the resource, use case, current commercial model, company, date and source. Search existing private sales and sender threads before claiming a relationship.

**Qualification.** Identify the real operator and commercial decision-maker through the service's own published contact information or existing verified correspondence. Determine who can approve the API/data use, the deployment environment, network and fee payer, supported request shape, customer acceptance and purchasing route. This can happen through authorized outreach; unknown commercial details are questions to resolve with the prospect, not reasons to leave a completed introduction unsent.

**Solution.** Assign one relationship owner and complementary implementation arms. The integration arm maps the customer's operation through seller, catalog, buyer and delivery. The operating arm covers install, recovery, support and costs. The commercial arm scopes the paid outcome and follows the existing thread to a decision. A project claim coordinates these arms; it does not reserve every possible engineering contribution.

**Outreach.** Send a concise, tailored message through the authorized verified sender when outreach is authorized and the actual recipient is not held. State the observed fit, the concrete deliverable, commercial intent and the question that advances qualification. Use current source facts; send one first contact per company/opportunity and retain its provider ID. Continue an established conversation in its original thread. No second draft-approval gate is created by this playbook.

**Paid scope.** Agree the customer outcome, included operations and environments, deployment responsibilities, support window, acceptance conditions, price, payment schedule and additional-work process. Use the existing SF77 workorder for a diagnosed repair and SF97 for the integrated merchant pilot. The customer receives a useful deployed integration and operating handoff, not a bundle of assertions about software tests. Preserve the original agreed compensation and receiving route.

**Build and deliver.** Work from current source and the customer's authorised configuration. Finish the combined merchant journey, resolve real failures encountered, and hand over the deployment, original request and output, reconciliation, operational instructions and source changes. Use the focused checks necessary for changed behaviour and reuse accepted executions. Hosting costs and live payment authority are established by the actual deployment agreement; the sales mandate alone is not a purchase instruction.

**Acceptance and collection.** Capture the customer's technical acceptance separately from its commercial agreement. Issue the authorized invoice and payment request under the agreed terms; follow it through the existing relationship until paid or specifically resolved. Record a disputed requirement against the original scope and preserve the compensation claim while addressing it. Delivery, acceptance, invoice, receivable and collected payment remain separate events.

**Expansion.** After the first outcome, ask which adjacent API, dataset, buyer team or operating problem the customer needs solved. Reuse the same integration and relationship history to propose the next substantial package. Publish reusable public code and product learning while keeping the customer's private information in its existing record.

## 5. Qualification and delivery record

Use the existing private commercial system. Each opportunity needs the following information, with unknown fields left explicit until learned:

| Field | What belongs in it |
| --- | --- |
| Stable operation and owner | Company/opportunity identity, existing conversation and complementary implementation owners |
| Buyer and useful job | Who consumes the resource, what it enables, frequency/volume supplied by the customer |
| Resource rights | Actual operator, chosen API/data, contractual redistribution and deployment permissions |
| Request contract | Exact method, URL/template, required query/body, response format and source version |
| Payment contract | Network, scheme, asset contract, atomic amount, recipient, fee payer and actual operator authority |
| Existing environment | Source checkout, versions, origin, application/data adapter, hosting and required credentials handled privately |
| Commercial terms | Agreed deliverables, acceptance, price, cost assumptions, invoice/payment dates and original approvals |
| Delivery record | Original deployment, request/result, customer acceptance, retained output and recovery procedure |
| Payment record | Invoice, receivable, dispute if any, actual payment and fees; preserve the original claimant and terms |

Commercial states are DISCOVERED → QUALIFIED → SENT → REPLIED → SCOPE AGREED → DELIVERED → ACCEPTED → INVOICED → PAID, as appropriate to the actual sequence. A customer can pay a deposit before delivery; store events rather than forcing reality into a rigid order. A bounce updates the send result and routes a verified alternative within the same opportunity. A technical acceptance does not by itself mark an invoice paid.

## 6. Sustainable delivery and measurable growth

Open source makes the merchant free to self-host and change implementer. Paid services finance integration, maintenance and support. The project should earn continued work because the installed product is useful and supported, while retaining the upstream license notices and the released source's actual licence.

Use the original [SF87 rail model](../scf-starforge-20261009/sf87-rail-unit-economics/) for a customer's supplied workload and the [SF97 review room](../scf-starforge-20261009/sf97-merchant-pilot-conversion/) for its decision. Unknown network, infrastructure or support costs remain unknown. A modeled comparison is not an invoice or margin result.

| Measure | Calculation and use |
| --- | --- |
| Qualified conversations | Distinct verified companies that confirmed a relevant need / first contacts with a known delivery result |
| Paid conversion | Customers with agreed paid scope / qualified conversations in the same dated cohort |
| Integration effort | Actual setup, implementation and handover hours by accepted customer operation; compare the same scope before claiming savings |
| Operational checkout completion | Purchases with matching final settlement and delivered result / actual authorised purchase attempts; preserve failures and uncertain outcomes |
| Recovery | Interrupted original operations whose existing records permit resolution, with elapsed operator time and any additional authorised action |
| Repeat usage | Distinct independent buyers making repeat successful purchases during a stated window, using permissioned counting |
| Stellar activity | Unique canonical transaction hashes, actual token amounts and network, linked to the product's customer operations; exclude local examples and duplicate provider records |
| Service contribution | Collected service fee minus its actual delivery, infrastructure, transaction and support costs |
| Cash cycle | Dates of accepted scope, deposit, delivery, invoice and payment; track earned or invoiced amounts still due |
| Maintenance load | Actual support hours, resolved recurring defects and cost by maintained deployment |

Publish aggregate results only where customer permissions allow. Do not invent a service-level promise, volume target, customer count or margin to fill an application field. The current private commercial ledger and actual deployment records determine totals; the nine historical issue records are not a customer population.

## 7. Substantial parallel work orders

### SF49-MERCHANT-DEPLOY — Complete a merchant-owned paid API/data service

Take a qualified existing relationship and its selected resource through original SF61/SF30, catalog lifecycle, SF88 buyer, delivered output, transaction reconciliation and merchant operations. Coordinate application, buyer and operations arms on one customer deployment. Finish source changes, installation, authorised end-to-end customer operation, handoff and agreed support. Record technical failures as work to repair. Relationship ownership, customer data and terms stay in the original private record.

### SF49-PAID-WORKSHARE — Convert a qualified provider into an integration engagement

Find a source-qualified, unclaimed API/data or agent-tool provider, verify the correct commercial contact and existing sender history, prepare a concrete integration fit and send the authorized tailored introduction. Work its replies toward a paid scope, complete the agreed engineering with the implementation arm, issue the authorized payment request and record the result. A ready draft or a new follow-up trigger is not the completed outcome.

### SF49-OPERATING-PRODUCT — Make the existing deployment supportable

Join installation, catalog changes, buyer restart recovery, seller drain, delivery outbox, encrypted backup/restore, order entitlement and accounting into the existing operator experience. Resolve actual gaps in the original modules, using source and accepted execution already available. Deliver a customer-usable operational guide and the integrated implementation. Keep paid hosting choices explicit and use local/cloud checks without hosted GitHub Actions spending.

### SF49-GRANT-INTEGRATION — Put current outcomes into the existing SF10 application

Use the same original interest intake and full application. Replace obsolete capability and competitor statements with current source-grounded descriptions, and distinguish delivered pre-award work from the remaining development plan. Put the customer, architecture, remaining deliverables, budget and measurement definitions directly into the required form fields. Coordinate with the active form owner, complete the authorized submission workflow, and retain its actual receipt and entered content. Do not fork a second proposal.

## 8. Outreach content and source maintenance

A tailored first contact should identify the customer's real service, the useful implementation outcome, the relevant existing source and an explicit commercial next step. A suitable structure is:

> Your published [specific resource] already serves [verified use case]. We can help add an agent-usable Stellar payment route while retaining your existing application and commercial offering. The implementation covers the selected API/data operation, buyer checkout, usable delivery and operator handoff. Our existing seller and buyer source is available at [relevant source]. Would [verified contact/team] be the right group to discuss a paid integration workshare and the resource you would start with?

Resolve bracketed facts before sending. Adapt the scope to what the source supports and the customer needs. The public introduction does not require private relationship history, a grant claim or an invented endorsement. Use exact approved terms for an existing opportunity rather than replacing them with this template.

Maintain the same nine-signal ledger as a dated research record. Update a particular issue only when its current source is read; preserve historical observations and correction dates. Use the original private relationship record for sent, replied, accepted and paid events. Do not republish private customer correspondence or personal handoff stories in this public document.

## Sources and SCF use

- [SCF #46 round](https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg): interest requested as soon as possible; invited Build submission deadline November 8, 2026, when checked October 11.
- [Build process](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award): rolling interest review and invitation before the full application.
- [Open Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/open-track): demonstrate meaningful differentiation, market value, Stellar integration and measurable growth.
- [Submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria): the full submission must contain the material reviewers need, including roadmap, technical architecture and deliverable costs.
- [x402 core source at f8f8330](https://github.com/x402-foundation/x402/blob/f8f83309706b14cc696962f0a002eeeb66c3dc26/typescript/packages/core/src/client/x402Client.ts): existing client payment policies and spending controls.
- [Vellar mainnet source record](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/docs/mainnet-evidence.md), [Veridex current source](https://github.com/Veridex-Protocol/stellar-facilitator), [Periplo current source](https://github.com/Eras256/Periplo): provider capability statements, with the observation limits in §3.
- [Stellar x402](https://developers.stellar.org/docs/build/agentic-payments/x402) and [MPP](https://developers.stellar.org/docs/build/agentic-payments/mpp): canonical rail distinction and integration paths.
- [Original SF09 track decision](./SF09_TRACK_DECISION_20261009.md) and [original demand ledger](./SF49_PUBLIC_SIGNALS_20261009.json): dated inputs, not the live submission or relationship record.

The public-source revision changes the commercial operating guidance and current market comparison. It does not alter the original issue ledger, existing compensation claims, customer terms, published payment receipts or the canonical applicant record.

