# CineTrail — from a movie to three local cultural discoveries

**Status:** Original Qloo Agentic Hackathon 2026 source candidate. No Devpost submission, hosting, prize, provider-live execution, registration or award is claimed. The default offline demo uses **invented places**, conspicuously labeled synthetic.

**Purpose:** Help movie lovers discover cultural third places in a city using Qloo taste relationships. Unlike conventional route planners, CineTrail never invents hours, journey times, addresses, admission prices or venue availability. Live results keep each Qloo entity ID and provider order, so users can inspect the source identity rather than trusting generated prose.

## Run

Requires Node.js 22+ and no packages to install.

~~~sh
cd qloo-cinetrail
node server.mjs
# Open http://127.0.0.1:8787
~~~

Offline mode is explicitly synthetic. A private Qloo hackathon key unlocks actual API calls; never put keys in browser bundles or GitHub:

~~~sh
QLOO_API_KEY="YOUR_PERSONAL_HACKATHON_KEY" node server.mjs
~~~

Optionally set QLOO_API_BASE to the approved HTTPS Qloo hackathon API origin, PORT and HOST (defaults to loopback). Hosting publicly requires HTTPS reverse proxy, origin authorization, per-instance quota and exposure review; this branch does **not** claim a hosted public demo.

## Actual source-driven operation

1. Search the Qloo movie catalog with GET /search, query by full movie title, and **require an exact returned name** and immutable entity_id. Never create a seed ID from text.
2. Invoke GET /v2/insights with filter.type=urn:entity:place, filter.location.query=the city, and signal.interests.entities=the resolved movie ID.
3. Reject HTTP errors, oversized/non-JSON or unknown result envelopes. Construct up to three distinct recommendations only from returned place entity_id values, retaining the provider rank and any actual tag/description/address fields.
4. The browser renders using DOM text nodes, not unsanitized HTML; export a JSON evidence record with live/synthetic provenance and caveats.
5. With no API key, show only the fictional fixture, with all records and IDs explicitly marked SYNTHETIC. There is no automatic fixture fallback after live API failure.

The user-selected mood is preserved as a planning preference, **not yet sent to Qloo** and does not affect its ranking. Qloo's output is a taste-informed source set, not a route, verified opening-hours database or guaranteed thematic venue.

## Focused check

~~~sh
node --test tests/focused.test.mjs
~~~

Three tiny offline contract checks cover provenance boundaries, exact IDs, locality and provider error-envelope rejection. No live key is required, and no repository-wide tests are requested.

## Competition completion gates

Official Qloo Agentic Hackathon dates: September 30–October 30, 2026, deadline October 30 11:45pm EDT. Advertised $25,000 conditional prize pool (15k/6k/4k). The submission requires a working **live functional demo URL** and **public open-source repository with license** as well as entry through the authorized Devpost account. See [official rules](https://qloo.devpost.com/rules).

This source lives under a subfolder of a public source repo; the repository already carries a root LICENSE. Before official entry: obtain an authorized hackathon key; run one REAL provider-backed search and insight query to validate the actual response schema and access scope; deploy safely with HTTPS and budget limits; capture honest screen demonstration; confirm entrant eligibility; submit via original authorized account. **No submitted entry is asserted by this repository.**

Qloo source documentation:
- https://github.com/qloo/docs-public/blob/main/reference/get-search.md
- https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md
- https://github.com/qloo/docs-public/blob/main/reference/api-onboarding.md

Copyright 2026 original contributors. Licensed under the repository's root LICENSE.
