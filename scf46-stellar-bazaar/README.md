# Stellar x402 Bazaar discovery prototype

This is a public, read-only discovery library written in Node.js 22 or later. It is an experimental component, not a deployed Stellar payment facilitator or grant application.

The two HTTP routes are GET /discovery/resources and GET /discovery/search. A trusted integration can insert catalog records with BazaarCatalog.insertValidated after independently validating settlement, seller identity and metadata against the authoritative x402 specification. This library does not perform those validations.

Run the focused local checks with `node --test test/catalog.test.mjs`. The package has no external runtime dependencies. Six tests cover filtering, search pagination, HTTP responses, route normalization, MCP identity and metadata handling.

The source and tests are licensed MIT. No GitHub Actions workflows are included.

## SCF-23: corpus-aware retrieval (October 10, 2026)

The actual `GET /discovery/search?query=...` handler now ranks the filtered, validated Bazaar catalog with a dependency-free, deterministic BM25F-style lexical scorer. It searches verified service names, tags, MCP tool names, descriptions and bounded parameter descriptions, with phrase bonuses and conservative typo tolerance. High-frequency conversational filler is ignored, and tie-breaking uses the canonical catalog key. The existing network/scheme/payTo/type/extensions filters, cursor generation, `partialResults` and response shapes remain unchanged.

`src/ranking.mjs` also exports `rankBazaarEntries(pairs, query)` for source-exact offline evaluation without calling an HTTP server. Focused behavioral checks: `node --test test/ranking.test.mjs`. Ranking is lexical/fuzzy **not** embedding-based semantic retrieval; no quality, latency, marketplace traction, live-provider, or payment result is claimed here. Compare the candidate against the original frozen `src/catalog.mjs` lexical baseline using source-pinned actual published resources and independently defined judgments before claiming a relevance improvement. Source-aware evaluator SF-24 and real facilitator collector SF-29 are the existing integration points. Do not infer a source is listed or trusted merely because the text matched; the facilitator's payment/seller validation boundary remains authoritative.
