# SF47: source-preserving 60-day grant-review liquidity stress

**Planning variant for the ONE existing SCF SF10 $70,000 illustrative founder candidate. NOT a separate funding request, submitted grant, verified team, award, or payment.** The canonical editor/owner continues to control [SF10](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C82MLR4UV).

## Business decision

The original day **35/77/133** submission plan is coherent for modeled 14- or 30-day grant review. It is **not** coherent in the conservative SF47 model for 60-day reviews: tranche 1 submitted on day 35 would not be hypothetically paid until day 95, while tranche 2 would already be submitted on day 77. The accepted [SF47 cash model](../budget.py) rejects this case rather than implying out-of-sequence funding. This is a modeling guard; it does not invent an SCF prohibition on pre-review engineering.

The included [60-day alternative](./sf10_70000_60day_review_rephased.json) adjusts ONLY timing and documentation: **14 original cost identities, categories, dollar amounts, deliverable proofs, three milestone descriptions and $70,000 total are preserved**. This scenario assumes even future cost accrual over each adjusted phase; it does *not* verify 700 assumed engineering hours, the $95/h placeholder, legal applicant, quotes, or liquidity. It must never silently replace the original 19-week founder plan.

| Source-controlled field | Original canonical SF10 | This 60-day stress scenario |
| --- | ---: | ---: |
| Modeled project finish | Day 133 | **Day 180** (model's conservative maximum) |
| Milestone submissions | 35 / 77 / 133 | **35 / 100 / 180** |
| Phase ranges (inclusive) | 1–35 / 36–77 / 78–133 | **1–35 / 36–100 / 101–180** |
| Phase future costs | $18k / $23k / $29k | **Same $18k / $23k / $29k** |
| Hypothetical review lag | 14 days each | **60 days each** |
| Hypothetical payout days | 0 / 49 / 91 / 147 | **0 / 95 / 160 / 240** |
| Conditional payouts (10/20/30/40%) | $7k / $14k / $21k / $28k | **Same dollars, later** |
| Peak speculative prefunding gap | $28,000 (day 133) | **$41,387.50 (day 159)** |

**Critical consequence:** In the rephased plan, the conditional final 40% payment ($28k) lands at hypothetical day **240**, *60 days after engineering ends on day 180*. An award, timely review, stable payout-day XLM valuation, and human working capital are not guaranteed. Completion by the model's day 180 is not itself SCF approval of an actual six-calendar-month schedule; map to real dates upon invitation.

## Original-source arithmetic and reproducibility

The private cloud Linux seat performed a **Decimal** daily-accrual replay of current public SF47 semantics with all **14 actual original source cost IDs and dollar amounts**. Checked against the accepted source scenarios before evaluating alternatives:

- Original 14-day review: **$28,000.00** peak on day 133, matching accepted source owner output.
- Original 30-day review: **$35,017.86** peak on day 106, matching accepted source owner output.
- Original 60-day review with unchanged days35/77/133: **rejected for prior-payment chronology**, matching source validation.
- Swept **136** viable source-model schedules holding day35 MVP, minimum originally budgeted 42-day testnet and 56-day mainnet windows, at least 5 days between a previous assumed tranche payment and the next submission, and day180 maximum. Lowest **modeled** peak within *these specific constraints*, not a globally guaranteed optimal financing plan, was days **35/100/180**.

At the peak (day159), phase3 has accrued 59 of its 80 modeled inclusive days, so future accumulated cost is exactly `18000 + 23000 + 29000*(59/80) = 62387.50`. Conditional disbursements by then total `7000 + 14000 = 21000`, leaving **$41,387.50** temporary prefunding. Day160 hypothetically credits the next $21k tranche at the *beginning* of that day, reducing the gap to **$20,750** after that day's spend. At day180, $70k future cost is assumed accrued but only $42k grants hypothetically paid, leaving a $28k gap until hypothetical day240.

Source pins when the planning branch was created: existing canonical JSON Git blob `62033319b12b6aa62b107c529c43739cdf4c3df4`; accepted SF47 `budget.py` Git blob `62863e0b39b1c8946ea218421630aa328961ae92`. Cloud Linux executed the original-source-equivalent Decimal daily flow and 136-case search with exact source amounts, **not** the actual byte-for-byte GitHub `budget.py` CLI (this seat's cloud container could not fetch raw GitHub over DNS). The committed variant uses the real original JSON with only scenario label, timing and operator warning additions. No live ledger/payment, grant application, CI or full repository test occurred.

For the original source owner's native CLI acceptance, run in a working clone (no hosted Actions):

```bash
python3 stellar/scf_2026/sf47_budget_model/budget.py \\
  stellar/scf_2026/sf47_budget_model/alternatives/sf10_70000_60day_review_rephased.json
```

That run uses the unchanged [actual model](../budget.py) and reports `peak_prefunding_gap_usd`, `peak_gap_day`, four conditional payout days and milestone validation. Do not treat a simulation as an actual SCF payment promise.

## Founder and cash conversion

This does **not** solve the applicant/eligible human team, verifiable labor rates, account setup, vendor quotes, SCF #46 intake, award qualification or ability to float **$41.4k**. Those are real founder decisions. Keep **one** application amount, source it from actual future personnel/vendor costs, confirm real six-calendar-month milestone dates, and select affordable sequencing before sending interest/invitation fields. If 60-day lag is not financeable, seek a different prefinance plan or do not commit spend; do not multiply scenarios into separate grant asks.

Official guideline: [SCF Build budget and deliverable guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines). Internal owner: [SF10 canonical founder assembly](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C82MLR4UV).
