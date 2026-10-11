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

## Run the local demo

```
cd backend
npm install
npm run chain            # terminal 1: Ganache on 127.0.0.1:8545, chainId 1337
npm run deploy:local     # terminal 2: compile + deploy + mint CPDEMO, writes data/
npm start                # API + web app on http://127.0.0.1:8787
```

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
