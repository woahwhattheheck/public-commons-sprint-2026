# SF-51 · Agent commerce local source smoke

**Purpose:** give SCF Starforge reviewers and local/Muse operators a single-command, genuinely wired no-wallet demonstration of **existing merged code**, rather than another merchant mock or another independently implemented payment SDK.

This integrates two first-party public modules without changing their contracts:

- `scf46-stellar-bazaar/src/catalog.mjs` — original validated in-memory `BazaarCatalog`, `createDiscoveryServer`, source `GET /discovery/search` ranking/filter wire.
- `stellar-forge/mcp-paid-agent/agent-server.mjs` — original `McpPaidToolBroker`, `createMcpHttpHandler`, MCP `2025-11-25` JSON-RPC wire.

A **real** HTTP listener binds `127.0.0.1` on an ephemeral port. It serves source-native discovery, a local seller `GET /premium` returning x402 v2 `402 PAYMENT-REQUIRED`, and bearer-gated MCP. An internally generated 32-byte bearer value is never logged. Original MCP `/initialize`, `tools/list`, `bazaar_search`, `bazaar_preview`, `bazaar_execute_approved`, `bazaar_cancel` and cancellation replay are exercised over HTTP (not direct method calls). The broker has **no signer** and default-deny independent approval, so an attempted paid call returns `SIGNER_NOT_CONNECTED` and the merchant is not contacted by MCP. The one seller GET at the end is a deliberate read-only 402 probe. Signed request count remains zero.

## Run in the repo root (Node 22)

```bash
node stellar/scf-starforge-20261009/sf51-local-commerce-smoke/smoke.mjs
```

Optional single focused automated check (same path, no broad suite):

```bash
node --test stellar/scf-starforge-20261009/sf51-local-commerce-smoke/test/smoke.test.mjs
```

Expected output includes `status: PASS`, `discovered: 1`, `merchantGet402: 1`, `signedRequests: 0`, `executedPaymentCalls: 0`, `cancelledReplay: true`, `testnetTransactions: 0`. A source interface change causes the original runtime to fail instead of falsely reporting success. No dependencies beyond merged product source and built-in Node APIs.

## Limits of this result

- `TEST-ONLY-UNISSUED-*` recipient and asset values are **deliberately unspendable fixture strings**. They may be accepted by the local in-memory catalog's trusted-input API for the demo but are not Stellar account/asset attestations.
- `insertValidated` is explicitly treated as trusted fixture insertion; production ingestion must use merged seller identity, actual on-ledger settlement, replay/version preflight and the user-approved wallet pipeline. This is *not* a substitute for SF41 official provider replay, SF43 official Stellar testnet transfer verification, or live first-party x402 supported corpus checks.
- No independent payment signature, real transfer, public deployment, availability SLA, SCF grant eligibility, application filing, funding decision, award or revenue is evidenced by this smoke.
- Merchants can unilaterally advertise 402; the test makes no assertion that the demo signer, facilitator or merchant is funded. For production proof use the actual SF43 independent RPC transfer-event path.
- Do not run this in hosted GitHub Actions; use cloud, Muse, or an authorized local Node22 runner with the original repository checkout.

**Original author scope:** self-contained `sf51-local-commerce-smoke/` only. Preserve all existing SF23/SF31/SF32/SF43 product owners. No payment credentials required, and no need for an account connection or external URLs.
