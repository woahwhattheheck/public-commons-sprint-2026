# CultureBridge — exact live Qloo seed resolution (October 9, 2026)

## Why the correction matters

CultureBridge sends each cultural taste seed to Qloo `/search` and puts the selected provider ID into `/v2/insights`. Previously `resolveEntity()` took the first search hit whenever the requested name was absent. A related hit was therefore silently presented as the user's requested artist, book, film or game.

The live adapter now accepts **only exact Unicode NFKC/case/whitespace-normalized names** with nonempty canonical Qloo string IDs. No exact name yields `NO_MATCH` and HTTP **422**. Different canonical IDs sharing the exact name yield `AMBIGUOUS_SEED` and HTTP **409**, instead of picking a random domain. Repeated rows with the same ID remain valid; other provider, credential, transport, error and fixture behavior is unchanged.

## Exact-source check

From `qloo-culturebridge-2026/` run `node test/seed-identity.focused.mjs` with Node 22+. The published test imports actual `src/qloo.mjs`, `src/server.mjs`, `src/engine.mjs`: 1,024 deterministic provider-shaped search mixes (4 source types × 256), four additional identity controls, a complete real-adapter two-search/two-Insights request sequence, and a real local Node HTTP route for 422/409/200/fixture200. Injected provider replies check fixed hackathon origin, no automatic redirects and server-held key forwarding. This local source check did not use a real Qloo key, real provider traffic, customer data or an official submission.

## Next actual-provider check

Compare pinned original `/search` response names, canonical IDs, explicit types and candidate counts with the existing broad Muse/local authorized Qloo panel for real artist/movie/book/game seeds. Fuzzy aliases may need a future **explicit user choice** flow; never silently declare an alias resolved. No new Qloo credential, provider account, external demo or deployment was used for this source change.

The earlier merged `TYPE_ID_EVIDENCE.md` remains the distinct downstream Insights ID/category validator; rank scoring and fixtures are untouched.
