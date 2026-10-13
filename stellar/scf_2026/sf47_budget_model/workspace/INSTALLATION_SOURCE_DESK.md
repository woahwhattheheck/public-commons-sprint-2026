# Prepare original source workshares in Grant Operations

The Source Preparation Desk turns complete original customer documents into the maintained Installation receiving package. Open an existing Grant Operations case, choose **Installations**, then **Prepare original source workshares**.

The desk retains the complete uploaded files, editable source selections, every saved revision, the native preparation outputs and the original request receipts. The last step opens a separate draft in the existing Installation editor. Save and receive that Installation through its original workflow.

A prepared or attached source package retains the original recorded scope and commercial status. It does not record a customer acceptance, payment, funded award, configured deployment or completed commissioning.

## What to have ready

Use the existing authorized operating case and its recording operator. In a managed workspace, sign in with the original owner link or a delivery-lead staff profile that includes that case. An enrolled lead's stable actor is recorded with every request. The existing staff case restrictions and read permissions also apply to source history, inspection and complete downloads. Bring the full original Workshare receiving packet and every complete document that supplies effort or other selected source context. For the original DealScout packet path, each packet must preserve the original `prepared_case.id` and `workshare_input.source.case_id`, with its complete `dealscout.workshare-plan.v1` plan. The native reader validates the plan and its original commercial currency.

For each phase, identify the exact JSON pointer that supplies its assigned effort, the original unit (hours or minutes), and an explanation of the mapping. Identify the original complete effort total as well. The total must equal every selected phase together. The desk never divides a price by an assumed rate to invent hours.

All source files are selected explicitly. A file's receiving filename, complete byte length, SHA-256, media type, source reference and observed time travel together. If the original filename contains characters outside the native receiving format, choose a distinct receiving filename with letters, numbers, dots, underscores or hyphens; the file's original content stays unchanged.


## Receive a complete saved delivery handover

A saved Delivery handover can enter this same desk directly. Retain its entire original JSON, including the `dealscout.delivery-handover.v1` snapshot, plus every original document supplying phase effort or the selected operating programme. Choose **Add original customer**, select **Whole original Workshare packet or saved handover**, and choose **Review original source and every phase**.

The installed `handover-inputs.py` checks the saved snapshot hash and its original case, Workshare, scope and delivery identities. The saved Workshare and board must select the same complete source and plan. Every delivery phase must retain its unchanged original Workshare phase and phase hash. The UI shows the original recorded completed/total phase count and exposes every original phase for source-backed effort mapping.

Keep the exact saved customer case ID and phase identities. To change those source facts, receive the corresponding original handover edition. Original receiving-packet phase amendments remain available for packet selections.

The first applied customer selects the draft's source format. Keep handovers and original receiving packets in separate named preparations; each uses its original complete native reader. One handover preparation can contain up to twenty customer cases, with different installed profiles and all original source files. The complete handover selection has schema `stellar-forge.installation-handover-selection.v1` and uses `handover` for each original file descriptor. Its remaining operation, request-prefix, profile, plan hash, phase effort and complete-total fields use the existing source-selection contract.

```json
{
  "caseId": "the-original-saved-customer-case",
  "profile": "the-selected-installed-profile",
  "handover": {
    "path": "Customer_Delivery_Handover.json",
    "filename": "Customer_Delivery_Handover.json",
    "bytes": 12345,
    "sha256": "the-original-64-hex-file-hash",
    "mediaType": "application/json",
    "sourceUrl": "https://the-original-source-reference",
    "observedAt": "2026-10-13T00:00:00Z"
  },
  "planSha256": "the-original-canonical-plan-hash",
  "productionEffort": ["every original phase mapping"],
  "effortTotal": {"hours": "40", "sourcePointer": "/quoted_hours", "sourceFile": "Original_Scope.json", "unit": "hours"},
  "files": ["every complete selected source descriptor"]
}
```

The example names are explanatory placeholders; select actual retained file identities and the full original mapping in the desk. The original native helper validates the whole plan through the maintained Workshare intake with its supported absent-packet argument. Its output contains all unchanged handovers and documents, complete commissioning inputs, `SUPPLIER_RECEIVING.json`, selection and preparation reports. These saved handovers already contain their complete Workshare inputs, so their native attachment carries the commissioning source and an absent receiving-packet reference through the existing optional-packet API.

**Prepare complete native package** pins both complete handover/source helper bodies and every selected profile. The same request, revision, create-only output and replay protections apply. The catalogue's additive `sourceFormats` field names each supported selection schema and complete engine receipt. Existing packet clients may continue using `engine`; handover clients select the matching `sourceFormats[].engine.sha256` for `expectedEngineSha256`. HTTP routes and terminal `command`, `inspect`, `preparation`, `output` and `export` commands are unchanged.

### Preserve an existing customer operating programme

In the customer mapping, expand **Existing customer calendar and operating programme** and select its original complete file names:

```json
{
  "schema": "stellar-forge.installation-customer-programme.v1",
  "calendarFile": "calendar-input.json",
  "selectionFile": "recurring-selection.json"
}
```

The same original contract also accepts optional `taskBudgetFile` and `nativeChangeFile`. Keep each selected file among this customer's complete supporting documents. The installed source helper checks the selected schemas and retains the whole programme in its original receiving input.

Opening a prepared Installation reads **that preparation's own immutable SOURCE_SELECTION.json**. A newer draft mapping cannot replace an older preparation's original customer, profile, bindings or programme. The desk reads every selected programme file through its saved output length/hash, then runs the maintained `composeCustomerProgramme` against the current native seed and full original commissioning source. Its exact calendar, source windows, commercial selections, complete task budget and original native editor change stay joined. The existing native preview/save validates the resulting Installation; the existing customer-use and commissioning desks own their operational observations.

The Installation review shows every selected task's UTC review, inclusive source start, exclusive source end and requested snapshot. **Download full prepared workorder** carries the complete programme in the JSON and its readable customer schedule in the workorder Markdown. The prepared source ZIP retains all original programme inputs and their receiving mapping.

If a retained native change belongs to a different Installation or conflicts with a later saved programme field, the maintained composer returns that exact conflict. Resolve it in the original Installation editor and select its complete updated change. Source preparation does not manufacture acceptance, payer status, funding or a successful provider result.

## Receive an original CanadaBuys Workshare package

A native CanadaBuys Workshare can enter this same desk through its complete prepared source package. Use the original CanadaBuys application to author or revise the Workshare. The installed `canadabuys prepare` command retains its complete exported application package and the separately authored party, milestone, effort and working-day mapping. See [CANADABUYS_NATIVE_WORKSHARES.md](../../sf49_data_commissioning/installation-workorders/CANADABUYS_NATIVE_WORKSHARES.md) for that full source preparation.

Package the resulting private directory without changing any of its five files:

```sh
starforge grant-installation-workorder canadabuys package \
  --source /absolute/private/canadabuys-source-preparation \
  --out /absolute/private/canadabuys-source-delivery/CanadaBuys_Source.zip \
  --python /absolute/python3
```

The output directory must be private to the current operator. This command verifies the complete original native package, every retained Workshare edition, the exact selected source row and the explicit operator mapping. It reruns the maintained deterministic preparation and requires every output to match the supplied bytes. An existing identical ZIP reopens; different output bytes are preserved and rejected.

The ZIP contains a `CANADABUYS_SOURCE_PACKAGE.json` manifest and these five complete originals:

| Member | Preserved source |
|---|---|
| `SOURCE_SELECTION.json` | Original complete operator mapping, including any selected Installation bindings |
| `CANADABUYS_NATIVE_WORKSHARES.json` | Native package binding, full Workshare history and selected editions |
| Original package filename | Complete byte-identical CanadaBuys application package |
| `SUPPLIER_RECEIVING.json` | Existing Installation receiving input |
| `SOURCE_PREPARATION.json` | Complete original native preparation result |

In an existing authorized case, create or open a source draft. Retain the whole ZIP in **Original files**, with its original reference and observation time. Save or retain any current edited fields before selecting **Receive native CanadaBuys source**.

The request uses the existing source-draft journal and revision guard. It binds the original ZIP bytes, both installed native reader modules and the current CanadaBuys profile. The receiver checks all six ZIP entries, every member digest and size, the complete original package and the deterministic five-file output. No partial source set is accepted. The selected ZIP and all five original files are retained in the existing draft's blob custody.

**Source mapping** shows the exact selected package and workspace, selected Workshare revision, explicit customer and supplier with their mapping basis, every original milestone allocation, separate production and partner effort, working-day dependencies, and original delivery/acceptance inputs. **Complete package** also shows the original native status, currency and exact cents, full Workshare history, selected source row and normalized Installation plan.

The native source selection is read-only in this view. To revise it, change the original Workshare or explicit mapping through the installed source workflow, then receive the next complete ZIP. The earlier original ZIP, selection, preparation and attachments remain in source-draft history.

Choose **Attach complete cohort to this case**, then **Open native Installation preparation**. The existing transaction attaches the complete source set and selects its real native commissioning and packet filenames. The Installation reader continues through the original Workshare seed. Any optional operating bindings come from that exact attached preparation and remain editable before the existing preview/save/receive workflow. Fresh seed identity, Workshare assignments, checks and payment controls remain those of the original engine.

A retained native status is a source fact. Receiving this package does not create a DealScout case, establish agreement or funding, select a payer, convert currency, dispatch payment or mark commissioning complete.

### Native package command and recovery

The same existing command endpoint accepts:

```json
{
  "requestId": "the-original-native-source-request",
  "expectedRevision": 3,
  "actor": "The recording operator",
  "note": "The reason for receiving this original package",
  "action": "native.receive",
  "data": {
    "fileId": "input-ORIGINAL64LOWERHEX",
    "expectedSha256": "ORIGINAL_COMPLETE_ZIP_SHA256",
    "expectedEngineSha256": "ORIGINAL_NATIVE_READER_SET_SHA256",
    "expectedProfileSha256": "ORIGINAL_CANADABUYS_PROFILE_SHA256"
  }
}
```

Use actual identities returned by the original file receipt and installed catalogue. `nativePackages` in the catalogue identifies the two-file native reader set and its profile. Retain the complete original request before submission. Response loss uses the existing request-status/read/retry controls, with no replacement request ID.

The received result remains `PREPARED_SOURCE` and adds `kind: canadabuys-native-workshare`, complete `nativeReview`, the original ZIP descriptor, and explicit commissioning/packet source roles. The selected source-file SHA is the original exact byte hash returned in `selectionSha256`; use that value for attachment.

The native source ZIP shares the existing 8 MiB upload limit. Its five complete source files each share the original 8 MiB bound, with a 64 MiB unpacked bound. Ordinary stored or deflated flat ZIP members are accepted; duplicate paths, additional members, encryption, special files, incomplete bytes and conflicting manifests are rejected. Existing draft storage and case attachment bounds continue to apply to the whole retained set.

## 1. Retain the complete original files

Name the source preparation and select **Create source preparation**. In **Original files**, choose a complete file, review its receiving filename and provenance, and select **Retain complete file**.

The browser saves the full request and upload bytes before the first network request. When the save succeeds, the server appends a source-draft revision. Each original file remains downloadable from every revision that selected it.

Use **Inspect JSON** to read the complete original JSON and the native selected plan. The numeric-value table is a navigation aid: it shows up to 2,000 exact values with their JSON pointers, while the complete original JSON remains available. Enter any supported pointer manually when the table does not include it.

Removing a file changes the next draft edition. Earlier editions retain their complete original bytes. To replace a receiving filename with a different edition, remove its current selection, retain the complete replacement, then reconcile any mappings that still name the earlier byte identity.

### Review and receive a complete source collection

The collection panel above the single-file form keeps a whole set of original documents together before native receiving. Open the intended current source preparation, choose **Start a separate collection**, and use the multiple-file selector to choose or add complete originals. Additional selections append to the collection. Starting another collection retains the preceding complete working copy before replacing its editor.

Name the collection and enter default source URL and observation time as useful starting values. Review each row's receiving filename, media type, source URL, observation time and include selection. Every row retains its complete original bytes and SHA-256, including excluded rows. **Download this original** returns those retained bytes. The existing single-file form remains available.

Choose **Review current collection** against the current saved source draft. The review checks the selected incoming files together with the current native selection: receiving names, supported metadata, total limits and exact original identities. It distinguishes an identical retained file from a name or content collision. Use **Use the retained identical file** only when you intend that explicit reuse; **Clear the existing-file choice** removes that choice so you can review it again. **Review original** keeps each row's original request and receiving history available. Correct the row metadata or inclusion choices and review again when the collection changes.

**Receive reviewed collection** records the reviewed originals sequentially through the existing Source Desk file requests. Each file gets its own original UUID and full durable request before dispatch, and each successful receipt produces its normal native source-draft revision. The collection is not one atomic native mutation: already recorded files remain recorded if a later file needs correction. All request IDs and prior results remain with their rows. A retained identical-file choice reuses that selected native file rather than replacing its original bytes.

Use **Recover and receive remaining originals** to reconcile an interrupted collection in the same source draft. The desk retains the original pending body and actor, reads its original native status, adopts an existing receipt or retries the same unrecorded request before moving on. Another pending desk request must be reconciled first. A deliberately retired rejected request stays in history; after correcting and reviewing its row, the next attempt receives a new UUID without changing the rejected original. The existing source request status, retry and rejection controls remain available.

**Pause after current file** remains usable while receiving. It lets the active original request finish its durable receipt and stops before another row starts; it does not cancel or replace an in-flight request. Closing or reloading retains the whole collection and its request inventory through the Source Desk's existing per-window working-copy storage and conflict handling.

**Download complete collection and working copy** remains available during receiving and when browser persistence fails. Reopen that complete JSON through **Open complete working-copy JSON** in its original operating case, plan and installation. The receiver checks every retained collection file and request link before adopting its fields, and preserves the preceding complete editor. **Download collection inventory** is a report of the collection and its receiving history; use the complete working-copy download for editable recovery.

A collection allows up to 10,000 rows and 64 MiB of staged original bytes across all rows, including excluded files. Each original must contain at least one byte and fit the existing 8 MiB file limit. Native limits still apply independently: 64 MiB of selected draft inputs, 256 MiB of retained draft blobs and 10,000 saved draft revisions. The collection never truncates a file, silently chooses a colliding name or changes an earlier source edition.

## 2. Map the whole customer scope

Open **Source mapping** and choose **Add original customer**. Select the retained packet and the installed receiving profile, then choose **Review complete packet and phases**.

The desk shows every native phase, its owner, dependencies, description and acceptance terms. For each phase:

1. Enter its exact assigned hours as decimal text.
2. Choose whether the value belongs to the selected plan or to a complete supporting file.
3. Enter its exact JSON pointer and original hours/minutes unit.
4. Explain why that original value is assigned to the phase.

A pointer into the selected plan starts at that plan's root. A pointer into a supporting file starts at the whole file's root. Include every supporting file named by an effort pointer in **Whole supporting documents**.

Map the original complete effort total. Choose **Apply complete mapping to selection** when every phase is accounted for. Repeat for the remaining original customer cases. One preparation can select one to twenty complete cases, with their independently selected profiles.

The complete native selection is always available as editable JSON below the guided fields. This includes all original source metadata, phase effort selections and optional profile bindings. Changes in either editor are retained in the browser; **Save complete selection** commits a new native revision.

### Explicit phase-ID amendments

Some original packets require an already reviewed phase-ID/dependency amendment before the maintained native Workshare reader can accept them. Expand **Explicit original phase-ID amendment** and supply the complete `phaseIdAmendment` object:

```json
{
  "mapping": {"old-phase-id": "selected-phase-id"},
  "reason": "The actual reason for the selected phase-ID amendment",
  "sourceUrl": "The original amendment source reference",
  "selectedFilename": "Selected_Receiving_Packet.json"
}
```

Review the packet again after editing the amendment. The original helper changes only the declared phase IDs and matching dependency references, checks that reversing those changes reproduces the entire original object, and publishes a separately named selected packet. The original packet remains a distinct complete file. The desk displays the full amendment receipt and obtains the selected plan hash from that native inspection.

This control is not a general plan editor. Commercial terms, customer identity, phase content, effort and original source bytes remain those of the supplied documents.

### Concurrent draft changes

The complete customer mapping, raw selection and Installation binding fields retain the saved revision from which they were edited. If another operator advances that draft, the desk preserves both the current saved selection and the earlier edited fields. Review both before choosing **Keep edited mapping against this reviewed revision**. That explicit reconciliation is retained in the browser working download. A subsequent save still uses native revision comparison.

Opening another draft or saved revision asks before replacing unsaved forms. A pending original request must be recovered before its draft or revision can be replaced.

## 3. Prepare and download the complete package

Choose **Prepare complete native package** after saving the source mapping. The request pins the whole selection, the installed original helper and every selected profile SHA-256. The desk verifies the actual returned profile set against those same pins before accepting the native outputs.

The original `source-inputs.py` creates the receiving package. The output includes:

| File | Complete content |
|---|---|
| `SOURCE_SELECTION.json` | The complete selected source mapping |
| Every selected original file | Exact original bytes and original receiving filenames |
| Any selected amended packet | The separately named native phase-ID amendment and original receipt |
| `Supplier_Workshare_Commissioning.json` | All selected Workshares, original effort pointers and source identities |
| `Supplier_Complete_Receiving_Packets.json` | The whole selected native receiving packets |
| `SUPPLIER_RECEIVING.json` | The complete original Installation receiving input |
| `SOURCE_PREPARATION.json` | The native preparation report, source/profile pins and output receipts |

**Complete package** shows each full output, its byte count and SHA-256. Download individual files or **Download whole source and receiving ZIP**. The ZIP also contains the desk's complete preparation manifest. Browser downloads are published only after the actual received length and full SHA-256 match their selected receipts. An interrupted direct file writer is aborted; the same original file remains available for another verified download.

The native preparation directory is deterministic for the original draft and request. If a response or the enclosing database transaction is interrupted after files were written, retry the same request. The original frozen preparation time, source selection and create-only outputs are checked and reused.

## 4. Attach the whole cohort and prepare an Installation

Select **Attach complete cohort to this case**. The desk compares the current native Operations case version and preflights the complete source count and byte capacity. It records all needed original sources and the attachment receipt in one existing workspace transaction. Exact sources already present may be reused. If the complete cohort will not fit, no partial attachment is accepted.

Choose **Open native Installation preparation** or open the **Installation** step. Select an original Workshare from the complete attached inventory and an installed profile. **Read original profile binding template** uses the maintained Workshare seed and `bindingTemplate` implementation.

Enter actual known operating selections:

- The original merchant deployment and independent customer deployments, selected from the case's recorded deployments.
- The receiving host, operator, exact source reference and source-use authority.
- The selected payment network, asset, recipient and authority.
- Exact atomic price and budget values, and a whole task count when those are actually selected.

Use the complete binding JSON for the rest of the native profile fields. Missing deployment or operating information remains an explicit outstanding selection. Record any new actual deployment through the existing Operations editor.

Choose **Review complete native Installation**. The desk invokes the original profile preparation and native Installation preview, checking the complete document and source version. It lists the profile selections still required and exposes the full installed profile and native preview.

**Open complete Installation draft** creates a separate original editor draft while keeping any earlier Installation draft. The new draft contains the entire selected Workshare, assignments, acceptance checks and operating bindings. Review and save it through the original Installation editor. The source desk checks browser draft persistence before treating the handoff as complete.

Download the whole prepared workorder JSON and human-readable Markdown from the source desk when a recipient needs the complete original scope before native receiving.

## Original request recovery

A source mutation has one original request ID and complete body. Keep them together throughout response loss, reconnection and replay.

| Desk state | Operator action |
|---|---|
| Original request retained, response unknown | **Read original request status** |
| Not recorded and no definite rejection | **Retry exact original request** |
| Recorded original receipt available | **Adopt recorded original receipt** |
| Definite validation/conflict rejection and an actual not-recorded read | **Keep rejected request and reconcile fields** |
| Saved result, later list/case read failed | Refresh the saved original case; the successful POST remains recorded |
| Browser persistence unavailable | Keep the open session and download the complete working fields; recover storage before leaving |

A retry uses the exact original actor, note, request ID, expected revision and payload, including full upload bytes. It never generates a replacement request to hide an uncertain outcome. Native request replay precedes current revision comparison, so a saved request returns its original receipt even after later edits.

The complete working download contains the selected saved edition, raw edited selection, whole customer form, profile bindings and original pending request. It is a recovery document for that original case; it is not a request to create a different case or overwrite a newer edition.

## Saved history and workspace ownership

**Saved history** opens an exact draft revision. Its source files and prepared packages keep their own identities. Current draft revisions, Operations case versions and native Installation revisions are separate concurrency controls.

The desk uses the existing SF47 workspace SQLite connection, mutex and transaction journal. It does not create another business database. Accepted server work keeps its original handler and workspace ownership even if the browser disconnects.

Stop the workspace's running server before using the terminal interface against the same directory. The original workspace lease prevents simultaneous independent server and CLI writers. A normal CLI result is reported only after the selected operation, complete output publication and original workspace close finish.

## Terminal operation

The installed distribution exposes `grant-installation-source-desk`. It launches the same Python entry point and forwards the original command arguments. Select Python with `SF47_PYTHON` or put `--python /absolute/python3` before the command's other arguments. Python 3 is required; no package installation or second workspace is created by this bridge.

```sh
starforge grant-installation-source-desk --python /absolute/python3 \
  --workspace /absolute/existing/workspace \
  --out /absolute/results/installed-profiles.json profiles
```

The complete source terminal entry point is beside the existing workspace server:

```text
stellar/scf_2026/sf47_budget_model/workspace/installation-source-desk.py
```

It requires an existing canonical workspace containing `planning.sqlite3`. Supply the original saved scenario path when the workspace was opened with a non-default scenario. Each command writes a full create-only result to an existing output directory.

```sh
python3 installation-source-desk.py \
  --workspace /absolute/existing/workspace \
  --case operation-ORIGINAL32LOWERHEX \
  --out /absolute/results/source-drafts.json list

python3 installation-source-desk.py \
  --workspace /absolute/existing/workspace \
  --out /absolute/results/installed-profiles.json profiles

python3 installation-source-desk.py \
  --workspace /absolute/existing/workspace \
  --case operation-ORIGINAL32LOWERHEX \
  --out /absolute/results/source-revision.json \
  read --draft source-desk-ORIGINAL32LOWERHEX --revision 3
```

Replace the displayed identity placeholders with the original IDs returned by your workspace. Keep each complete command request in a file before sending:

```sh
python3 installation-source-desk.py \
  --workspace /absolute/existing/workspace \
  --case operation-ORIGINAL32LOWERHEX \
  --out /absolute/results/original-command-result.json \
  command --draft source-desk-ORIGINAL32LOWERHEX \
  --request /absolute/requests/original-request.json
```

Supported actions use one envelope:

```json
{
  "requestId": "the-original-request-id",
  "expectedRevision": 3,
  "actor": "The recording operator",
  "note": "The actual reason for this change",
  "action": "selection.save",
  "data": {"selection": {}}
}
```

The displayed empty selection is a schema illustration; provide the complete native selection produced by the desk or original source helper.

| Action | Complete `data` fields |
|---|---|
| `create` | `title`; expected revision is zero and a distinct source-draft ID is selected |
| `file.add` | `filename,mediaType,sourceUrl,observedAt,bytes,sha256,contentBase64` |
| `file.remove` | `fileId` from the current draft |
| `selection.save` | Complete `selection` object |
| `prepare` | `expectedEngineSha256,expectedSelectionSha256,expectedProfiles` |
| `native.receive` | `fileId,expectedSha256,expectedEngineSha256,expectedProfileSha256` |
| `attach` | `preparationId,expectedSelectionSha256,expectedVersion` |

The preparation request's selection hash is the canonical compact JSON hash used by the original workspace. The returned preparation's `selectionSha256` identifies its exact retained, formatted source-selection file; use that returned value for attachment. Do not exchange those two distinct identities.

Read original request status before retiring an uncertain request:

```sh
python3 installation-source-desk.py \
  --workspace /absolute/existing/workspace \
  --case operation-ORIGINAL32LOWERHEX \
  --out /absolute/results/original-request-status.json \
  status --draft source-desk-ORIGINAL32LOWERHEX \
  --request-id the-original-request-id
```

`inspect` reads a selected original JSON file; `--amendment` can select a complete explicit phase amendment file. `preparation` returns the whole preparation manifest. `file`, `output` and `export` require the original expected SHA-256 and write the full binary output. Existing byte-identical output paths reopen successfully; a different existing file is preserved and rejected.

```sh
python3 installation-source-desk.py \
  --workspace /absolute/existing/workspace \
  --case operation-ORIGINAL32LOWERHEX \
  --out /absolute/results/complete-preparation.zip \
  export --draft source-desk-ORIGINAL32LOWERHEX \
  --preparation preparation-ORIGINAL64LOWERHEX \
  --expected-sha256 ORIGINAL_COMPLETE_ARCHIVE_SHA256
```

Before a first terminal ZIP download, use `archive-description --draft SOURCE_DRAFT --preparation PREPARATION_ID` with the same global workspace/case options and a distinct `--out` JSON path. It derives the complete native ZIP identity without publishing the ZIP. Use that returned SHA with `export`. The HTTP archive descriptor or a prior complete ZIP receipt supplies the same identity. Terminal errors return an interrupted result and nonzero exit; any already-recorded original request remains recoverable with its unchanged request file.

## Maintained HTTP interface

The routes use the existing workspace's owner bearer or named staff session, CSRF protection, origin/host checks, body reader, error format and handler lifetime. Source preparation changes remain delivery-lead operations in the selected case. The global installed-profile catalogue and read-only packet inspection use the existing non-contributor read policy; the case selection is checked before any retained source is read. The browser passes its AbortSignal through the actual staff-session fetch, including complete response-body downloads. All IDs below are actual original IDs, and all file reads remain bound to complete receipts.

Base: `/api/operations/{caseId}/installation-sources`

| Method and suffix | Result |
|---|---|
| GET base | Complete source-draft list |
| GET `/{draftId}?revision=N` | Full selected draft revision |
| POST `/{draftId}` | One exact source command and complete receipt |
| GET `/{draftId}/requests/{requestId}` | Original request status and retained result |
| GET `/{draftId}/files/{fileId}?revision=N&expectedSha256=SHA` | Complete original bytes |
| GET `/{draftId}/files/{fileId}/inspect?revision=N` | Complete original JSON and native inspection |
| POST `/{draftId}/files/{fileId}/inspect` | Read-only inspection of `{revision,phaseIdAmendment}` |
| GET `/{draftId}/preparations/{preparationId}` | Complete preparation and all output receipts |
| GET `/{draftId}/preparations/{preparationId}/outputs/{filename}?expectedSha256=SHA` | One complete prepared output |
| GET `/{draftId}/preparations/{preparationId}/archive?describe=1` | Complete ZIP identity |
| GET `/{draftId}/preparations/{preparationId}/archive?expectedSha256=SHA` | Whole prepared ZIP |

`GET /api/operations/installation-source-profiles` returns the installed helper identity and every currently installed profile's complete JSON and source hash. The catalogue is dynamic; this desk does not maintain a second hardcoded profile list. Its `nativePackages` entries also expose the original complete native package reader set and applicable profile.

## Bounds and complete receiving

The maintained limits are 8 MiB per original file, 64 MiB of selected draft inputs, 256 MiB of retained draft blobs, 192 MiB per full prepared ZIP, 100 preparations per draft, 10,000 saved draft revisions, and 200 source drafts per Operations case. A native case can retain at most 24 MiB and 200 complete sources. Larger work must select an appropriate complete original operation; the desk does not truncate documents or attach an arbitrary prefix.

The adjoining receiving programme accepts an explicitly selected original operating workspace, original source selection and complete source directory. It retains their identities, exercises the real Source Desk and Installation APIs, closes and reopens the original owners, verifies full downloads and saved history, and uses the same browser flow at desktop and phone widths when the actual declared browser runtime is supplied. Its report distinguishes source preparation from Installation receiving. A source review or successful package preparation alone is never reported as completed native commissioning.

### Run the complete original-case receiving programme

Use the existing case and the complete original source selection from its owner. Stop that workspace's managed server through its original control before starting the receiver. The programme holds its own private receiving lease and borrows the selected workspace through its existing exclusive lease. It does not bypass either owner.

```sh
python3 installation-source-desk-receiving.py \
  --directory /absolute/private/source-desk-receiving \
  --workspace /absolute/existing/workspace \
  --case operation-ORIGINAL32LOWERHEX \
  --expected-case-version ORIGINAL_CASE_VERSION \
  --selection /absolute/original/SOURCE_SELECTION.json \
  --source-root /absolute/original/complete-files \
  --scenario /absolute/original/sf10_current_candidate.json \
  --actor "The actual recording operator" \
  --operation-id SCF-INSTALLATION-SOURCE-DESK-2769-20261012 \
  --node /absolute/node \
  --browser-module /absolute/playwright/index.js \
  --browser-executable /absolute/chrome-headless-shell
```

Every placeholder must be replaced by the original selected identity or actual runtime path. Select a distinct private receiving directory outside the case and its original source input directory. A retry keeps that same directory, operation ID, starting case version, files, source mapping and runtime selection. It reconciles the original requests and completed phases before advancing. A source or runtime change requires explicit reconciliation of the original operation.

The 15 connected stages retain the actual original case, prepare the complete customer cohort, read and verify every native output, attach all sources atomically, replay the original request, use the terminal reader, prepare the selected native Installation, perform the actual browser flow, export the entire operating case, restore a full SQLite backup and reopen the original workspace. The browser retains exact draft/form and request state between attempts, keeps its original loopback origin, and captures the principal customer screens at 1440-pixel and 390-pixel widths. A multi-file workorder download must supply each expected filename once and the complete expected set.

`report.json` includes the original source/runtime selection, every completed phase, exact mutation requests, artifact lengths and SHA-256 values, and the actual lifetime outcome. The complete browser report is a separately bound artifact. The original API case ZIP and complete SQLite backup remain distinct outputs. Receiving success is reported only after all owned browser processes, HTTP handlers, SQLite connections and workspace leases have closed.

The managed launch source selection now covers this complete desk, its CLI and receiving programme, the unchanged native source helper and profile engine, and every profile present in the selected installed edition. Newer staff, accounting and commercial workflows stay part of the same original source selection. A changed installed profile or helper is a changed launch/source selection and must be reviewed through the existing launcher.

Keep actual receiving reports and private customer/workspace packages with the original operation's artifact delivery. The repository contains the generic implementation, guide and receiving programme.

## Retain and reopen the complete source working copy

The Source Desk keeps a complete editable working copy alongside the original native draft editions. **Download complete working fields** includes the selected source draft and historical edition, raw mapping and binding JSON even when unfinished, every customer mapping and programme field, upload metadata and the full bytes of the selected original file, change note, preparation name, source inspections, original profile seed and preview, commissioning selections and archive fields, reconciliation history, and the complete retained original request inventory. This download remains available when local browser storage fails. It is an editable copy of the desk; the native original-file, prepared-package and case exports retain their existing independent formats and checks.

Use **Open complete working-copy JSON** to receive that whole editor in the same original operating case, selected plan and installation identity. The receiver validates its scope, source-file bytes and request identities before replacing any fields. It first downloads the preceding complete editor as a `-working-before-open.json` file, and also retains a separate local copy when storage is available. UTF-8 decoding is strict; an optional leading BOM is accepted for the JSON envelope. Complete working-copy files may be up to 512 MiB; original selected files and native package limits are unchanged. Opening a copy preserves its raw JSON and selected source IDs without replacing missing original choices with the first current option.

Each window owns a distinct local copy. A reload opens this window's last committed copy into a new owned copy; a duplicated tab therefore cannot overwrite the first tab's record. **Refresh saved copies**, **Open selected local copy** and **Save as separate local copy** provide explicit navigation among retained copies. Every save compares the complete copy's original sequence in one IndexedDB transaction. A conflicting save retains a separate copy when possible and keeps the complete current editor downloadable; it does not overwrite a newer local record. Preceding mapping, source, file and profile selections are retained before deliberate replacement. Unfinished guided values, including invalid whole-number input, remain visible and downloadable until corrected.

Local copy keys and reopen pointers use the established installation and named-operator scope. **Open earlier original local copy** explicitly receives the older unscoped Source Desk journal. It does not automatically open another operator's earlier desk. The receiving programme selects this action only for its already retained original browser draft, validates its original pending UUID and complete request bytes, and retains the preceding download before continuing the same original operation. A named operator must match the pending request's original recording actor before retry; the installed owner retains the existing owner actor semantics. No actor, case, request UUID or original request body is rewritten during import.

The native pending-request journal remains authoritative for mutation recovery. Complete copies carry all their original requests and any recorded receipts; importing an older unresolved copy cannot erase an already recorded result. A received pending request stays selected until the existing request-status/recovery controls reconcile its original native receipt. A local storage failure permits complete download and explicit reopening, but a native mutation still requires its original request to be durably retained before dispatch. Saved historical source editions stay immutable; if the current native head advanced, the editor keeps its original source basis and exposes the existing explicit mapping reconciliation.

The original-case receiving programme compares complete native Workshare effort by exact decimal value, so summed hours such as `3` match an original declared `3.0`. It retains all original source strings and file bytes unchanged.
