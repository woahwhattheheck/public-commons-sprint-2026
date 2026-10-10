# AccessLens · Cultural affinity, access first

**Independent Qloo Agentic Hackathon candidate** · License MIT · Node.js 22+, no npm dependencies.

AccessLens builds a cultural venue shortlist from Qloo artist→place affinity **only after** testing independent operator-reported venue access, group size and cost constraints. Hard constraints win over taste. If no Qloo-cited venue satisfies every requirement, the planner abstains with reasons; it does not invent accessible venue evidence. Accessibility is NEVER presented as Qloo-sourced data. Live venue audits are screened against a bounded calendar-day recency policy (default 180 days): future-dated and expired audits are nonqualifying, even with strong cultural affinity.

## One-command interactive demo

```bash
node server.mjs
# visit http://127.0.0.1:3000
```

Default `ACCESSLENS_MODE=fixture` is completely offline and makes zero provider calls. **All** default venues, IDs, and ranking are intentionally fictional and conspicuously labeled. Try a group of 45 people with step-free + low-sensory + accessible toilet, budget $25; try increasing size to 900 or budget to $0 to see safe abstention.

## Live Qloo integration

See [docs/OPERATOR.md](docs/OPERATOR.md). An authorized operator must supply a real Qloo hackathon key and separate real, independently audited venue catalog. The server calls the documented hackathon origin's **GET `/search`** and **GET `/v2/insights`**, using `X-Api-Key`; only canonical Qloo IDs match. There is no API-key input in the browser, guessed venue metadata, or silent live→fixture fallback. Artist exact-match ambiguity and invalid response envelopes fail closed. An in-process global provider request budget and single-flight constraint prevent unbounded browsing cost.

## Project architecture

- `public/`: keyboard-accessible and responsive UI, explicit evidence label, constraint explanation, shortlists and near-miss reasons.
- `src/qloo.mjs`: strict upstream adapter, exact artist search, place-ID/subtype validation, HTTP error handling, response-size and per-plan call limits.
- `src/catalog.mjs`: independent audited-catalog schema and **fictional** demo catalog; strict UTC calendar-date validation (no Feb 30 rollover).
- `src/engine.mjs`: deterministic hard-constraint filtering, audit-recency screening (nonqualifying future/older-than-policy records), and ordinal ranking by Qloo place order, safe abstention.
- `server.mjs`: Node.js HTTP host with global Qloo budget and single in-flight planning, no external packages.
- `test/planner.test.mjs` and `test/audit-recency.test.mjs`: focused causal behavioral assertions only (not a broad suite).

## Traceable decision path

1. User selects a real artist reference and non-negotiable venue access needs.
2. Live Qloo resolves an *exact* artist and returns culturally aligned places. No venue accessibility comes from Qloo.
3. Independently audited operator catalog is matched strictly on canonical Qloo place IDs; missing IDs never become matches.
4. Audit date validity and freshness, accessibility, capacity and price filters are mandatory, and the remaining places preserve Qloo rank. Response includes the rank, operator venue ID, access audit date/source and near-miss rejection reasons.
5. No match → **ABSTAIN_NO_VERIFIED_FIT**; ambiguous Qloo upstream state → **error**, with no synthetic replacement in live mode.

This is a build artifact, not a published hackathon entry, a hosted live site, or a cash award. Don't submit fixture output as live Qloo evidence.
