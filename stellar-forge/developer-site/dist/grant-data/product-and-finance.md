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

## Recurring economic-report installation

The maintained FRED application supports the full reporting cycle: acquire or receive the original source; review the selected series and calculations; save a calendar template; preview a later report; inspect its source coverage and changes; save the original analyst review and complete report; publish its selected files through the existing merchant; and receive the useful result through the original buyer. A second engineer can receive the complete economic project and continue the same reporting procedure.

**Useful customer task and roles.** An economic research desk, reporting team or software application needs a defined report for a later period while retaining the basis of its previous publication. The commissioning workorder names the organization paying for implementation, the merchant controlling the source and publication, the independent buyer using the result, and the maintainer accepting the operating handover. It selects the series, source rights and access, calculation choices, reporting interval, required output, native payment terms and receiving application. An independent operator can assess the finished task directly by opening the whole delivered report and tracing each measure to its retained current and baseline observations.

**The paid unit.** A published analyst edition advertises complete report assets through the original FRED merchant. One selected `briefing.html` download is a complete offline report with its local measures/source interface and CSV/JSON exports; `briefing.json` is the corresponding machine-readable report. The advertised resource identifies its byte count, SHA-256 and content type. The buyer prepares that exact GET and reviews the original network, asset, recipient, integer atomic amount and authorization lifetime. The original Stellar SDK, facilitator and Buyer carry verification, settlement, retained output and recovery. If an installation instead requires multiple advertised files or paged observations, each selected native resource retains its own request and price, and the agreed complete output and aggregate spend are part of that installation’s task.

**A recurring edition.** The template retains the original series/comparison selection, relative-change choices, precision and meaning. Its calendar policy names the number of complete months, the selected-series observation-date rule and any trailing months to omit. Missing markers retain their original dates. A quarterly observation date remains its source period label. Preview exposes every selected series’ source and window coverage, changed units/frequency/seasonal adjustment, new or departing periods, and changes to original current values and baselines. A saved successor becomes a normal analyst review and report in the same project, so the existing publication and customer path applies directly. The operator’s full predecessor comparison is also available as HTML, CSV and JSON.

Reopening a saved report or resuming its download retains the original purchase. The next useful operation begins with a later reporting window or a newly retained source edition, a preview of the changed content, and a reviewed publication. The buyer’s prior report remains readable with its original values and source. Source retrieval dates and API real-time/vintage fields preserve their own meanings.

**Implementation within the existing funded plan.** The six packages below are the application’s shared allocation for both selected merchant installations. This economic-reporting case supplies concrete work and acceptance inside those packages; its installation workorder assigns each adaptation once.

|Existing package|Economic-report installation work|Customer outcome|
|  ---  |  ---  |  ---  |
|T1 — Merchant-resource integration, 80 hours / $7,600|Connect the selected authorized source, original FRED project and report procedure to the merchant’s native route and buyer’s receiving application; implement required source/report mappings and deployment corrections.|The independent buyer opens the complete agreed report from the installed merchant, with its selected observations, calculations and original payment terms.|
|T1 — Authority and handover, 40 hours / $3,800|Implement the customer’s source/terms change or withdrawal and receiving-maintainer configuration against the same saved project and native publication.|Another operator reopens the installation, performs the agreed change, and retains earlier acquired reports and their original terms.|
|T2 — Provider and ledger deployment, 70 hours / $6,650|Register the same useful report operation with both independent facilitators and adapt actual payment requirements, fees and buyer configuration.|The common seven-day cohort completes at least ten useful testnet purchases in total across the two independent buyers; the same selected operation works through both facilitators.|
|T2 — Deployed threat response, 50 hours / $4,750|Implement the installed source, approval, settlement and file-delivery threat assessment; monitoring, notifications and customer-specific recovery for the two required response cases.|The customer resolves an interrupted settled purchase and a delivery failure while retaining the original financial outcome and complete useful report.|
|T3 — Mainnet rollout, 90 hours / $8,550|Configure the production hosts, native network/asset/accounts, recurring report consumer, controlled release and rollback; correct actual installation defects.|Both merchants operate on mainnet and the common fourteen-day cohort reaches at least thirty useful purchases in total, with both independent buyers returning on another day.|
|T3 — Production recovery and handover, 70 hours / $6,650|Implement the selected off-host retention, secret-reference replacement, receiving-host restore and reconciliation of operations after the backup point.|An authorized maintainer restores the same reporting project and complete customer files, measures recovery time and completes an independently accepted support case.|


The allocation remains **400 prospective hours / USD 38,000 / 150 days from actual award acceptance**. The workorder keeps implementation funding, report purchase principal, network fees and separately commissioned service charges on their original assignments. The customer’s actual report use, accepted corrections, time to usable output, repeat purchases and receiving handover feed the common outcome measures.

**Operate and transfer the delivered product.** The existing installed `fred` command and FRED Applications workspace open the original private project. The operator saves the analyst template, previews and saves its next report, then selects that saved review for the original `fred publish` operation. The same project can be operated through its typed client and merchant tools. Complete project export and receiving retain the original sources, reports, templates, successors and publication plans; a receiving maintainer can reopen the saved report and continue from it.

[Complete recurring briefing guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/be44be564e35b63af23246bad531a95374bbb4c0/stellar/scf-starforge-20261009/sf30-seller-sdk/fred/TEMPLATES.md) · [Original analyst operation](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/be44be564e35b63af23246bad531a95374bbb4c0/stellar/scf-starforge-20261009/sf30-seller-sdk/fred/BRIEFINGS.md) · [Installed client and merchant operation](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/be44be564e35b63af23246bad531a95374bbb4c0/stellar-forge/mcp-merchant-operator/FRED.md)

## Coastal model-input installation

A coastal engineering team needs the selected station records in the format its model and analysts actually use, with the original observation, units, time basis, datum, quality fields and later corrections still traceable. Moffatt & Nichol’s published [numerical-modeling practice](https://www.moffattnichol.com/solution/numerical-modeling) and [Digital services](https://www.moffattnichol.com/digital) provide a concrete prospect for this installation. The original workshare proposes USD 18,000 for 150 planned hours over six active working weeks: one selected study, up to five NOAA stations and five years, one agreed CSV/JSON model-input convention and one deployment environment. The original inquiry was sent on October 12, 2026 to Moffatt & Nichol’s published general-routing mailbox, requesting the coastal, Digital or small-business outreach colleague. The firm would choose the actual study and acceptance reviewer and would retain calibration, engineering interpretation and client recommendations.

The merged Coastal Source Operations product carries the source work from a saved station and historical window through original response capture, reviewed source editions, selected input mappings, a complete study release and a returned-file decision. It preserves observation and prediction products separately, exposes complete coverage and source receipts, and retains the original station-specific datum and time meaning. A saved release fixes its source editions, selected windows, mapping and review. Later working-study edits do not change the files already supplied to the analyst.

The installation workorder names four operational responsibilities. The commissioning organization agrees and pays for its engineering scope. The merchant’s source operator controls the selected capture, review and release, including the rights and terms attached to the original data. An independent buyer uses the advertised result in its own analysis. The receiving engineer owns the installed configuration, restoration and support handover. One person may perform several staff tasks where the agreement permits it; the funded independent-merchant and independent-buyer targets retain their stated separation.

The useful priced unit is a selected advertised model-input resource, such as the complete released CSV for an agreed study and window. The quote identifies that resource, its selected edition, price, native payment requirements and expected complete result. Source archives, other formats and query pages retain their own advertised access and request terms. The USD 18,000 implementation proposal is separate from those resource purchases. A later observation period or an explicitly reviewed source correction supplies a reason to acquire another useful edition. Retrying the same request or reopening an already acquired edition preserves that original operation.

The engineering sequence begins with the client’s actual station selection and input specification. Staff retain the originals, inspect the selected periods and quality fields, and map source columns to the receiving model’s declared headings, units and missing-value rules. The reviewer decides whether the complete selected input is suitable for release. The analyst can then obtain the released files through the existing application or standard-library Python client, verify every selected file and original-source archive, continue an eligible native dataset query across all its cursors, and reopen the retained files offline. A selected query dataset follows the existing 250,000-row and 256 MiB parser limits; complete released study files remain the source for a larger handoff. A returned input is kept as its own original version. Full comparison and an explicit receiving decision preserve changes and ambiguous rows for the assigned engineer.

This is one candidate customer operation within the existing two-merchant deployment. Its selected adaptations would be assigned once in the original six-package workorder:

|Existing funded package|Coastal installation work|Useful completion in the existing cohort|
|  ---  |  ---  |  ---  |
|T1 merchant-resource integration — 80 hours / USD 7,600|Connect the agreed original station/source selection, accepted model-input mapping, complete resource route, native terms and receiving client to the selected host.|Each participating merchant supplies its agreed useful service; its independent buyer opens the complete source-bound input in the receiving model or analyst application.|
|T1 authority and handover — 40 hours / USD 3,800|Bind release authority, source and terms changes, receiving-engineer configuration, installation defects and the recovery procedure.|A second accountable operator reopens the installation and completes the agreed source or terms change or withdrawal while earlier acquired input remains available under its original terms.|
|T2 provider and ledger deployment — 70 hours / USD 6,650|Connect the same selected input service to the two independent facilitators, retaining their actual scheme, requirements and fee policy.|The existing target of at least ten useful testnet purchases by two independent buyers over seven consecutive days joins original intent, native transfer and complete input.|
|T2 deployed threat response — 50 hours / USD 4,750|Operate the installed settled-purchase interruption and merchant-delivery failure cases, including the staff acknowledgment and original request recovery.|The customer retains the financial outcome and unfinished delivery, then recovers the same useful input with the responsible operator’s response.|
|T3 mainnet rollout — 90 hours / USD 8,550|Complete production host and account configuration, reviewed source refresh, recurring analyst use, controlled release and rollback.|The existing two-merchant and two-buyer target reaches at least thirty useful purchases over fourteen consecutive days, with each buyer returning on another day; asset amounts and fees remain separate.|
|T3 production recovery and handover — 70 hours / USD 6,650|Finish supervision, original-file retention, key rotation, receiving-host restore and reconciliation after the backup point.|The authorized receiving engineer restores the source, release, query and returned-file state, measures recovery time and completes the independent maintainer’s support case.|


The existing total remains 400 hours and USD 38,000 over 150 days from actual award acceptance. The commercial proposal’s five source, model-input, analyst, staff-refresh and handover packages retain their own 30/24/36/36/24-hour allocation. Before commissioning, the workorder assigns each adaptation to its actual funding source and selects the deployment host and responsibility for service charges, purchase principal and network fees. The grant’s existing usage targets and cost assumptions remain the shared plan.

The original La Jolla receiving operation is registered; its complete operating run continues with the existing native owner and selected source rules. The standalone product and Python receiving implementation are merged. The original sent inquiry is retained in the company record; native receiving continues under its original operation and source selection.

The complete [coastal operating guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/92eb1c73a3cab9781ef7dbabdc12067344fb6aa2/products/coops/OPERATING.md), [study and release guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/92eb1c73a3cab9781ef7dbabdc12067344fb6aa2/stellar/scf-starforge-20261009/sf30-seller-sdk/coops/STUDIES.md), and [Python receiving guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/92eb1c73a3cab9781ef7dbabdc12067344fb6aa2/stellar/scf-starforge-20261009/sf30-seller-sdk/coops/python/RECEIVING.md) retain the full source and operator workflow. The original commissioning brief and company contact operation retain the proposed scope, milestones and correspondence.

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

SCF's four payments are 10%, 20%, 30% and 40%: USD-equivalent 3,800 / 7,600 / 11,400 / 15,200 for this request. Tranche delivery costs are 11,400 / 11,400 / 15,200. SCF pays XLM using the settlement price for the day the award is paid, following [Official Rules §5.6](https://stellar.gitbook.io/scf-handbook/scf-awards/official-rules-for-submissions). Actual receipt dates, rather than a forecast award or payout date, anchor the completion-form deadlines.

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

## Federal awards: complete funding research, workshares and receiving

The [Federal awards and workshares product](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/87801e395d496ffb36fba5cd7215ea942ed96aa2/products/federal-awards/README.md) is merged in the maintained Merchant Workspace through [PR177](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/177), source revision `87801e395d496ffb36fba5cd7215ea942ed96aa2`. It joins the original USAspending source, award and transaction workspace, research dossier, merchant tools and managed Applications. This is the reusable starting product for a selected customer’s deployment under the existing grant plan.

**Customer task and commercial roles.** A contractor, research service or agency commissions a recurring review of the federal awards relevant to its defined work. The commissioning payer funds that installation; the merchant operates the agreed data or research service; the buyer approves and acquires a particular useful edition; the receiving analyst uses the whole result; and a second engineer maintains the installation. The original workorder names those parties, their source rights, the award population and reporting period, the public output, the receiving application, the priced unit, acceptance and update frequency. Private fit assessments, relationship notes and commercial terms stay within the selected working handover.

The useful paid unit is the complete dataset or research delivery agreed in that workorder. The existing product already prepares reviewed public award datasets through its original merchant bundle. When a customer selects a funding-change report as its paid output, T1 implements that report’s source-bound output mapping and receiving path through the same merchant and buyer components. The buyer’s review binds the original request, source edition, complete output, network, asset, recipient and atomic amount. The installation charges for the agreed curated service and delivery; the underlying official award source remains identified in every edition.

**Operate the complete research job.**

1. **Select and retain the original award source.** Save the actual agency, date, award-type and industry filters or receive the complete existing source collection. Preserve the request and all returned pages, select the immutable award edition, and inspect the prime, parent award, awarding agency and funding agency. Source observation time remains separate from the agency’s action and performance dates.
2. **Capture the award’s funding history.** Continue the official transaction endpoint through its terminal page. Accepted pages and their normalized occurrences commit together. Review the chronological modifications and fiscal-year totals with exact decimal values, negative and zero changes, missing fields, repeated IDs and conflicting occurrences. A stopped request resumes its original capture and continuation.
3. **Prepare the whole workshare.** Save the fit, explanation of funding changes, proposed implementation, complete deliverables, acceptance, owner, case link and next action. The completed capture’s source fingerprint and the review revision bind that assessment to the original records. Put the research question, sources, findings and citations in the existing dossier when that is part of the customer job.
4. **Deliver usable output.** For the selected public award dataset, prepare the original merchant bundle and reviewed payment terms; the buyer receives the complete agreed edition through the maintained delivery workflow. The working handover contains the full workspace, selected award edition, transaction capture, original responses and receipts, spreadsheet-safe CSV, workshare brief and selected complete dossier. The receiving analyst receives the full source and editable research required by the agreed task.
5. **Continue the installation.** Restore the complete workspace on the receiving host or receive the original award followed by its transaction capture into an existing workspace. Reopen the saved application, continue its assessment, compare a later source observation and preserve the earlier delivered edition. The receiving engineer uses the same original job, export and workspace identities through interruption and restart.

**Original retained example.** The official transaction response acquired on October 12, 2026 at 13:41 UTC completed one page with `hasNext:false` and two occurrences for `CONT_AWD_47QACA26F0383_4732_NNG15SC27B_8000`. The accompanying award names Carahsoft Technology Corp, GSA’s Federal Acquisition Service as the awarding agency, OPM as the funding agency, and an agentic artificial intelligence implementation. Its reported performance period is September 14, 2026 to September 13, 2027.

|Original action date|Modification|Transaction obligation|Original action description|
|  ---  |  ---  |  ---  |  ---  |
|2026-09-11|0|$1,666,999.96|Not reported|
|2026-09-28|P00001|$437,800.00|OTHER ADMINISTRATIVE ACTION|
|**Complete retained history**|**Two source transactions**|**$2,104,799.96**|**Both original records retained**|


The original award separately reports $2,104,799.96 in obligations and exercised value, $8,772,799.80 including all options, and a null overall outlay field. The research retains those field meanings. The source action description remains attached to its own financial change, and the commercial workshare gets its own proposed price and acceptance. [Complete retained original source](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/6096db94d538ae73bdbee9483366062b7ecbe595/.swarm-delivery/64b7-usaspending-transactions/original-source-packet.json) · [Official transaction contract](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/transactions.md).

**Install the exact maintained product.** The canonical source is `woahwhattheheck/tjlabs-stellar-merchant-workspace` at the revision above. Its [federal-awards selection](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/87801e395d496ffb36fba5cd7215ea942ed96aa2/stellar/scf-starforge-20261009/distribution/selections/federal-awards.json) carries the source-owned merchant and Applications registrations, original runtime commands, browser assets and receiving programs. Use Linux, Node 22.16 or later, and the original installer’s declared dependency profile.

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout \
  --ref 87801e395d496ffb36fba5cd7215ea942ed96aa2 \
  --selection federal-awards --out /private/federal-awards-release
```

The builder returns the archive and its digest. The maintained `runtime-install prepare`, `install` and `inspect --load --source` sequence uses that exact archive and the `schema`, `openapi`, `mcp` and operator features. For a first installation, the same commands are available from `distribution/runtime-install-cli.mjs` in the original checkout. The [complete operating guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/87801e395d496ffb36fba5cd7215ea942ed96aa2/products/federal-awards/OPERATING.md) gives the exact installation and source-entry arguments, retained build continuation and native merchant connection.

Once installed, `starforge usaspending-research init` and `serve` open the private award workspace. **Transactions & modifications** exposes the funding history and workshare. For managed operation, attach the original READY runtime, select **Applications → Federal awards and workshares**, save the private research and optional delivery folders, review the start and open the retained application URL. The same saved entry stops and reopens the original workspace. The native merchant provider `usa-spending-workspaces` exposes the same source, capture, review, comparison and retained-export operations.

**Complete customer receiving.** The [receiving guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/87801e395d496ffb36fba5cd7215ea942ed96aa2/products/federal-awards/RECEIVING.md) carries the actual restore and import commands. The delivery includes `complete-workspace.json`; the original award edition and `transaction-capture.json`; original response/receipt files; `transactions.csv`; `workshare.md`; and the complete dossier when selected. A prepared merchant bundle or finalized customer delivery travels with the commercial operation. The package also includes the maintained original receiving programs for CLI/browser, merchant export/reopen and saved Applications. Their ongoing native receiving operation consumes this same retained input and will add its resulting working directories and reports to the installation record.

**Linkage to the current grant milestones.** A federal-awards installation is one candidate for the application’s two independent merchant deployments. The following allocations are the existing shared packages for both installations; the original workorder assigns the selected customer’s implementation within them. The delivered product and acquired example supply the starting material. The prospective work is the customer-specific Stellar integration, deployment and independent technical receiving.

|Existing funded package|Original allocation|Remaining federal-awards installation work and completion|
|  ---  |  ---  |  ---  |
|T1 merchant-resource integration, days 1–30|80 hours / $7,600|Implement the selected customer’s source selection, public projection or report-output mapping, native route and payment terms, buyer setup and receiving application. Each independent merchant operates its agreed useful service and the buyer opens the complete result.|
|T1 authority and handover, days 1–30|40 hours / $3,800|Implement the customer’s source/terms change or withdrawal and receiving-engineer configuration. A second operator reopens the installation, completes the agreed change and can still open earlier acquired output.|
|T2 provider and ledger deployment, days 31–90|70 hours / $6,650|Register and integrate the same agreed award-data or research operation with both independent facilitators. Two independent buyer operators complete the existing target of at least ten useful testnet purchases during seven consecutive days ending by day 90, with complete output and the original intent and transfer for each purchase.|
|T2 deployed threat response, days 31–90|50 hours / $4,750|Implement the selected host’s threat assessment, monitoring and response. The customer operates the interrupted-settled-purchase and merchant-delivery-failure cases, retaining the source selection, financial outcome, unfinished delivery, acknowledgment and recovered useful output.|
|T3 mainnet rollout, days 91–150|90 hours / $8,550|Deploy both selected merchant services with actual production network, account, asset, release and rollback configuration. Two independent buyers complete the existing thirty-purchase target in fourteen consecutive days ending by day 150, each returning for a distinct completed purchase on another day.|
|T3 production recovery and handover, days 91–150|70 hours / $6,650|Finish supervision, off-host retention, key rotation and receiving-host restore. The receiving engineer restores the original source, workspace and complete customer files, reconciles later operations, measures recovery time and resolves the independent maintainer’s support case.|
|**Existing total**|**400 hours / $38,000 / 150 days**|**The same two-installation plan and acceptance clock.**|


**Measure recurring value.** For the agreed award population and period, record the customer’s previous research effort where available, the complete accepted output, analyst correction time and the receiving engineer’s active handover effort. Retain original capture coverage and changes between editions. A later useful source update and its separately approved purchase enter the existing cohort; reopening an acquired result or continuing a file transfer follows that original purchase. The resulting workorder, accepted output and actual delivery effort inform the next commercial installation while the grant’s existing independent-use and handover measures track the deployed service.

## Environmental provider intake: complete source editions, commissioning and receiving

The recurring customer task is to bring a provider's observations into an existing environmental-data intake process, review the source's meaning and deliver a complete handoff that another engineer can use. The provider may correct a station definition, change a variable mapping or supply a new observation period; the receiving team needs the resulting edition and the earlier accepted one. Axiom's [published intake process](https://www.axiomdatascience.com/best-practices/SubmitDataSensors.html) makes that need specific: it prefers ERDDAP access, documents variable-name inconsistencies that require manual intervention, and requests scientific and technical context alongside the data.

### Commercial scope and accountable roles

The original Axiom workshare was sent on **12 October 2026 at 11:22:14 UTC**, with a complete workshare, fillable intake worksheet, acceptance cases and operating guide. It proposes **$12,600 for 96 engineering hours over 18 active business days**: three representative provider feeds, one client-managed Linux installation and one agreed file/command receiving integration. Proposed payments are **$6,300 at kickoff and $6,300 after receiving acceptance**. Eight of the 96 hours cover in-scope implementation corrections during the first 30 days after acceptance. The delivery clock starts with the selected source access and receiving environment available. This is a sent proposal; an accepted engagement, issued invoice, payment and customer installation have not been recorded.

| Role | Decision and responsibility in the proposed installation |
| --- | --- |
| Commissioning payer and acceptance owner | The final workorder names the contracting payer, the three selected feeds, the receiving environment and the person accepting the delivered integration. The proposal names Axiom's intake team as the receiving organization; agreement is still to be reached. |
| Source provider and scientific contact | Supply authorized access, source licensing and attribution, station and time context, processing history and existing quality definitions. The designated scientific team owns interpretation, calibration and any newly requested quality evaluation. |
| TJLabs implementation engineer | Configure and integrate the existing application, resolve implementation defects, deliver the complete permitted source and operator materials, and carry out the agreed receiving walkthrough and included support. |
| Merchant and independent buyer for a funded deployment | Separately agree the authorized published operation, complete result, price unit, payment asset and terms, recurring buyer task and buyer application. These are deployment-selection decisions under the common grant plan. |
| Receiving engineer and later maintainer | Operate the agreed file/command boundary, inspect the full received source and review, reopen the installation, correct a later edition and retain the earlier accepted output. |

The workshare allocates 16 hours to source/receiving design, 28 to provider configuration, 24 to installation and handoff integration, 20 to receiving and operator handover, and eight to initial support. These are the case's fixed-fee delivery allocations. They do not change the application's $38,000 / 400-hour / 150-day budget.

### The complete useful operation

1. **Select and retain the source.** The operator chooses the actual grid or station-table query and retains the original metadata, query, data responses and acquisition record. The agreed station set, observation period, variables, units, source authority and permitted use define the population. The included historical examples provide reusable public reference inputs; customer commissioning uses the separately selected authorized feeds.
2. **Review the source and provider context.** The operator inspects every selected field and station, keeps the original values and quality flags, and records explicit column, time and edition decisions. Dataset CSV policy and provider data-edition choice are separate controls. Missing scientific context stays visible in a working review until the responsible person resolves it.
3. **Save and produce the complete edition.** The application records an immutable reviewed revision and its source, mapping and evaluator version. The full handoff carries the original capture, names-and-units observations, station definitions, variable mappings, time and quality disclosures, a missing-value sidecar and the reviewed profile. A completed-intake export follows the actual review's readiness result.
4. **Receive the actual output.** The receiving installation validates the complete bundle, retains its source and review, provides the same exact ZIP for later download and reopens the saved result. The commissioned file/command integration places that handoff in the customer's agreed environment and reports the actual receiving outcome.
5. **Correct and return.** A changed mapping, provider context or observation period becomes a separately reviewed edition. Lost save responses, concurrent reviews and later exports remain tied to their original requests and history. The receiving engineer can compare the new edition while preserving earlier accepted files and meaning.

For a funded paid installation, the workorder would define the priced unit as a complete agreed source/data edition or bounded useful query. If that task needs several priced requests or pages, the buyer sees the aggregate cost and receives all of the accepted result. A new period, revised source edition or a new authorized analytical request can create a later useful purchase. Redownloading, transferring or recovering the same output continues its original purchase. The merchant's source rights, actual Stellar terms and original financial record remain explicit; a local dataset or review export is engineering evidence rather than a new network purchase.

### Working product and demonstrated receiving

The [complete ERDDAP product](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/184abaf54ce864973f7a28fc8fb835b83497ef5b/stellar/scf-starforge-20261009/sf30-seller-sdk/erddap) supports source acquisition and inspection, immutable native dataset editions and queries, provider profiles and saved reviews, full source/customer exports, original merchant and buyer integration, typed clients, 36 MCP tools and the operator UI. The maintained standalone selection is **erddap-provider**. Its [operating guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/5f7143f88bb28fbd0c1b63a913545633c475afd6/products/erddap-provider/OPERATING.md) carries the original selected build and runtime-install procedure; Managed Applications exposes **Ocean and environmental data** for the same initialized workspace.

The current selected source explicitly includes five retained NOAA capture ZIPs: three 27-row MUR grid selections, the 144-row NDBC station selection and a 432-row longer NDBC period. The station selections overlap and retain separate source identities. Their complete metadata, DDS, DAS, JSON, CSV and acquisition records are listed in the [source index](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/5f7143f88bb28fbd0c1b63a913545633c475afd6/products/erddap-provider/SOURCE.json).

The original native operation completed the **144-row NDBC station 46042 selection for 1 June 2023**, queried the complete dataset, exported its source and edition, and independently received and reopened it. The same operation saved three provider-review revisions. It exercised exact-save recovery, concurrent-head rejection, review export and independent bundle receiving. The selected canonical-JSON profile retains its actual unresolved scientific-contact appointment; its current review is useful and its ready-export status remains false.

An actual comparator upgrade also exposed and resolved a continuity problem: unchanged source/profile records could produce a different comparison report after a software upgrade. New review identities now bind the evaluator version; historical receiving deterministically reproduces the supported original evaluator. The continuation reproduced both original review ZIPs byte for byte, preserved their saved head and history through retries and reopened their independent receiving. It accepted the supported historical lexical and Decimal representations and rejected an unknown evaluator and a changed report with a recomputed hash.

The public and standalone source merges are complete. The original selected package build, installed receiving and full browser continuation are still pending with their existing operation. The demonstrated native results establish the source/review/receiving behavior; customer commissioning and the funded independent-use milestones remain to be completed.

### How this candidate uses the existing six funded packages

The following is an application of the common delivery plan if an environmental-data installation is selected. It assigns no additional budget or hours to Axiom, and the original two-merchant/two-buyer cohort and both independent facilitators remain the shared acceptance requirements.

| Existing funded package | Environmental-data work within that package | Acceptance in the selected customer task |
| --- | --- | --- |
| T1 — Merchant-resource integration | Configure the authorized source population, useful dataset operation, complete result and original merchant/buyer integration in the selected hosts. | The buyer's application opens the full agreed output with its source meaning and actual payment selection. |
| T1 — Authority and handover | Assign the source, technical, scientific and receiving owners; operate an agreed source/terms change or withdrawal through the existing installation. | A second accountable operator completes the change while earlier acquired output retains its original terms and meaning. |
| T2 — Provider and ledger deployment | Run the recurring observation/research task through the selected original payment and facilitator paths. | The common day-90 cohort completes through both independent facilitators with real intents, native transfers and full results. |
| T2 — Deployed threat response | Recover an interrupted settled request and a merchant-delivery failure against the deployed environmental operation. | The customer's accountable responder retains the financial outcome, incomplete step, acknowledgment and recovered useful output. |
| T3 — Mainnet rollout | Operate the agreed production source/query task, including useful returns for later periods, changed editions or new requests. | The common day-150 cohort uses both merchants and records returning buyers, complete outputs, amounts and fees by asset. |
| T3 — Production recovery and handover | Restore the original source, reviews, customer files and operating history on the authorized receiving host, then reconcile later work. | The receiving engineer measures recovery, reopens the full result and completes the independent maintainer support case. |

Source intake, scientific review and actual paid delivery remain visible as separate parts of the same customer workflow. This lets the commissioning team price and accept useful implementation work while the grant measures independently operated Stellar services, complete buyer results, recurring use and maintainable handover.

**Source and completed operation identities.** The primary customer need is Axiom's [sensor-intake guidance](https://www.axiomdatascience.com/best-practices/SubmitDataSensors.html). Complete public source is [PR2196](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2196), merge `184abaf54ce864973f7a28fc8fb835b83497ef5b`; the canonical standalone carry-forward is [PR118](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/118), merge `5f7143f88bb28fbd0c1b63a913545633c475afd6`, with its [operating guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/5f7143f88bb28fbd0c1b63a913545633c475afd6/products/erddap-provider/OPERATING.md) and [five-capture source index](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/5f7143f88bb28fbd0c1b63a913545633c475afd6/products/erddap-provider/SOURCE.json). The original 144-row native result is 14,560 bytes / SHA256 `31c402a6663b84b6003e608a7947d9c51a1c923a916b5abd1be299aaba4b1b7a`; the historical-review receiving continuation is 6,460 bytes / `844446d299546b0f7769f77cc95bcdab7559108de77e9ac553497260fcbe32ab`. The third reviewed-edition result is 48,204 bytes / `b67f4082dd4c898032167fbdfce3c68242cfffc087797cd0d77489e40e8f920f`. These retained native records support the stated completed behavior; selected installation, full browser acceptance, customer agreement and paid deployment keep their actual pending state. The contribution publishes source references and result identities; private customer-operation files remain with their original custody.

## Datasette editions and customer analysis

A customer who works from a published Datasette table needs the entire selected edition, its source meaning and an editable analysis that another operator can receive. The source operator reviews the table or query, complete capture, source columns, explicit projection and business key, then prepares the original dataset publication. The customer application opens that same reviewed edition or its retained original page bundle in the maintained Analysis workspace.

The complete WRI geothermal example contains 189 records and 26 returned positions (25 physical columns plus the row locator) across 22 countries, with 12,563.55 MW of disclosed capacity. All four response pages, ordered schema, publisher attribution and CC Attribution 4.0 metadata accompany the source. The reports keep capture time separate from the observations' historical years: 110 records have no stated capacity-data year. Exact numeric spellings, blank or null observations and original business identifiers remain available alongside country, owner, fuel, capacity-year, generation-year and source-quality summaries.

The customer application provides the original source rows, saved SQL, published HTML/JSON/table reports, an Excel workbook and a full editable workspace transfer. A receiver can reopen the same analysis, save a country selection, produce a fresh delivery and transfer that edited workspace onward. Its Applications integration, browser, native command and typed client use the same retained workspace and original Python installation.

For a commissioned service, the workorder names the source/release operator, commissioning payer, independent buyer and receiving engineer; defines the complete table or query edition and useful analysis output; records the reviewed source/license and paid-resource terms; and names the later data release that justifies repeat use. Source adaptation and publication, buyer integration, deployment, customer operation and independent handover use the existing six funded packages. The current 400-hour / $38,000 / 150-day grant plan supplies the shared commissioning scope.

[Complete customer source and operating guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2287) · [Original source, publisher and edition product](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2281)

## Webhook customer adoption: complete event tasks and operator handover

Our 11 October Mercury/Xycloo outreach proposed implementing one customer's Stellar contract/event family into one existing database or internal API, with source, deployment instructions and receiving-engineer handover. Mercury would retain its subscription and customer relationship; we would implement the selected workflow under its review.

The shipped [Webhook event operations product](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/223) supplies signed ingestion, reviewed output fields, separately identified events within a transaction, paid cursor pages, saved buyer operations, NDJSON delivery and complete private operator receiving. An independent buyer collects a fixed event window, applies it to its existing application and returns for a later useful window. Each page retains its actual price and financial outcome; acceptance requires the complete customer task.

For a selected installation, T1 commissions its source, destination adapter, actual payment terms and independent operator handover. T2 deploys the same useful operation through both selected facilitators and recovers an interrupted settled request and a delivery failure against that customer's application. T3 operates recurring mainnet use and receiving-host restore, reconciles later operations and completes an independent support case. These adaptations fit the existing $38,000 / 400-hour / 150-day plan and its two-merchant/two-buyer cohort. Actual customer adaptations are assigned once to their funded package or original commercial workorder.

The [commissioning guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/2e622209e2a1ce47f9f5764ad424c30c66212d19/products/webhook-feed/COMMISSIONING.md) carries the selected source, event mapping, page and task spending, destination acknowledgment, later-window continuation and receiving responsibility through one usable installation. This makes the recurring customer result and the engineer's ability to maintain it explicit acceptance outcomes.

## OpenFn: paid workflow commissioning and complete receiving

**Paid workflow commissioning and complete receiving — OpenFn.** The [complete source and operating contract](https://github.com/woahwhattheheck/commons/tree/2e3849c83ea968f2324c7402b30c2487b762b49c/opportunities/openfn-commissioning-20261012) expose `commissionOpenFn`: one reviewed source-to-PostgreSQL commissioning and handover operation under the original merchant offer. The buyer supplies complete source and strict mapping files, optionally with a paired baseline, and reviews their exact input digest through the existing governor and signer. The merchant selects the installed OpenFn runtime and credential profile and keeps one stable isolated PostgreSQL namespace per original job. Customer input cannot select executable code, SQL, credential paths or a production namespace. The worker reviews data quality, applies eligible changes and reconciles the target; it returns `COMMISSIONED` with its original run and target-operation identities, or `REVIEW_REQUIRED` with the retained inputs and review. The result contains an inventoried handover, the unchanged portable workspace, original inputs, editable native project and reports. The existing buyer verifies the native job, request and result bindings, then receives and reopens that complete workspace with a fresh target review. Retries retain the same job and original operations; a corrected-source request is a separately reviewed useful unit. The configured per-job offer is distinct from the implementation proposal below. Source is published; the full native and paid-job receiving outcomes remain pending.

**OpenFn implementation opportunity.** The original workshare proposal was sent to OpenFn’s published enterprise mailbox on October 12 at 13:19:25 UTC: **USD8,500 / 80 hours / fifteen business days**, with USD4,250 at kickoff and USD4,250 at accepted handover. It covers one source family, one selected PostgreSQL feed/namespace and report projection, reviewed correction, original-run recovery, editable source, independent receiving and training. [OpenFn publishes implementation, support and training services](https://www.openfn.org/support); OpenFn or its selected prime would retain the client, environment, production approvals and platform support for this proposed workshare. The commissioning application, complete operator source and Stellar service composition are published. Its original native continuation is still being reconciled, and no paid job or independent installation has been established. This remains a sent proposal without recorded customer acceptance or revenue; it does not add a favorable response or deployment to the current counts. The selected future deployment work remains within the existing six funded packages.

| Existing prospective work package | OpenFn service application of that work |
| --- | --- |
| Merchant/resource integration — 80 hours / USD7,600 | Join the selected commissioning function, exact source/mapping contract, original worker and complete result with the existing seller resource. |
| Authority/receiving/handover — 40 hours / USD3,800 | Bind private operator-selected target authority, original paid result and independent customer receiving to the selected deployment. |
| Provider/ledger deployment — 70 hours / USD6,650 | Complete the useful job through the actual selected facilitator and ledger, preserving the original settlement and operation across response loss. |
| Deployed threat response — 50 hours / USD4,750 | Verify the deployed input/namespace boundary, governed payer authority, retained failure outcomes and same-job recovery on the installed host. |
| Mainnet rollout — 90 hours / USD8,550 | Apply the reviewed useful service to selected independent customers and their actual recurring mainnet operations. |
| Production recovery/handover — 70 hours / USD6,650 | Complete original job/result and whole-workspace receiving, host recovery, later-source correction and receiving-engineer operation. |

These are the existing six package totals, not an additional allocation of all 400 hours to OpenFn. The same scope ledger assigns installation-specific work across the selected customers once. Completed general commissioning engineering and an accepted commercial engagement, if one follows, retain their own funding/cost records rather than being invoiced retrospectively to SCF.

The programme still targets two independently operated merchants, two independent buyer operators and completion of the same useful operation through two independent facilitators. Its existing testnet/mainnet usage targets and 150-day acceptance windows remain unchanged. Original offered implementation work, same-job retries and team-operated demonstrations are not counted as independent customer adoption.

[Complete commissioning source and operating contract](https://github.com/woahwhattheheck/commons/tree/2e3849c83ea968f2324c7402b30c2487b762b49c/opportunities/openfn-commissioning-20261012) · [Funded-service and six-package inclusion guide](https://github.com/woahwhattheheck/commons/blob/2e3849c83ea968f2324c7402b30c2487b762b49c/opportunities/openfn-commissioning-20261012/SCF_INCLUSION.md)

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
