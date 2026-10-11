# Native catalog query engine

`BazaarCatalog` now serves repeated list pages and search cursors from an in-process,
revision-invalidated query index. Existing SF60, Atlas, HTTP discovery and pricing
callers get this through the **same original catalog class**. There is no replacement
catalog, additional service, dependency, network call, installation step or new state file.
The change does not touch seller admission, payment verification or settlement.

## What changes operationally

- Unfiltered listing builds canonical key order once. Repeated offsets and limits
  reuse the result. Replacing an existing value does not unnecessarily sort its key again.
- Filtered reads intersect typed postings for transport, extension and payment fields,
  beginning with the smallest posting. Every survivor must still satisfy all payment
  fields within **one actual accepted option**. A testnet option and an unrelated pubnet
  recipient never combine into an invented offer.
- Search invokes the existing `rankBazaarEntries` on exactly the same filtered corpus,
  in the same insertion order, then reuses that ranking for subsequent cursors/limits.
  The first new query still pays for the original ranking. This does not change its
  fuzzy matching, field weights, score reductions, canonical tie breaks or relevance.
- Existing insert, replace and retirement operations immediately discard cached results.
  Once built, postings update incrementally. Missing-key retirement changes neither the
  original version nor the cache. A staged clone gets its own Map and fresh query state.

Public reads still clone only returned pages. A caller changing a result cannot change
an authoritative record or a later page. The public HTTP JSON, pagination envelope,
errors, `no-store` header and stale-cursor rejection remain unchanged. This is internal
memoization, **not HTTP/browser caching** and not retention of old catalog revisions.

Caches share an LRU limit of 64 results and 200,000 row references. Oversize results are
computed but not retained. Query keys include exact filters and query text, not a lossy
hash. Values reference already-owned rows rather than duplicating their bodies. Index
postings and canonical ordering are proportional to the current authoritative catalog;
all memory is released with that catalog instance.

## Inspect an existing instance

```js
console.log(catalog.queryStats);
```

This returns a detached numeric snapshot: list/search hits and misses, index/order
builds, candidate checks, ranking runs, evictions, invalidations, indexed entry count,
and retained result/reference counts. It includes no query strings, URLs, recipients,
resource bodies or payment data. Counters are lifetime-local to that catalog instance;
a transaction clone starts new counters. Nothing is added to the HTTP surface.

## Run the native workload

From the repository root, on Node 22 or newer:

```sh
node scf46-stellar-bazaar/tools/query-workload.mjs --rows 12000
```

This single journey uses the actual catalog, ranking, pricing and native HTTP handler.
It covers a generated structurally valid workload of mixed HTTP/MCP records with two
independent payment options, repeated list/search pagination, selective and cross-option
filters, pricing, replacements, retirement/reinsertion, clone and returned-page isolation,
cache eviction, stale cursors and HTTP error responses. It prints JSON to stdout; no
hosted CI, wallet, remote merchant traffic or generated proof files are needed.

For source-to-source differential comparison, provide a separately retained, trusted
copy of the original catalog module **in its original `src/` directory** so relative
imports resolve against the same original dependencies. In an existing Git checkout:

```sh
git show e9c55da8f79a444d88be2cf6954a7e1e0bb9fe6a:scf46-stellar-bazaar/src/catalog.mjs \
  > scf46-stellar-bazaar/src/catalog.before-query-index.mjs
node scf46-stellar-bazaar/tools/query-workload.mjs --rows 12000 \
  --baseline scf46-stellar-bazaar/src/catalog.before-query-index.mjs
```

The baseline catalog blob is `7a0af880f4281fae47ae04403644f7a8d4bc3b3b`.
The runner reports the baseline blob, corpus digest, native runtime, cold load timing,
identical page comparisons and separately measured 120-list-page/12-search-page journeys.
There are no timing pass/fail thresholds; CPU, corpus, Node/ICU, warmup and memory pressure
influence the measured ratio. Speedups on repeated queries do not imply cheaper cold
ranking, bulk writes, faster payments or measured real customer traffic.

An operator can exercise an existing private complete catalog export instead:

```sh
node scf46-stellar-bazaar/tools/query-workload.mjs \
  --catalog /private/catalog-resources.json
```

Input is a resource array or original `{ "resources": [...] }` envelope. The runner
only changes its own disposable in-memory instances; it never writes to the source or
SF60 journal. Supply a complete export, not an isolated page presented as the full catalog.
Use `--baseline` as above for identical-output comparison. Keep private input private;
stdout contains only aggregate timings/counts and source digests, not resource rows.
