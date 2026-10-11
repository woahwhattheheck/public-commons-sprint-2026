# SF87: Stellar merchant rail economics (x402, MPP Charge, MPP Session)

A runnable offline, cost-transparent merchant decision instrument for the SCF #46 Starforge adoption lane. This **complements, not replaces**, the existing SF08 facilitator-host economics, SF30 actual seller SDK, SF74 merchant console, and SF84 live x402/MPP challenge intake. It issues no HTTP calls, signs no wallet messages, and runs no payment or hosted CI jobs.

## Use

From any full repo checkout with Node 22+:

```sh
node stellar/scf-starforge-20261009/sf87-rail-unit-economics/compare.mjs \
  stellar/scf-starforge-20261009/sf87-rail-unit-economics/illustrative-input.json \
  --markdown /tmp/scf87-operator-report.md > /tmp/scf87-operator-report.json
```

The markdown output is a **new, non-overwriting, private (0600)** local file. JSON is printed to stdout. Paths are supplied by the operator; to use real commercial assumptions, copy `illustrative-input.json` to a new local private file and replace every cost and workload input. Both exports show specific unknown costs instead of pretending that they are zero, and they do not expose payment credentials or private customer data. The included example is completely hypothetical, not an actual merchant report or vendor quote.

**Merchant question answered:** Given a unit price, monthly successful paid requests, operating overhead, sponsorship choices, expected monthly MPP Session openings/closings, and capital-carried channel population, what is the estimated contribution and when does the cheaper rail change? The report separately exposes exact monthly gross revenue, known cost floors, per-rail net contributions if complete, per-rail break-even thresholds and the session/x402 crossover at fixed session churn. This is a viable starting point for qualifying a paid seller integration or an SCF adoption reviewer discussion, not a grant proposal submission.

## Inputs and semantics

All USD amounts are **decimal strings with zero to six decimal places**. Do not enter floats. Parsing and total arithmetic use exact integer micro-USD, with BigInt for counts times rates. All demand and channel counts are nonnegative safe integers and are emitted as decimal strings. The current model supports nonnegative dollar assumptions only (no refunds or rebates). Every price/cost key must be present. For a cost without an observed seller/provider quote, enter `null`, not `"0"`. The report then preserves a lower bound of known costs and an upper bound on contribution; it does not choose an overall winner or fabricate the omitted fee.

| Input field | Meaning |
| --- | --- |
| `workload.paidRequestsMonth` | **Successful billable** API requests in one month, same demand across all three rails |
| `workload.unitPriceUsd` | Seller gross revenue per successful paid request; not the rail's network fee |
| `workload.channelsOpenedMonth`, `channelsClosedMonth`, `activeChannelsAverage` | MPP Session expected paid-funder channel activity. Fixed when finding break-even or crossover |
| `workload.funderDepositUsdPerChannel` | Hypothetical funder principal tied per active session, not merchant revenue or operating cost |
| `costs.shared.*` | All-rail hosting/support floor and common variable work, from real quotes or unknown (`null`) |
| `costs.x402.facilitatorPerPaidUsd` | Merchant-borne facilitator cost per successful x402 settlement |
| `costs.x402.sponsoredSettlementPerPaidUsd` | Merchant's elected ledger fee sponsorship per x402 onchain settlement (0 only if genuinely not borne) |
| `costs.mppCharge.sponsoredTransferPerPaidUsd` | Merchant's elected ledger sponsorship per MPP Charge paid onchain transfer |
| `costs.mppSession.channelOpenUsd`, `channelCloseUsd` | Merchant-borne per-channel opening and closing ledger fees |
| `costs.mppSession.offchainPerPaidUsd` | Marginal cost of session-authorized signed payment update, not a blockchain transfer fee |
| `costs.mppSession.channelPerActiveMonthUsd`, `liquidityCarryPerActiveMonthUsd` | Additional active-channel operation and separately quoted economic carry costs |

Each `fixedMonthlyUsd` is an explicit monthly fixed cost for its section. If a fee is never borne by the **seller/operator** in the target model, explicitly input `"0"` after verifying the bearer; a client-borne or funder-borne fee is not an invented zero-cost transaction.

The example assumes $0.01/request, 150,000 successful calls, 80 concurrently active MPP Sessions, 60 openings and 60 closings. **Every** fee and workload figure in it is a modeling input only. Principal locked by funders is presented separately as capital exposure, never deducted from the seller's operating contribution.

## Correct protocol accounting

- **Stellar x402 Exact:** an HTTP payment challenge and a successful onchain settlement through the selected facilitator per successful billable request under this scenario. The model counts one sponsored settlement per request. Alternative facilitator batching or failures require a different explicitly documented cost scenario.
- **MPP Charge:** a separate Soroban token transfer for each successful paid Charge request, initiated and broadcast by the chosen client/server mode. Count one paid onchain transfer per request, while identifying which party pays ledger sponsorship.
- **MPP Session:** deposit funds into a unidirectional session, exchange signed cumulative commitments offchain, and settle the final payment when the channel closes. The model counts openings + closings as onchain operations, **not one onchain transfer per paid request**. Expiry, force-close, reopening, refunds, failures, liquidity distribution, per-channel authorization and network congestion are not represented by the baseline.

The ratio of request volume to sessions is not a network capacity guarantee. The model does not infer channel balances from gross revenue or verify distribution/funding adequacy. The monthly average active and month-open/month-close inputs are independently operator-supplied. Break-even and crossover calculations hold session counts and rates fixed; they cease being directly applicable if volume causes more channel openings or a different fee market.

First-party protocol sources, checked October 11, 2026:

- [Stellar x402 guide](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [Stellar MPP guide: Charge and Session](https://developers.stellar.org/docs/build/agentic-payments/mpp)
- [SCF #46 current interest/invitation route](https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg)
- [Existing SF08 facilitator economics](../sf08-operator-economics/README.md) (separate hosting/RPC/capacity estimates)

## Reviewer use / real merchant adoption

A seller can import an **actual** SF74/SF84 unpaid technical capture through its original owner workflow, choose supported payment rail from that observed challenge, insert genuine merchant cost/rate/deposit forecasts here, then review pricing and runway with the original SF49 commercial owner. This calculator does **not** consume or overwrite any capture and does not certify a real seller's integration. Use a new input file for each merchant. The comparative report is suitable for an offline meeting, along with actual source-backed seller challenge and chain receipt *if the operator has them*. Keep all original SCF application submissions with the SF10 founder. A grant invitation, revenue, onchain settlement or live production performance cannot be inferred from this model.

## Optional native browser studio (SF87 follow-on)

The companion studio is a real on-device merchant-facing UI backed by the *same* `compare.mjs` math, not a copy of it. It serves a locally editable price, request-volume, and channel-churn form, an exact three-rail results table, full cost lines, an unpriced-cost explanation, and one-click browser downloads of JSON and the merchant Markdown report.

```sh
node stellar/scf-starforge-20261009/sf87-rail-unit-economics/studio.mjs --port 0
# Open the printed http://127.0.0.1:PORT/ on the same machine.
# Ctrl-C stops the foreground server.
```

Node 22+ standard library only. It binds **only** `127.0.0.1`, rejects foreign Host and cross-origin POST, sets a self-only Content Security Policy, accepts JSON bodies of at most 128 KiB, disables caches, executes original SF87 `analyze()` for every quote, and does not store submitted inputs or contact any external system. Browsers receive static assets and the illustrative starting scenario from that same local server. Unknown cost entries are left empty, not turned into zero. Merchant reports are downloaded by the browser to the operator's device; the server does not save merchant inputs or sales leads. This UI does not change SF74 merchant technical diagnosis, SF49 relationships, SF08 operational hosting quotes or the founder's SCF application authority.

### Keep and reopen editable scenarios

Name the assumptions in **Scenario name**, edit the workload and quotes, then choose **Save scenario JSON**. The original local engine validates the current inputs, updates the calculated result, and prepares an editable `merchant-rail-scenario.json` download. Confirm that your browser saved the file. Its schema is the original `stellar-forge.rail-economics.v1`, so the same file also works with the existing `compare.mjs` command.

After a reload or in a later session, choose **Open scenario JSON**. A file is parsed and evaluated by the same original local engine before any current fields are replaced. The form restores the name, safe whole counts, exact decimal USD strings (including trailing zeros) and null unknown costs, then displays newly calculated results. **Undo scenario replacement** restores the raw form that preceded the most recent open or illustrative reset, including unfinished edits. Undo clears results until the restored form is calculated again.

Editable scenario files and calculated reports serve different purposes. **Download calculated report JSON** and the merchant Markdown button export computed outputs; those reports cannot reopen as editable inputs. Each result is titled with its scenario name. Editing any assumption immediately clears prior results and disables report downloads, and a delayed calculation/file-open response cannot overwrite newer edits. Saving always validates and captures the current complete form.

Files are bounded to 128 KiB and valid UTF-8 JSON. The UI accepts only the original editable fields: name up to 160 characters on one line, safe nonnegative integer counts, and nonnegative exact USD strings up to 128 characters with at most six fractional places, or null for an unknown cost. Unexpected fields and derived report schemas are rejected rather than silently discarded. Original cross-field constraints remain in `analyze()`; a malformed or invalid file leaves the current form intact.

Edits live in this page's memory and clear on reload/close. Saved files are explicit browser downloads; there is no browser storage, server persistence or external upload. The existing loopback server and exact economics engine from PR766/PR781 remain unchanged; this continuation completes their editable scenario workflow.

Focused local workflow check: `node --test stellar/scf-starforge-20261009/sf87-rail-unit-economics/test/studio-scenario.test.mjs`. It runs the shipped HTTP assets and original evaluation endpoint with an HTML-derived minimal DOM, covering save/open, exact strings and unknown costs, undo, invalid input retention and delayed-result invalidation. It is not a rendered-browser or live merchant/fee validation.
