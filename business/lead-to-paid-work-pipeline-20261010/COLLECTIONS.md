# Record installments, refunds and the next collection action

The existing commercial pipeline now reconciles operator-recorded receipts across **all opportunities in one input** before displaying cash. It writes `collections.json` and `collection-queue.csv` beside the existing four outputs. The HTML and Markdown boards show invoice balances and review items. No provider is called, invoice sent, customer contacted, or money moved.

Run the explicitly synthetic example:

```bash
node business/lead-to-paid-work-pipeline-20261010/pipeline.mjs \
  business/lead-to-paid-work-pipeline-20261010/collections.example.json \
  /tmp/synthetic-collections --now=2026-10-11T12:00:00Z
```

It records an illustrative USD 1,000 invoice, USD 400 deposit and USD 50 refund, leaving USD 650 outstanding. **Those are fictitious demonstration amounts, not a customer, invoice or cash received by TJLabs.** The original source, eligibility, price and contact gates still hold.

## Input contract

Keep the original opportunity and ordered workflow events through a receipt-backed `SOW_SIGNED`. Add `receivables[]` to that same opportunity. This explicit collection representation replaces legacy cash events for that opportunity; it never adds the two representations together.

Each invoice needs:

| Field | Meaning |
| --- | --- |
| `invoiceId` | Exact nonblank identifier, unique within this opportunity/revision |
| `currency` | Three uppercase letters from the actual invoice; no FX conversion |
| `amountMinor` | Positive safe integer in that currency's minor units, e.g. USD cents |
| `issuedAt` | Offset-bearing ISO timestamp, after the accepted SOW and no later than assessment time |
| `dueAt` | Optional offset-bearing ISO timestamp at or after issue time; omission leaves aging unknown |
| `receiptUrl` | HTTPS pointer to the actual issued invoice, supplied by the operator |
| `receipts` | Array of payments and refunds; an empty array means unpaid |

Every receipt needs `kind` (`PAYMENT` or `REFUND`), `provider`, `accountId`, `transactionId`, `currency`, `amountMinor`, `timestamp` and `receiptUrl`. The amount is always positive; `REFUND` supplies the sign and additionally requires `parentTransactionId`. Use the provider's actual account and transaction identifiers. Do not use an email send ID as a payment identifier.

Refunds must reference an accepted payment on this exact invoice, provider and account; their currency must match, time must be no earlier than the parent payment, and cumulative refunds cannot exceed the parent amount. The supported reversal is a confirmed refund of received cash; credits, chargebacks, processor fees, write-offs, invoice cancellation and exchange rates are not modeled. Record a provider refund only when it actually happened. The outstanding balance after a refund is a reconciliation amount for owner review, not an assertion that a customer legally owes that amount.

The engine rejects fractional/unsafe amounts and invalid or future receipt times. It adds integer minor units, rejects unsafe aggregate totals, keeps each currency separate, and converts USD minor units to the compatibility dollar field only after aggregation.

## Duplicate and conflict behavior

The global transaction identity is `[lowercase provider, exact accountId, exact transactionId]`. Account and transaction IDs retain case. An identical replay on the same invoice counts once. Any changed amount, kind, currency, parent, timestamp or allocation to a different invoice/opportunity quarantines every conflicting candidate. A different receipt URL alone does not create a different payment. No input-order winner is chosen.

Use one batch containing every related opportunity. Separate runs cannot detect each other's receipts. Offline reconciliation is not a distributed sender lock or a live bank verification. Importers must use consistent provider/account identifiers; an unscoped legacy transaction cannot be matched reliably against a scoped modern receipt. No such match is inferred.

Invalid invoices and receipts appear in `collections.json.issues`, with the original opportunity key, invoice/transaction reference and reason. Valid nonconflicting receipts remain separately totaled; a review flag does not hide them. Inspect the issues before relying on a balance. `collection-queue.csv` includes unpaid, partial, reopened, overpaid, unknown-total and review invoices. Completely invalid invoices have no computable row and are listed in the issue report instead. CSV cells are quoted and formula-leading cells are neutralized for spreadsheet use.

## Compatibility and APIs

`evaluate(op, now)` keeps the original single `PAYMENT_CONFIRMED` flow. Its `cashReconciliation` explicitly says `SINGLE_OPPORTUNITY_ONLY_NOT_DUPLICATE_CLEARED`; never sum individual calls. Payment amounts must be exact positive USD cents, timestamps cannot be in the future, and the original ordered stages still apply.

Use `evaluateAll(opportunities, now)` for decisions plus globally reconciled collections. The CLI uses this entry point. For legacy input, an accepted invoice event becomes an **unknown-total** USD invoice; a valid legacy payment stays recorded, but the tool does not invent invoice value, due date or full settlement. Repeated legacy transaction IDs across opportunities are quarantined conservatively. `provenPaidUsd` remains only as a deprecated compatibility alias of `recordedNetUsd`; it is not proof of provider settlement.

`stage` remains the commercial workflow stage. For explicit receivables, use each invoice's collection `state`, `outstandingMinor` and `overdue` fields to assess payment progress; a workflow label is not a paid-in-full claim. Public source examples contain only synthetic identifiers. Keep actual contract, invoice and payment data in private local inputs/outputs and existing approved private systems.

## Focused verification

```bash
node --test business/lead-to-paid-work-pipeline-20261010/collections.test.mjs
```

The scenarios exercise installment settlement, partial refund reopening, a receipt allocated to two deals, replay versus conflicting versions, refund bounds and currency/invoice mismatches, currency separation, future/invalid timestamps, legacy behavior, safe amounts and retained owner gates. The tests call only local modules and Node built-ins.
