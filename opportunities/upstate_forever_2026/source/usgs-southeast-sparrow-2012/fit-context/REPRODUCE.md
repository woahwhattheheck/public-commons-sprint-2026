# Reproduce the complete published-calibration context

This is a fixed source-context chapter for WO28. It adds no Workspace, scientific fit, queue, native run, contact or source acquisition. The original independent-comparison operator may display its installed JSON in a read-only context panel and offer complete downloads.

## Files and original custody

`inputs.json` contains the exact complete UTF-8 source text of all three regional mapper calibration responses and the complete original USGS XML dictionary, each with repository path, immutable Git blob, bytes and SHA256. `sparrow-fit-context.json` preserves all 1,582 original feature objects with source IDs, all fifteen requested target cells, field definitions, raw arithmetic and explicit limitations. `five-targets.csv` preserves missing matches as separate rows; `regional-records.csv` includes every original feature serialized in the last column. `SPARROW_FIT_CONTEXT.md` is the readable source-context chapter. Do not treat these calibration tables as the separately acquired prediction-reach release.

## Repeatable calculation

Run on the existing equipped original receiving worker:

```sh
node analyze.cjs inputs.json NEW_OUTPUT_DIRECTORY
```

The script reads only retained local inputs, verifies every original byte/SHA pin, requires the original complete 598/589/395 tables and five target IDs, then writes four complete outputs into a new directory. Existing outputs are never overwritten. The pure `analyze(input, hash)` accepts a UTF-8 hash function returning `{bytes,sha256}` and performs no I/O; `report` and `csv` render the same full result. No network, model fitting, new source data or physical-unit conversion occurs. A separately labeled conditional published-method sediment column applies original TSS_CONV via ACTUAL_MT/exp(TSS_CONV), citing USGS SIR2019-5135 page60/equation3, only to recognized TSS/negative-coefficient or SUSPSED/zero patterns. Original raw values/arithmetic remain unchanged; other patterns remain flagged. Native Node CLI execution remains the original equipped course; the actual source computation here ran this complete pure function in V8 over the retained source texts.

## Authenticated installed panel contract

The original operator may load `source/usgs-southeast-sparrow-2012/fit-context/sparrow-fit-context.json` and return it through its existing authenticated read route with original workspace/project identity. Top-level keys are `schema`, `title`, `operationId`, `sourceIdentity`, `targets`, `parameters`, `counts`, `comparisons`, `regional`, `dictionaryEntries`, `limitations`, `sources`. No display read writes a comparison selection.

Each comparison contains `{target,comid,parameter,status,sourcePath,sourceSha256,actualField,predictedField,rows,interpretation}`. Missing calibration cells have `status: NO_CALIBRATION_ROW` and empty `rows`. Matched rows include original field names/values, raw difference/relativePercent/ratio, exact station/OBJECTID/sourceRow, unresolved mapper-unit object, constituent/TSS_CONV, publishedMethodSscContext (conditional method/citation/coefficient/factor/actualSscEquivalent/predicted/difference/relativePercent/ratio), complete `original` feature and empirical context percentile. The regional array retains all full rows and field metadata. Raw `%` is already multiplied by100; unlike native-domain `relative_difference`, it is not a ratio. Every caption must distinguish raw published arithmetic from matched native/reference residuals.

Keep full sources, recipe and outputs in component/Study source closure. A generated downloadable bundle must include all seven files; a JSON result alone preserves all records but not the original lexical source texts/dictionary. Do not replace or normalize original mapper values using subsequently acquired prediction rows.

## Focused receiving and exact edition

Open the actual installed read-only panel at screenshare and narrow widths. Check all fifteen target cells, the four missing matches, full station IDs, raw and conditional published-method sediment columns, exact coefficient/factor, sediment lineage and unresolved-unit labels; expand a complete original record and download/reopen the complete JSON and both CSVs. Open the readable report and complete source package normally. The source calculation and peer review do not establish rendered acceptance. No native/browser receipt is asserted by this source delivery; the existing original equipped course owns it. Keep source-only facts and actual render evidence distinct.

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

