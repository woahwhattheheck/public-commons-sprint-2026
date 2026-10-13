# Highway field copies and returned observations

This workflow lets a supervisor issue saved Highway inspections to a named colleague, receive that colleague’s complete working file, compare it with the current inspection, and adopt selected observations through the original inspection writer. The issued copy retains the actual source records, forms, assignment context, original attachments and inspection history.

The field copy runs independently. Its named editions are observations for review. The existing Highway application still owns submission, supervisor decisions, approved edit proposals, dispatch and any later source refresh.

## 1. Prepare an actual assignment

Use the existing application to retain the complete source capture, configure the form, create the crew/work package and assignment, and open each inspection. Save any current form changes before issuing them. Select the actual inspections and named colleague, and enter practical field instructions.

The issue is prepared from one exact current workspace revision and state hash. It includes:

- Each selected inspection’s entire version, submission and decision history.
- Its current full form and the retained editions of that form.
- The original record, source binding, geometry, metadata and source-coverage observations.
- The full associated assignment, crew and work package when present.
- The relevant prepared proposals as their original historical records.
- The complete required source captures and all their original files.
- Every retained attachment required by those inspection histories and proposals.

The original capture can contain other records in the same selected dataset or service capture. Its complete provider pages and coverage remain intact. Select the appropriate source and recipient before handing over the resulting file.

A prepared issue is committed through the original workspace command transaction. The host retains the complete JSON issue and the exact outgoing offline HTML as separate original byte objects. The saved issue points to both files. Later editor changes do not regenerate an earlier outgoing file.

The issue time must be at least the selected saved workspace time. This prevents a newly issued snapshot from being presented as an earlier snapshot that did not yet contain its records.

## 2. Work in the field copy

Open the exact issued HTML on the colleague’s device. The copy carries the original issue bytes. Its fields use the selected original form and source metadata. Source identity and read-only fields remain available for inspection.

Edit the complete answers, geometry where enabled, attachments and field note. Source field types, subtype domains, original geometry dimensions and spatial reference, and the form’s attachment rules retain their original meanings. The product does not reproject geometry or infer a different original object from a reused ObjectID.

Save a named edition with the operator, time and useful label. Every named edition contains every issued inspection, and later editions point to the previous named edition. Changing the selected edition does not delete the other editions.

Unfinished work belongs in the separate working draft. It can retain empty, invalid or partially entered form text without pretending that those values are a valid saved inspection. Downloading and reopening the complete working file preserves the draft together with its saved editions and original sources.

New attachments retain their original name, media type, exact bytes and hash. Keep the complete file. The return format includes the full added-byte inventory, including attachments retained by earlier named editions or the unfinished working copy.

Download the complete HTML or JSON to hand the work back. The returned file contains the exact original issue bytes, every named edition, the explicit selected edition, unfinished draft and all added original byte members. A return with no named editions has a null selection and can still be retained as unfinished field work.

## 3. Receive the entire returned file

The existing host accepts the whole JSON or offline HTML export. It reads the inert JSON data from the HTML; importing a returned file does not execute that file’s scripts.

Before a receiving command commits, the application checks:

- The returned issue identity and exact original issue bytes.
- Every source and attachment byte member against its full byte length and hash.
- The complete ordered named-edition history and selected edition.
- The presence of every originally issued inspection in every named edition.
- Each saved answer, geometry and attachment against the original form and source model.
- The full unfinished draft within its separate allowance.
- Chronology: each named edition follows the original issue and its parent; receiving follows the issue and all retained editions.

The original workspace retains the complete incoming file and byte members, then records receiving in the same SQLite command/revision history as other Highway operations. An interruption uses the original retained request ID and full envelope. Replaying an accepted request returns its first result before checking the current revision.

An unfinished file is useful evidence. It is retained with its complete draft and files; it has no saved edition available for adoption. The colleague can continue that working copy and return a later complete file.

## 4. Review against current work

Select a retained return and an actual named edition from that file. The supervisor sees the issued, current and returned values for each original form field, complete geometry, complete added-attachment set and field note. The view also shows the original and current assignment, current inspection status and source assessment.

The comparison proposes ordinary three-way results:

| Situation | Proposed value |
| --- | --- |
| Only the colleague changed the issued value | Returned value |
| Only the current workspace changed it | Current value |
| Both changed it to the same value | That shared value |
| Both changed it differently | An explicit current/returned choice is required |
| Neither changed it | Current value |

Added attachments are reviewed as a complete set. When both sides change that set differently, the supervisor selects the current or returned set explicitly. The original files remain retained whichever set is selected.

If the current inspection uses a different form edition or source binding, the old return remains available as evidence. Keep the current inspection and issue its current form for continuing work. The application does not silently move old-schema answers onto a changed source record.

A later source capture can also make an otherwise unchanged inspection binding stale. Review the displayed source assessment. Adoption can preserve field observations as a draft; the original source-rebase and submission workflow remains responsible for reconciling changed provider records before approval.

## 5. Adopt selected observations

Make an apply or keep decision for every issued inspection and give a reason. For an apply decision, resolve every conflicting value. Optional explicit field choices can also choose the current or returned value where the automatic proposal is not the supervisor’s intended decision.

The entire decision binds the exact comparison hash and current workspace revision. If another operator changes the workspace, preserve the draft choices and review the new comparison before committing.

The adoption runs the original inspection commands:

- Draft or returned inspections use the existing inspection save.
- Submitted, approved or rejected inspections use the existing supervisor correction with the entered reason.
- Unchanged final values retain the existing inspection edition.
- Keep decisions preserve the current inspection and record the reason.

A changed observation becomes a draft. Earlier submissions, approvals and prepared proposals remain historical records, and the current inspection follows the original re-submission and supervisor-decision workflow. One atomic adoption records the complete decisions and all resulting inspection versions. A returned file has one completed adoption decision; retrying the exact original command recovers that decision.

Use the original dispatch, source refresh, submission, decision and proposal controls to continue the operating programme. Field-copy adoption does not perform an ArcGIS edit, mark an assignment complete, or dispatch an external message.

## 6. Export, receive and continue

The original complete workspace archive includes the field-exchange records, exact issued JSON/HTML, exact incoming HTML/JSON, every source/attachment byte, original commands and first results, and all saved states. The normal complete receiving path replays the same domain commands.

The original workspace genesis is unchanged. Workspaces created before this feature still receive through their original history. The optional fieldExchange section appears only when the first field command commits.

After independently receiving the complete workspace, open the issued and returned files, inspect their saved editions and unfinished text, reopen the current inspection, and make a deliberate later change in the received copy. Reopening an already received archive must preserve that later work. The original operating workspace and original native programme remain separate physical histories.

## Pure module API

The original storage layer supplies read_blob(sha256) returning exact bytes. All functions are deterministic. It owns persistence, the physical workspace and atomic revision/request handling.

### Issue preparation

prepare_issue(state, request, read_blob) returns the complete issued JSON object. The request has exactly:

~~~json
{
  "id": "original-issue-uuid",
  "recipient": {"id": "colleague-id", "name": "Colleague name"},
  "inspectionIds": ["saved-inspection-id"],
  "workspaceRevision": 24,
  "stateSha256": "complete-current-state-sha256",
  "note": "Actual field instructions",
  "actor": {"id": "supervisor-id", "name": "Supervisor name"},
  "at": "2026-10-13T16:00:00Z"
}
~~~

The host canonicalizes the returned object, retains its full bytes, calls initial_return(issue_bytes) for the exact initial working envelope, renders and retains the complete HTML, then executes:

~~~json
{
  "id": "original-issue-uuid",
  "document": {"sha256": "issued-json-sha256", "bytes": 12345},
  "html": {"sha256": "outgoing-html-sha256", "bytes": 23456}
}
~~~

That is the body of field.issue. Its actor/time match the prepared request. The native storage boundary also checks the prepared workspaceRevision against the original expectedRevision after request recovery and before dispatch.

### Returned-file preparation

parse_document(raw_bytes) reads whole JSON or one inert script with id highway-field-data and type application/json. For HTML, the JSON payload must escape literal closing-script text when rendered.

prepare_return(state, raw_bytes, read_blob) returns:

~~~text
{
  document: complete parsed returned document,
  issue: complete original issued document,
  blobs: {sha256: original Python bytes}
}
~~~

It validates all named editions and bytes before the host retains them. The host stores every complete member and the exact incoming file, then executes field.receive with body:

~~~json
{
  "id": "original-return-uuid",
  "issueId": "original-issue-uuid",
  "document": {"sha256": "exact-incoming-file-sha256", "bytes": 34567}
}
~~~

The command validates the same complete input again inside the original transaction. Receipt summaries include every named edition’s ID, label, operator and time, plus the selected edition and exact file descriptor. The full file is not copied into every state revision.

### Review and adoption

compare_return(state, return_id, read_blob, edition_id=None) produces the complete comparison. Omitting edition_id uses the return file’s explicit selected edition. Every actual selected edition must exist in the retained original file. The result includes its selectedEdition, complete items, current stateSha256 and comparison sha256.

field.adopt has this body:

~~~json
{
  "id": "original-adoption-uuid",
  "returnId": "original-return-uuid",
  "editionId": "actual-saved-edition-id",
  "reviewSha256": "complete-current-comparison-sha256",
  "items": [
    {
      "inspectionId": "saved-inspection-id",
      "action": "apply",
      "choices": {"answer:condition": "returned", "$note": "current"},
      "reason": "Actual supervisor decision"
    }
  ],
  "note": "Reason for this whole receiving decision"
}
~~~

Every item uses action apply or keep. Keep has an empty choices object. Field choice keys are answer: followed by the actual form key, $geometry, $attachments and $note. Values are current or returned. The module requires all conflicts to be resolved and rejects unknown fields. The caller retains the exact request and comparison until it obtains the first result.

read_document(state, "issues" or "returns", identity, read_blob) returns the retained record and complete parsed document. view(state, read_blob) returns only the issue/return/adoption summaries and limits for the ordinary application catalog.

## Whole-file capacities

| Population | Limit |
| --- | --- |
| Complete issue JSON, outgoing HTML or incoming JSON/HTML | 64 MiB each |
| Selected inspections per issue | 1,000 |
| Named editions per returned file | 1,000 |
| Separate unfinished draft | 4 MiB |
| Complete byte population | Original 256 MiB workspace allowance |
| Native state, commands and complete history | Existing workspace allowances |

The host measures both initial RETURN and complete outgoing HTML before committing the issue. Base64 and embedded application code count toward the complete file limit. Oversize input is rejected whole, with the previous saved state intact. Choose an appropriate complete source/inspection selection; do not truncate source pages, attachments, editions or history.

## Producing and receiving the actual application

Operate the exact outgoing version on the existing equipped host. Open its populated and empty views at desktop and narrow widths, use the actual issue/editor/return/conflict/adoption controls, and personally inspect the resulting rendered views. Download and open every outgoing HTML, JSON, attachment and full archive. Reopen the working draft, choose earlier named editions, inspect complete original source and attachment content, resolve a real concurrent edit, and verify the later received-copy change survives reopening.

The same receiving programme retains its actual host/process, original inputs, results and resource ownership. Source review and parser checks complement that operating work; the producing operator repairs actual layout, clipping, overflow, controls and downloaded-file problems in the maintained application.


## Complete owner instruction for the producing and receiving operator

Rendered product inspection — owner instruction, 2026-10-13
This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

