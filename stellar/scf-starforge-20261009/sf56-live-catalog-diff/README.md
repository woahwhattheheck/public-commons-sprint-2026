# SCF SF56: native live-Bazaar catalog change intelligence

MIT. A **read-only**, additive operator workbench for Stellar Community Fund's actual x402 v2 Bazaar product. It compares **two complete original facilitator observations** and produces an actionable route-level delta. It does not mint payment receipts, buy a service, verify/settle payments, query paid sellers, or invent provider entries. There is no hosted GitHub Actions dependency.

## One actual capture, then another

Use the existing **SF41 original-source capture owner** and the existing Muse run, not another clone of the controller. The Oct 10 existing Vellar testnet full corpus captured **27/27 original rows** with the original HTTPS source and SHA256 in #sim-data; those artifacts remain with that owner. SF56 requires a later independently complete capture **of the exact same documented facilitator and query-filter scope** before a live delta can exist.

1. Capture native, paginated `GET /discovery/resources` pages using [SF41 capture.mjs](../sf41-real-source-replay/capture.mjs) and its owner-approved source configuration. Preserve BOTH `sources.json` manifests and their original raw JSON page files, never just a screenshot or a paraphrased response. The original `capture.mjs` enforces v2 pagination and SHA256 source provenance.
2. Run `node stellar/scf-starforge-20261009/sf56-live-catalog-diff/diff.mjs --before /absolute/old/sources.json --after /absolute/new/sources.json --out /absolute/new/catalog-delta.json`.
3. Review `catalog-delta.json` summary and all `priority: REVIEW` routes. Operator review matters most for removals, changed accepted payment options and changed HTTP/MCP input contracts. Metadata-only and new observed listings are informational.
4. Pass actual per-capture source SHA, complete rows, delta SHA and noteworthy original resource identity changes back to existing SCF SF10 grant, SF24 catalog quality, SF41 replay and SF50 quote-reconciliation owners. **Do not use the diff as permission to spend or proof of seller identity or settlement.**

## What it verifies before producing a result

- Each manifest must be original `SCF-SF41/capture-v1`, a **single** provider, with fully verified SF41 continuous native pagination, matching original page GET SHA256 bytes and captured row totals. A truncated, altered or stitched corpus **fails closed**.
- Every compared source must be an authorized/public original GET (`200`) with captured UTC time and source URL. The two provider endpoints and their **nonpagination filters** must match exactly. A changed `network`, for example, cannot masquerade as an observed seller delisting. Offset and `limit` pagination mechanics may differ.
- Route IDs follow the actual existing [SF45 canonical identity](../sf45-discovery-recovery/recovery.mjs) on the same documented SF41 original-provider shape. Duplicate canonical rows fail instead of hiding conflicting payment terms.
- Accepted offer tuples are hashed canonically with offer-list order independent. Bazaar HTTP/MCP input contract + schema + route template are hashed separately from human-facing descriptive metadata, so only actual changed fields are counted. The report retains observed route ID and before/after digests, not raw payee addresses.
- Delta ordering and key sorting are deterministic. Every change includes `REVIEW` or `INFO`, two source timestamps + SHA256 manifest provenance and explicit source-coverage status. Data remain **observations**, not seller attestation or price authorization.

## Source pins / integration

Original public main source at claim time (2026-10-10): SF41 `capture_coverage.mjs` Git blob `8414b34ee57fba1cd783245755f4ff88725c419b`; SF45 `recovery.mjs` blob `c0eaa456cc05fb7b1c121ff3a77b4fdfed596621`. SF41 `run.mjs` is the original provider-schema adapter reference, blob `6c5378c5d01f2449ac609b448a0b9e31c4beafa3`. These are dependency identity receipts, not a frozen fork; later code should be rechecked against current main before replay.

One focused native-format contract check: `node --test stellar/scf-starforge-20261009/sf56-live-catalog-diff/diff.test.mjs`. It tests the format and failure handling only; **real** provider delta requires two distinct original SF41 captures. Existing Muse owns any broad original-corpus replay. No wide repository suite or hosted CI should be launched for this addition.