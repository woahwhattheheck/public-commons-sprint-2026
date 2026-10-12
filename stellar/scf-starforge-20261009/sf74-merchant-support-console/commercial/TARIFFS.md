# Tariff quotation and customer receiving

Use the merchant's completed original tariff selection to prepare a customer quotation and deliver its complete editable pricing workspace.

The Tariff sources tab lives in the existing Merchant workspace quotation desk at /commercial. It uses the current saved case and its existing writer. Original tariff editing, comparison, selection and atomic repricing stay in Merchant pricing. This workflow carries their retained results into the customer case and opens them again for a recipient.

## What the customer receives

A tariff source keeps one original saved plan, one selected comparison, the exact request quantity and tier schedule, both original scenario/pricing request UUIDs, their completed native outcomes and the resulting uniform request rate. It also binds the original completed pricing manifest.

The complete case retains three separate original records:

| Record | Original request |
| --- | --- |
| Selected scenario and pricing source | pricingRequestId |
| Complete pricing workspace backup | backupAttachmentRequestId |
| Selected tariff basis and portfolio | tariffAttachmentRequestId |

The source is inspectable without opening a new pricing writer. It runs the same original portfolio preflight against the retained pricing files. The complete backup is also checked for every file in the later pricing version created by the selected tariff request. A source that carries the scenario's earlier version while omitting the actual saved tariff price is rejected.

The recipient receives the full case package, including its original history, all source materials, complete pricing backup, quote editions and customer responses. The normal restore opens the original pricing backup first, receives the selected tariff portfolio through the original tariff engine, and reopens the same saved selection. Paths may change on the receiving host; the pricing, selection and file identities remain the original ones.

## Price meaning

The original tariff engine supports graduated and volume schedules. A selected positive request quantity produces a uniform per-request quote using the original ceiling-to-micro-USD calculation. The customer quote shows that saved rate, the original tier total and the upward unit-rounding difference.

A later quote may use a different explicit monthly request quantity. The tariff review then shows two separate original calculations: the charge at the saved uniform rate and the tier schedule at the new quantity. It does not silently replace the saved rate. To adopt a different rate, save a new selected comparison in the original Merchant pricing workspace, capture that completed source and use it in a new quote edition.

Zero monthly requests produce a zero route charge and no newly derived unit rate. Monetary values and request quantities remain decimal strings. Existing quotes without a tariff basis keep their original behavior.

## Browser workflow

Open the original Merchant workspace with its private case directory and source/package configuration, then open Quotations and select the current case.

1. Open Tariff sources. Supply the original pricing directory, seller configuration and exactly one saved operations snapshot or usage-history file. Open the original tariff history.
2. Choose the retained selection request. Inspect its original scenario and pricing result. If either native request is unfinished, reopen that same request in Merchant pricing and complete it there.
3. Capture into a separate private receiving directory. The desk saves a backup request UUID before dispatch and retains the exact capture inputs through an interrupted response.
4. Inspect the captured directory and its exact receiving source hash. Review the original tier schedule, selected quantity, uniform rate and full backup. Record the concrete merchant/source match, then attach it to the current case. This uses the three original case requests listed above.
5. Select the attached case tariff and use it in the quote. The editor selects its matching original pricing source and selected quantity. Add the complete work, service, payment and receiving terms, review, and save an immutable quotation edition.
6. Record the actual customer response against that exact edition. The tariff source and pricing request identities remain visible in the machine quote and receiving controls; the customer document uses the original plan and tariff labels.
7. Export the complete case using Merchant workspace's normal package controls. Receive it into the recipient's case directory, reopen Quotations and select the received case.
8. Select the saved quote and its tariff basis. Supply the private recovered archive file and a separate restore directory. Restore and reopen the original pricing workspace and selected tariff portfolio.

The desk can download the exact tariff-source JSON or original selected portfolio. It verifies the complete response length and SHA-256 before saving the browser file.

## Native CLI

The installed command uses the existing commercial entry:

~~~sh
starforge merchant-commercial tariffs --help
~~~

The same source entry is:

~~~sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/commercial-cli.mjs tariffs --help
~~~

Each operation consumes one private JSON input. Use the actual saved case ID, current workspace identity and case revision returned by the original commercial read. Keep files private, with mode 0600 and a private parent directory.

~~~sh
starforge merchant-commercial read --cases-dir /private/merchant/cases --case CASE_UUID
starforge merchant-commercial tariffs catalog --cases-dir /private/merchant/cases --input /private/tariff/catalog.json
starforge merchant-commercial tariffs selection --cases-dir /private/merchant/cases --input /private/tariff/selection.json
starforge merchant-commercial tariffs capture --cases-dir /private/merchant/cases --input /private/tariff/capture.json --report /private/tariff/capture-report.json
starforge merchant-commercial tariffs inspect --cases-dir /private/merchant/cases --input /private/tariff/inspect.json
starforge merchant-commercial tariffs attach --cases-dir /private/merchant/cases --input /private/tariff/attach.json --report /private/tariff/attach-report.json
~~~

The all-capital identifiers below represent values from the current original workspace or newly retained caller UUIDs. Replace them before invocation.

A first capture input is:

~~~json
{
  "id": "CASE_UUID",
  "scope": {"caseId": "CASE_UUID", "workspaceId": "WORKSPACE_SHA256"},
  "expectedRevision": "CASE_REVISION_SHA256",
  "pricingDirectory": "/private/merchant/pricing",
  "pricingConfig": "/private/merchant/seller.json",
  "pricingSnapshot": "/private/merchant/operations.json",
  "selectionRequestId": "ORIGINAL_COMPLETED_SELECTION_UUID",
  "backupRequestId": "RETAINED_BACKUP_UUID",
  "directory": "/private/tariff/receiving"
}
~~~

Use pricingHistory instead of pricingSnapshot for the original saved usage history. Exactly one is selected on first capture. The command can reopen a completed receiving directory after the authoring paths have moved. Keep the same selectionRequestId, backupRequestId and output directory.

Inspect uses id, scope, directory and optional expectedSourceSha256. The response supplies the exact sourceSha256 to use for attachment.

An attachment input is:

~~~json
{
  "id": "CASE_UUID",
  "scope": {"caseId": "CASE_UUID", "workspaceId": "WORKSPACE_SHA256"},
  "expectedRevision": "ORIGINAL_REVIEWED_CASE_REVISION_SHA256",
  "directory": "/private/tariff/receiving",
  "expectedSourceSha256": "INSPECTED_RECEIVING_SHA256",
  "pricingRequestId": "RETAINED_PRICING_RECEIVE_UUID",
  "backupAttachmentRequestId": "RETAINED_BACKUP_ATTACHMENT_UUID",
  "tariffAttachmentRequestId": "RETAINED_TARIFF_ATTACHMENT_UUID",
  "actor": "Merchant operator",
  "bindingReason": "The original seller, route and pricing source match this customer case."
}
~~~

Keep the exact input after an interrupted reply. The original case engine recovers the pricing receive and backup attachment before completing the same tariff material. It preserves later case history and current ownership.

After attachment, use the normal quotation template/editor and set tariffSourceId to the returned tariffSourceId. Set pricingSourceId to its returned pricingSourceId. Include the selected route in pricing.routes and use an explicit whole monthlyRequests string. The original preview returns the complete source binding and customer-readable calculation.

To review a different quantity, call tariffs case with id, scope, sourceId, optional revision and monthlyRequests. To review the saved quote, supply quoteId and quoteSha256 instead. Restore uses that exact quote plus archive and directory:

~~~sh
starforge merchant-commercial tariffs case --cases-dir /private/recipient/cases --input /private/tariff/quoted-case.json
starforge merchant-commercial tariffs restore --cases-dir /private/recipient/cases --input /private/tariff/restore.json --report /private/tariff/restore-report.json
starforge merchant-commercial tariffs download --cases-dir /private/recipient/cases --input /private/tariff/download.json --output /private/tariff/selected-portfolio.json
~~~

Download input selects sourceId and kind SOURCE or PORTFOLIO. Its output path and complete original descriptor are retained in the optional command report. A report is create-only and binds the exact input bytes and output path. Repeating the command reopens the original operation and preserves the first report.

Use the existing complete case exporter and receiver:

~~~sh
starforge merchant-commercial export --cases-dir /private/merchant/cases --case CASE_UUID --revision CASE_REVISION_SHA256 --out /private/case-package --source-dir /private/merchant/source-bundles
starforge merchant-commercial inspect-package --from /private/received-package
starforge merchant-commercial receive-package --from /private/received-package --out /private/recipient/receipt --cases-dir /private/recipient/cases --source-dir /private/recipient/source-bundles --request-id RETAINED_RECEIVE_UUID --actor "Receiving operator"
~~~

The normal source/package and Python options remain those of the original commissioning command. A tariff source JSON by itself is an inspectable selected basis; the full editable handover is the complete case package with its pricing backup.

## HTTP and typed client

The existing loopback listener owns every route:

| POST path suffix under /api/cases/:id/commercial/ | Operation |
| --- | --- |
| tariff-status | Current case, attached sources and active requests |
| tariff-catalog | Original pricing and tariff history |
| tariff-selection | Original selected plan and both native outcomes |
| tariff-capture | Complete source and matching backup |
| tariff-inspect | Read-only retained source and backup inspection |
| tariff-attach | Three-request original case attachment |
| tariff-case | Exact tariff/quote and optional quantity review |
| tariff-restore | Original pricing restore followed by portfolio receive |
| tariff-download | Complete retained SOURCE or PORTFOLIO bytes |

The body omits id because the original route supplies it. Keep scope and any reviewed case revision. Mutations retain their original requests. A response with an uncertain write outcome leaves those requests available for recovery.

JSON responses carry scope, case and tariffSources, with action and result for action calls. Status adds active. Downloads provide x-sf74-file-name, x-sf74-file-bytes and x-content-sha256 headers.

~~~js
import {createCommercialTariffClient} from './commercial/tariff-client.mjs';

const client = createCommercialTariffClient({
  url: originalMerchantUrl,
  caseId: originalCaseId,
  workspaceId: originalWorkspaceSha256
});
const current = await client.status();
const inspected = await client.inspect({
  directory: receivedDirectory,
  expectedSourceSha256: receivedSourceSha256
});
// Save the complete attachment object and its three UUIDs before awaiting this call.
const attached = await client.attach(retainedAttachment);
const exactFile = await client.download({
  revision: attached.case.revision,
  sourceId: attached.result.tariffSourceId,
  kind: 'PORTFOLIO'
});
~~~

The package name follows the installed edition's normal package manifest. The client export is ./merchant/commercial-tariff-client, with adjacent declarations. Direct source users can import commercial/tariff-client.mjs. The client validates the original scope and verifies downloaded bytes; it does not retry a write with a new identity.

## MCP

Use the existing configured Support connection and case writer. The new tool family is merchant_case_commercial_tariff_status, catalog, selection, capture, inspect, attach, case and restore.

merchant_case_commercial_tariff_file uses the existing retained file reader. Continue with its original readId, expectedSha256 and nextOffset. The normal merchant_case_commercial_file_reads and file_release tools manage those same case-scoped reads. A cold reopen uses the same case revision, sourceId, file kind and expectedSha256.

The original merchant_case_export and package receiving tools carry the whole case. Existing commercial preview/save/publish schemas accept the optional tariffSourceId; older saved drafts remain valid.

## Recovery and source authority

The source directory contains capture-input.json, pricing/ with the original full pricing receiving files, tariff-source.json and a final tariff-receiving.json completion record. Files publish through the original private exact-byte artifact writer. A conflicting path or changed request is never replaced.

The original tariff workspace exposes bundle({selectionRequestId}) for this one complete original selection. Calling bundle() still returns the full original portfolio. inspectPortfolio and exported inspectTariffPortfolio share the existing receive preflight. The receiver checks all original destination conflicts before its first portfolio write.

A disconnect during capture, attachment or restore retains the same inputs. The browser preserves them within the current case/workspace scope; a real workspace change clears that private state. The listener drains active operations before closing the original source/package owners. Durable recovery remains in the original pricing, backup and case engines.

The customer document carries the original schedule, selected quantity, saved unit rate and rounding terms. The machine quote carries the full exact source binding. The complete case retains both together.


## Continue the original native customer operation

The [complete customer receiving programme](TARIFF_RECEIVING.md) continues the original saved Tariff run through both quote editions, whole-case export/recipient import, preserved recipient edits, native pricing/portfolio restore, and the original HTTP/MCP file paths. It reuses that run’s completed pricing selection and existing backup request. Run it against the same complete source tree and retain its customer output alongside the original native operation.
