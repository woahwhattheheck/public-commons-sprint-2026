# Agent Revenue Rail — The Graph purchase policy (lane B donor)

This package is the buyer-side intelligence seam for `ETHONLINE-AGENT-REVENUE-RAIL-20260913`.
It decides whether an agent should **BUY**, **SKIP**, or **HOLD** a metered work-intelligence report using live, standardized ERC-8004 agent evidence from The Graph plus an explicit budget/risk policy.

**Important competition boundary:** this directory is a donor carrier, not the final ETHOnline submission repository. The final Start-Fresh integrator should transplant/review the event-built files into the fresh public submission repo and preserve attribution/date history. No pre-event project-specific source was used here.

## Why The Graph is load-bearing

The live adapter queries the official Agent0 / ERC-8004 standardized Subgraph schema for:

- immutable agent identity (`chainId:agentId`) and owner;
- registration state, `x402Support`, and advertised trust models;
- non-revoked feedback, including proof-of-payment metadata when present;
- validation lifecycle and scores;
- `_meta` deployment, indexing-error flag, block number/hash/timestamp.

The policy engine will not silently fall back to mocks. Live authority is **out-of-band from evidence JSON**: callers pass a trusted `evidenceTransport` (`live_graph`, `fixture`, or the fail-closed default `untrusted`) separately from the evidence payload. A fixture file cannot promote itself by writing `sourceMode: "live_graph"`; the CLI pins fixture transport to `fixture` and live fetch transport to `live_graph`. With `requireLiveData=true` (the integration default), anything except trusted live transport plus matching live declaration produces `HOLD / LIVE_EVIDENCE_REQUIRED`. Receipts bind both trusted transport and declared source mode and never infer live qualification from file-controlled metadata alone.

## Decision contract

Input offer (`agent-revenue-offer/v1`) binds:

- exact seller ERC-8004 agent id;
- service key + exact HTTPS service URL + request SHA-256 commitment;
- currency and exact integer atomic price.

Input policy (`graph-purchase-policy/v1`) binds:

- exact integer remaining budget and maximum price;
- live capture / indexed block freshness windows and clock skew;
- x402 requirement and accepted trust models;
- minimum feedback count / mean score / paid-feedback count;
- minimum completed validation count / mean score.

Evidence problems are **HOLD**, not negative seller judgments: seller mismatch, paid-service origin not bound to an advertised Agent0 `web`/`mcp`/`a2a` endpoint, fixture/untrusted transport when live is required, trusted-transport/declaration mismatch, stale/future capture, stale/future Graph block, indexing errors, future feedback/validation rows, malformed schema, and conflicting duplicate evidence IDs. Authority-driving ISO instants must include an explicit RFC3339 timezone (`Z` or numeric offset); timezone-less timestamps are rejected before `Date.parse`, so the same bytes cannot change meaning with the host `TZ`.

Valid-but-unattractive offers are **SKIP**: wrong currency, over max/budget, inactive seller, no x402 capability, trust mismatch, or reputation/validation thresholds not met.

Only a fully bound and policy-satisfying packet returns **BUY**. `BUY` is still decision evidence only: every receipt hard-codes `payment=false`, `walletWrite=false`, `providerMutation=false`, and `submission=false`.

All money uses decimal strings parsed to `BigInt`; no binary floating-point arithmetic is allowed in purchase authority. Receipts are canonicalized and SHA-256 bound.

## Live usage

Create a The Graph API key, find the Agent0 subgraph deployment for the desired supported chain, and place the complete gateway URL in an environment variable. The URL is used for the request but **never emitted in a receipt**; the `/api/<key>/...` segment is stripped from `sourceRef`.

```bash
export GRAPH_ENDPOINT='https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/<SUBGRAPH_ID>'
node src/cli.mjs live \
  --endpoint-env GRAPH_ENDPOINT \
  --agent 84532:77 \
  --offer ./offer.json \
  --policy ./policy.json
```

The adapter deliberately permits only public HTTPS `gateway.thegraph.com/.../subgraphs/id/...` endpoints. It performs no wallet or payment action.

### ETHOnline chain split (verified 2026-09-13)

For the runnable hackathon integration, use Agent0 on **Base Sepolia (chain 84532)** for trust evidence and Hedera Testnet for the independent x402 payment lane. Agent0's current public subgraph README lists Base Sepolia as deployed at Subgraph ID `4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u`, while the same current README marks Hedera Testnet (296) as contracts-not-deployed; Agent0's deployment guide calls Hedera only `Ready`, not `Deployed`. Do not treat the generic deployment manifest's `status: prod` as proof of a live Hedera endpoint.

Use a submission-owned Graph API key rather than copying the shared key embedded in Agent0 SDK defaults:

```bash
export GRAPH_ENDPOINT='https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u'
```

Pinned upstream observations: `agent0lab/subgraph@909a9d4518432c641e06fdb731b480fb0e9340dd` (`README.md`, `schema.graphql`, `deployments/deployment_guide.md`). Re-verify before final demo because deployment state can change.

The offer's `serviceUrl` is part of the signed/digested decision input and must be HTTPS with no credentials or fragment. The policy only reaches `BUY` when that URL's origin equals the origin of at least one Agent0-advertised `webEndpoint`, `mcpEndpoint`, or `a2aEndpoint`. This prevents borrowing a reputable agent ID to authorize payment to an unrelated domain. Lane A must consume the exact `serviceUrl` from the receipt-bound offer; it must not swap the paid endpoint after the decision.

## Lane A integration

```text
x402 seller advertises work-intelligence report + exact atomic price
        |
        v
lane B: fetch live Agent0 evidence from The Graph
        |
        v
lane B: deterministic BUY / SKIP / HOLD + receiptDigest
        |
        +---- SKIP/HOLD --> no payment attempt
        |
        `---- BUY -------> lane A may attempt its independently guarded Hedera/Blocky402 testnet payment
```

Lane A should bind its x402 request to `offerDigest`, `policyDigest`, `evidenceDigest`, and `receiptDigest`, and should reject any receipt whose `authority.payment` is not exactly `false` before applying its own payment authority checks. Lane B never claims that a payment happened.

## Tests

```bash
npm test
node --test
```

The hostile suite covers exact integers beyond `Number.MAX_SAFE_INTEGER`, stale/future evidence, Graph indexing errors, cross-seller evidence, out-of-band fixture-vs-live transport authority (including a forged `sourceMode` through the real CLI), explicit-timezone enforcement and cross-host-`TZ` digest determinism, paid-service origin binding, malformed registered endpoints, conflicting duplicate observations, order-independent receipts, budget/price enforcement, x402/trust/reputation/validation thresholds, API-key redaction, endpoint SSRF-style refusal, malformed provider fields, and GraphQL failure handling.

## Remaining qualification work

The Graph track requires a live provider query in the runnable demo; frozen fixtures alone do not qualify. The Hedera track separately requires lane A to host a live x402-gated service on Hedera testnet or mainnet and complete a real paid request. This package supplies the decision intelligence and evidence binding only; it does not fake either requirement.
