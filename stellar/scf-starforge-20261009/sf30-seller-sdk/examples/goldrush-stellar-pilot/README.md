# GoldRush provider-owned Stellar wallet-data pilot

This integration prepares a **separate provider-owned Stellar merchant** for two existing GoldRush wallet operations. It composes the maintained SF61 importer, SF30 upstream merchant and generated client, and SF88 Node/Python Buyer. It contains no replacement payment, settlement, query, retry, ledger or recovery engine.

GoldRush's observed x402 endpoint currently advertises **Base Sepolia (`eip155:84532`)**. This implementation is **not a drop-in extension for those existing clients**. Customers use the generated SF30 client and the maintained native Buyer/operator path described below. Stellar is the new merchant's payment network; the data continues to describe supported EVM chains. Provider authorization, production deployment and paid acceptance have not been obtained by preparing these files.

## Implemented scope

| Operation | Native public path | Exact GoldRush upstream path | Inputs |
| --- | --- | --- | --- |
| Token balances | `/v1/{chainName}/address/{walletAddress}/balances_v2` | Same path with a final `/` | Explicit chain and hexadecimal wallet; optional quote currency and `no-spam` |
| Token transfers | `/v1/{chainName}/address/{walletAddress}/transfers_v2` | Same path with a final `/` | Explicit chain, wallet, `contract-address`, `page-size` and zero-based `page-number`; optional quote currency |

The provider selects a subset of `eth-mainnet`, `base-mainnet` and `arbitrum-mainnet`. Wallet and token addresses are exactly 40 hexadecimal digits after `0x`. ENS resolution and other provider routes are outside this pilot. Each transfer page contains at most the provider-selected limit, which cannot exceed 100 items. **There is no automatic pagination or 100-page limit.**

The public trailing-slash normalization is required by the existing SF30 dynamic router. The original upstream binding preserves the provider API's slash. Optional `starting-block` and `ending-block` filters are deliberately omitted: independently valid numbers do not prove a valid ordered range. Original live admission rejects unknown parameters before the native paid handler. The customer request command also invokes that same admission offline.

The full supported schema assertions are retained in `source/*-source.openapi.json`; descriptive prose and examples are omitted from that projection. `source/source-manifest.json` records the original first-party document hashes, converted schema hashes, projection hashes and local retention times. The compiled response contract preserves those assertions under the official REST envelope and requires `error: false`, the wallet identity fields and the original item structure. Token amounts stay decimal strings.

## Source observations

The actual free `GET https://x402.goldrush.dev/v1/x402/endpoints` returned HTTP 200 on 2026-10-11, server time 18:57:17 UTC: 71,078 bytes, SHA-256 `32bb735f15862a8246f1bdbdf74526fde4b388a4e613d3f0d158996516785450`, with 54 endpoint entries. `source/discovery-catalog.json` retains the two selected machine-readable contracts and payment/pricing metadata. `source/discovery-receipt.json` records the projection's relationship to that raw response. The successful free endpoint-detail responses matched both selected routes. The obsolete `get-recent-transactions-for-address` detail returned 404 and is not implemented.

The observed Base catalog minimum for balances was `$0.000100`; prose credit arithmetic alone is not a complete quote. **The new Stellar prices come only from the provider's explicit plan.** No Base amount, payout address, facilitator, tier or rate is automatically converted into new Stellar payment terms.

Primary sources:

- [GoldRush x402 integration invitation](https://goldrush.dev/blog/goldrush-x402-blockchain-data-for-agents/)
- [Current x402 overview](https://goldrush.dev/docs/goldrush-x402/overview)
- [Token balances contract](https://goldrush.dev/docs/api-reference/foundational-api/balances/get-token-balances-for-address)
- [Token transfers contract](https://goldrush.dev/docs/api-reference/foundational-api/balances/get-erc20-token-transfers-for-address)
- [Published SDK 3.0.7](https://www.npmjs.com/package/@covalenthq/client-sdk/v/3.0.7), whose REST parser reads the original `data`/`error` envelope. This adapter calls the existing upstream HTTP handler rather than introducing the SDK's automatic transfer-page iterator.

## Runtime and private inputs

Use the existing maintained Commons/StarForge installation, including the original SF25 `re2js` dependency, SF61/SF30 runtime and SF88 Node/Python packages. This adapter adds no dependency installation. Node 22+ and the maintained Python Buyer package are required for their respective commands. The source composition was developed against native commit `cfbd57dcd659a50621729438ce604aaae7a32787`.

Set `STARFORGE_SOURCE_ROOT` to the **current installed source root**. In a full repository the default resolves there automatically. In an installed archive, pass its `source` root explicitly. Examples below run from this partner directory. The release itself is portable: `inspect` derives commands from its current release location and current source root, not the machine which prepared it.

Copy `plan.example.json` to a private operator path and select the provider-controlled public HTTPS origin, allowed chains, page limit and each operation's complete native Stellar `accepts` tuples. The example contains conspicuous **non-payable asset/recipient placeholders** and illustrative atomic quantities. It is suitable for unsigned preparation only. Replace them with provider-approved network, SEP-41 contract, recipient, price and timeout before any live operation. Never infer an asset's decimal scale or equivalent fiat price.

`credentialEnv` is the **name** of an environment variable containing the complete upstream `Bearer …` header. Its value is supplied by the provider's existing secret manager to the original SF30 process. It is never put into the plan, release, browser, generated client or source repository. The provider retains its GoldRush account, subscription, key and data rights. Rotate by restarting the original upstream process with the new secret; startup captures a stable credential snapshot.

## Prepare the merchant and customer export

Refresh the free catalog if desired; the fixed discovery URL does not require a key or payment:

```sh
node pilot.mjs discover --out /absolute/private/new-discovery \
  --source-root "$STARFORGE_SOURCE_ROOT"
```

For a managed proxy, add `--proxy-env HTTPS_PROXY`. This passes the environment **name** to the original SF31 explicit CONNECT transport, pinned to the discovery origin. It does not publish the proxy value. The default path remains the original direct transport.

Prepare against the actual retained free catalog or the included selected projection:

```sh
node pilot.mjs prepare --plan /absolute/private/provider-plan.json \
  --catalog /absolute/private/new-discovery/catalog.json \
  --out /absolute/private/new-release --source-root "$STARFORGE_SOURCE_ROOT"
node pilot.mjs inspect --release /absolute/private/new-release \
  --source-root "$STARFORGE_SOURCE_ROOT"
```

Preparation creates only a new directory. It writes the provider plan, exact input schemas, original SF61 `offers.json`/`seller-service.json`/`upstreams.json`/manifest, and the original SF30 OpenAPI, generated JavaScript client, TypeScript declarations and package guide. Hashes bind the native customer client and original source inputs. It reads no credential or wallet and invokes no backend or facilitator.

Run the `check` argument array printed by `inspect` after the provider injects the named Bearer secret. It invokes the original `upstream-serve.mjs --check`: configuration, original offers, response contracts, credential presence and mappings are checked without listening or calling the provider. Run the printed `serve` array to launch the original upstream seller with the existing private operations dashboard. Inspect its returned loopback URLs for health, readiness, offers, developer API and operations controls. Keep the operations endpoint private and use the original control/credential guidance.

Without `--facilitator`, the merchant is explicitly **CHALLENGE_ONLY**. It can publish native payment requirements but cannot authenticate, settle or deliver a paid provider request. A provider-owned production configuration adds its selected `--facilitator HTTPS_URL` to the original seller arguments and uses the original native x402 dependencies. Deployment/TLS, source entitlement, provider credit limits and a separately approved transaction budget remain provider inputs.

## Customer request, review, execution and reopen

Edit a copy of `balances.inputs.json` or `transfers.inputs.json`. Query values are strings because they represent exact URL parameters. Author one request through the original generated client:

```sh
node customer.mjs request --release /absolute/private/new-release \
  --operation transfers --inputs /absolute/private/transfers-inputs.json \
  --intent customer-transfers-page-0 --accept 0 --max-atomic 100000 \
  --out /absolute/private/transfers-request.json --source-root "$STARFORGE_SOURCE_ROOT"
```

The output is an ordinary SF88 configuration, with the exact public URL, selected network, asset, recipient, timeout and explicit atomic ceiling. Input checks use original SF89 admission. There is no discovery substitution, price change, key read or payment.

The default payment flow is `authorization`. If the chosen provider tuple explicitly advertises `upfront`, pass `--payment-flow upfront`; the original generated client requires it to match. It never silently changes the quoted flow.

### Node application

An existing original operator workspace can be adopted directly, including an explicitly authored request for a new page:

```sh
node customer.mjs prepare --workspace /absolute/private/operator-workspace \
  --config /absolute/private/transfers-request.json --state /absolute/private/node-customer \
  --source-root "$STARFORGE_SOURCE_ROOT"
```

The maintained `Buyer.fromWorkspace` uses the original native workspace binding. It preserves the request's explicit terms and intent, original policy/ledger/evidence and selected transport; the atomic ceiling must fit the current workspace and signer caps. Its private operator keys stay in the original child. Omit `--config` to retain the workspace's current operation. `--profile` cannot accompany `--workspace`. Original signer prerequisites and the controlling terminal are checked before the application's permanent attempt; the manifest's selected evidence RPC follows the same native execution.

For an independently supplied original profile, the existing configuration route remains available:

```sh
node customer.mjs prepare --config /absolute/private/transfers-request.json \
  --state /absolute/private/node-customer --profile /absolute/private/operator-profile.json \
  --source-root "$STARFORGE_SOURCE_ROOT"
node customer.mjs review --state /absolute/private/node-customer \
  --intent customer-transfers-page-0 --source-root "$STARFORGE_SOURCE_ROOT"
```

In the `--config` route without a workspace, `--profile` is optional for offline preparation. For execution, use an established original operator profile containing the original policy/ledger/interpreter/actor/service paths, signer module, payer and any native transport settings. The original SF36 keys (`SF36_CONSENT_KEY_B64`, `SF36_AUDIT_KEY_B64`, `SF36_OPERATOR_KEY_B64`) and the signer's own wallet environment must be supplied to that operator process through its existing private environment. A workspace's `operator-keys.json` is not a profile or a public artifact. The Node SDK owns its own application evidence/response destination and refuses injected approval/sign callbacks.

Only the following explicit command starts the original terminal approval and buyer attempt:

```sh
node customer.mjs execute --state /absolute/private/node-customer \
  --intent customer-transfers-page-0 --source-root "$STARFORGE_SOURCE_ROOT"
```

It requires the original controlling terminal, current provider configuration and operator policy. After interruption or completion, run `recover` with the same arguments instead of `execute`. The maintained SDK preserves its immutable input/config hashes, permanent attempt marker, original terminal outcome and hash-bound response. A missing recoverable result is reported as missing; it does not authorize a retry.

### Python application

Use the maintained installed Python package, or its original package directory on `PYTHONPATH` as supported by that runtime. The same authored request can be imported by Python instead of Node:

```sh
python customer.py --checkout "$STARFORGE_SOURCE_ROOT" --state /absolute/private/python-customer \
  prepare --config /absolute/private/transfers-request.json --profile /absolute/private/operator-profile.json
python customer.py --checkout "$STARFORGE_SOURCE_ROOT" --state /absolute/private/python-customer \
  review --intent customer-transfers-page-0
```

For an original SF88 workspace, use `prepare --workspace /absolute/private/operator-workspace`; the native Python bridge retains its binding and keeps workspace keys in Node. The original `cli.mjs --init-workspace` creates that workspace from the authored request and explicit payer, actor, service, interpreter, total and daily budgets; `--review-workspace` and `--diagnose-workspace` show its current setup. Use the original CLI's documented flags and actual provider terms. This adapter creates no wallet or operator policy of its own.

Python's `execute --intent …` and `recover --intent …` have the same explicit distinction. Choose one SDK application state for a purchase; creating two prepared examples does not authorize two purchases. The public examples intentionally do not move, delete or restore a populated customer state automatically.

### Read the result and continue one page

Both examples report the original native status, HTTP status, delivery metadata and runtime error. They display wallet data only after native success and original **SAVED** response hash verification, and require returned chain/address to match the retained request. Raw token quantities are not converted to floating-point numbers.

`providerRead` separately reports `NOT_READ`, `READ` or `FAILED`. A saved-file verification, JSON or wallet-identity error leaves the original operation status and delivery visible and reports a bounded interpretation error code; it does not authorize a retry. `next-page` refuses an invalid prior response.

For a successful retained Node transfer result, `next-page` checks that returned `page_number` and `page_size` match the original request and that `has_more` is true. It writes one new request with the same wallet/contract/chain/currency/page size and payment pins, a new explicit intent and a newly supplied ceiling:

```sh
node customer.mjs next-page --state /absolute/private/node-customer \
  --intent customer-transfers-page-0 --next-intent customer-transfers-page-1 \
  --max-atomic 100000 --out /absolute/private/transfers-page-1.json \
  --source-root "$STARFORGE_SOURCE_ROOT"
```

Prepare that file with `--workspace /absolute/private/operator-workspace --config /absolute/private/transfers-page-1.json`, using the same Node application state; then review its new intent before choosing to execute it. The original workspace binding keeps the operator and total/daily ledger budgets shared across those explicit pages. The command performs no purchase. Since the provider dataset can change between requests, page continuation does not claim a consistent historical snapshot or complete wallet history.

## Failure, throughput and recovery behavior

Each operation uses one original upstream GET with a **20-second deadline, 1 MiB response cap and four in-flight requests per binding**. The two bindings do not establish a provider-account rate limit. The provider must provision account limits appropriate to its deployment. The observed free discovery gateway's 100 requests/minute policy is not assumed to be the authenticated data subscription's limit.

Provider errors, 429/rate limits, non-success status, timeout, redirect rejection, oversized bodies and contract mismatch are handled by the original upstream runtime. They are not reported as complete wallet results. No automatic provider retry, tier escalation, additional page, new intent or payment is added. Live admission happens before the paid handler, but an upstream failure may occur after a native payment attempt has begun; inspect the original buyer result and ledger before deciding what happened. A saved body alone is not settlement finality.

Use the existing merchant operations view for readiness, bounded concurrency and original failure counters. Use the original Buyer `inspect`/native inbox, ledger and history for customer state; no separate accounting table is introduced here. The shipped Node `workspaceRecovery()` and Python `workspace_recovery()` APIs and their original `examples/recover_workspace.*` implement inspect, snapshot, verify and authenticated restore. Snapshot the selected original workspace plus the relevant Node/Python application directory. Restore only into the destination accepted by that original engine and reopen the same intent IDs. Do not rerun an uncertain purchase to rebuild state.

## Provider handoff and acceptance

The engineering deliverable is the two bound routes, their actual source receipts, original compiled merchant/client output, private credential interface, customer request/review/reopen examples, operations instructions and original recovery path. Paid acceptance requires provider-supplied account/data rights, origin, permitted routes/chains, valid key, exact Stellar terms, test payer and an approved budget. It includes one provider-approved end-to-end merchant-to-buyer workflow and final operator handoff under the separately agreed commercial scope.

No new GoldRush data call, subscription purchase, wallet, chain payment or customer deployment is implied by the included unpaid preparation workflow. The actual native preparation/challenge/reopen result is recorded separately with its original source commit and retained free-catalog digest.

## Reproduce the unpaid native walkthrough

An existing SCF host can run the whole original preparation/challenge/reopen path with the included retained source projection. This uses a new private output directory and the existing installed runtime; no external data API or facilitator is contacted.

```sh
node unpaid-demo.mjs --out /absolute/private/new-goldrush-walkthrough \
  --python /absolute/existing/python3 --source-root "$STARFORGE_SOURCE_ROOT"
```

The accepted run completed at **2026-10-11 19:29:58 UTC** against the original `cfbd57d` source closure and existing `re2js` 2.8.6. The original HTTP listener returned health 200, OpenAPI 200, and both route challenges 402. The original Node application retained `goldrush-unpaid-balances`; Python retained `goldrush-unpaid-transfers`. New processes reopened their reviews and correctly returned `ORIGINAL_RESULT_NOT_RECORDED` on recovery. Both original upstream counters had `started: 0`, `completed: 0` and `responseBytes: 0`. Provider data requests, facilitator requests, wallet approvals and payments were all zero. The walkthrough's own `result.json` retains the actual original observations and application identities; it creates no paid result or synthetic ledger.

## Retained wallet workspace

The complete local wallet application is available through `customer.mjs workbench`. It joins the original generated client, Node Buyer/Inbox and Resource library for request preparation, operator review, execution/recovery, exact balance and transfer views, compatible response comparisons, saved analyst notes and exports. Read [WALLET-WORKSPACE.md](WALLET-WORKSPACE.md) for setup and the operating workflow.
