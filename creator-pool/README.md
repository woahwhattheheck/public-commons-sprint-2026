# Creator Pool

One sponsored content campaign, one capped pool: a sponsor sets the creative
brief, the reward per selected piece, the total budget and the closing date;
creators submit links to their work; the sponsor approves the pieces it wants
(each approval reserves that creator's reward); each selected creator claims
their own payout; closing the campaign refunds **only** the uncommitted
remainder — approved rewards stay claimable.

This directory is self-contained: on-chain contracts, a dependency-light
Node API that also serves the frontend, and a zero-build vanilla JS web app.

```
contracts/   CreatorPool.sol  — campaign accounting: funded / committed /
                               paid / refunded; reserve-preserving close
             DemoToken.sol    — local dev token only (see "Money labels")
backend/     server.mjs       — HTTP API + static hosting of ../web
             API-CONTRACT.md  — exact request/response contract
             lib/compile.mjs  — runtime solc compile (no checked-in artifacts)
             scripts/         deploy-local.mjs, run-flow.mjs
web/         index.html, app.js, styles.css — campaign workspace
```

## Money labels — read this first

| Mode | What is real |
|---|---|
| `local` | Development only. Runs against a loopback Ganache EVM (chainId 1337/31337). The token is **CPDEMO — a local non-monetary demo token**; it has no value and buys nothing. The `sponsor`/`creatorA`/`creatorB` actors are unlocked dev accounts — convenient, **not authentication**. Every number shown is still a real on-chain read from the local contracts. |
| `public` | The server holds **no keys** and never signs. Each write returns HTTP 202 with unsigned transaction descriptions; the user's own wallet (EIP-1193) signs and broadcasts; the chain enforces `msg.sender`. Real network + real token only after a real deployment — none is shipped here. |

There is no "funded" flag anywhere — every balance, liability and refund
is read back from the contract, and metadata is displayed only when its
stored hash matches the hash the contract holds.

## Requirements

Node.js ≥ 20 and npm. Backend dependencies: `ethers@6.13.4`,
`solc@0.8.26`, `ganache@7.9.2` (dev). No other services.

## Run and resume the local app

From a clean checkout:

```sh
cd creator-pool/backend
npm install
npm run demo
```

One terminal starts the persistent local Ganache chain, creates the initial
CPDEMO deployment only when the data directory is empty, and serves the existing
campaign workspace at `http://127.0.0.1:8787`. Wait for the ready URL, then open
it. Stop with Ctrl+C; run `npm run demo` again to resume the same campaigns,
submissions, token balances and payment history. It shuts down only child
processes it started. A matching already-running workspace is reused.

Keep the entire `backend/data/` directory together: `ganache-db/` is the saved
chain, `deployment.json` and `abi.json` identify its contracts, and `state.json`
stores the matching campaign descriptions and operation journal. If those files
are incomplete or the saved contracts are absent from the selected chain, the
launcher stops with a recovery message; it never erases data or redeploys over a
saved campaign. Restore the original data/RPC instead of deleting files to make
an error disappear. An unrelated process occupying either port is left running.

`CP_DATA_DIR` selects another data directory, `PORT` changes the workspace port,
and `RPC_URL` can select an existing loopback development chain. With an unused
loopback RPC port the launcher starts Ganache there. `npm run demo` is local-only:
chain 1337/31337, loopback binding and non-monetary CPDEMO. It does not run a
public deployment, faucet or wallet connection.

For manual operation, the original commands remain available: `npm run chain`,
`npm run deploy:local` (an explicit new deployment), and `npm start`. Use the
launcher for an ordinary restart; do not rerun deploy:local to resume campaigns.

Open `http://127.0.0.1:8787`. The app calls `/api/...` same-origin; a
`?api=` query override exists for pointing the static files at a different
API root during development.

`npm run flow` drives one end-to-end pass against the live local API —
create → fund → submissions → approvals → claim → over-budget rejection →
close (reserved rewards survive) → post-close claim → operationId replay —
and writes `data/flow-report.json`.

## Deploying to a public network (not shipped)

`deploy-local.mjs` refuses anything that is not a loopback RPC with
chainId 1337/31337. A public deployment means: real network RPC + real
deployer wallet, a `deployment.json` with `mode: "public"`, then
`CP_MODE=public` at server start. In public mode every write needs a wallet
signature and the API's `/api/reconcile` attaches off-chain metadata only
from real mined receipts. The contract uses standard ERC-20 semantics;
fee-on-transfer tokens are rejected at fund time.

## Security model in one paragraph

Local mode is a demo: unlocked accounts pick the actor server-side.
Public mode has no accounts at all — the contract checks the actual
transaction sender. All economic values are integer atomic-unit strings
end to end (BigInt, never floats). The API journal records every send;
a transaction whose broadcast outcome is unknown is never silently
retried — the stored hash is reconciled from its real receipt. The
frontend mirrors this: it journals unsigned batches in the tab, offers
resume-signing, and never invents a hash.

See `backend/API-CONTRACT.md` for the exact wire format.

## Sponsor launch planner

Open **New campaign** from the Sponsor view. The creation drawer now
previews the maximum number of complete creator rewards and the leftover
uncommitted budget **at hypothetical full funding**, calculated as integer
atomic units using the asset decimals reported by the live backend. That
preview is not a funded balance, an approval, a creator selection or a
transaction. It updates as the reward/budget inputs change and displays the
separate chain funding requirement before creation.

Set a closing date in **device local time** (the default) or explicitly
switch to **UTC**. The form shows the exact UTC close that would be recorded
on chain; the backend still enforces the original five-minute to 400-day
range. Title (140 characters), creative brief (4,000 characters) and uint128
money constraints now match the original API rather than waiting for a
backend validation failure. The contract, creator choice, funding, wallet
signing and approval paths are unchanged. Local CPDEMO remains valueless.

## Sponsor's pool view

The existing campaign workspace now makes its contract-backed pool accounting
usable before sponsorship decisions. Select a campaign in the Sponsor view to
see uncommitted funds, approved creator reserves, claimed payouts and prior
refunds, plus an explanation of what closing or the next approval will do.
The funded balance must reconcile with those four buckets; incomplete or
inconsistent provider readback is flagged instead of treated as zero. The
campaign-card meter also distinguishes its not-yet-funded budget portion.

**Example (atomic units, illustrative contract state):** budget 250, funded
250, already claimed 100, reserved for other approved creators 100, free 50,
refunded 0. The funded 250 is fully accounted for, but another 100-unit
approval is not affordable. A close refunds at most the currently free 50;
the approved 100 remains reserved for creator-initiated claims after close.
The interactive approve action previews the remaining free pool; it uses the
existing API and wallet/operationId flow without another transaction, signing
step, permission, backend accounting implementation or substitute auth.

The selected token symbol and decimal precision come from the backend state.
Local mode uses valueless CPDEMO and unlocked demonstration accounts; public
mode requires actual deployed contracts and wallet signatures, neither supplied
by this source branch. These readouts do not claim any real deployment/payment.

