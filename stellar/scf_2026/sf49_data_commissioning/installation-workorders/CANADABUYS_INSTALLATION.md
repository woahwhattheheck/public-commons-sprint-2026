# CanadaBuys customer commissioning and complete installation

Select **canadabuys-bidder-desk** in the existing Installation Source Desk or native workorder preparer when the original customer case commissions the CanadaBuys procurement and bidder workflow.

This profile joins the complete application to the original grant Operations case: retained source editions, company capability/evidence review, saved decisions, complete report and workspace publication, independent editable receiving, and the named operator's handover. The existing Workshare supplies the actual scope, commercial terms, phase owners, effort and acceptance criteria.

## What the customer receives

The application retains original federal procurement files and their import/retrieval history. The operator chooses a notice and source edition, reviews the company's declarations and supporting evidence, records requirement assessments, then saves a reasoned decision against the exact native context. A new amendment or changed evidence remains a new review; earlier source and decisions remain available.

The installed customer interface lets a customer's engineer or Claude tool workflow use those same native records through the existing authenticated MCP endpoint. It exposes complete revision-bound reads, durable change requests, original-publication reconciliation, verified file downloads and offline package receiving.

| Operating surface | Maintained entry |
| --- | --- |
| Native workspace, official-source capture/import and bidder browser | Installed `canadabuys` command |
| Customer's existing authenticated MCP connection | Installed `canadabuys-customer` command |
| Typed original client | `./merchant/canadabuys/client` |
| Complete download and offline receiving | `./merchant/canadabuys/download` |
| Original request planning, progress and recovery | `./merchant/canadabuys/operations` |
| Commissioning profile and complete original seed preparation | `starforge grant-installation-workorder` |
| Original complete source/case preparation | Installation Source Desk |
| Original independent Installation case receiving | `starforge grant-installation-receive` |

The full operator forms, native source contracts and decision fields are documented in [BIDDER_DESK.md](../../../scf-starforge-20261009/sf30-seller-sdk/canadabuys/BIDDER_DESK.md). The complete customer API, durable requests and installed CLI are documented in [CANADABUYS_CUSTOMER.md](../../../../stellar-forge/mcp-merchant-operator/CANADABUYS_CUSTOMER.md). Use the actual installed edition selected for the case.

## 1. Select the original customer case

Start with the existing Operations case and its complete original Workshare. If an Installation already represents that work, reopen its selected edition through **Use this edition as a draft**. The profile preparer accepts a fresh planned seed for a new Installation; it does not replace an operated installation.

Receive these selections from the existing case:

| Selection | Actual retained source |
| --- | --- |
| Commercial scope and parties | Complete original Workshare, receiving packet and customer identity |
| Original phases and effort | Original owners, criteria, dependencies, hours and their supporting source pointers |
| Source population | Complete original CSV/edition, notice IDs, retained revisions and agreed review bounds |
| Decision owner | Customer's actual named operator and evidence/decision authority |
| Installed application | Selected source commit, complete built archive and SHA-256 |
| Existing merchant access | Endpoint, configured aliases, observed native workspace UUID and credential reference |
| Receiving environment | Actual Linux host, Node 24 or later, flock, named engineer and private persistent workspace |
| Commercial/funding selection | Original phase fee/milestones and original funded assignments |
| Merchant paid unit, when selected | Existing deployment IDs, approved atomic price/task count/budget and authority |

The source and paid unit need explicit selection. A published tender's estimated value or award amount is procurement data. It does not supply the operator's service price. An example profile or successful local fixture does not supply customer permission, an accepted bid, a paid purchase or a grant milestone observation.

Keep the grant's original budget and funded packages in their existing plan. The maintained preparation engine copies the original workorder, assignments, checks, Workshare, workflow periods and coordination fields without changing their values. This profile contributes technical instructions; it does not alter phase allocation or record a new acceptance.

### Receive complete original Workshare documents

The [Source Desk guide](../../sf47_budget_model/workspace/INSTALLATION_SOURCE_DESK.md) provides the original browser flow. Open **Source preparation**, retain all original files, select the exact original Workshare and map every phase's original effort source. Choose this profile for the CanadaBuys row. Then **Save complete selection → Prepare complete native package → Attach complete cohort to this case → Open native Installation preparation**.

The current source helper already discovers installed profile JSON files. For a retained complete source selection, its existing terminal entry is:

~~~sh
starforge grant-installation-workorder sources \
  --selection "$ORIGINAL_SELECTION_JSON" \
  --source-root "$ORIGINAL_COMPLETE_FILES" \
  --out "$PRIVATE_SOURCE_PREPARATION" \
  --python "$ACTUAL_PYTHON"
~~~

The original selection row's profile value is `canadabuys-bidder-desk`. Keep every other original case/plan/packet/effort/source field. The helper validates the complete original Workshare with the maintained native importer and returns the full commissioning file, full receiving packet, original source files, `SUPPLIER_RECEIVING.json` and source-preparation receipt. The historical output filename is retained by the shared helper for all supported customer programmes.

Do not create a substitute workshare packet from this guide. Use the customer's complete actual commercial source and exact plan digest. The original source helper validates explicit phase-ID amendments, source filenames, complete effort mappings and actual installed profile hashes.

## 2. Prepare the original Installation binding

Discover the profile in the selected installed edition:

~~~sh
starforge grant-installation-workorder profiles
~~~

The result includes its full byte count and SHA-256. Retain that source identity with the original case. A later installed profile is a new source selection.

Obtain the fresh original seed through the existing Installation Source Desk, or run the native Workshare seed command from the original `sf47_budget_model` directory:

~~~sh
python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-workshare-seed \
  --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --source "$COMMISSIONING_SOURCE" --expected-source-sha256 "$COMMISSIONING_SHA256" \
  --packet-source "$PACKET_SOURCE" --expected-packet-sha256 "$PACKET_SHA256" \
  --workshare-case "$COMMERCIAL_CASE" --expected-revision 0 \
  --output "$PRIVATE_OUTPUT/original-seed.json"
~~~

Every variable selects an actual original record or file. Retain the complete returned envelope, including the case version, plan revision and both plan digests. Then prepare a complete binding template:

~~~sh
starforge grant-installation-workorder template \
  --profile canadabuys-bidder-desk \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --out "$PRIVATE_OUTPUT/canadabuys-bindings"
~~~

Complete its actual selections:

- `merchantDeploymentId` and `buyerDeploymentIds` come from deployments already recorded in the original case.
- `source.reference` names the complete retained CanadaBuys edition/receipt, selected notices and customer evidence boundary.
- `source.authority` records permitted source and customer-evidence use.
- `source.sourceIds` and `receiving.sourceIds` add original case attachment IDs while preserving the source closure already present in the seed.
- `receiving.host` and `receiving.operator` name the real environment and responsible engineer.
- Payment fields retain original native selections. Atomic amounts are decimal integer strings, the useful task count is an integer, and an unselected numeric field stays null.

For a customer's source or output scope that needs additional detail, the original binding schema permits explicit `task`, `source` and `receiving` fields. Keep original endpoint tokens, evidence permissions and private attachments outside public source. The workorder records their references and accountable owners.

Emit the complete native input:

~~~sh
starforge grant-installation-workorder prepare \
  --profile canadabuys-bidder-desk \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --bindings "$PRIVATE_OUTPUT/canadabuys-bindings/bindings.json" \
  --out "$PRIVATE_OUTPUT/canadabuys-installation"
~~~

The original preparer writes `installation-input.json`, `installation-preview-input.json`, `WORKORDER.md` and `preparation.json`. Existing exact outputs reopen; a different existing output is preserved. The report lists unresolved actual selections. Preparation remains local and makes no provider call.

Open **Customer installations → Load input file → Preview → Save** in the same case. Retain the original save request and native returned installation ID, revision and case version. A response interruption is resolved through that original request. A subsequent change uses the existing saved Installation draft.

## 3. Operate the installed CanadaBuys customer

Build and install the maintained `canadabuys-customer` selection from the actual source commit. The [customer guide](../../../../stellar-forge/mcp-merchant-operator/CANADABUYS_CUSTOMER.md#installed-entry-and-source) gives the complete original builder/runtime installer commands and typed exports. The native workspace requires Node 24 or later with SQLite; durable local commands use the existing Linux flock utility.

Create the customer's private connection template:

~~~sh
umask 077
mkdir canadabuys-customer-work
canadabuys-customer connection-template \
  --out canadabuys-customer-work/connection.json
~~~

Fill the actual existing endpoint, configured workspace alias and credential environment-variable name. Keep the token value in the original credential mechanism. Bind the alias to the observed native workspace:

~~~sh
canadabuys-customer bind \
  --connection canadabuys-customer-work/connection.json \
  --out canadabuys-customer-work/bound-connection.json
~~~

Later calls compare that original workspace UUID. The client does not create merchant configuration or infer server input paths from local files.

Read the original tool catalogue and the complete stable notice collection:

~~~sh
canadabuys-customer tools --out canadabuys-customer-work/tools.json

canadabuys-customer read \
  --connection canadabuys-customer-work/bound-connection.json \
  --tool status --all \
  --out canadabuys-customer-work/notices.json
~~~

For evidence intake, the merchant operator first supplies an existing configured input alias. Read its actual hash through the original `inputs` tool. An evidence request selects that alias and expected SHA-256. The original provider retains the complete input bytes.

### Save a reasoned decision

Use the original bidder workflow in this order:

1. Read the selected notice and source entry, its current retained edition and amendments. Inspect the actual solicitation and submission instructions.
2. Read or save the actual company profile. Preserve original capability declarations and review status.
3. Retain full supplier evidence and original requirement assessments, with exact source/evidence revisions and reviewer references.
4. Call `bidder_assess` for the original notice/source/profile revision. Retain the returned `contextSha256`.
5. Save a decision using that same selection/context, the operator's choice and rationale. Mandatory unknowns stay visible and require review.
6. Reopen the saved decision. Use `bidder_compare` when source/evidence changes; preserve both the earlier decision and the later review.

The actual request fields and native TypeScript types are in the maintained customer and bidder guides. Create/update requests use the original `commandId` and expected revision. A create uses the original global workspace revision; an update uses the selected record revision. The customer wrapper retains the exact input rather than substituting a newer revision after a conflict.

Plan each change offline before running it:

~~~sh
canadabuys-customer plan \
  --connection canadabuys-customer-work/bound-connection.json \
  --directory canadabuys-customer-work/decision-operation \
  --operation-id "$ORIGINAL_DECISION_OPERATION" \
  --tool bidder_create \
  --args "$ORIGINAL_DECISION_REQUEST_JSON" \
  --out canadabuys-customer-work/decision-plan.json

canadabuys-customer run \
  --directory canadabuys-customer-work/decision-operation \
  --out canadabuys-customer-work/decision-response.json
~~~

Keep the original request/result files. A later observation uses a new output filename. The entered request and complete response are separate retained records; an original committed bidder command can resolve through native command history.

## 4. Reconcile, download and receive the complete original publication

Publish the agreed decision or supplier report and native package through the original `export` tool. Retain the publication UUID from its actual response.

If an export response is unknown, first read local `show` and the merchant's existing publications. Keep the original export unresolved until its actual publication is identified. The explicit recovery route is:

~~~sh
canadabuys-customer publication-selection \
  --directory "$ORIGINAL_EXPORT_OPERATION_DIRECTORY" \
  --out "$PRIVATE_OUTPUT/original-publication-selection.json"
~~~

Fill that selection with the observed original publication UUID and reason/source evidence. Keep its original operation ID and request SHA. Then:

~~~sh
canadabuys-customer adopt-publication \
  --directory "$ORIGINAL_EXPORT_OPERATION_DIRECTORY" \
  --evidence "$PRIVATE_OUTPUT/original-publication-selection.json" \
  --out "$PRIVATE_OUTPUT/adopted-original-publication.json"
~~~

Adoption reads and validates the original publication; it does not launch another export.

Inspect its complete manifest, retain the reviewed manifest SHA, and download every listed file:

~~~sh
canadabuys-customer inspect-publication \
  --connection canadabuys-customer-work/bound-connection.json \
  --publication-id "$ORIGINAL_PUBLICATION_ID" \
  --out canadabuys-customer-work/original-publication.json

canadabuys-customer download \
  --connection canadabuys-customer-work/bound-connection.json \
  --publication-id "$ORIGINAL_PUBLICATION_ID" \
  --manifest-sha256 "$ORIGINAL_MANIFEST_SHA256" \
  --directory canadabuys-customer-work/original-download \
  --out canadabuys-customer-work/download-receipt.json
~~~

The retained writer verifies complete file lengths/hashes and checkpointed prefixes. Reopening uses the same original publication and directory. Each actual retained read lease is released; an expired reader may be reopened against the same exact file.

For a workspace-package publication, verify and receive offline:

~~~sh
canadabuys-customer verify \
  --directory canadabuys-customer-work/original-download \
  --publication-id "$ORIGINAL_PUBLICATION_ID" \
  --manifest-sha256 "$ORIGINAL_MANIFEST_SHA256" \
  --out canadabuys-customer-work/offline-verification.json

canadabuys-customer receive \
  --directory canadabuys-customer-work/original-download \
  --publication-id "$ORIGINAL_PUBLICATION_ID" \
  --manifest-sha256 "$ORIGINAL_MANIFEST_SHA256" \
  --workspace-directory canadabuys-customer-work/received-workspace \
  --expected-revision 0 --operator customer \
  --title "Customer procurement desk" \
  --out canadabuys-customer-work/receive-receipt.json

canadabuys serve \
  --workspace canadabuys-customer-work/received-workspace \
  --operator customer
~~~

Use expected revision zero only for an empty receiving workspace. For an existing receiver, read its actual current revision and use that native expectation. Open the printed loopback URL, then **Bidder desk → Decision & reports** and the delivered saved decision. Its retained source/profile/evidence/context is the decision's original selection.

Make the agreed local correction, close/reopen the workspace and receive the earlier package again using the actual current revision. Retain the returned native result and confirm the newer local work is preserved. A conflict remains explicit.

The installed CLI/MCP operation is browser-free for automated receiving; this operator walkthrough uses the customer's existing browser. The complete queued customer receiving programme and the operator's real commissioning remain distinct execution records.

## 5. Complete the original Installation and milestone evidence

The Workshare's existing phase criteria remain the acceptance boundary. Attach complete original reports and relevant receiving records through the existing Operations Sources; retain the original case's capacity and source limits. Keep large complete private workspace archives in the original artifact delivery and record their actual references, bytes and SHA in the case.

| Actual evidence | Supports |
| --- | --- |
| Complete source retrieval/import record and original source files | Agreed source population, provenance and edition |
| Saved profile, evidence, requirements and decision context | Reviewed useful procurement task |
| Original command/result or explicit publication adoption | Recovery of the same operation |
| Complete publication manifest and download verification | Returned complete files and byte custody |
| Native package receive, reopen and later-local-edit preservation | Independent editable customer operation |
| Named walkthrough result and original phase disposition | Customer's actual acceptance/review allowance |
| Original Installation save/export/receive receipt | Full operating-case handover |
| Original invoice/payment/settlement record, if present | Its actual commercial outcome |

Only the existing authorized operator records acceptance in the original Installation. An authored profile, successful preparation, merged implementation or source review is not a native receiving result. Likewise, application receiving is not a bid submission, an authority's eligibility determination or a commercial payment.

For complete original-case receiving after source preparation, use the unchanged native driver:

~~~sh
starforge grant-installation-receive \
  --operations-cli "$SCF_MODEL_ROOT/workspace/cli.py" \
  --workspace "$SCF_WORKSPACE" --case "$SCF_CASE" --plan "$SCF_PLAN" \
  --inputs "$PRIVATE_SOURCE_PREPARATION/SUPPLIER_RECEIVING.json" \
  --source-root "$PRIVATE_SOURCE_PREPARATION" \
  --out "$PRIVATE_INSTALLATION_RECEIVING" \
  --receiving-workspace "$INDEPENDENT_OPERATIONS_WORKSPACE" \
  --actor "$RECORDING_OPERATOR" --receiving-actor "$RECEIVING_OPERATOR" \
  --python "$ACTUAL_PYTHON"
~~~

The complete driver retains source intake, original Workshare seed, full prepared Installation, actual preview/save and complete operating-case export/import. Keep its exact inputs and original request prefix when resuming. A complete case includes its planning archive, sources, original case and Installation histories. Reopen the selected original Installation in the receiving case.

## Source and execution status

The source-owned customer integration is [PR894](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/894), merged as `b3c52362c64027ba5744c5a459432eb7aeede9b7`. Its immutable installed receiving input selects application commit `950bbacb7a55b53c43b74164679e0070cb1f9154` and the complete programme under `operations/canadabuys-customer-complete-delivery-6ba15-20261013/`.

The earlier Bidder Desk application has actual 17-phase native/browser acceptance and five reviewed operator images, retained in its original delivery. The additive installed authenticated-MCP customer programme has full reviewed source; at this profile's authoring its actual 13-phase installed receiving and four output saves remain pending. Select the actual returned result before advancing that status. No original customer Workshare, grant Installation or source acquisition is replayed by installing this profile.

The original grant application/reader owners retain the cumulative catalogue, canonical manuscript and funded milestones. This maintained profile and guide can be selected by that existing application without changing its budget or restating pending execution as completed.

## Maintained source contracts

- [Original profile discovery](profiles.mjs) reads every complete installed profile and its exact byte identity.
- [Original preparation engine](prepare-core.mjs) preserves native commercial/funding/acceptance fields.
- [Original source helper](source-inputs.py) verifies complete Workshares, effort mappings and source files.
- [Original native Installation receiver](receive.mjs) performs full original-case receiving.
- [Installation workorders guide](README.md) documents all shared commands and receiving rules.
- [Original Installation Source Desk](../../sf47_budget_model/workspace/INSTALLATION_SOURCE_DESK.md) carries browser, CLI, HTTP and request-recovery operation.
