# CartWitness — consent-first PayPal × AI shopping

An original, self-contained 2026 PayPal AI Hackathon entry candidate. CartWitness turns a buyer's natural-language objective into a bounded catalogue recommendation, asks for explicit consent to its exact price, creates a real PayPal REST Orders v2 order **only in PayPal sandbox**, sends the buyer to PayPal for approval, and requires a separate capture decision. AI is recommendation assistance, never payment authority.

## Quick start (Python 3.10+, no dependencies)

    cd paypal26-cartwitness
    DEMO_FIXTURE=1 python3 server.py

Open http://127.0.0.1:8765. Enter a goal, choose a budget, review the product, tick the exact-price authorization, simulate payer return, then explicitly confirm the fixture capture. UI prominently marks this as **offline rule-based fixture**, **not a model inference or actual PayPal order**.

For genuine model selection and live sandbox integration, set environment variables (use your own sandbox app and developer key; never commit values):

    export OPENAI_API_KEY=<your model API key>
    export OPENAI_MODEL=gpt-4.1-mini
    export PAYPAL_CLIENT_ID=<your sandbox client id>
    export PAYPAL_CLIENT_SECRET=<your sandbox secret>
    python3 server.py

Use PayPal's **personal sandbox buyer** during approval. The local server must remain available at 127.0.0.1:8765 for PayPal to redirect the browser. No PayPal production host or live-money endpoint exists in the code.

## Real flow

1. Select from six owner-defined, server-priced catalogue SKUs; AI receives only items within the buyer's budget and must return a valid SKU and concise explanation. Invalid AI output fails closed. Without model credentials, the only fallback is opt-in, visibly labelled fixture mode.
2. Buyer checks the exact item and amount. Only then does the server obtain a sandbox OAuth token and POST /v2/checkout/orders (intent CAPTURE), with an idempotency key and server-derived USD amount.
3. Buyer visits the verified sandbox PayPal approval URL. On return, the server retrieves the canonical order and checks status APPROVED, single purchase unit, same SKU and same USD price.
4. Buyer independently confirms capture in the UI. The server re-checks APPROVED/amount, POSTs the capture with a stable request key, and reports success only after a COMPLETED response with a matching completed capture.
5. All transitions record short in-session evidence; no API credentials, bearer tokens, payer details or raw payment responses are stored in the browser or printed. Local data vanishes when the server restarts.

**Security boundary:** Local demonstration, not a production commerce integration. No persistent authenticated users, inventory reservation, webhooks, tax/shipping, fraud evaluation, durable capture recovery, background reconciliation or dispute handling. Do not expose this server publicly or use it as a merchant checkout without those controls. The user explicitly approves both the selection and capture. An arbitrary user prompt cannot change prices, select out-of-catalogue products or specify a PayPal API hostname.

## Focused payment invariant check

    python3 -m unittest discover -s tests -p test_payment_boundary.py

This verifies the original amount, approved-state and completed-capture predicates with synthetic provider responses. It does not establish a real PayPal transaction or official hackathon acceptance. No broad suite.

## Competition readiness

Official rules: https://paypalaihackathon.devpost.com/rules (November 12, 2026 at noon PST). A functional judge demo with real configured model and PayPal sandbox account, an original open-source GitHub repo (root MIT license inherited from the containing repository), complete setup instructions, a **public YouTube demo under three minutes**, and the authenticated entrant's Devpost submission are required. This source alone does not constitute a submission, eligibility approval or awarded prize.

Potential prize fit: Best Use of Agentic Commerce and Best Use of PayPal + AI. Neither has been awarded or reserved. No sponsor API keys or credentials are published. This project is distinct from ClaimProof's dispute/payment-truth reconciliation concept.

## Source and provenance

All example catalogue items, prices, product names, buyer requests and fixture events are synthetic. Keep source changes, entrant ownership and official competition credit with the original owner. MIT license at repository root.
