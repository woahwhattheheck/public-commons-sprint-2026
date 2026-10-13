# Highway field operations — operator handover

This application is the staff workflow for the Geocove Highway workshare: retained source editions, configurable collection forms, original asset inspections, supervisor correction, crew assignments, actual effort, proposals and complete editable receiving. It keeps the original paired dataset reconciliation product as the comparison and native report engine.

## What the current application does

A crew inspection begins from an actual captured source object. Each saved version retains its form edition, original object and global identities, full original attributes and geometry, added attachments, operator and time. Submission and supervisor decisions append history. A following source edition can be reviewed and rebased explicitly. Crew dispatch connects the same original inspection to the assignment and its closure.

An approved proposal is a local candidate edit. No command in this application writes to ArcGIS. Production target mapping, account permissions, actual edit requests and per-record results remain an agreed customer integration. Do not treat a proposal, a source capture or an inspection approval as a successful service update.

The published County service is:
https://gis.livingstoncountyny.gov/arcgis/rest/services/Highways/FeatureServer

Its current captured metadata must determine layer choices, IDs, domains, spatial reference and attachment behavior. The discovery metadata observed during implementation advertised no related tables, no sync, and no service-wide GlobalID applyEdits support; the Bridges layer did not advertise attachments. Those are observations of that service edition, not permanent assumptions about the customer's selected environment. Local field photos are retained in the handover.

## Open the application

Python 3.11 or later is sufficient for the staff application and read-only capture. The existing paired comparison engine separately requires its original DuckDB extra, version 1.5.6, and the unchanged source-delivery prerequisites in its operating guide. No external service account is needed to inspect a saved local staff workspace.

Keep the received complete source directory and its source-selection.json together. Every CLI entry checks the selected source files before opening the workspace.

Create a private parent directory, choose and retain one workspace UUID and creation timestamp, then run:

~~~sh
cd /absolute/source
python -m highway.cli --source-root /absolute/source init \
  --workspace /absolute/private/highway-workspace \
  --id ORIGINAL_WORKSPACE_UUID \
  --title 'Highway field operations' \
  --at ORIGINAL_ISO_TIMESTAMP
~~~

Use the actual saved values for uppercase placeholders. Repeating initialization with the same identity is supported; another title or creation identity is rejected.

Start the original local owner:

~~~sh
python -m highway.cli --source-root /absolute/source serve \
  --workspace /absolute/private/highway-workspace \
  --launch /absolute/private/highway-launch.json \
  --port 0
~~~

Open the private url from highway-launch.json in the browser. Its fragment grants access to that local workspace; keep it private. The browser removes the fragment from the visible address. The listener binds only to 127.0.0.1. Stop the original owner with Ctrl+C when done; it closes its listener and active handlers before the database closes.

Use the same browser profile while any saved request needs reconciliation.

## Receive an original source capture

Select only the advertised layer/table IDs relevant to the agreed workflow. Keep one capture UUID, operation UUID and output directory for the entire acquisition. Example for the published Bridges layer:

~~~sh
python -m highway.capture \
  --service https://gis.livingstoncountyny.gov/arcgis/rest/services/Highways/FeatureServer \
  --layers 0 --tables '' \
  --directory /absolute/private/captures/bridges \
  --operation-id ORIGINAL_CAPTURE_OPERATION_UUID \
  --capture-id ORIGINAL_CAPTURE_UUID
~~~

This reads metadata, ID and count inventories, full feature batches, attachment listings and available attachment bytes. It retains original request/result records and first response bodies. Final metadata, ID inventory and count observations make source changes and incomplete coverage visible.

A token, when actually needed for the selected source, comes from a named environment variable through --token-env. Do not put tokens in the saved service URL or a shared command file.

Read highway/CAPTURE.md for precise limits, provider deferrals and original-request recovery. An interrupted directory belongs to its original request; do not delete or relabel it to force a new attempt.

In Source editions, choose the complete capture folder and Import complete capture folder. Every manifest-declared file is verified before import. A source-only edition remains useful for inspection even when its coverage is incomplete; the UI does not label it complete.

The native CLI also supports import-capture with a retained request JSON containing expectedRevision and the complete capture.import command. The body is {"manifest": the exact original manifest}; source blobs are received before the atomic command.

## Configure forms and collect work

1. Set the actual operator name and reference in Source editions.
2. Open Collection forms. Choose the original layer and source fields. Labels can be readable while source field names remain exact.
3. Add local observations where needed. Local fields and photos are not assumed to be production GIS columns.
4. Choose required fields, read-only behavior, geometry permissions and local attachment limits. Save the form edition.
5. In Field inspections, select the form and actual source asset. Start or reopen its inspection.
6. Enter values using the original type and domain. Empty text and null are separate. The Null checkbox explicitly means no value.
7. Save the complete answers, notes, geometry and attachment set. Submit saved edition submits the saved version; unsaved changes must be saved first.
8. In Supervisor review, inspect original values, retain the reason and approve, return or reject the exact submission.

Editing a form creates a new edition under its stable key. Existing inspections keep their original edition. Coded-value choices follow the selected original subtype. Out-of-domain legacy values remain visible for review.

Date and coordinate values retain their original meanings. Geometry correction does not infer a reprojection. Source numeric integers must fit their published safe range; original raw bytes remain retained even when a value cannot be edited.

## Crew operations and follow-through

Create actual crews and members, then operating packages and assignments. Choose an original form/object for each assignment. Inspect asset opens an inspection under that assignment and links the original inspection back to it using retained requests. If the second step is interrupted, continue its saved original request.

Record actual effort separately from estimates. An erroneous effort entry can be retained and voided with a reason. Follow-up tasks carry a responsible person, due time and explicit status.

An assignment can move through planned, ready, in field, submitted, blocked, closed or canceled. Submission requires a linked submitted inspection; closure requires a current approved inspection. Reopening retains its earlier history. After an inspection is rebased, Refresh this assignment explicitly adopts its current source/form and clears the old closure.

Freeze an operating report to retain the complete current crew, package, assignment, effort and follow-up picture. Download the full report or its readable document.

## Review the next source edition

Import the new complete capture; do not overwrite the original. Existing inspections show their source assessment.

Open the inspection and review changed source fields, geometry, attachments and schema. Resolve only mapped field conflicts with Keep inspected value or Use current source value. Unmapped source fields remain retained in the capture. A renamed/removed field needs a compatible form revision.

Rebase creates a new draft. Save, submit and review the revised inspection before proposing it again. A GlobalID change cannot silently substitute a different asset that reused an ObjectID.

The Dataset reconciliation foundation compares actual imported source editions, native values and duplicate multiplicities, with explicit reviewed mappings. Its full operating guide and source remain included with the engine. Use its original import review, pair/run/decision/report and complete receiving APIs; this application does not create a second comparator.

## Save, receive and reopen the complete staff handover

Choose Handover & receiving → Prepare complete handover. The browser retains the intended saved revision and publication ID before sending. The immutable output includes all original states/commands/results/source blobs/publications through that edition, the full selected application source and a readable handover.

Download Highway_Field_Workspace.zip and retain its byte length and SHA-256 from the returned archive identity.

Inspect it:

~~~sh
python -m highway.cli --source-root /absolute/source inspect \
  --archive /absolute/private/Highway_Field_Workspace.zip \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --bytes ORIGINAL_ARCHIVE_BYTES
~~~

Receive it into a distinct named destination:

~~~sh
python -m highway.cli --source-root /absolute/source receive \
  --archive /absolute/private/Highway_Field_Workspace.zip \
  --directory /absolute/private/received-highway \
  --operation-id ORIGINAL_RECEIVING_UUID \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --bytes ORIGINAL_ARCHIVE_BYTES
~~~

Receiving validates the complete original history by replaying its pure business commands and comparing every resulting state and first result. It validates retained source and publication inventories, then atomically publishes the independent working directory. It performs no ArcGIS or external native effect while replaying.

The original receiving identity is repeatable. Later valid changes in the received workspace survive a repeated receive. Original states, command envelopes/results, publication records and source files must remain unchanged.

Change into the received source directory (`cd /absolute/private/received-highway/source`), then open the returned workspace directory with the serve command and `--source-root` pointing to that included source directory. Keep the original immutable ZIP separate from the later editable workspace.

Current staff package allowances are 64 MiB per source blob, 256 MiB total retained source, 72 MiB complete logical history, and 384 MiB complete archive. Exceeding a bound produces an explicit error before a nonportable saved change is committed.

## Recover requests and drafts

The browser saves each full command, actor, time, body, expected revision and request UUID in IndexedDB before POST. It saves the original native result before loading updated catalogs. Saved requests can inspect the original server record and continue the same request.

A restored successful request also reconciles its associated draft. Unchanged submitted values are cleared; later edits remain and require review against the confirmed revision. A workspace or record-version conflict does not overwrite another operator's work. Read the current values before using the current revision for the retained draft.

Exports and receiving have separate original IDs. Reuse their existing IDs and directories after an interruption. Preserve an unresolved provider/native operation and its original logs rather than assuming it failed before effect.

## Complete native and customer scope

The source package contains the staff application, field/domain validation, dispatch, read-only capture, command store, closed archive receiver, operator guide and selected original paired-engine source. The original commercial owner retains the Geocove relationship and production release decisions. Customer-specific service destination and supported offline configuration remain explicit implementation decisions.


## Original dataset comparison in the staff application

Install the included original Python package with its declared DuckDB extra, then start the staff application with the existing native warehouse:

```sh
cd /absolute/source
python -m pip install './vendor/original-paired/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[duckdb]'
python -m highway.cli --source-root "$PWD" serve --workspace /absolute/staff-workspace --paired-workspace /absolute/native-warehouse --launch /absolute/private-launch.json
```

Open **Dataset reconciliation**. Select a saved capture and form, then choose captured values or an actual approved proposal. Keep the explicit ObjectID mapping; the initial complete-feature JSON column retains every attribute and the original geometry. The original CSV handler creates the pages and original SF100 finalizer creates the complete report. Review its exact columns and source binding, then import that reviewed edition.

Select the two imported editions, review the key/value mappings and save the comparison definition at its actual current pair revision. Run that saved definition, inspect all grouped differences and row pages, and record review decisions against their original group or row numbers. Freeze the report after the intended review decisions, then export its complete native package. **Receive independent native workspace** restores that saved package without opening its old source warehouse. The whole Highway handover includes all of those complete retained files and original results.

Prepared deliveries and native requests retain their original IDs before effects. Continue those same entries after an interrupted response. If the native result completed while the staff revision advanced, inspect its retained result and explicitly associate it with the reviewed current staff revision. A retry never changes the original native request body.

The original paired engine's complete operator guide is `PAIRED_REVIEW.md`; the exact source producer and null/empty-text contract are in `ORIGINAL_LOCAL_DATASET_PRODUCER.md`.

## Named field copies and returned observations

Open **Field copies & returns** after creating the actual saved inspections. For an assignment, use its existing **Inspect asset** action first so the inspection carries that assignment's source identity. Set the actual operating person in **Source editions**.

1. Enter the colleague's name/reference, select the existing inspections and add field instructions. Choose **Prepare field JSON and editable HTML**. This freezes the complete selected inspection histories, form editions, source captures, attachment bytes and actual crew/assignment context. Download both original files from **Issued field copies**.
2. Give the editable HTML to the named colleague through the agreed delivery channel. It is self-contained and has no external script, account or network dependency. The JSON carries the same original issue. Keep the original files unchanged alongside subsequent returned files.
3. In the standalone editor, inspect the actual source and assignment, enter the observations and retain added files. Save an attributed named edition only when every selected inspection passes its original form rules. Incomplete fields and notes can still be downloaded as an unfinished file. Empty text and null remain separate.
4. The editor keeps a distinct working-copy identity. On reopening a different version of the same copy, inspect the saved device copy and incoming file and deliberately select the intended copy or create an independent one. A named edition remains immutable when later draft values change.
5. Back in **Field copies & returns**, choose the complete JSON or HTML and **Retain and receive selected file**. Intake retains the exact original returned file and all its attachment bytes; it does not apply observations. A return with no named edition is retained with its unfinished draft and cannot be adopted.
6. Select an actual named edition and choose **Compare with current inspections**. For every inspection, select **Keep current inspection** or **Apply reviewed field observations**, record the reason, and resolve every competing value. The screen shows the issued value, the current workspace value and the returned value separately, plus original/current assignment and actual source assessment.
7. A different current form or source binding requires keeping that inspection. Rebase or correct it through the ordinary saved inspection workflow and issue another field copy when appropriate. Matching source bindings can merge disjoint changes; an attachment-set conflict needs an explicit whole-set choice.
8. Choose **Save receiving decisions**. Changed observations become ordinary draft/corrected inspection editions, preserving earlier submissions and decisions. Continue normal save, submission and supervisor review before closing assignments or producing approved proposals.

A colleague's named edition is evidence of their field work, not a supervisor approval. The application does not write ArcGIS or provide an ArcGIS replica. Source coverage and advertised attachment/sync capabilities remain those of the actual retained source edition.

### Recover the same field request

The field screen retains the whole original command, expected revision, selected directory, person and time before dispatch. A selected returned file is also retained in full before upload. **Field request recovery** can continue that exact request or look up its original saved result. Reopening an old result settles only the draft still linked to that request; later observations remain for review.

An uncertain result keeps its original UUID. A new revised request is available only after a definite rejected response and an independent absence check; the original request remains visible. When the workspace advances, inspect the new values and deliberately select **Use the reviewed current workspace revision** or **Use this reviewed current comparison**. The old field copy and returned evidence are not rewritten.

### Complete onward receiving

The ordinary **Handover & receiving** archive carries every original issue JSON, issued editable HTML, returned JSON/HTML, added attachment, field command/result and subsequent inspection history in the existing flat blob inventory. There is no second field-work database. After cold receiving into a different directory, open **Field copies & returns** and use its original file downloads, named-edition comparison and normal inspection views. The received logical workspace ID remains the same; physical directory binding prevents an old request or local draft being applied to a different received branch.

A complete JSON or HTML field file must fit 64 MiB, including its embedded bytes and editor. The unfinished draft allowance is 4 MiB; complete named histories permit 1,000 editions and an issue can select at most 1,000 inspections. The full source objects remain subject to the existing 256 MiB workspace allowance. Issue publication and return intake preflight all new unique bytes before retaining a batch. Capacity failures keep the selected files intact; do not trim original evidence or silently omit source members.

The full business and file contracts are in [FIELD_EXCHANGE.md](FIELD_EXCHANGE.md).

### Native CLI over the original workspace

Change into the selected source directory before invoking the module. The original workspace owner must be closed before a separate CLI opens the same database. Use the authenticated SDK/HTTP API to borrow a running owner.

```sh
cd /absolute/source
python -m highway.cli --source-root /absolute/source issue-field \
  --workspace /absolute/private/highway \
  --request /absolute/private/issue-request.json \
  --json-output /absolute/private/Field_Issue.json \
  --html-output /absolute/private/Field_Issue.html

python -m highway.cli --source-root /absolute/source receive-field \
  --workspace /absolute/private/highway \
  --file /absolute/private/Returned_Field.html \
  --sha256 ORIGINAL_COMPLETE_FILE_SHA256 --bytes ORIGINAL_COMPLETE_FILE_BYTES \
  --request /absolute/private/receive-request.json

python -m highway.cli --source-root /absolute/source compare-field \
  --workspace /absolute/private/highway \
  --return-id ORIGINAL_RETURN_ID --edition-id SELECTED_NAMED_EDITION_ID

python -m highway.cli --source-root /absolute/source download-field \
  --workspace /absolute/private/highway --kind issues --id ORIGINAL_ISSUE_ID \
  --format html --output /absolute/private/Exact_Issued_Field.html
```

Replace placeholders with the retained actual IDs, hashes and full byte counts; do not mint replacement identities during retry. Output destinations are immutable: matching repeated output is reused, different bytes are rejected.

An issue request file is exactly:

```json
{
  "workspaceId": "ACTUAL_WORKSPACE_UUID",
  "workspaceDirectory": "/absolute/private/highway",
  "expectedRevision": 42,
  "request": {
    "id": "ORIGINAL_REQUEST_AND_ISSUE_UUID",
    "recipient": {"id": "ACTUAL_RECIPIENT_REFERENCE", "name": "Actual recipient"},
    "inspectionIds": ["ACTUAL_SAVED_INSPECTION_ID"],
    "workspaceRevision": 42,
    "stateSha256": "ACTUAL_STATE_SHA256",
    "note": "Actual field instructions",
    "actor": {"id": "ACTUAL_OPERATOR_REFERENCE", "name": "Actual operator"},
    "at": "ACTUAL_CANONICAL_UTC_TIME"
  }
}
```

The example is a shape, not executable business data. Read the actual current revision/hash and saved inspection IDs first. The issue UUID is also its command request UUID; actor/time remain fixed across its first attempt and retries.

A receive request uses the same four branch/revision envelope keys, with `command` instead of `request`. Its complete command is `{requestId,kind:"field.receive",actor,at,body:{id,issueId,document:{sha256,bytes}}}`; the document descriptor is the complete chosen JSON or HTML file. `retain-field` accepts the same file/hash/bytes without committing a field.receive command and returns its issue and edition identities.

Adoption uses the existing `command --request FILE` command with `{expectedRevision,command}`. The command body is the exact `field.adopt` contract in FIELD_EXCHANGE.md: original return ID, selected edition, complete current review hash and a decision for every issued inspection. It never invents a review hash or automatically chooses a conflicting field.

`download-field --kind returns --format original` retrieves the exact original returned format. `compare-field` with no edition ID uses the return's explicitly selected named edition. The same commands work after independent whole-workspace receiving against its actual new directory.

After decisions are saved, **Open original receiving comparison** reopens the exact original issued/current/returned review with its saved choices, reasons and original workspace revision. It is read-only; later inspection changes remain separate. The CLI equivalent is `compare-field --return-id ORIGINAL_RETURN_ID --adoption-id ORIGINAL_ADOPTION_ID`. This works after independent whole-workspace receiving because the full original states and files travel with the archive.


## Following field-exchange receiving on the retained case

The complete executable course is in [tools/FIELD_RECEIVING.md](tools/FIELD_RECEIVING.md). It operates the actual retained County inspection through issued HTML, unfinished drafts, named editions, attachment reopening, concurrent-copy recovery, explicit supervisor comparison/adoption and complete independent receiving. It uses the original programme lock and creates `field-exchange-following/staff-workspace` through the maintained full archive receiver. New business commands occur on that named physical branch; the original capture programme, input, journal and business revision remain available for their original continuation. Run the four selected course files together with this complete source selection and the actual original input and installed executables. The guide records the exact command, recovery procedure, output archive and rendered review instructions.
