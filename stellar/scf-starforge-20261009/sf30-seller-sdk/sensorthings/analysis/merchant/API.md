# Reviewed publication merchant API

All domain changes pass through the existing SensorThings **POST /api/action** writer. The extension has no additional workspace state file, database, scheduler or independent mutation endpoint.

## Authentication and identities

Use the original bearer header and **X-SensorThings-Workspace** UUID. The original listener authenticates and validates workspace identity before merchant API reads. Static files contain no credential. The browser keeps the original bearer in memory, sends it only to its same-origin API and removes the fragment from the visible URL after connection.

Every action has the original request envelope:

~~~json
{
  "action": "analysis.merchant.offer",
  "operationId": "ORIGINAL_OPERATION_ID",
  "expectedRevision": 42,
  "payload": {}
}
~~~

For a new operation, expectedRevision is the actual current original revision. A repeated operation ID must retain the same canonical action/payload identity; the original writer returns or continues that operation. The server operation's **requestSha256** is the canonical identity of action plus payload. **resultSha256** is SHA256 of the exact stored, pretty-printed JSON bytes including the final newline. A native caller separately records the exact raw HTTP request bytes and their SHA.

Read **GET /api/operations/<operationId>** after uncertain dispatch. It returns the original state, request/result identities and completed result. Absence is an original-operation lookup result, not proof that a concurrent dispatched request cannot still finish.

## Actions

Every payload uses an explicit attributed actor. Extra undeclared fields are rejected.

| Action | Payload |
| --- | --- |
| analysis.merchant.offer | publicationId, expectedPublicationSha256, exportId, expectedArchiveSha256, title, description, license, reason, origin, routePrefix, payment, companions, actor |
| analysis.merchant.buyer.prepare | offerId, expectedOfferSha256, file, rowIndex, acceptIndex, intentId, responseOut, actor, note |
| analysis.merchant.inbox.capture | projectId, versionId, publicationId, intentIds, actor, note |
| analysis.merchant.receive | projectId, versionId, catalog, handoff, response, rowIndex, acceptIndex, jobId, publicationId, expectedPublicationSha256, decision, reason, operations, actor |
| analysis.merchant.start | offerId, expectedOfferSha256, actor, note |
| analysis.merchant.stop | offerId, actor, note |
| analysis.merchant.resume | originalOperationId, expectedRequestSha256, actor, reason |

The existing **analysis.export** and **analysis.import** actions perform full project handover. Their payloads remain **{projectId,actor,note}** and **{filename,expectedSha256,expectedBytes,actor,note}** respectively.

### Offer terms

Title is 1–32 printable ASCII characters, using the existing native service constraint. Description is at most 1,400 characters; license/attribution statement 1,500; reason 12,000. Origin is an explicit HTTPS origin without path/query/fragment. RoutePrefix is an explicit fixed versioned path and cannot enter the native reserved seller namespace.

Payment retains:

~~~json
{
  "scheme": "EXACT_NATIVE_SCHEME",
  "network": "stellar:testnet",
  "asset": "EXACT_NATIVE_ASSET",
  "amount": "EXACT_ATOMIC_INTEGER_STRING",
  "payTo": "ORIGINAL_RECIPIENT",
  "maxTimeoutSeconds": 300,
  "extra": {}
}
~~~

The native compiler validates the actual scheme, network, asset, recipient and terms. Testnet and public-network choices remain explicit. Companions is an ordered list of distinct exact publication filenames, with at most 40 entries. The mandatory route key **project** serves **project.ndjson.gz**. Companion route keys are **publication-0**, **publication-1**, and so on in that selected order.

The source selection requires an existing immutable publication, its currently accepted exact source review, and a completed original project export that contains the same publication. The resulting binding retains originalWorkspaceId, projectId, publicationId/publicationSha256, versionId, editionId, sourceReviewSha256, exportId, manifestSha256, snapshotSha256 and the archive's bytes/SHA.

The native bundle is built by SF30. Both preparation recovery and inspection compare its actual portable seller configuration and compiled offers with the configuration derived from that frozen source and reviewed terms.

### Receiving files and native buyer selection

Catalog, handoff and response each use an exact host-inbox descriptor:

~~~json
{"filename":"EXACT_ORIGINAL_NAME","bytes":1234,"sha256":"EXACT_SHA256"}
~~~

Only the host-selected source inbox is read. The catalog maximum is 1 MiB; native handoff 8 MiB; response uses the original 16 MiB file-asset bound. Paths and credentials cannot be supplied through these descriptors.

The native reader selects an original receivable **jobId**, exact catalog row and payment-option index. It compares original method/URL, native payment expectations, asset metadata, verified output byte count and SHA. Receiving binds the response to the selected publication inside the original complete project archive.

Decision is **received** or **changes_requested**, with an explicit reason. Preview is read-only and distinguishes manifest/hash inspection from full member receiving. Completion requires the actual original importer and its entire object/file/citation closure.

### Optional Operations selection

Use null for no Operations association. A committed association contains:

~~~json
{
  "caseId": "operation-ORIGINAL_32_HEX",
  "deploymentId": "deployment-ORIGINAL_32_HEX",
  "purchaseId": null,
  "expectedCaseVersion": 7,
  "expectedPreviewSha256": "EXACT_ORIGINAL_PREVIEW_SHA",
  "origin": "https://ACTUAL_OPERATIONS_ORIGIN"
}
~~~

An existing purchase uses **purchase-<32 hex>**. The preview request selects only **{caseId}**; the actual current reader supplies the origin, program/version, native preview and existing records. The UI records deployment/purchase choices and uses that current preview at commit.

The receiving phases call the original **buyer.receive**, **source.add** and **purchase.observe** commands. Each original request/body is frozen before its HTTP dispatch. Exact original command recovery handles an uncertain reply. The final **operations-observation** phase freezes the first resulting original case observation; later case changes are separate current state.

### Local continuation

A merchant action retains a workspace/request/context-bound owner record before phase work. Every phase record binds that same workspace ID, operation ID, request SHA and frozen context SHA. An imported directory of historical phase files does not authorize execution in another workspace.

The original resume action accepts a selected local merchant operation and its exact request SHA. Its attributed wrapper preserves the original payload, source selection, phase IDs and historical results. No capture or service-start result is guessed from a missing file or dead process. Completed record availability is checked before reporting recovered success.

## Read routes

| GET route | Meaning |
| --- | --- |
| /api/analysis/merchant | Current original workspace overview, compact publication/record list, installed limits and live service states |
| /api/analysis/merchant/projects/<projectId> | Same overview filtered to one original project |
| /api/analysis/merchant/records/<recordId> | Verified full original record and actual file availability |
| /api/analysis/merchant/offers/<recordId> | Same native offer inspection |
| /api/analysis/merchant/services/<recordId> | Current process-owned service state, separately from historical start |
| /api/analysis/merchant/operations | Original local merchant operations and imported historical references |
| /api/analysis/merchant/operations/<operationId> | Original local request/result and availability, executed=false |
| /api/analysis/merchant/history/<historyId> | Imported immutable operation history |
| /api/analysis/merchant/inputs?selection=JSON | Read-only exact catalog, handoff or project manifest inspection |
| /api/analysis/merchant/preview?selection=JSON | Native buyer/project/optional Operations review |
| /api/analysis/merchant/operations-cases | Actual original Operations index, returned without an invented schema |
| /api/analysis/merchant/operations-cases/<caseId> | Original selected program and records |

An input selection is **{kind:"catalog"|"handoff"|"project",file:<inbox descriptor>}**. Preview uses the receiving payload's original file/job/publication fields and optional **operations:{caseId}**; the attributed action is still explicit.

Use the existing **/api/files** receiver with **{kind:"analysis",id:<record-or-export ID>}**. Its file listing supplies exact per-file selectors. Merchant artifact selectors retain **<original operationId>/<original filename>**. The browser and CLI preserve these selectors; numbered or sanitized local download names are not substituted as source identity.

## Record and transfer closure

A committed record has schema **stellar-forge.sensorthings-analysis-merchant-record.v1**, a content identity, originWorkspaceId, original operation/request SHA, kind, project/version/publication IDs, creation time, actor, typed value, complete files and the original request/result journal.

Kinds are **offer**, **buyer-preparation**, **inbox-capture**, **receiving**, **service-start** and **service-stop**. The record ID hashes its body without the ID field. The recordSha256 returned by inspection identifies the complete record including its ID.

The complete project transfer adds the merchant records, all referenced original files and operation histories to the existing snapshot. Import validation checks their identities and exact closure. It preserves original origin/workspace attribution and copies them as historical records. The receiving workspace's own operation table remains the authority for any subsequent local action.

Imported histories cannot start services, replay purchases or dispatch original foreign commands. Inspection can verify the historical files and native offer while current service state remains separate. A new offer from an imported project must use the receiving workspace's current accepted source review and its own completed project export.

## Native caller and host runtime

The installed typed exports are in [index.d.mts](index.d.mts). **runMerchantDelivery(input,{page,receiving,signal,progress})** consumes the actual existing Playwright page supplied by the original operation owner. It records exact browser bytes before dispatch, recovers original results, uses the original streaming downloader and verifies complete export/reopen.

The optional native CLI attaches to an existing configured loopback Chromium CDP endpoint. It creates no browser, context or page. The current official contracts describe [connecting over CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) and [closing a connected client](https://playwright.dev/docs/api/class-browser#browser-close). The in-process original page is preferred when already available; CDP is only for an actual existing endpoint supplied by its owner.

The original host accepts **analysisMerchantRuntime** programmatically, or **--merchant-runtime PRIVATE_JSON** through its original CLI/analysis launcher. See [runtime.schema.json](runtime.schema.json). Bearer tokens and factory credentials never come from action payloads. Native factory configuration and active listener mode remain distinct from native buyer payment evidence.
