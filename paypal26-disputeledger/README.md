# DisputeLedger — PayPal AI Hackathon 2026

A runnable, read-only **PayPal Disputes API sandbox** case studio. It retrieves actual sandbox dispute summaries and details, categorizes seller evidence gaps, and optionally asks an AI chat-completions provider for grounded drafting questions. The human reviews and exports the packet; the app never provides evidence, sends dispute messages, changes dispute status, accepts a claim, makes a refund or moves money.

**Source status:** Original competition prototype; no Devpost submission, provider-verified sandbox run, award or payout is represented by this source. The synthetic example is not PayPal evidence.

## Run locally

Requirements: Node.js 22 or newer; no npm install required.

    cd paypal26-disputeledger
    npm start

Visit http://127.0.0.1:3168 and choose **Load synthetic example** to explore the entire review/packet flow offline. The example has explicit SYNTHETIC_DEMO labeling and does not pretend to be an actual PayPal case.

## Real PayPal sandbox read integration

With an existing authorized **PayPal sandbox REST app** that has seller dispute-read access, set the two runtime-only variables and restart:

    export PAYPAL_CLIENT_ID='from authorized sandbox app'
    export PAYPAL_CLIENT_SECRET='from authorized sandbox app'
    npm start

The **Read sandbox cases** button performs PayPal sandbox-only:
1. POST https://api-m.sandbox.paypal.com/v1/oauth2/token (OAuth client credentials).
2. GET https://api-m.sandbox.paypal.com/v1/customer/disputes?page_size=10.
3. On selecting a case, GET https://api-m.sandbox.paypal.com/v1/customer/disputes/{id}.

Server-side credentials and access tokens are never sent to the browser. Disputes access requires the proper PayPal Disputes app feature and OAuth scopes; a merchant lacking permission receives an error. Nothing silently falls back to fake PayPal data on API failure. The server is loopback-only; this is NOT a hosted multitenant dashboard. Its HTTP server accepts only `Host: 127.0.0.1:PORT` (the address printed on startup), rejecting alternate hostnames and malformed Host values on all routes, including reads. This protects the canonical local browser origin; open the printed URL, not a network alias.

PayPal official Disputes v1 API: https://developer.paypal.com/docs/api/customer-disputes/v1/ . PayPal's own API definition: https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/customer_disputes_v1.json .

## Optional AI (OpenAI-compatible HTTPS endpoint)

    export AI_CHAT_COMPLETIONS_URL='https://authorized-provider.example/v1/chat/completions'
    export AI_API_KEY='from authorized model credential'
    export AI_MODEL='supported-model-id'
    npm start

The model receives only case *reason, status, stage, amount/currency and five evidence-category flags*. It never sees dispute IDs, buyer identities, transaction references, case notes, uploaded documents or payment tokens. It is asked for a bounded JSON summary and verification questions, never a fabricated proof of delivery/refund. A malformed, refused or unavailable model response produces an explicit offline checklist instead. No AI-driven PayPal mutation endpoint exists.

### Optional AI response memory budget

The optional chat-completions response is read through a bounded WHATWG byte stream, not a full unbounded `response.text()` allocation. Declared `Content-Length` above 10,000 bytes (or invalid) is rejected before reading; streamed chunks are capped cumulatively at **10,000 UTF-8 bytes** and the body is canceled if exceeded. A response without a readable stream fails closed rather than using an unbounded fallback. This slightly stricter byte bound may reject some large Unicode provider responses that previously passed a character-only limit; the deterministic checklist remains available. This is not a provider-backed cost, accuracy, or latency benchmark.

## Operator flow

1. Fetch an actual sandbox dispute or load the unmistakably synthetic demo.
2. Inspect reason/status/stage and whether it is provider-backed or synthetic.
3. Mark only seller-evidence categories that genuinely exist in the operator's records: delivery, refund, order record, merchant terms, buyer communications. Checkboxes don't validate supporting documents.
4. Prepare draft. Missing categories are derived from the dispute reason, with conservative fallback for unfamiliar reasons; AI advice is separate and non-authoritative.
5. Download the JSON packet for human review. It says DRAFT_ONLY, evidence_submitted=false, payment_verified=false, 0 submission actions and 0 refund actions.

No customer-provided personal data is stored or transmitted. Server retains only normalized status/category facts in memory for at most 15 minutes (or 80 cases), lost on restart. Browser exports remain local. The live integration is read-only GET and OAuth POST only, always on sandbox; no live-money endpoint or dispute mutation code exists.

## Focused check and limitations

    npm run check:focused

Checks synthetic checklist provenance, API route scope/credential handling with mocked sandbox network and AI prompt redaction with a mocked provider. This small offline contract does not establish live PayPal access, authorized merchant scopes, an actual dispute, or contest eligibility.

PayPal AI Hackathon terms: https://paypalaihackathon.devpost.com/rules . Eligibility requires a materially new eligible AI + PayPal project, public source, actual working integration, judge-accessible demo and public sub-three-minute video; these need separate owner/entrant execution and a Devpost entry receipt. This source is merely a build candidate. For live merchant dispute resolution, always verify original PayPal status, required evidence types and submission links through first-party workflows.

License: MIT; do not include real OAuth keys, case IDs or customer details in public issues, recordings or source.
