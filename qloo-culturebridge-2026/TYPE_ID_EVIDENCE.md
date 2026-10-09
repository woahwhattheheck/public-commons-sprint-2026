# CultureBridge: typed entity ID evidence

The Qloo Insights API supports requested categories through `filter.type` (for example `urn:entity:artist`). See [Qloo's parameter reference](https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md). CultureBridge requests one category for each comparison but must also check any entity-category metadata actually returned.

## Rules

- An entity is a verified bridge only when the same **nonempty string** Qloo ID exists in both independent results. Leading/trailing whitespace in a string ID is normalized; numbers, objects and arrays are not converted into invented IDs. A valid top-level `entity_id` is accepted if a nested ID is malformed.
- When an Insights row explicitly declares recognized `type`, `entity_type` or `types` metadata (a Qloo `urn:entity:*` value or one of the four supported short names), it is omitted if none of its declared entity categories matches the requested `filter.type`. Untyped or unrecognized metadata remains compatible with prior provider response shapes.
- Provider result positions are not renumbered by filtering, and the previous canonical-ID-only matching and rank-balance heuristic remain unchanged. The engine does not invent affinity, scores, matches or category metadata.

## Reproduction

Run `node test/type-identity.focused.mjs` using Node 22+ within `qloo-culturebridge-2026/`. This exercises the **actual engine** in 1,024 deterministic category/ID mixtures (4 supported categories x 256) and direct identity/metadata corner cases. The pre-fix engine could both turn malformed object IDs into `[object Object]` matches and expose explicit wrong-category overlaps; the updated engine excludes both. The deterministic inputs are local contract cases, **not** a live Qloo integration or contest score.

The server-side Qloo key and provider transport are unchanged. A real API-assisted comparison requires an authorized server key and account, and a published/registered contest entry still requires the entrant to act separately.
