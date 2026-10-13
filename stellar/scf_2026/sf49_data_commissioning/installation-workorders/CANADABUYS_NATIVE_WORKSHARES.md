# Original CanadaBuys Workshares in Grant Customer Installations

This entry carries a complete native CanadaBuys Workshare into the existing Grant Customer Installation workflow. It keeps the original package, notice source, Workshare UUID, complete edition history, currency, integer cents, milestone identities and original quoted effort. The operator supplies the missing relationship between that commercial record and the Installation's delivery phases.

The installed command is **starforge grant-installation-workorder canadabuys**. It first prepares complete local source files. The existing **starforge grant-installation-receive** command then attaches those exact files to the selected existing Grant case, prepares and saves its native Installation, exports the full case and reopens it in the receiving operator's workspace.

Use the actual commissioning case and plan maintained by the original Grant owner. An outbound proposal, company name or procurement notice alone does not establish that case, an agreed customer relationship or a payer. The explicit party mapping is retained as an operator selection with its basis; payment and deployment choices continue through the original Installation fields.

## Source files and installed closure

| File | Responsibility |
| --- | --- |
| canadabuys-source.mjs | Full original package receiving through CanadaBuysWorkspace, exact revision selection, explicit phase mapping and immutable source publication |
| canadabuys-commissioning.mjs | Installed template/prepare command and original Python intake invocation |
| ../../sf47_budget_model/workspace/canadabuys_workshare_intake.py | Native source validation, exact original package/CSV/Workshare binding, normalized Installation plan and complete receiving-input preparation |
| ../../sf47_budget_model/workspace/workshare_intake.py | Existing source reader, with the native CanadaBuys schema branch |
| ../../sf47_budget_model/workspace/operations_workshare_installations.py | Existing source attachments, original Workshare seed, Installation refresh and native save/receiving integration |
| canadabuys-bidder-desk.json | Complete procurement service profile, task, source, payment and receiving selections |
| receive.mjs | Existing complete-case Installation save/export/import/reopen driver |

The Grant distribution includes this entire workorder directory, the original SF47 application and the complete CanadaBuys application component at its source-relative path. Keep that installed closure together. The new source preparer uses Node with its native node:sqlite implementation and Python 3 with standard-library modules. It receives the original package in an isolated local CanadaBuys workspace, closes it and removes only that temporary validation workspace when preparation ends.

[CanadaBuys Installation](CANADABUYS_INSTALLATION.md) remains the product guide for the installed customer MCP workflow, original package download, offline editable customer receiving and the full procurement task. This guide covers a Workshare already authored in the original CanadaBuys application.

## 1. Select an existing original native Workshare

Open the original CanadaBuys workspace and inspect its saved Workshare and complete revision history. Keep the native UUID and the exact revision intended for commissioning. The selected notice and its original source row must be in the same complete package.

~~~sh
canadabuys workshare \
  --workspace "$CANADABUYS_WORKSPACE" \
  --workshare-id "$CANADABUYS_WORKSHARE_ID"

canadabuys package \
  --workspace "$CANADABUYS_WORKSPACE" \
  --operator "$CANADABUYS_OPERATOR" \
  --scope selected --notice-id "$CANADABUYS_NOTICE_ID" \
  --expected-revision "$CANADABUYS_WORKSPACE_REVISION" \
  --out "$ORIGINAL_PACKAGE"
~~~

Use the actual values returned by the original application. The package is schema **starforge.canadabuys.package.v2** and includes complete original source CSV bytes and the selected Workshares' complete edition histories. The source preparation accepts one to twenty selected original Workshares. Each must be in that package, and each native Workshare is selected once.

A package export includes its export timestamp and exact package identity. Retain the first selected file; do not regenerate an otherwise similar export to recover the same prepared operation. A deliberately later export or changed selected edition starts a new source-preparation directory and keeps the earlier package.

The source input limit is 8 MiB for each complete file, matching the existing receiving driver. If the selected package exceeds that bound, use the original application's scoped package selection where it still retains the full source and required Workshare history. Truncating CSV records, editing the package body, replacing complete source with a digest or changing the receiver limit in a private copy does not preserve the original input.

## 2. Generate the selection template

Choose a private output directory for this source preparation. The command creates directories with mode 0700 and refuses a shared or symlinked selected directory.

~~~sh
starforge grant-installation-workorder canadabuys template \
  --package "$ORIGINAL_PACKAGE" \
  --out "$CANADABUYS_COMMISSIONING"
~~~

Direct source use is equivalent:

~~~sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs \
  canadabuys template \
  --package "$ORIGINAL_PACKAGE" \
  --out "$CANADABUYS_COMMISSIONING"
~~~

The command retains **selection-template.json**. Its original package filename, byte count, SHA-256, package ID and workspace ID/revision are filled from the supplied file. Each packaged Workshare has its original UUID, current native revision and canonical edition digest. Milestone IDs and titles are copied into an initial phase template.

Make an editable copy named, for example, **selected-native-workshares.json**. Keep the generated template intact. Remove any Workshare that is outside the selected commissioning scope and complete every remaining operator field. The template's null values are deliberate missing selections; they are not usable inferred terms.

For an earlier native revision, select its actual retained history edition and its original canonical SHA-256. The preparer validates both against the complete native receiver's result. Do not reuse the latest edition's digest for an earlier revision.

## 3. Complete the explicit mapping

| Selection | Required meaning |
| --- | --- |
| operationId | Stable identifier for this source preparation, using 1–70 letters, digits, underscores or hyphens |
| requestPrefix | Stable identifier for the existing receiving driver's derived requests, with the same character/length limits |
| receivingName | Human name for the complete receiving case |
| sourceUrl and observedAt | Original source reference and actual timezone-qualified source observation |
| package | Exact generated file, full bytes/SHA, package identity and original workspace identity/revision |
| workshares[].workshareId, revision, workshareSha256 | Original native Workshare and the exact selected retained edition |
| profile | canadabuys-bidder-desk |
| mappingNote | Why the selected phases faithfully carry this original Workshare into the Installation |
| parties.customer, supplier, basis | Explicit parties and evidence/basis for the mapping |
| schedule.businessDays, basis, startConditions | Selected working-day commitment, its basis and actual start conditions |
| phases | Complete ordered delivery phases, with original milestone allocation, assigned effort, owner, dependencies, duration, inputs, deliverables and acceptance |
| bindings | Optional existing Installation task/source/payment/deployment/receiving selections |

### Parties and schedule

The original native **partner** and **owner** text remains in the normalized plan and the full source. It does not automatically choose customer, supplier or payer. Enter the party mapping with its actual basis. A recorded native status such as agreed is preserved as **RECORDED_NATIVE_AGREED**; that is a description of the original record, with an explicit note that agreement and payment are not independently established by intake.

Native **deliveryDays** has no declared calendar/business-day unit. Enter the working-day duration and explain the interpretation under **schedule.basis**. Retain the original numeric deliveryDays and original availableFrom date in the source. Do not relabel an unspecified native duration as business days without that explicit selection. Start conditions remain the operator's actual conditions.

### Milestones, effort and phase dependencies

Every original milestone must appear in exactly one selected phase. Every phase needs at least one original milestone, a stable phase ID and an explicit owner. The complete original milestone amounts must equal the original feeCents before preparation succeeds. The importer preserves the original currency and integer cents; it does not convert CAD into a USD forecast.

Each phase has decimal strings for **productionHours** and **partnerHours**. Their totals must equal the original estimatedHours and partnerHours exactly. Zero effort is allowed if it is the original value. Decimal comparison avoids binary floating-point sums. The source keeps original partner responsibilities, costs, inputs and notes alongside the mapped plan.

Each phase also has positive **businessDays**, **dependsOn**, **deliverables**, **acceptance** and **inputs**. Dependencies must name selected phases, contain no cycles and fit within the explicitly selected working-day duration. Parallel phases are allowed; the critical path is checked.

Use the actual original milestone IDs and actual assignments in the editable selection. For a two-milestone record, for example, the two phases may each select their corresponding original milestone. Their effort allocations and durations must come from the responsible operator. The tool supplies no default fee, fabricated payer or assumed hours.

### Existing Installation bindings

Optional **bindings** uses the existing Installation preparation contract: merchantDeploymentId, buyerDeploymentIds, task, source, payment and receiving. Enter original merchant/buyer/source/payment/recipient identities only where established. An initial PLANNED Installation can retain pending selections.

The native reader's source refresh keeps current operated task, payment, deployment and receiving choices and prior native observations. Existing phase identities retain stable acceptance checks. A revised original phase follows the existing source-refresh rules. See the main [workorder guide](README.md) for the selected seed and editable bindings contract.

## 4. Prepare the complete original source

~~~sh
starforge grant-installation-workorder canadabuys prepare \
  --package "$ORIGINAL_PACKAGE" \
  --selection "$SELECTED_NATIVE_WORKSHARES" \
  --out "$CANADABUYS_COMMISSIONING" \
  --python "$PYTHON"
~~~

Select the installed Python executable in PYTHON. Omit --python to use python3.

The command retains the full selected input and original package before deriving any output. It runs the actual CanadaBuysWorkspace.receivePackage validator against the complete package in a local temporary workspace. This verifies the package ID, source ingestion, original Workshare editions and other included native records. It then resolves the selected original Workshare edition and source row and validates the operator's mapping.

The Python reader checks the complete original package bytes again, the saved selection bytes, selected native edition and full history, actual CSV header/row identity, exact original cents, effort and complete phase mapping. CSV row hashes follow the original JavaScript UTF-16 key ordering, including permitted Unicode column names.

It produces these full files:

| File | Content |
| --- | --- |
| SOURCE_SELECTION.json | Exact bytes of the selected operator input |
| Original package filename | Exact original package bytes; the filename stays distinct from preparation outputs |
| CANADABUYS_NATIVE_WORKSHARES.json | Full original package descriptor, embedded exact selection, complete native Workshare history, selected edition, source row and phase mapping |
| SUPPLIER_RECEIVING.json | Existing complete Installation receiving input, selecting the native Workshare UUID, canonical normalized plan digest and complete source files |
| SOURCE_PREPARATION.json | Source-preparation result and exact output identities, state PREPARED_SOURCE |

The normalized plan schema is **stellar-forge.canadabuys-native-workshare-plan.v1**. Its caseId is the original native Workshare UUID. The existing Grant receiving driver consumes that identity as a selected Workshare; no replacement DealScout case is manufactured.

**PREPARED_SOURCE means the local source files are prepared.** It does not mean an Installation was saved or a complete case was received. These commands make no provider, payment or Operations mutation.

The original proposed-USD forecast entry explicitly rejects this native schema. An original currency/status is carried into Installation commissioning without inventing a USD amount or a proposed-work eligibility classification.

## 5. Receive into the actual existing Grant case

Get the existing workspace, operating case, plan and operator identities from that case's current owner. For the maintained commissioning lineage, use its original Installation Source Desk owner and saved case. A sent prospect workshare or an unpublished example is not a substitute for these records.

Read the current case and existing Customer installations before selecting a receiving operation. Preserve an existing Installation that already represents the same Workshare. The original receiver finds it by the native Workshare case ID and refreshes its selected source while preserving current operator fields.

Use absolute filesystem paths for the application, source and receiving workspaces:

~~~sh
starforge grant-installation-receive \
  --operations-cli "$SCF_MODEL_ROOT/workspace/cli.py" \
  --workspace "$SCF_WORKSPACE" \
  --case "$SCF_CASE" --plan "$SCF_PLAN" \
  --inputs "$CANADABUYS_COMMISSIONING/SUPPLIER_RECEIVING.json" \
  --source-root "$CANADABUYS_COMMISSIONING" \
  --out "$CANADABUYS_INSTALLATION_OUTPUT" \
  --receiving-workspace "$SCF_RECEIVING_WORKSPACE" \
  --actor "$SCF_ACTOR" \
  --receiving-actor "$SCF_RECEIVING_ACTOR" \
  --python "$PYTHON"
~~~

The receiving workspace must differ from the original workspace. Keep the same complete input, original case/plan and private output directory when resuming the same operation.

This existing driver:

1. Retains every selected full file and attaches or reuses its exact original bytes in the case's Sources.
2. Calls the original native Workshare inventory and seed operations using actual source IDs and digests.
3. Applies the complete CanadaBuys profile and explicit bindings to the original seed.
4. Calls the original preview and saves the selected complete Installation edition using current case versions.
5. Reads that saved edition and checks its original Workshare and reviewed document.
6. Exports the complete operating case as an Installation ZIP.
7. Imports that same ZIP through the existing complete-case importer into the selected receiving workspace.
8. Reopens each original Installation identity and revision there and verifies its saved SHA and original Workshare binding.

Keep **RECEIVED.json**, its complete exported archive, the prepared source files and the saved original/receiving case identities. This is the actual receiving result. Retain the original command and every intermediate source/save receipt when investigating an interrupted operation.

## 6. Open and operate the received Installation

Open the existing Grant Operations application using the receiving workspace and the case ID returned by RECEIVED.json. Select **Customer installations**, open the original Installation ID and inspect its saved revision, Workshare source and acceptance steps. Continue its existing task/source/payment/receiving fields through the normal desk.

The complete CanadaBuys customer workspace is a separate retained native package. Its normal operator opening command after the installed customer has received that workspace is:

~~~sh
canadabuys serve \
  --workspace canadabuys-customer-work/received-workspace \
  --operator customer
~~~

Use the loopback URL printed by that command, then open **Bidder desk → Decision & reports**. Keep its original evidence, decisions and workshares with their native IDs. The Grant Installation's source files connect to this package; they do not replace the editable procurement application or its original records.

## Interruption, changed editions and custody

The preparation directory publishes complete files with private modes, fsync and create-only identities. Repeating the exact selection and package reopens matching original bytes. A conflicting file stops the operation; it is not overwritten. A temporary native-validation directory belongs only to this offline preparation and is closed before cleanup.

If Python stops after JavaScript source publication, repeat the same prepare command. The full original package and SOURCE_SELECTION are already bound; the existing exact CANADABUYS_NATIVE_WORKSHARES and later receiving files are reused. Do not edit those published files to continue.

A changed native Workshare, party mapping, phase allocation or source package belongs in a new source-preparation directory. Export and select the actual new native edition, keep the previous source, and run the existing Installation receiving workflow against the same actual case. The original native engine determines stable phase checks and source-refresh behavior.

The complete receiving driver retains its exact invocation in receiving-input.json and its export intent in receiving-export.json. Once the original ZIP exists, continuation reuses it and its original import request. The source remains complete in the exported case; the receiving operator does not need access to the original source server to verify those bytes.

Keep private procurement, party and operating-case files in the authorized destination selected for that case. Repository source contains the implementation and this guide. The tool does not publish a customer's private package, change sharing, fetch another tenant or dispatch a payment.

## Evidence and owner handover

The implementation adds source-native preparation and reuses the maintained Installation workflow. A source review or a successful package preparation is distinct from an actual Installation save/export/import.

For a completed customer handover, retain the actual original package identity, selected Workshare UUID/revision, explicit operator mapping, SOURCE_PREPARATION, the real case and plan, saved Installation revision, full exported case and RECEIVED result. The operating owner can then connect the delivery and acceptance evidence to the actual grant/demo/milestone record. Commercial acceptance, funding and payment require their own original evidence.

## Open the prepared source in the existing browser desk

Package the exact five-file preparation for the existing Grant Operations Source Preparation Desk:

```sh
starforge grant-installation-workorder canadabuys package \
  --source /absolute/private/canadabuys-source-preparation \
  --out /absolute/private/canadabuys-source-delivery/CanadaBuys_Source.zip \
  --python /absolute/python3
```

This command verifies and reopens the complete original native package and all five prepared outputs before publishing the ZIP. Keep its private output directory and original package receipt together. It does not require an open Grant case.

In the existing authorized case, open **Installations → Prepare original source workshares**. Retain the whole ZIP, select **Receive native CanadaBuys source**, and review the selected revision, complete original Workshare history, exact cents, explicit parties and phase allocations. Attach the complete source set, then use **Open native Installation preparation**. The attached preparation supplies the original native Workshare and optional explicitly selected bindings to the unchanged editable Installation flow.

[The Source Desk guide](../../sf47_budget_model/workspace/INSTALLATION_SOURCE_DESK.md#receive-an-original-canadabuys-workshare-package) gives the complete request, revision, source custody and interrupted-response workflow. Earlier editions remain available. Changes originate in the native Workshare and explicit mapping; the browser receives their next complete source package.
