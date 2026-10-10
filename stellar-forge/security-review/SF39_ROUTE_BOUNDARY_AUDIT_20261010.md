# SF-39 — Catalog route identity consistency

Reviewed 2026-10-10. Original main 8eb786ce71381b1c8923f4f68252ee0a062dfb27; branch from d5ba3e5973ac96c58048d9df8121e85ab979cb56.

Pinned source blobs: catalog 66beed7c3a4b617ab90680ec5fe8318e934e74f7, SF28 identity d67976f6ab1dea20b676807cc4e9dc0439316022, SF27 trust eac3ec14eb5c88861c31889eb688fad641dda11f, SF25 adapter 5e52169d426cef74cb4f4971e6e3dbaa0cca83d9, SF46 integration 8878165d54215749a903a626bd497f607c25e717.

## Identified issue
The legacy Bazaar catalog decoded optional URL route templates only once. The existing SF28 identity module has bounded multi-pass decoding and rejects encoded path traversal, separators, malformed segments, and ambiguous route templates. Thus `/weather/%252e%252e/admin` can pass the legacy one-pass check while failing SF28. Separately `new URL(raw)` may normalize away an encoded dot segment before validating the original spelling.

## Changed paths
- `scf46-stellar-bazaar/src/catalog.mjs`: delegates template and resource URL inspection to existing SF28. It validates original URLs before URL parser normalization, canonicalizes safe template aliases for keys and output, and strips unsafe optional templates.
- `scf46-stellar-bazaar/test/catalog.test.mjs`: two targeted regressions for repeated encoding, alias canonicalization, raw URL path validation and rejection without catalog mutation.

## Limits and next gates
This is defensive catalog metadata hardening, not evidence of any exploited service or actual payment. The catalog's trusted caller must still authenticate seller authority and confirmed settlement. No external services, CI, payments, private repositories or SCF forms were used. The new regressions are checked into source but no passing test execution is claimed from this cloud seat. A local reviewer can run exactly `node --test scf46-stellar-bazaar/test/catalog.test.mjs`.

Separate SF25/SF39 follow-up: validate size and node budgets before expensive supplied schema info evaluation, with source-exact payloads. SF38 owns actual network protocol conformance; SF40 owns operational load/availability. No full-suite runs, hosted workflows or speculative live metrics.
