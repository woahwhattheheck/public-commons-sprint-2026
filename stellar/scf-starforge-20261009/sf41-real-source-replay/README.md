# Bazaar capture and source replay

Capture complete public or authorized facilitator catalogs, replay them through the
original Bazaar catalog and HTTP handler, and compare ranking implementations on the
same records. The workbench uses Node and the existing source modules.

The package is MIT licensed. Its main entry points are:

| Command | Purpose |
| --- | --- |
| `capture.mjs` | Save every original resources page, its raw bytes and capture manifest |
| `run.mjs` | Ingest the capture through the maintained catalog, run queries and exercise HTTP pagination |
| `ranking-comparison.mjs` | Compare original one-shot and indexed ranking sources inside a replay |

## Capture a complete catalog

From the repository root:

```sh
node stellar/scf-starforge-20261009/sf41-real-source-replay/capture.mjs \
  --url https://vellar-facilitator-testnet-production.up.railway.app/discovery/resources \
  --id vellar-stellar-testnet \
  --out /absolute/new-vellar-capture \
  --permission public-read \
  --network stellar:testnet
```

Use a new output directory. The original collector supports `--type`, `--payTo`,
`--scheme`, `--network` and `--extensions`, with each flag at most once. For an
authenticated provider, select its existing credential using
`--permission authorized-operator --bearer-env VARIABLE_NAME`.

The collector preserves identical filters across offset pages. It reads through the
declared total, or through an explicit empty terminal page when the provider omits a
total. A short page alone does not end a capture. A changing total, duplicate page
or discontinuous offset fails the capture. Each response has a 16 MiB streaming limit.

`sources.json` records the exact GET URL, response status, retrieval time, raw-byte
SHA-256, access mode and pagination coverage. The page files retain the original
JSON response bytes. Keep the manifest and those files together. Filters define the
captured corpus: a Stellar testnet capture and an unfiltered provider capture are
different inputs.

## Replay the original catalog and HTTP surface

`run.mjs` imports the maintained
[`BazaarCatalog`](../../../scf46-stellar-bazaar/src/catalog.mjs),
`validateCatalogEntry` and `createDiscoveryServer`. It checks the catalog's actual
Git blob hash before importing captures into the existing catalog.

Supply the exact catalog blob from the checkout being evaluated:

```sh
node stellar/scf-starforge-20261009/sf41-real-source-replay/run.mjs \
  --manifest /absolute/new-vellar-capture/sources.json \
  --queries stellar/scf-starforge-20261009/sf41-real-source-replay/public-issue-query-probes.json \
  --out /absolute/new-replay \
  --repeat 5 \
  --catalog-blob CATALOG_GIT_BLOB
```

`CATALOG_GIT_BLOB` is the complete lowercase 40-character Git blob SHA for
`scf46-stellar-bazaar/src/catalog.mjs`. The built-in historical pin is
`7b4390f9a119399bdb8e27db5796697f1314da8b`; the explicit override supports newer
maintained checkouts. Both expected and observed hashes appear in the report.

Ingestion uses the original provider field mapping: a resource URL string becomes a
resource object, and top-level description, service name, tags and icon URL fill
missing resource fields. Original payment options, Bazaar schemas and MCP tool
metadata are retained. Every rejected row and conflicting duplicate canonical key
is recorded. The capture manifest and each raw page checksum are checked before
scoring.

The replay runs the actual catalog search, then opens its original HTTP handler on
an ephemeral loopback port. It traverses the complete resources list and every search
cursor, checks total coverage and verifies direct-call/HTTP first-page agreement.

| Output | Contents |
| --- | --- |
| `run.json` | Source and input hashes, capture coverage, row counts and measured latency |
| `cases.json` | Actual query/filter sets, ranked canonical IDs and per-run timings |
| `original-http-pages.json` | Complete HTTP search cursor results |
| `ingest-anomalies.json` | Original source/page/row rejection and duplicate details |

For one provider, replay verifies the contiguous original page chain and declared
total or explicit empty terminal page. A combined multi-provider manifest retains
individual byte checksums and is identified as a mixed corpus; preserve each
provider's original manifest for its individual completeness result.

## Compare lexical ranking sources

The existing result cache is useful for serving repeated queries. To measure the
lexical engine itself, select the complete baseline and candidate
`ranking.mjs` files:

```sh
node stellar/scf-starforge-20261009/sf41-real-source-replay/run.mjs \
  --manifest /absolute/new-vellar-capture/sources.json \
  --queries stellar/scf-starforge-20261009/sf41-real-source-replay/public-issue-query-probes.json \
  --out /absolute/new-ranking-comparison \
  --repeat 5 \
  --catalog-blob CATALOG_GIT_BLOB \
  --ranking-baseline /absolute/baseline/scf46-stellar-bazaar/src/ranking.mjs \
  --ranking-candidate /absolute/candidate/scf46-stellar-bazaar/src/ranking.mjs \
  --ranking-repeat 60
```

Both files must export the original `rankBazaarEntries` function and
`BazaarRankingIndex` class. Their raw bytes, Git blob hashes and SHA-256 hashes
are recorded. The original catalog supplies the exact normalized rows and applies
the original query filters before each selected subset reaches the rankers.

The comparison first checks exact canonical IDs, floating-point scores and order
between each source's one-shot and indexed APIs. It then records baseline/candidate
result additions, removals, rank changes and score changes for every query.

First preparation is measured separately. Three warmup batches precede the default
60 measured batches, alternating which source runs first. Each batch contains the
complete original query set and bypasses the outer result cache. The resulting
`ranking-comparison.json` includes individual samples, median and p95 batch time,
process CPU time, memory observations and each maintained index's token/posting
counters. Memory observations describe the replay process holding both indexes;
the counters describe each index's own retained state.

A separate schema-query section derives queries from the captured HTTP query/body
fields and MCP argument schemas. Each query retains the actual property name,
title, description, schema location and canonical source row. It records where those
source rows appear in each ranking, along with all observed result changes. The
walk follows local references and schema composition within the original document,
using the same 128-node, depth-16 and 32-child traversal bounds as the maintained
request metadata index. These additional queries do not enter the nine-probe timing
batches. They measure discoverability of published request annotations.

The regular `run.json` links that comparison and records how many queries changed.
This retains the existing end-to-end catalog and HTTP replay beside the lexical
comparison, with their different timing scopes stated explicitly.

A separate custom search experiment can still use `--candidate /absolute/module.mjs`.
That module exports `search(catalog, URLSearchParams)` and returns the original
resources/pagination response shape.

## Interpret the queries and results

The checked-in nine queries come from the
[first-party issue source ledger](../../scf_2026/SF49_PUBLIC_SIGNALS_20261009.json).
Each retains its full issue URL, ID, query, page size and original filter. They
exercise reported developer needs such as method/body handling, MCP discovery,
pricing and spend control.

The probe file is an engineering workload. Its observed ranked results and timing
can compare source changes. Search relevance labels require independently selected
canonical resource IDs and a source for those judgments; the existing query format
supports `relevant` and `label_source` for that purpose.

Request-schema indexing can legitimately add matches or change scores. Compare the
actual changed rows and their published metadata alongside the measured preparation,
query and memory cost. Keep the captured corpus and query file fixed for a source
comparison. A fresh provider capture is a separate run so source improvements and
provider changes can be assessed independently.

## Continue through the native buyer

The merchant workspace's
[`catalog-native-journey.mjs`](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar-forge/mcp-paid-agent/catalog-native-journey.mjs)
extends the observed workflow through the installed buyer SDK: complete discovery,
selection from a later original page, durable preparation, original operator
execution, history and complete saved-result download.

That journey connects to the actual configured native workspace, using its existing
route, payment terms, operator approval and signer. Its phase timings describe the
client process and observed MCP round trips. Keep those results beside the catalog
replay to assess search performance and the full developer workflow.

## Protocol and maintenance references

The current contract is the
[x402 Bazaar extension](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md).
Stellar integration guidance is maintained in
[Stellar Developer Docs](https://developers.stellar.org/docs/build/agentic-payments/x402).
The [SCF RFP](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track)
calls for natural-language ranking, ongoing quality evaluation, HTTP and MCP
discovery, complete pagination and working agent purchases.

Run comparisons on the same native runtime and machine when assessing timing.
Retain Node version, source hashes, current CPU load, complete provider captures
and the original query provenance with the resulting measurements.
