# SCF SF-49 — Merchant adoption, paid implementation and open-source sustainability

**Operation:** SCF-STARFORGE-20261009 / SF-49.  
**Updated:** October 12, 2026. The public issue observations below retain their stated dates.  
**Purpose:** Run the commercial adoption process for the existing Stellar product, and provide the market case for the original SF10 application. The same merchant relationship and original implementation owners continue through delivery and payment.

This playbook supports authorized outbound sales. Use the current owner instructions and the existing private contact record to select the sender, preserve explicit contact exclusions, and avoid a second first-contact message. A historical research-only scope in this file is not a current stop on outreach, internal publication, or completion of authorized work. Customer terms, correspondence, personal relationship history and receiving details belong in the existing private commercial record.

## 1. Customer, job and product

The first customer is an API or data-service operator who already has a useful, legally distributable resource and wants to sell its use to agent applications. Its engineering lead needs a paid operation that works from its current application through the customer's actual client; its commercial lead needs an offer, measured delivery effort and a support model. The second customer is an agent application operator that wants to acquire those resources under a persistent spending policy and keep the purchased output usable after its process or connection stops.

Start with the customer's existing operation. Preserve its selected method, request schema, data access rules, asset, recipient and price. Reuse the original product to join:

| Customer task | Existing source to use | Deliverable for the customer |
| --- | --- | --- |
| Offer an existing API operation | [SF61 OpenAPI importer](../scf-starforge-20261009/sf61-openapi-seller-import/) and [SF30 upstream bindings](../scf-starforge-20261009/sf30-seller-sdk/UPSTREAM.md) | An operation connected to the merchant's application, with its actual input and payment terms |
| Sell permitted data queries | [SF30 dataset API](../scf-starforge-20261009/sf30-seller-sdk/DATASET_API.md), [read-only SQLite](../scf-starforge-20261009/sf30-seller-sdk/sqlite/) and [Baserow source authoring](../scf-starforge-20261009/sf30-seller-sdk/baserow/) | Approved fields, exact values, complete source pages and selected file bytes, with a reviewed source version and query limits |
| Operate a source through the browser and an agent | [Baserow workspace](../scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/README.md), [original merchant MCP](../../stellar-forge/mcp-merchant-operator/BASEROW_WORKSPACE.md) and [installed Applications](../scf-starforge-20261009/distribution/runtime-workspace/APPLICATIONS.md#baserow-source-authoring) | One saved source workspace, publisher, refresh schedule and deployment history shared by both interfaces |
| Make the operation discoverable | [SF60 durable catalog](../scf-starforge-20261009/sf60-durable-catalog-transaction/), [SF73 seller admission](../scf-starforge-20261009/sf73-pinned-seller-admission/) and [SF95 withdrawal](../scf-starforge-20261009/sf95-signed-seller-withdrawal/) | A source-preserved listing that the seller can manage and retire |
| Acquire and keep the output | [SF88 operator buyer](../scf-starforge-20261009/sf88-operator-buyer-cli/), [request collections and customer receiving](../../stellar-forge/mcp-paid-agent/COLLECTIONS.md), and [SF100 dataset delivery](../scf-starforge-20261009/sf100-buyer-dataset-delivery/) | Selected original requests, separate exact spending caps, native approval, saved responses and a complete resumable customer handoff |
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

### Find the useful job and retain its relationship

Find a first-party service with a useful resource, an explicit customer request or a live procurement need. Read its current API or product documentation and describe the result an actual buyer would consume. Record the resource, use case, present commercial model, organization, date and source. Search the existing private case and sender threads before first contact; reopen an existing relationship when it already covers that opportunity.

Use the service's own contact route or verified correspondence to identify the operator, commercial decision-maker and receiving engineer. Ask which existing operation causes integration work, who uses its result, how often, and which staff member can accept the finished deployment. Ask about the actual host, data rights, access, expected volume and purchasing route. Keep completing source research and implementation while the relationship owner resolves these questions.

Send one tailored introduction through the authorized sender. Name the observed fit, useful delivered outcome, relevant existing product and a concrete commercial question. Retain the provider message ID in the same case. **At the first favorable human reply, route the complete relationship to Bryce for further sends**, following the user's standing instruction. Include the actual reply, current offer, technical work and the question requiring a response. Engineering, new lead discovery and preparation for other prospects continue alongside that handoff.

### Select the complete implementation

Choose the original workflow that fits the customer's job. An API operation uses its actual method, schema and upstream access. An approved dataset uses its original source acquisition, reviewed query and complete output. A Baserow table or grid uses the existing source workspace and its native publisher; browser and MCP attach to that same owner. A buyer with several prepared requests uses the existing request collection and individual native approvals.

Assign complementary source, merchant, buyer/receiving and operating arms to that one installation. Record their owned paths and current live process before editing or launching. Reuse the existing seller, publisher, buyer and delivery history throughout the work. The shared browser and agent interfaces retain the same source revisions and request IDs.

Agree the included operation, source volume and files, environments, receiving consumer, support window, acceptance, price, payment events and additional-work process in the original commercial case. Use the existing SF77 workorder for a diagnosed repair and SF97 for the integrated merchant pilot. The implementation owner maps the agreed business outcome to the following commissioning sequence.

### Commission the selected customer installation

| Phase | Work to complete | Retained customer outcome |
| --- | --- | --- |
| Select source and recipient | Confirm the useful operation, the source owner's access and redistribution terms, and the actual application or staff workflow receiving the result. Select the participating merchant and buyer operators and their roles. | One scope with an identified source, receiving use and technical acceptance owner; actual source and downstream limits are part of the agreement. |
| Install and bind the host | Use the selected published release or reviewed source, save its actual version and install manifest, and configure the original Applications workspace. Store provider credentials and private operator URLs through the supported host configuration. Use the current installed runtime for its own Start/Open/Stop/Reopen lifecycle. | A customer-selected workspace and release that reopen with their existing state, source configuration and process ownership. The receiving guide identifies the actual edition containing the selected capability. |
| Author the useful resource | Capture the complete approved source or import its retained original package, review its schema and exact values, choose the query/projection, preview all selected rows, and save the reviewed version. For Baserow, retain native field and record IDs, response order, full page chain and each selected file's original bytes. The source configuration states whether files are retained or metadata-only. | A reviewed source version linked to the original acquisition. Baserow's public placeholder IDs remain public metadata; the existing adapter preserves the provider's authentication, visible fields and pagination contract. |
| Publish the merchant operation | Open the source workspace's original publisher, save its plan, extract with the retained run ID, review the actual candidate against the current target and publish. Apply the merchant's real payment terms and selected native runtime through the original deployment review. Retain the resulting package, release identity and operating configuration. | A useful merchant operation with a specific source version, published result, request contract and current payment terms. Source refresh and later publication retain earlier versions and their customer outputs. |
| Connect the independent buyer | Configure the actual buyer host, signer reference, network and exact spending limits. Select the merchant's offer and prepare its complete original request. Use the native approval interface for an authorized purchase. A request collection groups prepared intents while each selected request keeps its own review, budget reservation and execution history. | Original buyer intent, approved request, transfer/settlement state and usable delivered output. The application records its actual payment network and asset separately from the resource's data source. |
| Receive the complete result | Select and retain the original export ID and manifest hash, then receive every file through the maintained downloader. Reopen the same endpoint/export/directory after a transfer interruption. For source authoring, import the verified complete package into the selected recipient workspace and review its source version. Another merchant host prepares its own native deployment from that source and its actual local terms. | The receiving engineer has complete original files, source and result identities, a usable consumer or source workspace, and the command for reopening the same delivery. A deployment package retains its original host binding. |
| Operate a change and recover | Complete the agreed change or next source edition through the same draft/review/publication path. Show how staff find an original request after a lost reply, reopen a completed result, inspect an unfinished operation and continue its native recovery. Use the original customer execution and its records when exercising the receiving workflow. Drain the installed owner before reopening the same workspace. | Staff can operate the selected product, preserve earlier customer results and recover unfinished work with its original IDs. The guide records the actual supported recovery action and active operating owner. |
| Accept, collect and support | Have the receiving engineer use the delivered result in the agreed consumer and record technical acceptance. Complete the commercial acceptance and payment request through the original relationship's sending authority. Record each invoice, due date, actual receipt and supported correction in the same case. | Delivered scope, accepted operation, original compensation and actual cash events remain traceable through the agreed support period and the next substantial workshare. |

The [Baserow merchant guide](../../stellar-forge/mcp-merchant-operator/BASEROW_WORKSPACE.md) contains the concrete host connection, source/publisher tools, native deployment, complete export and customer receiving commands. Its customer uses `starforge mcp-baserow-download inspect|download|reopen|receive` from an installed edition that includes the Baserow contribution. The [collection guide](../../stellar-forge/mcp-paid-agent/COLLECTIONS.md) supplies the corresponding original buyer registration, browser approval, selected-request operation and complete receiving commands. Use their original import/export and request IDs in the private handover.

For an existing native source operation, continue its retained input and current receiver. The maintained [Baserow customer example](../../stellar-forge/mcp-merchant-operator/examples/baserow-handoff.mjs) consumes its original `native-result.json`, `workspace-customer-result.json` and source workspace, then carries publication, customer import, interrupted download and offline reopening through the same merchant APIs. Preserve its actual output directory and source pin when requesting that continuation.

### Expand from the accepted outcome

Ask the existing relationship owner which adjacent operation, dataset, buyer team or recurring support problem the customer needs solved. Price the next whole implementation using the actual time and costs from the first. Keep the customer's earlier scope and compensation intact, and publish reusable code and aggregate learning from the delivered work. The same private record carries the reply, accepted scope, installation, invoice and receipt.

## 5. Qualification and delivery record

Use the existing private commercial system. Each opportunity needs the following information, with unknown fields left explicit until learned:

| Field | What belongs in it |
| --- | --- |
| Stable operation and owners | Company/opportunity ID, original conversation, relationship owner, complementary implementation owners and current receiving operation |
| Buyer and useful job | Actual consuming organization/application, selected resource, expected frequency and volume, and receiving engineer |
| Source permission and acquisition | Source operator, approved API/table/view/query, data and file permissions, provider source/version, exact acquisition or capture ID and full original package |
| Request and source contract | Method, URL/template, query/body, response schema, native field/record IDs, file mode, source version and extraction/publication plan |
| Payment contract | Network, scheme, asset contract, exact atomic amount, recipient, fee payer, buyer policy and original approved intent/attempt |
| Existing environment | Installed release and manifest, source checkout, original workspace, host role, current process owner, actual configuration and private credential reference |
| Merchant and publication | Original plan digest/run, source version, candidate review, published result, release digest/generation and host-bound deployment package |
| Customer receiving | Export ID, original manifest/file hashes, full file inventory, download directory, receiving workspace/import ID, source version and actual consumer result |
| Commercial terms | Original deliverables and included limits, acceptance, quoted or agreed price, expected effort, payment schedule, dates and actual approvals |
| Delivery and acceptance | Completed customer operation, technical acceptance, commercial acceptance, receiving handover and agreed support/correction period |
| Payment and costs | Invoice, due date, receipt, original fees and delivery/support costs, preserving each event's actual date and owner |
| Continuing action | Current reply, unfinished native operation, receiving correction, payment event or agreed next workshare and its assigned owner |

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

Find a source-qualified, unclaimed API/data or agent-tool provider, verify the correct commercial contact and existing sender history, prepare a concrete integration fit and send the authorized tailored introduction. Route a favorable human reply and further relationship sends to Bryce; prepare the specific scope and customer engineering with the implementation arm, complete the agreed delivery, and follow the original authorized payment process through its actual receipt. A ready draft or a new follow-up trigger is not the completed outcome.

### SF49-OPERATING-PRODUCT — Make the existing deployment supportable

Join installation, catalog changes, buyer restart recovery, seller drain, delivery outbox, encrypted backup/restore, order entitlement and accounting into the existing operator experience. Resolve actual gaps in the original modules, using source and accepted execution already available. Deliver a customer-usable operational guide and the integrated implementation. Keep paid hosting choices explicit and use local/cloud checks without hosted GitHub Actions spending.

### SF49-GRANT-INTEGRATION — Put current outcomes into the existing SF10 application

Use the same original interest intake and full application. Replace obsolete capability and competitor statements with current source-grounded descriptions, and reconcile delivered pre-award work into the remaining development plan. Select the funded cohort's actual merchant and independent buyer operators through their original commercial records; record their installation and recurring-use windows separately from the team's development runs. Put the customer, architecture, remaining deliverables, budget and measurement definitions directly into the required form fields. Coordinate with the active form owner, complete the authorized submission workflow, and retain its actual receipt and entered content. Do not fork a second proposal.

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

Maintain this operating playbook alongside the same dated public-source ledger, private customer records and canonical application. New delivered capabilities update the appropriate customer route, current source guide and remaining installation work; actual relationship, payment and customer-use events remain attached to their original records.

