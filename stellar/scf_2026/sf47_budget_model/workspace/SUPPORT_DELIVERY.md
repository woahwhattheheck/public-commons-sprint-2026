# Merchant support in grant delivery operations

The original SF47 **Delivery operations → Merchant support** view receives the portable support handoff exported by the SF74 merchant support product. Inspect captured routes, before/after runtime observations, delivery reconciliation and retained follow-up work, then attach the original file and native rendered review to an existing or newly recorded deployment.

This uses the existing grant workspace, selected operating case, source attachments, deployment records and request receipts. The original handoff remains a standard SF74 file that also reopens in Merchant Support.

## Receive a saved support case

1. Open the saved case in **Merchant Support**, including the intended original runtime captures, and choose **Export portable handoff**.
2. Open the retained SF47 workspace and **Delivery operations**. Select the operating case whose pinned plan and deployment belong to this work.
3. Enter the recording operator in the existing toolbar and open **Merchant support**.
4. Choose the original support JSON file. The installed SF74 reader verifies its original workspace and runtime bytes and calculates the native review.
5. Review the source name, export time, exact file identity, selected routes, captures and comparison. Expand **Complete native review** or download **Original runtime report** for the full report.
6. Select a retained deployment or choose **Create a deployment** and record its accountable operator, role, environment, current state, original source, receiving operator/date and work packages.
7. Add a receiving note and select **Receive support into this case**.
8. Reopen the original case. **Received support files** shows the handoff, linked deployment and retained rendered report.

Existing deployment selection preserves its business fields and adds the source attachments. A new deployment uses the original deployment rules, including the named receiver and date for a handover. Use **Deployment / buyers** for subsequent deployment updates, purchase observations and receiving outcomes.

## Save recovery and concurrent work

Preview binds the original file, installed reader, complete native review and current operations version. Receiving compares that preview inside the existing idempotent case transaction. The file, rendered report, deployment update, case event and request receipt commit together.

A network interruption retains the same save request in the open view. **Retry same save** sends that original request again. The original workspace returns its earlier accepted result when available. **Refresh original case** reopens the latest case and source.

Receiving the exact file/report already linked to the selected deployment returns that association without another source copy or case version. Exact source bytes already held in the same case are reused.

If another operator updates the case after preview, refresh the case and preview the intended file again. Existing source remains available through ordinary case history and attachment downloads.

## Reopen and transfer

**Open review** reads the saved handoff and recalculates its review with the installed SF74 reader. **Download handoff** returns the original bytes. **Download runtime report** returns the report retained at receiving time.

**Export complete case** carries original planning history, operating records, source attachments and reviews. Normal **Import complete case** restores the deployment/source links. Managed Stop and Reopen continue the original workspace lifecycle.

The receiver uses the existing 8 MiB attachment limit, 24 MiB total and 200-file case limit. For an oversized support export, choose a shorter original capture period in Merchant Support and export that source.

## Existing command line

Use the maintained grant command when its original workspace is available to that CLI owner:

~~~sh
starforge grant-workspace operations --workspace /private/grant-workspace \
  support-preview --case operation-ORIGINAL_ID --expected-version 32 \
  --file /private/merchant-support.json --output /private/support-preview.json
~~~

The preview contains the original native review, rendered HTML and **previewSha256**. Receive the same source into an existing deployment:

~~~sh
starforge grant-workspace operations --workspace /private/grant-workspace \
  support-receive --case operation-ORIGINAL_ID --expected-version 32 \
  --file /private/merchant-support.json \
  --expected-preview-sha256 REVIEWED_PREVIEW_SHA256 \
  --deployment deployment-ORIGINAL_ID \
  --actor "Receiving operator" --request-id support-receive-001 \
  --note "Retain the merchant case with its original deployment."
~~~

To create a deployment, replace --deployment with --deployment-file /private/deployment.json. The file uses the original fields:

~~~json
{
  "name": "Merchant runtime",
  "operator": "Accountable operator",
  "operatorId": "retained-operator-identity",
  "role": "MERCHANT",
  "participantClass": "TEAM_OPERATED",
  "environment": "TESTNET",
  "state": "OPERATING",
  "costIds": [],
  "tranche": null,
  "endpoint": "https://merchant.example/data",
  "releaseRef": "Original source or installed release",
  "caseRef": "Original merchant case or work order",
  "acceptedBy": "",
  "acceptedAt": null,
  "sourceNote": ""
}
~~~

Read the actual deployment ID and case version with the existing operations show command. Output files use the original private, create-only CLI writer.

The maintained launcher forwards its running Node executable to Python as **SF47_SUPPORT_NODE**. Direct Python use can select an absolute Node executable with that environment variable, or use Node on PATH. The helper runs locally against the installed original source.

## API and source composition

POST /api/operations/{case}/support-preview accepts expectedVersion, filename and contentBase64. Its stellar-forge.sf47-support-preview.v1 response includes the case/version, original file and embedded source identities, workspace summary, metadata, reader identities, full native review, rendered HTML, matching retained source IDs, deployment choices and previewSha256.

The existing command endpoint receives:

~~~json
{
  "expectedVersion": 32,
  "requestId": "support-receive-001",
  "actor": "Receiving operator",
  "note": "Retain the source with this deployment.",
  "action": "support.receive",
  "data": {
    "filename": "merchant-support.json",
    "contentBase64": "EXACT_ORIGINAL_FILE_BASE64",
    "expectedPreviewSha256": "REVIEWED_PREVIEW_SHA256",
    "deploymentId": "deployment-ORIGINAL_ID"
  }
}
~~~

For a new deployment use deploymentId: null and include the deployment fields shown above. Existing selection accepts no competing replacement fields.

The native receipt contains id, version, action, kind, recordId, sourceIds, sourceSha256 and unchanged. Read the case after acceptance for complete state. Standard history, source downloads, complete exports/imports and close/reopen remain the original operations.

The additive support_handoff.mjs calls SF74's importRuntimeHandoff, reviewRuntime, runtimeHtml, parseWorkspace and caseMetadata. operations_support.py adapts the result to the original source/deployment transaction. operations_support.mjs follows the existing browser view's busy and disposal lifecycle. Original HTTP/CLI hooks expose the same methods.

Distribution already includes both SF47 and SF74 component directories; the additive files ship in that maintained closure. The exact handoff and retained report become ordinary sources in the original operating case.
