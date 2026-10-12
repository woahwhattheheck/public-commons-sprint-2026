# Original Report Desk API

## Local operator transport

`startReportDesk({desk,port,launchFile,nativeFactory,handleSignals})` returns the actual local launch URL, origin, desk-bound API prefix, launch descriptor and asynchronous `close()`. Embedded callers use `handleSignals:false` and close all resources in their own finally block.

Authenticated reads under `/api/DESK_UUID/`:

| Path | Result |
| --- | --- |
| state | Persistent desk, original operations, configured connection facts, live original services |
| reports | Existing scientific report inventory |
| report?id=ID | Verified original frozen report/source/review/export identities |
| publication?id=ID | Verified original report product, bundle and public catalog |
| receiving?id=ID | Verified actual buyer selection, scientific receiving and native Operations receipts |
| operation?id=ID | Original request, retained phase requests, recorded result |
| cases | Original SF47 case choices |
| case?id=ID | Complete selected current native case |
| download?id=ID&kind=KIND&format=FORMAT | Whole verified original download |

Writes: `POST /api/DESK_UUID/action` with `application/json`, original bearer token and same Origin:

```json
{"action":"publish","input":{"operationId":"stable-original-id","actor":"Actual operator","input":{}}}
```

Available actions: publish, buyer.prepare, buyer.prepare-catalog, buyer.capture, buyer.inspect, receiving.preview, receiving.commit, continue, desk.export, desk.restore, service.start, service.stop. The last two are live services owned by this server; they are not a payment record.

Body limit is 36 MiB. Uploaded file objects are `{base64,bytes,sha256}` with canonical base64 and exact original identity. Catalog ≤1 MiB; handoff ≤8 MiB; complete protected file ≤16 MiB. Browser persistent storage retains request metadata and hashes, not base64 file bodies.

## Publication input

```json
{
  "operationId": "one-report-publication",
  "actor": "Actual recording operator",
  "input": {
    "reportId": "ACTUAL_REPORT_ID",
    "expectedReportSha256": "ACTUAL_REPORT_SHA256",
    "expectedManifestSha256": "ACTUAL_MANIFEST_SHA256",
    "expectedArchiveSha256": "ACTUAL_COMPLETE_ZIP_SHA256",
    "title": "Groundwater report",
    "description": "Actual scope and source findings of this frozen report.",
    "license": "Actual retained license, attribution and permitted use.",
    "reason": "Why the selected report and its original findings fit this publication.",
    "formats": ["zip", "json", "csv"],
    "origin": "https://actual-owned-merchant.example",
    "routePrefix": "/groundwater/ACTUAL_REPORT_VERSION",
    "payment": {
      "scheme": "exact", "network": "stellar:testnet",
      "asset": "ACTUAL_ORIGINAL_ASSET", "amount": "ACTUAL_ATOMIC_AMOUNT",
      "payTo": "ACTUAL_OWNER_RECIPIENT", "maxTimeoutSeconds": 60
    }
  }
}
```

Example placeholders are never interpreted as live credentials, report records, public deployments or payment terms. The original native compiler validates every real supplied term. Usage/attribution is part of the original public resource description.

## Pure buyer preparation

From the publishing desk:

```json
{"operationId":"one-buyer-preparation","actor":"Actual operator","publicationId":"one-report-publication","format":"zip","acceptIndex":0,"intentId":"ACTUAL_ORIGINAL_BUYER_INTENT","responseOut":"/private/buyer/original-response.zip"}
```

From a public catalog, `buyer.prepare-catalog` takes the same actor/operationId/intentId/responseOut plus `rowIndex`, `acceptIndex`, and uploaded `catalog`. Native SDK method `desk.prepareCatalog` uses a Buffer; CLI `buyer-catalog` uses `catalogFile`.

Capture input:

```json
{"operationId":"one-saved-buyer-capture","actor":"Actual operator","inboxDirectory":"/private/original-inbox","intentIds":["ACTUAL_ORIGINAL_BUYER_INTENT"]}
```

Capture calls the maintained original exporter only once. Inspect/recovery reads the first saved handoff and never creates a fresh edition under the same attempt.

## Receiving preview and commit

Native methods `previewReceiving` / `receive` accept Buffer catalog/handoff/response. HTTP uses `files:{catalog,handoff,response}`. CLI preview/receive uses `catalogFile`, `handoffFile`, `responseFile`.

```json
{
  "operationId":"one-report-receiving",
  "actor":"Actual reviewer",
  "input":{
    "rowIndex":0,"acceptIndex":0,"jobId":"ACTUAL_64_HEX_JOB_KEY",
    "decision":"received",
    "reason":"Actual file receiving purpose and findings reviewed.",
    "caseId":"ACTUAL_OPERATION_CASE_ID",
    "deploymentId":"ACTUAL_ORIGINAL_BUYER_DEPLOYMENT_ID",
    "purchaseId":"ACTUAL_MATCHED_PURCHASE_ID_OR_NULL",
    "expectedCaseVersion":37,
    "expectedPreviewSha256":"ACTUAL_NATIVE_BUYER_PREVIEW_SHA256"
  },
  "files":{"catalog":{},"handoff":{},"response":{}}
}
```

The entire Operations group is optional. When omitted, the original file receiving/review remains complete. It does not create a case, deployment or purchase. With Operations, choose its exact current preview, explicit deployment and existing purchase or explicit null for native unmatched-intent creation.

The adapter records original buyer.receive → source.add → purchase.observe requests before dispatch. Their exact request IDs and native results stay in the desk. No failed/uncertain request is relabelled as a completed payment or silently rewritten.

## Complete export and restore

Export:

```json
{"operationId":"one-complete-desk-export","actor":"Actual operator","destination":"/private/exports/Groundwater_Report_Desk.zip"}
```

Restore:

```json
{"archive":"/private/exports/Groundwater_Report_Desk.zip","destination":"/private/receiving/original-desk","expectedSha256":"ACTUAL_ARCHIVE_SHA256","expectedBytes":123}
```

The example byte count is a placeholder; supply the real complete archive size. The destination must be new or contain the original interrupted restore intent. The result includes its exact desk directory and original identity.

## Original same-report native caller

`node native-workflow.mjs /private/original-report-journey.json`

The first request has schema `stellar-forge.groundwater-report-journey.v1`, stable operationId, actor, absolute deskDirectory/outputDirectory/sourceWorkspace, installed application/python, full `publication` object, and `buyer:{intentId,acceptIndex,responseOut}`. Optional `browser:{package,executable}` names the actual installed Playwright and complete browser.

It writes the frozen original request before any publication. No solver or payment dispatcher is included. Add `receiving` only after the original buyer returns: handoffFile, responseFile, jobId, decision, reason, and optional explicitly reviewed case/deployment/purchase/version/preview hash. Existing input fields stay unchanged. The report ZIP and exact buyer intent must match the first prepared product.

The complete result contains native publication, original buyer job/payment observations, attributed file decision, optional native Operations source link, full desk archive, independent original restore/reopen and explicit no-solver/no-buyer-payment-dispatch facts.
