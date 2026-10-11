# SF84 · MPP vs x402: original merchant challenge intake

**Commercial need.** Stellar documents two independently implemented HTTP 402 agent-payment protocols. The existing SCF Starforge SF30/SF31/SF61/SF74 native product handles the x402 v2/Bazaar path. Stellar's official `@stellar/mpp` SDK uses HTTP `WWW-Authenticate: Payment` challenges for **Charge** (one SAC transfer per request) and **Session** (many off-chain cumulative channel commitments). An x402-only buyer attempting to ingest MPP on the same HTTP 402 status is *not* an MPP client. Seller discovery, merchant triage and the SCF Build #46 differentiation story should recognize both rails without claiming they are interchangeable.

This independent tool consumes **operator-supplied raw header captures from actual merchants** and produces a bounded, SHA-256-bound, deterministic classification/review handoff. It is an offline, read-only product intake, not a new buyer, wallet, facilitator, payment SDK, live proxy, or revenue claim. No new packages, outbound requests, secrets, local database, Actions or hosted work.

## Execute (Node 22+)

```sh
node stellar/scf-starforge-20261009/sf84-mpp-market-intake/inspect.mjs /path/to/authorized-raw-402-capture.json
```

The input is JSON with `status` (e.g. 402), `url`, `method`, and `headers` as either a JSON object or an array of `[name,value]` pairs. Use pairs when preserving repeated `WWW-Authenticate` challenges. Preserve the original challenge header *verbatim* in input; store operator originals privately. **Do not include `Authorization`, `Cookie`, `PAYMENT-SIGNATURE`, API keys or any caller credentials**: the inspector rejects those named headers instead of handling them. Input must be at most 256 KiB, headers at most 80 pairs, each header value at most 16 KiB. The output includes the byte-level SHA-256 digest of the original capture, the original URL/method, the individual advertised payment offers, a separate MPP charge/session listing, and actionable per-rail review notes. Raw encoded credentials are never written or transmitted.

Input shape (supply actual captured values rather than placeholders):

```json
{
  "status": 402,
  "url": "https://authorized-merchant.example/resource?city=A",
  "method": "GET",
  "headers": [
    ["PAYMENT-REQUIRED", "<merchant's original x402 v2 base64 JSON header>"],
    ["WWW-Authenticate", "Payment id=\"...\", realm=\"...\", method=\"stellar\", intent=\"charge\", request=\"<merchant's original base64url JSON>\""]
  ]
}
```

A capture may include only one protocol's header. This is merely a schema illustration; it does not represent a live merchant or a runnable payment fixture.

## RFC 9110 coalesced merchant challenges

A real intermediary may coalesce several `WWW-Authenticate` challenges into **one** header value, such as `Basic realm="existing", Payment id="...", realm="...", method="stellar", intent="charge", request="..."`, or two distinct `Payment` challenges for Charge and Session. The native SF84 intake now separates challenge boundaries while preserving quoted commas and auth parameter commas. It selects only the `Payment` challenges and retains every distinct challenge ID; repeated IDs remain ambiguous. `mpp.headerCount` counts identified Payment challenges, not original HTTP field lines. `capturedSha256` continues to bind the entire original captured file, while per-challenge `wireSha256` covers the parsed individual challenge text. The splitter is not issuer or signature verification and does not turn MPP into an x402 buyer capability.

## Merchant / SCF founder operating result

| Observed 402 | Operator route | Commercial position |
| --- | --- | --- |
| Valid `PAYMENT-REQUIRED` x402 v2 | Keep each original `accepts[]` alternative **indivisible**; review through original SF31/SF81 with separately sourced merchant proof | Cross-provider discovery, exact-intent operator review, durable budgets, merchant repair evidence |
| Valid `WWW-Authenticate: Payment ...` MPP | The existing x402 client **cannot** spend it; evaluate official `@stellar/mpp` charge/session integration as *future scope*, not an installed feature | Adds non-facilitator, channel and fee/sponsorship conversations to merchant discovery |
| Both | Explicitly choose one reviewed rail. Never merge one protocol's resource/asset/amount/recipient with the other's | Qualified multi-protocol seller prospect and a concrete interoperability milestone |
| Invalid, duplicate/ambiguous or non-402 | Use original provider header source to resolve; never silently normalize away disagreements | Real merchant support opportunity, not a claim of successful payment |

**Grant distinction.** “Another Stellar x402 implementation” is not the durable pitch. The shipped proof is **merchant onboarding from original OpenAPI, multi-provider discovery, consistent budget-controlled operator review, honest source/chain/delivery state and remediation evidence**, with MPP Charge/Session recognition as a practical *forward integration opportunity*. Do not represent this new offline inspector as a production MPP implementation or attach arbitrary MPP numeric amounts to x402 atomic units. Founder still needs a real seller agreement, paid customer pilot and independent Stellar onchain receipts.

## Source and acceptance

- Official Stellar: https://developers.stellar.org/docs/build/agentic-payments/mpp (Charge vs Session, no external facilitator for MPP)
- Official Stellar MPP Charge: https://developers.stellar.org/docs/build/agentic-payments/mpp/charge-guide
- Payment HTTP auth protocol source: https://github.com/tempoxyz/mpp-specs (`WWW-Authenticate: Payment`, `Authorization: Payment`, `Payment-Receipt`)
- Existing Starforge: `sf31-buyer-client/README.md`, `sf81-buyer-operator-bridge/README.md`, `sf74-merchant-support-console/README.md` on current public main.

One focused check of this new source only:

```sh
node stellar/scf-starforge-20261009/sf84-mpp-market-intake/acceptance.mjs
```

Includes native header parsing, multiple x402 options, both MPP intents, mixed rails, duplicate/id collision and credential refusal. Its test values are explicit local format scenarios, *not* measurements of seller availability, Stellar fees, settlement or an actual MPP SDK transaction. No tests are registered in hosted CI.

**Limitations:** The parser decodes and classifies untrusted data; it does not verify issuer signatures, MPP challenge HMAC, JCS canonicalization, expiry, sender origin, transaction success or x402 protocol conformance beyond the stated structural checks. Do not expose decoded untrusted fields to a shell, browser HTML renderer or trusted policy without escaping and merchant identity review. `capturedSha256` proves only local file byte identity, not seller authenticity.
