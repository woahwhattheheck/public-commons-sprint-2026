# Complete customer installation workorders

This preparation tool turns a fresh original SF47 Installation seed into a complete customer workorder for the maintained customer programme, including CoCart, Blockscout, Query.Farm, ARS air-quality, Lutra QGIS migration, supplier catalogue onboarding, supplier order integration, Stellarcarbon, CFCE/GiveCredit and industrial reconciliation. The original **Customer installations** desk receives the resulting full document through **Load input file**, then previews, saves and exports it in the same operating case.

The profiles describe the whole useful customer task, the actual source contract, merchant-priced unit, receiving application, maintenance and interruption recovery. Customer selections stay in local bindings: original merchant/buyer IDs, approved source edition and rights, actual receiving host/engineer and original payment terms.

The maintained commercial importer remains the entry for an original customer Workshare. It retains the case, complete source/packet, price, schedule, assigned phase owners and original acceptance steps. This tool composes that importer; it does not create a second customer case or substitute its own commercial plan.

## Files

| File | Purpose |
| --- | --- |
| prepare.mjs | Node CLI; complete local JSON input, private create-only output and exact-byte receiving metadata |
| receive.mjs | Complete native source intake, original Installation refresh/save and full-case receiving driver |
| prepare-core.mjs | Pure preparation functions, selected-source checks and complete workorder rendering |
| profiles.mjs | Shared installed-profile discovery, schema/identity validation and exact complete-source metadata |
| audit-exchange.json | Complete building audit review, native energy analysis, eight-table turnover and independent editable customer receiving |
| AUDIT_EXCHANGE.md | Original commercial scope, source/runtime selection, full review and analysis operation, complete project/LDA handover and Installation acceptance |
| cocart.json | Whole headless cart → native Woo checkout/order → payment/fulfilment → original receiving task |
| blockscout.json | Whole selected explorer request → paid exact response → operator/Node/Python → original receiving task |
| stellarcarbon.json | Whole source edition → customer/project assignments → complete statements → original accounting and editable receiving |
| cfce-givecredit.json | Registry/receipt/ledger intake → provider funding → carbon associations → donor/initiative statements and editable receiving |
| CARBON_REPORTING.md | Complete source bindings, commercial setup, statement operations and independent native receiving for both reporting desks |
| queryfarm.json | Complete result acquisition → retained VGI/SQL use → deliberate next edition → original receiving task |
| ars-air-quality.json | Complete source intake → named air-quality review → client report/delivery → correction and original receiving task |
| lutra-qgis.json | Complete baseline/corrected vector migration → two native QGIS projects/publications → original independent receiving and operator handover |
| LUTRA_QGIS.md | Full Lutra source, commercial phases, native operation, correction, complete receiving and handover |
| georobotix-csapi.json | Complete selected Connected Systems source window → reviewed native editions → useful queries/comparison → independent customer receiving and original Installation |
| GEOROBOTIX_CSAPI.md | Full GeoRobotix commissioning scope, exact selected archive/reference, operator/runtime setup, recovery and complete source/Installation handover |
| industrial-reconciliation.json | Native historian or retained local sources → reviewed immutable editions → explicit normalization/tolerances → complete accounting, engineer decisions and editable customer receiving |
| INDUSTRIAL_RECONCILIATION.md | Whole source/meaning intake, original Workshare phases and fee, Installation setup, operator/CLI/MCP workflow and independent complete receiving |
| canadabuys-bidder-desk.json | Complete procurement source → reviewed capability/evidence/decision → original publication → editable independent customer receiving |
| CANADABUYS_INSTALLATION.md | Original Workshare/source preparation, installed MCP customer, complete download/recovery and native Installation receiving |
| webhook-event-analysis.json | Complete acquired event window → accepted customer report/workbook → later useful window → all sixteen files and original Installation receiving |
| WEBHOOK_EVENT_ANALYSIS.md | Whole original Workshare, exact event delivery, installed preparation/reopen, native case and independent customer handover |
| invoice-settlement.json | Actual invoice programme and complete observations → individually reviewed attribution → reconciliation/report → independent editable customer receiving |
| INVOICE_SETTLEMENT.md | Complete original Workshare/Installation, authenticated invoice customer, native review and whole-publication receiving |
| canadabuys-source.mjs / canadabuys-commissioning.mjs | Complete native CanadaBuys package, selected Workshare revision and explicit phase/party/working-day mapping into the original Installation reader |
| CANADABUYS_NATIVE_WORKSHARES.md | Native Workshare selection, complete local source preparation, existing-case save/export/receive and original owner handover |
| supplier-catalogues.json | Complete supplier editions → selected customer import → full current recipient catalogue → customer receiving |
| supplier-orders.json | Complete original order/profile/adapter → fulfilment and declared HTTPS → portable editable customer receiving |
| source-inputs.py | Complete original packets and explicit effort sources → original native commissioning/packet formats |
| SUPPLIER_WORKSHARES.md | Full source preparation, phase-ID correction, commissioning, original native receiving and commercial/funding treatment |
| CUSTOMER_PROGRAMMES.md | Customer task selection, source semantics, recurring-use cadence and original-case commissioning for Query.Farm and ARS |

The installed Grant Operations product exposes the same CLI as `starforge grant-installation-workorder` and the pure module as `./grant/installation-workorders`. Every complete profile and its operating guide in this maintained directory is included in the selected source.

Use the repository's maintained Linux/Node runtime. The preparation CLI uses Node's standard library; the sources command also uses Python's standard library and the original SF47 Workshare importer. These local preparation commands make no service calls. The selected customer applications retain their own native runtime/dependency requirements.

## Discover the installed customer programmes

For original invoice reconciliation commissioning, select **invoice-settlement** and follow [INVOICE_SETTLEMENT.md](INVOICE_SETTLEMENT.md). It binds the actual programme, complete source population, named attribution reviewer and independent receiving to the original Workshare/Installation, preserving its commercial terms, checks and payment selections.

For CanadaBuys procurement commissioning, select **canadabuys-bidder-desk** and follow [CANADABUYS_INSTALLATION.md](CANADABUYS_INSTALLATION.md). It carries the complete retained source, decision and installed customer workflow into the original Workshare/Installation; its actual execution status remains in the original receiving records.

For a Workshare already saved in the native CanadaBuys application, use `starforge grant-installation-workorder canadabuys` and [CANADABUYS_NATIVE_WORKSHARES.md](CANADABUYS_NATIVE_WORKSHARES.md). Its complete original package and revision, currency/cents and effort remain intact. Explicit party, phase and working-day selections feed the existing Installation source reader and complete-case receiver in the actual owner's saved case.

~~~sh
starforge grant-installation-workorder profiles

node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs profiles
~~~

The catalogue returns each installed profile's ID, title and complete-file source identity. Both commands use the same profile loader. A complete new customer profile JSON and guide join this directory; matching packaged profiles are discovered by the preparer and receiver. Each profile's schema and ID must match its regular source file. The loader retains the existing 2 MiB source-file limit and reads the selected complete JSON before preparation or native customer receiving.

Choose the actual customer programme from that installed catalogue. [LUTRA_QGIS.md](LUTRA_QGIS.md) gives the full original migration scope and native operating route. [INDUSTRIAL_RECONCILIATION.md](INDUSTRIAL_RECONCILIATION.md) covers reviewed historian and local-data commissioning through complete paired reconciliation and editable customer receiving.

## 1. Receive the original commercial case

Open the existing SF47 operating case and inspect its current **Customer installations** list before adding a new installation. Continue an existing installation through **Use this edition as a draft** when it already represents the customer case.

For a new customer installation, attach the complete original commissioning-inputs JSON and its matching complete receiving packet to that case's Sources. Select the current source file IDs and exact digests. The native Workshare importer accepts the original commissioning formats and resolves the complete selected case.

~~~sh
python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-workshares --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --source "$COMMISSIONING_SOURCE" --expected-source-sha256 "$COMMISSIONING_SHA256" \
  --packet-source "$PACKET_SOURCE" --expected-packet-sha256 "$PACKET_SHA256" \
  --output "$PRIVATE_OUTPUT/original-workshares.json"

python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-workshare-seed --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --source "$COMMISSIONING_SOURCE" --expected-source-sha256 "$COMMISSIONING_SHA256" \
  --packet-source "$PACKET_SOURCE" --expected-packet-sha256 "$PACKET_SHA256" \
  --workshare-case "$COMMERCIAL_CASE" --expected-revision 0 \
  --output "$PRIVATE_OUTPUT/original-seed.json"
~~~

Run these commands from the original sf47_budget_model directory. Each variable names an actual existing case, source selection or private local path. Keep the complete returned envelope: /source, /document, original installation selection and the retained Workshare binding. The optional packet flags are supplied together when that packet is attached.

The [original Installation guide](../../sf47_budget_model/workspace/INSTALLATIONS.md) defines the maintained browser, CLI, API and MCP interfaces and the complete receiving lifecycle.

## 2. Prepare customer bindings

Choose the original customer's installed profile, such as cocart, blockscout, queryfarm, ars-air-quality, lutra-qgis, supplier-catalogues, supplier-orders, stellarcarbon, cfce-givecredit or industrial-reconciliation for the selected actual product. The [customer programmes guide](CUSTOMER_PROGRAMMES.md) carries the complete Query.Farm and air-quality operating journeys. The [complete carbon reporting guide](CARBON_REPORTING.md) covers both reporting installations and their original commercial/source bindings.

~~~sh
node prepare.mjs template --profile cocart \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --out "$PRIVATE_OUTPUT/cocart-bindings"
~~~

The resulting bindings.json already selects the exact original operating case/version, pinned plan/revision/digests and original commercial case. It retains available native merchant/buyer/payment selections and provides the customer fields to complete.

| Binding | Value to receive from the actual existing work |
| --- | --- |
| merchantDeploymentId | Accountable original case deployment with merchant authority |
| buyerDeploymentIds | Actual independent customer's original case deployment IDs |
| source.reference | Selected customer edition/source ref or authorized original live provider connection |
| source.authority | Actual permitted source use, customer authority and applicable rights |
| source.sourceIds | Original case source attachments for the selected customer installation |
| payment | Selected network, asset, recipient, integer atomic unit price, task count, approved aggregate budget, spending authority and facilitator selections |
| receiving.host | Actual authorized Linux host/environment and retained application/state location |
| receiving.operator | Named engineer receiving and operating that host |
| receiving.sourceIds | Complete selected receiving application/source/configuration handover files |
| task / receiving | Any explicit customer-specific task or application detail needed beyond the maintained profile |

Keep sensitive access material in the selected application's existing private configuration. The workorder needs the agreed configuration reference and accountable owner.

The template's blank text leaves the technical profile's instruction in place; it does not supply a customer fact. Source arrays add original attachment IDs while retaining the commercial-source closure. Existing native payment values stay exact. An integer atomic price uses a JSON string, a task-unit count uses an integer, and an unselected numeric field remains null.

The source selection is checked structurally, so reformatting JSON or reordering object keys preserves its meaning. A changed case/version or pinned plan requires a fresh original seed and bindings.

## 3. Emit the complete workorder and input

~~~sh
node prepare.mjs prepare --profile cocart \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --bindings "$PRIVATE_OUTPUT/cocart-bindings/bindings.json" \
  --out "$PRIVATE_OUTPUT/cocart-installation"
~~~

The same command with any selected installed profile prepares that product from its own original commercial seed and bindings.

| Output | Native use |
| --- | --- |
| installation-input.json | Complete editable native Installation document for Load input file or CLI --document |
| installation-preview-input.json | Exact existing API preview envelope with the selected original case version |
| WORKORDER.md | Complete customer task, source, receiving, original commercial terms, implementation sequence and remaining actual selections |
| preparation.json | Selected original source, input-file identities, full implementation guidance, practical selections and returned output identities |

All output files use a private directory and create-only publication. Rerunning the same complete inputs returns the same exact files. A different existing output is preserved; select a new preparation edition directory for changed inputs. preparation.json is written after the complete input, preview envelope and human-readable workorder.

The generator accepts only a fresh PLANNED seed at installation edition zero. Original funded cost IDs, original check criteria and source-linked commercial phases remain byte-for-byte equivalent as JSON values. Complete Workshare bindings and newer native coordination/workflow fields are retained. It adds no acceptance observations. A customer installation already operated or saved is edited through its existing original draft.

The preparation report lists the actual selections still to receive. Filled preparation fields are then resolved by the original preview against the operating case's native deployments, sources, funding plan and customer records.

## 4. Preview, save and reopen the same native installation

Use **Customer installations → Load input file → Preview → Save** in the existing case. The native preview verifies original references and the retained commercial Workshare. Saving appends the selected installation edition, and the original request journal resolves an interrupted save.

The equivalent original CLI flow is:

~~~sh
python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-preview --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --expected-revision 0 \
  --document "$PRIVATE_OUTPUT/cocart-installation/installation-input.json" \
  --output "$PRIVATE_OUTPUT/cocart-installation/native-preview.json"

python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-save --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --expected-revision 0 \
  --document "$PRIVATE_OUTPUT/cocart-installation/installation-input.json" \
  --expected-preview-sha256 "$NATIVE_PREVIEW_SHA256" \
  --actor "$RECORDING_OPERATOR" --request-id "$ORIGINAL_SAVE_REQUEST" \
  --note "$INSTALLATION_REASON"
~~~

Retain the returned original installation ID, edition and case version. Reopen that exact saved edition with installation-show. Export it with the original installation-export command or **Download complete handover**. The original full ZIP retains all attachments, the original planning archive, complete case and installation histories and its selection. Receive that full ZIP through the existing Operations import and reopen its selected installation.

A lost save response is reconciled through the original request result. New customer bindings after a save belong to a later draft of that same installation.

## 5. Whole operating sequence by product

### CoCart

The profile covers one selected customer and simple virtual SKU at quantity one. Start from the actual merchant product's **Download saved headless profile**, or the complete prior CoCart receiving JSON. The maintained baseline is CoCart Community 4.9.7 with SDK 1.2.1. Select the customer's actual installed edition, licensed inputs, source ref and native checkout semantics.

Use the existing /cocart.html setup or cocart/managed.mjs to prepare the original workspace and source. Adopt it through **CoCart customer workspace** in Applications. The cart keeps its opaque key and native price values; explicit checkout transfer supplies its own original Woo handoff. Continue the selected buyer/merchant review and fulfilment on that original order.

The receiving engineer uses the existing complete export and inspect-cocart / download-cocart / reopen-cocart path. An interrupted download retains its original manifest and byte prefix. Preserve the actual store database for existing cart and checkout keys. Named merchant, release, support, fulfilment and receiving roles complete the handover.

### Blockscout

The profile covers one selected explorer, chain and token-information endpoint family. Select its actual PRO or reviewed operator-instance origin, authentication, provider account, response semantics, quota/error behavior and permitted use. The EVM data chain remains separate from the Stellar payment network.

Use the existing **Blockscout connection setup** and **Blockscout token merchant** Applications entries. Receive the whole reviewed deployment and retain its original state. Activation follows that original application's challenge-only and paid selection. The private operator desk and original Node/Python customers use the same merchant request, payment, response and recovery identities.

The receiving journey includes the agreed actual API response, testnet purchase, exact response download/recovery, applicable limit behavior and same-state stop/reopen. Receive source, pinned dependencies, reviewed connection/deployment package, both consumers and full original state. The customer/prime's chosen operator controls production rollout and ongoing accounts.

### Query.Farm and ARS air-quality

Query.Farm covers the complete acquired data result, original VGI catalog/worker, typed SQL use, retained-edition recovery and an explicitly selected next edition. ARS covers authorized client source intake, the named air-quality review, complete client reporting and delivery, linked correction and independent reopening. Its default is the original monthly reporting scope; a daily-review programme uses explicit customer task bindings.

Use [Customer programmes](CUSTOMER_PROGRAMMES.md) for the full operating journeys, first-installation commands, existing-installation updates and a recurring-use calendar grounded in the actual source cadence.

### GeoRobotix Connected Systems

Use `georobotix-csapi` for one civil or environmental JSON observation endpoint with an agreed source window, declared schema and independent receiving environment. The programme preserves complete source pages, reviewed fields/time/units/quality, native mappings/editions, useful queries and comparison, original-request recovery, full operator/MCP use and exact project/data receiving. The original proposed Workshare retains 72 engineering hours over 12 active business days and USD 9,600 in two USD 4,800 milestones; actual case terms and acceptance remain with the original native record. The illustrative publisher reference and completed selected archive have their own evidence, while installed/browser and customer acceptance require their actual results. [GEOROBOTIX_CSAPI.md](GEOROBOTIX_CSAPI.md) gives the complete programme, maintained commands and receiving sequence.

## Supplier catalogue and order workshares

Use [Supplier workshares](SUPPLIER_WORKSHARES.md) for complete original proposal
intake and actual customer commissioning. The catalogue profile covers full
source editions, selected PIM import and complete recipient catalogue delivery.
The order profile covers selected customer profile/mapping, original document
workflow, configured HTTPS, complete customer receiving and return.

`starforge grant-installation-workorder sources` retains every original packet
and document, verifies explicit phase-effort pointers and the quoted total, and
calls the original Workshare reader before publishing the accepted commissioning,
complete packet group and `SUPPLIER_RECEIVING.json`. The existing
`grant-installation-receive` then continues the original Operations case.

The professional fee, phase plan and commissioning state remain in the original
Workshare. Paid service amounts and deployment/receiving authority remain actual
customer selections. An accepted phase-ID-only amendment retains the exact
original source and its reversible mapping.

## Funding and meaningful cohort work

Installation assignments reference the pinned original funded packages. They do not add hours or alter the application request. Retain separately priced commercial work in its original Workshare. Record each actual engineering hour once, with its real funding basis; commercial implementation and grant-funded future development use their original respective work records.

Use the independent cohort's actual participating operators, useful customer tasks, complete responses and later purchases. Technical preparation supplies the commissioning programme; actual operator participation and completed work are recorded by the native original operations that perform them.

## Maintained source

The profile files name their exact observed Git blobs. The implementation is built against:

- workspace/operations_installations.py: d1215083000905d8df2669e26173609f7a5d6282.
- workspace/operations_workshare_installations.py: 887ed17e1aeb71c02ef646653748ba819a363a7c.
- The original Customer installations guide linked above and the complete current product operating guides.

The tool uses the existing native schema. Its complete output continues through the original application, source delivery and native save/receiving operations.

## Complete native receiving in one operation

The installed command **starforge grant-installation-receive** runs the original Workshare and Installation workflow end to end. Direct source use is **node receive.mjs**. Keep this file with the existing core and the complete installed profiles.

Supply a complete local receiving input with schema **stellar-forge.installation-workshare-receiving.v1**. It selects each original customer Workshare, the original canonical plan digest, its full commissioning file, its optional complete matching packet and any additional original source files. Each source descriptor has its original filename, complete-file SHA256, source URL and observation time. Optional bytes verifies the exact original length; optional mediaType retains an additional source document’s actual type (application/json remains the default). Commissioning and packet roles use application/json. The private CoCart/Zeeve commissioning package supplies its filled input and all four original files. Query.Farm, ARS and Lutra use their own complete original commissioning sources and receiving packets with their matching installed profile IDs. Supplier catalogue and order programmes use the complete source preparation and native receiving path in [Supplier workshares](SUPPLIER_WORKSHARES.md).

~~~sh
starforge grant-installation-receive \
  --operations-cli "$SCF_MODEL_ROOT/workspace/cli.py" \
  --workspace "$SCF_WORKSPACE" --case "$SCF_CASE" --plan "$SCF_PLAN" \
  --inputs "$SCF_PAIR_FILES/PAIR_RECEIVING.json" \
  --source-root "$SCF_PAIR_FILES" --out "$SCF_OUTPUT" \
  --receiving-workspace "$SCF_RECEIVING_WORKSPACE" \
  --actor "$SCF_ACTOR" --receiving-actor "$SCF_RECEIVING_ACTOR"
~~~

The selected original case and plan are required. The receiving workspace is a separate operator-selected workspace. Node 22 and the original Python Operations application execute the operation; the driver uses the same native preview, save and complete-case importer as the browser.

The driver retains all selected complete files privately, reuses matching original attached bytes, and reads the actual case version for each mutation. It receives the complete native Workshare seed, composes the customer workorder, obtains the original preview and saves that edition. An existing installation is found by its original Workshare case. Native source refresh preserves its current task, payment, deployment, receiving fields and observed checks; changed original phases follow the native source-refresh rules. If its complete native document already matches, the existing saved edition is reopened.

The input's optional customer **bindings** object edits only **merchantDeploymentId**, **buyerDeploymentIds**, **task**, **source**, **payment** and **receiving**. A first PLANNED edition can retain pending customer selections. Existing operated installations retain their stage and native observations while the original preview resolves supplied edits and source changes.

Once every customer is saved, one complete Installation ZIP carries the entire original operating case, all sources, records and saved editions. The native receiving importer opens that complete case once, and the driver reopens every selected original Installation identity and edition in that receiving case. The private output includes each original seed, editable bindings/input, complete human workorder, the complete case ZIP and one native receiving result identifying both original and receiving cases.

Interrupted source attachment or save is recovered from the original case's retained source and Installation identities. Reusing the same complete exported ZIP keeps the original importer request identity. The same output directory retains its exact selected invocation. Choose a new output directory for an intentionally changed receiving input. Original case-version conflicts are reconciled from a fresh native case; the original application remains the writer and source authority.


## Propply / RentCheck property commissioning

The `property-inspections` profile and [complete property commissioning guide](PROPERTY_COMMISSIONING.md) cover one actual buyer team/environment, the complete roster of at most 50 NYC properties, up to three existing templates, two authentic source editions and one existing report/PMS route.

`starforge grant-installation-workorder property` (or `node prepare.mjs property`) uses the same maintained source. Its `workshare` command receives the full original cohort JSON, authors an explicitly proposed six-phase source, and calls the original Workshare normalizer before publication. The exact original USD 14,400 / 20-active-day proposal retains 84 assigned phase hours plus 16 included unallocated contingency hours. Native plan, cost, cash and customer acceptance records are created only through their existing operations.

The `template`, `revise`, `inspect` and `prepare` commands retain the complete property/identity/rights/host/field/payment selection. The current case catalogue resolves actual source attachments while the selected file keeps its original case/plan identity. The `review-template` and `review` commands cover every property, source outcome, original inspection/report, exception, five customer examples and independent reopen, then produce the existing native Installation Return input.

`property editor --out PRIVATE_DIRECTORY` produces the full offline editor, including the actual maintained compiler and original preparation core. It edits the whole ordered roster, opens all native/source inputs, exports every loaded file with its exact digest and reopens that complete input packet. It performs no service or native case call. The CLI and editor use the original Installation preview/save/return/import flow; 1FB3 retains the Property runtime and original paid HPD operation.

Keep these complete additions with this directory: `property-inspections.json`, `property-commissioning-core.mjs`, `property-commissioning.mjs`, `property-commissioning-view.mjs` and `PROPERTY_COMMISSIONING.md`. The original `grant-operations` distribution selects this complete component and `sf47_budget_model`; its source collector carries these files and the native Workshare parser at their original relative paths.

### Native CanadaBuys source in the browser desk

`canadabuys package --source PRIVATE_PREPARATION --out PRIVATE_DIRECTORY/CanadaBuys_Source.zip` exports the complete verified five-file native preparation. In the existing Grant Operations case, retain that ZIP in **Prepare original source workshares**, receive its native source, review every selected Workshare edition and phase, and attach the complete set before opening the editable Installation. See [the native Workshare guide](CANADABUYS_NATIVE_WORKSHARES.md#open-the-prepared-source-in-the-existing-browser-desk) for the exact installed command and original-case flow.

## Rialto customer receiving and Installation

Select **rialto-customer** to connect one original paid HTTP service and useful customer request to its native commercial Workshare and Customer installation. The [complete Rialto programme](RIALTO_CUSTOMER.md) covers the actual service/request, original SF88 buyer, full private source receiving, native preview/save and independent case handover.

The installed `starforge rialto-customer installation` command snapshots the complete original request and calls this directory’s maintained preparation core. It retains the exact native seed, bindings and profile, preserves all original commercial phases, funded assignments and acceptance checks, and produces the complete Installation document, preview envelope and workorder. The proposed USD 1,500 / five-working-day scope keeps its original USD 450 service, USD 650 buyer/receiving and USD 400 handover allocation; actual effort, milestones, account authority and observed acceptance remain in their original records.
