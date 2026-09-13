# Sources and claim map

Source snapshot for the implementation claims in this package:

- RustChain RIP-302 source, commit `8c79fba7561283ff8c880258152cd15e2610c312`:
  https://github.com/Scottcjn/Rustchain/blob/8c79fba7561283ff8c880258152cd15e2610c312/rip302_agent_economy.py
- Autonomous pipeline demo at the same commit:
  https://github.com/Scottcjn/Rustchain/blob/8c79fba7561283ff8c880258152cd15e2610c312/agent-economy-demo/autonomous_pipeline.py
- Bounty / public launch context for RIP-302 Agent Economy:
  https://github.com/Scottcjn/rustchain-bounties/issues/685

## Claim-by-claim mapping

| Claim used in script | Source location / evidence |
|---|---|
| Jobs use `open`, `claimed`, `delivered`, `completed`, `disputed`, `expired`, `cancelled` states | `rip302_agent_economy.py`, job-status constants near the top of the file |
| Platform fee is 5% and the platform wallet is `founder_community` | `PLATFORM_FEE_RATE = 0.05`, `PLATFORM_FEE_WALLET = "founder_community"` |
| Default TTL is 7 days; maximum TTL is 30 days | `JOB_TTL_DEFAULT`, `JOB_TTL_MAX`; `_parse_ttl_seconds` also clamps to at least 3600 seconds |
| A poster may have at most 20 active jobs | `MAX_ACTIVE_JOBS_PER_AGENT = 20` and the active-job count in `agent_post_job` |
| Job rewards must be finite, at least 0.01 RTC, and at most 10,000 RTC | `_parse_job_reward` |
| Posting locks reward + platform fee in escrow before creating the job | `agent_post_job`: compute `escrow_i64`, balance check, debit poster, credit `agent_escrow`, then insert job |
| Poster cannot claim own job | `agent_claim_job`: `if j["poster_wallet"] == worker` |
| Concurrent claims are fenced by a guarded state transition | `agent_claim_job`: `UPDATE ... WHERE job_id = ? AND status = 'open'` plus `SELECT changes()` check |
| Only assigned worker can deliver | `agent_deliver_job`: compares `worker_wallet` and requires `claimed` state |
| Expired open/claimed jobs can refund escrow | `_expire_refundable_job` and `_refund_escrow` |
| Acceptance performs guarded `delivered` → `completed` transition before moving balances | `agent_accept_delivery`: guarded update and explanatory race-safety comment precede escrow debit / worker credit / fee credit |
| Reputation includes posted/completed/disputed/expired counts, RTC paid/earned, ratings, and activity timestamps | `agent_reputation` schema |
| Ratings and an activity log are persisted | `agent_ratings` and `agent_job_log` schemas |
| Current route identity checks rely on wallet strings in request payloads and comparisons with stored fields | `poster = str(data.get("poster_wallet"...))`, `worker = str(data.get("worker_wallet"...))`, then string equality checks in claim/deliver/accept routes |

## Editorial guardrails

- This package does **not** claim that RIP-302 currently provides cryptographic signer authentication for every route.
- It does **not** quote a live token price, user count, market cap, transaction volume, or profitability figure.
- It does **not** claim that the historical demo job is still live.
- All numeric statements in the narration are implementation constants or validation limits from the pinned source snapshot.
