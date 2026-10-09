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

The local HTTP handler rejects non-loopback Host headers, cross-origin browser Origin headers, and cross-site Fetch Metadata before any provider read or draft. This protects this local demo from common DNS-rebinding/browser-trigger scenarios; it is not user authentication.

The server binds to 127.0.0.1 by default; don't deploy it publicly without
real user authentication and tenant isolation. The app cannot create/cancel
subscriptions, charge/refund, send customer emails, or alter account state.
Customer identities and payment instruments are never sent to the optional
model; provider credentials are never returned to the browser. The current
status receipt is not a proof of settled funds. Provider failures never
silently switch from PayPal to demonstration data.

## PayPal sandbox list coverage

PayPal Subscriptions v1 limits each List API page to 20 records. RenewalGuard
now reads consecutive pages (up to 10 pages / 200 records), displaying how
many pages and subscriptions it actually received. A full last page triggers
a confirming next-page request even if PayPal omits its `next` link. If the
200-record cap is reached while more data could exist, the UI explicitly
labels the list **PARTIAL**; never interpret its count as the full merchant
portfolio. Paging is read-only, sequential, and always uses the fixed PayPal
sandbox origin rather than requesting arbitrary link URLs.

Malformed pages, repeated subscription identifiers across pages, inconsistent
next links, or failed page requests reject the *entire* list rather than
showing a misleading partial success. The UI clears any previous list when
reloading so a request failure cannot leave stale records selectable.

Run the focused source contract with `node --test test-pagination.mjs`.
Official paging contract:
https://developer.paypal.com/api/subscriptions/v1/subscriptions-list/

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
