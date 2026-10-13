# Rialto customer Installation programme

Connect one real Rialto-discovered HTTP service to its customer task, original buyer operation and the existing Customer installations record. The complete request and source travel with the prepared native document. The original Workshare, SF47 case and buyer remain the continuing operating records.

## Commercial scope and useful outcome

The existing offer is a proposed **USD 1,500 service-specific implementation**, with **five working days after the service, customer task and authorized test account are available**.

| Component | Proposed fee | Complete customer delivery |
| --- | ---: | --- |
| Service and request integration | USD 450 | Original complete catalogue, selected listing, concrete method/query/path/body/headers, useful-output requirement and actual merchant challenge |
| Buyer and receiving integration | USD 650 | Original SF88 review/operation, customer's useful response and complete private receiving package |
| Handover and change handling | USD 400 | Operator guide, complete catalogue refresh comparison, interruption/recovery course and independently reopened edition |

The component split describes the proposed implementation scope. Actual phase effort, payment milestones, invoice triggers and agreed terms come from the original commercial Workshare. The source preparation keeps those records intact. Service fees, hosting and authorized balances retain their own actual cost owner.

The prospective SCF application remains USD 38,000, 400 prospective hours, six packages and 150 days. Customer-specific commissioned work and prospective grant work retain their respective assignment in the original case.

The original [WORKSHARE.md](../../../scf-starforge-20261009/partners/rialto/WORKSHARE.md) supplies the exact offer, scope, acceptance and commencement. [The installed product guide](../../../../products/rialto/README.md) supplies the original catalogue, request, buyer and private receiving commands.

## Continuing roles and source

| Role | Continuing responsibility |
| --- | --- |
| Commercial owner | Original prospect relationship, proposed/agreed scope, payer, price status, schedule and terms |
| Service owner | Actual service contract, permitted source use, endpoint/account configuration and merchant terms |
| Customer operator | Useful task, complete output requirement, independent buyer and original payment authority |
| Installation engineer | Complete source/request integration, actual native workflow and original case preparation |
| Acceptance owner | Record the actual agreed service, receiving and handover criteria in their original phases |
| Receiving engineer | Reopen full source and native buyer operation, continue the saved Installation and maintain the application |

Engineering retrieves public service documentation and original catalogue data directly. Customer interaction resolves business fit and the selected task. Private credentials use the customer's existing authorized configuration path. Source attachment IDs, original deployment IDs and operating owners are selected from the native case.

## 1. Retain the complete original request

Use the maintained installed Rialto workflow to capture the complete original catalogue. Every offset page, full body/header/status and observation interval remains attached. Review the reported population and coverage findings, select the actual HTTP resource/payment option, and describe the customer's complete useful output.

When the service publishes path parameters, enter the customer's actual values in **Review source → Published path inputs → Apply path values**. Concrete advertised segments stay fixed. The complete URL retains the selected query. Save the original method, body, ordinary headers, cap and stable customer intent.

~~~sh
starforge rialto-customer capture --directory "$CATALOGUE"
starforge rialto-customer select --source "$CATALOGUE" \
  --selection "$SELECTED_REQUEST_JSON" --directory "$ORIGINAL_REQUEST"
starforge rialto-customer challenge --directory "$ORIGINAL_REQUEST"
starforge rialto-customer prepare --directory "$ORIGINAL_REQUEST" \
  --accept "$ACTUAL_CHALLENGE_OPTION"
~~~

Use the actual prepared native config and original buyer review/approval workflow from the installed guide. Preparation and actual purchase/results retain their original stages. The request's complete original source is useful for installation preparation before and after a purchase; its actual acceptance is recorded when observed.

An interrupted unsigned request retains its original attempt marker. Reusing its capture ID does not silently dispatch it again. Native buyer recovery keeps the original intent and receipt. A distinct useful customer request has an explicit distinct intent.

## 2. Continue the original customer case and workshare

Open the existing SF47 case and inspect **Customer installations**. If the customer already has a saved Installation, continue **Use this edition as a draft** and its current source. Attach the complete Rialto request/preparation as source and use that original revision's edit, preview, save and recovery. The new-preparation command below uses the maintained fresh-seed contract.

For a new Installation, retain the customer's complete commercial commissioning input and receiving packet in the existing case's Sources. Select their actual IDs and complete hashes. From the original sf47_budget_model directory:

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

Keep the whole returned seed envelope: source, document, native selection and original Workshare. The packet flags are supplied together when that packet is attached. The original [INSTALLATIONS.md](../../sf47_budget_model/workspace/INSTALLATIONS.md) and [complete workorder guide](README.md) define the native browser, CLI and receiving contract.

## 3. Select the actual receiving and payment bindings

The maintained profile loader discovers rialto-customer.json in this directory. Create its binding template through the original Grant Operations installation tool:

~~~sh
starforge grant-installation-workorder profiles

starforge grant-installation-workorder template \
  --profile rialto-customer \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --out "$PRIVATE_OUTPUT/rialto-bindings"
~~~

The same preparer is available as node prepare.mjs from this directory.

The template already binds the original case/version, plan/revision/digests and commercial case. Complete the actual merchant/buyer deployment IDs, source-use authority, original source attachment IDs, reviewed payment selections and receiving host/operator. The original payment fields use exact atomic strings, whole task counts and the approved aggregate budget. Unselected numeric fields remain null.

The Rialto bridge fills blank task/request/source-reference descriptions from the actual retained request and keeps a full readable request annex. It preserves explicit customer-specific descriptions. It checks any selected network, asset and recipient against the original Rialto terms and keeps the unit price within the selected cap. Account authority, actual challenge review, facilitator selection and payment execution remain with the original buyer and case owner.

## 4. Prepare the complete native document from the actual request

Use the original request directory and the complete native seed/bindings:

~~~sh
starforge rialto-customer installation \
  --directory "$ORIGINAL_REQUEST" \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --bindings "$PRIVATE_OUTPUT/rialto-bindings/bindings.json" \
  --out "$PRIVATE_OUTPUT/rialto-installation-001"
~~~

The destination is a new private directory outside the original request. The preparation snapshots the entire original request under its existing native writer lock, verifies that snapshot with the original Rialto request verifier, and calls the maintained prepareInstallation function. It preserves the original commercial fields, funded assignments, native checks and newer case coordination fields.

| Retained output | Use |
| --- | --- |
| request/ | Complete original request, every captured catalogue source, body/headers and available native operation/history |
| source/seed.json | Byte-exact original native seed |
| source/bindings.json | Byte-exact operator bindings |
| source/profile.json | Byte-exact installed profile used for preparation |
| derived-bindings.json | Complete original bindings with the selected request's blank descriptive fields filled |
| RIALTO_REQUEST.json / RIALTO_REQUEST.md | Complete selected method/URL, original task/output, path binding, source identities and advertised terms |
| installation-input.json | Complete native Installation document |
| installation-preview-input.json | Original API preview envelope |
| WORKORDER.md | Full native task/source/payment/receiving, original commercial phases and implementation |
| preparation.json | Original source identities, remaining actual selections and complete retained file inventory |

The original request and profile source are preserved in full even when a native description field has a size limit; the workorder points to the full request annex.

Reopening the same output with the same original seed, bindings and selection returns its retained edition. Changed inputs use a new preparation directory. A later native result or catalogue edition is captured in that later preparation; the prior edition stays usable.

## 5. Preview and save in the original Installation

Open **Customer installations → Load input file → Preview → Save** in the existing operating case, using installation-input.json.

The equivalent original CLI course, from sf47_budget_model, is:

~~~sh
python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-preview --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --expected-revision 0 \
  --document "$PRIVATE_OUTPUT/rialto-installation-001/installation-input.json" \
  --output "$PRIVATE_OUTPUT/rialto-native-preview.json"

python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-save --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --expected-revision 0 \
  --document "$PRIVATE_OUTPUT/rialto-installation-001/installation-input.json" \
  --expected-preview-sha256 "$NATIVE_PREVIEW_SHA256" \
  --actor "$RECORDING_OPERATOR" --request-id "$ORIGINAL_SAVE_REQUEST" \
  --note "$INSTALLATION_REASON"
~~~

Retain the returned Installation ID, revision and case version. Resolve an uncertain save with the original request journal before issuing another request. Later edits use that same saved Installation's original draft and current revision.

The preparation leaves original acceptance checks open. Record actual service/output, buyer receiving and handover observations in their existing native phases as the work occurs. A successful source preparation provides the working document and original inputs; its commercial acceptance remains the actual native customer record.

## 6. Export and independently reopen the whole preparation

Inspect the retained preparation, then use its complete export command. This command fences the retained request's native writer while the full edition is checked and packed.

~~~sh
starforge rialto-customer installation-open \
  --directory "$PRIVATE_OUTPUT/rialto-installation-001"

starforge rialto-customer installation-pack \
  --directory "$PRIVATE_OUTPUT/rialto-installation-001" \
  --out "$PRIVATE_OUTPUT/rialto-installation-001.packet.json"

starforge rialto-customer receive \
  --file "$PRIVATE_OUTPUT/rialto-installation-001.packet.json" \
  --directory "$PRIVATE_OUTPUT/rialto-received"

starforge rialto-customer installation-open \
  --directory "$PRIVATE_OUTPUT/rialto-received"
~~~

The independent receiver verifies every retained original member, request/source relationship and native seed identity. Original source file paths in receipt metadata describe the source location at preparation time; opening the received edition uses its received relative members.

Keep this prepared edition as the complete original handover. Continue native buyer execution by importing its original operation document into a new native directory, rather than executing a config that retains the prior machine's paths:

~~~sh
starforge buyer --import-operation \
  --file "$ORIGINAL_BUYER_HANDOFF_JSON" \
  --dir "$NEW_NATIVE_BUYER_DIRECTORY" \
  --accept "$ORIGINAL_SELECTED_OPTION"
~~~

Use the import's returned config with the original buyer --review and an explicit new --response-out destination, as described in the installed Rialto operating guide. Continue the same useful intent and native recovery. The full private edition includes any original native handoff present in request/; choose that actual retained operation file.

The native SF47 Installation has its own complete-case handover. Use the original installation-export or **Download complete handover**, receive its full ZIP through Operations import, and reopen the selected original Installation. Keep its original source attachments, plan, case history and selection.

## 7. Complete the priced customer handover

The original commercial acceptance maps to the actual delivery:

1. Review the customer's selected request and actual merchant terms against the useful-output requirement.
2. Complete the original buyer operation and retain its full response/result and recovery state.
3. Have the receiving operator import and review the same original operation in its new native directory.
4. Capture a full later catalogue edition and compare all original resource identities and terms; retain the complete comparison.
5. Record the actual acceptance and agreed correction in the native Workshare/Installation phases.
6. Deliver the complete private Rialto preparation, native buyer handoff, original SF47 case handover, installed source/runtime and operating guide.

A later useful task follows the selected service's actual cadence. Its original request, useful output and commercial assignment remain explicit. Continue favorable prospect conversation through the relationship owner and keep engineering preparation in the original operating case.

## Source and installation

The profile is discovered through the existing profiles.mjs loader. The source-native preparation bridge is partners/rialto/installation.mjs; it calls the existing prepare-core.mjs and original Rialto request verifier. It does not create an SF47 case or save an Installation itself.

The selected Rialto package carries that bridge, profile and both original preparation dependencies. Grant Operations carries the whole maintained workorder component, so the same profile is available through its existing profile catalogue. Full Merchant source combines both original applications. Reuse their complete source, runtime and receiving procedures.

The original current source is the merged Rialto product and route-input workflow, the maintained SF47 preparation/importer, and the retained customer's actual Workshare and request. Preserve current same-file owner changes when joining source into an existing installation.

## Complete customer catalogue decision

A source comparison and the customer’s review can be retained with the original request before preparing this Installation. Download the original request selection and complete comparison from the offline Rialto report, then add `--catalogue-review /absolute/downloads/rialto-complete-comparison.json` to `starforge rialto-customer select`.

Receiving validates the complete review against the selected after catalogue and original row before creating the request stage. The byte-exact review, complete before/after sources and self-contained report remain under `catalogue-review/` with the original request. Review notes and carried drafts preserve the customer’s source decision while the explicit selected URL, request body/headers, offer and cap retain their established meanings.

The existing Installation preparation snapshots and verifies that whole request. `RIALTO_REQUEST.md` links the complete review at `request/catalogue-review/report.html` and original JSON at `request/catalogue-review/received.json`; the structured annex retains the exact source binding. `installation-open` verifies the full receiving edition and returns its local review-report path. The complete Installation pack and ordinary receiving command carry all of these files. Existing editions without a review retain their original summary and workorder.

Use the [complete source-comparison and customer receiving guide](../../../scf-starforge-20261009/partners/rialto/CATALOGUE_COMPARISON.md) for the exact select command, source coverage interpretation, original request continuation and independent reopening.
