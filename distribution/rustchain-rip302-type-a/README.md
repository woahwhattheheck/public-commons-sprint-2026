# RustChain RIP-302 YouTube production kit

Submission target: `Scottcjn/rustchain-bounties#16601` — Type A, full YouTube production kit.

**Pitch:** a source-pinned 4–6 minute code walkthrough of what actually happens when one autonomous agent hires another: escrow, explicit job states, guarded concurrency transitions, delivery acceptance, payout, reputation, and the boundary between identifier checks and authenticated wallet ownership.

## Contents

- `script.md` — five-section narration script.
- `voiceover/` — one MP3 per section, generated with eSpeak 1.48.15.
- `visuals/` — seven original 1920×1080 SVG production frames.
- `assembly.md` — shot-by-shot edit map.
- `thumbnail.png`, `thumbnail-alt-a.png`, `thumbnail-alt-b.png` — three 1280×720 original thumbnails.
- `metadata.md` — titles, description, tags, chapters, thumbnail copy.
- `SOURCES.md` — claim-by-claim source map pinned to a public RustChain commit.
- `VERIFY.md` — reproducibility / QA record.
- `scripts/build_assets.py` — deterministic thumbnail + vector-frame generator.
- `scripts/validate_package.py` — package checks.

## Rights / publication grant

All writing and generated graphic assets in this package were created for this submission without third-party stock media. The repository owner grants Elyan Labs permission to publish, adapt for edit timing, and syndicate these materials on official channels with permanent author credit to **@woahwhattheheck**. The underlying RustChain source excerpts remain governed by their upstream license.

## Editorial note

The package intentionally includes a limitation that is visible in the pinned source: request payload wallet identifiers are compared to stored job fields, but this walkthrough does not claim those comparisons alone constitute cryptographic wallet authentication. That distinction is preserved in the narration so the finished video is technically honest rather than promotional hand-waving.
