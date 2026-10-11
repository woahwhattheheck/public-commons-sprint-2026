# SF47: SCF Build remaining-work budget and cash-flow model

The current SF10 planning input is [sf10_current_candidate.json](sf10_current_candidate.json).
It prices six remaining delivery packages at **400 prospective engineering hours
× the retained assumed $95/hour = $38,000**, over 150 modeled days. The hours are
an engineering estimate; the rate comes from the earlier planning scenario and
is not an agreed staffing rate. It contains no unquoted infrastructure reserve.
The SCF interest form has been acknowledged; a full-application invitation and
award are separate steps. This file is an internal budget model, not a submitted
funding request or a funding receipt.

## Scope after the October 11 product shipments

The original $70,000 / 700-hour model treated a large amount of now-delivered
software as future work. [remaining-work.md](remaining-work.md) reconciles all
14 original rows with original product paths. Existing seller SDK, catalog,
admission, quote checks, buyer approvals, durable ledger, native signer, buyer
inbox, finalizer, merchant outbox/receiver, dataset adapters, monitoring and
recovery source are the starting point. Their programming is excluded. Work
shipped between this estimate and an actual award must be removed again.

The six priced packages are actual **remaining deployment and integration**:

| Tranche | Remaining work | Estimated hours | Modeled USD |
| --- | --- | ---: | ---: |
| 1 | Merchant-specific HTTP/MCP resource installation | 80 | $7,600 |
| 1 | Real merchant authority/role handover and onboarding repairs | 40 | $3,800 |
| 2 | Independently operated provider and existing ledger/receiver deployment | 70 | $6,650 |
| 2 | Deployment-specific threat response and actionable alert integration | 50 | $4,750 |
| 3 | Actual mainnet merchant rollout and protected runtime configuration | 90 | $8,550 |
| 3 | Production recovery integration, remediation and maintainer handover | 70 | $6,650 |
| **Total** | **120 / 120 / 160 hours by tranche** | **400** | **$38,000** |

Milestones submit on modeled days **30, 90 and 150**. T1 delivers an independently
operable merchant installation. T2 delivers integrated settlement and merchant
operation across actual providers, with the required threat/monitoring work.
T3 delivers a maintained mainnet merchant release with working recovery. The
complete per-package outcomes and cost spans are in the current JSON.

The first 30 days require 120 contributor hours (about 28 hours/week); each
subsequent 60-day phase requires 120 or 160 hours (about 14 or 19 hours/week).
These are capacity requirements, not invented commitments from named people.
Allocate actual contributors and rates against the packages as staffing is
agreed. Existing fleet/container capacity is used first. New infrastructure goes
into the request only when an actual deployment needs it and its units and
price are sourced. Hosted GitHub Actions spend is not included.

## Run the existing calculator

```sh
python3 stellar/scf_2026/sf47_budget_model/budget.py \
  stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json
```

The original Python standard-library model uses Decimal, exactly three ordered
milestones, the four 10% / 20% / 30% / 40% payout shares, positive future cost
rows, six-month planning limits, and completion within 90 modeled days of the
preceding payment. It rejects a submission earlier than the preceding modeled
payment. Costs accrue evenly over each row's inclusive date span. It performs
no external calls, submission, funding transaction or expense commitment.

The same current schedule was recomputed with **14, 30 and 60 days** of assumed
review/payment lag. All three satisfy the model's sequential-payment rules:

| Assumed lag | Payout days, including initial acceptance | Peak interim cash gap | Peak day |
| --- | --- | ---: | ---: |
| 14 days | 0 / 44 / 104 / 164 | $15,200.00 | 150 |
| 30 days | 0 / 60 / 120 / 180 | $18,746.67 | 119 |
| 60 days | 0 / 90 / 150 / 210 | $26,346.67 | 149 |

The hypothetical payouts are **$3,800 / $7,600 / $11,400 / $15,200**. A 150-day
work plan can therefore require financing beyond the work period: in the
60-day-lag scenario the last payment is modeled on day 210. Review lag is an
assumption, not an SDF commitment. Actual costs may be front-loaded, acceptance
may fail or take longer, and actual XLM conversion follows the program's
payout-date rules. Record a real source of working capital against this cash
need; the calculation does not establish that financing exists.

To reproduce a sensitivity, change only each milestone's
`review_and_payment_lag_days` in a local copy or call `budget.model()` with a
copy of the current data. Do not use historical model output as a current
spending balance. Actual invoices and receipts belong in the existing business
accounting workflow.

## Rules and planning inputs

Official sources were rechecked October 11, 2026:

- [Budget and deliverable guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines): maximum $150,000 worth of XLM; up to six months; prospective development only; three delivery tranches with four conditional payout shares. Excludes past work, general operations, independent audits, acquisition/marketing and legal/entity costs from the standard development award.
- [Submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria): self-contained application, meaningful Stellar integration, actual readiness, clear costs and outcomes, tranche-two threat assessment and monitoring, final mainnet outcome.
- [Open Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/open-track): explain the incremental value against existing ecosystem infrastructure and the concrete user/business need.

The current application state is carried from the scenario rather than a hard-
coded stale RFP or applicant assertion. Remaining inputs are accountable staffing,
actual rates, participating merchant scope, any incremental service quotes,
actual invitation/award terms and working-capital source. They can be completed
in parallel with product delivery; this model creates no blanket hold on work,
sales or authorized publication.

## Historical inputs

[sf10_70000_candidate.json](sf10_70000_candidate.json), its 60-day rephased
alternative, and [example_scenario.json](example_scenario.json) are retained as
historical calculator inputs. They are not the current SF10 budget and should
not be copied into the full application. The original scenario was never an
approved award or submitted monetary claim; this revision preserves source
history and replaces stale prospective scope in the working candidate.
