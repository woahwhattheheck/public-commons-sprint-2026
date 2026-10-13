# Grant Operations — complete application handoff

Use **starforge grant-application-handoff** to receive a complete original native Grant Operations case, or hand another operator that case together with the saved Application that opens its workspace. The receiving operator selects an installed runtime and private grant workspace, receives the original case through its native importer, reviews the destination Application, and saves it through the existing Applications writer.

The single **grant-handoff.json** file contains the original complete operating-case ZIP and complete Applications setup JSON. It carries the pinned plan, original records and attachments, history, forecasts, portfolios, installation editions, statement and billing source, and every other item included by the installed case export. A paired export's source metadata identifies the selected application revision, case version, runtime edition and original grant service. The setup document keeps the original application settings and source catalog beside those case bytes.

The command is included in the complete public distribution and its **grant-application-handoff** source selection. Its public API is **./grant/application-handoff**. The selection carries the current Runtime, the complete native Grant workspace and the original handoff contribution.

## Use the Applications browser

Open **Applications → Grant case handoff** in the existing private runtime workspace. The screen uses the same complete handoff operation as the installed command below.

**Export a saved grant case.** Select the original saved Grant Application, then **Load current cases**. Each choice shows its native name, current version and operating purpose. Select the case, name the handoff, and choose **Export complete handoff**. Its retained operation provides **Download complete handoff**. If the original grant service is closed, select the explicit start option before loading its cases; a service borrowed from Applications stays under that Application's control.

**Receive a complete handoff.** Select **Case and saved Application** and choose the whole **grant-handoff.json** file. The screen displays its original case version and the sizes of both complete files. Select the receiving READY runtime, Application name, case name, private grant workspace, Python executable, optional scenario, port and recording operator. Additional settings JSON carries any other required Application settings. Use the explicit service-start option when this operation should open a closed receiving service.

**Prepare receiving** commits the complete uploaded bytes and destination bindings into the original handoff operation before obtaining the existing Applications host review. Inspect that host review, then choose **Receive case and review Application**. The native importer returns the actual received case, and the original Application review appears beside it. **Save reviewed Application** commits the existing writer's request. **Open saved Application** selects the resulting Application in the normal Applications view; use its existing Start/Open controls and select the named received case in Delivery operations.

**Retained handoffs** lists the server's original browser operations with pagination. Open an operation to continue its export, case receiving or Application save. **Open last handoff** reopens the last selected operation remembered by this browser tab. Once preparation has committed, closing the browser or removing the incoming file does not remove the retained case, setup or host bindings. **Refresh operation** reads the current original operation after a response is lost.

Prepared input fields remain fixed for that operation. **New export** or **New receiving operation** begins a deliberately separate selection while retaining the previous operation. If an input fails before preparation creates its original record, correct the input in a new operation.

Browser operations live under **RUNTIME_WORKSPACE/grant-application-handoffs/OPERATION_ID**. **Complete operation details** gives that exact directory, request identities, original native result and complete Application review/result. The installed command can continue the same browser operation with that directory and its original runtime workspace; the browser then reads the updated operation. Browser uploads preserve complete valid UTF-8 bytes, and package inspection/import use the original size and source checks.

## Receive a case produced before Applications was configured

Choose **Original native case — complete ZIP** in the same receiving form. Select the original native operating-case ZIP, selected Installation ZIP, Delivery Queue ZIP, or another full-case wrapper supported by the installed Grant Operations importer. The input includes the complete original case; a delivery folder containing several separate reports and ZIPs is an outer carrier, so select its complete native case ZIP.

The producing operator does not need to create a historical Application or recreate its old machine. The receiving operator selects the actual READY runtime, private grant workspace, Python executable and complete Application settings on the current host. The screen shows the original filename and byte size, then **Prepare receiving** saves those exact bytes and host bindings before the original Applications host review.

Preparation creates a new unsaved setup from the receiving workspace's maintained Grant Application catalogue. Its retained document identifies this input as **native-archive**. It contains the full original ZIP and complete new setup with its original field values. A paired **grant-handoff.json** continues to retain its saved producing-host Application and revision.

Use **Receive case and review Application** to continue. The original Grant importer reads and validates the complete case and any selected delivery wrapper, then returns the actual received case, imported plan and original history. The handoff obtains the source case identity and version from that native import. The displayed receiving Application review uses the selected host's exact settings. **Save reviewed Application** commits the original Applications writer's request. Open that saved Application and choose the received case to continue its existing installations, operating records, forecasts and portfolios.

The original launcher supplies its running Node executable to both the Buyer and Support source readers. A case containing original Node observations can therefore reopen through this same native receiving flow when the host was started with an absolute Node path. Explicit SF47_BUYER_NODE and SF47_SUPPORT_NODE selections remain available for an operator's existing environment.

The installed command performs the same operation. With the complete receiving binding file described below:

~~~sh
starforge grant-application-handoff prepare \
  --workspace /absolute/receiving/runtime-workspace \
  --operation /absolute/receiving/native-case-operation \
  --case-archive /absolute/delivery/complete-native-case.zip \
  --bindings /absolute/receiving/host-bindings.json \
  --name "Customer grant operations"

starforge grant-application-handoff receive \
  --workspace /absolute/receiving/runtime-workspace \
  --operation /absolute/receiving/native-case-operation

starforge grant-application-handoff save \
  --workspace /absolute/receiving/runtime-workspace \
  --operation /absolute/receiving/native-case-operation
~~~

The operator reads the returned Application review between **receive** and **save**. Both commands return the original operation when repeated. Resume **prepare** using only the original workspace and operation directory, or pass the same original ZIP and bindings; changed bytes require a new operation. Once prepared, the incoming ZIP can move without affecting the retained original.

The native case limit is **32 MiB**. Browser transfer uses canonical base64 for the original binary bytes and keeps the original filename. The receiving package stores those bytes, the new setup, explicit bindings and the original native import/Application save requests together. A completed native import is recovered through its existing request identity, including a response lost before the handoff record advances. The native importer preserves the original source plan and case identity in the received case's origin, while assigning its actual receiving case and plan identities.

After saving, the ordinary **Export a saved grant case** form can export the received case and its now-saved Application as a normal complete paired handoff. This is the same export, independent receiving and reopen workflow described below.

## 1. Choose the source and destination

Use the original runtime workspace containing the saved **Grant planning and delivery** Application. Read that application's ID and the case's current native ID/version from Applications and the grant operator. The source and receiving runtime workspaces each need an attached **READY** runtime containing Grant Operations. For a native ZIP, only the receiving workspace needs a saved runtime binding; the source is the retained original archive.

A receiving operation names the private grant workspace explicitly. It can receive into a new workspace or into an existing one. The native importer creates its destination plan and case while preserving the original record, attachment and history identities. Existing cases stay available in the same workspace.

Use private, real directories owned by the operating account. Linux, Node.js, Python and flock follow the installed [Grant Operations operating requirements](../../stellar/scf_2026/sf47_budget_model/workspace/OPERATIONS.md). Keep the operation directory under a private parent, and select an actual Python executable. The command loads the original Grant client from the selected installed runtime.

For an attached runtime, the original dispatcher can run the command:

~~~sh
node /absolute/maintained/distribution/runtime-install-cli.mjs run \
  --dir /absolute/installed/grant-runtime -- \
  grant-application-handoff --help
~~~

The examples below use **starforge** as the installed dispatcher. Replace uppercase identities with the actual values returned by your native workspace.

## 2. Export the complete source case and Application

Read the current case version, then select a new named operation directory:

~~~sh
starforge grant-application-handoff export \
  --workspace /srv/grant/private/runtime-workspace \
  --operation /srv/grant/private/handoffs/source-delivery-01 \
  --application APPLICATION_ID \
  --case ORIGINAL_CASE_ID \
  --expected-version CURRENT_CASE_VERSION \
  --name "Grant delivery handoff"
~~~

The source command borrows an already running original grant service. If this operation should start the original service when it is closed, add **--allow-start**. The command closes a service it started after export; borrowing an Application's existing listener leaves that Application in charge.

The exporter retains its source selection before native work. It captures the complete setup and native case ZIP together, checks that the selected case version and saved application revision stayed current during that capture, and atomically retains both originals. A completed capture is reused after interruption.

The output gives the complete package path, byte count and SHA-256:

~~~text
/srv/grant/private/handoffs/source-delivery-01/grant-handoff.json
~~~

Send this one file through the customer's agreed private delivery channel. It contains the full authorized case and its original attachments. Its complete operating-case ZIP remains available separately in the source operation's **captured/case.zip**, and the exact setup remains in **captured/setup.json**.

Inspect a received file without opening either runtime workspace:

~~~sh
starforge grant-application-handoff inspect \
  --package /srv/grant/private/incoming/grant-handoff.json
~~~

The inspection returns source identities, original file sizes and hashes, and the complete setup document. The original case archive supports up to 32 MiB; the complete setup supports up to 2 MiB. The enclosing file supports up to 48 MiB, including Base64 and metadata.

## 3. Write explicit destination bindings

Create a JSON file selecting the receiving host's actual runtime and paths:

~~~json
{
  "runtimeId": "DESTINATION_RUNTIME_ID",
  "label": "Received grant delivery",
  "settings": {
    "workspaceDirectory": "/srv/grant/private/received-delivery",
    "pythonExecutable": "/usr/bin/python3",
    "scenarioFile": "",
    "port": 8468
  },
  "caseName": "Received grant delivery",
  "actor": "Receiving operator",
  "allowStart": true
}
~~~

Use the destination runtime ID from the receiving runtime workspace. **settings** is the complete host configuration for the new Application; select its workspace, Python and desired port explicitly. An empty scenarioFile lets the installed original launcher choose its source scenario for an empty workspace. The received case retains its own pinned original plan and complete planning history.

**allowStart** controls the native Grant client used for case receiving. With true, this operation can start the original selected service and close its own service afterward. With false, it borrows a matching service already running on the selected destination workspace. It never replaces another service's launch selection.

Use the actual named receiving operator in actor. The caseName and actor form part of the original import request and are retained for response recovery.

## 4. Prepare and review the destination

~~~sh
starforge grant-application-handoff prepare \
  --workspace /srv/grant/private/receiver-runtime-workspace \
  --operation /srv/grant/private/handoffs/receive-delivery-01 \
  --package /srv/grant/private/incoming/grant-handoff.json \
  --bindings /srv/grant/private/receiver-bindings.json
~~~

Preparation retains the exact incoming package, both complete original files, full destination bindings, native source selection and stable import/Application request identities. It obtains the original Applications host review so invalid settings are reported before a case is imported.

Inspect the returned source case, target workspace, runtime edition, case name and recording operator together. The phase is **PREPARED**. The input files can subsequently move out of the incoming directory; the operation has retained their complete bytes.

For a resumed preparation, use the same operation:

~~~sh
starforge grant-application-handoff prepare \
  --workspace /srv/grant/private/receiver-runtime-workspace \
  --operation /srv/grant/private/handoffs/receive-delivery-01
~~~

## 5. Receive the original case

~~~sh
starforge grant-application-handoff receive \
  --workspace /srv/grant/private/receiver-runtime-workspace \
  --operation /srv/grant/private/handoffs/receive-delivery-01
~~~

Receiving opens the original selected Grant client and passes the complete unchanged ZIP to its native **importBundle('case')** operation. The native importer validates the full case and planning archive, records the original request and returns the actual destination case/plan identities.

The operation retains the exact native import result before advancing. It reads that case's original archive/program/plan association, then closes its owned receiving service and prepares the new Application against the destination workspace through the existing Applications setup operation.

The result contains:

| Field | Meaning |
| --- | --- |
| imported.result.id | Actual destination operating-case ID. |
| imported.result.planId | Actual destination plan ID selected by the native importer. |
| imported.result.version | Retained original case version at import. |
| imported.file | Exact native result file in this operation. |
| application.review | Original Applications review for the selected destination settings. |
| application.saveRequest | Retained original Application save request. |
| phase | APPLICATION_REVIEWED after case receiving and Application preparation complete. |

A new save uses the same original application request throughout recovery. The operation preserves the complete source setup in the child Application operation, including the source catalog and prior settings.

## 6. Save and open the receiving Application

Review the returned **application.review** and commit that prepared Application:

~~~sh
starforge grant-application-handoff save \
  --workspace /srv/grant/private/receiver-runtime-workspace \
  --operation /srv/grant/private/handoffs/receive-delivery-01
~~~

The phase becomes **APPLICATION_SAVED**. **application.result.applicationId** identifies the saved Application, and **imported.result.id** identifies the received operating case. Open that Application in the original runtime workspace, complete its normal Start review and Start/Open controls, and select the received case in Delivery operations.

The original Application writer retains the accepted save request and any managed-runtime connection operation. Its returned connection or connectionError remains available for the normal Applications connection/recovery controls. A later deliberate application edit remains current when an earlier accepted save is replayed.

Continue the received case through the normal grant operator. Its contributors, work, invoices, cash, sources, statements, billing, forecasts, portfolios, installations and reviews use their existing native controls and state transitions.

## 7. Recover the same operation

~~~sh
starforge grant-application-handoff status \
  --operation /srv/grant/private/handoffs/receive-delivery-01
~~~

Status reads the complete retained package and current original Application setup operation.

| Retained state | Continue |
| --- | --- |
| Source export interrupted before capture | Repeat export with the original workspace and operation. It reuses the original application/case selection. |
| Complete source capture retained | Export builds or returns the same complete handoff from those retained originals. |
| PREPARED | Repeat receive to execute or recover the original case import. |
| Import response lost | Repeat receive. The exact ZIP, name, actor and native request ID recover the importer's original result. |
| CASE_RECEIVED | Receive reopens the actual destination case and continues its Application preparation. |
| APPLICATION_REVIEWED | Inspect its review and run save. |
| Application save response lost | Repeat save. The original Applications writer returns the accepted result. |
| APPLICATION_SAVED | Use the saved Application and actual received case ID. |
| Incoming files removed | Resume with the operation directory; its private retained package and bindings remain sufficient. |
| A different source/runtime or host binding is supplied | Return to this operation's original selection. A deliberately different handoff has its own operation directory and intent. |

The same operation can be inspected at any time. Each committed stage persists before the next starts. An error retains its code and message beside the original request and source.

### Files kept with the operation

The source operation keeps **handoff/operation.json**, its atomic **captured/** source set and the complete **grant-handoff.json**.

The receiving operation keeps **handoff/grant-handoff.json**, **host-bindings.json**, **case.zip**, **application-setup.json**, **application-bindings.json**, **operation.json** and the actual **import-result.json**. Its **application/** child is the original Applications setup operation with complete source, review, save request and result.

These files let another authorized operator continue the same customer delivery without rebuilding inputs from a message or recreating business records.

## 8. Use the public API

~~~js
import {
  inspectGrantHandoff,
  exportGrantHandoff,
  prepareGrantHandoff,
  receiveGrantHandoff,
  saveGrantHandoffApplication,
  grantHandoffStatus,
} from '@tokenjunkielabs/starforge-merchant/grant/application-handoff';
~~~

The exported functions accept an opened original runtime-workspace model where required. Browser and service adapters can pass **packageText** and a complete **bindingsValue** to preparation instead of input paths; the same original atomic preparation stores their full bytes and native requests. **grantHandoffCases** reads the original selected Application's native case list, and **grantHandoffDownload** returns the complete original export for an authenticated browser.



~~~js
const exported = await exportGrantHandoff(sourceModel, {
  operation: '/srv/grant/private/handoffs/source-01',
  applicationId,
  caseId,
  expectedVersion,
  name: 'Grant delivery',
  allowStart: false,
});
const inspected = await inspectGrantHandoff({
  package: '/srv/grant/private/incoming/grant-handoff.json',
});
const prepared = await prepareGrantHandoff(destinationModel, {
  operation: '/srv/grant/private/handoffs/receive-01',
  package: '/srv/grant/private/incoming/grant-handoff.json',
  bindings: '/srv/grant/private/receiver-bindings.json',
});
const received = await receiveGrantHandoff(destinationModel, {
  operation: prepared.operationDirectory,
});
const saved = await saveGrantHandoffApplication(destinationModel, {
  operation: prepared.operationDirectory,
});
~~~

Keep the returned full objects when integrating this workflow. The [Applications setup guide](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATION_SETUP.md) describes the underlying complete setup and its Review/Save recovery. The [Grant Operations operating guide](../../stellar/scf_2026/sf47_budget_model/workspace/OPERATIONS.md) describes the received case's business workflow and original CLI/Merchant interfaces.


## Public installed source and original receiving

The public source selection is `stellar/scf-starforge-20261009/distribution/selections/grant-application-handoff.json`. Use the existing distribution builder with `--selection grant-application-handoff` and an immutable source commit. Its handoff contribution declares the command and typed API; the selected Runtime asset manifest includes the complete setup editor and Grant handoff screen. The selected native Grant component remains the original source of case schemas, export/import, record history and SQLite state. The handoff opens the client from the selected installed runtime and checks its source selection before using that service.

Continue the original Grant and Runtime receiving operation on its actual host and workspace. Open Applications, export an existing case and complete setup, receive it with explicit destination paths, inspect the actual imported case, save the reviewed Application, and reopen the same operation after a lost response. Also receive the original complete native case ZIP directly, then use the existing Application Start/Open controls. Replaying an earlier accepted setup save must return its original saved edition while retaining a later deliberate Application edit. Keep the original operation directory, request IDs and case identity throughout each continuation.

Inspect the actual browser on desktop and a narrow screen. Open and read the downloaded complete handoff, case ZIP and setup JSON, and reopen those exact files through the receiving flow. Record and inspect the produced browser views in the existing receiving result alongside the native case and Application identities.

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
