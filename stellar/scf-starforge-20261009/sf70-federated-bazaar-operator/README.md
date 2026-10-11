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
- No telemetry or persistence; refresh requests new public native captures and may differ from old Muse snapshots.
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

## SF73: corpus-ranked search across actual observed providers

The live federated browser now ranks **the current original Vellar/Periplo listings** using the existing SCF-23 Bazaar BM25F-style lexical/fuzzy ranker. A phrase such as `weather forecast` searches real observed service metadata, rather than requiring one literal substring. The declared-operation selector is applied first, and the provider selector is applied before scoring. Empty search preserves native source order. The browser never fabricates or merges a result: each hit is an unchanged original SF70 observation retaining its provider, row index, operation/method, all payment alternative tuples and original capture coverage. If one source failed, the original failure banner remains visible; its missing listings are not interpreted as absent. Typo recovery is lexical, **not** inferred semantic equivalence or a price/merchant endorsement.

The SF73 browser adapter imports the original SF23 ranker served from the existing read-only loopback static allowlist, avoiding duplicate search law or a model/vector dependency. There are no new seller fetches, provider POST calls, keys, wallets, signatures, payments, hosted services, CI or GitHub Actions. SF71 same-provider offer-delta and SF72 operation-aware source handoff remain unchanged.

For a current original-provider operator check, launch the merged SF70 server, observe both native GET source statuses and timestamps, search a natural-language phrase and an ordinary typo against those exact captured rows, filter to each individual provider and method, and inspect that the selected hit's original payment alternatives are unchanged. Keep result counts tied to that specific original capture; do not quote older Muse totals as current traffic or commercial adoption.
