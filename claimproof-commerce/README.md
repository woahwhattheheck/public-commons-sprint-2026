# ClaimProof Commerce — PayPal AI Hackathon source packet

**Status 2026-10-08:** Original functional **local sandbox-capable prototype**, not a Devpost entry, a live PayPal integration execution, a provider-verified capture, or an award. All live network actions require a separately configured PayPal sandbox and an explicitly authorized human. No PayPal credentials were created/used in this build.

## What it does

A buyer pastes a digital product cart and merchant's own terms. The server normalizes a fixed 2-decimal USD amount, detects missing return/fulfillment disclosures, and optionally sends the *cart and terms only* to an OpenAI-compatible chat model to receive structured risk questions. The model is advisory; it cannot select a merchant, payment amount, token, or operation. The user must deliberately consent to create a PayPal **sandbox** Orders-v2 intent=CAPTURE checkout, approve it on the actual PayPal sandbox site, and deliberately consent *again* to capture. Before capture, the server gets live PayPal order state and requires APPROVED, USD, and exact unchanged total. Browser callback or AI output alone never captures. The app cannot target PayPal live endpoints.

## Run offline now

```bash
node --version               # >=22
npm run check:focused        # four local contracts, no network access or broad suites
npm start                    # http://127.0.0.1:3159
```

Visit that loopback URL, edit cart and terms and click Review. Review works without external accounts, models or network. The health summary displays which integrations are configured. With no PayPal sandbox credentials, the optional *Create sandbox order* step returns an honest provider-unconfigured message.

## Enable real sandbox and optional AI advisory (existing credentials only)

Use an already-authorized sandbox business application and a permitted AI model endpoint; keep credentials in the runtime environment and out of git/chat/source. **No new account or API credentials are provisioned by this packet.**

```bash
PAYPAL_CLIENT_ID='from existing sandbox vault' \
PAYPAL_CLIENT_SECRET='from existing sandbox vault' \
AI_CHAT_COMPLETIONS_URL='https://existing-model-provider.example/v1/chat/completions' \
AI_API_KEY='from existing provider vault' \
AI_MODEL='existing-supported-chat-model' \
npm start
```

Credentials are server-only. The AI endpoint must be HTTPS or loopback. PayPal transport is hardcoded to `https://api-m.sandbox.paypal.com`; the application does not implement production-mode payments. This is a local prototype bound to `127.0.0.1` intentionally, not a public hosted app.

### Uncertain PayPal sandbox capture outcomes

A network timeout or HTTP 503 **does not prove that a capture failed**. Never start another checkout solely because an API response was unavailable. Inspect the original order in the PayPal **sandbox** dashboard first. While the same local 30-minute review is retained, another explicitly confirmed Capture action reuses that review's idempotency key. Before any new capture POST, the backend fetches the order: if PayPal already reports `COMPLETED` with one verified successful USD capture of the exact reviewed amount, it reconciles locally and does **not** send a second capture. Mismatched order identity, amount, intent or incomplete capture records are rejected for manual investigation.

This is not a general chargeback, refund or production-payment reconciliation service. In-memory review state is lost on server restart; an unknown provider outcome must be resolved at PayPal before starting a new order. Offline focused cases are in `tests/focused.test.mjs`; they do not prove any live capture occurred.

### Security and delivery limits

- This prototype uses an in-memory, 30-minute review store and loopback-only server; it is not a multitenant production service. Cart fingerprints cover items, price, terms, and currency. Explicit approvals are not delegated to a model.
- PayPal OAuth: `POST /v1/oauth2/token` with client credentials; order: `POST /v2/checkout/orders`; approval: first-party sandbox link; check: `GET /v2/checkout/orders/{id}`; capture: `POST /v2/checkout/orders/{id}/capture`. Stable random idempotency IDs identify a review's create/capture attempts.
- Local demonstration does not test live credentials, buyer approval, PayPal webhook lifecycle, hosted TLS, permanent order storage or actual charge. Sandbox state may be pending even when a capture API returns.
- For public judge access, add a real sandbox provider run, a public MIT-licensed repository, setup information and a sub-3-minute **public YouTube video**. Do not claim competition entry until Devpost returns an accepted submission receipt.

## Competition requirements and source

Official PayPal AI Hackathon rules: https://paypalaihackathon.devpost.com/rules . Submission closes **November 12, 2026, noon Pacific**; judged prize pool advertised $67,500 in mixed monetary and product-credit prizes. PayPal Developer sandbox API + an AI platform must be central. A static mock does not qualify. The source is a functional interactive software packet with a real API adapter, but eligibility remains conditional on sandbox and model integrations actually operating before entry. Public-source MIT license and public YouTube demo are required at entry; no submission has been sent.

PayPal OAuth reference: https://developer.paypal.com/api/rest/authentication ; Orders v2: https://developer.paypal.com/whats-an-order/ .

## Next assigned operating lane

Have one existing authenticated sandbox operator configure the server environment and run one approved sandbox order end-to-end, recording sanitized provider receipts and never posting credentials. Then have a separate Devpost publication owner add a public repo, actual runtime video, and entry receipt. Distinct workers can improve the agent's context-aware risk model and customer-facing UX but should preserve single human authorization gates. This packet is ready for source reuse, not a submitted competition build.

### Native Anthropic Messages advisory (optional)

For an already-authorized Anthropic API credential, choose the native Messages endpoint instead of a chat-completions compatibility proxy:

```bash
AI_PROVIDER=anthropic \
ANTHROPIC_API_KEY='from existing provider vault' \
ANTHROPIC_MODEL='an enabled Messages API model' \
npm start
```

The native adapter uses only `https://api.anthropic.com/v1/messages`, the `anthropic-version` and `x-api-key` headers, a bounded 18-second call, and completed text-only response blocks. Truncated responses or tool-use blocks are rejected; the existing deterministic review remains available whenever the provider is absent or fails. It receives only normalized cart information and merchant terms, never PayPal credentials/order IDs. `AI_PROVIDER=openai` (or unset) retains the existing OpenAI-compatible `AI_CHAT_COMPLETIONS_URL` path. Neither provider can create, approve or capture an order.

Run `node --test tests/native-anthropic.test.mjs` for the two native-provider mocked HTTP contracts. No live Anthropic access or PayPal charge is implied.
