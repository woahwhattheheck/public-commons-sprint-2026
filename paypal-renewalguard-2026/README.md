# RenewalGuard — PayPal AI Hackathon 2026

A read-only, locally runnable subscription support copilot. Connect an actual
**PayPal sandbox merchant** for Subscriptions v1 list and show APIs; view
current subscription status and last failed payment without exposing payer PII;
click to request a narrowly bounded **unsent** human-review note from an
optional configured model. Every draft request re-reads provider status and
compares the current review fingerprint to prevent stale recommendations.

## Run

Requirements: Node 22+ (no npm install required). From this directory:

- \`npm start\` and open http://127.0.0.1:8787.
- Default synthetic demo runs without accounts or API requests. All demo
  subscriptions are fixtures, **not** actual PayPal or customer records.
- To read real sandbox data only, set \`PAYPAL_CLIENT_ID\` and
  \`PAYPAL_CLIENT_SECRET\` to an authorized developer sandbox merchant app.
  Select **PayPal sandbox account** in the UI. No production PayPal calls.
- Optional: set \`OPENAI_API_KEY\` (and \`OPENAI_MODEL\` if desired) to enable
  a genuine AI-generated **unsent** reviewer draft. Without it the app
  explicitly returns a rule-based placeholder, not an AI-generated result.
- Focused isolated logic contract: \`npm run test:focused\`.

The server binds to 127.0.0.1 by default; don't deploy it publicly without
real user authentication and tenant isolation. The app cannot create/cancel
subscriptions, charge/refund, send customer emails, or alter account state.
Customer identities and payment instruments are never sent to the optional
model; provider credentials are never returned to the browser. The current
status receipt is not a proof of settled funds. Provider failures never
silently switch from PayPal to demonstration data.

## Grounding, limitations and entry status

Official PayPal references:
- https://developer.paypal.com/api/subscriptions/v1/subscriptions-list/
- https://developer.paypal.com/api/subscriptions/v1/subscriptions-get/

Official competition: https://paypalaihackathon.devpost.com/rules .
Deadline: November 12, 2026, noon Pacific. The rules require a central PayPal
sandbox integration **and** AI, an installable/runnable experience, open-source
source with appropriate license, an under-3-minute demonstration video and
entrant Devpost submission. This subtree is covered by the repository's MIT
license. A credential-free demo is not evidence of live PayPal/AI functioning.
Before any official entry, run the authenticated sandbox+AI path, capture real
non-sensitive judge evidence, host/deploy safely if needed, record a genuine
video, and submit through the actual authorized entrant account.

This source publication is not a Devpost entry, acceptance or cash prize.
