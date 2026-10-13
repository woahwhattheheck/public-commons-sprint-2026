# Saved Published Studies reviews

A review saves a named reading of one exact retained study edition. Open Published studies, select its original stations, parameters, depth strata and dates, then save a title and working notes. Reopen that review to recover the same source edition and filters. Save a revision to preserve the earlier review and link the new one to it; save a new review when changing study edition.

## What the record retains

Each immutable review binds its study ID and version, native source collection, original source-manifest SHA-256 and the complete source-file inventory SHA-256. It also retains the selected table, canonical station/parameter/stratum/year/month selection, title, notes, original coverage and sampling-support snapshot, parent review identity when applicable, and save time. Empty parameter, stratum or month arrays retain the original “all” meaning. The original context reader expands an empty station selection to the actual station IDs, so a later edition cannot silently expand a saved cohort.

The record is content addressed as `review-<SHA256>`. Repeating the same save returns the existing immutable record. Saving changed notes or filters with a parent creates another record; it does not modify the parent. A parent must refer to the same source binding. An independently saved identical review can have its own save timestamp; receiving the same content preserves the receiving project's existing record and timestamp.

A review does not pool analytical fractions, measurement types, methods or units. The maintained PublishedStudyStore remains the sole table and report producer. Original observations keep their source row IDs, response columns, qualifiers, reporting limits and source hashes. In the source observation studies, date filters apply to actual sampling dates. In the published lake study, year/month filters apply to its continuous summaries while seasonal campaign tables retain their published sampling support. The original report explains that applicability alongside its data.

## Open, revise and share

The saved-review list shows exact study editions, saved titles and save times. Open review restores every saved station, parameter, depth stratum, year, month and table. Parameters, strata and months support multiple values; their All buttons clear the corresponding filter. Explicit saved values remain visible even if absent from the usual options or producing an empty cohort. Manual station filtering requires at least one selected station.

After opening a review, edit its title, notes, filters or table and choose Save review to create a linked revision. Save as new review creates an independent record; New review starts a fresh title and notes with the current selection. A manual switch to another study starts a new draft. Save edits before exporting when those edits belong in the shared review.

Working notes remain separate from scientific source records. Leaving the desk preserves its in-memory draft separately for each workspace, including its filters, table, title, notes and last opened review. Native saves are durable. Late responses or task completion can refresh the catalogue without replacing a newer edit, another review or a later workspace visit. Accepted tasks remain tracked across remounts and retries retain their original operation identity.

The complete review download is `saved-review.zip`. Extract it into a new directory and open `review.html`. The package contains:

- `review.json`: the exact immutable review, source binding, saved coverage and sampling-support snapshot.
- `selected/study-report.html` and its complete selected CSV/HTML/source-companion tree, produced by the existing selected-study exporter.
- `original-study.zip`: the entire bound study, original source files and native manifest.
- `review-export.json`: exact archive member sizes/hashes and whether the current interpretation agrees with the saved snapshot.

All relative report links remain within that extracted package. The operator offers the complete ZIP and exact selection JSON through its existing authenticated file tickets. A raw standalone HTML download is not substituted for the complete report tree.

If the maintained interpretation later changes coverage or sampling-support presentation, opening the review still verifies its exact original source edition and cohort. The interface and offline HTML explicitly identify that difference. The original snapshot remains in review.json, and the current selected report retains the actual current interpretation. Source-binding or selection mismatches are errors.

Use Import saved review to receive a complete review ZIP. The native importer validates every declared archive member, restores the original study through its maintained importer, resolves the exact saved cohort, and publishes the immutable review only after those checks. Receiving an older review preserves an existing current study edition. A fresh workspace receives the original edition as its first current study. The review itself opens by its exact version rather than by the current-study alias.

## Existing Workspace portability

Saved records are normal retained files beneath `published_studies/reviews/`, inside the existing Published Studies portable root. Existing complete project backup/restore therefore carries them with the original study and source collections. Source resolution uses the restored Workspace root and the native source manifest; review records contain no absolute source-folder dependency.

A standalone review ZIP carries the original study needed for its own reopening. Its parent review ID is provenance; importing an earlier parent is not required to open the exported review. A full project transfer retains every local parent edition.

## Native API and command line

Existing source routes and report producers are unchanged. The catalogue additionally returns `reviews`. The read-only endpoint is:

`POST /api/published-studies/review` with `{workspace, review_id}`.

It returns the exact `review`, the existing fully decorated `context`, and `interpretation_matches_snapshot`. The normal team viewer policy permits this read; queued mutation/export tasks keep the operator's existing write authorization.

Use the existing task API for:

- `published-study.review.save`: `{study_id, version_id, title, notes, table, selection, parent_review_id?}`.
- `published-study.review.export`: `{review_id}`.
- `published-study.review.import`: `{source:{source_collection_id,source_id}}` or the existing administrator source-folder selector `{source:{root_id,relative_path}}`.

Every task retains the original accepted task/operation identity and returns the saved review plus exact study/version/selection/table. Existing task decoration creates authenticated artifact tickets.

The full native course is available without a browser:

```bash
python -B -m measurement_workspace.study_reviews --workspace "$WORKSPACE" list
python -B -m measurement_workspace.study_reviews --workspace "$WORKSPACE" --result "$OUTPUT/saved.json" save --selection "$OUTPUT/review-request.json"
python -B -m measurement_workspace.study_reviews --workspace "$WORKSPACE" --result "$OUTPUT/opened.json" open --review-id "$REVIEW_ID"
python -B -m measurement_workspace.study_reviews --workspace "$WORKSPACE" --result "$OUTPUT/exported.json" export --review-id "$REVIEW_ID" --out "$OUTPUT/review-export"
python -B -m measurement_workspace.study_reviews --workspace "$RECEIVING_WORKSPACE" --result "$OUTPUT/received.json" receive --source "$OUTPUT/review-export/saved-review.zip" --operation-id "$ORIGINAL_RECEIVING_OPERATION"
```

The save request is ordinary JSON. Set the exact IDs returned by the native catalogue; for example:

```json
{
  "study_id": "ACTUAL_RETAINED_STUDY_ID",
  "version_id": "ACTUAL_RETAINED_STUDY_VERSION",
  "title": "Upstream sampling review",
  "notes": "Working notes about this original selected cohort.",
  "table": "observed",
  "selection": {
    "site_ids": [],
    "parameters": [],
    "strata": [],
    "year": null,
    "months": []
  }
}
```

For the existing native receiving operation, use an already imported original study, save an actual station/parameter/date selection, export it, receive the complete ZIP in the original receiving workspace, and reopen the same review ID. Compare its source binding and canonical selection, verify original selected CSV rows and report links, then include it in the existing project archive/restore course. This is a continuation of the maintained Published Studies operation; no model execution or source recapture is required.


## Continue a completed SV-833 receiving operation

The maintained SV-833 receiver can add the complete saved-review course to an already completed native intake. Use its original Workspace and receiving directory, containing the original `operation.json`, with the current complete application:

```sh
"$PYTHON" -B "$APPLICATION/source_tools/receive_sv833_study.py" \
  --application "$APPLICATION" \
  --workspace "$WORKSPACE" \
  --output "$RECEIVING" \
  --saved-review
```

This option reads the exact `study_id`, `version_id`, source collection and station/parameter/calendar selection from the completed operation. It enters before the installed built-in companion is regenerated, so a later installed hydrology/source edition does not replace the original review cohort. The original study and project archives are checked against their retained byte counts and SHA256 values. Ordinary intake without this option keeps its existing behavior.

The continuation saves and opens a named review, exports the complete review ZIP, and receives it in the same Workspace. It compares the actual current-study file before and after receiving; an already selected newer edition remains selected. A fresh review archive and restored project are named with the exact review ID. The existing original study ZIP, original scientific Workspace ZIP, and original restored project retain their paths and identities.

Its phases and results live under `continuations.saved_review` in the same operation JSON. A repeated invocation reopens the retained review and verifies previously accepted artifacts. It uses the selected-edition snapshot inside its own archive when checking a restored project, so a later legitimate change to the live Workspace does not invalidate that earlier archive. The restored source collection, original result identifiers, canonical saved selection and original native source-file bytes remain the receiving criteria.

After native completion, open the same Workspace in its existing operator session and choose Published studies. Select the exact saved study/version, then use an actually available station, parameter and calendar selection. Save review; reopen its returned ID; edit notes and save a linked revision; use Save as new review for an independent record. Export its complete ZIP and import it through the actual allowed source root containing that returned archive. The original task UI retains accepted task/result identities. Navigate away and back to check the retained working draft; use another Workspace only when that actual Workspace exists.

The native receiver reports its actual review ID, source binding, selected edition before/after receive, new archive identity and restored project path. Browser receiving adds the actual operator origin and interaction result to that same operation record.


## Relocate the same completed receiving operation

A retained original project can continue on another equipped host after the first host becomes unavailable. Restore the exact original full Workspace archive through the existing `model.cli restore` command into a fresh directory. Keep its project ID and original study edition; selecting another regional project with similar files does not resume this operation. Use the current complete application for the added saved-review feature.

Copy the original complete-study ZIP, original full-Workspace ZIP, and the original completed `operation.json` as immutable received artifacts. Verify the operation file against its published byte length and SHA-256. Create an explicit location specification using those actual files:

```json
{
  "schema": "upstate.published-study-receiving-relocation/v1",
  "operation": {
    "path": "/received/original-operation.json",
    "bytes": 46617,
    "sha256": "ACTUAL_PUBLISHED_OPERATION_SHA256"
  },
  "archives": {
    "complete_study": "/received/original-study.zip",
    "project_archive": "/received/original-workspace.zip"
  }
}
```

The example byte length belongs to the original AE11 SV-833 receipt; use the actual published length/hash for any other original operation. Archive byte lengths and hashes come from that verified operation, rather than from newly generated source files.

Continue through the same original profile command:

```sh
"$PYTHON" -B "$APPLICATION/source_tools/receive_sv833_study.py" \
  --application "$APPLICATION" \
  --workspace "$RESTORED_ORIGINAL_WORKSPACE" \
  --output "$RELOCATED_RECEIVING" \
  --saved-review \
  --relocate-receiving "$RELOCATION_SPEC"
```

The maintained RL-18151 wrapper supports the same option for its own original operation. Keep each profile's original command and operation together. Relocation requires an existing restored Workspace and cannot be combined with `--create-workspace`.

Before recording a location, the receiver verifies:

- The immutable original operation's exact bytes and SHA-256.
- Both original archives against the operation's retained identities, plus every full-Workspace archive member.
- The restored project's original identity, exact retained study/version/source collection and original result count.
- The restored source-collection record and study edition records against their original archived bytes.

The receiver keeps the original `request`, `operation_id`, source hash, and completed `phases` unchanged. It preserves the exact original operation bytes as `relocation-original-operation.json`, then appends the explicit original-to-current paths and verified archive/source bindings to `receiving_locations`. The usual `continuations.saved_review` contains the new actual review/export/receive/archive/reopen results.

Use separate Workspace and receiving-output directories. Each new root must be identical to its corresponding original root or disjoint from the original roots; ancestor/child substitutions and swapping the original Workspace/output roots are rejected. The immutable input operation and specification must remain separate from the live receiving `operation.json`.

Repeat the command with the same specification to resume accepted phases. Existing continuation artifacts resolve only through the two explicitly verified archive locations or the retained original Workspace/output roots, and their original byte lengths and hashes are checked again. Transfer any previously completed review export or continuation archive before resuming a partially completed continuation. New review results use their own review-ID paths; the two original archives retain their exact bytes. A newer legitimately selected study edition in the restored Workspace remains selected when the older saved review is received.


## Continue both original and hydrology reviews through scientific reports

The same original receiving command accepts an optional `--scientific-report SPEC.json` after `--saved-review`. It requires the original saved-review continuation to finish first. This does not reimport a builtin or substitute the newer hydrology edition for the original completed observation intake.

The specification explicitly selects an already retained **second study edition** and its original typed hydrology report source(s), in reading order:

```json
{
  "schema": "upstate.published-study-report-receiving/v1",
  "title": "SV-833 observation and hydrology study",
  "hydrology_version_id": "ACTUAL_RETAINED_HYDROLOGY_VERSION_ID",
  "hydrology_sources": [
    {
      "source_collection_id": "ACTUAL_RETAINED_COLLECTION_ID",
      "source_id": "ACTUAL_TYPED_HYDROLOGY_REPORT_SOURCE_ID",
      "body_sha256": "ACTUAL_RETAINED_RECIPE_BODY_SHA256"
    }
  ]
}
```

Read the IDs and recipe body hash from the actual completed native producer and original imported source record. The current source producer's corrected HTML, SVG, generator and source manifest belong to a new source-bound recipe edition; an older completed report remains its original edition.

Continue the **same** existing Workspace/output/relocation specification:

```sh
"$PYTHON" -B "$APPLICATION/source_tools/receive_sv833_study.py" \
  --application "$APPLICATION" --workspace "$WORKSPACE" \
  --output "$ORIGINAL_SAVED_REVIEW_OUTPUT" \
  --saved-review --relocate-receiving "$ORIGINAL_RELOCATION_SPEC" \
  --scientific-report "$EXPLICIT_REPORT_SPEC"
```

Omit `--relocate-receiving` only when using the original operation's original Workspace/output paths. Keep the immutable report specification outside its generated receiving directories. The original AE11 operation remains `sv833-native-16486604c6a45729b99d0054` and its project remains `618c2faa-1464-4b9b-9234-4832116a1520`; a regional project is a different Workspace.

The continuation retains two separately labeled reports:

1. **Original selected observation review.** The exact review ID, original source edition and original saved filters from the completed `saved_review` phase are reused.
2. **Hydrology and selected observations.** A separate review is saved against the explicitly selected hydrology study edition, using the original observation selection. It is a new review, not a parent revision across different source editions. The ordered report contains the explicit hydrology source(s) followed by this review's selected scientific source.

Both source captures use the original `published_review_report_source` producer. Source counts, units, methods, censoring, sampling calendars and source-scope explanations remain that producer's original output. The new edition must retain all distinct original result identifiers, every original result CSV cell, its original file hash and row, and every original joined activity/reporting-limit cell and source reference. Only native collection selectors that change with the retained edition are excluded from this original-data comparison. The two reports preserve their distinct source bindings rather than merging or adding their observation counts.

### Original operator and transfer sequence

The maintained `source/observed-report-20261013/receive_operator.py --course` owns rendering, saved task identities, complete PDF/HTML/Markdown/data downloads, report ZIPs and complete Workspace backup/restore. Its own `--resume` runs against the existing output after interruption. Receive the current maintained recovery edition of that original receiver before continuing a task across renderer updates.

After both reports complete, the original Study exporter selects both `scientific-report-editions` roots in one archive. Its typed saved-review adapter includes both complete original study editions, both immutable reviews, their captured scientific source families, and the complete saved report files. It retains explicit versions; an unrelated mutable current-study pointer is not needed for reopening them.

The continuation then restores that archive and starts the **restored application's own** `source_tools/continue_study_report.py --cold-inspect` with the same native interpreter, from the restored application directory and without inherited `PYTHONPATH`. It verifies the original selected Study receipt, both study/source/review identities, both captured review sources and all retained report files. It renders no new report during this cold read.

When the receiving directory already exists, the continuation uses the maintained `model.portable.resume_restore` API with the original archive SHA-256. That producer verifies the archive, project and receiving destination and recognizes its own completed registration, including delivery roles and derived navigation. Earlier successful receives are reconciled through its legacy compatibility path. The subsequent cold application read still checks the selected original study/review/source/report identities and complete retained report files. This preserves a valid existing receive after native delivery registration without overwriting the receiving directory. New destinations continue through the original `restore` API.

The `editable_study_receiving` phase retains the complete original `restore` or `resume_restore` result. The separate `received_application` phase records the received application directory, original archive SHA-256 and exact required source descriptors, including `model/portable.py`. Those descriptors come from the original archive, so a later update to the authoring application does not substitute its code for the received edition. New cold-read expectations include that portable source directly; an already-started course keeps its original immutable expectation while the parent verifies the same archived portable source before launching the cold read.

All additional phases are under `operation.json → continuations.scientific_report`. Original intake phases, original archives and the `saved_review` continuation remain separately retained. The new files live below an owned `scientific-review-<request digest>` directory:

- `request.json` and `report-course.json`: immutable explicit source choices.
- `report-*/scientific-report-receiving.json`: actual original operator task/result receipts and report downloads.
- `editable-study-selection.json` and `observation-hydrology-reviews-study.zip`: both saved report roots and their editable source history.
- `cold-reopen-expectation.json`, `cold-reopen.json` and complete subprocess logs: exact original receiving identities and the returned native read.
- `cold-reopened-study/{application,workspace}`: independently received complete editable Study.

A source or task failure retains the actual diagnostic and completed checkpoints. Resume the same original command and specification after repairing that source. Changing the selected hydrology source edition is a new request and needs a separate owned receiving operation; it does not rewrite a completed report.

### Installation closure

The complete Published Studies family includes `source_tools/continue_study_report.py` and the additive `published-study-report-receiving` component fragment. Scientific Reports already depends on Study transfer and Published Studies; the fragment retains the receiving helper/entrypoints in that existing direction. It adds no reverse Published Studies dependency on the report renderer. A standalone Published Studies installation keeps its original observation/review commands; the optional report continuation additionally needs the maintained Scientific Reports operator and original Study transfer dispatcher.


## Recipient opening page — presentation edition 2

New review exports identify `presentation_edition: "published-study-review/2"`
in the existing `review-export.json`. The original bundle schema, review content
identity, exact source binding, native selected report, all source members and
import contract are unchanged. Earlier archives remain readable.

Extract the complete `saved-review.zip` and open `review.html`. The opening page
has an actual device-width viewport and readable original station, parameter,
stratum, year, named-month and saved-table labels. Its first controls open the
selected scientific study report, complete original study ZIP and exact review
JSON. Long source identities wrap; full saved notes are available in an explicit
disclosure and in the unchanged review JSON. This keeps a long working-operation
note from filling the opening page, without editing or omitting it.

The page's small-screen layout uses one readable label/value column. Keyboard
focus remains visible. Printing keeps native labels and links, with full notes
printed when their disclosure is open. A changed interpretation remains explicitly
identified next to its unchanged source edition and filters. Actual measurements,
units, qualifiers, censor treatment and scientific calendars remain in the
maintained original report.

### Same native f17 export continuation

This repairs the actual F942 received-page finding at sales
`1791888827.064409`. Preserve its completed report
`observed-report-8255ad49c0c3b1de2b97`, original f17 project, six rendered PDF pages,
two selected-record pages and complete 53-member scientific report. Reuse its
actual retained review ID; do not recapture observations or rerun analysis.

Export that review with the maintained command into a **new** owned output
directory after receiving the current source. Keep the prior archive and exact
review JSON. The original native CLI shown above accepts `export --review-id`
and `--out`; use the actual existing Workspace, review ID and native interpreter.
Reopen the new complete archive through the normal review importer. Receiving
preserves an existing current study edition.

The producing worker must actually open, LOOK at and use the exact outgoing
`review.html` at the presentation/desktop width and 390px, operate its notes and
source-identity disclosures, and follow all three original links. Inspect
applicable populated/empty/error states, downloads and reopening. Open and view
the actual selected report/PDF pages, original CSV/JSON, complete source archive
and received editable study in their normal recipient-facing applications.
Look at the actual screens or viewed screenshots; source text, schemas, HTTP200,
DOM counts and passing tests are not visual acceptance. Repair concrete defects
on this same source/course and return its exact outgoing source/artifact identity,
actual viewports and controls/files used. Keep plain readable industrial styling,
focused internal validation and the main engineering work moving.

Every delegated worker carries the complete application `AGENTS.md` and
`CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`, with this guide. The
standalone installer and original portable application capture include both.
This is a normal current-source receiving continuation; create no new watcher,
approval gate or duplicate model/observation job. Preserve active native model
execution, existing owners and **October 13, 2026 14:00 UTC** cutoff.

### Complete current owner brief


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
