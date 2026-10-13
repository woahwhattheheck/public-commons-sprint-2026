# Procurement agency Customer Installation

The `procurement-agency` profile commissions the complete original-source workflow into an agency's existing client operations: selected procurement families, retained publisher editions and documents, assigned material-change review, the agreed tracker, and editable customer receiving.

Use this profile with the original customer Workshare and matching receiving packet. The native preparer carries their delivery phases, effort, dependencies, payment milestones, source attachments and existing acceptance checks into the Installation. The [profile](procurement-agency.json) supplies the procurement task and operating defaults; the selected Workshare supplies the actual commercial scope.

## Select the maintained implementation

The profile is discovered from this directory by the original installed profile loader. Both entrypoints use the same source:

~~~sh
starforge grant-installation-workorder profiles

node "$INSTALLATION_SOURCE_DIR/prepare.mjs" profiles
~~~

Select `procurement-agency` from the returned catalogue. The complete profile file and its source identity travel into preparation. Its `sourceFiles` list pins the maintained OCDS workspace, source-window engine, original capture adapter, domain model, reports, typed client, CLI, browser server, merchant integration and managed Applications provider.

The customer application is described in [OCDS](../../../scf-starforge-20261009/sf30-seller-sdk/ocds/README.md) and [Source windows](../../../scf-starforge-20261009/sf30-seller-sdk/ocds/SOURCE-WINDOWS.md). Use that installed source's browser, CLI and client contract for operation. The Installation uses the existing [Workshare receiving workflow](README.md#complete-native-receiving-in-one-operation) and [original source preparation](SUPPLIER_WORKSHARES.md).

## Bind the whole original customer programme

Retain a separate commercial case, input set, configuration and resulting Installation for each agency. Within an agency, keep one actual workspace directory per client portfolio. A shared original notice may be relevant to several clients; each client retains its own reviewer, disposition, notes and next action.

| Binding | Original source and use |
| --- | --- |
| Commercial case | The complete original Case packet and its matching `workshare_input.source`. |
| Plan | The whole original `dealscout.workshare-plan.v1`, including every phase, dependency and payment milestone. |
| Effort | Every original phase's hours or minutes, its original source pointer, and the original complete total. |
| Agency environment | The selected installed application, runtime source/version and original host/operator context. |
| Client map | Explicit portfolio IDs, separate workspace directories, accountable reviewers and relevant source selections. |
| Source population | Original publisher, exact OCIDs or deliberately selected discovery window, original package/document capacity and following windows. |
| Tracker | The complete agreed column contract and source-to-column mappings, with one row per client portfolio plus OCID. |
| Receiving | The designated independent recipient workspace, receiving operator and complete editable client handoff. |
| Merchant terms | The native Installation's selected task price, unit count, asset, recipient, budget and authority. |
| Professional terms | The original Workshare fee, phases, effort, milestones, operator sessions and correction cycle. |

Complete each binding from the retained case and actual installation. The preparer checks the original case version, plan revision and plan/source hashes. Its output preserves the original `workorder`, `assignments`, `checks`, `workshare`, `workflowPeriods` and `coordination` structures.

The profile's merchant-priced unit is a complete selected client procurement review/handover edition. Use the actual merchant task and price selection already recorded in the native case. Professional commissioning remains in the original Workshare.

## Prepare the original commercial source

The maintained `source-inputs.py` accepts one complete `stellar-forge.installation-source-selection.v1` selection and every referenced original file. Its `cases` rows name the commercial `caseId`, `profile: "procurement-agency"`, original packet, canonical `planSha256`, complete `productionEffort`, `effortTotal`, all source files and the selected binding values.

For every original file, retain its actual relative path, selected receiving filename, complete bytes, SHA-256, source URL, observed time with timezone, and actual media type. A source-use observation time identifies that intake observation; publisher publication time and original acquisition time remain separate values in the retained source.

Every production-effort row maps one original phase to one original numeric value through `sourcePointer`, optional `sourceFile`, original `unit`, selected `hours` and explanatory `basis`. The selected hours must equal that exact original value after minutes-to-hours conversion, and all phases must sum to the complete quoted effort source. If an original plan carries effort in an accompanying CSV, retain the CSV unchanged and a complete source-linked row transcription that exposes its original cells to the native JSON-pointer reader.

Keep every original phase ID. The maintained source reader supports an explicit attributable phase-ID amendment when that original input requires one; it retains the amendment and original packet.

~~~sh
python3 "$INSTALLATION_SOURCE_DIR/source-inputs.py" \
  --selection "$PRIVATE_INPUT/SOURCE_SELECTION.json" \
  --source-root "$PRIVATE_INPUT" \
  --out "$PRIVATE_PREPARED"
~~~

The complete create-only output includes every selected original file and:

| Output | Purpose |
| --- | --- |
| `Supplier_Workshare_Commissioning.json` | Native complete commissioning source, with original phases and source-backed effort. |
| `Supplier_Complete_Receiving_Packets.json` | Full original customer packets, including their commercial source and plans. |
| `SUPPLIER_RECEIVING.json` | Concrete native receiving input, selected profile, per-customer plan digest and file descriptors. |
| `SOURCE_PREPARATION.json` | Full preparation result with original source identities, profile identities and generated outputs. |

Use the returned `SUPPLIER_RECEIVING.json` with the original receiving driver. Preserve the source selection and original files with the complete generated output so another operator can reopen the same intake.

## Commission the client operating workflow

### Establish the selected client stores

Select the existing managed OCDS application from Applications and supply the actual workspace directory and operator through its normal form. The original launch retains the selected installed source and private application address. The direct native entrypoint is also available from the same source:

~~~sh
node "$OCDS_SOURCE_DIR/cli.mjs" serve \
  --workspace "$CLIENT_WORKSPACE" \
  --operator "$AGENCY_OPERATOR" \
  --host 127.0.0.1 \
  --port 0
~~~

Use a distinct client directory for each portfolio. Preserve the original agency configuration and actual source selection in the customer input. Import, source capture, review, tracker generation and receiving must all select that same intended client context.

For the five-client commissioning workflow, the selected Workshare defines the actual population and limits. The planning profile accommodates up to five isolated stores, 200 unique retained original package bodies and 20 distinct selected OCIDs across the programme. Count unchanged repeated bodies once by raw-body SHA-256, preserve each retrieval observation, and track source/document bytes separately against the selected capacity. Reusing an OCID across client portfolios preserves its separate client review without increasing the programme's distinct-OCID count.

### Save explicit publisher selections and retain the baseline

For a fixed selected cohort, create a named record-family selection for each original OCID. That retains the publisher-provided history for the selected procurement family. A wider discovery request uses the maintained publisher adapter with its deliberately selected dates, stages and page limit saved in that request.

Retain the complete original JSON text and decoded source document, original URL, publisher identity, package and release/record IDs, source pointers and acquisition metadata. External-original adoption retains the original acquisition transport and the values exposed by that transport. An absent upstream timestamp or status stays distinct from the time the original was observed or imported.

Release, compiledRelease and versionedRelease remain separate source-provided representations. An issuer's compiled release supplies its own current view; individual releases and version history retain their original content. Select the exact entries used for a review. A representation change is an explicit comparison outcome.

### Acquire documents in each selected window

The source-window engine retains documents throughout planning, tender, awards, contracts and implementation. Keep each document's association to its client workspace, OCID, source/entry ID, source JSON pointer and original document ID.

Observe each selected URL again when a new publication window runs. Record the requested and final URL, original metadata dates, actual acquisition time/status, content type, validators, complete size and exact byte hash. A content hash can deduplicate retained bytes while multiple source/window observations remain distinct. A valid not-modified response can reuse the earlier retained asset.

A missing URL, offline document, failed response or portal access instruction remains an acquisition outcome with the original source context and assigned next action. Source-page progress and document progress each keep their checkpoint, so completed publisher pages survive a document interruption.

### Review the material changes for each client

Compare the exact prior/current selected source entries and document observations. Preserve original extension fields, explicit null/absence, original array identities, release/record relationships and source-pointer correspondence.

| Source meaning | Operator treatment |
| --- | --- |
| Tender deadline | Preserve the tender-period closing field, original timezone/offset and original source pointer. |
| Expression-of-interest deadline | Retain its distinct EOI meaning and phase; expose it in the client's applicable deadline mapping. |
| Enquiry deadline | Preserve the enquiry-period value separately from the submission or EOI deadline. |
| Full notice and summary disagree | Keep both original displayed values and sources; bind the owned schedule to the selected authoritative field. |
| Amount or currency changes | Preserve original value, currency, stage, date and source context for review. |
| Release/compiled representation changes | Record the change of representation and compare the selected exact source content in that context. |
| Document body changes behind the same URL | Retain both assets and the new observation, and assign the document change with its source references. |
| Removed source metadata | Retain the prior edition and associated original asset in history. |

Save the actual client disposition, accountable owner, next action, note and shortlist with the current review revision. Each client's edit is independent. Material-change assignments point back to the exact selected source/window comparison that created them.

### Produce the agreed tracker and complete outputs

The agency tracker is an explicit business projection with one row per client portfolio plus OCID. Preserve the customer's exact header order and complete field mapping. In the supplied five-client workflow, the 32-column contract keeps its original 17 source columns and appends the 15 native fields. The originally sent source CSV remains its own edition.

Keep full-notice deadline text, summary text, actual native field meaning, portal/source references, selected current/prior entry and source IDs, review owner/status/revision, next action and export time in their mapped fields. Use the source-owned tracker projection from the retained agency kit.

The general OCDS CSV report is a complete relational export with process, party, award, contract, value, document and other source rows. Use it alongside the agreed client tracker. JSON and HTML reports retain complete selected original content and history. The portable workspace and source handoff retain editable state, full original bodies and source-operation context.

### Operate following publication windows

Each actual following publication window has a stable name and saved selection. Run the original capture/resume and source-window lifecycle against the selected stores, retaining every source page, document observation, assigned change and complete output.

Resume an interrupted request by its existing capture or window/checkpoint identity. A new window creates an attributable successor. Preserve the previous completed tracker/handover edition and export the actual newly reviewed client state.

The original Workshare defines how many windows, which source population, who owns review, and the actual delivery period. Keep operator training, source capacity, consolidated corrections and maintenance ownership attached to that complete scope.

### Receive and reopen the complete client handover

Prepare a handoff scoped to the selected client workspace and complete source operation. It contains that client's selected process history, reviews, original packages, acquired documents, source/window observations and retained receiving context.

Import it into the designated independent client workspace using the existing workspace/source receiving controls. Bind the requested source handoff to its actual handoff identity. Review returned conflicts in their source context; current local client decisions remain attributable to their owner and revision.

Open the retained process history and an original document, inspect the assigned material change, edit a review, export the current tracker/reports, close and reopen the same recipient workspace, and re-export the continuing handover. Retain those actual results with the original phase acceptance and complete customer continuation.

## Receive the original Installation

Use the existing Operations case, pinned plan and current original owner context. The generated private source output is the complete input to the maintained receiver:

~~~sh
node "$INSTALLATION_SOURCE_DIR/receive.mjs" \
  --operations-cli "$SCF_MODEL_ROOT/workspace/cli.py" \
  --workspace "$SCF_WORKSPACE" \
  --case "$SCF_CASE" \
  --plan "$SCF_PLAN" \
  --inputs "$PRIVATE_PREPARED/SUPPLIER_RECEIVING.json" \
  --source-root "$PRIVATE_PREPARED" \
  --out "$PRIVATE_OPERATION" \
  --receiving-workspace "$SCF_RECEIVING_WORKSPACE" \
  --actor "$SCF_ACTOR" \
  --receiving-actor "$SCF_RECEIVING_ACTOR"
~~~

The installed equivalent is `starforge grant-installation-receive` with the same arguments. Select the actual original workspace and CLI from the programme owner, and use its full native case and plan IDs. The driver refreshes current source/version selections through the existing Workshare and Installation flow.

For an individual original seed, the same profile also uses:

~~~sh
node "$INSTALLATION_SOURCE_DIR/prepare.mjs" template \
  --profile procurement-agency \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --out "$PRIVATE_OUTPUT/procurement-bindings"

node "$INSTALLATION_SOURCE_DIR/prepare.mjs" prepare \
  --profile procurement-agency \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --bindings "$PRIVATE_OUTPUT/procurement-bindings/bindings.json" \
  --out "$PRIVATE_OUTPUT/procurement-installation"
~~~

A fresh seed retains the original planned checks. Enter completed observations through the original Installation after the relevant source/client operation has actually run. Save the complete native case export, independently receive it and reopen the same Installation ID/revision together with its original Workshare phases and source bindings.

## Ownership and continuation

The agency controls its actual client mapping, source selection, review decisions and receiving environment. Retain the implementation owner, client reviewers, designated receiving operator, original professional plan and agreed support period in the complete commercial case.

Keep original source packages, source-operation history, tracker mapping, acquired documents, full reports, editable handoffs and exact installed source with each retained programme. Future publishers or changed integrations compose through their maintained adapters and original source contracts. The next operator can follow the selected client's source, review, export and independent receiving from the same complete state.

