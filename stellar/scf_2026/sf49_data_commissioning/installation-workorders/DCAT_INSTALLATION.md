# DCAT catalogue commissioning and complete Installation receiving

Use one complete retained catalogue workspace to commission a customer's catalogue workflow through the original Grant Operations Installation. The catalogue application retains its own original data, reviews, releases, semantic runs, correction editions and recipient decisions. The Installation retains the actual Workshare, funded plan, deployments, accountable operators and observed acceptance.

The preparation desk reads retained source and history through the original archive receiver. Grant Operations remains the writer for Installation Preview, Save and observed acceptance. New catalogue conversion, semantic execution, release selection and payments continue through their existing operations.

## Work the customer is commissioning

Start from the actual customer task: receiving a complete publisher catalogue, reviewing a new edition against its predecessor, repairing selected metadata, resolving a recipient's proposed corrections, publishing an explicitly accepted release, or maintaining that workflow for an agreed period. Record the useful output, recurrence and source authority in the original Workshare and Installation bindings.

The source analyst remains responsible for the selected catalogue, profile and field meanings. A semantic reviewer chooses the retained JSON-LD context, base IRI, shapes, inference and target interpretation and records a deliberate decision. A catalogue operator chooses which correction revision or materialized candidate proceeds to migration review and which eligible candidate becomes a release. The commissioning operator records what the independent recipient actually installed, used and received. None of these roles silently substitutes for another.

A commercial professional fee belongs to the original Workshare. Existing funded assignments belong to the selected grant plan. Any actual per-request service price, network, asset and budget remain explicit original payment selections. Do not divide a quoted professional fee into service units or count the same work twice. The preparer preserves original phases, hours, milestones, assignments and OPEN checks.

## Open the installed preparation desk

Select **DCAT catalogue Installation** in the original Applications console, review its selected private preparation directory and installed source, then use the original Save and Start controls. The installed selection is **dcat-installation** and includes the catalogue application, Grant Operations and this preparation desk.

The equivalent installed command is:

~~~sh
starforge dcat-installation serve --directory /absolute/private/catalogue-commissioning
~~~

Use one private preparation directory outside the installed source and outside any catalogue project. The returned listener is local to the selected host and supplies its own instance, process, directory and authenticated opening URL. Keep that credential in the private host/browser context. The preparation service owns its retained input files, request history and output documents; it does not acquire the active catalogue project's operation owner.

The browser opens **Catalogue commissioning**. Its three working sections retain complete inputs, select the catalogue work and complete customer bindings. Prepared files and the original request history stay below them. Browser, command and agent clients can use the same preparation directory. The service takes the existing cross-process lock for each write operation and retains immutable receipts. If another operation is busy, retain the original request UUID and retry it. Completed results and original file reads remain available concurrently. Stop a managed Application through its original selected process instance when that process actually needs to close.

## Select the complete original workspace

Export the full .ckanw from the original catalogue application's Workspace transfer controls or its maintained command. A downloaded catalogue, migration report, semantic artifact or recipient HTML alone is not a complete native workspace.

~~~sh
starforge dcat archive --workspace "$DCAT_WORKSPACE" \
  --out "$PRIVATE_INPUT/Complete_Catalogue_Workspace.ckanw"

starforge dcat inspect-archive \
  --file "$PRIVATE_INPUT/Complete_Catalogue_Workspace.ckanw" \
  --sha256 "$ORIGINAL_ARCHIVE_SHA256"
~~~

When an existing browser or managed Application already owns the project, export through that owner. Do not open a second native project lease. The original merchant tools also provide workspace archive, inspect and retained-file reading; download every byte and verify the descriptor returned by that original owner.

Retain the whole original archive, its actual byte count and SHA-256, its project creation identity and source kind. A mixed CKAN/DCAT workspace remains mixed. All original CKAN captures, source declarations, publications and remote-source history remain in the complete archive, even when the commissioned scope concerns a DCAT catalogue.

The selected Installation scope is an explicit interpretation of that retained edition. It does not filter, shorten or rewrite the archive. Historical and unselected catalogues, reports, native jobs, profiles, reviews, corrections, recipient proposals and operation history remain independently available.

## Keep the evidence meanings separate

| Retained original selection | What it establishes |
| --- | --- |
| Catalogue ID and complete document hash | The exact original or materialized document selected for the task |
| Migration review and full report hash | The original converter, schema, field-change and record-conservation outcome for its exact source, candidate and comparison |
| Release ID and selected candidate hash | An actual saved release selection and its original rollback history |
| Semantic profile and run | The original reviewed context, base, shapes, parameters, native graph, findings, coverage and runtime outcome |
| Saved semantic comparison | The exact ordered snapshot pair, complete graph changes and selected impact scope |
| Attributed semantic or comparison decision | That operator's recorded decision about the bound result; it does not create a release |
| Correction draft and revision hash | An exact saved editable document with its original attribution and ordered edit history |
| Issued recipient package, returned edition and adoption decision | The actual issued source, complete return and author's explicitly selected reconciliation |
| Installation Preview, Save and observed checks | The original Operations writer's case-bound commissioning record and actual accountable observations |

A native semantic run can complete while its result is nonconforming or its shapes are invalid. Class counts and an empty graph are explicit observations; a true conformance result alone does not prove complete SHACL target coverage. A limited-impact comparison can retain a complete graph difference while its neighborhood expansion is truncated. Preserve these distinctions in the selected evidence and every report.

A corrections-needed migration report can legitimately retain no candidate. It is still useful evidence. It cannot be described as a releasable candidate, and a materialized correction is still a retained document until the original review and release operations are completed.

## Attach the archive to the original operating case

Attach the complete selected archive through the original Operations **attach-dcat** action. Supply its actual SHA-256, the current case version, a stable request ID, the recording operator and the observed source time:

~~~sh
python3 "$OPERATIONS_CLI" operations --workspace "$OPERATIONS_WORKSPACE" \
  attach-dcat --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --file "$PRIVATE_INPUT/Complete_Catalogue_Workspace.ckanw" \
  --expected-sha256 "$ORIGINAL_ARCHIVE_SHA256" \
  --observed-at "$SOURCE_OBSERVED_AT" \
  --actor "$RECORDING_OPERATOR" --request-id "$ARCHIVE_ATTACH_REQUEST" \
  --note "$SOURCE_AUTHORITY_NOTE"
~~~

Use the actual case/version returned by the original writer. Retain its source record ID and exact archive bytes/hash. The action validates the entire gzip/frame stream, manifest, paths, member lengths and hashes before retaining the original source and its transport descriptor in the existing case history. The catalogue receiver performs the separate domain-level interpretation used by the preparation desk.

The supported complete-source capacities are:

| Original case content | Capacity |
| --- | --- |
| One attached .ckanw archive | 128 MiB compressed |
| All DCAT archive attachments in one case | 256 MiB compressed in total |
| Ordinary source attachment, including selected scope JSON | 8 MiB per file; 24 MiB in total |
| Complete Operations case ZIP with verified DCAT sources | 320 MiB |
| Complete ordinary Operations case ZIP | 32 MiB |
| Source attachments in a case | Original 200-source bound |

The general catalogue archive reader retains its existing expanded-byte and member bounds. Preparation preserves the whole original archive and all its members. If a complete input exceeds a supported limit, retain that input and address its capacity through the maintained product; do not substitute a reduced document under its identity. The complete-case Operations export/import supports the larger DCAT case. Older report-specific export wrappers retain their own existing bounds.

## Obtain the original Workshare seed and complete case

The existing Grant Operations case is the authority for customer source IDs, current version, pinned funding plan and Workshare. Use its original source-attachment and Workshare commands; preserve the full returned documents.

For a fresh PLANNED Installation, the original commands are:

~~~sh
python3 "$OPERATIONS_CLI" operations --workspace "$OPERATIONS_WORKSPACE" \
  installation-workshares --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --source "$WORKSHARE_SOURCE_ID" --expected-source-sha256 "$WORKSHARE_SOURCE_SHA256" \
  --packet-source "$WORKSHARE_PACKET_ID" --expected-packet-sha256 "$WORKSHARE_PACKET_SHA256" \
  --output "$PRIVATE_INPUT/original-workshares.json"

python3 "$OPERATIONS_CLI" operations --workspace "$OPERATIONS_WORKSPACE" \
  installation-workshare-seed --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --source "$WORKSHARE_SOURCE_ID" --expected-source-sha256 "$WORKSHARE_SOURCE_SHA256" \
  --packet-source "$WORKSHARE_PACKET_ID" --expected-packet-sha256 "$WORKSHARE_PACKET_SHA256" \
  --workshare-case "$COMMERCIAL_CASE_ID" --expected-revision 0 \
  --output "$PRIVATE_INPUT/original-seed.json"

python3 "$OPERATIONS_CLI" operations --workspace "$OPERATIONS_WORKSPACE" \
  show --case "$CASE_ID" --output "$PRIVATE_INPUT/original-case.json"
~~~

A source attachment advances the native case version. Read the current case and obtain a fresh Workshare seed after attaching the archive; repeat that refresh after attaching the selected scope. The preparation binds the complete case, seed, plan and Workshare identities to the same current version.

The maintained workorder core accepts a fresh seed with stage PLANNED, no existing Installation ID and OPEN checks without fabricated work, purchase or outcome references. Continue an already saved Installation through its original current draft and source-refresh workflow, preserving its stage, observations and original requests.

## Inspect every retained source and choose the scope

In **1. Retain complete inputs**, retain the archive as **Complete catalogue archive**, the complete case as **Current operating case**, and the original seed as **Original Installation seed**. Each completed import returns an immutable file identity, byte count and SHA-256. Select **Inspect complete catalogue**, then **Prepare scope and bindings**.

Inspection uses the original complete archive receiver in the preparation's private subtree. It checks the retained original workbench and all archive members and records the original creation identity, source kind, manifest and source digest. Reopening the same inspection retains that original edition even if the receiving project later has valid local changes.

The source report groups every original record into these families:

| Family | Retained selection |
| --- | --- |
| Catalogue | Complete original or materialized document and its identity |
| Migration review | Complete review metadata, source/candidate bindings and report |
| Release | Saved selection of a reviewed candidate and release history |
| Source and acquisition | Publisher configuration, versions, actual request/response history and received catalogue |
| Correction and correction revision | Saved editable draft, exact revision document, ordered edits and attribution |
| Recipient issue, proposal and decision | Issued package, complete received proposal and saved author reconciliation |
| Semantic profile, run and review | Complete retained context/shapes/profile, original native result/artifacts and attributed decision |
| Semantic comparison and comparison review | Ordered saved snapshots, full comparison/impact evidence and attributed decision |

Select **2. Select the work to commission**. Filter by family or search title, identity and state; page through all matching records. Open a record's complete metadata, relationships and original files. **Every original archive file** separately lists all manifest members, including files outside the selected DCAT record families. Its full-file downloads verify the original selected member identity.

Every record must appear exactly once in the scope with one decision and a nonblank purpose:

- **Include in commissioned work** identifies work the selected customer task will use or deliver.
- **Retain as context** keeps historical or supporting material available with an explanation of its relevance.

The bulk control applies its decision and purpose to **all matching records**, including matching records on later pages. Refine the filter before applying it, then inspect individual rows. At least one record must be included. The complete original archive remains intact for both choices.

Enter the actual case source ID for the complete archive. The template fills this automatically only when exactly one case attachment matches its full bytes and SHA-256. When there are multiple matching attachments, choose the actual intended original source record explicitly.

Download **complete selected scope** as Selected_Dcat_Scope.json. This document binds the full source digest, archive source ID/bytes/hash and each record's identity/hash, decision and purpose.

## Attach the scope and refresh the current case

Attach the exact downloaded scope JSON as an ordinary original case source:

~~~sh
python3 "$OPERATIONS_CLI" operations --workspace "$OPERATIONS_WORKSPACE" \
  attach --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --file "$PRIVATE_INPUT/Selected_Dcat_Scope.json" \
  --kind other --media-type application/json \
  --observed-at "$SCOPE_OBSERVED_AT" \
  --actor "$RECORDING_OPERATOR" --request-id "$SCOPE_ATTACH_REQUEST" \
  --note "$COMMISSIONED_SCOPE_NOTE"
~~~

Retain the returned scope source ID and new case version. Read the complete current case and obtain its fresh Workshare seed using the original commands above. Retain both refreshed files in the preparation desk and choose **Prepare scope and bindings** again.

Leave **Carry current choices into a refreshed template for the same case and catalogue** selected to preserve your current customer bindings and record decisions. Carry-forward requires the same actual case, Workshare and complete source digest; record decisions also require the same individual record hash. The new template retains the fresh case/version/plan selection. Check the archive source ID again when its matching attachment was ambiguous.

The complete selected scope must still have the exact bytes attached to the native case. A change to a purpose, inclusion choice or archive source ID creates a different scope document: attach that complete edition and refresh the case and seed again. The preparer verifies the selected scope's bytes and SHA against the actual attached source; a filename or similar-looking JSON document is insufficient.

Enter the actual scope attachment ID in **Original case source ID for the selected scope file**. Preparation adds the full archive and scope source IDs to the Installation's original source and receiving bindings.

## Fill actual operator bindings

Use the complete template created from the actual selected seed and installed DCAT profile. Preserve its case/version/plan digests and Workshare case identity.

Select the actual source authority, complete attached source IDs, merchant deployment, independent buyer deployment where applicable, receiving host, named operator and intended useful task. Use original configuration references instead of placing credentials in a workorder. Leave unselected numeric values null and atomic monetary values as exact strings.

Keep the recurring task grounded in the original source cadence and agreed service. A one-time public GSA source example does not establish a customer's recurring schedule or paid demand. The actual completed original GSA migration contains 344 records; a newly acquired GSA catalogue has its own actual bytes and count and must not be assumed identical.

## Prepare the complete Installation and retain the files

Choose **Prepare complete Installation** after completing the scope, current customer bindings and actual scope source ID. The desk retains the selected scope and bindings as complete immutable input files, then binds those inputs to the original inspection, case and seed. A template or preparation request also retains its complete selected Installation profile; retrying that original request after an installed profile upgrade uses its original profile.

The complete result includes:

| File | Use |
| --- | --- |
| Original .ckanw archive | Whole editable source, all history and every native member |
| Original case, seed, scope and bindings | Exact inputs to this preparation |
| Original_Installation_Profile.json | Complete technical profile selected by the original request |
| installation-input.json | Complete document for the original Installation Preview and Save |
| installation-preview-input.json | Prepared original preview input and case selection |
| WORKORDER.md | Readable complete workorder using the original Workshare and bindings |
| Dcat_Installation_Scope.json | Selected catalogue work and the bound source identities |
| Dcat_Complete_Source_Report.json | Complete source report, original manifest and all projected record metadata |
| Dcat_Complete_Source_Report.html | Readable full source report and, after preparation, selected scope |
| preparation.json | Complete original preparation result |

Download the actual files from **Prepared work and complete files**. A prepared result can identify customer selections still requiring completion in the original case. The complete native Installation document retains the original 128 KiB limit; its full catalogue archive and detailed source history remain separate supporting source files.

### Recover a stopped preparation

The desk retains a stable request before dispatch and exposes **Reconcile and continue** after an uncertain reply. Continue that exact request with its original input file identities. For an interrupted original upload, select the same full file; the retained byte count and SHA-256 must match before continuation. The request history allows reopening completed results with their original case, seed, scope, bindings and inspection.

Browser working state is retained privately in IndexedDB. **Download complete editor draft** preserves the current scope, bindings, unfinished field text, field validity and request selection; **Open editor draft** restores that working selection. Keep a downloaded draft for transfer or recovery when browser storage may be unavailable. Invalid unfinished facilitator JSON or an incomplete task count remains editable and blocks preparation until corrected.

**Retain request and start a new draft** leaves the original request in history. Use a new request only for deliberately changed inputs. Native Operations attachment and Installation Save requests keep their own original identities and are reconciled through that original writer.

## Native preview and save remain authoritative

Load the complete prepared installation-input.json in **Customer installations → Load input file**. Review the selected source, whole Workshare, technical task, deployments, payments, receiving responsibilities, funded assignments and original OPEN checks.

The existing equivalent commands are:

~~~sh
python3 "$OPERATIONS_CLI" operations --workspace "$OPERATIONS_WORKSPACE" \
  installation-preview --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --expected-revision 0 \
  --document "$PREPARED/installation-input.json" \
  --output "$PREPARED/native-preview.json"

python3 "$OPERATIONS_CLI" operations --workspace "$OPERATIONS_WORKSPACE" \
  installation-save --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --expected-revision 0 \
  --document "$PREPARED/installation-input.json" \
  --expected-preview-sha256 "$NATIVE_PREVIEW_SHA256" \
  --actor "$RECORDING_OPERATOR" --request-id "$ORIGINAL_SAVE_REQUEST" \
  --note "$INSTALLATION_REASON"
~~~

The original preview resolves real source, deployment, payment and funded-plan references. Record the returned Installation ID, revision, document digest and case version. An uncertain response is reconciled through that original request. Do not allocate a replacement save request because a browser, agent or transport stopped receiving its reply.

A changed source scope or different customer binding requires an explicit new preparation edition and a fresh native preview. A completed preparation or prior Installation is retained unchanged. New observations are recorded through the original Installation checks after the named operator actually completes the work.

## Installed command and merchant-agent operation

The command interface uses the same retained preparation service as the browser. Each mutation has its own stable UUID, and imported file IDs are the complete 64-character identities returned by that service. An inspection ID is its original request UUID.

~~~sh
starforge dcat-installation import --directory "$PREPARATION_DIRECTORY" \
  --request "$ARCHIVE_IMPORT_REQUEST" --kind archive \
  --file "$PRIVATE_INPUT/Complete_Catalogue_Workspace.ckanw" \
  --sha256 "$ORIGINAL_ARCHIVE_SHA256"

starforge dcat-installation inspect --directory "$PREPARATION_DIRECTORY" \
  --request "$INSPECTION_REQUEST" --archive "$ARCHIVE_FILE_ID"

starforge dcat-installation import --directory "$PREPARATION_DIRECTORY" \
  --request "$CASE_IMPORT_REQUEST" --kind case \
  --file "$PRIVATE_INPUT/original-case.json" --sha256 "$CASE_FILE_SHA256"

starforge dcat-installation import --directory "$PREPARATION_DIRECTORY" \
  --request "$SEED_IMPORT_REQUEST" --kind seed \
  --file "$PRIVATE_INPUT/original-seed.json" --sha256 "$SEED_FILE_SHA256"

starforge dcat-installation template --directory "$PREPARATION_DIRECTORY" \
  --request "$TEMPLATE_REQUEST" --inspection "$INSPECTION_REQUEST" \
  --case "$CASE_FILE_ID" --seed "$SEED_FILE_ID"
~~~

Export the complete template selection/bindings using their returned file IDs and hashes. Edit the complete scope and bindings, attach the scope in the native case, then refresh and import the current case and seed as described above. Import the exact final selection and bindings using kinds selection and bindings. Prepare with those actual immutable IDs:

~~~sh
starforge dcat-installation prepare --directory "$PREPARATION_DIRECTORY" \
  --request "$PREPARE_REQUEST" --inspection "$INSPECTION_REQUEST" \
  --case "$CURRENT_CASE_FILE_ID" --seed "$CURRENT_SEED_FILE_ID" \
  --bindings "$BINDINGS_FILE_ID" --selection "$SELECTION_FILE_ID" \
  --selection-source "$SCOPE_SOURCE_ID"

starforge dcat-installation get --directory "$PREPARATION_DIRECTORY" \
  --request "$PREPARE_REQUEST"

starforge dcat-installation files --directory "$PREPARATION_DIRECTORY" \
  --request "$PREPARE_REQUEST"

starforge dcat-installation export --directory "$PREPARATION_DIRECTORY" \
  --file-id "$RETURNED_FILE_ID" --sha256 "$RETURNED_FILE_SHA256" \
  --out "$PRIVATE_DELIVERY/installation-input.json"

starforge dcat-installation list --directory "$PREPARATION_DIRECTORY" \
  --offset 0 --limit 50
~~~

Follow every returned next offset in request history. File export checks the selected complete file's hash and streams all bytes into the private output. Use its actual returned filename for each export; the example above selects the Installation document.

A merchant host can configure named preparation roots and private input aliases through the optional installations configuration. Input kinds are archive, case, seed, bindings and selection. The preparation tools use those host-selected aliases; they do not invent arbitrary host paths or require an open CKAN model.

All tool names below have the prefix **merchant_ckan_dcat_installation_**:

| Suffix | Complete operation |
| --- | --- |
| aliases | Discover the host's named preparation directories |
| open / close | Open the selected preparation owner; close binds its returned instanceId |
| inputs | Page configured private input aliases |
| import | Retain a complete input using requestId, input alias and expectedSha256 |
| inspect | Bind the retained archiveId to the original inspection request |
| template | Bind inspectionId and current caseId/seedId |
| prepare | Bind those original IDs plus bindingsId, selectionId and actual selectionSourceId |
| requests | Page the complete retained request history |
| get | Read the selected result and its metadata/file identities |
| metadata_read | Read the complete original result using expectedSha256 and the returned readId/offset |
| files | Page all files belonging to the selected request |
| file | Select a retained fileId or an original source member by inspectionId and path |
| file_read / file_release | Read the complete hash-bound file through the original retained handle, then release it |

Agent list pages accept up to 100 rows. Large metadata is explicitly DOWNLOAD_REQUIRED with the complete metadata descriptor, and complete metadata/file reads continue to the returned terminal offset. Keep the returned readId, expected hash and exact next offset together. A preparation response supplies its own request/file identities; Installation Preview/Save remains the original Operations action.

## Receive both complete working applications

The recipient needs the whole catalogue workspace and the whole original Operations Installation export. An HTML source report is useful for reading, but it does not replace either working application.

Receive the selected .ckanw through receiveCkanWorkspaceArchive or the maintained dcat receive command into a distinct private project. The original receiver validates the complete manifest, restores every selected native member and binds the same receiving marker. Repeating the same original receive reopens the recorded received project; it must preserve later valid recipient edits.

For this complete-source workflow, export the **whole original Operations case**, which retains the Installation editions and the complete attached catalogue archive:

~~~sh
python3 "$OPERATIONS_CLI" operations --workspace "$OPERATIONS_WORKSPACE" \
  export --case "$CASE_ID" --expected-version "$CURRENT_CASE_VERSION" \
  --output "$PRIVATE_DELIVERY/Complete_Operations_Case.zip"

python3 "$OPERATIONS_CLI" operations --workspace "$RECEIVING_OPERATIONS_WORKSPACE" \
  import --file "$PRIVATE_DELIVERY/Complete_Operations_Case.zip" \
  --name "$RECEIVED_CASE_NAME" --actor "$RECEIVING_OPERATOR" \
  --request-id "$ORIGINAL_CASE_RECEIVE_REQUEST"
~~~

Retain the sender's actual archive byte count/SHA-256 and verify the received complete file before importing. The original importer validates all retained sources, exact DCAT transport descriptors and original case/history bindings. Record the actual received case ID and continue its original request after an uncertain response.

Open the exact saved Installation edition in that received case:

~~~sh
python3 "$OPERATIONS_CLI" operations --workspace "$RECEIVING_OPERATIONS_WORKSPACE" \
  installation-show --case "$RECEIVED_CASE_ID" \
  --installation "$ORIGINAL_INSTALLATION_ID" --revision "$ORIGINAL_INSTALLATION_REVISION" \
  --output "$PRIVATE_DELIVERY/received-installation.json"
~~~

Verify that fixed Installation revision and all required source attachments. Later valid recipient edits can advance the current head while the original imported revision remains available.

Close the original owners using their maintained lifecycle, reopen the independent projects and read the complete received catalogue, evidence, correction/recipient history and Installation. Download every selected original member and complete reports from the received applications. Record an actual useful local change only through the appropriate original native workflow, then export a following complete handover that preserves the earlier source and origin.

## Continue the saved Installation through the receiving programme

The [complete receiving course](DCAT_INSTALLATION_RECEIVING.md) consumes the actual completed preparation request and the saved native Installation ID/revision. Its private input selects the original Operations case, independent receiving directories, actual Python executable and optional existing browser runtime.

~~~sh
starforge dcat-installation-receive --input /absolute/private/receiving.json
~~~

The course retains every original preparation file and archive member, exports the selected Installation with its whole original case, verifies those complete bytes through the original reader, and receives both applications independently. It checks the fixed saved Installation and all bound sources again after cold reopening. When browser participation was selected, the same programme operates the actual preparation desk and retains its complete downloads and desktop/narrow images. Follow the linked guide's exact private input and same-request continuation; producing-operator image and attachment inspection remains an explicit part of delivery.

## Runtime and managed Applications

Report-only inspection and receiving use retained source and history. Running a new migration or semantic operation requires the selected original runtime.

For original GSA migration, select the maintained Python 3.13 environment, or explicitly use the documented portable-python312 profile with its unchanged pinned requirements. For semantic validation and comparison, use the original semantic runtime prepare/inspect/transfer commands. An offline transfer contains the complete selected source and locked wheels; the recipient prepares its own private environment at its final stable path. A sender's virtual environment is not portable source.

The existing **DCAT catalog workspace** Application binds the actual receiving project, installed source and selected private runtime environment. The Grant Operations Application opens its separately selected received Operations case. Use original Review → Save → Start/reopen behavior and retain the actual startup identity. Do not save bearer URLs in public workorders or reports.

## Local HTTP continuation

The browser and configured service use one authenticated local listener. The complete source is exposed only through that listener's existing private authentication.

| Route | Original request or result |
| --- | --- |
| GET /api/launch | Listener instance, process and preparation-directory identity |
| PUT /api/import | Raw whole file; query binds requestId, kind, name, bytes and sha256 |
| POST /api/inspect | requestId and archiveId |
| POST /api/template | requestId, inspectionId, caseId and seedId |
| POST /api/prepare | Those IDs plus bindingsId, selectionId and selectionSourceId |
| GET /api/requests | Paged retained request history |
| GET /api/requests/:id | Complete original request/result or retained pending request |
| GET /api/files/:fileId | Complete retained input or output |
| GET /api/sources/:inspectionId/file?path=... | Complete original archive member selected from its original manifest |

The preparation owner drains accepted calls during close. A completed download is emitted only after its original byte count and SHA-256 have been checked on the same open file. An interrupted transfer remains incomplete and can be requested again using its retained identity.

The original Operations endpoint for a full catalogue attachment is the authenticated POST /api/operations/:case/dcat-source. It uses the same expectedVersion, requestId, actor, note and source fields as attach-dcat and forces the original dcat-source.add action. Use the normal source action for the selected scope JSON.

## Source state and actual customer use

The installation integration is an authored product capability. The original completed GSA migration and its retained artifacts are executed evidence from that original operation. Later semantic, comparison, correction and recipient customer programmes have their own actual outcomes; source publication does not manufacture their completion.

Use the same original equipped receiving operation and its existing accepted worker. Preserve its current source, project, request and output identities. Do not rerun an accepted converter, create another customer case or start a competing controller to make a missing result appear.

## Rendered product and all outgoing attachments

This requirement applies to every current, resumed and delegated worker. Before presenting a client/prospect-facing application, report, demo or attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and use it as a recipient would. View the actual screenshots captured. Operate the relevant desktop/screenshare and narrow/mobile widths, important controls and populated, empty, loading and error states. Download and reopen complete exports. Open the usable contents of every ZIP/project, source document, report and applicable PDF page.

Source inspection, schemas, HTTP success, DOM counts, automated checks and another worker's approval do not substitute for this actual use. Repair unreadable, clipped, overflowing or broken output directly. Keep the industrial interface readable, with clear labels, tables and restrained controls. Do not replace implementation with repeated checklists or a new approval queue.

For produced video/audio, use available high-quality generative voice/TTS where appropriate, then actually watch/listen to the final export, including timing, pronunciation and attachment context. Generated images must not pretend to be a functioning application.

Carry these instructions in the original receiving assignment. Native unavailability means the same existing equipped receiver gets the exact source and opening steps; it does not justify claiming a viewed product. The operating source remains useful while its actual runtime and customer outcome are pending.
