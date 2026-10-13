# Runtime operating procedures

Runtime operating procedures keep recurring installation, application, backup and receiving work together with the exact Runtime records selected by an operator. Open the existing Runtime workspace and choose **Operating procedures**.

A procedure uses the maintained Operating Plan and Operating Plan Return formats. Its steps, carried files and saved revisions remain editable through the same plan engine used by the other Starforge products. Runtime adds complete selected source captures, their original identities and collection times, attributable observations, and the results of explicit returned-work review.

The procedure pane records work. Use the existing Runtime, Applications, Managed releases, Python, Source builds, transfer and backup controls when you intend to run an operation.

## Start with the current workspace

The procedure list belongs to the open private Runtime workspace. Confirm the workspace identity and directory before creating or receiving a procedure. Switching to a different capability or workspace clears the visible selection; a retained request stays bound to the workspace in which it was created.

Choose **New procedure** for work you are preparing locally. Give it a customer or team, an accountable owner, a useful result and a recurrence or trigger. Record the instructions that another operator will need to continue: source prerequisites, expected output, where to deliver it and how to recognize completion.

Use the editable fields and **Add operating step** to prepare the work. **Save next original revision** appends through the original engine. An operating step can retain instructions, inputs, expected output, owner, due date in YYYY-MM-DD form, status and an operator-written result. Complete original deliverable files may be attached where the underlying Operating Plan permits them. Select the actual file bytes; a filename or a browser preview does not carry its contents.

## Select Runtime source records

Choose the exact saved Runtime records relevant to the procedure. A capture retains the selected original responses and identities, with its collection time. These observations describe what the selected workspace returned at that time. They do not replace current readiness checks, prove that a process is still running, or change the operator's written assessment.

Captured source is deliberately selected. A procedure does not collect unrelated runtime homes, customer directories or the contents of an external binding. When a selected backup or source archive is represented by its identity, digest and native download reference, obtain the complete archive through the existing source transfer or Workspace backup controls. Keep that complete archive with the procedure when an independent recipient will need it.

A complete procedure download preserves its source captures. Review the full selected records before sharing it outside the workspace; source paths, operation inputs and customer details are part of those originals.

## Edit and save revisions

Choose the procedure and revision you want to inspect. Earlier revisions remain available. Loading earlier content for editing should create a new revision against the retained current history, preserving every later revision already present.

Edit the purpose and step fields, including the accountable owner and any useful change notes in the plan, then choose Save next original revision. A save uses the selected procedure's current record identity and revision. If another operator has changed the procedure, keep your draft and reopen the current record before preparing another save.

The browser retains each exact request in IndexedDB before dispatch, under its original workspace and request ID. **Open retained browser requests** lists earlier requests, including requests deliberately set aside or already returned. The browser keeps draft identities separate for each editor session. A lost response can therefore be reconciled with its original request ID and complete input. Do not change the input of that retained request. Use **Continue retained request** to learn whether it was accepted; make a different request only after preserving and resolving the original.

Drafts and pending requests belong to their original workspace and procedure. Browser storage is a convenience; download the complete procedure and any unsent draft you need to preserve. If the browser cannot retain a required request, resolve its storage error before dispatching it.

## Record actual observations

Select the exact step and the original records that support the observation. Name the recording operator and explain what was observed, including uncertainty or incomplete work.

A current process observation can be unavailable even while earlier saved output remains readable. Keep the observation error and original saved result visible. A null or unavailable liveness observation does not mean that an operation completed, failed or stopped.

Refreshing the source choices does not rewrite step status or the operator's result. **Record selected originals and assessment** explicitly saves the named operator, selected step status and recorded result together with the complete source selection. Review those fields before recording; a capture does not decide the assessment for you. Do not infer a successful deployment, paid invoice, grant outcome or customer acceptance solely from a saved plan, source capture or download.

## Review returned work

Open the complete returned Operating Plan or Runtime procedure file. The original engine compares its shared history, current content and returned changes. Read the review before applying it.

Where the histories diverge, choose the appropriate value for each conflict. Review changed instructions, step assessment, deliverable files and source references. Applying the returned work records the review and creates the engine's normal next revision; it preserves the prior local and returned histories.

A source capture taken in another Runtime workspace remains attributable to that original workspace and collection time. Receiving it does not attach its runtimes, start its applications, restore its backups or adopt its external directories. Use the corresponding existing controls after separately reviewing those originals.

## Deliver and receive the complete procedure

Download the complete editable JSON and readable HTML from the selected procedure. Keep the JSON as the receiving input: it carries the original plan history, Runtime captures and return-review records. Readable HTML helps a recipient inspect and discuss the work.

The procedure JSON is the full Runtime record. **Download original Operating Plan** exports the exact generic plan format for use in the original standalone editor; **Download plan HTML** renders it through the maintained plan renderer. A receiving operator opens the original file in their selected private Runtime workspace, inspects its identity and contents, and explicitly receives it. A returned edition of an existing procedure goes through the original return comparison; an unrelated existing procedure is never overwritten to make the import fit.

After receiving, reopen the saved procedure from the list and verify its original history, captures and files. Use the native Runtime controls for any subsequent installation, application launch, archive restore or binding review. Those controls keep their existing request identities, kernel leases and readiness checks.

## Backup and recovery

Workspace backup includes the procedure's private records as part of the selected original Runtime workspace. Follow the Workspace backup guide for the complete reviewed archive, exact original destination, external binding review and explicit reopening.

The procedure's own complete JSON is useful for independent handoff and continued editing without restoring the entire Runtime workspace. It does not contain unrelated Runtime files or implicitly supply an external runtime home.

If a save or receiving action is interrupted, retain the original request, source file and selected procedure. Reconcile the original request before making another. Each carried file retains its complete bytes within the original 24 MiB file limit. The complete plan and Runtime record retain their respective backend capacity checks; complete Runtime records and incoming JSON are bounded at 256 MiB, with a 257 MiB request envelope. The original Operating Plan remains bounded at 32 MiB. A returned review can contain both complete local and returned histories; its capacity follows the original return engine. If a full source capture exceeds the product's documented capacity, select a smaller complete group of records or deliver the complete archive through its native transfer; shortening source JSON to a preview would change the evidence.

## Installed command and complete request files

The original installed entry remains `starforge runtime-workspace`. Procedure commands use that same selected private workspace:

~~~sh
starforge runtime-workspace procedure-state \
  --workspace /absolute/private/runtime-workspace

starforge runtime-workspace procedure-open \
  --workspace /absolute/private/runtime-workspace \
  --procedure-id ORIGINAL_PROCEDURE_ID
~~~

The state lists the saved procedures and actual selectable Runtime source. The open command returns the full record and its `recordSha256`. Retain both before preparing a change.

Every mutation takes one complete JSON request file through `--request`. Generate the request UUID once, save the whole file, then keep that exact request for recovery. The command names are:

| Command | Complete request contents |
| --- | --- |
| procedure-create | requestId, title, customer, owner, period, purpose and explicit source selection |
| procedure-save | requestId, procedureId, expectedSha256 and the original complete OperatingPlanDraft |
| procedure-record | requestId, procedureId, expectedSha256, stepId, status, recordedResult, owner and source selection |
| procedure-return | requestId, procedureId, expectedSha256, the complete incoming OperatingPlan, reviewer and notes |
| procedure-decide | requestId, procedureId, expectedSha256, reviewId, comparison key and decision (or null to remove it) |
| procedure-apply | requestId, procedureId, expectedSha256 and the reviewed reviewId |
| procedure-receive | requestId and the complete original Runtime procedure record as document |

An explicit selection is `{runtimeIds:[],operationIds:[],archiveIds:[],backupOperationIds:[],storageDirectory?:string}`. Use the actual IDs from the state response. An empty list selects no records of that kind. The optional storage directory selects the existing backup store; its original records and download contracts remain authoritative.

For example, run a previously retained complete creation or save request:

~~~sh
starforge runtime-workspace procedure-create \
  --workspace /absolute/private/runtime-workspace \
  --request /absolute/private/requests/create-procedure.json

starforge runtime-workspace procedure-save \
  --workspace /absolute/private/runtime-workspace \
  --request /absolute/private/requests/save-procedure-revision.json
~~~

A save request's draft keeps the original `schema`, `planId`, `baseRevision` and complete `content`. Keep command registrations and carried files while editing the fields you intend to change. The model checks the complete original draft and current record identity before writing.

Capture is a deliberate record action. Its request identifies the selected saved step and the named operator's assessment. A decision uses the original return comparison key and one of `current`, `incoming`, `base` or `custom`; a custom decision includes its complete JSON value. Refresh the record identity after each accepted decision before preparing another distinct request. An uncertain accepted request is retried with its original identity and exact bytes.

Export to a new ordinary file:

~~~sh
starforge runtime-workspace procedure-export \
  --workspace /absolute/private/runtime-workspace \
  --procedure-id ORIGINAL_PROCEDURE_ID \
  --format json --output /absolute/private/delivery/runtime-procedure.json
~~~

The other formats are `html`, `plan-json` and `plan-html`. Full Runtime JSON carries the customer record, original plan, captures and reviewed-return history. Plan JSON carries the original generic Operating Plan, including its complete revisions and carried files.

For independent receiving, create one request file containing its retained `requestId` and the entire downloaded JSON object as `document`, then run:

~~~sh
starforge runtime-workspace procedure-receive \
  --workspace /absolute/private/receiving-runtime-workspace \
  --request /absolute/private/requests/receive-complete-procedure.json
~~~

The original receive request is retained with the received history. An identical request can be reconciled after later edits. A later independent edition of the same procedure is reviewed through the original return path; receiving does not silently replace a divergent local history.


## Source and operating validation

The [complete native receiving course](receiving/RUNTIME_PROCEDURES_RECEIVE.md) exercises the original API and CLI with three independent workspaces, a real returned-work conflict, retained requests, complete JSON/HTML handovers and exact continuation. Its [manual driver](receiving/RUNTIME_PROCEDURES_RECEIVE.mjs) stays outside the default test and CI paths.

This workflow composes the existing Operating Plan, Operating Plan Return and Runtime Workspace implementations. Native operating commands remain owned by their original modules. The new adapter records and returns selected source and operator work under the workspace's existing write coordination.

The source review and native operating course are separate. Report a completed native or browser journey only from its actual returned output. Preserve the original Runtime operating case and its selected IDs when the existing receiving course resumes.
