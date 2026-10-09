# Multi-claim research review workspace

A resumable, offline workspace for the existing Academic Evidence Studio. It reuses the original `extract` function in `app.mjs`; the original app, model adapter and entry point are unchanged.

## Run

From this directory, with Node.js 22:

```sh
node workspace-server.mjs
```

Open `http://127.0.0.1:8788`. Set `PORT` to choose a different loopback port. No install step, API key, model request, database or external service is required. This workspace is offline even when Apertus environment variables are set. The original single-claim live adapter remains a separate entry point.

## Complete a review

1. Paste a corpus JSON or choose a JSON file, then select **Open workspace**. The built-in example is explicitly synthetic.
2. Choose each claim, inspect the exact retrieved passages, select relevant evidence and record a decision, reviewer label and explanation. Supported/contradicted decisions require at least one selected excerpt; insufficient evidence may have none. Retrieval scores are lexical overlap, not truth scores.
3. Save the decision, then download **Save workspace JSON** to retain the complete corpus and review state. Reload that file to resume. **Export report** produces readable Markdown with the selected evidence, exact source offsets and checksums.

Nothing is persisted by the server. Refreshing or closing the page without downloading loses the in-memory workspace. Downloaded files contain the original source text and review notes: share them only with the intended recipients. The UI warns about unsaved decision edits before changing claims and refuses export while those edits are unsaved.

## Input

```json
{
  "title": "Study review",
  "sources": [
    {"id": "trial", "title": "Supplied study excerpt", "body": "The trial enrolled 120 participants. Long-term survival was not measured."}
  ],
  "claims": [
    {"id": "enrollment", "text": "The trial enrolled 120 participants."},
    "The trial established a long-term survival benefit."
  ]
}
```

Limits: 1–20 claims of at most 1,000 characters; 1–8 source excerpts of at most 40,000 characters each; 150-character titles; 100-character reviewer labels; 2,000-character notes; 2 MiB HTTP request bodies. Claim IDs are unique simple identifiers. Source validation and extraction use the existing Studio implementation. Stored evidence contains offsets rather than duplicating full quotations for every claim.

## Review integrity and limits

Saved files use `academic-evidence-workspace/v1`. Import re-runs extraction against the original source corpus and checks source checksums plus each claim/source basis. A changed claim or corpus requires a new workspace and fresh decisions. Imported evidence offsets are recomputed, never trusted. Report quotations are sliced from the unmodified original body; offsets are zero-based, end-exclusive UTF-16 code units, matching JavaScript string indexing, not UTF-8 byte offsets.

Review decisions and reviewer labels are user-entered annotations, **not authenticated signatures**. Checksums help detect accidental edits but do not prevent a deliberate editor from recomputing them. This is not a research-truth oracle, an autonomous approval system or a replacement for reading the sources. A missing match does not prove a claim false. Report text is escaped and browser text is rendered with textContent rather than interpolated HTML.

## Files and API

- `workspace.mjs`: create/restore a multi-claim corpus, record an immutable review update and export a source-linked report.
- `workspace-server.mjs`: loopback HTTP server with a fixed route allowlist and bounded JSON intake.
- `workspace.html`: corpus import, evidence review, resume and export UI.
- `workspace.test.mjs`: focused acceptance checks.

`POST /api/workspace` accepts input or a saved workspace; `POST /api/review` accepts `{workspace, claim_id, review}`; `POST /api/report` accepts a saved workspace and returns `{markdown}`. Review fields are `{decision, reviewer, note, evidence_ids}`. `GET /health` returns offline mode and zero model requests. Source files are not exposed by the server.

## Acceptance record — 2026-10-09

```sh
node --test workspace.test.mjs
```

Executed in the cloud container on Node v22.16.0: **3 passed, 0 failed**. Checks cover real-extractor batch creation with Unicode offsets, immutable review and resume/report; changed-source/claim and invalid-evidence handling; and a real localhost HTTP create/review/restore/export round trip. The original `app.mjs` dependency matched Git blob `354e66b8206c65255c16ccee35deb220d2bdb998` byte-for-byte.

A browser acceptance attempt using system Chromium was blocked on initial navigation by `net::ERR_BLOCKED_BY_ADMINISTRATOR`. No browser pass, screenshot or interactive download validation is claimed. No broad suite or live inference was run. The feature is a source contribution to the existing project, not an entrant registration, contest submission or award receipt.
