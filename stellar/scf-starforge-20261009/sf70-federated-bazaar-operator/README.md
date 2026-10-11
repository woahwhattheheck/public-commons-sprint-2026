# SCF SF70 | Federated native Bazaar operator

MIT. A real operator-facing Stellar x402 resource browser over **two independent native public facilitator GET APIs**. This expands the released single-provider SF61 Atlas without changing its owner, API, catalog, journals, wallet or settlement code. It does not create a second facilitator, purchase agent, verifier or test harness. Node.js 22+, zero package dependencies, no GitHub Actions.

## Run against actual original sources

From the public sprint repository root:

```sh
node stellar/scf-starforge-20261009/sf70-federated-bazaar-operator/server.mjs
```

Open the printed `http://127.0.0.1:<port>/` on the **same machine**. It pins its two independently operated original facilitator origins:

- Vellar: `https://vellar-facilitator-testnet-production.up.railway.app`
- Periplo: `https://periplo-testnet.fly.dev`

The backend makes only native `GET /discovery/resources?network=stellar%3Atestnet&limit=100&offset=...` calls to these operators, exhausts advertised native offset pagination, and labels the exact provider, observed row count, pagination declaration and capture timestamp. If either fails, the other remains visible with a **PARTIAL_SOURCE_FAILURE** banner, not a false zero count. `--port=8788` selects a local port; `--network=stellar:pubnet` selects the explicit supported network. By default the network is `stellar:testnet`. Any pubnet result would require original provider support and is not claimed here.

The browser searches and filters **observed native provider rows** locally. Every advertisement visibly retains its original provider and own indivisible `accepts` alternative: exact declared network, scheme, asset, `payTo` and atomic-unit amount. Distinct providers are not merged into a fabricated "consensus" price. Seller resource URLs are text, not links that might accidentally issue paid requests. This is an operator product, useful for assessing discovery reach across different catalogs before any purchase authorization. No wallet, payment signing, verification endpoint, settlement, seller-origin POST, credentials, browser tracking, or external assets.

## Why this is useful now

Existing original-source **SF65 / Muse** paired independent captures from October 10, 2026 counted Vellar 27/27 native listings and Periplo 2/2, 29 observed canonical routes and **zero shared canonical routes** within the selected Stellar-testnet scope. It is a concrete *coverage* opportunity, **not evidence of zero services, broken providers or payment-term conflicts**. That paired original-source experiment is the source of truth for the 27+2 observation. SF70 is a separate live product and must not automatically claim the identical counts at a later time: services and provider totals can change.

SF70 reports current provider-observed row counts, not users, customers, seller authority, completeness outside the selected source filters, route identity equivalence, paid delivery, on-chain finality or revenue. It shows each source separately even when resource URLs appear in more than one. For canonical cross-provider payment/contract comparisons, reuse [SF65's existing SHA-verified offline comparator](../sf65-cross-provider-reconciliation/README.md). For individual live seller 402 and repair paths, use the accepted SF52/SF64/SF68 tools rather than reimplementing them.

## Operator boundaries

- Public testnet native GET only by default; no click-through GET of paid seller resources.
- Two pinned preapproved public HTTPS hosts, never browser-selected URL parameters. The server binds literal `127.0.0.1` and rejects non-loopback sockets and altered `Host` headers.
- Requests reject redirects, use a 12-second per-page abort, cap each JSON page at 2 MiB, at most 30 pages and 3,000 source rows per provider. No cookies, authorization, credentials, wallet, or private endpoints forwarded.
- Source JSON is rendered with textContent, under same-origin restrictive CSP; no untrusted HTML insertion. Errors remain source-specific and do not become false absence.
- No telemetry or persistence. Independent native source capture timestamps remain unchanged by delivery coordination. The manual **Refresh genuine GETs** button bypasses any recent completed-capture reuse and obtains a new provider observation (or joins a simultaneous in-progress fetch).
- No CI, customer contacts, SCF submission, commercial promises, or hosted deployments. The grant founder and SF49 merchant operator can reuse this original product for operator demonstration, not claim commercial adoption from a testnet result.

### Exact live source follow-through

The original connected @Muse VM should run this merged SF70 server against BOTH pinned public origins with exact network `stellar:testnet`, capture `/api/federated` and local browser status with actual timestamp/source rows, record run source commit SHA and current raw native responses per operator, and post the complete result to existing #sim-data. This must be an original live source run, not a substitute synthetic corpus. No payments, new wallet, separate simulator, or GitHub Actions required. Existing SF41/SF65 source capture is the definitive hash/byte integrity benchmark, not SF70's live UI counter.

## SF71: observe real within-session offer drift

This operator now retains one prior native capture **in browser memory only**. Click **Refresh genuine GETs** to compare fresh captures of the **same facilitator** and **same declared Stellar network**. The view distinguishes newly observed, no-longer-observed, and changed listed operations. A change in the entire original network/scheme/asset/payTo/atomic-amount alternative is shown as one removed offer and one added offer, never as a recombined offer.

Comparison requires each provider to have completed **both** native GET captures. If a facilitator fails or was unavailable, it is explicitly skipped; a failed provider cannot create spurious listing removals. Duplicate operation identities, URL-less listings and payment options truncated by the original SF70 projection are excluded from unsafe term comparisons and counted. A service method change is treated as two distinct observed operations, not the same endpoint silently changing contract. Nothing is stored beyond the current tab, and an observation changing does **not** establish seller fraud, a verified merchant 402 price change, paid failure or settlement.

This is **longitudinal within-provider** observation, not the already separate SF65 two-facilitator identity/equivalence engine. The October 11 Muse Vellar source recorded real new HTTP POST listing and changed advertised payTo values; use source-specific 1:1 captures to independently assess future changes. The new read-only UI never probes paid seller resources and never signs or sends payments.


## SF72: source-bound native operation handoff

The browser reads the original Bazaar v2 operation declaration from `extensions.bazaar.info.input.method` and `input.type`, ahead of older flat metadata fields. This fixes missing operation labels for observed Vellar listings that declare their method under `info.input`, not the previously displayed `info.method`. Operators can filter by HTTP GET, POST, HEAD, MCP, other declared methods or undeclared; a POST-only route is never silently treated as GET.

The **Copy source-bound offer handoff** button copies only currently observed data: original facilitator and native discovery endpoint, capture time, resource URL, declared operation/method/tool/route template and each indivisible advertised tuple (network, scheme, asset, payTo, atomic amount), plus a warning if options were truncated. It is a reviewable merchant/engineering transfer, not a seller probe or authorization. It cannot sign, spend, invoke seller endpoints, or verify ledger finality. Confirm merchant ownership, present live unpaid 402 and permitted selected terms using existing SF52/SF64/SF36 workflows before buyer approval.

This is compatible with SF71's *separate* between-refresh observed-provider-offer delta view. Method identity improves that existing longitudinal view because method changes remain distinct native operations. SF71's previously merged module, source/UI and behavior are preserved. No additional independent facilitator, crawler, controller, CI, wallet, contact or competition proof product is created.

## Concurrent native capture and operator-visible freshness (SF70)

This same loopback server coalesces simultaneous browser requests into **one** original native Vellar+Periplo capture per Stellar network. A completed capture with both independent sources marked `COMPLETE_GET_CAPTURE` can be reused by automatic tab loads for **up to 8 seconds**; partial-source failure or total-source failure is **never** stored as an eligible complete capture. Failed attempts clear the in-flight state so the next request can retry. All data, declared native pagination, per-provider source `observedAt`, original advertised payment alternatives and the existing SF71/SF72 operator features remain unchanged.

An added response-level `operatorDelivery` explains **how this HTTP response was served**, separate from when the native providers were read: `LIVE_NATIVE_CAPTURE`, `SHARED_LIVE_CAPTURE`, or `RECENT_COMPLETE_CAPTURE`, with serving time and completed-capture age in milliseconds. UI source cards display native per-provider capture timestamps; the status reports reused versus live/joined delivery. Clicking **Refresh genuine GETs** calls `/api/federated?refresh=1` and always bypasses reuse, preserving SF71's successive-observation semantics. No scheduled background requests or external cache are introduced; no seller-origin calls, credentials, wallets, settlement or fee-bearing hosted CI.

Run the focused local check (Node 22+; no hosted Actions):

```sh
node --test stellar/scf-starforge-20261009/sf70-federated-bazaar-operator/test/refresh.test.mjs
```

These checks cover concurrent native capture, manual freshness, an incomplete provider, an upstream throw, completed-capture expiry and network-scope independence. They assert coordination semantics, not live provider counts or payment success. For current original provider totals, use new genuine native GET data; the prior Muse 27+2 receipt is a timestamped observation rather than a permanent fixture.

## SF73: live federated lexical/fuzzy service discovery

The federated operator now ranks original Vellar/Periplo observations with the **existing SCF-23 BM25F-style ranker**, rather than requiring a full literal substring. Multiword needs and ordinary typos rank the metadata within the currently selected provider and declared-operation filters; an empty query retains the original source order. The adapter returns the exact unmodified original listing objects: provider, method, source row, URL, every declared indivisible payment tuple, and original source coverage remain intact. It never merges or deduplicates offers across providers.

The original ranker is served only as a whitelisted static module under the existing loopback-only CSP. No vector service, new provider GET/POST, merchant probe, wallet, CI or payment is introduced. SF71 live offer delta, SF72 source-bound merchant handoff, and later original-source refresh coordination remain unchanged. For a current operator read, use the live two-provider page, record provider/row coverage, search two user-intent phrases and a typo, and confirm full original payment-option preservation. Do not infer seller consent or paid success from relevance.

## SF78: export selected real native offers to a spreadsheet-safe CSV

In the existing loopback browser, filter by text, facilitator and declared operation, then click **Export matching offers CSV**. It exports **all matching source-observed rows** (not merely the first 300 visible listing cards), without invoking a merchant, wallet, purchase endpoint or hosted service. No fresh upstream GET is triggered by downloading: use **Refresh genuine GETs** explicitly to obtain new native observations before exporting.

The UTF-8 CSV contains original capture scope/network/time, each independent facilitator's actual native GET status, timestamp, endpoint and coverage, and the active query/provider/operation filters. Separate **PROVIDER_STATUS** records appear even for failed providers, so incomplete discovery cannot be misread as a real zero. A payment option becomes exactly one **ADVERTISED_OPTION** record retaining its *own* asset, scheme, network, recipient and atomic amount. Resources with no exposed options are **RESOURCE_NO_OFFER** rows. Listings with undisplayed payment alternatives retain their truncation count and explanatory warning; the export must not be treated as the full source document or a validated merchant quote.

This is a browser-local Blob download, not a new API, credential flow, offline grant evidence binder or settlement product. The pure [offer-csv.mjs](./offer-csv.mjs) serializer quotes fields, doubles embedded quotes and prepends a spreadsheet-text marker to provider/user-supplied cells beginning with potentially executable formula characters (including after leading whitespace). Such cell escaping is a presentation protection, not an alteration to the underlying in-memory native observation. Retain the source URL and capture timestamp when transferring a row to an authorized merchant operator; use the original 402 inspection tools before any payment or seller assertion. No new npm package, CI job or telemetry is introduced.


## Compare a shortlist across searches and providers

Use **Compare this option** underneath an advertised payment alternative. The
comparison above the catalog retains up to six independently selected options as
you search, change provider or operation filters, and refresh. **Compare selected**
returns to the table, which exposes each source endpoint, UTC capture time, native
row/option, declared operation and the complete projected payment tuple. Keyboard
users can select options with the normal buttons, follow the comparison link and
scroll the labeled comparison region. Removing a column keeps focus within the
comparison; **Undo last change** also restores a cleared or replaced shortlist.

Every selection copies its original projected observation. A refresh never silently
changes a selected price or recipient. Status distinguishes the latest source
capture, an earlier capture with the same tuple observed again, a tuple/operation
not in the latest complete capture, an ambiguous identity, incomplete alternatives,
and an unavailable source or failed refresh. Provider failures cannot establish a
removed offer. To select newer terms, choose the desired option in the refreshed
catalog; the old observation remains until explicitly removed.

Atomic amounts remain strings with no numeric conversion, currency conversion,
aggregation or price ranking. Different assets, networks and operations cannot be
assumed equivalent. The comparison retains SF70's existing bounded projection;
it is not a raw native capture, current seller quote, merchant approval or checkout.

**Save review JSON** downloads the selected projected listings, individual options,
original source coverage/timestamps and current comparison status in one local
`SCF-SF70/advertised-offer-shortlist-v1` file. Saving, comparing and removing make
no network request. Selections live only in page memory: the catalog Refresh button retains them, but
a browser reload or closing the page clears them. No browser storage is written. Use **Open review JSON** to restore a saved comparison. Refresh is still the existing
explicit facilitator GET action, never a merchant call.

Focused workflow check (Node 22+):

```sh
node --experimental-vm-modules --test stellar/scf-starforge-20261009/sf70-federated-bazaar-operator/test/shortlist-flow.test.mjs
```

This runs the shipped browser module through the real local HTTP static-module
routes, using an HTML-derived minimal DOM and labeled fictional source observations.
It covers selection across filters, unchanged versus changed later observations,
failed refresh, focus after removal, undo/clear, and exact large integer string
export without extra discovery requests. It is not a rendered-browser or live
provider check; no hosted CI or merchant request runs.

### Reopen a saved comparison

Choose **Open review JSON** and select the file previously saved by this page. A
valid file replaces the comparison; **Undo last change** restores the previous
selections. Invalid or oversized files leave the current comparison intact. Opening
a file does not refresh discovery or contact any URL in the file.

Files must be smaller than 1 MiB and use the original v1 shortlist schema, with at
most six complete selected observations and the existing projected field limits.
The reader checks the source, operation, row/index and individual option against
its corresponding listing; unknown file metadata, saved status and saved keys do
not become runtime state. Atomic amounts stay strings. The displayed file source
and capture time are retained as recorded, not authenticated.

Imported selections are explicitly labeled **Opened local review file**. An
identical timestamp alone cannot make them current: a unique matching operation
and exact tuple in the current available provider capture are needed to report a
match. Otherwise the table keeps the earlier/unavailable/changed state. A match
still does not establish seller authority, equivalent services or payable terms.
