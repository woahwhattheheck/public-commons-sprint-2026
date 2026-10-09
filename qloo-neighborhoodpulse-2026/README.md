# NeighborhoodPulse

**A Qloo-powered cultural programming agent for independent community spaces.**

Rather than a generic recommendation carousel, NeighborhoodPulse turns *up to three named cultural references* and a *real city* into a **four-week, cross-domain event programming plan**. It searches Qloo for matching seed entities, asks Qloo Insights for artists, books, films, and local places, allocates Qloo-ranked entities without repeating the same recommendation each week, and exposes the original IDs and API-provided affinity scores. It supports dismissal/replanning, JSON export, and spreadsheet-safe CSV export. The proposed program formats are original; no venue/date/booking data is invented.

## Real capabilities

- **Source-resolved culture input:** `GET /search` resolves submitted artist, book or movie names to Qloo IDs; shows the exact selected entity and ID for human verification.
- **Four cross-domain Insights passes:** `GET /v2/insights?filter.type=...` for `artist`, `movie`, `book`, and `place` with shared taste seed IDs, explainability requested, and `filter.location.query` applied to places only.
- **Replanning using negative feedback:** dismiss a recommendation and re-query Qloo with `filter.exclude.entities` IDs; updates all program weeks.
- **Conservative provenance:** actual Qloo entity IDs, order and numeric affinity appear only if present in the API response. The app never constructs fake identities in LIVE mode or infers a confidence/probability from a rank.
- **Four distinct original program briefs:** Listening Room, Screen & Discuss, Reading Salon, Neighborhood Remix. Every Qloo candidate is used at most once per category; if Qloo supplies too few, the UI identifies missing slots rather than inventing people/venues.
- **Working local UI/API:** responsive browser interface, Node HTTP API, JSON/CSV export, server-side key isolation and origin/host safety checks. No npm dependencies, 22+ runtime.

## Run it

```
node --version               # >=22
node server.mjs
# Open http://127.0.0.1:4173
```

Without `QLOO_API_KEY`, it starts in **SYNTHETIC FIXTURE** preview mode. All displayed names are intentionally fictional. This validates interaction and local HTTP behavior, **not** the external Qloo service and not hackathon eligibility.

For live Qloo:

```
export QLOO_API_KEY='your official hackathon key (environment only)'
node server.mjs
# Select LIVE QLOO API in the browser.
```

The key is sent only by the server in `x-api-key` to allowlisted Qloo hosts. Default host: `https://hackathon.api.qloo.com`, override permitted for `https://api.qloo.com` or `https://staging.api.qloo.com`. API key is never in frontend code, exported CSV, or server error responses. Obtain a key via Qloo's official developer application; no key is included in this source.

For public hosting, use `HOST=0.0.0.0 PORT=4173 node server.mjs` or the included Dockerfile. Configure the server-only `QLOO_API_KEY` secret in the host environment. Do **not** publish a publicly accessible demo in fixture mode as a fake live-Qloo demonstration. Check Qloo key scopes, upstream API response shape and provider rate limits in a live host before submission.

## Exact-source verification

`node --test test.mjs` runs **only seven directly relevant checks** covering validation, synthetic four-week generation, deduplicated replan, no fabricated source metrics, a mocked LIVE Qloo client, fail-closed live mode, and local HTTP server behavior. It does not execute broad repository suites or run actual external Qloo calls.

## Competition status and what remains

**Qloo Agentic Hackathon**, submission deadline **October 30, 2026 at 11:45 PM EDT**, prizes first **$15,000**, second **$6,000**, third **$4,000**. [Official Devpost rules](https://qloo.devpost.com/rules). The rules require a genuinely **hosted and externally available end-to-end live application**, public source repository with license visible in the repository About area, product description, an entrant/representative who meets eligibility, and integration with the actual Qloo API. Merely releasing this code or using its synthetic fixture mode does not qualify as a submission, a working Qloo integration test, a finalist, or an award.

Current source deliverable **READY**: full runnable Node app, provider adapter, mock/fixture, seven focused tests, Dockerfile, MIT license. **Unverified/remaining external gates:** real Qloo key and working API response; public GitHub repository or branch publication; public hosted URL reachable without authentication; owner/entrant registration and final Devpost submission. The original entrant and payment claimant is the authorized Commons owner, not a new duplicate identity.

## Originality and distinction

This is a cultural *programming and cross-domain planning* product for local nonprofits/independent venues, not a date itinerary, vendor booking marketplace, movie-to-destination trail, or generic preference chatbot. The allocation solver and four briefing formats are standalone original work for this candidate, sourced from Qloo results when live. Fictional fixture content is not Qloo intellectual property or factual data.

## Provider reference

- Qloo [Insights API Deep Dive](https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md) (filter.type, signal.interests.entities, feature.explainability, filter.location.query, filter.exclude.entities, take)
- Qloo [official API documentation and OpenAPI repository](https://github.com/qloo/docs-public)
- [Qloo Agentic Hackathon rules](https://qloo.devpost.com/rules)

The entry is competition-oriented and experimental, not a verified commercial product. No real bookings, venue access, RSVP management, price/availability estimates, license clearances, or demographic guarantees are asserted.
