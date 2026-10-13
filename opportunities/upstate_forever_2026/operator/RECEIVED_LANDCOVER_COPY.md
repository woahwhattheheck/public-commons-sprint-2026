# Create a local editable comparison from a received report

A received Scientific Report can contain a complete selected-watershed comparison from another project. Its original source, figures, selected HUC identifiers, input documents and quantities remain available in the received Study. **Create local editable comparison** admits those verified original inputs into the current project and runs the maintained selected-watershed producer to save a new local comparison.

This operation gives the new comparison its own project and implementation identity. It retains an explicit link to the original project, source collection, report body, saved comparison and original input entries. It does not change the received report or rename a foreign comparison as a local one.

## Use the existing received Study

1. Open **Studies**, then the received Study containing the original selected-watershed report.
2. Expand **Selected watershed comparisons**. The source card shows the original project, selected HUCs, paired support, changed-class quantity, original report and source files.
3. For a source belonging to another project, enter a title of 1–200 characters and choose **Create local editable comparison**.
4. The original task queue admits the complete input collection and saves the comparison. When it completes, the maintained **Observed watershed change** desk opens the exact new local edition.
5. Return to the received Study to find that edition under **Local editable copies**. Open it again without submitting another operation.

A source already local to this project keeps its existing **Open saved comparison** navigation. Foreign sources get the explicit admission action. Choosing a different local title creates a distinct admission; retrying the same accepted operation continues its original task.

The card remembers an accepted task and operation ID in the current browser session, separately for each Workspace, Study and source. **Continue local copy** follows that task after a view switch, delayed response or reload. **Open copy task** exposes the original task and its error/recovery controls. A delayed response from a different Workspace can retain its accepted ID without replacing the visible selection. Finishing a task does not overwrite a newer draft in another view.

## Exact native input and output contract

The read-only preview is:

```text
GET /api/received-landcover-copy/preview
    ?workspace=OPERATOR_WORKSPACE_KEY
    &study_id=RECEIVED_STUDY_ID
    &source_collection_id=ORIGINAL_COLLECTION_ID
    &source_id=ORIGINAL_REPORT_SOURCE_ID
    &source_body_sha256=ORIGINAL_REPORT_BODY_SHA256
    &title=LOCAL_COMPARISON_TITLE
```

Use the actual received-card fields. The preview returns the deterministic admission `id`, original and receiving project IDs, exact source identity, original comparison ID, selected HUCs, source years, original input/member counts and bytes. It returns an existing complete admission when that exact request was already fulfilled.

Submit the preview ID through the maintained task API:

```json
{
  "workspace": "ACTUAL_OPERATOR_WORKSPACE_KEY",
  "action": "received.landcover.copy",
  "operation_id": "ACTUAL_CLIENT_OPERATION_ID",
  "payload": {
    "study_id": "ACTUAL_RECEIVED_STUDY_ID",
    "source_collection_id": "ACTUAL_ORIGINAL_COLLECTION_ID",
    "source_id": "ACTUAL_ORIGINAL_REPORT_SOURCE_ID",
    "source_body_sha256": "ACTUAL_ORIGINAL_REPORT_BODY_SHA256",
    "title": "Local comparison title",
    "copy_id": "ACTUAL_PREVIEW_ID"
  }
}
```

Poll the accepted task through `GET /api/task?id=TASK_ID`. Keep its actual task ID, operation ID and full payload. A completed result is the admission receipt. Read it again using:

```text
GET /api/received-landcover-copy/copy?workspace=KEY&id=COPY_ID
GET /api/received-landcover-copy/copies?workspace=KEY&study_id=ID&source_collection_id=COLLECTION&source_id=SOURCE
```

The completed receipt has `local_selection_id`, `local_source`, `input_collection_id`, the native normalized selection, full source binding, original summary and an explicit original-to-local identity. The read endpoint supplies authenticated downloads for the receipt, original-input admission plan and importer manifest. File tickets use the actual verified Workspace file descriptors.

Python callers use the same original model methods:

```python
from model.observed_landcover_local_copy import preview, create, get
from model.observed_landcover import inspect

check = preview(workspace, payload)
result = create(workspace, {**payload, "copy_id": check["id"]})
reopened = get(workspace, result["id"])
comparison = inspect(workspace, reopened["local_selection_id"])
```

For the user journey, use the native queued action so accepted task identity, recovery and artifacts remain available in the operator.

## Source admission and scientific identity

The original received Study resolver first verifies its captured report lineage and source collection. The admission then verifies `selection.json` and each of the four original inputs: the completed paired analysis, both annual inventories and directional transitions. Every companion must occur in the report under its original relative name and have the exact original byte count and SHA256.

The maintained `Workspace.import_sources` imports those original documents and companions, retaining publisher metadata and source URIs. Each admitted input gets explicit `metadata.received_landcover_copy` lineage. A prior admission marker is retained as `previous` when an original source already carries one.

The maintained selected-watershed model verifies and summarizes the newly admitted inputs. Before and after building the local edition, the admission compares the original analysis hash, raster and boundary identities, affine grid, coordinate operation, cell-area method, full-domain count/overlap, selected HUCs, full selected summary and every selected watershed row with the received original. The original native cell-centre rule, paired-valid support and directional matrix remain authoritative.

The local title is an authored display field. The receipt retains the native normalized selection without adding a title to that selection dictionary. The new saved comparison and its source collection carry new local identities because their project and provenance differ.

A completed admission is stored under:

```text
observed-landcover-copies/<COPY_ID>/
  source-admission.json
  sources.json
  receipt.json
  originals/<INPUT_INDEX>/<ORIGINAL_RELATIVE_MEMBER>
```

The plan freezes the first admission timestamp before source import. A retry verifies and reuses that plan; an existing receipt is reopened through the same original identity checks.

## Continue through Scientific Reports and editable Study transfer

The new edition opens in the maintained selected-watershed desk. Its original Scientific Reports action uses `local_source`; the original source card remains available separately. Select the source or completed Scientific Report through the existing editable Study flow.

The typed selected-watershed closure recognizes the admitted-input marker. It retains the admission receipt, source plan, importer manifest, new local source collection, complete local comparison tree and the original foreign source collection with all original CAS companions. It reads those immutable records directly, without materializing source views during capture. Both full Workspace archives and selected editable Studies can reopen the local comparison and validate its original-to-local lineage. If an analyst subsequently saves a different HUC selection from the admitted full-domain inputs, exporting that revised comparison also retains the initial local edition and its report source. The admission can therefore reopen after a revised-only Study transfer without depending on an unselected earlier report.

The closure does not depend on the original browser session, task polling cache or admission staging copies. On the transferred application, `get(workspace, COPY_ID)` and `observed_landcover.inspect(workspace, LOCAL_SELECTION_ID)` must return the original retained edition.

## Component composition

The additive `received-landcover-copy.json` component fragment retains the model, backend-only extension, existing source card, updated typed closure and this guide in both `study-transfer` and `observed-watershed-change`. It adds paths without introducing dependency edges. The existing shared received-Study dispatcher and renderer remain the callers.

The backend descriptor owns only `received.landcover.copy` and its three GET routes. It requires the maintained `observed.landcover.save` action. The action stays subject to the original operator authorization and queue rules.

## Actual receiving and visual verification

Continue the admitted native receiving operation in its actual application, Workspace and authenticated operator. Use a real captured **foreign-project** selected-watershed source; the normal same-project restored Study keeps its original saved comparison and cannot exercise foreign admission.

Retain the exact source/project IDs, preview/copy/task IDs, original and new native comparison IDs, full original input collection, source manifest and receipt. Execute preview → queued admission → native saved comparison → return to received card → reopen local copy. Repeat the original accepted task after a view change and confirm it reuses the same copy. Export the local comparison through the maintained Scientific Reports/editable Study flow and reopen it from the transferred application's own interpreter. Then save a different HUC selection from the admitted source collection, export only that revised comparison through a new Scientific Report, and verify that the initial admission, original local edition and revised edition all reopen from that second transferred application.

Producing-worker visual inspection follows the repository owner instruction in `AGENTS.md` (2026-10-13.1). Open, run and render the exact outgoing product and **look at the actual pixels**. Use desktop and narrow widths; operate critical controls and inspect applicable loaded, empty, loading and error states. Download and reopen the delivered files. Open every attachment in the intended recipient viewer, including HTML, CSV/JSON, SVG/PDF and the complete archive's entrypoints. Inspect the title field, explicit foreign/local identities, original source downloads, queue/continue status, new saved comparison, original figures and return navigation. Record actual screenshots or recording and the exact application/Workspace/edition; source review and controlled-DOM checks do not replace this step.

Keep the existing receiving request and actual host. The Upper Savannah sprint ends **2026-10-13 at 14:00 UTC / 10:00 EDT**. Preserve the current application, inputs, source and output identities, run/task receipts, guide, screenshots/recording and unresolved dependencies at the cutoff. Do not schedule automatic resumption.

## Current Tim / Ecosystem presentation course

The owner's 2026-10-13 update keeps the existing simulated-model demonstration moving. Present a usable production workshare for Tim and Ecosystem's GIS, watershed modelling, mapping and natural-capital practice. The prime retains scientific methods, review and the client relationship. Use the actual geographic/source shapes, a 30 m grid, upstream modelling domain distinct from the South Carolina reporting mask, and the relevant utility focus. Clearly identify realistic simulated inputs while showing actual native NDR/SDR baseline, restoration and matched-control calculations.

Show annual nitrogen/phosphorus export in kg/year and sediment export in tonnes/year reaching streams, with useful maps, comparisons and an editable report. Keep concentration separate from load and stream delivery separate from intake delivery. Demonstrate inputs → run → differences → revise → handover, including retained source editions, editable inputs, complete export and cold reopening. Use actual artifacts and elapsed history; do not invent timings.

This source-admission feature serves the final revise/handover portion: a recipient keeps the original report and explicitly admits its complete original comparison inputs into a new local editable edition. Join the accepted SOL13-DEMO original four-RFP-HUC/report/Study operation and its actual Workspace. Preserve current jobs and one writer per Workspace; do not create a replacement demonstration, controller or repeated generic receiver request. Actual execution and the usable recipient product have priority. Open and inspect the rendered application and every attachment, correct visible defects, and use an actual application recording; natural generative voice may accompany media when authorized and available.

Pass this direction with the original operation's concrete source and output identities to current collaborators. The 14:00 UTC cutoff and existing no-Actions, no-private-Git, scientific attribution, external-contact, meeting and spending controls remain in force.
