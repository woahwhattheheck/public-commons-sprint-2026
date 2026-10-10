# SF-50 — x402 discovery quote commitment

**Purpose:** Prevent silent discovery-to-payment drift in an ordinary buyer agent. A marketplace record is *not* a wallet instruction. After selecting a Bazaar resource and one exact priced option, the buyer snapshots an immutable, content-digested intention and compares that intention with the *actual request* and *actual x402 v2 `PaymentRequired` challenge* **before** calling the signer. The helper never signs, settles, sends, books, deploys, or publishes a market listing.

## Sources and provenance (2026-10-10)

- Canonical x402 v2 `PaymentRequired`, `accepts`, `resource.url`, `scheme`, `network`, `asset`, `amount`, `payTo`, `maxTimeoutSeconds` and `extra`: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
- Canonical Bazaar `info.input` discriminators (`http` method versus `mcp` toolName): https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md
- Actual public BazaarCatalog provider-read source, `scf46-stellar-bazaar/src/catalog.mjs` (read-back Git blob `66beed7c3a4b617ab90680ec5fe8318e934e74f7` at commit `8eb786ce71381b1c8923f4f68252ee0a062dfb27`). Its `list/search` methods return records with `resource: {url}`, `accepts` and `extensions.bazaar.info.input`, consumed without changing its producer.
- Public source-reported GET-versus-POST discovery/payment failure: https://github.com/x402-foundation/x402/issues/3657. This is the problem to prevent, not proof that our helper fixed that upstream incident.

## Integration

```js
import { bindDiscoveryQuote, reviewPaymentRequired } from './quote-commitment.mjs';

// `listing` is one BazaarCatalog.list/search entry from an operator the buyer chose.
const quote = bindDiscoveryQuote({ listing, acceptanceIndex: 0, ttlMs: 60_000 });

// Call the actual endpoint, receive HTTP 402, decode its canonical PAYMENT-REQUIRED.
// Capture actualRequest BEFORE adding payment-signature and reissuing the request.
const decision = reviewPaymentRequired({
  quote,
  paymentRequired: actual402,
  invocation: { kind: 'http', resourceURL: actualURL, method: actualMethod }
});
if (!decision.ok) throw new Error(`Buyer must re-evaluate discovery: ${decision.reason}`);
// ONLY NOW hand decision.accepted to an independent, user-authorized SF-31/36 signer.
```

For MCP the invocation shape is `{kind:'mcp',resourceURL:serverURL,toolName}`. A shared MCP server may advertise several priced tools; the selected toolName must still match the challenged and invoked tool.

## Exact behavior and boundaries

- Resource URLs are canonical HTTP(S) strings; no fragment, credentials, whitespace or silent URL normalization. A different origin/path/query must be re-evaluated.
- The original HTTP method or MCP toolName is pinned. A 402 often carries no method; **the actual invocation argument is mandatory**. If the 402 includes a Bazaar input discriminator, that must match too.
- Network (CAIP-2), asset, scheme, recipient and positive decimal-string **atomic** amount are exact, not converted through floating-point numbers. Changing extra scheme parameters or timeout also triggers re-evaluation. If a challenge has multiple accepts options, only the pinned matching option is returned.
- Quotes include local observation/expiry times and an SHA-256 digest of canonical fields to detect accidental in-process mutation. That digest is **not** a signature, proof of seller identity, freshness attestation, or anti-replay mechanism. Client must use secure trusted clocks and an independent signer, payment-spend governor, authentic server TLS, and chain receipt reconciliation.
- Neither this module nor a local test implies accepted SCF funding, testnet/mainnet payment, seller authorization, complete x402 compatibility, real RPC throughput, live uptime, or production readiness. The same source format is used; test fixtures do not pretend to be actual provider challenge traffic.

**Focused check:** `node --test stellar-forge/quote-commitment/quote-commitment.test.mjs` (Node 22, no external dependencies). Six changed-behavior cases cover success, method/tool drift, recipient/asset/network/amount drift, quote tampering/expiry and malformed selection. No broad suite, hosted Actions or paid infrastructure necessary.

**Integration handoff:** SF-31 SDK calls this helper between actual 402 receipt and signer; SF-36 separately enforces budgets and transaction journals; SF-27 handles seller-authenticated catalog ingress; SF-26 handles MCP catalog records. No overlapping owner source files are edited here. A future separate source-coupled integration can replay real unaffiliated x402 provider traffic without contacting or spending money automatically.

License: MIT, same as public Bazaar prototype.

## Checked signer-input boundary

The returned `accepted` object includes only the reviewed x402 requirement fields: `scheme`, `network`, `asset`, `payTo`, `amount`, plus `maxTimeoutSeconds` and `extra` when explicitly present in the selected payment option. Arbitrary additional top-level fields supplied by an untrusted HTTP 402 are *not* passed to signer code, even if the core quote fields happen to match. Payment-scheme-specific metadata belongs under a separately reviewed `extra` contract. The preflight result is not a wallet authorization by itself.
