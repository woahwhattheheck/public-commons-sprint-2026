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

## Record the product workflow

The [native demo recorder](demo/README.md) captures the complete sponsor and
two-creator lifecycle through the original UI, including both review confirmations,
the refresh-preserved creator draft, the unused-budget refund and a reward claim
after closure. It produces a continuous WEBM, timed captions, original state
checkpoints and an MP4 conversion path using the existing local launcher.

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

## Interaction rendering

Changing role, actor or campaign reuses the confirmed campaign cards, payment
timeline and selected campaign overview. Campaign/submission joins are indexed
once per normalized API snapshot, and actor options are rebuilt when their
identities or labels change. Each changed complete API response invalidates the
source-backed views. An identical fresh response retains them and advances the
last successful observation time. The comparison includes metadata and pending
operations: a block hash alone cannot identify the whole response. Action gates,
wallet operations and creator forms continue to use current
interaction state; receipt reconciliation triggers another render when it
actually attempted a pending receipt.

A paired Chromium 155 profile replayed the native recorder's nine local CPDEMO
checkpoints, from campaign creation through the reserved reward claimed after
closure. Both versions served the same 17 read-only responses and produced the
same 18 visible views and seven preserved creator drafts/caret positions, with
zero page errors or write requests. The recorded case contains one campaign
and two submissions.

| Measured work | Before | Updated |
|---|---:|---:|
| Script CPU, complete matched profile | 196.826 ms | 106.481 ms |
| Full render calls | 108 | 92 |
| Full render elapsed time, total | 472.5 ms | 213.1 ms |
| Rendering during 40 alternating role changes | 163.5 ms | 40.7 ms |
| Campaign card insertions / removals | 108 / 108 | 16 / 16 |
| Timeline insertions / removals | 662 / 654 | 67 / 59 |

The profile used a 1440 × 1000 headless browser, DevTools thread CPU metrics and
elapsed timings around the original render functions. Both profiles temporarily
used a 60-second background polling interval to compare the same explicit read
sequence. The shipped refresh intervals remain 8 seconds normally and 3 seconds
while operations are pending. These measurements cover that recorded journey;
different campaign counts, browsers and devices can have different timings.

## Campaign portfolio

The original workspace supports a portfolio of campaigns through its existing
`npm run demo` launcher or public-mode server. The campaign list starts with six
cards per page; every campaign remains available through search, filters and
paging. Search matches title, creative brief, campaign ID (including `#32`) and
sponsor address. Status filters distinguish open, deadline-passed and closed
campaigns using the current contract response. Sort by newest, deadline, title,
reward or available funds; monetary comparisons use the original atomic integer
amounts, including values larger than JavaScript's safe integer range. Unknown
amounts sort last. Ties keep the original response order.

| View | Work queues | Original controls reached |
|---|---|---|
| Sponsor | All campaigns; sponsored by me; work to review; pools to fund; deadline passed | Funding, original submission review and campaign closure |
| Creator | All campaigns; open for work; my submissions; awaiting selection; rewards to claim | Existing work form, submitted work and creator claim |

Queues count campaigns, while the card shortcuts show relevant submission or
claim counts. Sponsor queues follow the original sponsor gate. Creator queues
match the selected local actor or connected public wallet to its original
submissions. A closed campaign remains in its creator's rewards queue while an
approved reservation is claimable. Funding and deadline filters do not erase
approved rewards, and selecting a role never grants wallet authority.

Use a shortcut to open the selected campaign at the relevant existing control.
It only navigates: the user still reviews work, confirms a closure or selects a
claim through the original operation and wallet flows. A work-review queue may
include an underfunded campaign; its submission remains inspectable and the
existing balance checks explain why approval cannot yet reserve a reward.
Open-for-work browsing does not imply that a pool is funded.

Filtering and paging leave the selected campaign and its live form open. If its
card is outside the current result page, a visible notice offers **Show selected
campaign**, which clears the filters and locates that card without submitting
anything. Search changes do not rebuild the open form. Existing creator draft
storage, actor separation and the explicit save/discard controls are retained.

The browser remembers search, queue, status, sorting, page size and page for the
API endpoint, mode, chain, pool, role and actor/wallet. A different creator gets
its own preferences; a public wallet connection cannot inherit another wallet's
work filter. Missing or unavailable browser storage leaves controls usable for
the current tab and displays a storage notice. No preference is a transaction,
an authorization record or a copy of the campaign ledger.

The existing 8-second idle / 3-second pending refresh schedule is unchanged.
Every refresh still reaches the original API, whose current-head check and
same-block metadata reconciliation remain active. Complete-response reuse and
bounded visible cards reduce browser work without skipping source observations.

### Retained native operating run

The portfolio was operated against the original snapshot engine and a resumed
copy of its retained local chain: block 48,
`0xcb6eb9994a70d4f8863be2de244aa7406a7f5bc28ab6aad90b2a2b06ae80f9b3`,
32 campaigns, two submissions and 40 events. All 32 campaigns were reached
once across six pages. Sponsor preferences survived reload; creator preferences
and saved drafts remained separate for Creator A and Creator B; filtering left
the same live form intact. The existing nine recorder checkpoints also retained
all 18 original detail/control views and seven draft/caret checks, with 17 reads,
no writes and no page errors.

On existing campaign 29, the browser used the original controls to fund 250
CPDEMO, submit work as Creator A, review and reserve 100, close after advancing
the local chain past its actual contract deadline, and claim the reserved 100
after closure. The five API operations ended with 100 paid, 150 refunded and
zero reserved or available on that campaign. Navigation shortcuts sent no
operations. Final native state was block 55, 32 campaigns, three submissions
and 45 events. The 390-pixel viewport had a 390-pixel document width and no page
errors. These are local contract operations with the original non-monetary
CPDEMO asset.

A separate paired measurement used the same original native block-48 API,
20 explicit fresh reads and 40 role changes in each version. Both versions made
21 actual API reads including boot; their complete source responses matched.

| Measured work on 32 campaigns | Previous PR998 UI | Portfolio UI |
|---|---:|---:|
| Visible campaign cards per initial page | 32 | 6 |
| Campaign card insertions / removals after boot | 640 / 640 | 0 / 0 |
| Campaign-list render elapsed time, total | 97.6 ms | 15.6 ms |
| Whole-page script CPU in the sampled interaction | 38.214 ms | 44.937 ms |

The measured campaign-list rendering work fell by about 84%. The whole-page
CPU measurement includes the added work queues and preference controls and
rose by 6.723 ms in this short sample. Measurements used Chromium 155 at
1440 × 1000, original API calls and the same temporary 60-second profile poll
interval; the shipped polling schedule remains unchanged. Role-specific queue
nodes and a bounded set of current-snapshot identity models are reused when
switching views. The real operating journey and its native ledger were retained
separately from the source; no benchmark server or substitute data store is part
of the application.

