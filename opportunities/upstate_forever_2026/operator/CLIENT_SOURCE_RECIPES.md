# Saved source recipes

A saved source recipe keeps a reviewed interpretation of a complete source intake: the original files and reading choices; selected sheets, layers or bands; scientific roles and native model choices; original field labels; and the completed source edition from which the recipe was made. Reusing it proposes a new interpretation against a new completed inspection. The reviewing scientist must bind each source part and review its meaning again.

The recipe does not replace the original files, change measurements, rerun a completed Study, select a scientific conclusion or start a model. Saving the reviewed source edition still uses the maintained `client-source.commit` action. The existing **Open my data** screen remains the place to upload and inspect original files. Its named table-mapping controls and complete working-copy download/open behavior remain available.

## 1. Start from a completed, reviewed intake

In **Open my data**, select all original inputs and their genuine reading choices. A shapefile needs its sidecars; a workbook retains all sheets, including cover sheets and unsupported sheets. Inspect the originals, select the source parts that belong in the edition, and review the original metadata and scientific meaning. Save the reviewed scientific source edition through the existing source operation.

Wait for that original operation to finish. A recipe cannot turn an incomplete or failed inspection into an accepted scientific source. Unreadable source parts stay visible with their original error; the original file is retained.

Open **Source recipes**, refresh the saved operations, and select the completed commit. Give the recipe a useful name and describe what the interpretation covers and what it does not cover. Save the recipe. The first revision records the completed inspection, the complete reviewed selection and the source commit. A later revision is an explicit new recipe edition; earlier revisions remain readable.

A recipe name such as “Annual county land-cover and biophysical intake” is more useful than a filename. The filename is already retained. State the actual expected source family and limitations in the description. Do not imply that a recipe verifies later source quality, units or scientific applicability automatically.

## 2. Inspect the next delivery before reusing a recipe

Use **Open my data** to upload and inspect the actual new files. Choose the actual encoding, delimiter, workbook header row and formula/cached-value behavior. The new inspection owns its own retained originals and reading choices. A recipe never substitutes a producer's old upload handle for a new recipient's input.

Return to **Source recipes** and choose the recipe, its exact revision and the new completed inspection. Preview the use before preparing it. Each recipe slot represents an original selected file/part/role, not merely a table column mapping.

Select a new file and its sheet, layer or band for every slot. A unique exact name can be shown as a suggestion, but you must explicitly choose the target. Reordered sheets and renamed files therefore cannot silently inherit the old indices. Missing, ambiguous and incompatible parts remain unresolved.

For each table field, review the original field label beside the actual new field choices. Exact labels can be suggested only when unambiguous. Duplicate labels, blank labels and missing fields retain their distinct source identities. Choose the actual new column when a suggestion is missing or ambiguous. The application does not infer scientific equivalence from similar spelling.

Review the complete part changes and the retained original interpretation. A layer name, column label or byte match is evidence about the source identity; it is not proof that a source is appropriate for the new scientific question.

## 3. Review the new scientific meaning

The new selection starts with fresh review state. Source title, publisher/reference, edition or vintage, physical units, period, time zone, notes, reviewer and methods reference must be reviewed for the new delivery. Confirmation starts clear. An old conversion is visible only as prior context until a new conversion is explicitly reviewed.

The recipe keeps the intended scientific role, selected native models and field semantics. If the new delivery requires a different role, model or column meaning, review and save that interpretation through the original intake and create or revise a recipe from that actual completed source edition.

Before preparing the use, review each slot in four areas:

- **Original source:** correct file and part, source title, reference, vintage, time period and locality represented.
- **Columns and identifiers:** actual new field IDs, original labels, identifier/label fields and any required native model columns.
- **Scientific role:** the selected role and native model requirements apply to this source.
- **Units and transformations:** real physical units, methods reference, resampling and any explicit conversion are appropriate.

A context document remains context. Selecting it does not make it a native scientific input. Raster pixels remain unchanged in the original intake; any reviewed scale or resampling is applied by the existing grid engine at its normal stage. Biophysical projections retain the complete workbook and use the original native table validator. Extra columns and original formulas remain in the retained source.

Save the prepared use only after every slot is complete. The server checks the selected recipe revision, the new inspection, all bindings, the complete reviewed selections and all required confirmations. The saved use contains the exact payload for the original source commit.

## 4. Commit the saved use and attach its result

Submit the saved use's complete commit payload through the original `client-source.commit` action. Do not edit the payload after it is selected. The client retains the original operation ID and exact request before submission. If the response is lost, reopening or resuming that same request reconciles the original operation; it does not create another source edition.

Wait for the original commit to complete, then attach that exact completed result to the prepared use. Attaching proves that the source edition was produced from the saved recipe use, selected new inspection and exact reviewed payload. A different commit, different source inspection or changed selection must not be attached.

The recipe history and use history are evidence of interpretation and reuse. The original intake result remains the authority for the scientific source edition, its originals, companions and projected files. Follow the source-edition link to continue with the existing scientific preparation, grid, profile or Study workflow.

## 5. Keep complete working state and original requests

The recipe panel retains its selected recipe/revision, current new-inspection bindings, review fields and exact submitted requests. Download the complete working copy before leaving a browser that reports unavailable or full storage. An unreadable previous browser copy must remain available unchanged for recovery.

Opening a working copy shows a confirmation and preserves the previous selection in its full history. A recipe working copy is scoped to its original Workspace and its actual saved recipe and inspection; moving it to a different Workspace is not an automatic rebind. Use the complete recipe or whole-Workspace delivery there, then choose a new local inspection. Completed recipe and use records are saved in the native Workspace. Unsubmitted browser work is not a completed native record.

The original **Open my data** working copy is a separate established format. Its complete history and original requests stay intact. A same-project restored inspection can reopen its original source choices in a receiving Workspace; producer upload handles are excluded from the receiving active selection while original uploaded files remain in the native inspection and saved history. This behavior remains unchanged.

## 6. Portable custody

Use the recipe archive controls to export the selected complete recipe history with its original source and inspection custody. The archive keeps the interpretation record together with the original source material needed to explain it. A recipe JSON or a table-column map alone is not the complete portable source delivery.

Choose the complete incoming ZIP in **Source recipes**. Its original upload receipt and byte identity appear before **Receive selected archive** is available. The queued receive operation validates the whole manifest, metadata, original objects and member population before publication. Reopen the selected recipe and its history after import. Its original project/source provenance remains visible. Prepared uses show the new edition title, reviewer, recipe revision and every selected source name, file, part, role and units before the optional full JSON details. An attached producer collection is shown by its preserved title and ID. The native source navigation is available only for a use belonging to the selected local Workspace and project; importing a standalone recipe does not create the producer's native source collection here. To use the recipe on a new delivery, create a new local inspection and explicitly bind its parts as described above.

The normal whole-Workspace portable delivery remains available and keeps the native records, original inputs, source editions and recipe history together. The maintained whole-Workspace portable engine verifies the recipe history, custody, complete source objects and linked uses during capture and restore. Restoring through the operator also performs its extension-level semantic verification, including original intake records. Open the restored recipe and original source results in the operator before using them.

Keep the complete native delivery and its receipt. Do not replace older deliveries with a new receipt or rewrite their inventory. A later recipe revision is an additional retained edition.

## 7. Recover an interrupted operation

First reopen the existing Workspace and refresh its original operations. Keep the same operation ID, exact payload and selected recipe revision.

If the request was saved in the browser but no HTTP response was received, resume that saved request. If the task exists, open its original progress and retained result. A failed or interrupted native operation is resumed through the existing operator control. Do not copy the request into a new operation merely to bypass its failure.

If a source commit has completed but attachment to the recipe use has not, select that same completed commit and attach it. No second source commit is needed.

If the browser reloads after an archive has been exported or imported, recover the completed original task and download its retained archive/result. Keep the original archive identity rather than building a new substitute and presenting it as the original operation.

## 8. Scientific limits and ownership

A recipe reduces repeated interpretation work. It does not replace the reviewing scientist, source licence, source limitations, current units or geographic/time coverage. A reusable field mapping is a proposal against actual new source columns. The actual native source validator and writer remain authoritative.

This component does not operate the external source publisher, acquire a new study dataset, run NDR/SDR, regenerate completed scientific results or contact a customer. Existing source intake, named-mapping UI, native writer, scientific model and equipped browser owners keep their original operation identities.

## 9. Exact original operator API

The source recipe client is an additive extension. It does not replace `operator/server.py`, `client_source_intake.mjs` or the existing named table-mapping component.

All writes use the existing queue:

```json
{
  "workspace": "ACTUAL_SELECTED_WORKSPACE",
  "action": "client-source-recipe.create",
  "payload": {
    "name": "Reviewed collection interpretation",
    "description": "Actual scope and limitations",
    "commit_id": "ACTUAL_COMPLETED_NATIVE_TASK_ID"
  },
  "operation_id": "RETAINED_ORIGINAL_OPERATION_ID"
}
```

POST this complete body to `/api/actions`. Keep its operation ID and payload after an uncertain response. The response is the native task, including its actual `id` and `state`. A task can be queued or still running; do not treat HTTP acceptance as completed source work.

| Action | Exact payload |
| --- | --- |
| `client-source-recipe.create` | `{name,description,commit_id}` |
| `client-source-recipe.revise` | `{name,description,commit_id,recipe_id,expected_revision,expected_sha256}` |
| `client-source-recipe.prepare-use` | `{recipe_id,revision,recipe_sha256,inspection_id,bindings,selections,title,reviewer}` |
| `client-source-recipe.attach-result` | `{use_id,use_sha256,commit_id}` |
| `client-source-recipe.export` | `{recipe_id}` |
| `client-source-recipe.receive` | `{upload_id}` |

The receiving upload is the original raw `POST /api/upload` with the actual ZIP bytes and filename. Retain its returned `id`, `filename`, `bytes` and `sha256` before requesting the queued receive. A completed late upload remains selectable by its exact receipt. Refresh or reopen a native result to get a fresh verified download ticket; do not construct a filesystem URL from a path in its metadata.

A binding is:

```json
{
  "slot_id": "selection-1",
  "file_index": 0,
  "part_index": 1,
  "columns": {
    "mapping:lucode": "c0",
    "identifier_field": "c2"
  }
}
```

These indices and fields must come from the actual new inspection, and the keys must exist in the selected original recipe slot. Omitted column overrides allow only the model's unique exact-label suggestion. A suggestion does not remove the required fresh review.

Each `selections` row is `{slot_id,selection,reviewed}`. The `selection` is the complete original native intake selection with its actual role, models, mapping, file/part indices and fresh source metadata; `reviewed` contains exactly `source`, `mapping`, `scientific_role` and `units`. The original confirmation must be true. A conversion, when selected, carries a positive finite numerical factor and actual target units/reference. The client keeps an editable blank/string field while typing, then validates and converts it to a number at the preparation boundary. Native resampling choices remain nearest, bilinear, average and mode.

The completed prepare-use result includes the entire `use`, its `use_id`/`use_sha256`, and **`commit_request`**. Submit that exact object to `/api/actions`; it already contains the correct original workspace, action, payload and operation ID. Do not generate a substitute commit ID or reconstruct its reviewed payload. If original task deduplication returns a different existing task ID, retain the actual returned ID and let attach-result validate the original queue alias.

GET `/api/task?id=ACTUAL_TASK_ID` returns the full native task and retained extension result. Recipe operations expose `_client_source_recipe` and their verified `_downloads`; the original task `result` remains complete. The original `POST /api/task/resume` with `{id}` resumes an interrupted task. Progress uses the existing operator task view.

The four read routes accept POST JSON containing `workspace` and the fields below:

| Route | Selection fields | Complete result |
| --- | --- | --- |
| `/api/client-source-recipes/catalog` | none | Workspace/project identity, saved recipes and saved uses |
| `/api/client-source-recipes/result` | `recipe_id` | `{record,_downloads}`; record includes every full revision |
| `/api/client-source-recipes/plan` | `recipe_id,revision,inspection_id,bindings` | Explicit candidates, selected source parts/columns, unresolved rows and fresh review defaults |
| `/api/client-source-recipes/use` | `use_id` | `{use,applied,_downloads}`; exact prepared review and any attached original result |

The original `/api/client-source/catalog` and `/api/client-source/result` select the existing completed inspections and source commits. The original task request body remains within the operator's declared 4 MiB capacity. Complete original source data and recipe archive files travel through their native retained-file/upload routes, not inside a reconstructed JSON request.

## 10. Native recipe archive commands

Use the original selected application and its scientific Python environment. Run these commands from that application root. All Workspace paths refer to actual existing scientific workspaces. Use a stable, selected 64-character lowercase hexadecimal operation ID and retain it across retries; use a different ID for an explicitly different receiving or export request.

```bash
python -m model.client_source_recipe_portable export WORKSPACE RECIPE_ID ARCHIVE.zip --operation-id ORIGINAL_HEX64
python -m model.client_source_recipe_portable inspect ARCHIVE.zip
python -m model.client_source_recipe_portable receive RECEIVING_WORKSPACE ARCHIVE.zip --operation-id RECEIVING_HEX64
python -m model.client_source_recipe_portable verify RECEIVING_WORKSPACE
```

Export retains a complete immutable receipt with the selected recipe, archive descriptor, revisions, linked uses and manifest. Receive retains the producer project, received and retained revision/use populations and exact incoming archive bytes/hash. A receiving copy preserves an already-retained compatible later history; it does not roll that history back to the archive prefix. A conflicting branch is an explicit error requiring selection review.

The archive manifest is `upstate.client-source-recipe-archive/v1`. It declares the complete metadata and `objects/<sha256>` members. Inspection checks exact membership, unique safe ordinary files, byte sizes, SHA-256 identities, complete history and source bindings. Extra detached objects, missing referenced files, renamed members, symlinks and encrypted members are rejected. Source objects are streamed through the original native custody path.

The CLI does not launch an operator or scientific model. Use the original operator for source inspection, new-source review and its explicit native commit. Standalone recipe receiving and normal whole-Workspace receiving both keep the original source lineage; their operation receipts remain distinct.

## 11. Installed source and original host joins

Select these complete leaves together with the maintained application:

- `model/client_source_recipes.py` — full recipe/use definitions and review rules.
- `model/client_source_recipe_portable.py` — complete archive and workspace custody.
- `model/portable.py` — the guarded recipe verification joins in the existing whole-Workspace engine.
- `operator/client_source_recipes.py` — original queued action/read/download joins.
- `operator/extensions/client-source-recipes.json` — backend actions/routes and the additive view.
- `operator/web/client_source_recipes.mjs` and `client_source_recipes.css` — complete operator workflow.
- `operator/CLIENT_SOURCE_RECIPES.md` — this operating and receiving guide.

The extension client factory is `createClientSourceRecipes(host)` and returns the original `mount`, `update` and `suspend` lifecycle methods. It uses the maintained host's `getState`, `getWorkspace`, `api`, `refresh`, `toast`, `navigate`, `openItem` and `showTask` surface. Requests that finish after a view change cannot overwrite the current view's selected working state. Exact completed upload receipts remain recoverable.

The existing intake and mapping owner keeps `client_source_intake.mjs` and the actual local browser operation. No replacement server, browser launcher, polling watcher, scientific writer or parallel recipe controller is introduced. Source installation alone is not a native or visual completion receipt.

## 12. Operating acceptance in the existing equipped course

Extend the existing intake/mapping owner's current operation with the exact source edition, without starting a second browser controller. Operate the following connected sequence against the actual retained intake:

1. Save a recipe from the completed reviewed source collection and reopen its first revision and complete original source details.
2. Inspect a later original delivery, select the exact recipe revision, deliberately bind all file/part slots, and review changed, missing and ambiguous fields.
3. Confirm the actual new source metadata and units. Save the prepared use, reopen it, and inspect its complete original commit payload.
4. Submit that exact source commit and reconcile the same request after an interrupted response. Attach the completed result and reopen the complete use/source history.
5. Export the full recipe delivery and whole-Workspace delivery, open their usable contents, and reopen the selected recipe/source history in the authorized independent receiving Workspace.
6. Inspect desktop and relevant narrow layouts, empty/loading/error states, actual controls and every downloaded/reopened artifact. Repair actual presentation problems in the same owner-controlled course.

Source review and grammar evaluation do not establish that this receiving sequence has run. Report actual native and rendered outcomes with their original operation receipts.


## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949
