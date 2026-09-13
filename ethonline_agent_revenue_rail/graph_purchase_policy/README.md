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

The policy engine will not silently fall back to mocks. With `requireLiveData=true` (the integration default), fixture evidence produces `HOLD / LIVE_EVIDENCE_REQUIRED`. Tests can deliberately set `requireLiveData=false`, but every receipt still records `fixtureOnly=true` and `prizeEligibilityClaimed=false`.

## Decision contract

Input offer (`agent-revenue-offer/v1`) binds:

- exact seller ERC-8004 agent id;
- service key + request SHA-256 commitment;
- currency and exact integer atomic price.

Input policy (`graph-purchase-policy/v1`) binds:

- exact integer remaining budget and maximum price;
- live capture / indexed block freshness windows and clock skew;
- x402 requirement and accepted trust models;
- minimum feedback count / mean score / paid-feedback count;
- minimum completed validation count / mean score.

Evidence problems are **HOLD**, not negative seller judgments: seller mismatch, fixture when live is required, stale/future capture, stale/future Graph block, indexing errors, future feedback/validation rows, malformed schema, and conflicting duplicate evidence IDs.

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

The hostile suite covers exact integers beyond `Number.MAX_SAFE_INTEGER`, stale/future evidence, Graph indexing errors, cross-seller evidence, fixture-vs-live qualification, conflicting duplicate observations, order-independent receipts, budget/price enforcement, x402/trust/reputation/validation thresholds, API-key redaction, endpoint SSRF-style refusal, and GraphQL failure handling.

## Remaining qualification work

The Graph track requires a live provider query in the runnable demo; frozen fixtures alone do not qualify. The Hedera track separately requires lane A to host a live x402-gated service on Hedera testnet or mainnet and complete a real paid request. This package supplies the decision intelligence and evidence binding only; it does not fake either requirement.
