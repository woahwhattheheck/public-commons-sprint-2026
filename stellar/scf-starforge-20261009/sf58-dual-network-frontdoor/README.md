# SF58: Dual-network native Stellar x402 facilitator frontdoor

MIT. **Runnable service, not a protocol fork.** Official SCF x402 RFP requires an `@x402/stellar`-based facilitator on BOTH `stellar:testnet` and `stellar:pubnet`. The first-party [`stellar/x402-stellar` facilitator example](https://github.com/stellar/x402-stellar/blob/main/examples/facilitator/src/app.ts) registers one configured network per instance. SF58 provides the missing *bounded routing edge* for two **separately operated original facilitator instances** without duplicating their settlement implementation or touching signing keys.

## Working interface

- `POST /verify` and `POST /settle`: read the **original** x402 v2 `paymentPayload` + `paymentRequirements`, require their `accepted.network` and `network` to agree and resolve exactly one of the two Stellar networks, require matching scheme, forward raw original UTF-8 request bytes to that configured network's actual `/verify` or `/settle` backend, and return its JSON response/status without editing payment signatures or amounts. The upstream original `@x402/stellar` implementation remains responsible for authentic cryptographic validation, replay rejection, fee sponsorship and actual chain settlement.
- `GET /supported`: call BOTH real backends, refuse partial or cross-network kinds, combine each network's actual advertised v2 kinds, and deduplicate signer addresses under the original Stellar CAIP family `stellar:*` (not invented per-network signer keys). Global extensions are intersection-only, rather than claiming a feature unsupported by one network.
- `GET /healthz`: shows **configuration only**, not a live chain, paid service or SLA health check.
- `GET /readyz`: authenticated **live upstream readiness**, with the same bounded native `GET /supported` reads to **both** configured facilitators and the existing exact x402 v2 Stellar network/scheme/`stellar:*` signer validation. Returns HTTP 200 `{status:"ready",networks:[...]}` only if both original upstreams are reachable and valid; returns HTTP 503 `NOT_READY` on provider errors, malformed/inconsistent declarations, timeouts or capacity saturation. Missing/invalid operator bearer returns HTTP 401. The result does not include secrets, attest to onchain transactions, or guarantee future availability. Like `/supported`, this is a **live** network read, not a cheap cached process liveness probe.
- Exact routes only; auth secrets aren't logged or sent to the wrong upstream. Body/response caps, concurrent-request cap, timeouts and redirect denial prevent unsafe unbounded relay. Inbound POST bodies have a hard 8-second wall-clock deadline, not merely an upstream HTTP timeout. A client that sends part of a body then stalls has its socket terminated and admission slot released, so later original native x402 requests can proceed. The aborted client sees a disconnected socket, not a guaranteed 408 response. No arbitrary URL forwarding or client-supplied origin is possible. Default bind is `127.0.0.1`; a non-loopback bind refuses to boot without inbound operator bearer authentication. In production, terminate TLS and apply identity/rate limiting at the operator ingress as well.

### Start (Node 22+, no npm dependencies)

Run one **operator-approved** native `@x402/stellar` facilitator instance for each ledger, separately configured with the correct passphrase/RPC/signer/fee-bump policy. Prefer their private loopback listener behind this gateway. Do not put Stellar signer secrets into SF58.

```bash
SF58_TESTNET_ORIGIN=http://127.0.0.1:5101 \
SF58_PUBNET_ORIGIN=http://127.0.0.1:5102 \
SF58_TESTNET_BEARER="$ORIGINAL_TESTNET_FACILITATOR_API_KEY" \
SF58_PUBNET_BEARER="$ORIGINAL_PUBNET_FACILITATOR_API_KEY" \
SF58_ACCESS_TOKEN="$OPERATOR_CREATED_STRONG_GATEWAY_TOKEN" \
node stellar/scf-starforge-20261009/sf58-dual-network-frontdoor/server.mjs
```

`SF58_TESTNET_ORIGIN` and `SF58_PUBNET_ORIGIN` must be credential-free HTTPS origins, or local HTTP loopback origins for self-hosted backends. An origin cannot contain an arbitrary route, query, userinfo or redirect. Use `SF58_LISTEN_ADDRESS` and `SF58_PORT` to override the default local bind and port 8788. `SF58_BODY_TIMEOUT_MS` adjusts the absolute inbound body deadline in positive integer milliseconds (default `8000`). This is independent of the original 12-second upstream deadline. Tune at the reverse proxy as well; a stalled body is disconnected and must never be forwarded to the original backend. The optional upstream bearer tokens are independent and never accepted from caller headers. Protect configuration with existing secret custody, not a committed `.env` file.

For an actual `/supported` request, supply `Authorization: Bearer <operator token>` when configured. A provider must advertise real native x402 v2 Stellar kinds and `signers: {"stellar:*": ["...account address..."]}` as in upstream `x402Facilitator.getSupported()`; SF58 never claims a scheme/fee-sponsor status not supplied by its actual backend. `POST` requests require `Content-Type: application/json` and the ordinary x402 v2 `paymentPayload` / `paymentRequirements` structure. No real payment or XDR is provided in these instructions.

Operator check with two genuine configured upstreams (no signing or payment; operator-supplied bearer stays local):

```bash
curl --fail-with-body -H "Authorization: Bearer $SF58_ACCESS_TOKEN" http://127.0.0.1:8788/readyz
```

Use `/healthz` only for local process-liveness checks; readiness can return 503 while the process itself is healthy and should not be used as a Kubernetes *liveness* trigger. Repeated `/readyz` requests induce live upstream reads; keep the probe interval bounded by the operator. Existing `/verify`, `/settle` and `/supported` response contracts are unchanged.

Focused local edge validation (mock upstreams **only** for route-contract regression, never represented as Stellar proof):

```bash
node --test stellar/scf-starforge-20261009/sf58-dual-network-frontdoor/test/frontdoor.test.mjs
node --test stellar/scf-starforge-20261009/sf58-dual-network-frontdoor/test/body-read.test.mjs
```

## Deployment, acceptance and owner handoff

**What is implemented:** original `@x402/stellar` v2 request/response routing by binding both network descriptors, actual supported-kind fanout, strict HTTP controls. Designed to sit alongside existing SF30/31 seller/buyer, SF41/45 native Bazaar corpus/replay, SF43 true-chain proof, SF46 release, and SF53 local integration work. None of their files or ownership changes.

**What is not implemented or implied:** new facilitator signing/settlement, actual deployed testnet/pubnet endpoints, live x402 transaction, token custody, mainnet fees, audited infrastructure, uptime, on-chain receipt, SCF eligibility/award, Bazaar federation or seller-provider claims. A two-network edge with mock test data is only a software route check, not a payment simulation. Each original native backend and its operator must independently establish trusted funding, signing, testnet and mainnet RPC, audit, and valid transfer receipts.

**Operator launch gate:** independent native backend `/supported` proves network + exact scheme + fee-sponsor statement; authentic signed x402 verify and one authorized settled testnet transaction; independent matching Stellar ledger receipt verified using existing SF43; a separately approved funded pubnet run with the same checks; reverse-proxy TLS/auth/log redaction, callback idempotency, operational alerting and rollback; documented resource inventory; then run the original broad Muse captures and first-party 1:1 conformance corpus with both network variants. Do not use GitHub-hosted CI for this work.

**Grant applicability:** SCF Build #46 submission deadline is November 8, 2026 and admission is invitation-first. The x402 Bazaar RFP was published for Q3/#45; the existing founder SCF track/eligibility owner must verify whether it remains an active eligible RFP for #46 before submitting. Relevant original sources: [SCF RFP Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track), [SCF #46](https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg), [Stellar x402 docs](https://developers.stellar.org/docs/build/agentic-payments/x402).

**Native source-compatibility fix (October 10):** Original [`x402Facilitator.getSupported()`](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/facilitator/x402Facilitator.ts) groups signer addresses by each facilitator's CAIP family, not by each concrete network. The original [`ExactStellarScheme`](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/exact/facilitator/scheme.ts) sets `caipFamily = 'stellar:*'`. SF58 therefore preserves the original signer-family key and stable de-duplicated union across independently configured testnet and pubnet backends; unrelated/invalid signer maps fail closed. This does not assert signer authority on the opposite network or validate a transfer.
