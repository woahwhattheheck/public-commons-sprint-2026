# SF-50 — Seller-origin and x402 quote proof

**Scope:** standalone, optional, MIT-licensed x402 v2 Bazaar *merchant web-origin* attestation protocol and Node.js 22 library/CLI. No funds, mainnet/testnet payments, keys, endpoints or provider calls are required for local checks. It is not an SCF application or an alternative settlement network.

## Why this is different

A facilitator can index one set of payment terms while a seller's live resource is at another URL/recipient/price, or a bad actor can submit poisoned discovery metadata. This module binds a fresh verifier challenge to the exact x402 v2 Bazaar **resource URL, HTTP method or MCP toolName, selected acceptance (`scheme`, `network`, `asset`, atomic-string `amount`, `payTo`)**, seller HTTPS origin, short lifetime and an Ed25519 signature. Verification from an independently pinned Ed25519 key detects signing-key substitution. `verifyOriginProof` additionally fetches a dynamic proof from the exact seller **HTTPS** origin to attest website control, using pinned public DNS resolution, TLS host verification, redirect refusal, bounded response and timeout.

**Important trust boundary:** a valid result proves the site served a fresh statement signed by the demonstrated Ed25519 key. It **does not prove** the seller owns the Stellar `payTo` wallet, validate Soroban `__check_auth`, guarantee a future live quote, show Bazaar ingestion, or demonstrate a settled transaction. Payment, wallet authorization and merchant business identity still require independent checks. A malicious website can sign its own false quote, so this is one signal in a broader trust product, not an approval oracle. The well-known proof format below is an *original proposal*, **not** a recognized x402/SCF protocol extension.

## Source and compatibility pins (retrieved 2026-10-10)

- Official x402 Bazaar v2 spec: https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md — `info.input.type=http|mcp`, HTTP `method`, MCP (`resource.url`, `input.toolName`), payment terms in `accepts`.
- Canonical x402 v2 PaymentRequired / PaymentPayload: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
- Official original Foundation-derived resource fixture currently carried by this approved public repo: `tools/stellar_bazaar_interop/official_bazaar_resource.json`, exact blob SHA `3994053af558f31d848ecc886a74cda58a936d03`. The unchanged bytes appear in `test/official-bazaar-resource.json` for one native real-spec example. The fixture is a **published documentation sample**, not a live settled resource or Stellar-specific observation.
- This module can operate independently beside the accepted public SF-27 seller trust, SF-28 HTTP/MCP route identity, SF-29 cross-facilitator diagnostics, SF-22 catalog API, and SF-46 integrator; it deliberately changes none of those sources.

## Wire and integration contract

The HTTPS seller exposes `GET /.well-known/x402-bazaar-proof?nonce=<32-byte-base64url>`. For a request initiated by the independent verifier:

1. The verifier generates a fresh random nonce with `node cli.mjs nonce`, retaining it and the original received x402 v2 declaration. Never use the same nonce twice for the same trust decision.
2. The seller signs an unaltered original declaration using `signProof` with a secure local **Ed25519** private key and that exact nonce. Default validity: 30 seconds. Seller serves the resulting `{statement, publicKey, signature}` as JSON with `content-type: application/json` and `cache-control: no-store`, over seller-owned authenticated HTTPS. Key custody stays with the operator; none is stored in this repo. The seller's existing 402 remains the source of quoted terms.
3. The verifier fetches the proof at the exact `resource.url` origin and checks challenge, timestamp, selected acceptance, **every quoted atomic payment field**, signed resource identity, signature and TLS origin. `verifyOriginProof` returns the matched quote and explicit trust classification. For an offline audit, `verifyPinnedProof` requires a trusted **independent** public key (not simply the untrusted proof's included key).
4. If any receipt differs from the newest merchant declaration, do **not** automatically pay: re-fetch 402 and require a fresh challenge. Do not silently update a catalog based on this statement; catalog ownership/settlement remain separate.

**Seller reference invocation:** `node cli.mjs sign --entry payment-required.json --key /secure/seller-ed25519-private.pem --nonce <fresh-verifier-nonce>`. Give the resulting JSON to the requested well-known handler. Do not store private key in public source, message, shell history or CI. Read-only verification: `node cli.mjs verify --entry payment-required.json --proof seller-proof.json --pubkey known-seller-public.pem --nonce <same-nonce>`. Online verifier: `node cli.mjs verify-origin --entry payment-required.json --nonce <same-nonce>` (public seller origin must actually serve dynamic well-known proof over HTTPS). `node --test test/proof.test.mjs` runs the single focused regression entrypoint locally; no workflows are added.

## v2 contract commitment (2026-10-10)

The proof statement domain is now `stellar-bazaar-seller-origin-quote-proof/v2`. Every signature includes an `identity.contractSha256` for deterministic, domain-separated SHA-256 of the **entire original `extensions.bazaar`** (including HTTP query parameters, MCP `inputSchema`, output metadata and route template) plus the **complete selected `accepts`** entry (including timeout and `extra`). JSON object keys are recursively sorted; omitted/undefined, cyclic, overdeep and oversized metadata is rejected rather than silently left unsigned. Buyers MUST recreate the contract from the original declaration before accepting a proof; no argument supplied only by an untrusted proof establishes the listing's identity.

**Wire compatibility:** v1 signatures are intentionally not accepted as v2. Sellers and verifiers must both upgrade and mint a **new fresh-nonce proof** rather than re-labeling an old statement. The signature still does NOT verify a live HTTP 402, seller wallet ownership, onchain settlement, or registry integrity. A protected contract change invalidates an old proof, which is the desired safe outcome.

## Explicit constraints and next integration

The library requires canonical HTTPS resource URLs on standard port 443 and rejects non-HTTPS/malformed inputs for origin verification. Its Node DNS guard rejects loopback/private/reserved address ranges before connection, pins the chosen public answer for the TLS connection and refuses redirects; deployments still need defense in depth around proxies, network egress and DNS infrastructure. This first version does not implement origin key rotations, revocations, a trusted seller directory, auditable ledger ownership, contract-priced `upto`, live provider comparison, or an automatic persistent replay journal. These are next independent integration candidates for SF-27/SF-29/SF-36/SF-46 owners, not claims of completed functionality.

License: MIT (repository root LICENSE). No GitHub Actions, private source, bounty or SCF submission.
