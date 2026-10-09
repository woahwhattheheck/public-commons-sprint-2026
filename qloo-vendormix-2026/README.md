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

Optional variables: `PORT=4173`, `HOST=127.0.0.1`, `QLOO_API_BASE=https://hackathon.api.qloo.com`. API base is restricted to three documented Qloo origins. For a hosted demo, set `HOST=0.0.0.0` behind HTTPS and server-side access/rate controls; the source is a single-user prototype, not a public multi-tenant service. A production host must provide its own per-user quotas because calls consume event API quota.

## Live agent workflow

1. Take 1–5 recognizable *named* places/brands as the event audience's taste signals, a locality query, number of slots and selection objective.
2. Call the official Qloo `POST /v2/insights`, `filter.type=urn:entity:place`, location query, `signal.interests.entities.query` with named entities, `feature.explainability=true`, affinity sorting, 35 results. **One bounded provider call per live plan, no automatic retry.**
3. Normalize place names, observed Qloo tag/category, numeric `query.affinity` where present. If the endpoint omits numeric affinity, use **clearly marked result-order proxy** rather than inventing a numerical provider score. Unclassifiable entities remain `Unclassified` and do not receive a variety bonus.
4. Greedily optimize the lineup with deterministic re-evaluation after every pick: `utility = tasteWeight * signal + categoryDiscoveryWeight * unseenCategory - repeatPenalty * sameCategoryCount`. The taste/variety/discovery modes change the weights. Exact-name exclusions apply to the selected candidates. Every chosen place carries a traceable rationale.
   Optionally choose a hard `categoryCap` integer (1..requested slots), enforced per normalized observed category label, including `Unclassified`. This prevents a second similarly-tagged place from bypassing the limit through case/spacing differences; when a shortage remains, show fewer selections with a reason instead of silently filling with disallowed vendors. Omitting `categoryCap` preserves the original soft-variety behavior.
5. Show near-misses and human due-diligence steps. **No claim about prices, actual catering availability, dietary/allergen safety, legal compliance or vendor consent is inferred from cultural affinity.**

The browser offers a clearly labeled hard category cap (1, 2, 3) or the backward-compatible soft-variety default. Caps operate on observed tags, NOT verified vendor industries, and can leave slots empty. `lineup.mjs` is a pure deterministic module with five focused offline tests (`node --test test-lineup.mjs`).

The demo fixture is deliberately synthetic; it cannot be used as proof of integration, model accuracy or live provider output. Live behavior needs an authenticated key, authorized Qloo quota and direct end-to-end rehearsal before an external submission. Qloo API failures fail closed rather than silently replacing actual data with fixture results.

## Interfaces and guardrails

- `GET /` — responsive zero-dependency UI.
- `GET /api/health` — readiness and *boolean* key configuration; never emits the key.
- `POST /api/plan` — validated JSON `location`, `seeds`, `slots`, `mode`, `source`, `exclusions`, optional numeric `categoryCap`; returns lineup, alternatives, signal provenance, any honest shortfall and warnings.
- Server caps request size (8 KiB), one upstream call, 12-second upstream timeout and 250 KiB provider response, and only accepts allowed Qloo API origins. Browser receives normalized output, never credentials.
- HTML renders all provider text using `textContent`, not HTML injection.

## Reproduction and next submission gates

Use the built-in offline showcase as an end-to-end *synthetic* demo, then test with an authorized live key and independently check the current Qloo response shape. Record a real live demonstration and obtain the proper Devpost entrant/representative registration before external submission. Official rules additionally require a working application, a project explanation, repository/demo links and a video demonstrating actual functionality. Preserve original account/entry attribution.

Primary sources: [Qloo official Insights API](https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md), [Qloo developer kit](https://github.com/qloo/qloo-hackathon-kit), [Qloo Agentic Hackathon official rules](https://qloo.devpost.com/rules).

## Ownership and scope

This standalone candidate does not modify or replace the Commons TasteBench, SignalGuard, CultureBridge, or CrossCurrent projects. No credentials, private data, sponsor correspondence, competition registration or payout statements are stored here.