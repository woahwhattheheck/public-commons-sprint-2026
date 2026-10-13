# Complete Flowable source review from the command line

Use this command with the existing installed Flowable product to hand a complete authored programme to a colleague, receive the complete edited source, compare it with the author's current work, and choose every changed row before creating an adopted edition. It uses the same pure source-review engine as the authoring desk. It does not open a native engine, prepare a deployment, dispatch work or create a new workspace.

The installed command is `flowable-source-review`. Its original module is:

`stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/programme-source-review-cli.mjs`

Invoke it through the installed command, or run that exact module with the existing Node runtime. The distribution exports the typed pure module as `./seller/flowable/workspace/source-review` and the local file interface as `./seller/flowable/workspace/source-review-cli`. Both reuse the original draft validators and process, case and decision compilers.

## Issue and return full source

Save the complete source draft from the existing authoring desk. Keep its original file; use separate output filenames. Create an issue metadata file:

```json
{
  "id": "partner_review_issue_001",
  "at": "2026-10-13T18:30:00Z",
  "label": "Colleague source review",
  "issuer": "Recorded author",
  "recipient": "Recorded colleague",
  "note": "Review the complete selected source and commissioning options."
}
```

Supply the actual stable identity, UTC timestamp and recorded people for your operation. These fields record attribution; they do not authenticate a person or act as a signature. Reuse the same metadata after an interrupted command.

```sh
flowable-source-review issue --draft source-draft.json --metadata issue.json --output issued.review.json
flowable-source-review draft --exchange issued.review.json --output colleague.source-draft.json
```

The colleague edits the complete extracted draft with the existing authoring desk or source tools. Source files, paths, media types, catalogues and options remain editable. When changing decision model bytes, update the catalogue through the original **Update catalogue model identities** control before compiling. A renamed file is an explicit removal plus addition; source references are never silently rewritten.

The colleague records a stable return identity, UTC timestamp, reviewer and note:

```json
{
  "id": "partner_review_return_001",
  "at": "2026-10-13T18:40:00Z",
  "reviewer": "Recorded colleague",
  "note": "Complete edited models, catalogue and options are included."
}
```

Create the complete returned exchange:

```sh
flowable-source-review return --exchange issued.review.json --draft colleague.source-draft.json --metadata return.json --output returned.review.json
```

The exchange contains the original issued baseline and all referenced source bodies, snapshots and retained returns. Independent local draft IDs are allowed; the exchange binds the original issuing identity.

## Compare current work and explicitly resolve it

Keep the author's current draft and locally retained exchange, including any previous adoptions. Compare them with the exact colleague return file:

```sh
flowable-source-review compare --draft current.source-draft.json --exchange issued.review.json --returned returned.review.json --output comparison.json
```

For a packet containing multiple returns, add `--return-id` with the selected retained return ID. The result includes the complete baseline/current/returned values for each source path and one complete options row. It classifies unchanged, identical changes, colleague-only changes, author-only changes and conflicts. No class is adopted automatically.

Review the rows. Copy the exact `basisSha256` and the changed row keys into an adoption metadata file. Keys for source rows are JSON arrays encoded as strings; the options key is `options`. Every changed row needs one of `KEEP_CURRENT`, `TAKE_RETURNED` or `USE_BASELINE`.

For example, after reviewing the actual comparison:

```json
{
  "id": "partner_review_adoption_001",
  "at": "2026-10-13T18:50:00Z",
  "reviewer": "Recorded author",
  "note": "Accept the selected source changes while retaining current options.",
  "basisSha256": "COPY_THE_EXACT_64_CHARACTER_COMPARISON_SHA256",
  "choices": {
    "[\"source\",\"selected-model.dmn\"]": "TAKE_RETURNED",
    "[\"source\",\"decision-catalog.json\"]": "TAKE_RETURNED",
    "options": "KEEP_CURRENT"
  }
}
```

Replace the illustrative keys with every actual changed row. The command rejects a missing choice, stale basis, a changed issue, conflicting history or a return outside the selected packet.

```sh
flowable-source-review apply --draft current.source-draft.json --exchange issued.review.json --returned returned.review.json --metadata adoption.json --output adopted.source-review.json
flowable-source-review compile --draft adopted.source-review.json --output commissioning.programme.json
```

The single adopted file contains the complete resulting draft, exchange/history, adoption record and **exact original incoming text**. Its raw incoming bytes remain available for a later retry; the command never reconstructs that identity from reformatted JSON. The source-review exchange retains all logical branches, while the adopted wrapper retains the original incoming representation as well.

Compilation calls the original authoring compiler. It is an explicit, separate command. Compilation success does not mean the programme ran. Use the original programme Save, native review, prepare, dispatch and receiving workflow for any actual engine operation.

## Reopen, retry and export original branches

After adoption, use the adopted file for both `--draft` and `--exchange` when continuing the author history. Those options accept either their original plain source format or this complete adopted file. `--returned` also accepts the adopted file and selects its exact retained incoming text.

A retry with the completed draft, completed exchange, same incoming text and same adoption metadata reopens the original result. Changed work is preserved: replay refuses to replace a draft edited after that completed adoption. Do not create a new adoption identity to conceal an uncertain prior attempt.

Extract any complete retained source branch through the original review engine:

```sh
flowable-source-review branch --exchange adopted.source-review.json --adoption-id partner_review_adoption_001 --branch result --output accepted.source-draft.json
flowable-source-review branch --exchange adopted.source-review.json --adoption-id partner_review_adoption_001 --branch current --output prior-author.source-draft.json
flowable-source-review branch --exchange adopted.source-review.json --return-id partner_review_return_001 --output colleague-return.source-draft.json
```

Branches are `baseline`, `current`, `returned` and `result`. The ordinary `draft` command extracts the issued baseline unless an explicit return ID is selected. It does not implicitly replace the current author draft with a return or adoption branch.

`inspect --exchange INPUT --output VERIFIED` validates full retained hashes and history, then writes the engine's complete normalized exchange. Keep the untouched incoming file: normalization can change its outer JSON bytes and is not a substitute for the original received representation.

## File publication and receiving

Each input is a bounded regular file, read with final-symlink refusal and stable inode/size/time checks. The receipt records every input's complete path, bytes and SHA256. Metadata is at most 1 MiB; the complete exchange or command result is at most 64 MiB. The original editable draft and compiled native programme keep their existing 16 MiB limits. Oversized complete results fail without truncation.

Output uses a private pending file, file sync, exclusive hard-link publication and parent-directory sync. Existing output is reused only if its complete bytes match. The pending name binds the final complete output hash; interrupted same-output prefixes can finish without overwriting unrelated files. The command reconciles its own exact retained pending link on replay. Preserve an error's original inputs and destination; do not replace source files or choose a fresh identity merely because a command was interrupted.

Output publication never overwrites a different existing edition. It does not grant an external file path permission or accept a packet as executable code. The installed source collector includes the real CLI, review engine, original compilers, typed declarations, browser assets and guides through the maintained contribution and browser manifest.

For complete colleague receiving, retain the issued exchange, exact return, current draft, comparison, explicit adoption metadata, adopted result and compiled programme. Open the source draft and exchange in the existing authoring/review desk; inspect source text, options, history and chosen branches, then download and reopen the results. Keep the existing workspace, operation and native owner. No second engine or browser controller is introduced by this command.

## Actual validation and remaining execution

The exact current pure source modules were run in connected V8 with the original Acorn module adapter. A complete seven-member decision draft was issued; a colleague changed original DMN source and refreshed its catalogue; the author concurrently changed the title. Explicit source choices preserved the author's title and local draft ID, retained the complete history, replayed the same adoption, and compiled through the original decision compiler to fourteen steps.

The Node file CLI, actual filesystem crash recovery, browser opening and native engine course have not been run by that pure-module check. Their real receiving remains with the original equipped owner. Before calling an outgoing product or attachment ready, perform the actual opening and visual inspection below.

## Current owner instructions


The following is the complete public repository owner instruction read from AGENTS.md, Git blob96d3752dc5277b2015178a03d9c124fdf9568d5a. It remains applicable to any resulting customer-facing product or attachment. Parser success does not satisfy the required actual opening and rendered inspection. Existing disabled Actions, original owners, account routes and stopped-work boundaries remain in force.

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. For Ecosystem Sciences, read `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4`. Bryce's direct instruction at October 13, 2026, 10:46 a.m. Eastern renewed the existing work toward his call and superseded the earlier 10 a.m. cutoff. Preserve active workers, completed scientific outputs and all other standing controls while finishing and integrating the actual application.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->


