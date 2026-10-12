# SCF 46 — threat model and monitoring plan

**Stellar Discovery Trust Layer — TokenJunkieLabs**  
**Prepared:** 2026-10-12  
**Status:** Public design baseline for the existing Build / Open Track application. Deployment-specific monitor bindings are planned; this document does not report a production deployment, a security audit, a live alert or a completed customer response.

## Intended outcome and funded scope

The day-90 security deliverable is an operated response path for the two selected merchant deployments and their independent buyers. An operator must be able to identify an affected native purchase, acknowledge the incident, recover its unfinished work and let the receiving engineer reopen the same case and useful output.

This work remains the existing **Tranche 2, 50-hour / USD 4,750 package** within the **USD 38,000, 400-hour, 150-day application**. The other 70 T2 hours cover the selected provider and ledger deployments. Historical source development and separately paid company work are not charged again. The application retains its existing merchant, buyer, facilitator, purchase-window and tranche targets. Its current submission state is interest submitted, awaiting invitation; this plan does not substitute for an invited form or issuer decision. [1]

SCF’s current criteria require a self-contained application, and its deliverable guidance includes a T2 threat model and monitoring plan. This baseline supplies the design; the funded work binds it to actual installations, implements the necessary observations and responses, remedies material findings and completes the two operator journeys. The public application contains the acceptance criteria itself. [2][3]

## System and trust boundaries

The system carries a merchant’s selected offer through buyer approval, native settlement, complete useful output, recovery and receiving. The assets at risk are spending authority, the integrity of merchant terms and source identity, correct attribution of transfers and output, private customer material, and the ability to recover the original work.

| Boundary | Authoritative input | What must remain separate |
| --- | --- | --- |
| Merchant publication to discovery | Accepted merchant authority, canonical resource identity and current source generation | Public discovery is an offer; it does not prove settlement or authorize a buyer’s signature. |
| Buyer approval to native dispatch | The saved approved request, selected payment option, network, asset, recipient and applicable limits | An agent’s proposal, a fresh quote and an existing approval are different records. |
| Facilitator/RPC to payment outcome | The selected network’s native transaction and processing evidence for the original intent | An HTTP acknowledgment, an uncertain reply and independently observed settlement are different outcomes. |
| Payment to useful delivery | Original entitlement or delivery session, child work and complete output identities | Settlement can be complete while output is partial. A resumed download does not establish a new purchase. |
| Browser/CLI/agent to private operator | The existing authenticated application, workspace identity and current authority | A local service, another workspace and a public page do not share administrative authority. |
| Saved state to receiving host | Selected source edition, recovery manifest, original state and later operation history | Restoring older state does not erase a later payment or permit replay of completed work. |
| Observations to responder | Current collection coverage, incident identity, notification attempt and acknowledgment | Process liveness is not payment health; missing observations are not a clean security result. |

For each installation, the private deployment annex identifies the actual source edition, merchant and buyer operators, facilitator/RPC selections, network and relevant accounts or contracts, ingress and secret custody, storage and recovery destinations, monitor bindings and named primary/backup responders. It records changes to these selections. A generic address placeholder cannot count as installed coverage.

The published baseline contains no credentials, customer paths or configured incident destinations. A populated monitoring plan remains with the responsible operators; the grant receives a sanitized coverage and outcome report. This follows Stellar’s guidance to retain stable threat/monitor links and keep a populated monitoring map internal. [4]

## Threat register

The identifiers below are stable across the public baseline, the private deployment annex and retained incidents. Priorities describe potential impact for planning; the installation review records exposure, residual risk and any justified change. Every row has a monitor and a permitted response below.

| ID | Threat and affected boundary | Priority | Acceptance invariant |
| --- | --- | --- | --- |
| S1 | A merchant, facilitator or network selection is impersonated or confused with a different source. | High | Dispatch and reconciliation remain bound to the selected authority, origin, network, asset and recipient. A changed selection requires its actual review. |
| T1 | A corrected or withdrawn offer remains discoverable, or approved terms/source bytes change before dispatch. | High | The active public projection matches the accepted canonical generation; the dispatch uses the exact reviewed request and payment option. |
| T2 | Transfer or output evidence is attached to another intent, child request, buyer or resource. | High | Each observation retains its native parent/child identity and source; unresolved attribution remains a finding. |
| R1 | A lost reply is treated as failed payment, or a settled intent is dispatched again during recovery. | High | Reconciliation reads the original intent and transaction evidence. Uncertainty never authorizes an additional payment. |
| E1 | A caller exceeds approved spending, signing or delegated authority. | High | Applicable limits and current authority are checked at the original dispatch boundary; rejection preserves the reviewed request and financial state. |
| I1 | A token, key, private body or backup is exposed through access, logs, metrics or receiving. | High | Private material is scoped to its authorized recipient; telemetry carries bounded classifications and protected record references. |
| E2 | A browser request or another workspace gains operator control. | High | The selected application’s session/origin/CSRF and workspace bindings remain effective across Start, refresh, Stop and reopen. |
| D1 | Resource exhaustion, abandoned requests or provider failure leaves paid work incomplete. | High | Admission is bounded, incomplete output remains visible, and cancellation/recovery affects only the original owned work. |
| D2 | Observation or notification stops while the operator believes the service is covered. | High | Coverage, freshness, failed notification attempts and missing acknowledgments are explicit states. |
| T3 | A restore or handover uses the wrong source/state generation or overwrites intervening work. | High | Receiving verifies the selected identities and reconciles subsequent operations before resuming unfinished work. |

Two existing source findings make the baseline concrete. The discovery integrity audit repaired a stale public alias that survived an authorized offer correction and withdrawal; it did not establish a payment exploit or a third-party audit. The existing operations wrapper separates incomplete responses from completed HTTP metrics and retains admission capacity until abandoned backend work settles. These are source-level controls and review evidence, not deployed monitoring results. [5][6]

## Monitor and response register

Every monitor below starts **PLANNED**. T2 records its actual collector, source version, scope, threshold, observation interval, incident destination, primary/backup responder and last review in the private annex. An installed monitor may move through **TUNING** to **ACTIVE** only after useful observations and its notification/acknowledgment route are recorded. Disabled or unavailable coverage stays visible.

| Monitor / threats | Observable evidence and trigger | Permitted response and closure evidence |
| --- | --- | --- |
| M1 — S1, T1 | Compare the accepted canonical resource/generation and reviewed request with the current public projection and selected native dispatch. One contradictory identity, unauthorized projection or stale withdrawn offer creates an incident. | Stop affected new dispatch; retain the original offer, approval and discrepancy; use the original correction/withdrawal path. Close after the intended projection and authority read back consistently. |
| M2 — T2, R1 | Join the original native payment intent, any parent/child work, network transaction evidence and delivery state. Flag conflicting attribution, an unexpected additional dispatch for a settled intent, or uncertainty older than the installation’s reviewed reconciliation window. | Preserve the uncertain state and investigate the same native operation. Recover a confirmed settled entitlement or unfinished delivery. Close with independently observed financial outcome and correctly attributed output; retain unresolved cases. |
| M3 — E1, S1 | Observe denied authority/limit decisions and compare actual dispatches against the approved policy and selected recipient/network. A confirmed dispatch outside that approval is an immediate incident. | Suspend the affected signing/dispatch authority through its existing operator path; retain approval and native evidence. Restore authority only through an authorized configuration change and readback. |
| M4 — I1, E2 | Observe access/session/workspace decision classes, credential changes and output/backup recipients. A confirmed unauthorized access, secret exposure or workspace mismatch triggers an incident; repeated rejected attempts use an installation-specific rate threshold. | Restrict the affected access path, preserve a sanitized incident and original protected evidence, rotate or revoke only authorized credentials, and verify the intended recipient/authority before reopening. |
| M5 — D1 | Observe admission, active backend lifetime, cancellations, partial outputs and settled-to-useful-output age. Alert on a configured capacity or delivery-age threshold. Count an incomplete response separately even if headers carried HTTP 200. | Stop or reduce affected new admission using the existing operator controls. Retain partial work and settled entitlements, resolve the concrete resource/provider condition and continue unfinished work under the original identity. |
| M6 — D2 | Track the last useful observation for every selected dependency and the expected collection interval. Missing or stale collection beyond its reviewed tolerance is a coverage incident; it is not a healthy result. | Identify the blind component and responder, preserve the last useful capture and restore observation. Close with fresh evidence for the same scope and a recorded blind interval. |
| M7 — D2 | Track the original incident’s notification attempt, provider outcome, delivery information where available, acknowledgment and escalation deadline. Unknown delivery or an overdue acknowledgment remains open. | Continue that same incident through the configured notifier’s supported recovery. Escalate to the named backup when due. Retain the original attempts, actual acknowledgment and response time. |
| M8 — T3, T2, R1 | Verify saved source/state/output identities on restore and receiving; compare later operations and the selected native financial history. Any mismatch, missing required original or unexplained later operation creates a finding before continuation. | Preserve both selected and current evidence. Resolve the exact ownership/generation discrepancy, reopen the same case and resume only unfinished work. Close with the receiving engineer’s readback and retained financial/output identities. |

A merchant or facilitator may expose only customer-facing evidence. This plan does not assume administrative access to a third-party service. The annex names the supported source for each observation and reports unavailable scope.

Integrity triggers above use one confirmed contradiction. Age, rate, capacity and latency triggers use explicit values selected for the installation’s actual workload and provider contract. The operator records their basis and revisions; this document invents no production baseline, response-time promise or uptime SLA. A threshold change retains its previous value and reason.

## Health, privacy and evidence semantics

Process, application, dependency, payment and delivery health are reported separately. The existing discovery wrapper’s process/readiness endpoints explicitly leave ledger/RPC/settlement unchecked. Its rolling latency measures completed responses from that process, not network settlement, complete datasets or historical service availability. Actual payment/dependency monitoring therefore needs its own selected evidence source. [6]

Aggregate labels remain bounded, such as component, monitor ID, decision class and outcome. Wallet addresses, raw URLs, query bodies, payment payloads, customer identities, tokens and case-specific identifiers do not become metric labels. Detailed correlations belong in protected case records. A failed observation must not emit its raw exception or secret-bearing request into the public grant report.

Each incident retains the installation and source edition, threat/monitor IDs, original operation references, first/last observation, confirmed or uncertain condition, notification history, responder acknowledgment, authorized action and result. Financial and delivery clocks remain separate. Repeated observations update the same incident; they do not create purchases, settlements or customer-adoption counts. Any retention period, access grant or evidence export is selected with the actual customer.

## Two complete operator journeys

**Interrupted settled purchase.** Use the original customer-approved intent and its independently observed native settlement. Preserve the interruption and incomplete output. The configured monitor raises the retained incident, the responsible operator acknowledges it, and the original entitlement/session recovers unfinished delivery. The receiving engineer reopens the same case and useful output after drain/restart. The report identifies the original intent, transaction and output, any additional authorization actually required, and whether any new financial dispatch occurred. Reopening an already acquired file is recorded as recovery of the original purchase.

**Merchant-delivery failure.** Observe a real selected delivery failure through the existing provider/application path. Retain the original financial status, source and partial result; no fixture success stands in for the customer outcome. The operator acknowledges the incident, resolves the actual supported delivery condition and continues or records the unresolved fulfillment obligation. The receiving engineer reopens that same state and verifies useful output when complete. A canceled, refunded or unresolved result stays in the report with its actual evidence.

The two journeys are part of the funded installation work. They reuse the current source and original customer operations; no blanket suite, synthetic purchase replay or additional paid acquisition is prescribed here. An unsafe disruption to a customer service is not required to demonstrate recovery. Where a necessary failure cannot be exercised safely, the record distinguishes source review, a controlled authorized exercise and an actual customer outcome.

## Work allocation and acceptance

The 50-hour package is planned as 8 hours for the installation threat/authority map and baseline, 16 for observations and incident/notification integration, 12 for prioritized material remediation, 10 for the two operator and receiving journeys, and 4 for residual-risk review and handover. These are prospective estimates within the existing package, not measured historical effort or additional funding.

Acceptance by day 90 requires:

1. The actual installation inventory and source edition, all ten threat decisions, and a monitor or explicitly retained coverage limitation for every threat.
2. Reviewed numerical values for every applicable age/rate/capacity threshold, exact collection sources, named primary/backup responders and configured notification/acknowledgment destinations.
3. Recorded useful observations and honest **ACTIVE**, **TUNING**, **PLANNED**, unavailable or disabled status for each applicable monitor; material missing coverage is an unmet item.
4. Both original operator journeys with actual financial/output states, acknowledgment and recovery timings, plus the receiving engineer’s same-case reopen.
5. Remediation and residual findings linked to the affected source and operation, including incomplete or uncertain outcomes. A sanitized report joins the existing cohort/implementation-evidence desk and original tranche preparation.

Publishing this baseline closes none of those deployment acceptance items by itself. Bryce Muhlnickel remains accountable for the application. Each customer names its operational primary and backup and the receiving engineer during intake. Those names and permissions are required before the corresponding response route is treated as operated.

## Sources and application integration

[1] [Current SCF application Canvas](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C86PRE5NF), reviewed 2026-10-12: original scope, budget, targets, submission state and sections 6–7. [Published front manuscript](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/d17809909ab2ca0eb3e5e66a0d3a221b7ac1078d/stellar-forge/developer-site/dist/grant-data/application.md). The current Canvas and submission owner govern subsequent editorial changes.

[2] [SCF Build submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria), read 2026-10-12.

[3] [SCF budget and deliverable guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines), read 2026-10-12.

[4] [Stellar threat-modeling guidance](https://developers.stellar.org/docs/build/security-docs/threat-modeling) and [builder monitoring-plan template](https://developers.stellar.org/docs/build/security-docs/monitoring/monitoring-template-builders), read 2026-10-12. The threat and monitor decisions above are specific to this application.

[5] [Original discovery integrity audit](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/f3498040d57ebc61e80084cc43e0c2a1f89aae3a/stellar/scf-starforge-20261009/sf39-security-audit/README.md), verified full Git blob `264c160ed55d3e46ad207a5e85139d2d641a22b1`.

[6] [Original operations telemetry](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/f3498040d57ebc61e80084cc43e0c2a1f89aae3a/stellar/scf-starforge-20261009/sf40-ops-telemetry/README.md), verified full Git blob `21656ee3dd042d32cd0bac12a93ae106d60ddad8`.

The front manuscript should retain a self-contained description of the scope, budget, response cases and acceptance criteria. This companion supplies implementation detail and does not change the original application identity, submission owner, company workshares or section 9.
