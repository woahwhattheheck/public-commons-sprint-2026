# SignalGuard — audience-intelligence evidence auditor

**Separate original Qloo Agentic Hackathon 2026 candidate** (not CultureBridge, CrossCurrent, TasteBench or TasteTrace). Status: working **local synthetic demo** with production Qloo API code; **no live Qloo key available in this build seat**, so no live response, hosted URL or Devpost submission is claimed. Sponsor 2026 rules deadline: **2026-10-30 23:45 EDT**. Cash award pool: **$25,000** ($15k/$6k/$4k), conditional on sponsor selection and eligibility, not guaranteed.

## The product, not just a dashboard

A marketer or film-programming team proposes a cultural anchor (artist, movie or book). The autonomous four-step SignalGuard agent:

1. Resolves text to a unique entity via Qloo's documented `GET /search` (`query`, `types`), reports an exact vs best-match selection.
2. Retrieves 15 category-matched neighbors via Qloo `GET /v2/insights` with `filter.type`, `signal.interests.entities`, and `take`.
3. Reads the baseline popularity distribution and selects a capped, data-dependent threshold (0.25–0.80), then runs two independent Qloo Insights probes using **documented** `filter.popularity.max` and `filter.popularity.min` (supported for `movie`, `book`, `artist`).
4. Compares entity IDs across the three sets, surfaces new names by segment, shows trace/warnings and summarizes only observed retrieval counts. If a query fails, the agent abstains from the missing inference instead of substituting fake affinity evidence.

The result is an **audit of recommendation sensitivity to an explicit popularity filter**, not a prediction of what a population likes, an ethical fairness certificate, audience demographics or revenue. This addresses an actual professional problem: creative teams tend to mistake highly ranked, highly popular items for representative discovery options. Sensitivity testing reveals candidates hidden by default sorting/filter choices, while preserving the need for manual business validation.

## Run on Node.js 22+

```bash
npm start
# browse http://127.0.0.1:3108
```

Defaults to the **SYNTHETIC DEMO** mode with entirely invented titles and numbers; these are never labeled as real Qloo evidence. The app has no external npm dependencies. To enable **LIVE QLOO** mode, provide an already-authorized hackathon key only to the server:

```bash
QLOO_API_KEY='(server-side key)' npm start
```

Never commit `.env` or the key. The server uses only `https://hackathon.api.qloo.com` (not production or staging), `X-Api-Key` header, and the documented GET `/search` and GET `/v2/insights` paths. It does not use unsupported legacy `/recs` or `/recommendations`, upload Qloo data to a repo, or pass API keys to the browser. Qloo hackathon keys are issued separately from the [developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide). The browser requests the same-origin Node server, and live calls require the environmental secret. The app stays on `127.0.0.1` by default. For a public demo, set `HOST=0.0.0.0` explicitly on a hosting service behind HTTPS, and provide `QLOO_API_KEY` in its **server-only** secret settings. The server refuses API-key-bearing redirects, caps streamed upstream JSON bodies at **1 MiB**, and enforces the **12-second timeout through body consumption**, not merely response headers. The server has a conservative in-memory limit of **12 fresh live audits per rolling hour** (configurable with `MAX_LIVE_AUDITS_PER_HOUR`), at most three distinct concurrent audits, a five-minute successful-result cache, and in-flight coalescing by exact mode and normalized query. Each fresh audit makes up to three Qloo requests; cache/coalesced requests do not duplicate them. `/api/status` exposes remaining demo budget without revealing inputs or keys. **These in-process limits reset on restart and are not distributed across multiple instances**; restrict the demo to one process or add infrastructure-level quotas/proxy controls. Verify the actual Qloo response contract with a real hackathon key before claiming live operation or deployment.

## API & interpretation rules

- The target types are restricted to `urn:entity:movie`, `urn:entity:book`, `urn:entity:artist`; all support the three documented probe parameters. The search `types` parameter's accepted values differ from insights `filter.type`; these three common types are used in both endpoints.
- `popularity` may be absent; then the median is not reported and the app uses a transparent neutral 0.55 threshold.
- Empty baseline triggers an **abstention**. Missing sliced evidence leads to explicit `unavailable` segments; it does **not** produce fabricated live metrics. API 401/429/timeouts surface honestly; no retry storm.
- The low-/high-popularity probe overlap measures **result-set intersection** with baseline, not statistical model reliability, fairness, representativeness, or causality. Segment results depend on Qloo's retrieval and filtering.
- Search may select a non-exact entity if an exact title is not found; that selection is visible and should be manually reviewed before a business decision.
- No user inputs, API responses or credentials are stored to disk or sent to third parties beyond the user's authorized Qloo API search/insights requests.

## Focused checks (no broad suite)

`npm run check:transport` exercises upstream redirect refusal, bounded streamed JSON and response-deadline handling with fake network responses. `npm run check:integrated-quota` verifies combined hourly/direct-TCP-peer budgets using fake provider calls. `npm run check:focused` verifies the original agent synthetic/provider contract. `npm run check:traffic` verifies same-query in-flight coalescing, short-lived caching, and the new rolling-hour live budget with a fake provider. Neither check makes a live Qloo call, validates deployment, or establishes contest acceptance.

## Competition operator handoff

The [official 2026 rules](https://qloo.devpost.com/rules) require **a working public demo URL**, a **public open-source repo with license and complete setup instructions**, and a **text description**. The entrant may submit unique, substantially different projects. The representative/entrant must authorize and perform any external Devpost join/submission, live API key request, hosted deployment, and prize identity/payout forms. This source package can be published on a public original-contributor GitHub branch; its contents alone are not a submitted entry. Before entry, the original entrant should (1) confirm uniqueness vs the swarm's other Qloo candidates; (2) test the three live requests with their server-side hackathon key, because no live key was available during construction; (3) host a production demo, validate access from an outside device, and use a public GitHub repo; (4) record a concise real walkthrough showing a Qloo live result and abstention; (5) submit by Oct 30 23:45 EDT. Do not mislabel synthetic responses as a live integration.

## Source & credits

Original 2026 SignalGuard project produced under the TokenJunkieLabs Commons swarm. Keep correct contributor provenance in any public repository; do not introduce invented sponsor endorsements, awards, payout claims or third-party logos. Software source is MIT-licensed by its contributor(s); Qloo and its responses remain subject to Qloo's separate API terms.

## Coordinated live budgets for a public demo

The demo-ready pipeline keeps the existing **3 concurrent distinct audits, 5-minute healthy response cache and singleflight identical-parameter coalescing**. A new live admission additionally allows **4 distinct uncached live audits per direct TCP peer per 10 minutes**, before any Qloo call, and preserves the configurable process-wide `MAX_LIVE_AUDITS_PER_HOUR` (default **12**). Each audit can trigger up to four Qloo API requests (search, baseline and two probes). HTTP 429 responses include `Retry-After`, plus an explicit `NO VERIFIED AUDIT` provenance. Failed or incomplete provider responses never enter the cache. Synthetic demos do not spend a live budget.

**Deployment:** these budgets are process-local, so restarts or multiple server workers require an external/shared rate limiter to enforce fleet-wide bounds. Do not trust `X-Forwarded-For` directly; by design the per-peer local quota uses the TCP socket address. Behind an HTTPS proxy, this may be the proxy address shared by all clients. Apply real user-IP limits at the reverse proxy and do not turn on `HOST=0.0.0.0` without HTTPS and provider-key server-side secrets. Public hosting and real Qloo API response proof have NOT been performed here.

New focused integration test: `node --test tests/integrated-quota.focused.test.mjs` (fake provider).
