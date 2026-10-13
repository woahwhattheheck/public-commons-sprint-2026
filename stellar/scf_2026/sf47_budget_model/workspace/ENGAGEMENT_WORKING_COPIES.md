# Complete Contributor working copies

Contributor working copies preserve a complete point in the existing Grant Operations preparation: entered agreement fields, original sources and saved book, native previews, the exact receiving stage, full original commands and receipts, and any selected complete Portfolio file. They provide named browser checkpoints and portable JSON for inspecting and reopening the same work.

Use the maintained Contributor engagements desk in the original operating case and recording-staff scope. The existing agreement, Forecast, Portfolio and receiving engines remain the authorities for review and saves. Opening a working copy performs read-only reconciliation before it changes the active browser preparation.

## Open the working-copy pane

In the original Operations case, select **Contributor engagements**, then **Working copies**. The pane has three parts:

| Part | What it does |
| --- | --- |
| Keep the current preparation | Name and capture the complete active preparation, download it directly, or select a downloaded working file for inspection. |
| Named checkpoints | Find local checkpoints, inspect a complete saved copy and explicitly remove an unneeded local copy. |
| Inspect before opening | Show the selected file's exact identity, original/current binding, retained commands, source metadata and complete state; explicitly reconcile and open it. |

Complete active state and named checkpoints are retained in the browser's IndexedDB database for this installation, staff scope and case. Session storage is read only to recover the earlier preparation. A native command waits for its exact pending body to commit before dispatch; opening another working copy likewise waits for its complete replacement record to commit. Ordinary edits use an ordered, coalesced autosave queue.

The store compares the revision it originally read before replacing a saved session. If another tab has saved a newer preparation, keep the complete local work and inspect the conflict; the desk does not silently overwrite the other tab. A browser storage or capacity error remains visible, leaves the original request unchanged, and keeps the active state available for a complete file download.

The pane inherits the current desk's busy state, request ownership and recording identity. Errors from capture, validation, local retention, native reads or downloads appear through the original desk. A new host, application account or native case is not created.

## Recover an existing browser preparation

When no current scoped preparation exists, the desk reads the complete earlier `sf47.engagement-operator.v1` session from its original case key. It retains the original key and exact JSON unchanged, stages a converted working copy, and opens **Working copies** for inspection. It does not adopt the preparation or send a request automatically.

The staged copy contains every original supported preparation field, pending/accepted/rejected command, handoff and receiving step. Its legacy record also contains the whole original session, including fields that are not part of the current active form. The raw original JSON stays in the working file. Missing recording-staff provenance, source inventory, original file bytes or case version are stated as missing; they are not invented.

Inspect the original commands and case binding, then choose **Reconcile and open** explicitly. Native reads must confirm every known accepted result. An unresolved original request stays unchanged and can be resumed only by its original recording operator through the existing request controls. Opening never dispatches that request. The desk retains a complete recovery checkpoint before replacing active preparation and keeps the old storage key available afterward.

An original session saved as JSON can also be selected through **Inspect a downloaded working file**. Earlier **Save draft** files using `sf47.engagement-operator-draft.v1` remain readable; they contain only the fields that the earlier export retained. The inspection records their limitations.

If the earlier session is malformed, its complete raw text remains available in **Download current preparation**. Keep that file and the original key while correcting or receiving the original data. No unreadable session is silently replaced.

## Capture the current work

Enter a meaningful **Checkpoint name** and choose **Capture named checkpoint**. A checkpoint is an immutable complete preparation at that point. Capturing another point creates another named local checkpoint; it does not overwrite an existing saved book or earlier checkpoint.

Use **Download current preparation** to retain the active state in a complete JSON file. This control is especially useful when browser storage is full or cannot retain a checkpoint. Keep the current desk open while resolving a local-retention error; the original operation owner continues to hold the active preparation and original request.

A working copy retains the following data when it exists in the original preparation:

| Retained data | Original meaning |
| --- | --- |
| Agreement document | All named agreements, roles, scope, dates, seven weekday values, every dated exception, compensation, acceptance fields, complete allocations, source IDs and notes. |
| Visible selections and unfinished controls | Selected agreement, view, search, acceptance filter, new-contributor selection, and unfinished exception-date/hour and allocation selections. |
| Native preview and observed versions | The complete original preview, its case version and the draft's observed version. |
| Saved engagement edition and history | The full original immutable review and document, selected review ID, saved-edition summaries and receiving history already retained by the desk. |
| Handoff input | The selected source book, original Forecast, confirmed agreements, explicit remainders/payment choices, resource mappings and complete Portfolio input. |
| Receiving state | The original flow ID and phase, original selected inputs and previews, accepted Forecast/Portfolio/receiving IDs, and every retained step receipt. |
| Original commands and receipts | The complete pending, accepted or rejected action, actor, note, expected case version, request ID, body, context and native result where present, plus every earlier completed preparation request retained in `state.requestReceipts`. The dedicated commands inspection includes this complete array alongside pending, accepted and rejected work. |
| Applied and pending Portfolio files | Each original filename, media type, full byte count, SHA-256 and exact complete file bytes. The applied file is joined to the retained native Portfolio input. A selected file awaiting application remains separate, including invalid or unfinished JSON; it does not replace that input. |
| Case and staff binding | Original operating-case and plan identities, observed versions, recording-staff scope, recording operator and native source metadata. |

Blank or unfinished entered values remain entered values. Saving a working copy does not normalize them into an agreement, confirm a contributor, replace a preview or calculate a different schedule.

Original attachment bytes remain in the native case. The working file retains their identities and metadata; it is not a replacement for the complete case export. The selected Portfolio file is included in full when the current desk retained that file.

## Inspect a named checkpoint

Use **Find a checkpoint** to search names, IDs, saved editions or original request IDs, then choose **Find checkpoints**. Search changes the displayed list, not the saved checkpoint inventory. **Clear search** restores the complete list.

Each row shows the checkpoint name and creation time, retained agreement count, receiving phase, selected saved edition, original request when present, file size and SHA-256. These are retained observations from the checkpoint; the pane does not infer acceptance or readiness from a name or a row count.

Choose **Inspect checkpoint**. The selected copy appears under **Inspect before opening**. Inspection does not replace the current preparation.

Long lists use explicit pages of 25 checkpoints, source identities or original commands. Moving between pages preserves the complete selection and all remaining entries; it does not remove data from a working file or download.

## Inspect a downloaded working file

Choose a complete JSON file using **Inspect a downloaded working file**. The original working-file reader decodes the whole UTF-8 JSON, validates the supported schema and original state, and checks the full embedded Portfolio file bytes when present.

The file is staged for inspection. Selecting it does not send a save or automatically open it. The pane shows:

- The exact selected filename, complete byte count and SHA-256.
- Checkpoint name and creation time, retained agreement count, saved book and original receiving phase.
- Original and current case, plan, observed version, recording-staff scope and actor.
- Explicit opening conflicts and retained observations from the working-file model.
- Original pending and accepted request identities, expected versions and receipt IDs.
- Original/current source metadata with the model's unchanged, changed or missing status.
- Each applied or pending Portfolio file identity, if complete original files are included. The dedicated file view retains both full encoded byte sets and identifies a selection that has not yet been applied.

A case or recording-staff mismatch leaves opening unavailable. The full selected file can still be inspected, downloaded or dismissed. Use the original case and staff scope to resume that work; native identities are not remapped by editing a filename.

A changed case version is an observation, not proof that a saved historical book is invalid. Opening verifies existing native records and clears stale unsent previews when the existing desk requires another review. Accepted original commands keep their original bodies and results.

Earlier **Save draft JSON** files use the original draft schema. The maintained reader can inspect the data they actually contain. It explicitly lists missing provenance such as an absent original staff scope, full source inventory, unfinished add-row controls or exact Portfolio file bytes. Missing data is not invented. Inspect those limitations before asking to open the file.

## Read the complete retained data

The selected copy provides separate controls for agreement fields, handoff choices, the receiving flow and receipts, complete commands, native preview and versions, saved history, unfinished controls, exact Portfolio file and the whole working document.

The JSON inspector shows complete retained data in explicit pages. It prepares the large text view only after that section is requested, rather than placing a full encoded Portfolio file into every screen update. **Previous data page** and **Next data page** traverse the full selected section. **Close data inspection** closes that view without changing the selected copy.

These are original data views. They do not reclassify an agreement, recalculate an amount or convert a native observation into a new judgment. The full selected working document remains available through **Download selected working file**.

The file's original byte count and SHA describe the inspected file. A later complete JSON download may use the maintained writer's formatting while retaining all validated data. Embedded original Portfolio bytes and their hash remain exact.

## Reconcile and open explicitly

After inspecting the complete selection, choose **Reconcile and open this copy**.

The original desk preserves a recovery checkpoint of the active preparation first. It then uses the existing authenticated read-only request lookup to reconcile every retained original command and native receipt. It reopens the saved engagement book and any retained Forecast, Portfolio and receiving records by their actual identities before adopting the selected browser state.

A known accepted result must match the original native request journal and immutable record. If it is absent or different, the original selected file and active work remain available for recovery; the pane does not create a replacement operation ID.

An original pending command that the native journal already accepted becomes the same accepted command for normal follow-through. If no result exists, it remains an original unsent or uncertain request. Opening itself does not dispatch it.

Use the original desk's **Resume original request**, **Reconcile saved receipt**, or **Resume native receiving** controls when an explicit continuation is needed. Each continues the original action and stage. A case change before an unsent preview is saved requires another native review; it does not rewrite an accepted command.

After opening, the agreement editor, saved-edition view and Portfolio/cash handoff use their original controls. Saving an agreement, Forecast, Portfolio or receiving record still requires the original reviewed native operation. A checkpoint never advances those steps merely because it contains their inputs.

## Keep or remove local copies deliberately

**Dismiss selection** closes the staged inspection and preserves active work.

**Remove local checkpoint** first selects the exact local checkpoint for removal and shows its name and ID. **Remove this local checkpoint** confirms that removal; **Keep checkpoint** cancels it. The action applies only to that named browser checkpoint. It does not delete active preparation, original source attachments, a saved engagement book, Forecast, Portfolio, native receipt or case history.

Download a complete copy before removing it if you need to retain it elsewhere. If local storage is blocked, use the direct current-preparation download and remove only an intentionally selected local copy before trying another capture.

Named checkpoints and the portable working file are local preparation history. Immutable native edition history remains in **Saved editions** and the original complete case.

## Complete operational handover

For a colleague who needs original attachments and all native records, use the existing complete engagement-case export in addition to the working file. The case export retains the source bytes, complete Operations history, saved engagement reviews, Forecasts, Portfolios and original receiving joins.

The working file is bound to its original case and staff scope. Independently importing a case or changing a recording identity does not silently grant permission to adopt that working state. Keep the complete inspected binding and use the maintained receiving workflow.

Keep working files private to the intended case operators: they contain complete contributor terms, entered source context and original command material. The declared working-state fields do not contain a copied host access token.

## Existing operator integration

The sibling module exports createEngagementWorkingDesk with these supplied callbacks:

| Callback | Responsibility of the existing desk |
| --- | --- |
| view() | Return the complete current name, saved headers, staged selection/inspection and local-storage status. |
| setName(name) | Retain the entered checkpoint name synchronously. |
| capture(name) | Capture and retain the full active state as an immutable named checkpoint. |
| inspectSaved(id) | Read and validate the exact saved local checkpoint, then stage it. |
| inspectFile(file) | Read and validate the selected complete File, then stage it. |
| openSelected() | Preserve active work, reconcile original native requests/records and explicitly adopt the selected state. |
| downloadCurrent() | Retain/download the complete current preparation through the original file owner. |
| downloadSelected() | Download the complete staged working copy through that same owner. |
| removeSaved(id) | Remove only the explicitly selected named local checkpoint. |
| dismiss() | Clear the staged selection without changing active work. |

The returned object exposes render(), input(event) and async action(name, target). Render returns the complete pane markup. Inputs and actions are delegated by the original root listeners; this module creates no independent listeners, tasks, browser storage, HTTP client or native writer.

All click actions use the existing data-engagement-action attribute with a working- prefix. Saved rows use data-copy-id. The name control uses data-engagement-working-name, and the file control uses data-engagement-working-file.

Call input(event) for name and search input events. The supplied name setter retains each entered value; on change the parent can render again. The search button applies the retained search value explicitly.

On the working-file input's change event, run action('working-inspect-file', event.target) inside the parent's original retained run/operation owner. The pane captures that exact File before awaiting the inspection callback. Do not replace the parent root before handing the File to the callback.

Call action(name, target) for working-prefixed buttons inside the same original operation owner and await its returned promise. True means the action was handled. Callback failures propagate to the parent's existing error handling; the pane does not suppress them or announce success.

The parent controls admission while busy, during a pending original native command and during close. It must keep permitted checkpoint/inspection/download recovery controls usable while preserving the original request lock. The pane's fixed-disabled flags protect opening when the authoritative inspection says it cannot open.

The parent retains every admitted callback through close, persists the complete original session and closes its file/download/storage owners before declaring its desk closed. It owns the stylesheet link and disposes its root listeners. This pure pane has no independent resource to close.

## Inspect the actual outgoing application

Before describing the feature as ready for a customer or colleague, open the exact selected source version in the original equipped Contributor receiver and look at the rendered screen. Use the existing case and native workflow; this source adds no separate test-only programme or synthetic provider responses.

Operate named capture, raw unfinished fields, the exact Portfolio file, original pending/accepted request recovery, saved checkpoint inspection, full-file download, reload/reopening, explicit selected-file reconciliation and local removal. Inspect the actual rendered empty, populated, loading, storage-error and returned-conflict states. Look at both normal desktop and narrow widths, long names and original IDs, the table pages and complete JSON pages. Open the downloaded working file and the real original attachments/case export, and reopen the retained work through the same original controls.

Fix clipped, unreadable, overflowing or broken presentation in the actual selected edition while preserving the original calculations, decisions and workflows. Code review, syntax parsing, HTTP success or unviewed screenshots do not replace looking at the rendered result.

If runtime access is unavailable, keep the complete source and literal opening steps with the existing receiver and label the result source-reviewed. No native execution or rendered inspection is claimed by this source delivery alone.
