# Complete Source Preparation working desk

TokenJunkieLabs — original Upper Savannah application.

## Open and continue the whole preparation

Open **Working inputs and original upload history** in Prepare study inputs, Regional soil, or the existing Geographic headwaters desk. **Download complete working desk** saves every retained method draft, including exact unfinished numeric text, the complete combined-input choice, original upload receipts, active and deliberately retired request identities, readable source descriptions, and all prior whole-desk and file-import history.

The original **Download working inputs** and **Reopen working inputs** controls continue to handle the selected-method v1 format. Use the complete working desk for multi-method and combined-source work. Neither format contains uploaded raster bytes or another copy of the scientific Workspace. Retain the original complete Workspace archive and original source files alongside the working file when handing over a project.

**Reopen complete working desk** opens a UTF-8 JSON file in the same original desk namespace and Workspace key. The reader validates the entire file, computes its actual byte count and SHA256, and compares the current complete working state after the asynchronous read. A change to any method, composition, request, receipt or retained history during that read leaves the live state unchanged and asks the operator to select the file again. Selecting the same file again works because the file input resets after selection.

The complete replacement is written and read back through the existing per-tab sessionStorage before any live field is changed. If storage fails, the original current choices remain visible and usable. The imported file remains the recovery source. Download the current complete desk before closing a tab if browser storage is unavailable.

Every successful changed import retains two independent full snapshots: the desk immediately before opening and the complete incoming state. **Reopen whole choice** restores a selected historical working choice while keeping actual local operation requests and later upload receipts. **Download full historical desk** includes that selected complete state, all history and original file identities.

## Original operations and deliberate new requests

The installed original source queue remains authoritative. This feature does not create, start, resume, cancel or replace a native preparation or scientific model. Prepare and Combine continue through the original request key, UUID, native action and storage-before-dispatch code.

Opening an older file never rebases its UUID to another Workspace or action. When the current desk has already selected a newer UUID for the same exact request body, that current dispatch mapping stays active. The old incoming UUID remains in its complete incoming history snapshot. The explicit **Use a new operation for changed input** action first retains a complete snapshot and records each retired request. An older file cannot revive a retired UUID, including the interval before the new request is first sent. Conflicting content for the same original UUID is rejected before replacement.

Current task display and operation filters remain local. Incoming task and filter choices remain in the complete incoming snapshot. An imported working file does not claim that an old host's task exists on the receiving host. The same-Workspace check deliberately refuses a different registered key; use the original Workspace/source receiving workflow and an explicitly reviewed new current-host selection for that separate case. Do not edit the old UUID or workspace key to make a file pass.

## Missing choices and unfinished values

Unavailable methods remain selectable as retained drafts. Unavailable explicit bundled inputs, collection/source pairs, original companion paths, uploads and host roots remain in the file. Missing combined prepared-task, collection and registered-source choices remain visible. They are not silently removed or changed to the first available option. Combine is blocked until those choices are available or the operator explicitly removes them. Removing an unavailable combined choice first saves a whole-desk history snapshot.

A host-root selection means that the original root is available; the native preparation still checks the selected file. A displayed source reference is not a new source import or a physical-file verification. Complete native source validation remains with the original writer.

Numeric fields preserve literal in-progress text, including a minus sign, partial exponent or blank. The selected numeric field uses a text control with decimal input mode so browser number sanitization cannot erase that text. A valid value updates the original numeric option; an unfinished value keeps its literal working text. Prepare converts and checks the selected active numeric text for finite value, integer requirements and the installed limits before passing the original options payload. Inactive method drafts and inactive options remain complete in the working file.

## File contract

The module is `operator/web/source_working_desk.mjs`. The exact schema is `upstate.source-working-desk/v2`:

- `namespace`, `workspace_key`, `actions`: original desk and its two native actions.
- `state`: complete method, drafts, merge selection, active requests, retired requests, current task, operation view, selected-method history and upload receipts.
- `source_descriptions`: retained complete source-catalogue rows and selected identities.
- `desk_history`: attributed full prior/incoming working states and source descriptions.
- `import_history`: exact imported filename, UTF-8 bytes, SHA256 and local import identity/time.

Unknown JSON fields remain in validated working states. Native method field semantics remain with the installed original catalogue. The portable module does not normalize or fabricate scientific source data. JSON non-finite values, incomplete original identities, conflicting request histories, malformed complete state and foreign desk/Workspace/action contracts are refused.

The supported complete pretty JSON plus newline is at most 64 MiB of UTF-8. The same capacity applies to validate, save, import and final expanded history. No history or selected source is truncated to fit. Keep the full original file if its complete content exceeds that capacity.

Public pure functions: `createDeskFile`, `validateDeskFile`, `prepareDeskImport`, `restoreDeskHistory`, `reconcileDeskSources`, `serializeDeskFile`; stable JSON and UTF-8 helpers are exported for the same source contract. They do not access a network or native store.

## Installed source and original receiving

The existing source-preparation, regional-soil and geographic-headwaters descriptors serve the additive module. The `source-working-desk` component fragment appends complete source, guide and receiving helper paths to the existing components. The original source writer, queue, scientific calculations and source archive formats are unchanged.

The receiving helper `source_tools/source_working_desk_receiving.mjs` borrows the actual Page and original download/artifact callbacks from `receive_geographic_handover_browser.mjs`, immediately after its existing selected-method upload/history course. It operates full draft/composition download, deliberate edits, complete reopen, literal numeric unfinished text, preserved missing references, original request identities, same-file repeated reopen and an actual page reload. It restores the original complete scientific choice before the unchanged original geographic preview. It never presses Prepare or Combine and does not upload invented scientific measurements.

The original equipped receiving owner must open and personally use the actual desk at desktop and 390px, view the complete downloaded JSON and every original source/Workspace attachment, and retain the real outcomes beside the same original course. Source review and V8 operations do not establish that native/browser receiving has completed. Use the full current `AGENTS.md` and `CURRENT_OWNER_DIRECTION.md` with the complete application, preserving existing owner/process/source and original attribution.
