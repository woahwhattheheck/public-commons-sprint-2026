# Highway field operations

This application carries captured ArcGIS datasets through form design, field work, supervisor review, source refresh, dispatch and approved edit proposals. Source files, staff actions and approved editions travel together in the portable workspace. It combines the read-only capture component, this domain, the SQLite command store, the staff interface and the original paired-reconciliation engine.

## Daily work

1. Capture selected published layers and related tables. The service URL, field definitions, original ID and count responses, complete feature pages, attachment listings and available attachment bytes are retained. Import the resulting manifest and every referenced byte blob.
2. Design an inspection form against that source edition. Choose original fields by name. Original data types, coded values and ranges, text lengths, nullability and read-only identity/editor fields determine editing. Add local notes, measurements, dates, yes/no answers and choices where the field work needs them.
3. Create a crew and work package, assign actual source objects using an active form, and open field inspections. Each inspection starts with original attributes and geometry. Crew attachments are retained by exact bytes; original source attachments remain in the source binding.
4. Save the full current form. Save creates an immutable inspection edition containing typed answers, notes, geometry and added attachments. Field workers can continue drafts and returned inspections. A supervisor correction requires a reason and creates a new draft while retaining the original submission and decision.
5. Submit a complete inspection. Required answers and attachments are enforced at submission. The submission binds the exact saved form, original record and answer edition. A supervisor can approve, return with a note, or reject with a note.
6. Combine current approved inspections into an edit proposal. It carries original record identities and source hashes, changed attributes, geometry changes and new attachment references. Compatible edits for one object combine. Conflicting approved values for the same field or geometry require resolution.
7. Record crew effort and follow-through, close approved assignments and issue the package operating report. Export the complete workspace for receiving, continuation and handover.

## Refreshing field work

A fresh capture becomes the active source edition. Existing inspections retain their original source until an explicit rebase. The interface compares attributes, geometry, attachments and layer metadata.

When only the source value changed, rebasing adopts it. When only the local answer changed, rebasing preserves it. When both changed to different values, choose keep or current for that field. Geometry uses the $geometry choice. A removed or renamed source field needs a compatible form edition; pending edits cannot silently disappear when choosing its replacement.

A rebase preserves previous history and makes a new draft. Review, submit and approve the updated edition. Dispatch's assignment-refresh action retains the original assignment and connects its refreshed form/source to the rebased inspection. Reused ObjectIDs with a different original GlobalID cannot silently substitute a different object.

Capture records coverage and changes observed during the actual reads. Metadata, original row inventories and observations remain visible alongside individual records.

## Forms and values

Source fields use the original ArcGIS definitions. Identity, editor tracking, geometry/blob/raster fields and noneditable fields remain read-only. A type ID field can be edited when metadata permits; subtype domains are evaluated after the complete proposed attribute set is known.

Unchanged legacy values remain as received. Changed values satisfy the published editable type and domain. Form changes create a new edition. A stable form key identifies the ordered history; a successor names the current previousFormId and rejects a stale editor.

Integers use published ranges; BigInteger and ObjectID use the exact JavaScript-safe 53-bit range. Numbers round-tripped through a browser as 1 rather than 1.0 remain unchanged, while booleans remain distinct. Date fields accept original epoch milliseconds or a timestamp with its time zone. A source advertising unknown time zone retains its epoch representation. Date-only and time-only fields retain separate meanings.

Geometry proposals use the original type, coordinate dimensions and spatial reference. Polygon rings remain closed. Original unchanged geometry is preserved; the application performs no reprojection.

Local attachment filenames have no directory components. Form policy controls media types, per-file size, maximum count and whether an added field attachment is required. Original and added attachment sets remain distinct.

## Approval and proposal

Versions, submissions and decisions are immutable history. The latest version identifies the currently usable submission and decision. Correction or rebase clears that current decision and creates a draft. Earlier approved proposals remain historical editions.

A proposal records each supervisor-approved candidate, original ObjectID and GlobalID, feature attributes and geometry, source attachment set, and source capture. Batch coalescing accepts equal or disjoint changes. It rejects differing values for one field, conflicting geometry, incompatible originals, and different bytes for the same added attachment identity.

The proposal is a prepared operating artifact. Its providerOperations is empty and routing uses original ObjectID. Published service capabilities, including sync and GlobalID edit support, are retained for the integration receiving it.

## Programmatic boundary

highway.domain is a pure Python standard-library module. Storage supplies exact byte retrieval, request replay and atomic workspace revision checks.

- new_state(workspace_id, title, created_at) creates an empty state.
- apply(state, command, read_blob) returns a new state and operation result.
- validate_state(state, read_blob) checks retained editions and original bytes during complete intake.
- describe(state, read_blob) returns the staff application catalog and dispatch view.
- dataset_records(state, capture_id, layer_id, read_blob) returns actual records, original metadata and coverage.
- inspection_view(state, inspection_id, read_blob) returns current and historical field work, original source, source comparison and related proposals.
- dispatch_context(state, read_blob) supplies source object identities, forms and inspection/approval identities.

The storage envelope is {"expectedRevision": integer, "command": command}. A command has exactly requestId, kind, actor, at and body. The actor contains id and name; at is an ISO timestamp with its time zone. The caller generates a request ID once and retains it for retry. The store compares the original full envelope and returns its first committed result before checking a later workspace revision. Domain operations generate no random IDs or timestamps.

| Command | Body |
|---|---|
| capture.import | manifest |
| form.save | id, key, previousFormId, title, description, layerId, captureId, fields, geometryEditable, attachments |
| inspection.open | id, formId, objectId, optional assignmentId |
| inspection.save | id, expectedVersion, full answers, full geometry, full attachments, note |
| inspection.correct | Save body plus required reason |
| inspection.submit | id, expectedVersion, submissionId |
| inspection.decide | id, submissionId, decisionId, decision, note |
| inspection.rebase | id, expectedVersion, captureId, optional formId, conflictChoices, note |
| proposal.create | id, inspectionIds |

Form fields contain key, label, kind, sourceField, required, readOnly, choices, maxLength, minimum, maximum and help. Kind is source, text, integer, number, boolean, date or choice. Source fields name an exact original column; local sourceField is null. Choices contain distinct primitive value and label pairs. Attachment policy contains enabled, required, maxFiles, maxBytes and allowedTypes.

Added attachments contain id, name, sha256, bytes and mediaType, and their bytes must already be available in the caller's store. Supply complete geometry even when unchanged. Inspection statuses are draft, submitted, returned, approved and rejected; decisions are approve, return and reject.

DomainError is a ValueError subclass carrying code and optional structured details. Source conflicts include original, local and current values. Stale inspections report the current version. Keep unsaved work visible while the operator resolves the actual field or workspace conflict.

## Source ownership

This product joins the original Geocove Highway opportunity and its paired-reconciliation delivery. The published County source is:

https://gis.livingstoncountyny.gov/arcgis/rest/services/Highways/FeatureServer

Use the capture component to obtain current exact response bodies. Published datasets and capabilities determine configuration. Capture, SQLite persistence, field domain, dispatch and reconciliation remain separate modules in one complete receiving workspace. The original paired engine owns reconciliation calculations; this field module owns inspection and supervisor state. Portable history carries original source bytes and all resulting working editions.
