# CrossCurrent — provider subtype truth guard (October 9, 2026)

**Parent:** `crosscurrent-qloo-singleflight-20261009.zip` SHA-256 `1a3dfe101d7f356952e24fc81417b8c8253d21b32184558ec12bf1c798514827`.

Qloo entity response examples use generic `type: "urn:entity"` with the actual `subtype: "urn:entity:place"` / `urn:entity:artist` etc. (official source: https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md, plus Qloo hackathon developer guide). Previously CrossCurrent stored only generic `type` and assumed all returned members were the requested category. An inconsistent result could therefore be shown as a confirmed venue in an output whose business claim is venue matching.

`src/qloo.mjs` now retains the actual `subtype` as the output category. The insight result loader permits omitted metadata and the legacy generic `urn:entity` type, but **rejects explicit category mismatch or contradictory explicit type/subtype claims**. Subcategories such as `urn:entity:place:restaurant` remain valid for a place query. The search discovery result remains unfiltered. In live mode, an absent verified place leads to the existing `NO_VERIFIED_PLACE` abstention; no fabricated venue is introduced.

Only `src/qloo.mjs` from the prior ZIP changed. All prior evidence-failclosed, UI and in-flight singleflight source bytes retained. Added only `tests/qloo-subtype-contract.test.mjs` and this review. Focused test uses a fake Qloo response, never credentials or network; this is **not** evidence of a successful live Qloo call or sponsor acceptance. The original source authors, entrant and any eligible award rights are unchanged; public demo and official Devpost submission remain future entrant actions.
