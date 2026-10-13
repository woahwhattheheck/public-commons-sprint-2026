# Return a completed Installation to its owner

An Installation return carries a named receiving report back to the original owner. It retains the saved edition, every original acceptance criterion, complete source files and the recorded work or purchase observations used during receiving. The owner compares that report with the current Installation, chooses which observations to apply, stages the complete evidence, and confirms the next edition through the existing Installation preview and save.

This is part of **Delivery operations → Receiving returns** in the existing Grant Operations application. Its HTTP, native CLI, typed client and MCP routes use the same workspace, case, source records, review table, transaction and request journal.

## Operate the complete managed receiving

[INSTALLATION_RETURN_COMPLETE.md](INSTALLATION_RETURN_COMPLETE.md) provides the complete current-source entry point. It runs the original native model, CLI and cold receive, then opens the same saved case through the managed application, typed client, MCP and desktop/mobile Page. It closes its owned service and browser before publishing one full customer archive. The optional `--core-only` stage preserves the original core result while the host completes an existing browser programme; the same saved input then finishes the Page journey.

## The complete customer journey

1. In **Customer installations**, select the saved Installation edition and download its complete case ZIP. The package includes the original plan, all earlier Installation editions, recorded operating history and every attached source.
2. The receiving operator imports that whole ZIP using **Import complete case**. The new local case keeps the original Installation and source identities.
3. In **Receiving returns → Record receiving**, select the exact Installation and edition. All checks begin OPEN. Attach the complete actual output and supporting files in **Sources**, then enter the observed state, named operator, UTC observation time and result for every check. Include unfinished work and corrections.
4. Preview the full report. Source, configuration or deployment changes are visible. Save the exact report with a reason, then download its complete returned case ZIP from **Saved reports**.
5. The owner imports the returned ZIP, reopens the original owner case, and opens **Review a return**. Select the imported case and original returned report.
6. For each original check, explicitly choose **Keep current owner observation** or **Apply this returned observation**, with a reason. Preview the complete selection. Start with KEEP when reviewing changes; an APPLY against a changed definition is refused.
7. **Stage explicit owner choices** retains the complete report and original evidence files in the owner case. It returns a complete proposed Installation document. Staging leaves the saved Installation unchanged.
8. Preview that proposed document using the original Installation model. Review the full difference, enter the reason, and save the next edition. Earlier definitions and receiving reports remain available.
9. Export the whole owner case and independently import it. Reopen the owner review, selected Installation and original files. Keep the complete received-return ZIP with this final handover when delivering the whole original receiving case.

A review records the statements of its named operator. It does not authenticate a person's identity, constitute an issuer or customer signature, record a grant payment, or convert a walkthrough into an actual customer deployment.

## What can carry forward

The native comparison binds the complete useful task, commissioning terms, source population and meaning, payment selection, receiving configuration, selected deployment records, source metadata and original funding-plan identity. It compares each check's original ID, title, criterion, tranche and required flag separately.

An observation can be applied only while both the receiver's selected basis and the owner's current basis match the original baseline, and that check still has the same definition. Adding a new owner check leaves it unchanged. Removing or changing a check requires fresh receiving for that work. The original return remains readable even when it cannot be applied.

Receiving results do not overwrite the Installation's workorder, task, source policy, payment authority, maintenance responsibility, assignments, recurring-work binding or coordination plan. The proposed document starts from the owner's current saved edition and replaces only the explicitly selected observation fields.

The owner keeps the returned operator, actual observation timestamp, result note and full original file references. A work, purchase or outcome ID is linked directly only when the owner already retains that exact full record. A different or new receiving record stays in the full report as evidence. Staging does not insert contributors, work, invoices, cash, awards, deployments, purchases or outcomes into the owner's accounting tables.

The source-copy receipt retains every original file's metadata and its exact new or reused owner source identity. Identical original source records already present in the owner are reused. A different source URL, observation time or provenance is preserved, even when file bytes happen to match.

## Saved drafts and interrupted replies

The browser retains the full draft under the original case identity. Download the draft before changing devices; **Import full draft** restores it to the same case and rechecks its original saved edition or returned report. A local draft is an editable input, not a saved receiving result.

Before dispatching a mutation, the browser retains its entire request body, original request ID, operator, reason, reviewed case version and preview SHA. If that storage write fails, the browser does not dispatch the request. If the native reply is interrupted, **Continue original request** sends the exact original body through the existing workspace request journal. A committed request returns its original receipt.

When a save reply has returned but its readback has not finished, **Read saved result** reopens the original review and case. Neither continuation generates a replacement receiving report. If the server definitely rejects a request, its body and rejection remain retained and the complete editable draft can be reviewed again.

The native stage and source copies share one original SQLite transaction. A source limit or failed write rolls back the whole stage. The actual Installation save is a separate explicit action. If the owner changes the Installation between staging and that save, the original edition comparison refuses the stale proposal; retain the old owner review and make a current review.

## Native API

Every preview is read-only and checks expectedVersion. Mutations use the existing command endpoint:

~~~json
{
  "expectedVersion": 12,
  "requestId": "the-original-stable-request-id",
  "actor": "Named recording operator",
  "note": "Reason for this saved observation or owner review",
  "action": "installation.return",
  "data": {
    "inputs": {},
    "expectedPreviewSha256": "SHA256_FROM_THE_COMPLETE_PREVIEW"
  }
}
~~~

Use the full inputs described below. The native source validates the exact structure and every original reference.

| Operation | HTTP route / native method |
| --- | --- |
| List saved returns and owner reviews | GET /api/operations/{case}/installation-returns; ops.installation_returns(case) |
| Start a receiving draft | POST .../installation-return-seed; ops.seed_installation_return(case, body) |
| Preview complete receiving observations | POST .../installation-return-preview; ops.preview_installation_return(case, body) |
| Freeze a receiving report | POST .../command, action installation.return |
| Read a complete retained report | GET .../reviews/{review}; ops.review(case, review) |
| Preview owner choices | POST .../installation-return-review-preview; ops.preview_installation_return_review(case, body) |
| Stage owner choices and files | POST .../command, action installation.return-stage |
| Download the selected report and full case | GET .../installation-returns/{review}/export.zip; ops.export_installation_return(case, review) |
| Confirm the proposed Installation | Existing installation-preview, then existing installation.save |
| Receive the complete ZIP | Existing POST /api/operations/import / ops.import_bundle(...) |

The seed body contains expectedVersion, installationId, revision and the exact saved edition sha256. It returns schema stellar-forge.sf47-installation-return.v1.seed, the source binding, baseline reference, editable inputs and original check definitions.

### Receiving inputs

~~~json
{
  "installationId": "installation-ORIGINAL32HEX",
  "revision": 1,
  "sha256": "ORIGINAL_EDITION_SHA256",
  "name": "October receiving",
  "recipient": "Original Installation owner",
  "environment": "Actual application version, authorized host and selected configuration",
  "note": "Whole receiving result, remaining work and limitations",
  "observations": [
    {
      "id": "original-check-id",
      "state": "ACCEPTED",
      "operator": "Named receiving operator",
      "observedAt": "2026-10-12T15:30:00Z",
      "note": "Actual result and any correction",
      "sourceIds": ["source-ORIGINAL32HEX"],
      "workIds": [],
      "purchaseIds": [],
      "outcomeIds": []
    }
  ]
}
~~~

Supply every original check exactly once. Allowed states are OPEN, IN_PROGRESS, ACCEPTED, CHANGES_REQUIRED and NOT_APPLICABLE. ACCEPTED requires an operator, actual observation time and result note. NOT_APPLICABLE requires a reason. The original native Installation normalizer validates every linked source, work, purchase and outcome.

The preview response contains baseline, inputs, the complete observation document, selected snapshot, native report, receivingBasisChanges, basisUnchanged and previewSha256. The saved original review has purpose INSTALLATION_RETURN and retains that complete preview under installationReturn. Its whole-row SHA binds the report as well as its original actor, note, source snapshot and case version.

### Owner inputs

~~~json
{
  "returnedCaseId": "operation-IMPORTED32HEX",
  "reviewId": "review-ORIGINAL32HEX",
  "reviewSha256": "COMPLETE_RETURN_REVIEW_SHA256",
  "installationId": "installation-ORIGINAL32HEX",
  "expectedRevision": 2,
  "name": "Owner review of the complete returned Installation",
  "note": "Apply current observations and retain changed work for another receiving pass",
  "choices": [
    {
      "id": "original-check-id",
      "action": "KEEP",
      "note": "The acceptance criterion changed; obtain fresh receiving."
    }
  ]
}
~~~

The owner must retain the same baseline Installation identity, revision and SHA in its earlier history. Supply exactly one explicit KEEP or APPLY choice for every returned check. Each choice has a reason. The preview binds the owner's current case version and Installation revision, the complete returned report and its native case evidence, original file identities, source/configuration differences and per-check record treatment.

A successful stage returns the normal case receipt with:

- recordId: immutable owner review ID.
- reviewSha256: hash of the entire owner review.
- previewSha256: the exact reviewed original selection.
- installationId, expectedRevision, document: the complete proposal for the existing Installation preview/save.

The saved owner review has purpose INSTALLATION_RETURN_REVIEW. Its installationReturnReview retains the full original preview, source mapping, complete receipt-source metadata and proposed document. It remains available even if a later Installation edition supersedes this proposal.

## Original CLI

All commands run through the original workspace/cli.py operations interface. Close the current native workspace owner before opening the same directory through the CLI.

~~~bash
python3 workspace/cli.py operations \
  --workspace /private/customer-workspace \
  installation-returns --case operation-ORIGINAL32HEX
~~~

Use --help on each command for exact required arguments:

| Command | Selection |
| --- | --- |
| installation-return-seed | --case, --expected-version, --installation, --revision, --sha256 |
| installation-return-preview | --case, --expected-version, --inputs complete JSON |
| installation-return-save | The same inputs, --expected-preview-sha256, --request-id, --actor, --note |
| installation-return-review-preview | Owner case/version and complete owner --inputs JSON |
| installation-return-stage | Same owner inputs and original preview/request/actor/note |
| installation-return-export | --case, --review, new --output ZIP |
| review | Existing --case / --review complete saved object |
| installation-preview, installation-save | Existing full proposed --document and original edition/version controls |
| import | Existing complete ZIP and original import request |

JSON commands print their complete original result unless --output selects a new private JSON file. Source, archive and JSON output use the existing CLI's private publication helper. Preserve any completed output file on retry; a native case export has its own original export timestamp.

## Typed and MCP interfaces

The existing GrantWorkspaceClient exposes these complete native calls:

~~~javascript
client.read('installation-returns', {caseId});
client.installationReturnSeed(caseId, body);
client.installationReturnPreview(caseId, {expectedVersion, inputs});
client.installationReturn(caseId, {
  expectedVersion, requestId, actor, note, inputs, expectedPreviewSha256
});
client.installationReturnReviewPreview(caseId, {expectedVersion, inputs});
client.installationReturnStage(caseId, {
  expectedVersion, requestId, actor, note, inputs, expectedPreviewSha256
});
client.download('installation-return', {caseId, reviewId});
~~~

The complete declaration file names the receiving input, every observation field, explicit owner choice, preview, save receipt and staged document. The original typed response envelope and connection authority remain unchanged.

Corresponding MCP tools are merchant_grant_installation_returns, merchant_grant_installation_return_seed, merchant_grant_installation_return_preview, merchant_grant_installation_return, merchant_grant_installation_return_review_preview and merchant_grant_installation_return_stage.

Use existing merchant_grant_review for the complete saved object. Use merchant_grant_export with kind installation-return, caseId and reviewId, then the original retained file-read/download mechanism to receive every byte. The existing snapshot paging and original-input references apply to large previews. Select the complete staged /document from the retained native response as the input to merchant_grant_installation_preview, then explicitly confirm merchant_grant_installation_save.

## Complete portable reconstruction

This feature adds two optional files to the original Operations export: installation-return-selection.json and installation-return.html. The selection identifies the complete saved review and readable report by exact bytes and hash. The original operations.json, planning.zip, source members, Installation histories and all other report files remain in the same native case ZIP.

The original importer validates the manifest, complete member set, every source, original planning history and all saved Installation editions. Return validation reconstructs each receiving report from its original input and snapshot, verifies its original baseline and record history, and checks the matching native save event.

For an owner stage, receiving reconstructs the complete preview from the retained owner context and full returned evidence. It verifies every source mapping against the actual full file bytes, reconstructs the receipt JSON and proposed Installation document, and matches the original source additions and owner-review event. It does not trust a stored derived report merely because its JSON is well-formed.

The receiver returns selectedInstallationReturn alongside the existing case import receipt when the package selected a return. The browser reopens that exact report in Receiving returns. Earlier files without these optional members retain their existing behavior.

The existing bounds remain: a complete native case ZIP is at most 32 MiB; each original source and full receiving review is at most 8 MiB; a case retains up to 24 MiB across 200 source files, and this feature allows up to 200 retained reviews. Each Installation retains at most 100 checks under the original 128 KiB document bound. The native stage checks its complete resulting files in one transaction. An oversized stage leaves the imported full case available for an explicitly selected supported review; it does not discard or abbreviate original files.

## Complete native receiving procedure

installation-return-receiving.py exercises one whole retained workflow through the original native Workspace and Operations classes. It creates an explicitly WALKTHROUGH owner case, saves the baseline Installation, exports and receives the full case, records named example observations and a purchase observation with no payment attempt, returns the whole case, changes one owner criterion, verifies refusal of its earlier observation, stages the other explicit choices, saves the next original Installation edition, independently receives it, replays the original request, invokes the actual CLI, and closes/reopens the native workspace.

It uses original per-step request bodies, output files and the workspace request journal. A retry retains the same operation, workspaces, report and original source observations. It writes full source identities, every original request/result, baseline/returned/owner case ZIPs, a complete native report, CLI stdout/stderr, final result.json and complete-receiving.zip.

~~~json
{
  "operationId": "SCF-INSTALLATION-RETURN-7108-20261012",
  "sourceRoot": "/absolute/selected-complete-repository",
  "workspaceDirectory": "/absolute/private-owner-workspace",
  "receivedDirectory": "/absolute/private-received-workspace",
  "outputDirectory": "/absolute/private-receiving-output"
}
~~~

~~~bash
python3 stellar/scf_2026/sf47_budget_model/workspace/installation-return-receiving.py \
  --input /absolute/receiving-input.json
~~~

The source root must contain the actual current original SF47 import closure and selected sf10_current_candidate.json. The procedure creates no application server and makes no external purchase. Use the existing managed Grant Operations application for actual browser receiving on the same completed case, with this procedure's recorded IDs and full outputs. Browser review covers saved-report open, explicit owner choices, next-edition confirmation, complete ZIP download, import/reopen, and narrow/mobile layout in the original application.

## Original Page, typed HTTP and MCP receiving

After the complete native procedure has closed both workspaces, the existing managed Grant Operations owner opens that same owner workspace through its original application. The selected installation must contain this complete source edition: the managed Python and Node startup selections include the four new production files, and the maintained grant-operations source recipe includes both receiving procedures and their original lease dependency.

The exported callback uses the owner's actual Page, typed client and MCP provider. It does not create a server or another application installation:

~~~javascript
import {runInstallationReturnPageReceiving} from
  './installation-return-page-receiving.mjs';

const completed = await runInstallationReturnPageReceiving({
  page,                         // The existing authenticated Playwright Page.
  client,                       // Its already-open original GrantWorkspaceClient.
  callTool: (name, args) => merchantGrantWorkspaces.call(name, args),
  workspace: 'installation-return',
  openOperations,               // The owning app's existing view-opening function.
  coreOutputDirectory: '/absolute/private-receiving-output',
  outputDirectory: '/absolute/private-page-receiving-output',
  sourceRoot: '/absolute/selected-complete-repository',
  pythonExecutable: '/absolute/selected-python',
  operationId: 'SCF-INSTALLATION-RETURN-PAGE-7108-20261012'
});
~~~

Bind callTool to the original MerchantGrantWorkspaces instance and its registered workspace alias. openOperations(page) must reopen the actual application's Delivery operations view after a normal Page reload, using the host's existing navigation. The callback then uses the original Operations case selector and Receiving returns tab. The Page origin, managed workspace directory and selected application source directory must match the completed native input.

The owning host serializes this callback with its other uses of the same workspace and Page. It keeps the original typed client, application, browser and MCP export storage alive for the whole call. The callback closes only its own output lease and native read-only child commands; it restores the prior viewport and removes its own page-error observer. After it returns, the owner performs its existing application/client/MCP/browser cleanup and retains the complete returned artifacts.

### What the complete installed journey verifies

The callback copies and verifies the complete native receiving outputs and archive. Through the real typed HTTP client and MCP provider it reopens both saved reports, checks the confirmed Installation, and replays the exact original receiver and owner-stage request bodies. The original request journal must return their full retained results without adding another case event.

For the browser recovery leg, the callback preserves the actual case's previous saved editor state and selects the native procedure's original request UUID and full command body in that same WALKTHROUGH case. It reloads the real Page and clicks Continue original request. It repeats this for the receiving report, owner stage and confirmed Installation. A different pending request blocks the leg. The actual HTTP response and case version prove that continuation returned the original result.

This recovery leg complements the native procedure's explicit original preview, owner choice and save workflow. It does not report these example observations as a customer acceptance. Its result retains mode WALKTHROUGH.

The real UI then opens each complete saved report and downloads both its full JSON and original case ZIP. Typed HTTP and MCP independently return the full case exports. Every exported ZIP is decoded with the selected original Operations._unpack reader and Installation return selector; the callback compares the complete retained review and selected Installation against the native result. It finally reloads the original Page, opens the saved owner review and checks that the same confirmed edition remains.

MCP uses the existing retained snapshot file reader. Each page is checked against the original offset, read lease, full byte count and SHA-256; the original read is released with both snapshotId and readId. The same MCP provider and retained export directory must remain available for an interrupted callback's continuation.

### Complete outputs and continuation

The output directory retains immutable input.json, source-observations, all original core files, typed and MCP response bytes, original browser request/response files, full JSON reports, all six complete case ZIPs, their native readbacks, progress.json, result.json and complete-page-receiving.zip. The returned completeArtifact identifies the final ZIP by absolute path, byte count and SHA-256. Receiving files are published through private staged writes, full readback, fsync and rename while the original Linux output lease is held.

Desktop and mobile observations use widths 1360 and 390. Their complete screenshots remain under views/ for local visual inspection, with identities in result.localQa. The customer ZIP contains the complete source reports and receiving files listed in result.files; it leaves those local QA images outside the saved customer artifact.

If the callback is interrupted, invoke it again with the same operation, original core result, business selection, output directory and workspace. A retained complete download is verified and reused before another export can generate a timestamp. A lost progress write can be recovered from its already-published complete artifact. Original browser requests retain their UUIDs and bodies; the native request journal resolves them.

If result.json was published before the final ZIP completed, the retry verifies that original selected result and finishes only the deterministic archive publication. It does not repeat the browser workflow. A corrected managed source edition is recorded in a separate source observation while the original case and request selection remain unchanged. Unknown application writes continue through their original native request identity; they are not replaced with a fresh mutation.

## Included source

The additive native module is operations_installation_returns.py; the existing Operations owner dispatches its actions and invokes its portable validator. operations_installation_returns_cli.py extends the original CLI. operations_installation_returns.mjs and .css mount inside the existing Operations app and use its authenticated transport, actor and original mutation identity. Current HTTP, client/declarations, MCP catalog/adapter and selected distribution retain their prior workflows.

Related guides: [Customer installations](INSTALLATIONS.md), [Operations API](OPERATIONS-API.md), [Typed agent interface](AGENT.md), [Native CLI](CLI.md).
