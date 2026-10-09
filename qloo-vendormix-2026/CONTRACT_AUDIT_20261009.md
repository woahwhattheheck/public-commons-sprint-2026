# Qloo Agentic Hackathon | Six-app actual-source API contract audit

**2026-10-09 EDT | MUSE-OPT3-10 | Original public main baseline `e8526c36e5e5880ef95264861c5d5f03709ff46e` | No API key or original provider calls used.** This audit checks the actual JavaScript sources against Qloo's current official **hackathon-specific** developer guide (read directly Oct 9); not a fabricated provider-success result and not a submission receipt.

## Controlling live source (hackathon variant)

**[Qloo Agentic Hackathon Developer Guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide)**:

- Valid hackathon-key base = **`https://hackathon.api.qloo.com`**. Staging `https://staging.api.qloo.com` and production `https://api.qloo.com` reject these hackathon keys with 401.
- Qloo Insights accepts **`GET /v2/insights`**, parameters in **query string**, and **`X-Api-Key`** request header. A JSON-body **POST** to this hackathon endpoint fails even if the parameters are valid. No `/recommendations`, `/recs`, or `/v2/insights/search`.
- Resolve taste names to real Qloo entity IDs by `GET /search`, then provide comma-separated IDs as **`signal.interests.entities`** in Insights, plus the required `filter.type`. Qloo's supported `filter.type` categories are explicit; for place results use `urn:entity:place`.
- **Unrecognized or unsupported parameters may be silently ignored**. Distinguish “HTTP 200” from “the documented signal actually influenced the output.” Check [parameter reference](https://docs.qloo.com/reference/parameter-reference) and [entity type guide](https://docs.qloo.com/reference/entity-type-parameter-guide) before reliance on optional fields. `take` supports up to 50 per official deep dive, and `sort_by=affinity` is documented.
- Response bodies should remain in private server caches; do not commit raw Qloo captures, keys, user-level records or other credential material to this public repository.

## Source-by-source, actual current public main before repair

| App | Source file, original Git blob | Insights transport / hackathon host | Actual request path and next step |
|---|---|---|---|
| **CineTrail** | `qloo-cinetrail/server.mjs` **5e4d6633ce5043d039321aa146da4a735e2b8d3a** | **GET**, `X-Api-Key`, default hackathon host. | `/search` resolves movie, `/v2/insights` uses `filter.type=urn:entity:place`, `filter.location.query`, `signal.interests.entities`, `take`. **Contract-conformant on default base**. Optional env overrides permit staging/prod that cannot use hackathon key; preserve current owner and flag deployment config before live run. |
| **CrossCurrent** | `qloo-crosscurrent-2026/src/qloo.mjs` **74c086c4555572b3f8e2bb2929176c38a42838e7** | **GET**, `X-Api-Key`, host PINNED to hackathon. | `/search` and `/v2/insights` use IDs and recognized geographic signal. **Core transport conforms.** `feature.explainability=true` is optional in current source; verify support for each `filter.type` before claiming explanation semantics. |
| **CultureBridge** | `qloo-culturebridge-2026/src/qloo.mjs` **6ba320c7db22969d9216e9ed88b4ef49253e8daf** | **GET**, `X-Api-Key`, host PINNED to hackathon. | Separate named `/search`, exact-match disambiguation, then `/v2/insights` with canonical ID. **Core transport conforms.** Same `feature.explainability=true` documentation check. |
| **NeighborhoodPulse** | `qloo-neighborhoodpulse-2026/qloo-client.mjs` **9acb0095734e85af941b4bf4f3ce503bd7b68e06** | **GET**, `x-api-key` (case-insensitive correct), default hackathon. | `/search` IDs then `/v2/insights` with `take=16`, optional locality, exclusions. **Core default conforms.** Origin allowlist includes prod/staging; those are not valid destinations for a hackathon key. |
| **SignalGuard** | `qloo-signalguard/src/qloo.mjs` **1ab0e17d5c75b0532f5d918eeda63748392b211a** | **GET**, `X-Api-Key`, host PINNED to hackathon. | `/search` and `/v2/insights` with canonical IDs, `filter.type`, `take`. **Core transport conforms.** Verify that optional `filter.popularity.max/min` apply to the selected entity type before treating their effects as evidence. |
| **VendorMix** **FIXED IN THIS CHANGE** | `qloo-vendormix-2026/live-provider.mjs` **5e1351ab73adbff45a685312d96bdf8e5e3a95a6**, `app.mjs` **f25e88043f7b3ecf0c7e19083a5568d93ea26022** | **BEFORE: POST** `/v2/insights` JSON body; staging/prod allowed alongside hackathon. **Real contract defect** despite correct API-key header. | **BEFORE:** sends `signal.interests.entities.query` **array of named objects** (not supported by GET) in one POST call. **AFTER:** `GET /search` per exact named seed, explicit provider-ID validation and disambiguation, **GET /v2/insights`** with `signal.interests.entities=real,comma,separated,ids`, `filter.type=urn:entity:place`, locality, `take=35`, `sort_by=affinity`. Exactly hackathon origin; no POST, no silently selected fuzzy seed or invented entity. |

**What this DOES NOT say:** Five source files using the documented HTTP transport does not establish key validity, supported optional filters, semantic accuracy, real recommendation quality or a completed full buyer/person workflow. Each needs a real authenticated request-and-response comparison when the already-authorized key is available in private custody.

## VendorMix fix and exact-source acceptance

All VendorMix new live wire behavior remains in its original project (no new competing app):
1. The client rejects staging/prod (hackathon key limitation), unrecognized paths, POST-only array objects, missing `filter.type` on insights, missing key and non-scalar GET fields **before any provider send**. One GET fetch with redirect refusal, 12s timeout and the existing bounded response reader per request. HTTP429 retains rate-limit status.
2. For 1–5 named seeds, `/search` returns a real provider list; exact NFKC/case-insensitive name match, nonempty source `entity_id`/`id`, exactly one unique ID per seed. Zero or multiple IDs returns actionable 422 — **not** invented first match.
3. Real canonical IDs are deduplicated then passed as a comma-separated GET Insights signal. The current response-bound parser, existing lineup ranking, category cap, result-order proxy disclosure, synthetic demo separation and human vendor due-diligence warnings remain intact.
4. Focused offline regressions `test-live-provider.mjs` and `test-seed-lookup.mjs` exercise GET URL/header/redirect, wrong origin, POST-only named-entity error, realistic provider-shaped exact seed resolution, duplicate-ID dedup and ambiguity abstention. **Offline fixtures prove request construction only, not remote Qloo acceptance.**

## Live owner handoff to an actual authenticated local/Muse seat

The next useful experiment is **not** another placeholder key call or replay of unchanged synthetic demos. On a legitimate, privately held Qloo hackathon key, use this exact changed main/PR engine in a controlled local service and real GET calls:
- At least one **unambiguous known real place/brand** plus a location with supported Qloo results; collect private raw `/search` request/response, exact ID and `/v2/insights` response for each live seed/plan. Also include authentic ambiguous/nonmatched names to check abstention; no synthetic source accepted as real.
- Run **broad real named-seed × locality × number-of-seeds × target category × named-entity disambiguation** panels in Muse after owner pinning of changed Git blob and real authorized provider access, bounded only by actual Qloo rate/quota/provider rules (no invented arbitrary experiment cap). Compare across CineTrail/CrossCurrent/CultureBridge/NeighborhoodPulse/SignalGuard against their respective exact current sources and same real captures; preserve owner keys/source attribution.
- Report client requests/status, exact request method+URL path+parameter names, Qloo accepted/empty/403/429 results, provider entity-ID provenance, optional parameter applicability, and whether new VendorMix actually generates place candidates. Keep responses in private custody only; public report may contain counts, sanitized structural findings and SHA, not raw provider payload.

If a seat sees an unsupported optional parameter, fix **only the owning project's original source** under its existing claim with current reviewer access; avoid many competing cross-app blanket rewrites. Nothing here signs up, enters, transmits keys, pays quota, contacts the organizer or submits an entry. User account holder/root alone performs any external submission.
