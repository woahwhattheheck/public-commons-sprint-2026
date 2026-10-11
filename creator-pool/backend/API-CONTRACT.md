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

This is the shape only. Every value comes from the live chain at request time.

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
