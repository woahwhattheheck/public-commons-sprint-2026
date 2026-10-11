# Live operator guide

1. Install Node.js 22 or newer. Run `node server.mjs` to inspect the explicitly synthetic demo. No npm install or Qloo key required. An unset `ACCESSLENS_MODE` defaults to `fixture`; explicit values must be exactly `fixture` or `live`. A blank, misspelled or differently cased mode fails at startup before provider activity, rather than starting a fictional demo by accident.
2. For **live** data, obtain an official Qloo hackathon API key and keep it strictly in the server environment (`QLOO_API_KEY`). Set `ACCESSLENS_MODE=live` and `ACCESSLENS_VENUES_FILE` to an absolute path outside any public repository. All API requests go to `https://hackathon.api.qloo.com` and use `X-Api-Key`.
3. The private JSON catalog must be a top-level array of venue records with unique, *real* `qloo_id` values obtained by official Qloo `/search` against `urn:entity:place` and independently audited `id`, `name`, `city`, `capacity` (integer), `cost_usd` (number), `step_free`, `low_sensory`, `accessible_toilet` (each true/false), `audit_source` (human-readable evidence), `audit_date` (`YYYY-MM-DD`). Synthetic example:

```json
[{"id":"sample-private-id","qloo_id":"REPLACE_WITH_VERIFIED_QLOO_PLACE_ID","name":"EXAMPLE ONLY","city":"EXAMPLE","capacity":50,"cost_usd":15,"step_free":true,"low_sensory":false,"accessible_toilet":true,"audit_source":"Operator venue inspection 2026-10-09","audit_date":"2026-10-09"}]
```

4. Live requests resolve the **exact** artist name via GET `/search?query=...&types=urn:entity:artist`, then GET `/v2/insights?filter.type=urn:entity:place&signal.interests.entities=<canonical artist ID>`. Matching is by real returned place IDs *only* — there is no name-based fallback and no fabricated provider result. If Qloo returns a different envelope or subtype, the service reports an error rather than silently accepting it.
5. **Audit recency (live):** AccessLens only considers operator venue audits that are not future-dated and are no older than **180 UTC calendar days** by default. Set `ACCESSLENS_MAX_AUDIT_AGE_DAYS` to a documented operator policy (integer 1–365; default 180); records beyond the window are rejected with `audit_older_than_policy_window`, future records with `audit_dated_in_future`. Invalid calendar dates (e.g. 2026-02-30) prevent catalog loading. This is a *recency filter*, not independent verification of accessibility, booking capacity or route. The fully fictional fixture uses an explicit pinned October 9, 2026 evaluation date for reproducible offline demos; it is never current real-world evidence.
6. Rate limits: client 8 planning requests/minute; server-global 30 Qloo requests/hour by default; a new affinity retrieval reserves two calls and permits one in-flight live plan. A successful artist response can be reused briefly when someone changes access needs, group size, city or budget. Such replans make **zero** new Qloo calls and run the original venue/audit checks again. The same client rate cap and single-flight admission still apply. These are **single-process** limits; deploy one process unless you add external coordination and shared atomic quota storage.
7. Deploy `HOST=0.0.0.0 PORT=<provider port>` behind HTTPS ingress with request-size limits and an upstream proxy rate cap. The app does not implement authentication or durable per-user consent, so the public demo should contain no private patron profiles, venue contacts or personal data. Add authentication/consent before production use. Do not expose the operator JSON file over static hosting.
8. Obtain venue consent for accessibility claims where required; verify routes, current accessibility, toilets, hours, booking, and event suitability directly. Qloo only provides taste affinity; AccessLens does not assert real-world access compliance or a successful accessible journey.

## Replanning and affinity freshness

`ACCESSLENS_AFFINITY_REUSE_SECONDS` is an integer from 0 to 300 (default 120). Set it to `0` to require a new provider retrieval for every plan. Reuse is scoped to the server's immutable Qloo configuration and exact trimmed artist query; spelling, case and Unicode alternatives are separate provider queries. No city/access preference is sent to Qloo by the current adapter, so these preferences never alter the affinity cache key. If provider-affecting parameters or credentials become dynamic, bind all of them into the cache identity or use separate instances before enabling that feature.

Every live response reports `providerCalls` for that request and `providerCapture` with the original `capturedAtUTC`, monotonic `ageMs`, `reuseWindowMs`, and `reused`. The visible notices also identify reused evidence. An expired response is removed before attempting another retrieval; provider errors are never cached or replaced with old data. Time spent reusing a response does not extend its original deadline. Provider ranking is preserved, while the catalog, requested city, access, capacity, budget and current UTC audit recency are all recomputed on each plan.

At most 16 parsed artist/place-ID responses are retained in process memory, with a 256 KiB conservative per-entry serialization bound. A larger valid response serves its initial request without being retained. Raw provider bodies, API keys, operator records, patron constraints and completed plans are not stored in this cache. Restarting the process empties it. The cache does not make a response independently verified, does not establish provider-wide rank completeness, and does not satisfy the pending real-provider replay or hackathon submission.

## Prize/launch status

Source is a contest candidate, **not** an entry. Hosted interactive URL, live provider credentials, and original entrant Devpost submission remain to be completed by an authorized operator. No cash award, payment, account signup, key activation, or real provider response is represented here.

Official references:
- https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
- https://docs.qloo.com/reference/get-search
- https://docs.qloo.com/reference/insights-api-deep-dive
- https://qloo.devpost.com/rules
