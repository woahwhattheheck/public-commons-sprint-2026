# SF-44: Stellar Bazaar developer onramp

**Runnability:** Node.js 22+ standard-library developer kit against the **actual shipped** [PR451 public Bazaar discovery core](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/451), imported from `../../../scf46-stellar-bazaar/src/catalog.mjs`. Pinned source Git blob `0f95a2f3c95d10ef6e8410d10f2ba24a7c9a44de`, checked at runtime.

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


## Post-release: source-exact Bazaar → MCP agent onramp

The prior SF44 exact-source pin went stale when PR451's real Bazaar catalog evolved under SF23/SF28. This onramp now pins the **current main** Git object `0f95a2f3c95d10ef6e8410d10f2ba24a7c9a44de`; the original source check otherwise failed against the current imported file. The local-only fixture has explicit deliberately NONPAYABLE terms `amount=10000`, `asset=NONPAYABLE_DEMO_ASSET`, `payTo=INVALID_DEMO_RECIPIENT_NOT_A_WALLET` for read-only MCP price preview. These are not Stellar asset or recipient values.

The additive `mcp-onramp.mjs` actually composes TWO accepted original source engines, not replacements: PR451/SF23's real HTTP Bazaar catalog and SF32's Streamable HTTP MCP JSON-RPC server. It launches ephemeral loopback servers, sends genuine `initialize`, `tools/list`, `bazaar_search` (which performs an original catalog GET), `bazaar_preview`, denied `bazaar_execute_approved`, `bazaar_status`, `bazaar_cancel`, deliberately unwired `sf43_discover_review_and_pay`, and an anonymous request refused with HTTP 401. Its outbound request adapter permits ONLY local discovery; even future accidental callbacks cannot access a merchant from this demo. One random bearer stays in the client closure, never in the printed receipt.

From the PUBLIC repo root, Node.js 22+, no install or wallet:

```bash
node stellar/scf-starforge-20261009/sf44-developer-onramp/mcp-onramp.mjs
```

Targeted native Node check (no hosted GitHub Actions):

```bash
node --test stellar/scf-starforge-20261009/sf44-developer-onramp/test/mcp-onramp.test.mjs
```

**Executable acceptance contract**: actual source-backed 1-result catalog search, MCP 2025-11-25 tools discovery, sample price `PREVIEWED`, absent-signer rejection `SIGNER_NOT_CONNECTED` without a paid request, quote remains `PREVIEWED` until `CANCELLED`, SF43 refusal `AGENT_COMMERCE_UNAVAILABLE`, anonymous HTTP 401, one local catalog GET, zero merchant HTTP requests, no blockchain transaction. The CLI prints its actual measured result when run; this README does not claim a provider-backed live payment.

**Payable integration remains separate:** SF43 and authorized existing local/Muse operators own genuine seller 402, official Stellar testnet signature, confirmed token transfer/ledger receipt and independent fulfillment proof. This SF44 local demo never invokes the seller, has no signer/approval callback, cannot register a real paid listing, and cannot satisfy a funded-RFP award by itself. No mainnet, merchant charge, production deployment, SCF interest/application, buyer outreach, private repository, CI or GitHub Actions involved.


## Current-source drift: explicit LOCAL-only recovery (2026-10-10)

The Bazaar catalog has already evolved since the original SF44 source release. Its current
accepted first-party Git blob at this update is `0f95a2f3c95d10ef6e8410d10f2ba24a7c9a44de`.
A prior exact pin became stale after another accepted catalog security repair, causing
the original MCP onboarding process to abort before the live local exercises.

**Default:** `node stellar/scf-starforge-20261009/sf44-developer-onramp/mcp-onramp.mjs`
requires the recorded exact Git blob to match the imported file. If a later merge
changes it, inspect the actual first-party source change and review its legitimacy.

**Explicit no-wallet developer path (only after inspection):**

```sh
node stellar/scf-starforge-20261009/sf44-developer-onramp/mcp-onramp.mjs --allow-unpinned-local-source
```

That switch relaxes **only the source-pin precheck for the local, deliberately
nonpayable fixture**. It neither wires approval/signing nor changes loopback
binding, bearer authentication, nonpayable recipient/asset or the outbound
merchant-blocking adapter. Receipt `originalSources.sourcePolicy` is
`PIN_MATCH` or `UNPINNED_LOCAL_OPT_IN`; the latter is not evidence that
new source has been reviewed. Neither mode proves payment, network settlement,
a production service, SCF eligibility or grant submission.

Focused original-source check:
`node --test stellar/scf-starforge-20261009/sf44-developer-onramp/test/mcp-onramp.test.mjs`.
The original end-to-end case exercises genuine current Bazaar + SF32 modules; the
extra pin-policy case checks strict rejection and explicit local-only opt-in.
