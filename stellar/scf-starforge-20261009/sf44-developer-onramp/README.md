# SF-44: Stellar Bazaar developer onramp

**Runnability:** Node.js 22+ standard-library developer kit against the **actual shipped** [PR451 public Bazaar discovery core](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/451), imported from `../../../scf46-stellar-bazaar/src/catalog.mjs`. Pinned source Git blob `f34f38a3af8f1b9e23ff4607812b4ee6297480a5`, checked at runtime.

**Important:** This is a REAL local HTTP exercise of the existing discovery code, not a Stellar payment facilitator or a live testnet seller. No wallet, payment, ledger, settlement, seller validation, SCF application, or charge occurs. A deliberately invalid wallet recipient makes the fixture non-payable.

## Operator: zero-install cold start

From repository root with Node.js 22+:

```bash
node stellar/scf-starforge-20261009/sf44-developer-onramp/onboard.mjs
```

The command starts a new loopback HTTP server bound to `127.0.0.1` on an ephemeral port, explicitly seeds one **UNVERIFIED local development fixture**, makes two actual GET requests to the **original** Bazaar catalog endpoints, returns the observed HTTP statuses, network/scheme/recipient terms, local execution timings and current exact source Git SHA, then closes. Receipt fields `buyerAutoPayment:false`, `settlementReceipt:null` and `elapsedMsToFirstPaidEndpoint:null` make the status explicit.

## Actual curl interface

Run the same original server and keep it open for your HTTP client:

```bash
node stellar/scf-starforge-20261009/sf44-developer-onramp/onboard.mjs serve
# Capture baseUrl from the printed JSON and replace PORT below with its actual port.
curl -i 'http://127.0.0.1:PORT/discovery/resources?network=stellar%3Atestnet&type=http'
curl -i 'http://127.0.0.1:PORT/discovery/search?query=weather&network=stellar%3Atestnet'
curl -i 'http://127.0.0.1:PORT/discovery/search'  # missing required query => HTTP 400
curl -i -X POST 'http://127.0.0.1:PORT/discovery/resources' # read-only => HTTP 405
```

Exit the dev server with Ctrl-C. This cloud container's genuine curl readback: **resources GET 200**, **search GET 200**, **missing-query GET 400**, **POST 405**. Returned search count **1** (untrusted fixture), network `stellar:testnet`, recipient `INVALID_DEMO_RECIPIENT_NOT_A_WALLET`. These are native PR451 source HTTP handlers, not a mock interface.

## Seller / buyer / agent / operator contract

| Role | Implementation now | Missing before actual commerce |
| --- | --- | --- |
| Seller | Compose an HTTP or MCP discovery envelope: `resource.url`, `accepts[]`, `extensions.bazaar.info.input`; HTTP `method`, MCP `toolName` and `inputSchema` | There is **no public seller POST**. Authenticate the seller, recipient binding, original settlement and full Bazaar schema first; **only then** invoke trusted `BazaarCatalog.insertValidated` |
| Buyer | `GET /discovery/resources`, filter on `type`, `network`, `scheme`, `payTo`, `extensions`, with `offset`/`limit` (limit maximum 100) | Never infer seller ownership, price, asset, authenticity or payment permission from the dev catalog metadata; this starter cannot spend |
| Agent | `GET /discovery/search?query=...`, optional network/scheme, cursor pagination; inspect returned `accepts[]` and HTTP vs MCP resource type | Ordinary MCP tool client, live paid HTTP 402, policy-bounded signer, automatic retry, onchain receipt and tool output are **not implemented** in this starter |
| Operator | Reproducible loopback discovery, source blob pin, list/search timing, HTTP response and error observation, Ctrl-C shutdown | TLS, auth, verified-payment hooks, persistent index, rate limits, incident metrics, source/license provenance, backup/rollback and deployed server are separate product tasks |

The source currently indexes MCP catalog identity with resource URL plus tool name. It does not expose a working MCP server or execute MCP calls. The dev fixture is `type=http`, **not** an MCP integration. A production integration must adhere to the actual latest pinned [x402 Foundation](https://github.com/x402-foundation/x402) and [Stellar SDK](https://github.com/stellar/x402-stellar) contracts; SF-04 owns independent dependency selection.

## Recovery decision rules

1. HTTP **400** or stale cursor: correct query, network/limit or restart pagination from the changed catalog version.
2. HTTP **405**: this is a read-only endpoint; no public POST registration or settlement.
3. HTTP **404**: check path; PR451 implements only `/discovery/resources` and `/discovery/search`.
4. Unsupported network/scheme or wrong recipient: **decline**. Discovered `payTo` metadata alone never establishes ownership, verified dollar price or signer permission.
5. Timeout/connection loss: fail visibly, retry *discovery* if policy allows, do not invent successful charges or receipts.
6. Future indeterminate payment outcome (not available in this kit): reconcile authoritative facilitator/ledger receipt **before** another charge attempt. Never blindly retry a paid operation.

## Source-exact focused validation and measured cold start

```bash
node --test stellar/scf-starforge-20261009/sf44-developer-onramp/test/onboard.test.mjs
```

The focused check uses the actual imported PR451 Node source with loopback network requests, confirms both success responses and rejected unauthorized operations, checks testnet-vs-pubnet, and verifies source Git SHA. On Node **v22.16.0**, initial cloud-container result was **2/2 passed**, with measured **~30ms from process call to first local discoverable fixture** after real requests; this is **not** time to a paid endpoint (unavailable), not an external provider benchmark, not a product rollout.

## Product continuation for SF-43 / SF-46

A true funded-RFP demo still needs (1) current official protocol/version/network, (2) genuinely x402-protected **seller** endpoint returning authentic 402 and verified terms, (3) trustworthy seller identity and settlement→schema validation→catalog ingestion, (4) ordinary MCP buyer discovery and tool invocation **without hard-coded endpoint**, (5) explicit wallet consent/budget policies and genuine controlled testnet transaction receipts, (6) independent full onboarding on second fresh environment. None of those six are silently satisfied by this module. Grant submission remains on **OWNER HOLD**; the [published historical RFP](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track) is labeled Q3/SCF #45, not verified #46.

New SF-44 source: MIT; baseline discovery component and the public repo already carry their own MIT terms. No new GitHub workflows, GitHub Actions dispatch, private source import, payments, cloud purchases, external outreach or forms.
