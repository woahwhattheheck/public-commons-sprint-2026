# Stellar Discovery Trust Layer

## Build application · SCF #46 · Open Track

**TokenJunkieLabs requests USD 38,000 equivalent in XLM for 400 prospective delivery hours over 150 days from actual award acceptance.** The work installs a useful paid Stellar service with two independently operated merchants, two independent buyer operators and the same selected operation through two independently operated facilitators.

The product is open-source, self-hostable merchant and buyer tooling. It carries an approved API request, dataset or paid MCP tool through native settlement, complete useful output, fulfillment and operating handover. The merchant controls its source and terms. The buyer controls its keys, request and spending. Another engineer can reopen the installation and recover unfinished work.

The working development baseline comprises **18 distinct team-operated purchases totaling 411,000 stroops, or 0.0411 native testnet XLM**, with network fees recorded separately. The funded milestones establish independent customer operation, repeated use and production receiving from that baseline.

### Application at a glance

| Item | Proposed or observed basis |
| --- | --- |
| Applicant | Bryce Muhlnickel, United States individual operating TokenJunkieLabs |
| Category and track | Developer Tooling · Open Track · Global / Not region-specific |
| Requested work | Six future integration and deployment packages, 400 hours at the USD 95/hour planning assumption |
| Delivery windows | Installed services and handover by day 30; repeated testnet use and threat response by day 90; mainnet operation and production receiving by day 150 |
| Interest state | Interest acknowledged October 11, 2026; awaiting the full application invitation |
| Round dates | Full Build deadline November 8, 2026; panel review November 11–18; community voting November 23–December 3 |
| Award timing | Award distribution is undated. The implementation clock begins at actual award acceptance. |

## 1. Customer problem and commercial model

An API or data-service operator needs to expose a useful resource to agent applications while retaining access rules, source meaning and commercial control. A buyer needs the complete result it approved and a way to resolve an interrupted paid request. The difficult join spans four records: approved request, settled transfer, delivered output and accepted fulfillment or accounting.

Current x402 reports show the practical need for that join. One October 2 report described payment-bearing requests rejected because a merchant required POST while the reference client retried GET; health and catalogue checks had appeared normal. The author subsequently corrected the server. An October 3 report described settlement without a discovery listing, with later indexing and facilitator diagnostics in the thread. These were Base deployments. They show how a healthy catalogue or settled payment can leave the customer's task unfinished. Our Stellar implementation retains the exact request and each original outcome so the unfinished step can be recovered. [Method report](https://github.com/x402-foundation/x402/issues/3657) · [Discovery report](https://github.com/x402-foundation/x402/issues/3677)

We serve recurring API/data-service operators, the developers using their results and agencies commissioned to integrate them. A fixed-fee implementation delivers one agreed operation and a handover the receiving engineer can maintain. Further care has its own scope. The commissioning payer, merchant controlling the resource and independent buyer may be different organizations. The workorder names each role, its source and host authority, payment responsibility and acceptance owner. The merchant retains its API or product receipts; TokenJunkieLabs invoices the implementation.

The selected customer task and the priced unit are recorded together. A complete report may require several paid pages. A handover may contain many files or transport chunks. The buyer retains per-request and aggregate spending controls while the operating record shows whether the whole task is complete. A later reporting period, changed source edition, fresh query or new order gives the same buyer a reason to use the service again.

## 2. Product architecture and control

Six connected components form the application: the merchant's private source/release workspace; its HTTP or MCP operation; the native Stellar SDK and configured facilitator; the buyer's private approval and spending state; complete result and delivery records; and merchant fulfillment/accounting. Merchant and buyer services run on their operators' hosts. Approved operations are public; administration, provider credentials, signer references and operating state stay private.

| Stage | Implemented customer control |
| --- | --- |
| Review and publish | Review a source edition or named live query, its arguments and schema, public fields, output limits and complete payment alternatives. Save rights, route, network, asset, recipient, atomic amount and authorization lifetime. Changes or withdrawal become new reviewed states. |
| Connect the source | Preserve original types, missing/null values, pagination and snapshot/live meaning. Customer-controlled credential or OAuth aliases select access and the existing quota/cache state. Retain the edition behind each result. |
| Approve and purchase | Save the actual endpoint, method or tool, arguments, payment option and result scope. Match remote schema and challenge to that selection before signing. Keep the per-payment ceiling and the application's aggregate reservation/budget owner. |
| Settle and deliver | Use the configured native SDK/facilitator for verification and settlement. Save the server's response, full output, byte identity and durable merchant notification. Independently reconcile transaction network, asset, payer, payee and atomic amount. |
| Use and maintain | Receive every selected page or file into the customer's existing application, query, report or workbook. Preserve the parent acquisition and earlier source editions. Existing order and finance authorities control fulfillment, refunds and accounting. |
| Deploy and receive | Select the release, HTTPS service, restricted administration and supervision. Drain, restart, roll back and restore with the original configuration, history and complete customer files. |

The native x402 flow reuses the existing Exact Stellar scheme, token contracts and facilitator supported/verification/settlement interfaces. For paid MCP, the HTTP endpoint, tool and arguments remain distinct from the payment resource. An unsigned call obtains the challenge; the full payment option must match the saved quote before the signed call is dispatched. The official MCP SDK transports the payment and settlement metadata.

Server confirmation, independently observed transfer, complete useful output, receiver acknowledgment and order fulfillment remain separately visible. An uncertain signed reply retains its dispatch state for reconciliation. Reopening a consumed quote returns saved work. Recovery of a complete retained result uses that saved result. A new request or changed purchase gets its own review. Complete export and restore carry the configuration, history and referenced files; the receiving host supplies current authorized secret references.

Browser, CLI, MCP and installed Applications use these same saved workspaces. Native source registrations connect setup, operation and lifecycle while preserving each source adapter's data semantics. The existing request-collection, buyer-to-Operations and document-analysis extensions retain their own original recovery operations; their pending native receiving stages are reported separately from the completed examples below.

## 3. Why Stellar and the ecosystem fit

Stellar settles the approved operation. Buyer approval binds the complete request to its network, asset, recipient and integer atomic amount. Existing libraries and payment services sign, verify and settle; our application connects the transfer to complete output and practical merchant fulfillment.

| Existing component | What it supplies | What this product contributes |
| --- | --- | --- |
| Native Stellar x402 and OpenZeppelin facilitator | Supported payment options, buyer-authorization verification and settlement | The approved HTTP/MCP request, original source, complete output and recoverable receiving operation |
| Vellar discovery | Optional discovery extension and best-effort catalogue updates independent of settlement | Saved offer/schema/terms and a complete source edition that remains usable through customer review and handover |
| Stellar MPP | Charge for individual requests; Session with funded channels and cumulative commitments | An existing Charge workbench that retains the native challenge, request and merchant profile through concurrent preparation and restart |

OpenZeppelin, Vellar, Veridex and Periplo remain payment-infrastructure choices. Rumble Fish is developing facilitator, discovery and SDK capabilities. We build on those components and return reusable integration and receiving improvements to the public source.

A retained comparison found 27 Vellar offers and two Periplo offers with no shared seller/route identity. The funded two-facilitator deployment therefore includes registering and integrating the same useful operation with both. Each completion will retain the selected provider's actual scheme, network, asset and fee policy. This makes the cost and effort of changing payment infrastructure observable while the merchant service and buyer task remain defined.

[Stellar x402 documentation](https://developers.stellar.org/docs/build/agentic-payments/x402) · [Stellar MPP documentation](https://developers.stellar.org/docs/build/agentic-payments/mpp)

## 4. Completed development work

The existing product supplies an operated foundation for the future customer deployments.

| Completed operation | Useful result and its boundary |
| --- | --- |
| Queens HPD data | From a 1,342-row source, the reviewed selection received all 144 rows in pages of 100 and 44. Both 10,000-stroop native testnet transfers finalized. The complete CSV/JSONL edition reopens with source and accounting. |
| Paid MySQL agent query | The MariaDB HPD Preservation/minimum-20 query returned 100 rows, 14 columns and all 53,468 bytes for 50,000 stroops on testnet. Scalar strings and the declared truncation indicator remained intact. It reopened with signing disconnected and in another installation. These are project-event records, rather than a count of unique buildings or current vacancies. |
| Order and receiving | WordPress/WooCommerce applied USD 1.00 and USD 1.50 credits to a USD 2.50 order and reopened both as applied, using controlled reverse-transfer RPC responses in that development exercise. CoCart completed guest-cart actions, native checkout, order handover and receiving of all 48 saved objects. |
| Filing analysis | A 10,000-stroop testnet purchase delivered Genpact's 2024–2025 comparison: four disclosure pairs, five findings and all 1,027,807 bytes. The editable workspace reopened, repeated receipt preserved its revision, and backup/restore reproduced the comparison elsewhere. |
| Supplier catalogue | Both original SAP SHINE SPS11/SPS12 editions contained 106 materials. The operator identified 106 supplier-only changes, reviewed the edition and retained exact identifiers and quantities: 12.500 EA remained 25/2. The original compiler built two 11-file merchant packages. Complete receiving preserved later customer decisions when an earlier bundle was imported. |

Across the development record, 18 distinct team-operated purchases transferred 411,000 stroops / 0.0411 native testnet XLM. Fees are separate. These purchases cover HTTP/MCP, DuckDB/Parquet, RPC, MySQL, Routescan, Socrata, an API plan, Huwise, Genpact, Blockscout and StellarExpert. Independent-customer mainnet adoption is the prospective funded outcome.

The filmed MySQL purchase is independently identifiable: transaction **50d61d1102bfcf960af44171e5248e0899ed6d99cec1951a62075f9a65a6cbed**, ledger **5,145,195**, completed **October 11, 2026 at 20:12:58 UTC**. Its complete result SHA-256 is **4c22f8a26d48156c3e07543328b62ca6f993ce60856166d6805dc0660d9acb8d**.

An installed incident-to-case operation completed an observation gap, notification retry, acknowledgment, recovery and support-case reopening. Encrypted merchant recovery and off-host restore are delivered components. The private grant reviewer completed its 14-phase desktop and 390-pixel mobile journey, including full result reads, Buyer close/export, cold reopening and second-operator receiving, with zero new payments and its processes closed. The later managed-Applications and merchant receiving continuations retain their pending state.

The complete economic briefing is another usable output: a 15-file offline report with all 2,219 original observations, 75 selected observations and 150 comparisons, plus saved review and CSV/JSON. Its unemployment, prices and GDP views preserve units, missing values and retrieval dates. Opening that example initiates no paid operation.

## 5. Funded work and acceptance

The six prospective packages total **400 hours / USD 38,000** at the **USD 95/hour planning assumption**. Day zero is actual award acceptance.

| Package and delivery window | Hours / USD | Remaining work and assessed completion |
| --- | --- | --- |
| T1 · Merchant-resource integration · days 1–30 | 80 / 7,600 | Connect both selected merchants' actual sources, runtimes, authorized access, typed input/output, public routes, payment terms and buyer setup. Each merchant operates one agreed HTTP or MCP service on its host; the buyer opens the complete selected result in its actual application. |
| T1 · Authority and handover · days 1–30 | 40 / 3,800 | Integrate source/terms change or withdrawal, receiving-engineer configuration and installation-specific recovery. A second accountable operator reopens each installation and completes the agreed change while earlier acquired output remains usable under its original terms. |
| T2 · Provider and ledger deployment · days 31–90 | 70 / 6,650 | Register and integrate the same useful service with two independently operated facilitators and the customer's buyer/ledger owner. Two independent buyers complete at least ten useful testnet purchases in total during seven consecutive calendar days ending by day 90. Original intents, observed transfers, full outputs and provider attribution are retained. |
| T2 · Deployed threat response · days 31–90 | 50 / 4,750 | Complete the deployment-specific threat model, monitoring/notification setup and material remediation. The customer operates an interrupted settled purchase and a merchant-delivery failure through acknowledgment, recovery and useful output. |
| T3 · Mainnet merchant rollout · days 91–150 | 90 / 8,550 | Integrate both production hosts, network/asset/account configuration, recurring task, controlled release and rollback. Both merchants operate on mainnet; two independent buyers complete at least thirty useful purchases in total during fourteen consecutive calendar days ending by day 150, and both return for a distinct purchase on another day. |
| T3 · Production recovery and handover · days 91–150 | 70 / 6,650 | Complete supervision, off-host retention, key rotation, receiving-host restore and reconciliation after the backup point. An authorized engineer restores original state/files, measures recovery, reconciles later operations and completes an independent maintainer's support case. |
| **Total** | **400 / 38,000** | **Two merchants, two buyers, two facilitators and an independently maintainable mainnet service.** |

The allocation is 320 engineering hours and 80 integration/handover hours: 96 + 24 in T1, 96 + 24 in T2, and 128 + 32 in T3. The three windows cost USD 11,400 / 11,400 / 15,200. Bryce assigns actual contributors, rates and working-day availability within those packages.

Each installation starts from one complete workorder: recurring task and commissioning payer; merchant, buyer and receiving operators; source rights and access; selected host/runtime; exact request, full output and priced unit; approved network, asset and terms; repeat-use trigger and acceptance owner. The source contract identifies snapshot/live behavior, keys, field/time meaning, limits and completeness. T1 implements those concrete joins into the existing product.

Each performed adaptation is assigned once to its grant package or a separately sold commercial workorder. The grant pays for future Stellar integration, deployment, technical recovery and handover. Existing implementation, routine operation, sales and purchased usage have separate records. Usage targets carry no purchase subsidy. Existing compute is the starting resource; incremental service reserve and the planned hosted Actions budget are both USD 0.

## 6. Customer selection and repeat use

Four human conversations inform the current decisions. Veridex invited an open testnet design partnership after declining an external testing budget; the subsequent proposal is USD 1,500 over five business days. Nansen referred a proposed read-only Holdings integration internally and confirmed on October 12 that the Holdings detail was included; its proposal is USD 2,400 over five business days. CoCart's founder asked about introductions, the commissioning payer, referral compensation, responsibilities and contracting; its proposal is USD 7,200, 60 planned hours and fifteen business days. Blockscout expressed interest on October 12 and reported no current integration budget; the proposed workshare is USD 4,800 over ten business days.

Bryce owns these favorable relationships and subsequent agreements. The first CoCart customer remains to be selected. Source-platform participation and the organization commissioning an installation are recorded separately. These responses are customer learning and proposed work, with acceptance and collected revenue retaining their actual stages.

Selection favors a recurring buyer task, permitted source, accountable merchant host, independent receiving application and agreed payer. The buyer engineer connects the operation to the application's existing authorization, signer, aggregate budget and destination. The receiving engineer uses the full output, records corrections and reopens the same operation. The maintainer completes a source or terms change, recovery or receiving task during handover.

Eight October 12 data-platform proposals apply this method to AceMQ, OpsTree, Cazton, Natron, Severalnines, Altinity, Percona and ScaleGrid. Their separately retained scopes total USD 52,500 for 350 planned hours, priced at USD 150/hour. At the common USD 95/hour labor assumption, modeled labor is USD 33,250 and the remainder before other costs is USD 19,250. A 25% labor overrun leaves USD 10,937.50 before other costs. These are proposed economics; they do not select the funded customers or establish revenue. Scope, original customer ownership and actual effort determine the next implementation estimate.

The six funded packages retain their own hours. Qualified commercial work is scheduled and costed separately so the same adaptation is assigned once. No combination of overlapping offer cohorts is presented as booked business.

## 7. Threat response and useful-outcome measurement

T2 includes the actual deployment's threat assessment, monitoring thresholds, notification destinations, accountable responders and material remediation.

| Failure to operate | Control and observation |
| --- | --- |
| Changed source, request or terms | Match exact source generation, request and approved payment alternative before dispatch. Retain rejection cause, quote age, source expiry and capacity refusal. |
| Uncertain payment or incomplete delivery | Reconcile the original intent and transfer, retain partial output/entitlement state and recover unfinished work. Measure outstanding age and time to useful output. |
| Unauthorized access or exposed private state | Validate issuer, audience, subject, scopes, expiry and current authority. Restrict administration and protect credentials, keys, claim tokens, private bodies and backups; retain access/rotation observations. |
| Observation or notification failure | Keep the last useful capture, incident and original notification attempts. Retry the same event; measure coverage, alert, acknowledgment and recovery time. |
| Restart or state loss | Restore the selected backup and reconcile later operations. Reopen the same support case and full output on the receiving host; measure time, retained history and active effort. |

Count each independent organization or person once across agents and wallets. A completed purchase joins one distinct approved intent, an independently observed native transfer and complete useful output. Transactions are deduplicated within their network; amounts and fees retain their asset and atomic units. Required fulfillment remains separately visible.

Report completed/attempted purchases, complete/started parent tasks, returning buyers and accepted handovers. Keep partial, unresolved, canceled and refunded outcomes in the same cohort. A result reopen, delivery retry or transport chunk continues the original result. Returning use follows a fresh period, input or customer request. Payment, full output and recovery retain separate actual clocks.

For each customer, record the previous method and, where available, the active effort and corrections of a prior execution. Compare the installed task against the same input/output definition, retaining the actual period and population so a larger later source remains visible. Record customer acceptance, incomplete coverage and unresolved corrections. Measure active implementation/support effort separately from elapsed access or review delays, and merchant receipts separately from service invoices and collected business cash.

## 8. Capacity and cash plan

The delivery plan uses the original six packages, 400 hours and USD 38,000. A completed native scheduling comparison assumes award acceptance on **December 7, 2026**, Monday–Friday availability, and closures on December 25, January 1, January 18 and February 15. These are scenario inputs, not an announced award date or an assigned staffing commitment.

At 18 engineering plus eight operations hours weekly, one T1 task finishes nine calendar days late. At 24 plus eight it finishes one day late. **25 engineering plus eight operations hours is the lowest examined timely allocation**: all six tasks are scheduled, with zero late tasks and zero collection-timing findings. T1 finishes January 6; final handover finishes April 13, 23 days before the original May 6 target. Actual award timing and named contributor availability will replace the planning calendar.

SCF's four payments are 10%, 20%, 30% and 40%: USD-equivalent 3,800 / 7,600 / 11,400 / 15,200 for this request. Tranche delivery costs are 11,400 / 11,400 / 15,200. SCF pays XLM using its scheduled-payment conversion basis. Actual receipt dates, rather than a forecast award or payout date, anchor the completion-form deadlines.

| Assumed review/payment lag | Conditional payout days after award acceptance | Original evenly phased cash requirement | Selected 25 + 8 calendar cash requirement | Selected peak date |
| --- | --- | --- | --- | --- |
| 14 days | 0 / 44 / 104 / 164 | USD 15,200.00 | USD 17,250.00 | March 20, 2027 |
| 30 days | 0 / 60 / 120 / 180 | USD 18,746.67 | USD 23,275.00 | April 5, 2027 |
| 60 days | 0 / 90 / 150 / 210 | USD 26,346.67 | USD 26,600.00 | April 13, 2027 |

The selected schedule brings some labor costs forward. Its cash calculation spreads each package's remaining cost across the selected inclusive start/finish interval; the resource calendar assigns engineering and operations hours on working days. The same package totals are preserved. Opening cash remains unentered and these forecasts contain zero observed cash records. Working-capital provision, actual contributor payment dates and actual award/customer receipts are execution inputs to finalize against the agreed terms.

The separate combined-work planning example contains three conditional implementations: USD 21,200 of fees and 144 additional hours / USD 13,680 modeled labor. Its retained entered-date scenario reports a USD 7,680 peak additional requirement; a separate USD 5,000 planning entry reduces it to USD 2,680. A later four-customer scenario including Freeform totals USD 30,000 of proposed fees and 208 additional hours / USD 19,760 modeled labor. Grant plus those proposed deliveries totals 608 hours / USD 57,760 of modeled labor cost. Freeform's actual commencement, work and receipt dates remain unset pending its agreed trigger. These scenarios keep commercial delivery workload visible; they do not supply observed funding for the grant.

We will submit each tranche's completion form within 90 calendar days after receipt of the previous tranche payment. The original receipt sets the deadline. Completed deliverables, payment records, actual submissions and any SCF-confirmed extension remain together. The day 30/90/150 implementation plan continues from actual award acceptance.

## 9. Applicant, delivery experience and assistance

Bryce Muhlnickel is the United States individual operating TokenJunkieLabs, accountable for product direction, customer relationships, engineering delivery and operations. Published JavaScript/Node services compose the native x402/Stellar and MCP libraries. Python applications preserve complete acquired data in typed/versioned SQLite tables and saved SQL views. PHP connects native WordPress/WooCommerce product mappings and checkout. The completed paid datasets, native MCP query and customer receiving examples demonstrate the practical integration and recovery foundation for the proposed deployments.

AI agents generated and assisted source code, interface code, operating scripts, design, documentation and application material. They also performed source review and native operating exercises. Bryce remains responsible for the artifacts, statements and delivery commitments. The team film identifies that responsibility and assistance.

SCF acknowledged the individual Build Interest Form on October 11, 2026. The full application remains at **INTEREST_SUBMITTED_AWAITING_INVITATION**. The original submitter will apply the invited form's actual wording and limits to this same substantive narrative. The requested award, work packages and applicant remain unchanged.

## 10. Open the existing work

This page contains the substantive application. The following materials let an engineer inspect the demonstrated product and retain the original source.

### Watch the product and team

The 3-minute-32-second film follows the HPD MySQL query, saved terms, one 0.005 testnet XLM purchase, full 100-row/14-column output, JSON download and reopening with signing disconnected. Its editable companion contains eleven clips, captions, script, query result and rendering tools.

[Watch the product/team film](https://github.com/woahwhattheheck/public-commons-sprint-2026/releases/download/scf-presentation-20261011/stellar-forge-scf46-presentation.mp4) · [Download the editable film companion](https://github.com/woahwhattheheck/public-commons-sprint-2026/releases/download/scf-presentation-20261011/Stellar-Forge-SCF-Presentation-Editable-Companion-20261011.zip)

### Reopen the retained purchase

Use the maintained runtime installation with native Stellar packages, the MCP feature and operator support. Retain the selected source archive, complete lock and READY installation. In Applications choose **Grant purchase reviewer**, select that runtime and a private workbench directory, then use **Review → Save → Connect → Start → Open**. Leaving Packet and SHA-256 empty selects the bundled original purchase; an existing exported packet uses its exact digest. The installed command is:

~~~sh
starforge grant-demo workbench --dir /srv/starforge/state/grant-review --port 0
~~~

The full original guide covers private parent ownership, instance access, both retained quotes, complete results, closed Buyer export and receiving. This route reopens retained work; opening the page itself does not launch an application.

[Grant reviewer operating guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/03a93f7c59a703ebc63416ae0e914f07099fef37/products/grant-reviewer/OPERATING.md) · [Runtime installation](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/03a93f7c59a703ebc63416ae0e914f07099fef37/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)

### Read and reuse the economic briefing

Download the complete 15-file economic package and open its offline report. Its source/review/CSV/JSON and receiving guide travel together.

[Economic briefing package](https://github.com/woahwhattheheck/public-commons-sprint-2026/raw/655e527e30fd72ae877d3b11390378a6168ca7e4/stellar-forge/developer-site/dist/examples/fred-briefing-20261012/stellar-forge-economic-briefing-20261012.zip) · [Economic report opening and receiving guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/655e527e30fd72ae877d3b11390378a6168ca7e4/stellar-forge/developer-site/dist/examples/fred-briefing-20261012/START_HERE.md)

### Continue from the original source

[Complete merchant development guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/03a93f7c59a703ebc63416ae0e914f07099fef37/products/merchant-workspace/DEVELOPMENT.md) · [Merchant operating guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/03a93f7c59a703ebc63416ae0e914f07099fef37/products/merchant-workspace/OPERATING.md) · [Original six-package scenario](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/2761cc9a44d511959e224dc7ee5998aa13df7e8e/stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json)

### Issuer references

[SCF #46 dates](https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg) · [Submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria) · [Budget and deliverable guidance](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines)

Application evidence edition: October 12, 2026. The dated development baseline, prospective milestones and conditional forecasts retain their stated scope.
