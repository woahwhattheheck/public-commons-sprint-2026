# SF-45: real Bazaar discovery recovery and hostile-transport checks

This module is an **actual GET-only client** for the public [PR451 BazaarCatalog/createDiscoveryServer](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/451), with baseline source Git blob SHA `f34f38a3af8f1b9e23ff4607812b4ee6297480a5`. It processes the original Node HTTP search endpoint and authentic source-generated cursor, without implementing or simulating x402 settlement, wallets, signing, customer traffic or a payable endpoint.

## Original code and recovery behavior

- GET `/discovery/search` with actual `query`, `network`, `scheme`, `limit` and original source-generated `cursor`. Enumerate all available pages rather than assuming only a small sample.
- Transient HTTP 429/502/503/504 and transport fetch failures receive finite configurable retry attempts, exponential backoff and per-request deadlines. Real caller abort signals stop the client; paid requests **are never attempted**.
- When genuine upstream source returns `400 INVALID_REQUEST` with `Stale or invalid cursor` after original `BazaarCatalog.insertValidated` mutation, discard mixed-snapshot partial results and restart a complete GET-only search.
- Deduplicate via actual indexed HTTP/MCP identity; reject malformed resources and repeated/invalid cursor. Expose observed HTTP attempt, retry, restart, successful page and elapsed-time counts. Returned `paymentCalls:0`, `settlementReceipts:0`.
- Persistent HTTP failures and exhaustion throw a stable `DiscoveryError`. They **do not** return success from a partial result.

## Source-exact focused cloud experiment

From repository root with Node.js 22+, zero npm dependencies:

```bash
node --test stellar/scf-starforge-20261009/sf45-discovery-recovery/test/*.test.mjs
```

This focused two-file command runs THREE cases against the **actual public PR451 catalog and native Node HTTP server** (no parallel mocked protocol):

1. A real five-entry original catalog paginated with limit two, HTTP 503 then HTTP 429 **intentionally injected at the transport boundary** before genuine source handlers resume: **5 attempts / 2 retries / all 5 entries**.
2. Actual `insertValidated` mutation after first page invalidates the original source cursor, producing real `400 INVALID_REQUEST`; read-only client restarts and enumerates the complete new 5-entry catalog with **1 restart**, no mixed snapshots.
3. Persistent injected HTTP 503 exhausts configured GET retry budget and throws `DISCOVERY_HTTP_EXHAUSTED`.

Initial local Node **v22.16.0** check executed **3/3 focused checks PASS**. The injected 503/429 statuses are deliberate engineering faults on the **real implementation**, not claims of production provider incidents. No payment simulator or artificial ledger receipt is presented.

## Consumer API

```js
import { fetchDiscoveryCatalog } from './recovery.mjs';
const readOnly = await fetchDiscoveryCatalog({
  baseUrl: 'https://your-authorized-bazaar-host/',
  query: 'forecast',
  network: 'stellar:testnet',
  scheme: 'exact',
  pageLimit: 25,
  timeoutMs: 1500,
  maxRetries: 3,
  maxRestarts: 2
});
console.log(readOnly.resources.length, readOnly.attempts, readOnly.restarts);
```

The example hostname is deliberately not a real deployed URL. Only provide an operator-trusted host; never let an arbitrary seller use it as an SSRF fetch proxy. The returned catalog identity is **not independently validated seller identity**, a signed payment term, an authorized wallet, or a receipt. The client does not access the ledger.

## Recovery / on-call decisions

| Outcome | Behavior |
| --- | --- |
| Catalog changed while paginating | Rerun entire original GET discovery snapshot; cap and report restarts |
| HTTP 429 / 502 / 503 / 504 | Retry GET only with deadlines, telemetry and abortable backoff |
| Network timeout | Retry safe discovery GET only, then fail visibly |
| Persistent errors / malformed payload | Reject with machine-readable error; no stale success claim |
| Payment indeterminate | **Out of scope**: reconcile authoritative facilitator / chain before ever retrying a charge |
| Multi-region real provider outage or Soroban sequence contention | Not measured by this local HTTP test; needs SF-41/Muse original-source provider traces and separate network/ledger integration |

## Next owner/Muse integration

SF-41/Muse: carry this exact public source and pinned core blob into **broad authentic original-source and, when authorized, real external-provider measurements**. Measure actual p50/p95 retrieval, catalog version churn, multiple-tenant resource bounds and breakdown of GET-only retry vs paid-settlement semantics; publish source corpus/checksums and methods. SF-33 own error contract and SF-36 spend-governor module remain separate; product integrator SF-46 should reconcile interfaces rather than merge competing owners' code without consent.

New code and focused tests carry MIT terms compatible with the parent public repo. No workflow or CI job was created or dispatched, no private repo write, no grant submission, no customer outreach, no wallet, no costs.
