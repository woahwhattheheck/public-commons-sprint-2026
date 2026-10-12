# Reviewer application

**Stellar Discovery Trust Layer — TokenJunkieLabs — SCF #46 Build / Open Track**

## Project and requested outcome

We are building open-source, self-hostable software for operating paid APIs, datasets and agent tools on Stellar. A merchant selects the resource and commercial terms; a buyer approves a specific request and controls its wallet and spending. The software carries that agreement through native settlement, complete usable output, fulfillment, recovery and handover to another engineer.

We request **USD 38,000 for 400 prospective delivery hours over 150 days from actual award acceptance**. The award will fund the remaining source, consumer and deployment engineering for **two independently operated merchants and two independent buyer operators**, including completion of the same useful operation through **two independently operated facilitators**. The delivered result will be a maintainable service on Stellar mainnet, with recurring customer use and an independently completed recovery and handover.

The existing product supplies the architecture, merchant and buyer workspaces, source adapters, payment integration, result receiving and operating controls. The six funded packages below apply that product to the selected customers’ actual sources, applications and hosts. They include installation-specific implementation and defects, provider integration, deployed threat response, production release and technical receiving.

## Customer problem, need and adoption

API and data operators want to sell useful operations to applications and agents while retaining source rights, access rules and commercial control. Buyers need the complete result they approved, in a form their existing application can use. Staff also need to recover an interrupted paid request and transfer the working service to another maintainer.

That task joins four records: the approved request, the settled transfer, the delivered output and the accepted fulfillment or accounting. A payment confirmation alone does not show whether a multi-page dataset is complete, whether its values retained their original meaning, or whether an order reached its intended state. The customer’s useful task can contain several priced requests, so its aggregate cost and complete output must remain visible.

Public October 2–3 x402 reports illustrate this operational need: one merchant rejected payment-bearing requests because its POST requirement differed from a client’s GET retry; another reported settlement without its expected discovery listing. These reports concerned Base deployments, and their follow-ups include a corrected server and successful indexing. They inform the request, discovery and recovery joins we implement on Stellar.

Our current human conversations provide more specific customer learning:

|Organization|Observed response|Proposed useful implementation|
|  ---  |  ---  |  ---  |
|Veridex|Invited an open testnet design partnership after declining a third-party testing budget.|One agreed testnet route and buyer adaptation, proposed at $1,500 over five business days.|
|Nansen|Referred the proposal internally and confirmed on October 12 that the Holdings detail was included.|Read-only Ethereum Holdings data, Stellar testnet payment and source/operator handover, proposed at $2,400 over five business days.|
|CoCart|Founder Sébastien Dumont asked about introductions, the payer, referral compensation, responsibilities and contracting.|One customer’s headless cart, native WooCommerce checkout, payment/order operation and receiving, proposed at $7,200 for 60 hours over fifteen business days.|
|Blockscout|Mojmir Racak expressed interest on October 12 and reported no current integration budget.|One approved PRO API token-information operation, buyer integration and handover, proposed at $4,800 over ten business days.|


These conversations identify the practical selection decisions: a recurring buyer task, usable source rights, an accountable merchant host, an independent receiving application and an agreed commissioning payer. A participating platform and the organization paying for its integration can be different organizations. For CoCart, the first merchant or agency and commissioning arrangement remain to be selected. Bryce owns these favorable relationships and subsequent agreements.

For each funded installation, the original workorder will name the payer, merchant, buyer and receiving operator; the source and authorized access; the exact request, complete output and priced unit; the host and receiving application; and the person accepting delivery. It will record what makes a later purchase useful, such as a fresh period, changed source edition or new customer request. The implementation team then takes that same task through deployment, complete result receiving, recurring use and maintainer handover.

## Why Stellar and what we contribute

Stellar is the settlement layer for the approved operation. Buyer approval binds the complete request to its network, asset, recipient and integer atomic amount. The native Stellar SDK and configured payment service verify and settle the authorization; the application connects that outcome to the original source, useful result and merchant fulfillment. Buyers control signing and aggregate spending. Merchants control their resources, terms and order actions.

We compose existing ecosystem infrastructure. The x402 Exact Stellar scheme and facilitator supply payment verification and settlement. Vellar’s optional discovery extension publishes eligible settled resources to its catalogue. OpenZeppelin, Veridex and Periplo supply relevant payment infrastructure; Rumble Fish is developing facilitator, discovery and SDK capabilities. Our existing MPP Charge workbench retains that protocol’s own challenge, authorization and recovery model. We use the existing SDK and token contracts.

Our contribution is the repeated source-to-customer operation around those components: preserve the source’s types and pagination; review the exact request and terms; acquire the complete result; receive it into an existing application, report or workbook; and reopen the operating state after interruption or on another authorized host. This gives Stellar merchants a reusable path from a paid endpoint to an independently maintainable customer installation.

A retained comparison found 27 Vellar offers and two Periplo offers with no shared seller/route identity. The two-facilitator milestone therefore includes the actual registration and integration work for the same useful service. Its completion will demonstrate that a merchant can change payment infrastructure while preserving the customer operation. Reusable integration, receiving and operating improvements will return to the public source.

## Defined architecture and operating behavior

The system has six components: the merchant’s private source/release workspace; its public HTTP or MCP operation; the native Stellar SDK and selected facilitator; the buyer’s private approval and spending state; complete result and delivery records; and merchant fulfillment/accounting. Node.js supplies the merchant and buyer interfaces. Source adapters and customer applications retain their own native data and operating semantics.

|Stage|Implemented behavior|
|  ---  |  ---  |
|Review and publish|The merchant selects a source edition or named live query, request schema, public output, limits and resolved payment options. It reviews rights, route, network, asset, recipient, amount and authorization lifetime. Later source or terms changes become reviewed states.|
|Connect the source|Adapters preserve types, missing and null values, pagination, keys, units, time basis and snapshot/live behavior. Customer-controlled credential or OAuth references select authorized access. The output identifies its source edition.|
|Approve and purchase|The buyer retains the endpoint, method or MCP tool, arguments, selected terms and scope. The remote schema and challenge must match before signing. Per-payment limits and the application’s existing reservation/budget owner govern spend.|
|Settle and deliver|The facilitator verifies and settles the native authorization. The application retains the server outcome, complete output and durable merchant notification. Independent RPC reconciliation checks the transaction’s network, asset, parties and atomic amount.|
|Use and continue|The receiving application opens all pages and files required by the agreed task. Its parent acquisition retains the paid requests and incomplete coverage. Earlier acquired output remains available when a later source edition changes.|
|Operate and hand over|The customer selects its release, HTTPS service, restricted administration and supervision. A receiving engineer can drain, restart, roll back and restore it with the original operating history and complete customer files.|


For paid MCP, the HTTP endpoint, tool and arguments remain distinct from the payment resource. An unsigned call obtains the challenge. Its full payment option, including authorization timeout, must match the saved quote before the buyer retains dispatch state and sends the signed tool call. The official MCP SDK carries payment and settlement metadata; HTTP operations use the native HTTP transport.

Recovery keeps server confirmation, independently observed transfer, complete output, receiver acknowledgment and fulfillment separately visible. An uncertain signed response retains its original dispatch state for reconciliation. Reopening an acquired result uses the saved work; an unfinished delivery continues from its original intent. A changed request or new purchase receives a new review. Export and restore carry the configuration selection, history and complete referenced files, while the receiving host supplies current authorized secret references.

The same workspaces are available through the browser, terminal, typed clients and MCP. The captured-API product connects reusable route policies to a saved operator procedure, exact native configuration review, continued publication and complete customer files. Its collaboration workflow supports independent draft edits, explicit resolution of overlapping changes and portable working-edit files. The original draft and package writers retain the save, export and receiving lifecycle. This supports installation work by multiple operators while preserving the selected source, procedures and earlier decisions.

## Working product and demonstrated results

Our current network record comprises **18 distinct team-operated development purchases totaling 411,000 stroops, or 0.0411 native testnet XLM**, with fees tracked separately. The retained register connects each purchase to its original transaction and complete output. The funded customer milestones extend this foundation to independently operated services and buyers.

Three completed operations show the useful result:

|Operation|Completed result|
|  ---  |  ---  |
|Municipal data|A Queens HPD source contained 1,342 building-in-project rows. The selected result received all 144 rows in paid pages of 100 and 44. Both 10,000-stroop transfers finalized, and the full CSV/JSONL edition reopened with source and accounting.|
|Paid agent query|The MariaDB HPD Preservation/minimum-20 query returned all 100 rows, 14 columns and 53,468 bytes for one 50,000-stroop purchase. Scalar strings and its declared truncation indicator were retained. The purchase reopened with signing disconnected; its packet and complete result reopened in another directory. These are project-event records.|
|Filing analysis|A 10,000-stroop purchase delivered the Genpact 2024–2025 comparison: four disclosure pairs, five findings and all 1,027,807 bytes. The editable analyst workspace reopened it, repeat receipt preserved its revision, and backup/restore reproduced the comparison in another installation.|


The identified agent-query example completed on October 11 at 20:12:58 UTC, Stellar testnet ledger **5,145,195**, transaction **50d61d1102bfcf960af44171e5248e0899ed6d99cec1951a62075f9a65a6cbed**. Its full result SHA-256 is **4c22f8a26d48156c3e07543328b62ca6f993ce60856166d6805dc0660d9acb8d**. This identifies the operated result underlying the product demonstration.

Complete receiving has also preserved all sixteen rows of a Census workbook across CSV, JSONL, SQLite, browser and Rust clients; a later edition identified fifteen unchanged rows and one changed row while the earlier customer retained its original values. The supplier workflow imported both complete 106-material SAP SHINE publisher editions, reviewed their supplier changes and reopened the full catalogue handover. An installed incident-to-case operation completed an observation gap, notification retry, acknowledgment, recovery and support-case reopening.

The captioned **3-minute-32-second product/team film** follows the native HPD query, saved terms, one 0.005-testnet-XLM purchase, complete result, download and reopening. Its editable companion includes eleven clips, captions, script, result and rendering tools. The reviewer workbench has completed original-packet receiving, full-result reads, export, cold reopening and second-operator receiving across desktop and 390-pixel mobile views.

## Three funded tranches and six priced deliverables

Day zero is actual award acceptance. The proposed rate assumption is **$95 per hour**. Every package below is prospective Stellar integration and deployment work using the existing architecture.

|Tranche / window|Deliverable and remaining work|Hours / cost|Completion criterion|
|  ---  |  ---  |  ---  |  ---  |
|T1 — days 1–30|Merchant-resource integration: implement both customers’ authorized source/runtime, typed consumer mappings, routes, native terms and buyer setup.|80 / $7,600|Each independent merchant operates one agreed useful HTTP or MCP service on its host. Its buyer opens the complete result in the actual receiving application, retaining source meaning and payment selection.|
|T1 — days 1–30|Authority and handover: integrate source/terms change or withdrawal, receiving-engineer configuration, installation defects and recovery procedure.|40 / $3,800|A second accountable operator reopens each installation and completes the agreed change or withdrawal. The offered state changes as reviewed and earlier acquired output remains available under its original terms.|
|T2 — days 31–90|Provider and ledger deployment: register and integrate the same selected service with two independent facilitators, retaining each actual payment scheme, requirements and fee policy.|70 / $6,650|Two independent buyer operators complete at least ten useful testnet purchases in total across the two buyers during seven consecutive days ending by day 90. The same useful operation completes through both facilitators; every completion joins its original intent, native transfer and full output.|
|T2 — days 31–90|Deployed threat response: implement the customer-specific threat assessment, monitoring, notifications and material remediation.|50 / $4,750|The customer operates two installed response cases: an interrupted settled purchase and a merchant-delivery failure. Both retain the original financial outcome, unfinished step, acknowledgment, recovery and useful result.|
|T3 — days 91–150|Mainnet rollout: integrate both production hosts, network/asset/account configuration, recurring consumer use, controlled release, rollback and deployment fixes.|90 / $8,550|Both merchants operate on mainnet. Two independent buyers complete at least thirty useful purchases in total across the two buyers within fourteen consecutive days ending by day 150, with both returning for a distinct completed purchase on another day. Amounts and fees remain separately reported by asset.|
|T3 — days 91–150|Production recovery and handover: finish supervision, off-host retention, key rotation, receiving-host restore and reconciliation after the backup point.|70 / $6,650|An authorized receiving engineer restores the original state and customer files, reconciles later operations, measures recovery time and completes an independent maintainer’s support case.|
|**Total**|**Two merchant installations, recurring independent use and a maintainable mainnet service.**|**400 / $38,000**|**Complete useful operations and independently received operating state.**|


Tranche delivery costs are **$11,400 / $11,400 / $15,200**. The allocation comprises **320 engineering hours and 80 integration/handover hours**: 96 + 24 in T1, 96 + 24 in T2, and 128 + 32 in T3.

The workorder assigns every adaptation once to its grant package or separately commissioned commercial scope. Award funds cover future Stellar integration, deployment fixes and technical receiving. Existing implementation, routine operations, sales and purchased usage sit outside that allocation. The usage targets include no purchase subsidy. Existing compute is the starting resource; the incremental service reserve and planned hosted Actions budget are both $0.

## Threat response and outcome measurement

The day-90 deliverable includes a deployment-specific threat model and monitoring plan. It assigns thresholds, notification destinations and accountable responders to the selected hosts.

The response design addresses changed requests or terms before dispatch; uncertain payment and incomplete delivery; unauthorized access to private state; observation or notification failure; and restart or local-state loss. Controls retain exact approved context, scoped authority, original financial outcomes, incomplete output and the relevant backup. Operational measures include outstanding age, useful observation coverage, alert and acknowledgment time, recovered output and restore duration. The two customer-operated response cases exercise the actual installed recovery path.

Each merchant’s output must be used by an independent buyer. A completed purchase joins a distinct approved intent, an independently observed native transfer and complete useful output. Counts deduplicate transactions within their network and each independent organization or person across agents and wallets. Reporting includes completed/attempted purchases, complete/started parent datasets or files, returning buyers, accepted handovers and the cohort’s partial, unresolved, canceled and refunded outcomes. Required fulfillment remains separately visible. Reopening an acquired result or resuming its file download continues the original purchase.

For each installation we record the existing customer task and, where available, a prior execution’s active effort, manual corrections and time to useful output. We compare the installed and recurring task against that same input/output definition, retaining the actual source population or period. Customer acceptance and unresolved corrections accompany those measurements. This assesses practical value: usable output, less manual work, repeat demand and a service the customer’s engineer can maintain.

## Delivery capacity, payment timing and sustainability

SCF’s four payments would be **$3,800 at award acceptance, then $7,600, $11,400 and $15,200 after the respective milestone approvals**. These payment amounts differ from the cost of performing each tranche. The request is expressed in USD-equivalent value and paid in XLM using SCF’s scheduled-payment-day conversion method.

The complete resource study retains the six packages, dependencies, 400 hours and $38,000 budget. With an illustrative December 7, 2026 start and its explicit working-day calendar, **25 engineering plus eight integration/handover hours per week** is the lowest examined timely allocation. All six tasks finish within their deadlines: T1 on January 6 and final handover on April 13, ahead of the illustrative May 6 day-150 target. The awarded schedule will use the actual start, named contributors and their working availability.

The selected schedule’s modeled peak additional cash requirement is **$17,250 with a 14-day review/payment lag, $23,275 at 30 days and $26,600 at 60 days**, under its stated labor-accrual assumptions. The opening-cash field is currently unentered. This makes the resource and payment-timing requirement explicit; the operating case records actual contributor payment commitments, receipts and work dates as they are established. Commercial proposals retain their own stages, assignments and collections.

Each tranche completion form will be submitted within 90 calendar days of receiving the previous tranche payment. Actual receipt dates set those form deadlines; the 30/90/150-day delivery plan runs from award acceptance. The same grant case retains the completed deliverables, submissions, payments and any SCF-confirmed schedule amendment.

The commercial model combines the open-source core, fixed-fee implementation of one agreed customer operation and separately scoped care. Merchants retain their resource receipts, while TokenJunkieLabs invoices its agreed engineering and handover. Our existing partner workflow researches a concrete service, prepares the complete editable implementation workshare, agrees receiving and maintenance responsibilities, and records delivery effort and collections. Eight October 12 data-platform proposals total $52,500 for 350 planned hours; these are proposed fees in their original company records. Actual acceptance, effort and support demand inform later pricing. Grant and commercial work keep their own funding assignments.

## Applicant, experience and submission

**Bryce Muhlnickel**, the United States individual operating **TokenJunkieLabs**, is accountable for product direction, customer relationships, engineering delivery and operations. The submitted classifications are **Developer Tooling; Open Track; United States team; Global / Not region-specific target markets**.

The published implementation uses JavaScript/Node.js, the Stellar x402 libraries and MCP; Python with typed, versioned SQLite data and saved SQL views; and PHP for native WordPress/WooCommerce mappings and checkout. The completed data, paid-query, receiving and recovery operations demonstrate the relevant implementation experience. Actual contributor roles and allocations are recorded within the delivery plan.

AI agents generated and assisted source code, interfaces, operating scripts, design, documentation and this application. They also performed source review and native operating exercises. Bryce remains responsible for the artifacts, statements and delivery commitments; the team film identifies his role and that assistance.

SCF acknowledged the individual Build Interest Form on **October 11, 2026 at 14:59:29 UTC**. The current state is **interest submitted and acknowledged, awaiting invitation**. SCF #46’s full Build deadline is **November 8, 2026**, with panel review November 11–18 and community voting November 23–December 3. The delivery clock starts at actual award acceptance.

The proposed award takes a working merchant/buyer foundation into two independently operated customer services. Reviewers can assess the complete current examples above and then evaluate each funded outcome: installed useful operations, independent recurring purchases, operated threat response, mainnet delivery and another engineer’s successful recovery and handover.
