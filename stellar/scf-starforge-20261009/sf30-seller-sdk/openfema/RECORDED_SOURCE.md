# Receiving recorded OpenFEMA originals

The portfolio application accepts complete original OpenFEMA responses acquired by the native HTTP collector or retained through a public-file connector. Both enter the existing capture importer, source edition, portfolio, dataset, publisher and customer workflow.

The recorded-source path is for a connector that actually returned the complete original file. It does not claim HTTP facts the connector did not expose, construct missing records, substitute a metadata preview for a dataset, or start another provider request.

## What is retained

Every response retains its exact public OpenFEMA URL, complete unchanged body, SHA256 and byte count. The source bundle contains all three selected datasets: disaster declarations, Public Assistance applicants and funded project details. Each dataset includes opening metadata, its complete field dictionary, every ordered cohort page and closing metadata.

A connector receipt additionally retains the complete original create-attachment and download-attachment result objects. The download result includes its original text. The attachment ID, filename, reported MIME type and length must agree between the two results and the body. The attachment MIME type is connector metadata; it is not treated as an observed FEMA HTTP header.

The explicit fields are:

| Field | Meaning |
| --- | --- |
| status, method, headers | Null for this connector path because those provider HTTP facts were not exposed. |
| observedAt | The local clock after the complete connector download returned. |
| observationTiming | connector-download-received. |
| connector.sourceUrl | The exact original public source URL. |
| connector.responseIndex | The original response order, including repeated URLs. |
| connector.sourceSlot | Dataset plus metadata, fields, page/index or metadataEnd. |
| connector.requestedAt | The local clock immediately before the public-file import request. |
| connector.uploadReceivedAt | The local clock after the upload result returned. |
| connector.downloadReceivedAt | The local clock after the complete text download returned. |
| connector.createAttachment | The complete returned upload object. |
| connector.downloadAttachment | The complete returned download object and original text. |
| connectorSha256 | The canonical identity of the complete connector evidence. |

The source URL and source slot must agree with the actual native import stage. An opening metadata receipt cannot silently become its closing receipt after a restart. Repeated URLs remain separate recorded responses.

The original sourceSha256 calculation remains unchanged: it binds the original bodies, complete source queries and selected scope. The separate acquisitionSha256 binds the connector evidence. Connector editions include that acquisition identity in their edition ID; existing direct-HTTP edition identities remain unchanged. Export and receiving verify both identities and preserve the original edition when importing its full exported source bundle.

## Acquire complete bodies

Use the connector's declared public HTTPS file-import operation, then its complete text-download operation for that returned attachment. Preserve both complete result objects and the actual receiving clocks. The source URL is the original FEMA API URL, including its original query and pagination parameters.

A successful attachment upload is not a statement that this application observed HTTP200. Do not populate an HTTP status, method, response header or provider response timestamp from inference. The capture importer emits CONNECTOR_HTTP_METADATA_UNEXPOSED as a source qualification for each affected dataset.

The current Notion text-download capability returns at most 200 KiB per uploaded text attachment. That is a transport limit. Do not truncate a response, discard fields, or reuse a partial body as a complete page. A larger complete uploaded original remains a source artifact until its actual complete receiving route is available. A deliberate change to FEMA page size belongs to a recorded acquisition scope; it cannot be silently substituted into an existing capture ID.

Unattached Notion uploads are temporary. Attach each original to the selected source page promptly and retain the returned upload IDs. The connector's complete downloaded text must match the reported UTF-8 length before it is accepted.

## Construct the original bundle

recorded-source.mjs exports recordConnectorResponse, assembleRecordedSourceBundle and inspectRecordedSourceBundle. They compose the existing stellar-forge.openfema-source-bundle.v1 envelope and use the original exact-number parser.

For each response, pass the exact original URL, response index, source slot, three receiving clocks and the two complete connector result objects to recordConnectorResponse. The result contains the unchanged body as canonical base64, its exact identity and the qualified connector receipt.

The source slots are declarations/metadata, declarations/fields, declarations/page/0 and declarations/metadataEnd, followed by the corresponding applicants and projects slots. Further original pages use page/1, page/2 and so on. Preserve the original response order. The bundle retains the original captureId, scope and label.

assembleRecordedSourceBundle receives:

- captureId: the retained 24-character original capture identifier.
- scope: the original disaster/state/date selection and pageSize.
- label: the source operation's label.
- datasets: each dataset's metadata, fields, ordered pages array and metadataEnd receipts.

The source inspector verifies the complete response bodies and connector identities. The existing capture importer remains the authority for exact query URLs, source scope, metadata and field versions, declared source count, key order, duplicate observations, linked disaster cohort and matching refresh brackets.

## Receiving a bundle through text parts

A complete source bundle can exceed a connector's single text-return limit even when every original response fits. The parts format divides the unchanged whole bundle into contiguous UTF-8 byte ranges. These parts are transport artifacts, not new FEMA source pages or a revised source selection.

The manifest schema is stellar-forge.openfema-recorded-source-parts.v1. It declares encoding utf-8; the full bundle filename, byte count, SHA256 and captureId; and ordered parts with part number, offset, filename, byte count and SHA256. Optional original-response and attachment references remain in the manifest. Parts must cover the entire original bundle exactly once without gaps or overlap.

Save the complete original manifest and every declared part as ordinary files under the chosen receiving directory. Preserve their returned filenames. Then run:

    node recorded-source.mjs inspect \
      --manifest /private/received/OpenFEMA_Recorded_Source_Parts.json \
      --directory /private/received \
      --expected-manifest-sha256 ACTUAL_MANIFEST_SHA256

    node recorded-source.mjs assemble \
      --manifest /private/received/OpenFEMA_Recorded_Source_Parts.json \
      --directory /private/received \
      --expected-manifest-sha256 ACTUAL_MANIFEST_SHA256 \
      --out /private/received/OpenFEMA_Original_Source_Bundle.json

The reader holds each original file while checking its identity, rejects changed files and unsafe member names, verifies every part and then verifies the full bundle. It accepts at most 200 KiB per part and 64 MiB for the assembled source bundle. The original importer still applies its own receiving limits.

An existing output is reused only if its complete length and digest agree. Different or partial output bytes remain untouched; choose another output name while preserving that prior attempt. The receiver does not remove original parts, create symlinks, contact FEMA, start a source capture or mutate a workspace.

The full source bundle contains the original response bytes as base64, so JSON numbers and punctuation in the underlying FEMA bodies are not reserialized by part assembly.

## Import into the original application

Use the existing application source and its selected original workspace:

    openfema receive-source \
      --workspace /private/openfema-workspace \
      --bundle /private/received/OpenFEMA_Original_Source_Bundle.json \
      --operation-id ORIGINAL_RETAINED_OPERATION_ID

The ordinary receive-source command accepts full JSON or gzip. The merchant source.import action accepts a host-declared complete JSON source-package alias with its exact SHA256. See MCP.md for that configuration and MANAGED.md for the existing Applications lifecycle.

Keep the same original bundle and operation ID when reopening an interrupted import. Native capture.run rejects an imported capture and directs receiving back to the same original bundle. A capture ID already used for a distinct native or imported acquisition is not reset or overwritten.

A failed import retains the original operation, received bodies and source state. A later import of the same bundle continues the existing import. No new source request or replacement collection is implied by reconnecting the client.

## Complete the disaster portfolio

The native receiving result returns the actual immutable source edition ID. Use that returned ID to create the intended DR or regional portfolio through the existing portfolio command or browser. The source table exposes all retained rows and source qualifications.

For a declared disaster portfolio, retain the exact criterion, original source edition, analyst annotations and reviewed relationships. An applicantSourceId is an explicit selection from an original applicant record and requires an explanatory note. Do not guess an applicant join merely because displayed names look similar.

Use the existing version ID for portfolio rows, detailed source records, comparisons, analyst review and HTML/JSON/CSV exports. The native dataset.prepare action packages the selected original projection with its complete source provenance. The existing release and buyer engines continue from that same dataset; receipt identities and payment operations are not recreated by source receiving.

The metadata for PublicAssistanceFundedProjectsDetails v2 describes a system migration and record-count changes. Preserve that description and the selected source refresh with the report. Dollar amounts remain exact original decimal strings and retain their signs; they are the source dataset's reported quantities, not inferred cash payments or procurement awards.

## Export and reopen

Use the native source-export command or source.export action to obtain the complete original source bundle with its edition and all receipt evidence. Reimporting that complete export preserves the original source and acquisition identities and the supplied immutable edition. Closing and reopening the workspace verifies the retained edition identities.

The original receive-original-bundle.mjs driver exercises import, full export, receiving into a new original-kernel workspace, and close/reopen. Its outcome must come from an actual accepted runtime. Source-byte inspection, connector acquisition and a V8 syntax check do not establish that this native workflow executed.

Complete portfolio reports, fixed source/customer files and current workspace backup use their existing file/download contracts. MCP complete-file receiving verifies fixed manifests, byte counts and digests, and can reopen those selected files offline. A current workspace ZIP is a fresh workspace snapshot; its URL alone is not a permanent original-file identity.

Keep the complete original bundle, manifest and source attachments with the final source edition and customer report. That lets a recipient inspect both the public records and exactly how the source arrived without repeating the provider acquisition.
