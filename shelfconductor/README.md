# ShelfConductor — bookseller desk

An independent-bookstore workflow connecting reader taste to an actual retailer catalog. This is the continuation of the original ShelfConductor entrant, not another hackathon entry. MIT licensed; no package installation, LLM service or database is required.

## Run

From this directory, on Node 22 or newer:

```sh
node src/server.mjs
# Open http://localhost:3000
```

The fictional example works immediately. Live Qloo reads `QLOO_API_KEY` from the **server environment**, never from browser storage, URL parameters or a checked-in file. `PORT` defaults to 3000; `QLOO_CALLS_PER_MINUTE` defaults to 24 (1–120). The server listens on all interfaces: expose it deliberately, behind the intended hosting service. A Dockerfile supplies a no-install container entry point. No paid infrastructure is provisioned by this source.

## Bookseller workflow

1. **Catalog.** Import UTF-8 CSV or exported JSON, review counts, then activate. Invalid uploads leave the existing catalog intact. Search and page through up to 10,000 rows; edit stock, price, ISBN or Qloo linkage in the session. Export JSON to retain exact values and snapshot metadata, or spreadsheet-safe CSV for review. No edit writes to a retailer system.
2. **Reader desk.** Enter one to four favorite titles, one per line, plus a USD budget and maximum number of books. In Live mode, review returned Qloo candidates when a title is ambiguous. The server rechecks explicitly selected IDs against the actual Search results before requesting Insights. Inventory IDs can also be selected from returned book candidates; a Qloo book entity does not establish ISBN/edition identity.
3. **Replan.** Keep a title, exclude one, or include an alternative. The planner respects current stock, exact entity linkage, total budget, count and kept titles. It selects one retailer edition per Qloo book; unpinned editions favor the cheapest available SKU. A kept title that becomes unavailable produces an actionable error rather than silently disappearing. Clear constraints or adjust the catalog, then rebuild.
4. **Handout.** Prepare a printable reading list with title, author, store note, SKU/ISBN, price and supplied stock observation time. Export the complete plan as JSON or selected rows as CSV. Changing inventory, source, reader preferences or store label invalidates the prior result and disables stale exports.

Catalogs remain in browser memory unless explicitly exported. Reader profiles and inventories are not written to server files. Qloo responses use a private five-minute, 256-entry maximum in-process cache with request coalescing; repeated budget, stock and exclusion replans reuse the same provider responses. Cache behavior and quota are per process, not a distributed limit. No checkout, reservation, tax, shipping, payment or customer send takes place.

## Inventory schema

CSV header:

```csv
sku,isbn,title,author,category,price_cents,currency,stock,observed_at,qloo_id,shelf_note
```

Required: `sku`, `title`, `author`, `price_cents`, `stock`. Price is positive integer cents; stock is a nonnegative integer. Blank stock is not zero. Optional `isbn` preserves a 10/13-character identifier with spaces/hyphens removed; this is a format check, **not** ISBN checksum or edition verification. Only USD is supported. `observed_at` is an ISO timestamp with timezone; leave it empty when unknown. Import time is separate and never represented as the time stock was observed. Missing `qloo_id` rows remain visible for review but cannot enter a recommendation. Use authorized retailer data and verified book IDs.

The parser accepts quoted commas, doubled quotes, CRLF and multiline quoted fields, and rejects duplicate headers and malformed quotations. Requests are limited to 8 MiB before UTF-8/JSON decoding; catalogs to 10,000 records. JSON exports preserve exact text, IDs and metadata. CSV exports protect formula-like text with a leading apostrophe for spreadsheet review; use JSON for an exact roundtrip.

## Service and agent integration

`GET /api/health` reports availability and whether a server key is configured. `GET /api/demo-inventory` returns clearly fictional examples. `POST /api/catalog` validates `{inventory:[...]}` without retaining it. `POST /api/search` accepts `{title:"Book title"}` and returns sanitized book candidate titles and IDs.

`POST /api/plan` retains the original request shape:

```json
{
  "mode": "live",
  "inventory": [],
  "seed_titles": ["A favorite title"],
  "seed_selections": [{"title":"A favorite title","qloo_id":"ID actually returned by Search"}],
  "budget_cents": 6000,
  "max_books": 3,
  "include_skus": [],
  "exclude_skus": []
}
```

Replace the empty inventory with actual validated rows. `seed_selections` and `include_skus` are optional. Without a selection, the original unique exact-title resolution is retained. The response includes selected books, alternatives, price totals, per-reason catalog coverage, original Qloo rank, provider affinity only when supplied, and a generation timestamp. Browser exports add their catalog revision/source metadata.

The original Qloo host remains `https://hackathon.api.qloo.com`; requests use server-only `X-Api-Key`, `GET /search` with book type, and `GET /v2/insights` with resolved book entity interests. Responses retain the existing 1.5 MB streamed size limit and timeout. Errors never switch Live requests to fictional results. Local category/rank utility is an explicit heuristic, not a Qloo affinity score or an optimal-knapsack claim.

## Exercise

```sh
node --test tests/shelfconductor.test.mjs
node tests/desk-journey.mjs
```

The six original tests remain byte-identical. One additional source-exact HTTP journey covers catalog parsing, reviewed seed identity, kept/excluded titles, stock changes, duplicate editions, metadata roundtrip and a complete 10,000-row request. Its Qloo transport is recorded and its retailer input fictional. The October 11 engineering run also exercised the actual browser modules against the actual local server, including real file downloads and desktop/mobile layouts. Managed cloud browser navigation used a fixed-target HTTP transport bridge. These results are not a live Qloo replay, hosted-deployment verification or a prize/submission claim.

## Original competition coordination

The [official Qloo Agentic Hackathon rules](https://qloo.devpost.com/rules) give the deadline as **October 30, 2026, 11:45 PM EDT**. They require a working Qloo-integrating agentic application, accessible functional demo, public open-source repository with a visible license, and project description. The [organizer overview](https://qloo.devpost.com/) says a video is not required. Keep the original entrant and its existing provider/catalog/deployment work; do not create a duplicate entry. Judges must retain access through the judging period, ending November 16. Source release and local functional exercises are distinct from that entrant's live-provider, hosting and submission results.

Original source: `woahwhattheheck/public-commons-sprint-2026/shelfconductor`, from PR446 and UTF-8 request repair PR449. This desk revision is based on commit `2610c6a77804787ddc4e18633dc590838ec6b443`. `SOURCE_MANIFEST.json` records original archive lineage and this revision's files.
