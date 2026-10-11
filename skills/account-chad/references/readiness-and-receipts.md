# Readiness and receipts

Use separate facts for access, payment, eligibility and delivery. A global green check can conceal an unpaid or unusable route.

## Payment readiness

Record the minimum facts relevant to the task:

| Dimension | What establishes it |
|---|---|
| Identity/access | Correct provider account and intended claimant/payee; actual authorized access |
| Receiving destination | Provider-configured bank, PayPal, Stripe, or wallet reference with masked/nonsecret identity |
| Asset/network | Exact currency and, for crypto, chain/network and token; compatible receiving destination |
| Provider requirements | Required verification, tax/KYC, country and eligibility state, with actual unresolved fields |
| Withdrawal | Any required activation, threshold, fee or post-award process and current completion state |
| Task eligibility | Exact payer/task terms and amount; assignment when required |
| Source | Actual provider URL/ID, observation time and receipt; bounded coverage stated accurately |

Use `PAYMENT_GREEN` only when the relevant receiving and payout requirements are actually satisfied. Mark unknown or incomplete dimensions `HOLD`/`UNVERIFIED` and name the missing fact. An account may be access-ready or submission-ready while payment linkage is pending; report that distinction explicitly.

Where the official competition process collects a prize wallet only after selection, record `PRIZE_DETAILS_COLLECTED_AFTER_AWARD` with the official source. Do not invent a prelinked wallet or hold an otherwise authorized submission merely because the form has no wallet field. Do not promise award or payment.

Keep raw bank/card details and private keys in secure custody. Readiness records use secure references and masked destinations. A public receiving address may be recorded when relevant and authorized, together with the exact network; never infer its ownership or suitability from a display name. A test-only deployer wallet remains test-only.

For bounty payer qualification, use the current exact-scope registry: at least one actual contributor payout for accepted work merged upstream, recent activity verified within 30 days, and current amount/terms/payment rail. An unresolved overdue accepted bounty supersedes historical paid proof. Funding or platform reputation alone is insufficient. Require an actual assignment to the original claimant where terms require it; self-requested assignment is not acknowledged assignment by inference.

## Money state

Distinguish advertised, promised, escrow-funded, earned, payout initiated, paid to claimant and actually received. On BountyHub, `paymentStatus=PAID` describes funds paid into escrow; `isPaid=true` on a claim is the claimant payout signal. Never call a free OSS merge an unpaid bounty without an actual owed payment.

Budget and usage accounting also needs exact scope. A provider balance, maximum reservation, token-based estimate and actual billed charge are different facts. Preserve unknown-effect reservations until the relevant terminal usage, charge or no-effect evidence resolves them. Do not replay a request merely to learn its cost.

## Operation record

Keep a concise private JSON or Markdown record containing:

- Stable `operation_id`, provider and intended operation.
- Correct account/secure reference; no secret value.
- Original entry, claim, message or upload ID and URL.
- Input artifact/version/hash when applicable.
- Deadline, quota/capacity facts and observation time where relevant.
- Last issued action, provider result and whether the effect is known.
- Receipt/screenshot location, next action and any once-pending human handoff.

Useful operation states include `PREPARED`, `ISSUED`, `UNKNOWN_EFFECT`, `DRAFT_SAVED`, `UPLOADED`, `PUBLISHED`, `SUBMITTED`, `ACCEPTED`, `PAID_TO_CLAIMANT`, `RECEIVED` and `STOPPED`. Use the provider's real wording alongside the normalized state. A queue receipt is not a send receipt; an uploaded video is not a published video; a saved form is not a submitted entry.

On a timeout, inspect the original operation and provider record before retrying. Preserve the same stable ID across carriers and roles. Reconcile actual outcome instead of clearing a journal, creating a replacement entry or assuming failure from missing local output.
