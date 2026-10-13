# Editable Report Changes study transfer

TokenJunkieLabs · ES26 · original ASTRA-REV13 Report Changes

## Operator workflow

Open **Report changes**, reopen a complete saved comparison, and choose
**Transfer editable comparison**. The same action appears beside each saved
comparison. The original Study transfer desk opens with the exact
`scientific-report-comparisons` root selected. Review its dependency preview
and queue the original Study export. Its existing completed archive transport,
file tickets and receive/restore actions remain the delivery path.

Restore the selected archive into a new Workspace with the original receiving
flow. In Study transfer, find **Scientific report comparisons** and choose
**Open report comparison**. This mounts the existing Report changes desk and
opens that exact saved comparison. Its complete HTML, change CSV, indexed
SQLite register, original report viewers, row filters and paging use the same
native provider. A recipient can reopen either original scientific edition,
continue its retained producer workflow, render a new edition, and use the
original comparison form to explicitly select the next pair and row keys.

The transfer does not submit a numerical model, render another report, or
calculate another comparison. Its two queue transitions are the existing
Study export and existing archive receiving. Preparing a later comparison
continues to use the original `report-changes.prepare` action.

## Preserved scientific identity

The producer computes the comparison identifier from its original schema,
engine version, earlier and later edition fingerprints, and the normalized
matching plan. This transfer retains that identity verbatim. Earlier/later
order is explicit. An edition fingerprint contains its project identifier,
saved edition identifier and every original retained file's path, byte length
and SHA256.

Sections match by exact heading and occurrence. Tables match by occurrence
within that section. Explicit row keys remain the producer's ordered,
zero-based column indices from the earlier table; each header must identify
exactly one column on each side. The producer maps the selected original
header to the later table's column. With no keys, its exact-row multiset
comparison preserves duplicate counts. The original `include_positions`
choice remains part of the saved plan. No transfer step infers new keys,
reorders them, rounds numeric values or changes the plan.

The helper invokes the original read-only `report_changes.members` and
`edition` verification. It validates the complete frozen pair before adding
the original local scientific editions through the existing
`scientific_report_study_transfer` resolver. That resolver follows ordered
source collections and their maintained editable diagnostic, Monitoring,
Community, Conservation, calibration, native-process, source-water and other
registered lineage. CAS source views are not materialized during closure.

Native Report changes prepares both editions in one registered project. The
typed transfer therefore requires both frozen edition project identifiers to
match the original Workspace, and their complete fingerprints must match
the locally saved original editions. A physically copied standalone
cross-project comparison is identified as such; its existing independent
comparison ZIP receiving workflow remains available. A matching-looking
identifier from another project is never treated as a local editable source.

## Complete retained contents

For `scientific-report-comparisons/<comparison-id>`, the original engine
declares the full retained member map. It includes the completed
`comparison.json`, `identity.json`, `summary.json`, `changes.csv`,
`changes.sqlite`, complete HTML pages and both complete original edition
trees under `left/` and `right/`. The helper retains every declared member
with its original byte length and SHA256. The original finalized
`changes.sqlite` is immutable and uses DELETE journaling; it is transferred
as exact original bytes, not as a mutable Store snapshot.

The original top-level scientific edition trees and their editable source
dependencies are also retained. Shared source objects are included once by
the existing closure. If an original
`scientific-report-comparison-exports/<comparison-id>.zip` already exists,
the helper verifies every ZIP member and its exact comparison manifest,
then retains that complete ZIP too. A ZIP created after the captured study
is permitted; one captured in the original study must remain byte-identical.

When **Include related results** is enabled for explicitly selected saved
scientific reports, their saved comparisons may be included. This discovery
uses only the user's explicit report roots. The opposite edition reached
through a comparison does not pull every other report pair into the study.

## Original locking and receiving

The shared Study exporter first resolves the dependency graph, acquires the
native writer locks, then resolves and verifies the same graph before capture.
This helper supplies the producer's actual sibling locks:

- `scientific-report-comparisons/.<comparison-id>.lock`
- `scientific-report-comparison-exports/.<comparison-id>.zip.lock`

The ordinary scientific-edition and editable source locks are supplied by
their existing owners. The selected-study receipt stores
`identity.report_comparisons`: each original pair identity, normalized plan,
complete member inventory, both edition fingerprints and any captured ZIP.
Receiving uses the original comparison inspection again and checks the
receipt against the same dependency graph. Older selected-study receipts
without this optional field keep their existing verification path.

The comparison browser resolves the saved native detail again before
handoff. A Workspace change, desk detach or opening another comparison
invalidates a pending transfer read. The receiving method
`openForStudy({workspace_key,id})` requires the currently mounted registered
Workspace and exact saved identifier. It never substitutes the current
unsubmitted report-selection draft.

## Existing CLI operation

Use the original equipped interpreter from the actual maintained application
directory. All identifiers below come from retained original records.

```sh
PYTHON -B -m model.study_transfer_cli catalog \
  --workspace ACTUAL_WORKSPACE \
  --kind scientific-report-comparisons
```

Save the exact selection outside the source Workspace:

```json
{
  "schema": "upstate.study-selection/v1",
  "title": "Selected report comparison and editable source history",
  "roots": [
    {
      "kind": "scientific-report-comparisons",
      "id": "ACTUAL_SAVED_COMPARISON_ID"
    }
  ],
  "include_related_results": false
}
```

```sh
PYTHON -B -m model.study_transfer_cli preview \
  --workspace ACTUAL_WORKSPACE --selection SELECTION_JSON
PYTHON -B -m model.study_transfer_cli export \
  --workspace ACTUAL_WORKSPACE --selection SELECTION_JSON \
  --destination NEW_ARCHIVE_OUTSIDE_WORKSPACE
PYTHON -B -m model.study_transfer_cli inspect \
  --archive NEW_ARCHIVE_OUTSIDE_WORKSPACE
```

Receive that archive with the original operator **Restore an archive** flow.
Preserve its original project identity, source collection IDs and report
edition IDs. The native comparison's exact pair ZIP can still be exported
independently through its original desk or engine; it is a separate original
product capability.

## Maintained source composition

The additive helper is `model/report_changes_study_transfer.py`. It exposes
`ROOT_KINDS`, `DOCUMENTS`, `LABELS`, `visit`, `related`, `lock_paths`,
`catalogue`, `receipt` and `verify_receipt`. Shared core joins add one
typed root, its receipt state and the original dynamic lock paths. No new
Store, archive format, model engine, source dispatcher or transport is added.

The original desk source gains the two handoff methods; its descriptor
declares the existing `openDesk` capability. The original Study selector
adds the comparison label and reopen action while preserving Received
Studies, source-water navigation and all other original roots. The
component fragment carries the full original comparison producer/provider,
assets, descriptor, installer and guide alongside the helper and original
Study dependencies. The ordinary cumulative installer can admit the helper
conditionally when the core imports it.

The original Report Changes installer remains create-only for its original
component. Install the maintained cumulative application for this combined
workflow; then the component registry already has both the comparison and
Study transfer. No installer is allowed to overwrite a different shared
core silently.

## Receiving course

Continue the existing saved-edition/native report operation after two
completed original local editions and a saved comparison exist. Reopen the
exact saved comparison, transfer its editable Study, restore into a new
Workspace, verify the retained pair's ID and row-key plan, page its original
change register, open both original report editions and continue one
retained editable producer into a new edition. Capture the actual saved
comparison/edition/source IDs, archive receipt and first runtime error in
the same operation. This source includes controlled V8 execution of the
actual desk's transfer/lifecycle methods; native Python and real browser
receiving use the existing equipped host.

## Producing-peer visual inspection of the outgoing version

Apply the repository's current AGENTS.md owner-inspection rule to the exact
application and attachments that will be handed over. The producing peer
runs the final native application, opens its Report changes and Study
transfer desks in a real browser, looks at the actual rendered screen or
screenshots, and operates the important controls. Inspect desktop and
narrow/mobile layouts, populated and empty catalogues, loading and error
states, comparison row filters/paging, both original report viewers,
downloads, export, restore and reopening. Keep the existing scientific and
native receiving owners on this same course.

Open the actual final HTML and PDF reports and inspect readable tables,
headings, source links and layout. Extract the outgoing comparison and
Study archives; open the contained reports and working restored project.
Inspect all other outgoing attachment types using their appropriate
viewer or player. Merely recording screenshots, HTTP success, DOM checks,
unit checks or another peer's code review does not replace seeing and
using the final deliverable. Read the screenshots after capture.

Repair unstyled, cramped, clipped, overflowing or unreadable output
directly in the original component. Preserve the industrial clean
appearance, clear typography, restrained controls and legible scientific
tables. Keep this inspection attached to the original receiving operation;
it does not create another model run, watcher or broad test system. Record
the actual source revision, visible results and repaired first error with
the same delivery receipt.


## Continue the complete pair from a received Study

Open **Study transfer → Received studies and original sources**, then open the
saved Study. Its **Report comparisons** count describes only comparisons
retained by that receipt. **Original report comparisons** presents each exact
pair, earlier and later local report editions, complete change count and the
original record-matching choices. Original table headings, selected column
names, earlier/later row counts and position-change choices remain visible.

**Open report comparison** returns to the existing Report changes desk with
that exact comparison ID. The desk retains its filters, original matching
engine, full paged change register, export operation and both frozen originals.
**Open original report** beside either edition returns to its original saved
Sources edition; the original customer-review control remains available there.
The Study preview also opens an included comparison when it is reached through
an explicitly selected report rather than selected as its own root.

**View complete comparison** and **View retained report** use the existing
comparison member route. That route preserves relative CSS, image, table-page
and original report paths. These viewers read the exact frozen pair. The
editable saved-edition controls use the corresponding local edition identities.
Individual downloads retain their complete relative labels, such as
`left/report.pdf`, `right/report.pdf` and `pages/page-00001.html`, so identically
named members from different editions remain distinguishable.

For a usable offline handover, download the **complete comparison ZIP**, extract
it, and open `index.html` within the extracted folder. The ZIP includes both
original report trees, every change page, the full CSV register, SQLite change
database and structured identities. Its folder structure is needed for linked
HTML assets. When the original Study captured a ZIP, the receiving screen labels
it as retained with that Study. If the ZIP was produced later by the original
export operation, it is labelled as prepared after capture. The receipt stays
unchanged in both cases. If no ZIP is present, open the comparison and use
**Prepare full comparison ZIP** through its existing queue.

The receiver calls the original `verify_receipt`, projects only captured
comparison IDs and resolves both original local edition nodes. It does not
invent a comparison from whichever two reports happen to be present. A later
comparison discovered through a current report is not added to this receipt's
received-comparison list. The provider issues original authenticated file
tickets with their retained byte counts and hashes and uses
`ReportChanges._url` for connected HTML viewing.

During the original native/browser receiving course, operate the received pair,
earlier/later saved editions, original matching display and paged register;
download the complete ZIP and reopen its extracted index and both report trees.
Inspect the actual populated desktop and narrow views, all outgoing report/PDF
attachments, an empty comparison list and a current failure state. Repair visible
layout or file-navigation defects in the producing source before presenting the
outgoing version. A JSON or controller replay does not replace opening and
viewing the actual received application and exported documents.


## Ask for a customer review of the complete comparison

Open a saved comparison in **Report changes** and choose **Prepare customer
review**. The existing Customer reviews form opens for that exact comparison.
Give the review a title and purpose, enter the questions or requirements to be
assessed, and retain any review notes. These authored fields belong to this
review request. The complete comparison supplies one original document source:
its overview, change pages, full CSV and SQLite register, matching plan, and
both original report trees.

Preview the request in the original form. The preview binds the authored
questions to the saved comparison and its complete source identity. Changes to
the request require another preview. Preparing the review uses the existing
Workspace queue and its original creation time, so retrying that queued action
reopens the same review. On completion, **Open original review** continues into
the existing Customer reviews desk.

Use the review's ordinary files, requirements, corrections, response history,
handbacks, export and received-package sections. The source identity provides
links back to the original comparison and its earlier and later saved editions.
Export and receive feedback with the existing review workflow. The review
retains the complete relative document tree needed by its linked HTML; the
scientific reports and recorded differences remain the original saved files.

### Move that review and its working scientific context

Select this review in **Transfer editable study**. Its selected source follows
the typed comparison identity to the original saved comparison and both local
report editions. The closure includes their original editable dependencies,
the full review source copy, original source receipt, captured responses,
handbacks and receiving history. This direction starts from the selected
review. Selecting a comparison alone continues its existing transfer behavior.

Restore the resulting Study using the existing receiver. **Customer reviews and
feedback** lists the retained review, its current response count, the reviewed
comparison and both saved editions. Open the comparison or either report from
that review, return to its original corrections and history, and append the next
response through the existing review engine. Captured history remains a prefix
of the retained history. The receiving record continues to identify the exact
comparison that was reviewed.

If the review contains a complete comparison source from another project, the
source remains available as its original imported document tree. The receiving
screen identifies that source's original project. Local navigation is reserved
for the matching saved comparison and editions in this Workspace.

The comparison review operation is `report-changes.review`; its read-only
preview is `POST /api/report-changes/review-preview`. Both use the exact saved
`comparison_id` and authored `review_selection`. The queue additionally pins
the preview's `expected_operation_id`. The source role is
`SCIENTIFIC_REPORT_COMPARISON_REVIEW`, with one typed identity containing the
original pair identity and full member inventory. The existing CustomerReview
Study receipt adds `report_comparisons` only for reviews that have these
sources, retaining the shape of older receipts.

Continue the original native receiving course through authored request,
preview, queued creation, customer response, full review export, selected Study
transfer and restore. Open and use the actual outgoing review, comparison and
both report editions after receiving, including desktop and narrow layouts.
