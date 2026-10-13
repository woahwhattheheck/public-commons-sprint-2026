# Application Packet Workspace

A complete offline administrative packet workspace. Retain the original binary files, define a source-bound requirement edition, record the actual case population and complete typed forms, work through correction rounds, accept a handover, and prepare exports against a supplied native schema.

Open **Application_Packet_Workspace.html** in a current desktop browser. There is no server, account connection, external script, font service or analytics. All source is included in the delivered HTML and source ZIP. The empty application contains no prospect contacts or application facts.

## Build the full application

Use Node.js 22 or later and the complete source directory.

    node build.mjs --out ./delivery/blank

This creates the standalone HTML, complete source and a complete ZIP. The destination is create-only. Repeating the same build validates the already saved bytes. Use a new directory for changed source or a different working edition.

To deliver a complete existing workspace, including its original files and unfinished writing:

    node build.mjs --workspace ./Working_Recovery.json --out ./delivery/current

The result includes:

- Application_Packet_Workspace.html: the whole editable application and selected working record.
- Working_Recovery.json: full saved operation history plus this tab's unfinished values and selection.
- workspace.json: the saved engine operation history.
- Packet_Review.html: the complete readable case report, with every form's fields and evidence.
- source-editions.json, case-register.json and original-files.json.
- originals/: every original file's complete bytes. Portable member names map back to original filenames through original-files.json.
- native/: each saved mapping's exact original CSV bodies, assessment and returned records.
- source/: the complete maintained application, engine, SHA implementation, builder, CLI and guides.
- CONTENTS.json: exact selected member lengths and SHA-256 identities.
- Application_Packet_Complete.zip: the same usable complete delivery.

Unzip a complete delivery before opening Packet_Review.html so its relative original-file links work. Working HTML can be opened independently. The archive uses standard UTF-8 stored ZIP members, without an additional library or compression dependency.

## Whole operator workflow

### 1. Create or reopen

Create a workspace with a descriptive title. Enter the actual operator name in the header before saving decisions. Open a saved workspace JSON or working recovery JSON from Workspace & delivery.

Every imported differing edition opens as a separate local copy. An older working HTML opened again at its retained copy identity uses the newer saved descendant where one exists. It never replaces it with the older embedded history. Divergent histories remain independent copies.

The header shows the current saved revision. The left navigation retains all working stages; use the Current case selector when several cases share the same source edition.

### 2. Retain files and source editions

In Files & sources, select the complete originals and record their purpose. Save retains the exact bytes, original filename, media type, byte count and SHA-256. Download original returns those same bytes.

Then add a source edition: publisher, original URL/location, displayed edition/date, actual retrieval note, interpretation context and original source files. A later source may explicitly supersede an earlier one without deleting it.

The file chooser itself cannot survive a browser reload. Once retained, the file is part of every complete export. Before retention, select it again after reopening an unfinished upload form.

### 3. Define the actual requirement contract

Requirement editions are immutable and source-qualified. Retain the complete selected list, including each requirement's original source ID, page/section, instructions, applicability guidance, instance mode and typed fields.

The advanced requirement JSON contains:

    [{
      "id": "stable-requirement-id",
      "label": "Exact issued requirement label",
      "sourceId": "retained-source-id",
      "locator": "Page and section",
      "instructions": "Complete original instructions",
      "applicabilityNote": "Actual applicability guidance",
      "instanceMode": "per_subject",
      "evidenceRequired": true,
      "fields": [{
        "id": "stable-field-id",
        "label": "Original field label",
        "type": "text",
        "required": true
      }]
    }]

Supported field types are text, date, integer, decimal, boolean and choice. Choice fields include the original options array. Single requirements have one case-level instance; per_subject requirements require a reviewed selection of actual subjects. All saved field values remain strings, including "0" and "false". An absent field differs from an explicitly recorded empty value.

Later editions retain previous requirement and field IDs and instance modes, so adopting an edition preserves prior work. Changed facts, people or sources invalidate the affected review basis.

### 4. Create the case and subjects

A case selects one matching facility/entity type and transaction/application type. Record the actual facts and original application reference. Add every relevant person or entity as a distinct subject. Same-name people retain distinct stable IDs.

A case edit is an additional original operation with a reason. Adopting a later matching requirement edition records why the source changed.

### 5. Review the full scope

Scope & form instances requires an explanation for every requirement and an explicit subject selection for each per-subject requirement. Selecting no people requires a reason. Single requirements remain case-level, with their applicability decided on the form.

Save the full scope, then create all its missing selected form instances. Existing instances and historical reviews remain retained. A changed case population requires a fresh full scope.

### 6. Complete forms and evidence

Forms & evidence provides normal controls for each declared field. "Record this field" distinguishes an absent field from an explicit blank. Date and numeric values use text controls so incomplete writing survives unchanged; the declared contract is checked when the saved form is reviewed.

Record applicability, its explanation, the complete current values and original evidence. Save the form before reviewing it. Review records the named operator, outcome and explanation against the exact current source, facts, subject, values and evidence. A later change makes an earlier review stale.

Unfinished form values persist separately from accepted data. Invalid or incomplete writing is retained as a draft. Downloads of working HTML and recovery JSON include the unfinished values. No unfinished field becomes an accepted application fact through autosave.

### 7. Corrections and responses

Open each original correction round with its reference, literal deadline/timezone or explicit "unspecified", context, original request files and complete selected correction items. Each item binds the original form and optional exact field.

Revise and save the affected form, then respond to the original correction item using the current saved form and actual response files. Review the latest response; earlier responses and decisions remain visible. A later form edit requires a fresh corresponding response/review.

### 8. Accepted handover

Review & handover displays every selected and historical instance, current reviews, missing scope/instances and complete acceptance history. Accept the full current handover only when the current forms and correction rounds satisfy the retained contract.

This acceptance records an administrative handover decision by the named reviewer. Preserve an authority's actual determination as its original correspondence.

### 9. Native schema, rows and original result

Attach the actual target schema/template files. Define the real tables, ordered columns, stable keys, required columns, types and relationships. No vendor schema is assumed.

    [{
      "name": "actual_table",
      "columns": ["actual_key", "actual_value"],
      "required": ["actual_key"],
      "keys": ["actual_key"],
      "types": {
        "actual_key": {"type": "text"},
        "actual_value": {"type": "text"}
      },
      "references": []
    }]

Native types are text, integer, decimal, date, datetime, boolean and choice. Native choice types retain their actual options. Relationships contain columns, targetTable and targetColumns. Optional supplied lookups contain table, original fileIds and complete rows with actual column names and string values. Missing types or unresolved required keys/relationships remain explicit assessment issues.

Each mapping records include/exclude plus a reason for every currently selected form instance. It includes all contract tables and explicit expectedRows, including zero, with exact row bindings. Supported bindings are field, literal, case_id, instance_id, subject_id and evidence_ids.

Portable native member names use safe prefixed aliases, with the original native paths retained in the export assessment. Standalone CSV downloads use table-<actual_table>-<SHA256-prefix>.csv so reserved device names remain usable on Windows. These aliases do not change the CSV body or native export digest.

A saved mapping freezes the prepared CSV bodies and their export SHA-256. Later case changes make the assessment stale while retaining those original CSV bytes. The assessment lists rowBindings with exact rowId, table, instanceId, rowIndex and original keys.

After an actual native import, retain its physical result file. Record the original target run reference, outcome, notes and observed returned rows. Each return binds the exact export SHA and originally exported row; rowId is required when one instance produces several rows in a table. Unreported rows remain explicit. This offline tool does not send requests to the native platform.

Native CSV uses the original schema and exact values. It does not insert spreadsheet formula escapes that would change native keys or field values. Use the target importer or controlled spreadsheet text-import settings when viewing CSV.

## Saved work, drafts and concurrent tabs

IndexedDB keeps full workspace copies, per-tab unfinished forms and both complete conflict branches. A mutation reads the same saved copy in a read/write transaction, compares its original head, then commits the new workspace and clears only the submitted draft token in that same transaction.

If another tab wins first, both the current saved workspace and this complete candidate remain recoverable. Download both versions or continue the candidate as an independent copy. The original draft remains. No silent automatic merge occurs.

A recovered unfinished form retains its original base revision. If that base is older than the current workspace, review the values and click **Use these values for the current revision** before submitting. The current target source is visible; the earlier draft is not silently relabelled.

Working-HTML embedded drafts are restored into a new tab when it has no same-form draft. A differing existing draft remains active, and the embedded draft is retained separately under History & recovery. Web Locks distinguish duplicated tabs where available; fallback page identities keep their drafts separate, with closed-tab recovery in History.

Keep a complete downloaded working copy before closing a session. Browser storage may be removed by browser settings, profile deletion or quota eviction.

## Command-line operations

    node cli.mjs create --id packet-example --title "Administrative packet" \
      --at 2026-10-13T15:00:00Z --out ./work/revision-0.json

    node cli.mjs apply --workspace ./work/revision-0.json \
      --operation ./operation.json --out ./work/revision-1.json

An operation JSON supplies action, input, operationId, expectedRevision, actor and at. Reuse the original ID/input/actor/time when continuing the same operation. The engine returns the original operation for an exact repeated ID and rejects changed content using the same ID.

    node cli.mjs add-file --workspace ./work/revision-0.json \
      --file ./issued-original.pdf --file-id issued-pdf --purpose "Issued original" \
      --mime application/pdf --actor "Actual operator" --operation-id retain-issued-pdf \
      --expected-revision 0 --at 2026-10-13T15:01:00Z --out ./work/revision-1.json

    node cli.mjs inspect --workspace ./work/revision-1.json --out ./work/state.json
    node cli.mjs native --workspace ./Working_Recovery.json --mapping MAPPING_ID \
      --out-dir ./delivery/native
    node cli.mjs export --workspace ./Working_Recovery.json --out-dir ./delivery/full

Input and output files are distinct. Publication is create-only; identical complete output can be adopted after a lost reply. Changed existing output is a concrete conflict and is left intact.

## Limits and compatibility

Original file: 32 MiB. Workspace: 128 MiB. At most 300 original files, 300 requirements per edition, 3,000 form instances and 10,000 retained operations. The complete recovery envelope accepts 192 MiB including unfinished writing. The ZIP writer supports standard non-ZIP64 limits and rejects an oversized whole archive.

Use a current browser with IndexedDB, Blob, Web Crypto UUID, TextEncoder and standalone JavaScript enabled. Web Locks and BroadcastChannel improve tab coordination where available; IndexedDB compare-and-save remains the authority. Node is needed only to build or use the CLI.

The exact engine and SHA module are maintained separately by their original owners. The SHA module retains its upstream attribution. No private contacts, credentials or original application records are embedded in the blank source. Imported files remain operator-selected originals.

## Before delivering the exact product

Follow BROWSER_OPERATING.md. Bryce's standing instruction applies to every outgoing attachment: the producing worker opens/runs/renders and personally LOOKS at the actual outgoing result, uses important controls, checks desktop and narrow layouts, opens every applicable report/PDF page and usable ZIP contents, downloads and reopens working files, and repairs concrete problems. Source review, counts, HTTP success, captured-but-unviewed screenshots and another worker's approval are not substitutes.

Use the original equipped receiving programme for the actual browser course. Retain its same operation and local copy after interruption. Do not add a controller, watcher or parallel writer.
