# Received Published-study reviews

This continues the original saved-review → Scientific Reports → selected editable Study → received Workspace journey. A received source card opens the exact saved review, original study version and original selected observations in the existing Published studies desk. It also opens the original source collection, starts a report containing only that source, or explicitly appends it to the existing report.

## Original scientific identities

The reader follows only `scientific_report_sources` entries whose retained `report_context_kind` is `published_study_review`. The maintained Study resolver is the authority: it verifies the complete captured lineage, source collection, source body and original review producer's identity, recipe, interpretation, selected CSVs, source manifest, original source files and complete review ZIP. The receiving adapter uses those original records. It does not infer a review from a filename, title or matching observations.

The displayed selection preserves all station, parameter, stratum, year and month values, including selected values with no observations. Each card keeps its own source edition and interpretation. A captured interpretation differing from the saved review's coverage or temporal-support snapshot is labelled; opening the native review retains the original desk's current-interpretation notice. No observations or quantities are recomputed by the receiving card.

Same-project captures contain their original editable review and study-version records. The Open exact saved review action loads that review through the original API and checks its review ID, complete binding and selection against the captured card before replacing the current desk selection. It then checks the exact study version, source collection and manifest. A fresh catalogue is loaded during direct navigation; pending mount/geographic reads and stale Workspace/edit responses cannot replace the chosen review. The original saved note/table/filter editing and save-as-new/revision flows remain available.

An external-project source keeps its original project identity and complete files. Its source card does not invent a local editable review. The complete original study and saved review ZIP can be imported through the existing Published studies import form when an operator explicitly chooses that workflow; the original received Study remains intact.

## API and original downloads

Existing `GET /api/study-transfer/received` rows add `published_review_source_count` and `editable_published_review_count`. Existing `GET /api/study-transfer/received-detail?study_id=...` adds `published_reviews`, one row per captured source. Each row carries the original `review`, `original_study` binding, `selection`, source choice, project relationship, interpretation identity, associated original report IDs, and verified source-member downloads.

Original file tickets come from the maintained authenticated operator download service. Their labels preserve original logical filenames, even though their retained bytes use content-addressed paths. The first links are the complete `original-review.zip`, original `review.json`, and captured `selected-context.json`. All recipe/CSV/implementation/source companions remain available in the full inventory. Downloaded bytes are the captured originals.

Public controller entry:

```js
await host.openExtension('published-studies', 'openSavedReview', {
  workspace_key,
  review_id,
  expected_binding: captured.original_study,
  expected_selection: captured.selection,
});
```

Only the card's exact current receiving Workspace and source-bound values should be supplied. The controller rejects a changed binding or selection; it preserves the previous draft when a request becomes stale or fails validation.

## Installation and complete transfer

`install_published_studies.py --application EXISTING_APPLICATION` installs the full current Published-studies family, including this reader/provider/client/CSS and component fragment. It composes guarded, idempotent imports and calls into the existing received-study model/provider/client and appends its exact declared asset/style registration. Existing Gauge, ensemble, cohort, fieldwork, customer-review, land-cover and report-change handlers remain owned by their original modules. Unknown or partially edited registration anchors produce a concrete source error before file installation.

The new component fragment extends the original Published studies and Study transfer families. Study transfer already depends on Published studies; there is no reverse dependency or new storage engine. Whole Workspace and selected Study transfers keep the maintained complete application capture and original review/source file closure.

## Same native receiving continuation

Continue the already accepted original operation with its actual saved review, report edition and Study-transfer IDs. Do not recapture an agency source or rerun a scientific model for this UI join. For the existing SV833 continuation, the original 79-source study and explicitly retained hydrology 103/135-source study remain separate editions over the original observation cohort.

After the original selected-Study restoration, use its running authenticated operator and open Study transfer → Received Studies → the actual captured Study. Check the returned review IDs, full source binding and filters against that Study's original `scientific_report_sources` entries. Open each actual local review, return to Received Studies, reopen it, revise notes through the original save action, and retain the new returned review ID. Use Open this report only and Add to current report as explicitly different actions. Download and open the original review JSON, selected interpretation, selected-record CSVs and complete original study/review ZIP; use the existing import and reopen controls for that exact archive. Check that another retained study version's current selection is preserved as specified by the original importer.

Open the actual transferred application from its own restored source and repeat the original receiving/detail→review navigation there. Preserve the original receipt, accepted operations and completed archives. A source change is a new explicit continuation boundary, not permission to substitute a newer application's code for an archive's retained implementation. Return actual operation, review, study-version and report IDs and any first concrete exception to the same source owners.

## Required use of the final product

Required use of the final product
Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing peer must actually open, run or render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated, empty, loading and error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP 200, unit checks or another peer's approval do not replace seeing the actual product.

ALL ATTACHMENTS count. Literally open, view, play and use the final delivered HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and project as its recipient would. For archives, extract and open the actual contained deliverables and working project. Tests, checklists and screenshots merely captured are not substitutes. Use available high-quality generative media models and natural voice generation/TTS for videos; avoid robotic default voices. Watch and listen to the final export for pronunciation, pacing, timing and audio alignment. Keep building and fixing; inspection is not review/test performance theatre.

For the Ecosystem product use plain industrial design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. No decorative template slop. Keep the real workflows, data and computation. Reviews must lead directly to repairs and must not replace hard implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a separate verification product. Prior empty-Workspace screenshots are not acceptance of a completed scientific Workspace.

PERSISTENT PROPAGATION REQUIRED: copy this rule into every active owner-controlled policy/instruction surface the provider and workers actually read: global and project AGENTS, CLAUDE, GEMINI and rules files, provider-specific boot instructions, Commons source mirrors, cloud repository instruction copies, and current build and receiving guides. Every delegating peer includes this complete rule in child assignments, including its all-attachments and final-media clarification. Return exact changed paths, source/version and readback. A Slack ACK alone is not propagation. Preserve all existing owner controls and do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work. Continue the same Ecosystem Sprint Integration assembled product and its original scientific, run, browser and receiver owners. Continue native source, runtime and archive joins rather than diverting everyone to cosmetic review. Preserve October13 cutoff10amEDT/14UTC; this does not expire standing inspection rule or change other owner-directed schedules.
