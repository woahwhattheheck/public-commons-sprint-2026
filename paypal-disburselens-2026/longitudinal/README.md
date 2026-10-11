# DisburseLens: source-native longitudinal payout operations

This is an additive commercial-operator workflow for the original PayPal AI Hackathon 2026 DisburseLens entrant. It preserves the original original-source Payouts v1 sandbox reader, reconciliation logic and locally trained multinomial Naive Bayes. It does not transfer, cancel, refund or authorize money. An actual contest submission and a paid merchant contract are separate.

## What the operator gets

A payout batch does not stay frozen. An authorized merchant can capture the same actual read-only sandbox batch on two occasions, then obtain a complete, source-bound lifecycle difference with:

- Success to non-success regressions, reversals and a failed-to-success transition for explicit attention.
- Exact payout-item identity, sender ID, recipient and amount drift detection without printing the raw recipient into exports.
- Stalled pending or unclaimed items based on two measured capture times and an operator-set interval.
- Existing deterministic duplication, unpaid-status and *advisory* learned payout-note signals from the original reconciler.
- Private offline static review.html, line-oriented review.csv, complete report.json and content-addressed manifest.json. The printable HTML is restrained, neutral industrial software, with no dependencies, web imports, tracking, secrets or JavaScript.

Both input snapshots independently pass the ORIGINAL src/reconcile.mjs complete-page, declared-amount, count and identity validation before any comparison. This compares two genuine snapshots in a read-only manner. Neither snapshot is a cryptographic provider signature or a claim of final bank settlement.

## Original read-only sandbox capture

Node 22+, original DisburseLens source at the same repository path, and a PayPal sandbox account with Payouts read scope are required. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your existing private operator environment.

    node paypal-disburselens-2026/longitudinal/cli.mjs capture --batch EXISTING_PAYOUT_BATCH_ID --out /private/path/batch-before.json

After the actual operator observation interval, capture the SAME original batch to a DIFFERENT new path.

    node paypal-disburselens-2026/longitudinal/cli.mjs capture --batch EXISTING_PAYOUT_BATCH_ID --out /private/path/batch-after.json

The capture path must not exist already. The existing src/paypal.mjs performs OAuth against api-m.sandbox.paypal.com only and paginates GET /v1/payments/payouts/{id}; it does not call the payout creation API. Each saved capture includes original raw provider items and therefore can contain recipients and notes: treat as confidential, encrypted at rest according to merchant policy, with private ownership and backups. This command creates the file with mode 0600 and never overwrites.

## Run the full lifecycle comparison

    node paypal-disburselens-2026/longitudinal/cli.mjs compare --before /private/path/batch-before.json --after /private/path/batch-after.json --out /private/path/lifecycle-20261011 --stale-hours 24

The output directory must NOT exist. It is created 0700; four report files are created 0600 and not overwritten. Compare runs offline, with NO PayPal network call. It refuses different batch IDs, mixed provider/fictional sources, nonchronological timestamps and invalid or incomplete source pages. Cases are keyed by original payout_item_id, not by unstable array position. If file writing fails, inspect or discard the incomplete new directory; a partial directory is never reported as a complete comparison.

## Original source fixture exercise (does NOT contact PayPal)

    node paypal-disburselens-2026/longitudinal/cli.mjs demo --out /tmp/disburselens-original-example
    node paypal-disburselens-2026/longitudinal/cli.mjs compare --before /tmp/disburselens-original-example/before.json --after /tmp/disburselens-original-example/after.json --out /tmp/disburselens-original-example/review --stale-hours 24

The example imports the existing actual repository fixtures/payout_batch.json and preserves its six original entries, only changing two status facts for an illustrative 48-hour before/after transition. All source entries are marked fictional example, not a provider result. The SAME original reconciliation, classifier and comparison are exercised as in authorized live sandbox mode.

## What a high-priority flag means

A high-priority status is a proposed *human merchant work item*. It is not proof of fraud, improper payment, customer debt or real money movement. The tool does not automatically act on a PayPal account. It does not persist sensitive raw note or receiver text in report.json, review.csv, review.html or manifest.json. Internal source evidence SHA-256 binds the analysis to the source pages; the manifest additionally hashes the exact bytes of both operator input files and all three review artifacts.

Status comparisons are from two independently obtained PayPal observations, not one atomic snapshot; status can change during any underlying multi-page read. The original reader/reconciler fail closed on mismatched pagination facts but cannot promise cross-time consistency. Merchant operations must review all original provider data and authorize any subsequent action separately. For the official contest, get a genuine allowed sandbox acceptance, demo footage and the entrant's Devpost submission independently; this module does not claim those steps.
