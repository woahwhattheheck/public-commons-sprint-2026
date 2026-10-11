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

## SF71 native operation handoff

The original Bazaar v2 method and input type are now preserved from `extensions.bazaar.info.input.method` and `input.type`, before older flat metadata fields. This addresses live Vellar discovery records that declare their operation under `info.input`, not the previously displayed `info.method`. Each row's actual declared operation is used for an HTTP GET, POST, HEAD, MCP, other, or undeclared filter; undeclared never silently becomes GET.

On any observed row, **Copy source-bound offer handoff** copies the origin provider, its native discovery endpoint and capture time, resource URL, declared method/type/tool/route, and individual network/scheme/asset/payTo/atomic-amount payment alternatives. This is a reviewable operator/merchant handoff only. It makes no seller-origin request, payment, authorization, wallet operation or signing call. Listing visibility is not payment success, merchant authorization, or evidence of valid present-day pricing. A merchant should independently confirm authority and current unpaid 402 terms through existing SF52/SF64/merchant-onboarding work before any buying workflow.

SF71 extends the existing SF70 two-provider read-only operator, not a second controller or merchant crawler. The original Muse 1:1 live read observed Vellar 27 and Periplo 2 listings at that capture moment; counts and methods can change in future native responses.
