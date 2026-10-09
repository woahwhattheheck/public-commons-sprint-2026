# DisburseLens — PayPal payout evidence and locally learned review assistant

**PayPal AI Hackathon 2026 original demo candidate** · MIT · Node.js 22+ · zero package installs.

DisburseLens is a merchant/operator reconciliation workspace for PayPal **Payouts v1** *read-only* data. It checks an entire payout batch for duplicate sender IDs, nonfinal/failed payment statuses and exact-cent aggregate mismatch, then applies a locally trained **multinomial Naive Bayes** classifier to the payout's free-text note. It puts each item into a human-controlled casebook, preserving the original batch-evidence SHA-256 and a redacted CSV export.

Importantly, it does **not** call PayPal create/cancel payout endpoints, transfer funds, initiate refunds, or offer a machine-authorized payout action. "Escalate" and "Acknowledge" change only the local review decision state. The synthetic fixture is not evidence of real funds received or disbursed. The classifier is an advisory learned *text pattern* signal, **not** a fraud verdict.

## Run a real working judge demo (no credentials)

```sh
cd paypal-disburselens-2026
node src/server.mjs
```

Open http://127.0.0.1:8787. The loaded fictional batch has six payouts and an exact-cent $700.00 aggregate; review the duplicated sender ID, a still-PENDING payout, a FAILED payout, and flagged note language. Filter **Needs review**, click **Escalate**, and download the redacted evidence CSV. Refresh the page to see the local review state in memory. **Load fictional example** replaces the current batch and resets the casebook after an evidence change.

The classifier is trained locally at process startup using 24 included labeled fictional payout narratives; no model key/provider/token call. `src/model.mjs` exposes `train(rows)` and `classify()` to illustrate a transparent approach; review scores and strongest token contributions are visible in the UI. For production, supply more representative labeled cases and independently evaluate false positives/negatives.

One scoped source-behavior check:

```sh
npm run test:focused
```

This test covers a trained local classifier, exact-cent parsing, a duplicate sender ID, completeness rejection, HTTP report/decision, stale-version protection and redacted CSV; it is not a live PayPal connector test.

## Connect read-only PayPal sandbox Payouts

The project uses the first-party Payouts v1 [Show payout batch details](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-get/) API, `GET /v1/payments/payouts/{id}` with `page=...&page_size=100&total_required=true`, plus OAuth2 client-credentials `POST /v1/oauth2/token` for a bearer token. **No payout-creating action** is included. Authentication requires a PayPal sandbox app **with the Payouts scope enabled**; a generic sandbox app may receive HTTP 403 for lack of entitlement.

Set credentials **locally** (not in source, screenshots, Slack, or submissions):

```sh
export PAYPAL_CLIENT_ID=your_sandbox_client_id
export PAYPAL_CLIENT_SECRET=your_sandbox_secret
node src/server.mjs
```

Enter an existing **sandbox** payout batch ID in the dashboard. The server only connects to `https://api-m.sandbox.paypal.com`, never production. It handles up to 10 pages × 100 records, rejects mismatched IDs/pages/counts, enforces a per-page response size cap and a 9-second per-call timeout, and does not silently claim partial data is reconciled. Every backend sync requires an explicit UI action; errors cannot trigger automatic retries or transfers.

**Demo scope versus official submission:** A complete interactive local demo works using fictional data. A PayPal sandbox GET integration is implemented from official specs but not verified against live credentials in this environment. We have **not** created a PayPal account, called the provider, entered Devpost, uploaded any official contest submission, or won a prize. Official entries additionally require a public, open-source repository, working demo or reproducible setup, meaningful AI and central PayPal integration; entrants should verify eligibility and account access. Source rule: https://paypalaihackathon.devpost.com/rules (deadline November 12, 2026, noon PST).

## Architecture and scope

- `src/paypal.mjs` — fixed-host, bounded sandbox OAuth + paginated Payouts GET, no payout write methods.
- `src/model.mjs` — directly trained/interpretable local multinomial Bayes note classification.
- `src/reconcile.mjs` — exact-cent BigInt, complete batch counts, deterministic evidence hashes, masked receiver, anomaly flags.
- `src/server.mjs` — loopback-only API and static UI, human review states with stale-version checks, CSV export, source-bound audit log.
- `public/` — accessible responsive dashboard, filters, model explanations, review decisions, evidence export.
- `fixtures/payout_batch.json` — clearly marked fictional 6-item example, not a provider receipt.
- `test/focused.test.mjs` — one narrowly relevant workflow check.

**Known limitations:** Local review decisions live in RAM and reset on restart. The review queue should not be treated as an accounting system of record or anti-fraud engine. Case evidence uses a full SHA-256 hash of the source response, but no durable encrypted archive is stored. No live sandbox credentials or PayPal-enabled account are bundled. Payment status comes from source and is never inferred from learned AI scores; `PENDING` remains unsettled even when the text looks routine. Limit processing to sandbox test data and qualified authorized reviewers.

No live payouts, subscription changes, external contact, or paid API/model inference.
