# ShelfConductor — independent bookstore stock-aware Qloo hand-selling desk

A distinct 2026 Qloo Agentic Hackathon entrant prototype. Retailers upload their own catalog and real Qloo book identifiers. A patron gives favorite book titles; ShelfConductor resolves them through the official **GET `/search`**, fetches the official **GET `/v2/insights`** in the *book* category, then chooses from only those exact retailer-supplied entity identifiers whose stock and price pass hard constraints. No cart or purchase takes place. No LLM dependencies, npm installs, or external database are required.

## Start

Node 22+:

```sh
node src/server.mjs
# http://localhost:3000
# Synthetic demo button works without an API key; synthetic IDs and titles are fictional.
```

To enable LIVE mode, use an authorized hackathon API key stored in the server environment: `QLOO_API_KEY=... node src/server.mjs` (never place a key into browser, git, query string or public response). The hackathon host is hard-pinned to `https://hackathon.api.qloo.com`. API key goes only in `X-Api-Key` request header. Use `QLOO_CALLS_PER_MINUTE` 1..120 (default 24) to control a local request budget. Failed requests consume a slot; cache/singleflight do not. Every upstream Qloo JSON response is streamed with a strict 1,500,000-byte ceiling before allocation and JSON decoding; over-budget chunks fail explicitly and do not become cached results. The server does not write cookies, inventory, patron profiles or API response bodies to files. Keep a single server process or add shared rate limit for distributed deployments.

## Inventory import

The UI accepts a UTF-8 CSV file with a header and columns:

`sku,title,author,category,price_cents,stock,qloo_id,shelf_note`

Retailer-supplied `qloo_id` values must be **real, verified Qloo book entity IDs**, not slug guesses or names; our app does not automatically attach an uncertain book edition. Rows with missing IDs are excluded. Inventory is transferred only to this local/server session; it is never fetched from Qloo. JSON planning requests retain UTF-8 titles across network chunks, with the existing 150KB raw-byte ceiling enforced before decoding. Invalid JSON or malformed UTF-8 returns `INVALID_JSON` before provider activity. All price/stock/genre/staff notes come from the retailer, not Qloo.

The included **SYNTHETIC DEMO** uses fake book titles and fictional IDs under `synthetic:demo:*` and outputs visible `SYNTHETIC_DEMO`. It cannot be mistaken for a provider call. Live API refusal or exhausted budget returns an explicit error; there is NO automatic demo fallback. At present, Qloo does not give retailer stock, local price or sales authority, and ShelfConductor never asserts otherwise.

A store can populate official qloo_id fields by verifying book entities from the documented Qloo Search API; ambiguous editions should be manually reviewed before import. The live patron seed title search demands exactly one exact-name Qloo book match and fails closed on zero/multiple matches. This is deliberately conservative and will reject some valid titles with non-exact spacing or edition variants.

## Agentic behavior and evidence

- **Resolve patron cultural seed**: independent Qloo entity lookups; no free-text strings passed to `/v2/insights` as pretend entity IDs.
- **Retrieve taste affinity candidates**: Qloo Insights `filter.type=urn:entity:book`, `signal.interests.entities=<verified IDs>`, `take=30`.
- **Reconcile stock**: only exact Qloo IDs from input CSV count; no fuzzy inventory substitution.
- **Plan constrained shelf**: bounded beam selection respects hard budget, number of books, exclusion actions, stock presence and diverse retailer categories. The local utility is *not* a Qloo numerical affinity and is described accordingly.
- **Replan**: Exclude any SKU from result and rerun the same evidence/stock constraints; live Qloo responses use short private server cache and same-request singleflight.
- **Audit**: Expose source rank, returned provider affinity only if present, retailer stock provenance, budget math and live vs synthetic status.

Note: no claim of optimal knapsack solution; beam heuristic is deterministic and bounded. `price_cents` is exact integer cents, not a floating point price.

## Limited verification

`node --test tests/shelfconductor.test.mjs` runs exactly six synthetic/recorded-fetch cases covering inventory, invalid input, exact-ID reconciliation, documented live URL/header/params, and local-rate failure semantics. This has NOT been tested against live Qloo: no authorized key, quota, production deployment, sponsor acceptance, public repo publication or hackathon entry is claimed by the source bundle.

## Remaining official competition acceptance gates

1. Original authorized entrant must hold a working Qloo hackathon API key and verify live Search/Insights with real IDs and privately retained provider evidence (do **not** commit API responses to a public repository).
2. Add official Qloo IDs to an operator-owned book catalog; verify licensed use and accurate retailer stock/pricing.
3. Host functioning interactive public application (no API key in browser), publish source + MIT LICENSE in a public repository, create a clear project description and demo video, and submit via original entrant's authenticated Devpost account by the organizer's deadline.
4. Record real provider acceptance, prize and payout separately. Neither finishing source nor Qloo API mock success is an award or payment.

Official Qloo hackathon developer guide: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
Qloo search: https://docs.qloo.com/reference/get-search
Qloo supported params: https://docs.qloo.com/reference/available-parameters-by-entity-type
