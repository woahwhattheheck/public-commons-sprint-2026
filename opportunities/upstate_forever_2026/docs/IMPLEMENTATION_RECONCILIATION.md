# Reconcile returned field plans

Use **Handover → Review retained field returns** when an original field package
returns after its native plan has changed. The review uses three retained
versions: the immutable native revision from which the return was edited, the
current saved native plan, and the complete returned plan. It preserves the
returned source files and revision history.

This is the continuation of the normal plan and evidence import. It does not
create another project or repeat the laboratory import, observation registration,
scientific report or environmental model.

## Receive the original return

Open the returned **plan + files ZIP** through the existing Handover controls.
The package contains the original plan JSON and every attached original file,
including photographs, laboratory CSVs and import audits. **Save plan + files to
native** verifies and retains those bytes through the original native queue.

If the return was edited from an older revision, the native importer preserves
its conflict document and the verified evidence archive, then reports the
revision conflict. The browser draft remains open. The failed original task
stays available in native task history.

For a return that contains only plan changes and no new original files, the
existing **Open JSON** and native import controls retain the same conflict
document. A complete evidence package is needed when the return adds files.

## Review the versions

Choose **Review retained field returns** in Handover. Finish or recover any
original plan operation before opening this review.

1. Choose the retained returned plan. Each choice shows its source revision,
   receiving time and the importer's original reason.
2. Review the base, current and returned revision identities and the counts of
   independent changes and conflicts.
3. For each conflict, compare the original base, current saved value and returned
   field value. Choose **Keep current saved value** or **Use returned value**.
   An absent value is displayed as absent, separately from null or an empty
   string. A row deletion therefore remains visible.
4. The initial view shows conflicting changes. Choose **Independent automatic
   changes** or **All changes** to inspect and, when needed, override a change
   that applies cleanly on its own. This also lets you resolve a relationship
   issue exposed by whole-plan validation. Use the search field to find an
   original record or value. Paging changes only the visible decisions; it does
   not drop choices on other pages.
   **Download complete original difference** retains a large value without
   truncation, and **Download complete preview** retains the full native review.
5. Choose **Preview resolved return** after editing decisions. The native model
   validates the complete proposed plan, relationships and frozen source
   bindings. Every change to a choice invalidates the previous apply preview.
6. Resolve any outstanding differences and validation errors. Enter an optional
   reviewer label, then choose **Save one reconciled native revision**.

The save carries the exact native preview operation ID and the current revision.
If the current native plan changes after preview, the original request cannot
silently overwrite it. Refresh and inspect a new preview before applying a new
review. The original returned plan remains available.

Measurement definitions, sample/collection context and site/coordinate definitions
are each reviewed as a complete original group. Choose one side's entire
definition so a numeric value is never combined with the other side's unit,
limit, quality code or source metadata. Separate notes and attached-file
associations can still be reviewed independently.

Source snapshot rules still apply. Retained economic/model benefits, source
digests, source mappings, original CSV/audit identities and existing local-file
bindings cannot be rewritten under an existing source ID. Whole-plan validation
also protects remaining relationships to those original sources. A legitimate
laboratory replacement may select the returned observation's complete atomic
scientific definition, including its declared lab source. The selected source
link must exist in the resolved plan; retained source-link snapshots and
laboratory import history remain intact.

## Retain the browser draft and reopen the current plan

The review dialog does not replace the open browser plan. Native reconciliation
uses the retained native return, not additional unsubmitted edits made in the
browser after that return. Save or export those edits as their own work.

When the native request finishes, the dialog shows the applied revision and its
retained audit downloads. **Open latest saved plan** invokes the existing native
reopen workflow. It preserves a separate copy of a dirty browser draft before
opening the latest saved native revision. A replayed operation may refer to an
older applied revision; it never replaces later native edits with that historic
receipt.

The resulting plan continues through ordinary field editing, laboratory intake,
results/QC review, report preparation and complete plan + files export. Original
source IDs and retained file aliases remain unchanged.

## Interrupted or uncertain requests

The dialog retains its original action, payload, operation ID and native task ID
under the original workspace and plan. **Recover original request** resubmits
that same identity if the response was lost. **Refresh retained task** reads the
same task, and **Resume original task** resumes a task the native queue marks
interrupted.

A failed or cancelled request can be exported and acknowledged with **Retain
failed request and review again**. This leaves its original native task and
incoming return retained. An uncertain request is not discarded as a failure.

**Export review choices** retains the selected original conflict identity and
explicit current/incoming decisions. **Open review choices** accepts that file
only for its original workspace and plan, then requests a fresh native preview.
The file is a review selection; it is not permission to reuse an obsolete native
revision. If browser storage is unavailable, keep the review open until recovery
and export its selection/request.

Closing the dialog, reopening another plan or changing workspace stops the
browser's pending reads and preserves the review. It does not cancel a task
already accepted by the native queue.

## Native source and integration

The additive native model is `model/implementation_reconciliation.py`. The
existing Implementation provider owns these routes:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /api/implementation/reconciliation-conflicts | List exact retained returns for one plan |
| POST | /api/implementation/reconciliation-preview | Compare versions and validate explicit choices |
| POST | /api/implementation/reconciliation-apply | Queue the original guarded application |

The action is `implementation.reconciliation.apply`. The payload names the
native plan ID and opaque retained conflict ID; callers cannot supply a file
system path. Choices map the preview's opaque difference IDs to `current` or
`incoming`.

The native audit lives at
`implementation/plans/<plan_id>/reconciliations/<operation_id>/`. It retains
`resolution.json`, `incoming.json`, `candidate-plan.json`, `applied-plan.json`
and `receipt.json`
with verified workspace-relative file descriptors. The provider exposes those
original members and the saved plan through the existing authenticated download
tickets. The full Workspace archive retains the original plan bank, conflict,
evidence and reconciliation history.

The browser helper `operator/web/implementation_reconciliation.mjs` is loaded
only for the native Handover review. The standalone workbench still captures and
exports offline field changes; native revision comparison happens in the
original workspace, where the immutable base and current history exist.

Both the model and helper are required installer members. The descriptor retains
the existing implementation actions, reports, sources, QC, Outcomes and evidence
controls. No new HTTP server, plan store or report publisher is introduced.
