# Live operator guide

1. Install Node.js 22 or newer. Run `node server.mjs` to inspect the explicitly synthetic demo. No npm install or Qloo key required.
2. For **live** data, obtain an official Qloo hackathon API key and keep it strictly in the server environment (`QLOO_API_KEY`). Set `ACCESSLENS_MODE=live` and `ACCESSLENS_VENUES_FILE` to an absolute path outside any public repository. All API requests go to `https://hackathon.api.qloo.com` and use `X-Api-Key`.
3. The private JSON catalog must be a top-level array of venue records with unique, *real* `qloo_id` values obtained by official Qloo `/search` against `urn:entity:place` and independently audited `id`, `name`, `city`, `capacity` (integer), `cost_usd` (number), `step_free`, `low_sensory`, `accessible_toilet` (each true/false), `audit_source` (human-readable evidence), `audit_date` (`YYYY-MM-DD`). Synthetic example:

```json
[{"id":"sample-private-id","qloo_id":"REPLACE_WITH_VERIFIED_QLOO_PLACE_ID","name":"EXAMPLE ONLY","city":"EXAMPLE","capacity":50,"cost_usd":15,"step_free":true,"low_sensory":false,"accessible_toilet":true,"audit_source":"Operator venue inspection 2026-10-09","audit_date":"2026-10-09"}]
```

4. Live requests resolve the **exact** artist name via GET `/search?query=...&types=urn:entity:artist`, then GET `/v2/insights?filter.type=urn:entity:place&signal.interests.entities=<canonical artist ID>`. Matching is by real returned place IDs *only* — there is no name-based fallback and no fabricated provider result. If Qloo returns a different envelope or subtype, the service reports an error rather than silently accepting it.
5. **Audit recency (live):** AccessLens only considers operator venue audits that are not future-dated and are no older than **180 UTC calendar days** by default. Set `ACCESSLENS_MAX_AUDIT_AGE_DAYS` to a documented operator policy (integer 1–365; default 180); records beyond the window are rejected with `audit_older_than_policy_window`, future records with `audit_dated_in_future`. Invalid calendar dates (e.g. 2026-02-30) prevent catalog loading. This is a *recency filter*, not independent verification of accessibility, booking capacity or route. The fully fictional fixture uses an explicit pinned October 9, 2026 evaluation date for reproducible offline demos; it is never current real-world evidence.
6. Rate limits: client 8 planning requests/minute; server-global 30 Qloo requests/hour by default; live admission reserves two calls and permits one in-flight live plan. These are **single-process** limits; deploy one process unless you add external coordination and shared atomic quota storage.
7. Deploy `HOST=0.0.0.0 PORT=<provider port>` behind HTTPS ingress with request-size limits and an upstream proxy rate cap. The app does not implement authentication or durable per-user consent, so the public demo should contain no private patron profiles, venue contacts or personal data. Add authentication/consent before production use. Do not expose the operator JSON file over static hosting.
8. Obtain venue consent for accessibility claims where required; verify routes, current accessibility, toilets, hours, booking, and event suitability directly. Qloo only provides taste affinity; AccessLens does not assert real-world access compliance or a successful accessible journey.

## Prize/launch status

Source is a contest candidate, **not** an entry. Hosted interactive URL, live provider credentials, and original entrant Devpost submission remain to be completed by an authorized operator. No cash award, payment, account signup, key activation, or real provider response is represented here.

Official references:
- https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
- https://docs.qloo.com/reference/get-search
- https://docs.qloo.com/reference/insights-api-deep-dive
- https://qloo.devpost.com/rules
