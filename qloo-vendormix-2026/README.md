# VendorMix — taste-aware festival lineup agent

**Status:** standalone runnable original Qloo Agentic Hackathon *candidate*; not registered or submitted, and no prize/award/payment claimed. Built October 9, 2026. The official competition closes **October 30, 2026, 11:45 PM EDT**, with cash awards of $15,000 / $6,000 / $4,000 (conditional on eligibility and judging).

VendorMix helps a small market organizer choose a complementary lineup of cultural vendors. Instead of recommending only the highest-affinity places, it plans a variety-constrained mix, retaining the rank, category tags and signal behind each decision. The result is explicitly a *contact shortlist*, not a purportedly available or approved vendor roster.

## Run

Requires Node.js 22+; no npm dependencies and no build step.

```bash
node app.mjs
# open http://127.0.0.1:4173
```

Try **Synthetic offline showcase** to evaluate the entire pipeline with 12 invented place names and labelled fixture scores. This source makes no external API requests. To use real Qloo data, supply an event-authorized Qloo key to the server process (never to a browser or repository):

```bash
QLOO_API_KEY=... node app.mjs
# select Live Qloo API in the interface
```

Optional variables: `PORT=4173`, `HOST=127.0.0.1`, `QLOO_API_BASE=https://hackathon.api.qloo.com`. API base is restricted to the Qloo hackathon host only; staging and production reject hackathon credentials. For a hosted demo, set `HOST=0.0.0.0` behind HTTPS and server-side access/rate controls; the source is a single-user prototype, not a public multi-tenant service. A production host must provide its own per-user quotas because calls consume event API quota.

## Live agent workflow

1. Take 1–5 recognizable *named* places/brands as the event audience's taste signals, a locality query, number of slots and selection objective.
2. First use official `GET /search` for each named taste seed and require exactly one exact-name canonical entity ID. Then call `GET /v2/insights` with query-string `filter.type=urn:entity:place`, locality, `signal.interests.entities` as comma-separated real IDs, `sort_by=affinity`, and `take=35`. Zero or ambiguous search matches stop; no invented IDs. This replaces the hackathon-incompatible JSON POST.
3. Normalize place names, observed Qloo tag/category, numeric `query.affinity` where present. If the endpoint omits numeric affinity, use **clearly marked result-order proxy** rather than inventing a numerical provider score. Unclassifiable entities remain `Unclassified` and do not receive a variety bonus.
   Only candidates with an actual, nonempty, well-formed string `entity_id` (or provider `id`) can enter a LIVE lineup. An entry with a name but no valid source ID is excluded; its result position is never used to invent a substitute identity. If none remains, live planning fails closed rather than fabricating vendors.
4. Greedily optimize the lineup with deterministic re-evaluation after every pick: `utility = tasteWeight * signal + categoryDiscoveryWeight * unseenCategory - repeatPenalty * sameCategoryCount`. The taste/variety/discovery modes change the weights. Exact-name exclusions apply to the selected candidates. Every chosen place carries a traceable rationale.
   Optionally choose a hard `categoryCap` integer (1..requested slots), enforced per normalized observed category label, including `Unclassified`. This prevents a second similarly-tagged place from bypassing the limit through case/spacing differences; when a shortage remains, show fewer selections with a reason instead of silently filling with disallowed vendors. Omitting `categoryCap` preserves the original soft-variety behavior.
5. Show near-misses and human due-diligence steps. **No claim about prices, actual catering availability, dietary/allergen safety, legal compliance or vendor consent is inferred from cultural affinity.**

The browser offers a clearly labeled hard category cap (1, 2, 3) or the backward-compatible soft-variety default. Caps operate on observed tags, NOT verified vendor industries, and can leave slots empty. `lineup.mjs` is a pure deterministic module with five focused offline tests (`node --test test-lineup.mjs`).

The demo fixture is deliberately synthetic; it cannot be used as proof of integration, model accuracy or live provider output. Live behavior needs an authenticated key, authorized Qloo quota and direct end-to-end rehearsal before an external submission. Qloo API failures fail closed rather than silently replacing actual data with fixture results.

## Organizer review desk

After designing a lineup, review every original recommended and alternative row,
including its source ID, position, observed category, signal kind and rationale.
Mark rows **Priority**, **Undecided** or **Defer**, and record an organizer note
of up to 1,000 characters. These are human planning decisions; they do not change
the ranking, imply vendor consent or availability, contact anyone, or book anything.
Filter the review by decision to work through the list.

The review belongs to the exact submitted brief and returned plan. Changing any
brief field marks it stale and disables annotation and export. **Restore saved
brief** restores those request fields locally so the same notes can be reviewed
and downloaded; it makes no API request. Designing another lineup is a deliberate
request: a successful result replaces the old review, while a failed request
retains it. There is no automatic provider retry.

Download JSON to retain the complete original plan, submitted brief, and separate
organizer decisions. Download CSV for an organizer worksheet with source/rationale
and notes on each row; spreadsheet formula prefixes are neutralized and fields
are quoted. Both downloads include every candidate row, even rows hidden by the
current filter. Reviews bind each annotation to its original group, position and
source ID, preserving aliases without changing provider identities. The source
label, including synthetic-only status, remains in both formats.

This desk holds one review in tab memory, not a server database. Download your
work before a new successful plan or page reload; this version does not import
saved reviews. Notes remain local until you explicitly share a downloaded file.
JSON and CSV are planning records, not contact, booking or live integration receipts.

## Interfaces and guardrails

- `GET /` — responsive zero-dependency UI.
- `GET /review.js`, `GET /style.css` — local review desk assets; no external browser dependencies.
- `GET /api/health` — readiness and *boolean* key configuration; never emits the key.
- `POST /api/plan` — validated JSON `location`, `seeds`, `slots`, `mode`, `source`, `exclusions`, optional numeric `categoryCap`; returns lineup, alternatives, signal provenance, any honest shortfall and warnings.
- Server caps request size (8 KiB), up to six sequential upstream GET calls per live plan (five `/search`, one `/v2/insights`), each with a 12-second timeout and 250 KiB bounded response, and only accepts the hackathon API origin. Browser receives normalized output, never credentials.
- HTML renders all provider text using `textContent`, not HTML injection.

## Reproduction and next submission gates

Use the built-in offline showcase as an end-to-end *synthetic* demo, then test with an authorized live key and independently check the current Qloo response shape. Record a real live demonstration and obtain the proper Devpost entrant/representative registration before external submission. Official rules additionally require a working application, a project explanation, repository/demo links and a video demonstrating actual functionality. Preserve original account/entry attribution.

Primary sources: [Qloo official Insights API](https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md), [Qloo developer kit](https://github.com/qloo/qloo-hackathon-kit), [Qloo Agentic Hackathon official rules](https://qloo.devpost.com/rules).

## Ownership and scope

This standalone candidate does not modify or replace the Commons TasteBench, SignalGuard, CultureBridge, or CrossCurrent projects. No credentials, private data, sponsor correspondence, competition registration or payout statements are stored here.
