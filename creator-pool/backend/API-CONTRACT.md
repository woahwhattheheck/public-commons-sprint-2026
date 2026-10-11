# Creator Pool API contract (frontend)

Base URL: same origin as the served `web/` app. The default local address is `http://127.0.0.1:8787`.

## Request and response conventions

- Every request body is JSON (`content-type: application/json`) and must be 32 KB or smaller.
- Every amount is an integer **atomic-unit string**. Use `asset.decimals` for display only. Never do float math on money.
- `operationId` is optional on every POST. Use 8-100 characters from `[A-Za-z0-9._:-]`.
  - Repeating an operationId returns the stored result with `replayed: true`. It never sends a second payment.
  - Without an operationId, the server derives one from the parameters. For example, approving submission 3 twice returns the first result.
  - To create two campaigns with identical fields, send distinct operationIds.
- Errors return `{ "error": "code", "detail": ... }`.
  - 400: invalid input.
  - 403: wrong actor.
  - 404: not found.
  - 409 `chain_rejected`: the contract refused, and `detail` gives the reason. Examples: `insufficient available budget`, `not claimable`, `closed`, `deadline passed`.
  - 409 `operation_unknown_send_state` or `tx_pending_reconcile`: a transaction may already be in flight. Do not auto-retry with a new id. Re-read `/api/state` first.
  - 413: body too large.
  - 415: content type is not JSON.

## Modes

- `mode: "local"`: the server signs with unlocked loopback Ganache demo actors (`sponsor`, `creatorA`, `creatorB`).
  - This actor picker is for the demo only and is not login. Label it that way.
- `mode: "public"`: `actors` and `balances` are `null`, and every POST except `/api/reconcile` returns **202** with this shape:
  `{ "status": "wallet_signature_required", "chainId": "84532", "transactions": [{ "label": "fund", "to": "0x…", "data": "0x…", "value": "0" }] }`
  - The connected wallet signs and broadcasts each transaction in order.
  - Then POST `/api/reconcile { "txHash": "0x…" }` so the server attaches titles, briefs and URLs to the on-chain ids.
  - The contract checks the actual sender. The server never trusts a role string.

## Routes

| Method | Path | Body | Success (local) |
|---|---|---|---|
| GET | /api/state | — | full state (below) |
| POST | /api/campaigns | `title, brief, budgetAtomic, rewardAtomic, deadline` (ISO or unix-seconds string, 5 minutes to 400 days ahead) | `{ operationId, campaign, tx }` |
| POST | /api/campaigns/:id/fund | optional `amountAtomic` (defaults to the unfunded remainder) | `{ operationId, campaign, txs: [allowance?, fund] }` |
| POST | /api/campaigns/:id/submissions | `creator` (`creatorA` or `creatorB` in local mode), `title, workUrl, notes` | `{ operationId, submission, tx }` |
| POST | /api/submissions/:id/approve | — (sponsor only) | `{ operationId, submission, campaign, tx }` |
| POST | /api/submissions/:id/claim | optional `actor`, which must be the submission's creator | `{ operationId, submission, campaign, creatorBalanceAtomic, tx }` |
| POST | /api/campaigns/:id/close | — (sponsor only) | `{ operationId, refundedAtomic, campaign, tx }` |
| POST | /api/reconcile | `txHash` | `{ txHash, blockNumber, events }` |

## Campaign and submission rules

- A campaign's `status` is `open`, `deadline_passed` or `closed`.
  - Funding and new submissions are allowed only while `open`.
  - Approval is allowed until `closed`.
  - Approved rewards stay claimable after close.
- A submission's `status` is `submitted`, `approved` or `claimed`.
- `title`, `brief`, `workUrl` and `notes` are `null` with `metadataMatches: false` when the server has no matching off-chain metadata. Show them as "details unavailable" in that case.
- Render all user text as text, never HTML.

## Example `GET /api/state`

This is the shape only. All chain values come from one reported block. Local metadata and the pending operation journal are joined when the response is built.

```json
{
  "mode": "local",
  "network": { "name": "Local Ganache EVM (development only)", "chainId": "1337" },
  "asset": { "address": "0x…", "name": "Creator Pool Demo Token (local, non-monetary)", "symbol": "CPDEMO", "decimals": 6, "nonMonetaryDemo": true },
  "decimals": 6,
  "contracts": { "pool": "0x…", "token": "0x…" },
  "actors": { "sponsor": "0x…", "creatorA": "0x…", "creatorB": "0x…" },
  "actorNotice": "Local demo actors (unlocked Ganache accounts). Not authentication.",
  "balances": { "sponsor": "999750000000", "creatorA": "100000000", "creatorB": "0" },
  "poolBalanceAtomic": "100000000",
  "blockNumber": 12,
  "blockTime": "2026-10-12T10:00:00.000Z",
  "campaigns": [{
    "id": "1", "sponsor": "0x…", "sponsorActor": "sponsor", "token": "0x…",
    "title": "Launch clip", "brief": "One original 30-60s clip…", "metadataMatches": true,
    "rewardAtomic": "100000000", "budgetAtomic": "250000000",
    "deadline": "2026-10-20T00:00:00.000Z", "deadlineUnix": "1792454400",
    "closed": false, "status": "open",
    "fundedAtomic": "250000000", "unfundedAtomic": "0", "availableAtomic": "50000000",
    "reservedAtomic": "100000000", "committedAtomic": "200000000", "paidAtomic": "100000000", "refundedAtomic": "0",
    "remainingApprovals": "0", "createTx": "0x…",
    "txs": { "CampaignCreated": ["0x…"], "CampaignFunded": ["0x…"] }
  }],
  "submissions": [{
    "id": "1", "campaignId": "1", "creator": "0x…", "creatorActor": "creatorA",
    "title": "Trail clip", "workUrl": "https://example.com/v/1", "notes": "…", "metadataMatches": true,
    "status": "claimed",
    "txs": { "SubmissionCreated": "0x…", "SubmissionApproved": "0x…", "RewardClaimed": "0x…" }
  }],
  "ledger": [{ "id": "0x…:0", "txHash": "0x…", "logIndex": 0, "blockNumber": 9, "event": "RewardClaimed", "args": { "submissionId": "1", "campaignId": "1", "creator": "0x…", "amount": "100000000" } }],
  "operations": [{ "operationId": "claim:…", "kind": "claim", "status": "pending", "txHashes": ["0x…"], "error": null }]
}
```

## Display guidance

- Show the network name and asset symbol concisely.
- Available means free budget, reserved means owed to approved creators, paid means claimed, and refunded means returned at close.
- Show the ledger as payment history.
- Show `operations` only when the list is non-empty, as "transaction awaiting confirmation".


## Consistent state and refresh throughput

`GET /api/state` pins campaign counts, submissions, campaign accounting, actor and pool balances, and event history to its reported `blockNumber`. The additive `blockHash` identifies that block. The reader checks its canonical hash again before returning a completed build; a changed block is discarded and retried from the current head, up to three times. HTTP 503 `chain_snapshot_unstable` means those attempts crossed repeated reorganizations; the caller can refresh current state. `chain_snapshot_unavailable` means the selected header or source records were unavailable. An RPC failure does not return a prior cached success as a fresh response.

Every refresh reads the RPC head directly. Concurrent readers share work for that same head, and an unchanged head reuses the completed chain snapshot. A refresh that has already observed a newer block waits for the current build and then reads the new head, so it does not inherit an older in-flight result. Contract reads use eight concurrent workers rather than one round trip per row. Already admitted reads finish before an error releases the build; no failed cache value is retained.

When the head advances, event history is fetched only after the last indexed block if that block's hash still matches the chain. A rewind or changed ancestor rebuilds the event prefix from the deployment block. Campaign/submission transaction indexes are updated from those same events. The cache contains chain data only: newly reconciled local titles, briefs, submission URLs and pending-operation state remain visible on the same chain block.

The response keeps all original amount strings, ordering, transaction fields and wallet/local-mode semantics. `Server-Timing: state;dur=…`, `X-CreatorPool-Block` and `X-CreatorPool-Block-Hash` let an operator inspect the actual read duration and source block in the ordinary browser network panel or `curl -i`. Timing is in headers, so it does not change an otherwise identical JSON response. The original mutation/reconciliation handlers and contract authorization remain the transaction authority.


### Measured native workload

On 11 October 2026, the unchanged original backend and the snapshot backend were run against the same retained Ganache 7.9.2 ledger using Node 24.19.0 and ethers 6.13.4. The actual state contained 29 campaigns, two submissions and 37 contract events; all original response fields were identical. Four waves of eight concurrent refreshes were separated by 300 ms. Both services used the same transparent local RPC transport and original contracts.

| Measurement | Original backend | Snapshot backend |
| --- | ---: | ---: |
| First read | 1,297 ms | 671 ms |
| Repeated-read median | 2,175 ms | 43 ms |
| Repeated-read 95th percentile | 2,365 ms | 61 ms |
| RPC calls across 32 repeated reads | 1,348 | 32 |

Each new repeated read still made its own uncached head request. The 32 remaining RPC calls were those head reads; they were not eliminated by a time-based stale-response cache. These are local shared-container measurements, not production latency or competition scores.

The same original HTTP/contract journey attached pending metadata with `/api/reconcile` without advancing the cached block; separated two overlapping readers that saw successive heads; replaced a cached ancestor and rebuilt its event prefix; and changed the selected block during contract reads, after which the request returned the actual canonical replacement. Every measured snapshot `eth_call` supplied its selected numeric block tag. An independent source review also removed the provider's short-lived log cache from this read path and ensured admitted reads drain before failed builds release their slot. No hosted Actions or replacement chain model was used.
