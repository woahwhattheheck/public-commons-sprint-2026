# SF-41: original-source Bazaar research and provider replay

MIT. This is an executable full-corpus read-only research workbench for the ACTUAL mainline x402 Bazaar discovery implementation. It does not create a new Bazaar implementation, synthesize provider items, pay origins, verify or settle payments, or claim live settlement. Existing Muse, cloud and local logged-in workers should run broadly against authorized ORIGINAL facilitator captures. No GitHub Actions or hosted CI.

## Source and protocol anchors

- Original source: [BazaarCatalog](../../../scf46-stellar-bazaar/src/catalog.mjs). Pinned default Git blob SHA-1 at this revision: 7b4390f9a119399bdb8e27db5796697f1314da8b (original first SF41 runner pinned 66beed7c3a4b617ab90680ec5fe8318e934e74f7, which is now historical). run.mjs verifies the actual imported source bytes in Git blob format and refuses to run if changed. Generated run output records the **expected source Git blob SHA-1**, **actual source Git blob SHA-1**, and content SHA-256. No automatic "latest" or unverified checkout fallback.
- Exact [x402 Bazaar extension](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md) permits read-only GET /discovery/resources (offset pagination) and GET /discovery/search (query/cursor), with filters type/payTo/network/scheme/extensions. Opaque cursor values must be reused unchanged. This does not permit paid origin calls as part of discovery.
- [Stellar x402 documentation](https://developers.stellar.org/docs/build/agentic-payments/x402): no mainnet payment or private wallet keys are part of this workflow.
- [SF49 first-party issue ledger](../../scf_2026/SF49_PUBLIC_SIGNALS_20261009.json): nine public reports; public-issue-query-probes.json contains derived, UNLABELED engineering queries. They are not live user query logs and not a search relevance ground truth. To add true judgments, supply known relevant canonical entry IDs and a label_source URI per query.
- Lane ownership: SF24 owns real-corpus quality labels; SF42 owns search index optimization; SF45 owns resilient client; SF50 owns quote-term reconciliation. This SF41 workstream supplies original captures, strict native source replay, performance/provenance and reusable Muse/cloud experiments, not a duplicate search system.

## Collect complete real provider resources

From project root, using an operator-authorized *actual* HTTPS facilitator whose original GET resources endpoint is accessible:

    node stellar/scf-starforge-20261009/sf41-real-source-replay/capture.mjs --url https://facilitator.example.org/discovery/resources --id provider-01 --out /tmp/scf41-provider --permission public-read

Example hostname is a PLACEHOLDER, not a claimed live resource. Operators MUST substitute an original confirmed provider endpoint, not a web-search result, spoof, or undocumented proxy.

If an actual original provider requires auth, use an EXISTING authorized environment variable (never paste tokens into code, Slack, URL or argument):

    node stellar/scf-starforge-20261009/sf41-real-source-replay/capture.mjs --url https://facilitator.example.org/discovery/resources --id provider-02 --out /tmp/scf41-provider-auth --permission authorized-operator --bearer-env SCF41_FACILITATOR_TOKEN

capture.mjs restricts traffic to original HTTPS facilitator GET /discovery/resources; never accesses payment origin, /settle or /verify. It refuses redirects, honors relevant Retry-After headers and fetches ALL native offset pages without an arbitrary max-page quota. Raw response bytes, origin URL, status, retrieval timestamp, SHA-256, declared access mode and measured latency are saved in sources.json and page files. This is *real provider retrieval*, not reverse-engineered page text.

A complete capture checks native pagination offset, total and duplicates across all pages. Short pages are not terminal while more rows remain. Without a total, capture continues to the explicit empty page. Each response streams through a 16 MiB per-page limit; saved artifacts use exclusive creation to protect prior runs. The manifest records `pagination_coverage`. After an interrupted capture, choose a new output directory. Run the five source-level regressions with `node --test stellar/scf-starforge-20261009/sf41-real-source-replay/test/capture-integrity.test.mjs`; existing Muse/local teams handle full first-party source execution separately.

For several authorized independent captures, combine the sources arrays in one sources.json, copying exact raw JSON pages into that manifest's directory and avoiding conflicting filenames. Each SHA256 is independently rechecked.

## Full native source replay

    node stellar/scf-starforge-20261009/sf41-real-source-replay/run.mjs --manifest /tmp/scf41-provider/sources.json --queries stellar/scf-starforge-20261009/sf41-real-source-replay/public-issue-query-probes.json --out /tmp/scf41-run --repeat 5

The runner imports the ACTUAL owner BazaarCatalog/createDiscoveryServer/validateCatalogEntry; no forks or mocks.

The original Bazaar source can legitimately evolve as other authorized engineering owners merge. First verify the intended source **commit and actual contents Git blob SHA-1**, then supply `--catalog-blob <40 lowercase hex Git blob SHA-1>` explicitly whenever using a different approved checkout. The run refuses any non-hex or mismatched supplied pin, rather than silently accepting drift. The default is only for the source revision used for this two-file fix; use the known source commit and verify SHA before cross-version comparisons. A blob override does not change imported code or prove current-provider behavior. The original provider captures and their hashes are independently required unchanged. Payment terms, MCP identity, network, resource URL and discovery schema are never invented. It only adapts documented original provider fields (top-level metadata or resource URL strings) and records every structurally rejected entry with original source/page/index. Duplicate canonical identities with different terms are flagged, not silently overwritten. Full manifest and query SHA256 are preserved.

Every query is repeated against actual BazaarCatalog.search. The runner opens an ephemeral localhost listener backed by the REAL createDiscoveryServer and exercises complete native GET /discovery/resources and GET /discovery/search cursor traversal, native resource count coverage, loop protection and direct function/GET first-page parity. Output is:
- run.json — actual source SHA; original raw file hashes; row counts/rejections; duplicate conflicts; p50/p95 runtime and HTTP latency.
- cases.json — each run's actual original ranked canonical IDs, query/filter set and candidate comparison if supplied.
- original-http-pages.json — real original native server complete cursor pages and canonical IDs.
- ingest-anomalies.json — first-party source row rejections and canonical key/payment conflicts.

The checked-in nine issue-linked queries are **not scored as relevance ground truth**. Actual unlabeled runs provide native execution, structural fidelity and latency only. To compare retrieval precision/recall, construct independent real relevance judgments that refer to accepted canonical item IDs and include provenance.

## Compare real candidate on identical source corpus

A trusted local candidate must export async function search(catalog, URLSearchParams) returning native-shaped resources/pagination. Invoke run.mjs with --candidate /absolute/path/to/candidate.mjs. Baseline and candidate receive the same original full source snapshot, validated entries, filters and query set. Compare latency on the same machine; scoring occurs only for queries with independent actual judgments. SF42 can adapt its index module with a thin wrapper. No candidate is inferred to have better ranking from latency alone.

## Muse/cloud instructions

Capture ALL authorized pages for every original provider, full query labels and original per-page SHAs. Do not cap to a token-budget-friendly handful of samples. Replay on each source revision pin. Include original network/provider status and actual UTC timestamps; test source order and genuine provider row churn, stale opaque cursor failure, method/route mismatch, MCP canonical IDs and financial/HR/payroll-like vertical query variants when available from real sources. Run broader matrix of seeds/queries/repeats on existing local/Muse engines, preserving the genuine original artifacts. Compare frozen incumbent to actual candidate on identical version/inputs, not an imaginary protocol or fabricated purchase receipts. Post run manifests and output hashes in #sim-data and route failures to SF24/SF42/SF45/SF50 owners.

SCF submission and outside outreach remain on owner HOLD. Do not trigger GitHub-hosted workflows or large unrelated repository test suites.
