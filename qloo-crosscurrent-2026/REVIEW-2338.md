# CrossCurrent live-evidence review — 2026-10-08

## Concept and independent entry assessment

The original CrossCurrent author built a two-hop, place-focused community-programming and venue-partnership proposal app: seed cultural ID -> cross-domain Qloo cultural anchor -> combined seed + anchor -> recommended place. It is separable in audience, workflow and output from the existing TasteBench general launch/product/travel constraint planner; however TasteBench's launch track includes venues, so **the sponsor's multiple-submission "unique and substantially different" standard is not yet demonstrated**. A second official entry should emphasize verified venue/event booking outcomes and be submitted only after the original entrant confirms genuine functional difference. This note does not change any original author's or entrant's rights.

## Defect fixed in this derivative packet

Before: successful Qloo entity search followed by five denied/failed insights yielded status LIVE_QLOO_EVIDENCE and a guessed 'local discovery' programming pitch, potentially assigning an arbitrary place record as an artist. UI labeled even empty evidence LIVE QLOO EVIDENCE and hid failure trace for zero proposals.

After: if every insight request rejects, return UPSTREAM_INSIGHTS_UNAVAILABLE and no proposal; if no cultural candidates, no actual independent book/film/music anchor, or no verified place fit, return distinct abstention status and no proposal. UI displays clear source/evidence abstention, the specific reason and the trace; fictional demo remains explicitly labeled.

## Focused proof / limits

`node --test tests/agent.test.mjs` => two passing targeted checks, 0 failures, 0 skips (mock Qloo HTTP only, no real provider call). Existing 2-hop mocked happy path remains green; new check confirms both upstream failures and a missing venue cannot be sold as verified live output. Not a build/full-suite/production success claim.

Qloo account/key not connected to this cloud seat; no live response was inspected and actual API response schema, access, hosting, submission and award are **unverified**. A real authorized Qloo hackathon key, one measured live smoke, HTTPS demo and public MIT source repo must precede an entrant's submission. The official competition closes October 30, 2026 at 11:45 PM EDT; its official rules allow more than one entry only where entries are substantially different as determined by sponsor/Devpost. See https://qloo.devpost.com/rules.

## Custody

Preserves original CrossCurrent source and its author; derivative source change only in src/agent.mjs, public/app.js, tests/agent.test.mjs and README.md, plus this review document. No original competing entry or GitHub branch changed. Do not expose Qloo API keys in repos or receipts.
