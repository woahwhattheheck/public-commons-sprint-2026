# SF-47 — SCF Build award-tranche and pre-financing model

**Work order:** `SCF-STARFORGE-20261009/SF-47` · **Status:** working-source draft, **NOT SUBMITTED**.  
**Implementation:** offline Python 3 standard library only — [budget.py](./budget.py), [example_scenario.json](./example_scenario.json)  
**No** API calls, accounts, forms, wallets, hosted CI/workflows, data exfiltration, email, SLAs, vendor invoices, grant/award commitments or fund movement.

## Primary rule references — retrieved October 9, 2026

1. [SCF Build Budget & Deliverable Guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines) — maximum **$150,000 USD-worth XLM**; budget for **future milestone work only**, not prior work/general operations; proposed project **up to six months**; three actual deliverable milestones (#1 MVP, #2 Testnet or equivalent, #3 Mainnet or equivalent) and **four conditional payouts 10% / 20% / 30% / 40%**. #0 payable only after award acceptance, later payments after milestone review.
2. [SCF Build Award](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award) — **interest → eligibility screening → invitation → full submission**, deliverable-based, documentation of applicant experience/costs, KYC/KYB for selected awardees, eligible human participants, and award value converted with the **payout-day XLM/USD benchmark**, not a static forecast. Current #46 specific x402 RFP eligibility remains in dispute because [RFP listing](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track) is still headed **July 23, 2026, Q3/#45**.
3. **Exclusions in the actual guidelines:** standard award budget may **not** reimburse past development, general operations, audits (Audit Bank separately), marketing/user acquisition, legal/entity incorporation, general bounties, token giveaways or prize pools. There is a narrow Integration Track exception for validation-focused user testing in later tranches, **not** broad acquisition, and current greenfield SF product does not meet existing-product Integration entry just by changing the label. The offline model uses a conservative category allowlist, no automatic Integration exception.
4. **Deadlines:** milestone completion form must be submitted **within 90 calendar days of preceding payment**, or funds may be forfeited absent timely SDF-confirmed communications; review/payment lag is *not contractually fixed*. For Integration final 40%, a panel-ratified actual onchain outcome metric is required (not mainnet release alone). Rights and restrictions depend on jurisdiction and applicant, not inferred.

## What the model solves

Teams routinely propose an award equal to total development cost and wrongly assume that money is all available up front. Here, only 10% is hypothetically available at acceptance. A project that expends money continuously against milestones can have a **severe interim cash gap** before the 20%, 30%, 40% reimbursements, especially during review lag. A grant is never an authorization to spend. The model estimates a **conditional peak prefunding need** under explicit planning assumptions so the operator can decide whether a tranche structure is genuinely financeable before putting any dollars in a request.

## Offline usage

```bash
python3 stellar/scf_2026/sf47_budget_model/budget.py \
  stellar/scf_2026/sf47_budget_model/example_scenario.json \
  --out /tmp/scf-sf47-illustration.json
```

Or omit `--out` to print JSON to stdout. Nothing is submitted. Only local JSON is read/written. Edit amounts, deliverables, day offsets, assumed approval/payment lags and optional illustrative XLM/USD **scenario** rates after real human quote/role data is available. Costs must remain auditable future deliverable-specific work rather than historical swarm compute or marketing spend.

## Hypothetical example (NOT requested, approved or real)

**Inputs:** `example_scenario.json` models a **USD $90,000** build, 180 modeled days, unspecified/unverified human engineering rates, evenly spread **$30,000** cost per 60-day phase. Milestone completion days **60**, **120**, **180**, with hypothetical 14-day review/payment lag each. Entire future estimate **invented solely to exercise the model and must be replaced by actual rates/hours** before any application. No award is anticipated or granted.

| Conditional tranche | When paid in this illustration | % | Hypothetical USD |
| --- | --- | ---: | ---: |
| #0 award acceptance | Day 0 | 10% | $9,000 |
| #1 MVP acceptance | Day 74 (submit day 60 + assumed review 14) | 20% | $18,000 |
| #2 testnet acceptance | Day 134 (submit day 120 + 14) | 30% | $27,000 |
| #3 mainnet/equivalent acceptance | Day 194 (submit day 180 + 14) | 40% | $36,000 |

At **day 133** under the **assumed even daily cost accrual**, $67,000 of future work is counted as consumed but only $27,000 of conditional payments have arrived. **Peak prefunding gap: $40,000 at day 133.** At day 180 the full $90,000 model cost is committed while $54,000 of conditional payments have arrived; gap $36,000 until final modeled release. This is a mathematical example, **not a quoted financing amount** or received cash. If the award is declined or a tranche rejected, actual grant receipts are $0 or the last accepted portion, and the responsible owner must replan work and liquidity, not presume automatic approval. The model rejects costs exceeding the requested award, unapproved categories, nonfuture costs, incoherent milestones or missed 90-day windows.

**XLM volatility:** illustrative scenario rates 0.10 / 0.30 / 0.60 USD/XLM are *NOT current quotes or predictions*. The model shows only arithmetic units that would result if a selected hypothetical rate were used for a tranche. Actual payment-date USD valuation is defined by official SCF rules and cannot be determined in advance from this spreadsheet-style simulation. No trading, conversion or price forecasting is performed.

## Implementation / modeling boundaries

- Source code uses Python `Decimal` for monetary values; all grant amounts are USD scenario values before payout conversion.
- Exactly 3 ordered milestone submissions and 4 payout shares. Period completion dates are constrained to conservative **180 modeled days**; this is NOT a legal interpretation of every six-calendar-month schedule.
- One proposed project budget, positive line-items, categories `core-development`, `frontend-ux`, `verification`, `release`; all costs explicitly future-only. If a tranche cost ends after its claimed completion day, reject it rather than silently count it as deliverable proof.
- Proposed milestones cannot be submitted more than 90 modeled days after the immediately preceding **payment**; no arbitrary claim that payment review always takes 14 days.
- Each amount is **spread evenly across its inclusive modeled start/end days**. This is only a scenario cash-accrual assumption, not actual time sheets or supplier invoice dates; a real payment schedule from SF-08/human quotes should replace it.
- Output includes each milestone, every conditional payout date, selected-day cumulative hypothetical outflow/inflow, worst cash gap day/amount, XLM hypothetical sensitivity, requirements and critical unknowns. It does **not** file SCF completion forms or schedule actions.
- This lane does not duplicate SF-08's **real unit-economics** or SF-09's grant-track decision, and cannot fill in unspecified human applicant facts from software fleet size. Engineering owners supply actual source heads and future acceptance receipts; a demo or implementation PR is **not** itself SCF tranche acceptance.

## Milestone evidence and independent review gates

| Future tranche | Milestone example, to refine against actual current product | Evidence required before claiming complete |
| --- | --- | --- |
| #1 — MVP | opt-in HTTP/MCP resource ingestion, discover/search, normalizing canonical x402 price/method metadata, documented self-host | Real current source, version-tagged public release, actual original endpoints with operator rights, reproducible acceptance logs and failure-mode cases |
| #2 — Testnet | agent discovers a seller-priced service, owner-authorized wallet uses canonical Stellar x402, policy and receipts cover actual transaction | Real testnet ledger receipt with genuine signatures, source/version hash, independent same-corpus quality test and no unsupported network/scheme claims |
| #3 — Mainnet/equivalent | documented deployment/maintenance/monitoring and accessible public API, security and failure recovery, real consenting early user | Actually performed approved network deployment/equivalent, original live performance data, user/merchant validation, documented availability and operator costs; if jurisdictional exception, require SDF decision |

Architecture, original research and product decomposition **must be finished before an invitation/submission**, not priced retroactively as tranche #1. Only actual future deliverables count. Mainnet spending, legal applicant approval, vendor contract, SCF submission, external email and public grant claims all remain **OWNER HOLD**.

## Expansion / source handoff

**SF47-B1:** SF-08 reviewer to supply **actual future human rates/hours**, measured provider/storage/RPC costs, license constraints and note any costs that official guidelines exclude. Do not charge award for unspecified internal model tokens or previous work.  
**SF47-B2:** SF-03/04/46 source owners to replace placeholder milestones with exact current canonical acceptance contract and signed/testnet evidence prerequisites, not toy traces.  
**SF47-B3:** Human owner to decide allowable legal entity/team participants, seller consent, realistic credit/working-capital access, and whether an SCF form may ever be sent (currently NO).  
**SF47-B4:** Financial operations to reconcile committed expenses, actual invoices and successful funding receipts with a **separate ledger**; model output is not an accounting record.

**Status:** code, JSON exemplar and source-linked operator guide are deliverables. Actual staff budget, award, eligibility, user demand, XLM exchange values and transfer receipts remain unknown. No grant application or payment initiated.
