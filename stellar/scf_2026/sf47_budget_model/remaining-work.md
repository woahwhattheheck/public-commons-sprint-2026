# Original SF10 cost rows reconciled with shipped source

Source review: original 14-row `sf10_70000_candidate.json`, public source through `ab76ec64d5c8b11d92f3b2dce0232a5ac903b378`, plus the original SF36 finalizer in this change. The current priced plan is `sf10_current_candidate.json`. This table does not reclassify past programming as new delivery.

| Historical cost row | Original USD | Disposition and remaining delivery |
| --- | ---: | --- |
| `T1-integrated-catalog-85h` | $8,075 | Existing seller/catalog/OpenAPI/buyer integration is delivered. Price merchant-specific installation and missing deployment integration only. |
| `T1-seller-optin-55h` | $5,225 | Admission/withdrawal and private recovery already exist. Price actual merchant role/authority handover and onboarding repairs. |
| `T1-quote-audit-40h` | $3,800 | Remove standalone audit line. Quote parity and rejection belong inside the actual merchant installation outcome. |
| `T1-new-staging-capacity` | $900 | Remove unquoted $900 reserve. Use existing capacity; price actual incremental deployment units if needed. |
| `T2-canonical-ledger-100h` | $9,500 | Original ledger, native buyer/signer and privileged finalizer are pre-award source. Price deployment/connection to actual providers and merchant systems only. |
| `T2-provider-interop-55h` | $5,225 | Existing comparator is delivered. Price actual participating-provider API/cursor/auth/version integration. |
| `T2-threat-monitor-55h` | $5,225 | Existing controls/metrics are delivered. Price deployed alert delivery, custody, operator response and the required threat-model implementation. |
| `T2-failure-recovery-20h` | $1,900 | Remove duplicate generic failure line. Include actual settlement/merchant-notice exception recovery in deployed integration. |
| `T2-new-rpc-metrics` | $1,150 | Remove unquoted $1,150 reserve. Add real attributable provider/retention units only if the deployment requires them. |
| `T3-mainnet-release-105h` | $9,975 | Native SDK/terms/account-readiness source is delivered. Price actual protected mainnet merchant deployment and controlled rollout. |
| `T3-portable-ops-70h` | $6,650 | Remove generic new backup/CLI build. Integrate existing encrypted recovery and outbox continuity into real supervision, retention and cutover. |
| `T3-prod-monitor-docs-75h` | $7,125 | Operator consoles, economics, receiver and adapters are delivered. Price concrete production onboarding/support handover and actual incident operation. |
| `T3-security-release-40h` | $3,800 | Remove generic testing reserve. Remediate actual material deployment findings within the production release package. |
| `T3-new-mainnet-hosting` | $1,450 | Remove unquoted $1,450 reserve. Price a named real incremental service only when workload requires it. |

## Delivered source used as the baseline

- Original seller and actual resource adapters: `sf30-seller-sdk/`, `sf61-openapi-seller-import/`, `sf82-seller-pilot/`, `sf102-cube-paid-query-adapter/`, `sf104-woocommerce-merchant-bridge/`.
- Original catalog identity and recovery: `sf60-durable-catalog-transaction/`, `sf73-pinned-seller-admission/`, `sf95-signed-seller-withdrawal/`, `sf63-catalog-backup/`, `sf102-seller-recovery/`.
- Original buyer and accounting: `sf31-buyer-client/`, `sf36-spend-governor/`, `sf62-human-approval-cli/`, `sf81-buyer-operator-bridge/`, `sf82-chain-transfer-reconcile/`, `sf82-checkout-evidence/`, `sf86-rpc-transfer-reconcile/`, `sf88-operator-buyer-cli/`, `sf103-native-buyer-signer/`.
- Original merchant operation: `sf30-seller-sdk/operations/`, `sf93-seller-support-bundle/`, `sf96-seller-pilot-ops/`, `sf97-merchant-revenue-ops/`, `sf98-merchant-delivery/`, `sf101-merchant-receiver/`, `sf101-merchant-recovery/`, `sf101-merchant-outbox-continuity/`.

All paths above are under `stellar/scf-starforge-20261009/`. Implementation presence does not establish a customer deployment or sale. New work packages require actual independent merchant outcomes, not another test/report wrapper around these modules. Programming completed before an award remains excluded, including later additions to this baseline.

## Proposed deployment outcomes for the same six cost packages

The additive `deployment_acceptance_plan` in [the current scenario](sf10_current_candidate.json) closes the original plan's cohort, observation-window and acceptance-record definitions. It is an authored proposal for application review, not an accepted merchant scope, an SCF acceptance rule or achieved adoption. The original 14-row reconciliation above remains historical source. The current six cost rows, 400 prospective hours, $95 assumed rate, $38,000 request, modeled milestone days 30/90/150 and cash-flow inputs are unchanged.

The additional source review uses public main `7d2589c6b789bfaa7fe5dd8ba2a94c1cda81e3cc`. Its already delivered seller, independent native buyer, receiving, dataset publication, original transaction finalization, merchant accounting, support case, maintained release and host operation remain the inputs to customer deployment. No second payment engine, accounting ledger or benchmark suite is priced.

### One measurable operating outcome per tranche

| Existing work packages | Proposed customer outcome and workload | Original operating records |
| --- | --- | --- |
| `T1-merchant-resource-integration` + `T1-merchant-authority-handover` — 120h, days 1–30 | Two independent merchant operators each install one agreed useful operation. Each changes or withdraws its own terms/source and completes a second-operator handover. Record actual active setup/support hours and elapsed calendar time, including unfinished work. | Original merchant case/workorder, selected release/configuration, complete payment terms, source/offer revisions and accountable handover. |
| `T2-provider-and-ledger-deployment` + `T2-deployed-threat-response` — 120h, days 31–90 | One merchant operation works through two independently operated facilitators and two independent buyer operators. Proposed workload: ten completed useful testnet purchases in seven consecutive calendar days finishing by modeled day 90. Carry an interrupted settled purchase and a merchant-delivery failure through deployed alert, acknowledgment and original-state recovery. Complete the required deployment threat assessment and remediation. | The same original intent/attempt/reservation, independent native transfer, original response/output, merchant event/delivery and support-case clocks. |
| `T3-mainnet-merchant-rollout` + `T3-production-recovery-and-handover` — 160h, days 91–150 | Two merchant installations on mainnet; two independent buyer operators; thirty completed useful purchases in fourteen consecutive calendar days finishing by day 150; both buyers return for a distinct purchase on another day. Complete controlled release/rollback, restore to an authorized receiving host, reconcile operations after the backup point, and have an independent operator resolve a support case. | Native mainnet purchase and delivery records, exact installed release, original backup/restore/cutover history and named maintainer case outcome. |

These observation windows fit the existing hypothetical award-relative timeline. Actual calendar dates and customer work are agreed in the original workorder. They do not alter the issuer's original tranche submission or payment terms. Ten and thirty are reviewable workload/adoption targets, not statistically justified reliability thresholds. Workload comes from useful customer operations and actual merchant prices, not transactions generated only to reach a count. Retain achieved results, including zero and incomplete outcomes.

An independent merchant, buyer or facilitator has a distinct accountable external organization or person operating it. Multiple fleet agents, sessions, hosts, routes, wallets or self-hosted copies under one operator count once. Team-operated and team-funded rehearsals remain separately reported engineering use. Reopening an original result does not create another buyer or paid purchase.

### Source-native acceptance joins

| Question | Existing source and the required join |
| --- | --- |
| Who operated what? | [SF74 case desk](../../scf-starforge-20261009/sf74-merchant-support-console/CASE_DESK.md): original merchant/case, agreed workorder, accountable operator, selected release and useful output. A case status alone does not prove adoption or acceptance. |
| What did the buyer approve and attempt? | [SF36](../../scf-starforge-20261009/sf36-spend-governor/README.md) and [original customer accounting](../../scf-starforge-20261009/sf88-operator-buyer-cli/node/ACCOUNTING.md): original request/intent, method/resource, body presence/bytes/hash, complete terms digest, attempt/reservation, actual amount and receipt. Follow every `range.nextOffset`; an allocation ceiling or unattempted entry is not a charge. |
| What actually settled? | [Merchant settlement accounting](../../scf-starforge-20261009/merchant-settlement-accounting/README.md): selected network, asset, recipient and exact atomic amount joined to the original transaction and matching independent SF86 result. Preserve native/recovered source distinctions and time bases. Deduplicate transaction hashes within their network; preserve conflicts and unresolved source rows. |
| Was the product delivered? | Original saved response/file, complete stream or dataset/object and its digest/completion state, plus [the existing entitlement/transfer outcome](../../scf-starforge-20261009/sf101-merchant-receiver/RESUMABLE_TRANSFERS.md) where required. A 2xx callback is not order fulfillment. A paid page/part is one intent; complete parent-product delivery is a separate result. |
| Was the period observed and the fault resolved? | [SF97 original history](../../scf-starforge-20261009/sf97-merchant-revenue-ops/README.md) retains requested/effective UTC dates, session/day/route coverage, interruptions and truncation. The existing support case retains fault/alert/acknowledgment/recovery times and actual operator hours. Session envelopes and HTTP counters cannot establish continuous coverage, unique buyers or completed paid use. |

A completed purchase joins a distinct original approved intent to the actual settled amount and matching native transfer and the expected useful delivered output. Preserve order completion separately when it is part of the agreed product. Repeated transport attempts and saved-result recovery remain attached to that intent. An actual new intent/payment stays separately recorded.

Show approved intents, payment-attempted intents, completed paid intents, settled-but-partial or undelivered intents, unconfirmed or unresolved attempted payments, cancellations before payment, later cancellations/refunds, unsigned responses, completed parent products and fulfilled orders. Completion rate is completed paid intents divided by **all payment-attempted intents** in that same cohort/window. Keep unresolved and partial outcomes in the denominator. Also report attempted/approved, completed-parent-product/started-parent-product and fulfilled/ordered. A missing or zero denominator does not establish a rate.

Retain gross original payments and actual later refund/cancel adjustments rather than erasing the purchase. Use first-attempt time to select the purchase cohort; separately show transactions settling during the window and late recovery outcomes. Never backdate a separately timed recovery read. Report exact amounts by asset/network, actual fees separately, and commercial contracts, invoices, receivables and collected service cash in their own original records. Unknown identity or missing coverage remains visible.

### Two-provider feasibility and customer scope

The original seller's [native facilitator configuration](../../scf-starforge-20261009/sf30-seller-sdk/README.md#enable-the-native-x402-runtime) accepts an explicit canonical facilitator client. Current first-party sources describe the [OpenZeppelin-hosted Stellar x402 v2 service](https://developers.stellar.org/docs/build/agentic-payments/x402) and [Vellar's canonical service](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/README.md), README blob `67eb604cf26b349f93eff3f1cea1e95b02cebebd`. They are plausible independently operated exact-testnet candidates. OpenZeppelin requires its actual service key, with separate mainnet configuration. Vellar's newer provider source reports testnet and mainnet; the older Stellar overview still labels it testnet-only.

This supports the engineering plan, not a live interoperability result, access agreement or provider uptime commitment. Confirm each actual supported configuration and the same merchant-owned operation before scheduling the window. Different sellers in two existing catalogs do not establish that join. The existing Nansen and Veridex relationship records remain sent proposals with their original operators; neither is presumed to supply an accepted deployment or volume. If provider access or the selected merchant scope changes, retain the actual result and revise this same plan.

The issuer's [budget/deliverable guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines) and [Open Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/open-track) were read on October 11, 2026. They require future work tied to measurable outcomes and a mainnet/onchain-growth plan; the specific cohort, workload and windows above are this project's proposed delivery design.
