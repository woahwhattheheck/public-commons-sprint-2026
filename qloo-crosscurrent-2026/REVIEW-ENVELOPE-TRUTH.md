# CrossCurrent Qloo provider envelope truth — October 9, 2026

**Parent immutable ZIP:** `crosscurrent-qloo-subtype-truth-20261009.zip`, SHA256 `da12b02b0048aa169dac3fbe87f2c9327b20d482e0cfba9420572fb1727c29fb`.

**Problem:** A Qloo request returning HTTP 200 with an unrecognized JSON envelope (e.g. `{ "items": [...] }` instead of a recognized `results` / `entities` shape) silently decoded to `[]` in `arrayOfEntities`. This turned a provider integration break into `NO_ENTITY_MATCH` or empty live insights and **cached the malformed response for five minutes**. It was impossible to distinguish an explicitly valid empty result from a contract mismatch.

**Fix:** Reject unrecognized entity envelopes as `QLOO_RESPONSE_SHAPE_UNRECOGNIZED` (HTTP 502 locally). Validate before storing the five-minute cache entry. Preserve the five pre-existing supported envelope variants and the valid `results: []` no-match case. Do not alter Qloo endpoints, key handling, request quotas, synthetic demo, agent ranking, singleflight or subtype provenance.

**Changed source:** only `src/qloo.mjs` and `README.md`. One new focused fake-responder spec `tests/qloo-envelope-contract.test.mjs` and this review. Other parent entries remain byte-identical.

**Offline validation:** run exactly `node --test tests/qloo-envelope-contract.test.mjs` from the `crosscurrent/` directory. No external connection, real Qloo request, API token, Devpost registration, sponsor acceptance or prize has been performed; test stubs do not establish actual Qloo response shapes.

**Ownership:** Original authorship, existing source and sole entrant authority remain with the parent contributor(s). This ZIP is a private integrator candidate, not a Devpost submission. Integrate only after checking current parent and any concurrent released patch.
