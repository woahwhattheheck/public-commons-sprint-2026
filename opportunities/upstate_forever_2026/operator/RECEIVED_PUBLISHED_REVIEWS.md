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


## Explicit captured external review admission

The received Study card now offers **Import as editable review** for an external
saved Published-study review. It verifies the captured report source, exact
original review ZIP, original study edition and saved filters, then submits
`received.published-review.admit` to the existing operator queue. The original
`PublishedStudyReviews.receive` validates and imports the complete review and
study. Its `make_current=False` behavior preserves a study edition already
selected in this project. Existing same-ID/content reviews retain their existing
saved timestamp.

This operation preserves the foreign scientific source and report. It adds a
separate immutable admission under
`published-review-admissions/<admission-id>/` and opens the exact native review
through the original Published studies editor. Use its existing notes, filters,
Save revision, Save as new and Prepare scientific report controls. Original
measured rows, units, censor interpretation and study-specific calendars remain
the original store's responsibility.

The preview request is:

```json
{
  "study_id": "<actual received Study transfer ID>",
  "source_collection_id": "<captured scientific source collection ID>",
  "source_id": "<captured source ID>",
  "source_body_sha256": "<captured report body SHA256>",
  "review_id": "review-<original 64-character content identity>",
  "archive_sha256": "<captured original-review.zip SHA256>"
}
```

GET `/api/received-published-review/preview` takes those fields and the current
`workspace` query parameter. The original queue POST to `/api/actions` uses
the same payload plus the returned `admission_id`, action
`received.published-review.admit`, current workspace and an operation ID.
GET `/api/received-published-review/admission?workspace=KEY&id=ID` reopens the
completed admission and issues original download tickets.

The card retains an accepted task/request in the current browser session. It
observes only that task while its exact Study and Workspace remain open. Leaving
the desk stops observation without canceling the native task. Returning exposes
**Continue original import** and **Open import task**; the same accepted request
is reopened rather than duplicated. Queue/source errors remain visible. A source
archive whose older registration cannot satisfy the maintained importer's exact
binding is not remapped to a different edition.

### Revised-only selected-Study portability

When an admitted source edition appears in a later locally prepared review report,
the typed review resolver retains the initial admission, original imported review,
complete original study source edition and foreign scientific source/archive.
This also covers Save as new using that same exact source edition. It records
source provenance, without inventing a review parent. The later report keeps its
own original selection and interpretation.

Capture and received-card augmentation validate raw original records and content
addresses; they do not materialize source views during an active immutable
archive snapshot. The normal detail/editor path separately uses the original
store to resolve the exact current interpretation. Full Workspace archives
retain the same admission directory automatically.

### Continue the existing native receiving operation

Use the existing accepted 8365 SV-833 receiving course and its actual retained
project/source/review IDs. Preserve the separately identified original 79-file
study and hydrology editions, the original 610-result cohort and immutable
archives. Do not recapture data or start another model job for this operation.

In that current operator, open the received external saved-review source card,
import through the explicit control, open the exact original review, and compare
its complete station/parameter/stratum/year/month arrays and notes with the
captured source. Save a changed review, prepare its normal scientific report,
export only that later report as an editable Study, receive it through the
maintained operator, and cold-open the copied application. Confirm the revised
review, initial admission and original source archive remain usable. Use returned
native IDs and errors; do not substitute constructed IDs or source inspection for
a native result.

The producing worker must operate and visually inspect the exact outgoing
received cards/editor, desktop and narrow layouts, applicable loading/empty/error
states, original downloads and reopened attachments as a recipient would. The
existing standing rule below remains in full force. Record any concrete defect
and repair it in the maintained original path; no parallel approval gate or
broad test suite is introduced.

## Received review metadata and original file verification

Received Studies lists all matching local admissions in one pass for the current
Study. The first metadata read of each admission still runs the original complete
receipt, source, captured review and archive validation. Later refreshes may reuse
only that small validated summary while every dependency remains the same:
receipt, plan, native review, archive, source collection, recipe body and all
original companions. Each check retains the original contained regular-file and
no-symlink rules and compares device, inode, length, modification time and change
time. A changed or missing dependency discards the cached summary and invokes the
original reader again; errors do not become cached successes.

This is an in-process metadata optimization, not a new declaration that original
file bytes have been verified. Cache entries hold independent canonical bytes,
with a maximum of 128 admissions and 8 MiB across their summaries and dependency
signatures. Eviction, process restart or a larger valid entry uses the original
full validation path. These cache budgets do not limit an admissible review,
source archive or operation.

Full admission opening, explicit import, selected Study capture and verification
keep their original validation paths. In particular, selected Study capture still
uses the raw retained records and does not materialize source views. Listing
download links checks the original retained path, declared SHA-256 and exact
length, then creates the existing authenticated file ticket. The unchanged
download transport authorizes the Workspace, opens the actual file, verifies its
SHA-256 whenever its full file signature has changed, checks stability and serves
that same opened file. A listed link does not stand in for successful download
verification.

### Continue the existing native receiving course

Use the existing F942 received-review operation and its actual Workspace. Open
the received Study, refresh it twice, and confirm the original source cards,
admission IDs and full saved filter arrays remain available. Open the admitted
review through its original public read route, then download the retained review
archive and readable source attachments through their ordinary tickets. Reopen
the editable Study through the maintained receiving path. Preserve the actual
returned IDs and any exception; do not manufacture performance timings or claim
a native execution from source inspection.

The producing worker must inspect the exact rendered received cards and all
outgoing attachments at desktop and narrow sizes, operate the critical controls,
downloads and reopen path, and repair any observed defect. Continue this work
inside the existing operation and current owner direction below; no new model run,
shared controller, polling loop or broad test suite is required.

## Active owner direction carried with this source

Read the complete application-root `CURRENT_OWNER_DIRECTION.md`, version
`2026-10-13.3`, and application `AGENTS.md`. Both are explicit component and
installer dependencies. The complete current brief follows so this receiving
guide carries the direction into its existing native work order. This review
operation supports the current product; preserve active simulated native
NDR/SDR baseline/restoration/matched-control execution and the 14:00 UTC cutoff.


# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
