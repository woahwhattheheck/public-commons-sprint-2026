# Customer operating procedures from native SF47 plans

Use the selected native work packages to prepare a customer procedure that the
receiving operator can edit and carry forward. The procedure keeps the work,
expected completion result, price, hours, relative window, tranche and complete
original package fields. It can also retain a chosen Command finder registration
with its original source and runtime declarations.

The installed **grant-reviewer** product includes this workflow, Command finder
and Operating plans. Its source remains in the existing application, planning
and distribution components.

## Prepare the procedure in the saved submission

1. Open the existing application with `starforge grant-application --port 8787`
   and choose **Prepare submission**. Reopen the team's complete saved draft.
2. In **Planning**, receive the complete SF47 ZIP or saved plan JSON. Select the
   native file and revision. The existing planning update workflow compares a
   later revision with the saved review before applying it.
3. Select the original packages this procedure covers. In **Customer operating
   procedure**, enter its title, customer or installation, operating owner,
   useful result and receiving instructions.
4. To attach an original command, export the receiving toolkit's full catalog
   as described below. Open **Attach original toolkit registrations**, load that
   file, find the command or other registration, and select it for each package.
   Each selection keeps the original registration, source records and declared
   runtime groups with the work.
5. Choose **Create operating plan from selected work packages**. The complete
   editable JSON downloads immediately. A copy is retained in this planning
   review's **Prepared customer procedures**. Save the submission draft to keep
   that selection and all its prepared copies.
6. Open Operating plans, choose **Import complete plan**, and select the
   downloaded JSON. Assign detailed work, exact command arguments, actual due
   dates and recorded results, then **Save revision**.

The grant-side saved history retains the preparation exactly as created. Work
continued in Operating plans has its own ordered revisions. Download that full
JSON again to transfer the later procedure to another operator or receive it into the original grant review as described below.

Prepared customer procedures expose the same complete JSON and standalone HTML
and Markdown handovers. Downloading a retained preparation reuses its original
plan identity and selected source. Creating another procedure gives it a new
identity.

### Open the receiving Operating plans editor

~~~sh
starforge discover serve --host 127.0.0.1 --port 8846
~~~

Open `http://127.0.0.1:8846/operating-plan.html`. Reuse that listener address for
the same browser's saved plans. The complete JSON carries all saved revisions to
a different computer, browser or listener origin.

A command selected for a package begins with its registered help arguments.
The operator enters the actual command arguments and inputs while preparing the
detailed work. Command finder can compare a saved selection with the current
toolkit without replacing the historical source.

## Export the complete toolkit catalog

From the package that will perform the customer's work:

~~~sh
starforge discover plan catalog --out /absolute/customer/toolkit-catalog.json
~~~

For a selected product in a source checkout, the same action accepts
`--source-root /absolute/checkout --selection PRODUCT`. The Operating plans
browser also offers **Toolkit catalog JSON**.

This catalog includes every registration, the full original source table,
package identity and runtime feature declarations. It travels with the
receiving toolkit. The ordinary filtered search export remains useful for
reading matching results; the complete catalog is the selection input here.

Loading a catalog only makes its registrations available for selection. The
chosen snapshots stay in the complete saved submission. The session's uploaded
catalog can be loaded again when another registration is needed.

## Prepare the same output from the command line

A complete saved submission uses its selected native file, revision, work
packages and entered procedure fields:

~~~sh
starforge grant-operating-plan \
  --file /absolute/customer/submission-draft.json \
  --customer "Receiving merchant" \
  --title "Merchant installation and operating handover" \
  --out /absolute/customer/operating-plan.json
~~~

Use the complete original native SF47 ZIP directly when a submission draft is
not part of the operation:

~~~sh
starforge grant-operating-plan \
  --file /absolute/customer/native-planning.zip \
  --revision 1 \
  --customer "Receiving merchant" \
  --out /absolute/customer/native-operating-plan.json
~~~

A saved plan exported by the native SF47 `show --part all` command is also
accepted. The original native receiver verifies the complete bytes, revision
content and original scenario calculation identities before creating the
procedure.

Useful options:

| Option | Behavior |
| --- | --- |
| `--source-sha SHA256` | Select an exact retained native file inside a complete submission. |
| `--revision N` | Select an original saved revision. A different revision starts its own selection. |
| repeated `--package ID` | Use exactly these original package IDs. Their native tranche order is retained. |
| `--catalog FILE` with repeated `--bind PACKAGE-ID=REGISTRATION-ID` | Bind an explicitly selected original catalog registration to a selected package. |
| `--title`, `--customer`, `--owner`, `--purpose`, `--receiving`, `--notes` | Set the procedure's entered operating fields. |
| `--format json` | Complete editable Operating plans JSON, the default. |
| `--format html` or `markdown` | Complete readable procedure for the receiving operator. |
| `--format preparation` | Native source identities, selected package totals, original preparation and current received history. |
| `--format draft` | Save a newly prepared procedure inside the complete original submission export. |
| `--plan ID` | Export this retained procedure's current full history, HTML, Markdown or preparation without creating another procedure. |
| `--receive FILE` | Compare and receive later customer work into the complete original submission. |
| `--format comparison` with `--receive` | Save the complete package/result comparison for review. |
| `--return-note TEXT` | Retain the operator's review note with the received revision range. |
| `--expected-revision N` | Receive only if the currently retained operating revision still matches the comparison. |
| `--id ID` | Set an explicit new operating-plan identity when a caller owns it. |

Every output uses a new filename and the shared create-only writer. Keep the
resulting plan and original source file together. Run `starforge
grant-operating-plan --help` for the installed options.


## Receive the customer's work into the original grant review

The customer returns the **complete plan JSON**, including every original
revision, after saving their work in Operating plans. Reopen the team's original
submission and the native planning review that created that procedure. Under
**Customer operating procedure**, choose **Receive customer procedure** and
open the returned file.

The comparison presents each funded package's unchanged native work and
completion measure beside the customer's current status, owner, actual due
date and full recorded result. Expand a package to read every changed
instruction, input, command argument, selected registration and expected
result. The comparison also retains additional customer steps and explicitly
shows an original package step removed from the returned revision.

Enter the receiving review note and choose **Receive complete customer work and review**. Save the original submission. Its preceding complete
draft version is retained, and the selected procedure now carries all original
customer revisions and its receiving history. **Prepared customer procedures**
downloads the current complete plan or readable HTML/Markdown; **Download
original prepared plan** gives the original creation edition.

Shared saved revisions must match the procedure the team originally prepared.
The existing Operating Plans receiver extends that complete history. Reopening
the same returned file reuses the already received revision, and an older
matching file keeps the current selection. A copy with a different plan ID
belongs to its own operating procedure. Divergent shared edits are reconciled in **Returned procedures**. Complete that review and open its complete review JSON in this grant receiving desk. The saved submission retains both complete original branches, every decision and decision note, the reviewing operator, the completed result and the first receiving note.

The native planning file, original preparation, prices, hours, tranche scope
and payment calculation remain the selected original basis. Customer progress
is recorded work in the procedure. Use that full returned work while carrying
out the original Grant Operations completion and payment workflow.

### Complete command-line handover

Prepare the new procedure **inside the original saved draft**, giving it the
chosen stable operating identity:

~~~sh
starforge grant-operating-plan \
  --file /absolute/customer/submission.json \
  --id merchant-installation \
  --customer "Receiving merchant" \
  --format draft \
  --out /absolute/customer/prepared-submission.json
~~~

Export that exact prepared procedure for the receiving operator:

~~~sh
starforge grant-operating-plan \
  --file /absolute/customer/prepared-submission.json \
  --plan merchant-installation \
  --out /absolute/customer/operator-plan.json
~~~

The operator edits this file through Operating plans and saves its complete
later history. Read the full package comparison before receiving it:

~~~sh
starforge grant-operating-plan \
  --file /absolute/customer/prepared-submission.json \
  --receive /absolute/customer/returned-operator-plan.json \
  --format comparison \
  --out /absolute/customer/return-comparison.json
~~~

Receive into the same original draft, using the selected operating revision
from that comparison:

~~~sh
starforge grant-operating-plan \
  --file /absolute/customer/prepared-submission.json \
  --receive /absolute/customer/returned-operator-plan.json \
  --expected-revision 1 \
  --return-note "Reviewed the returned package work and operating continuation." \
  --out /absolute/customer/received-submission.json
~~~

Open the complete resulting draft in the submission editor, or use
`--file received-submission.json --plan merchant-installation` with the usual
JSON/HTML/Markdown formats to hand the continuing procedure to the next
operator. Each output uses a new filename. Draft preparation and receiving use
the source and native revision currently selected in that original saved
draft; the existing planning update review selects another native edition.

### Receive through the typed API

The same pure model serves the UI and CLI:

~~~js
import {
  compareGrantOperatingReturn,
  receiveGrantOperatingReturn,
  grantOperatingContinuationPlan,
} from '@tokenjunkielabs/starforge-merchant/grant/operating-plan';

const comparison = compareGrantOperatingReturn(nativeSource, planningReview, returnedPlan);
const received = receiveGrantOperatingReturn(nativeSource, planningReview, returnedPlan, {
  expectedRevision: comparison.previousRevision,
  filename: 'returned-operator-plan.json',
  note: receivingReviewNote,
});
const continuedReview = received.review;
const prepared = continuedReview.operatingSelection.prepared.find(
  item => item.plan.id === comparison.planId,
);
const currentPlan = grantOperatingContinuationPlan(prepared);
~~~

The caller retains the preceding submission version and assigns
`received.review` to that same draft's `planningReview` before its normal save.
`prepared.plan` stays the original preparation. Its optional
`prepared.continuation.plan` contains the complete received revision history;
the ordered receiving entries select ranges in that one history, avoiding a
second full copy for every return. The existing complete draft exporter and
receiver carry both the original and continuing work.

## Keep the native plan and operating work connected

The prepared plan records the native filename, byte count, file SHA-256, plan
identity, revision, saved content digest, scenario source and calculation
digests, exact package IDs and original selected totals. Each step contains the
full native cost row and its tranche's deliverable, measure and submission day.

Dates remain the original relative work windows from award-acceptance day zero.
Enter an actual due date in the operating editor when the deployment schedule
is known. The original native source continues to own its planning, grant,
budget, payment and calendar calculations.

For the checked-in current application candidate, select the six-package
revision with **$38,000**, **400 prospective hours** and **150 project days**.
Its package identities are:

| Native package | Tranche | Relative days | Hours | Prospective USD |
| --- | ---: | --- | ---: | ---: |
| `T1-merchant-resource-integration` | 1 | 1–30 | 80 | 7,600 |
| `T1-merchant-authority-handover` | 1 | 1–30 | 40 | 3,800 |
| `T2-provider-and-ledger-deployment` | 2 | 31–90 | 70 | 6,650 |
| `T2-deployed-threat-response` | 2 | 31–90 | 50 | 4,750 |
| `T3-mainnet-merchant-rollout` | 3 | 91–150 | 90 | 8,550 |
| `T3-production-recovery-and-handover` | 3 | 91–150 | 70 | 6,650 |

These rows come from the maintained
[`sf10_current_candidate.json`](../../stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json).
A retained alternative carries its own original amounts and scope. The
procedure preserves the chosen revision's values.

## Typed composition

`@tokenjunkielabs/starforge-merchant/grant/operating-plan` exports the pure
bridge and its types. Supply the complete native source already received by
the original SF47 model and its selected planning review:

~~~js
import { prepareGrantOperatingPlan } from '@tokenjunkielabs/starforge-merchant/grant/operating-plan';

const prepared = prepareGrantOperatingPlan(nativeSource, planningReview, {
  id: crypto.randomUUID(),
});
~~~

`prepared.plan` is the ordinary
`@tokenjunkielabs/starforge-merchant/operator/operating-plans` document.
`prepared.source`, `packageIds` and `totals` keep the native preparation basis.
Use `newGrantOperatingSelection` for entered fields and bindings, and
`snapshotRegistration` from Operating plans to select an actual catalog item.

The installed command-line composition is available through
`@tokenjunkielabs/starforge-merchant/grant/operating-plan/cli`.

## Keep an unfinished customer return and its complete step sequence

The **Receive customer procedure** desk retains the complete opened plan, original filename, review note, native planning source/revision, prepared procedure identity and compared operating revision inside the original saved planning review. Use **Save** to persist the unfinished work in the existing browser draft. **Download whole editable draft** carries the same pending file and note; reopening that draft restores them. Each saved copy keeps its own pending state.

Opening another return, accepting it, refreshing its comparison or explicitly closing it first retains the preceding complete submission version. The returned plan can be downloaded before receiving, including while its current history needs reconciliation. Editing the review note marks the submission dirty through the normal save path.

If the retained procedure advances after comparison, the desk keeps the source and note, displays the current complete comparison and disables adoption until **Use this current comparison for receiving** is selected. That explicit action changes only the compared operating revision. The shared receiving model retains the existing expected-revision check. A successful receive clears the matching pending history; receiving a different procedure leaves unrelated pending work available.

The comparison shows the complete **Originally prepared**, **Previously selected** and **Returned sequence**, with every original step ID, title and position. Reordering existing steps appears as a sequence change even when all step fields and status counts are unchanged. Added and removed IDs remain explicit, and customer additions appear at their actual returned positions. The full comparison JSON and typed API carry this same `stepOrder` projection; the original native package mapping, scope, costs, completion measures and complete Operating Plan history remain intact.

The additive model interfaces are `stageGrantOperatingReturn`, `refreshGrantOperatingReturn` and `closeGrantOperatingReturn`. They return new planning reviews for the original saved-draft writer. The optional `operatingSelection.returnDraft` contains the full source and review state; earlier saved selections without that field remain readable.

When the installed CLI receives the exact pending plan from a saved draft, it uses the retained review note unless `--return-note` explicitly replaces it. Replaying an already retained matching plan saves any pending-desk cleanup in the full output draft, with the preceding complete version preserved. A replay with no review change retains the original draft state.


## Receive complete customer output files

The customer can attach complete reports, datasets, images and other output
files to each operating step. Operating Plans retains the original bytes,
name, media type, byte count and receiving note inside that step's saved
revision. Its complete editable JSON and standalone HTML handover carry the
files; the browser and installed command can extract individual originals.

The original grant preparation remains unchanged. When a later customer
plan returns, the package comparison includes complete file changes against
both the originally prepared and previously selected step. The reviewer sees
the number of added, removed and changed files and any order change. Named
download buttons expose the actual originally prepared, previously selected
and returned files. Files on additional customer steps remain available too.

An unfinished returned plan retains these complete bytes through the same
saved return, note, draft version, export and reopen paths. Receiving a later
matching history places its complete file history in the original continuing
plan; identical replay and divergent-history handling use the existing
shared-history model. The comparison retains the customer's complete file
contents alongside its metadata.

Use the current installed
[Operating Plans file workflow](../../stellar/scf-starforge-20261009/distribution/discovery/OPERATING_PLANS.md#carry-complete-customer-result-files)
for customer file selection, correction, historical downloads and the
discover plan attach, files, extract and remove-file commands.
The original grant submission retains its existing 16 MiB complete-draft
capacity, including all source and saved history. Select complete outputs
that fit that receiving record and keep large native delivery archives in
their original maintained handover.


## Receive a complete reconciliation review

A completed Returned procedures document uses the original `stellar-forge.operating-plan-return.v1` format. It includes the complete current and returned procedures, the reviewing operator and notes, each explicit choice (including custom values and reviewed step order), and the exact completed original-format procedure. Receive this whole document instead of extracting only its result.

In the grant planning review, open **Receive customer procedure**, select the completed review JSON and read the original funded-package comparison. The desk shows the reviewer, both branch revisions, result revision and decisions. Expand the branch and decision panels or download its complete JSON/readable HTML. Enter the receiving note, confirm the displayed current operating revision and choose **Receive complete customer work and review**. Save the submission.

The same command accepts either ordinary procedure JSON or a completed review:

~~~sh
starforge grant-operating-plan --file submission.json --receive completed-review.json --format comparison --out comparison.json
starforge grant-operating-plan --file submission.json --receive completed-review.json --expected-revision 2 --return-note "Reviewed customer handover and package results." --out next-submission.json
~~~

Use the actual `previousRevision` from the comparison for `--expected-revision`. The command preserves the exact native planning source and its original package prices, hours, scope and relative dates. The review's completed result must continue that prepared procedure. A completed review whose result is already present may be received after later procedure revisions; those later revisions remain selected.

A completed review that changes no procedure fields still carries useful review decisions and notes. Receiving it adds one complete review record without inventing a procedure revision or an advancing continuation receipt. Receiving the same complete review again keeps its original first-received metadata and adds no duplicate. Different content with the same review identity is rejected. An explicit stale expected revision is rejected before either kind of receiving.

### Reopen, export and retain the whole history

Each prepared procedure now lists its **Completed return reviews**. These retain the review's own result revision separately from the current later procedure revision. Download the complete review or its readable HTML from that list, or use:

~~~sh
starforge grant-operating-plan --file next-submission.json --plan PROCEDURE-ID --review REVIEW-ID --out retained-review.json
starforge grant-operating-plan --file next-submission.json --plan PROCEDURE-ID --review REVIEW-ID --format html --out retained-review.html
~~~

The existing `--format preparation` output also includes every received review. The complete submission JSON/export envelope carries those records, both source branches, decisions and all saved versions. Restoring an earlier submission version restores its selected procedure and review collection while retaining the later state in the preceding saved version.

An unfinished grant receiving desk retains the full completed review plus its exact result, filename, receiving note and comparison revision. Closing that desk retains its previous state in the original submission version history. Refreshing a stale comparison preserves the full review and note.

Receiving validates the original completed-review calculation and its full original ancestry, then uses the existing Operating plans receiver for the exact completed result. Incomplete reconciliation reviews remain in Returned procedures until completed. The original complete-draft limit stays 16 MiB, including sources and saved versions; an oversized addition leaves the current editor and original source intact.
