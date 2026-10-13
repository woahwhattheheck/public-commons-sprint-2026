# Receive a complete Flowable workspace

The original exporter retains a frozen snapshot of saved connections,
portfolio captures, releases, process and task operations, migration reviews,
source blobs and request journals. It writes one complete NDJSON handover
with original record identities, member hashes and a final digest.

Receiving preserves that original history through inspection, adoption and
same-directory reopen. The target workspace keeps its own UUID and records
the source workspace provenance.

## Export the original snapshot

Save a request UUID, then create the delivery:

~~~sh
starforge flowable-product export --dir /srv/private/process-operations \
  --request EXPORT_REQUEST_UUID --label "Customer process operations"
~~~

Retain the returned delivery ID, revision, record SHA and
`value.file.bytes` / `value.file.sha256`. Later changes in the source
workspace do not alter this frozen edition. Repeating the export request
with unchanged arguments reopens its original result.

If the generated NDJSON file is lost, the original exporter can reconstruct
its exact bytes from the saved snapshot and immutable members. Full source
resources and the original retained journal prefixes travel with the
delivery.

## Download the complete file

~~~sh
umask 077
mkdir -p /srv/private/received-flowable
chmod 700 /srv/private/received-flowable

starforge flowable-product download --dir /srv/private/process-operations \
  --id DELIVERY_RECORD_ID --sha256 ORIGINAL_FILE_SHA256 \
  --out /srv/private/received-flowable/customer.ndjson
~~~

The installed client selects the original EXPORTED record and checks the
file endpoint's full content length and SHA-256 against it. It streams every
chunk into a private output, verifies the complete hash, synchronizes the
file and publishes it under the original output lease.

The receipt binds product/workspace IDs, delivery ID and revision, record
SHA, destination, full byte count and file SHA. Retain it with the handover.
Repeating the same download reopens an existing identical file. A different
file at that destination produces a conflict that preserves the existing
content.

Use the same delivery ID, expected hash and output path after an interrupted
download. The native export snapshot remains unchanged.

## Open the receiving application

Use a new private product/workspace for an independent receiving history:

~~~sh
starforge flowable-product init --dir /srv/private/customer-flowable \
  --name "Customer process operations"
starforge flowable-product open --dir /srv/private/customer-flowable --port 0
~~~

Inspect the full received file through that application's current URL:

~~~sh
starforge flowable-product receive --dir /srv/private/customer-flowable \
  --request INSPECTION_REQUEST_UUID \
  --file /srv/private/received-flowable/customer.ndjson \
  --label "Original process workspace"
~~~

This streams the original private file to the existing
`/api/delivery/inspect` route. The receiver validates the complete header,
record editions, request identities, source/blob references, journal bytes,
manifest and final file digest. Its INSPECTED record retains the full
original source needed for adoption.

Read the inspected summary and retain its record ID, revision and
`value.manifestSha256`. The browser's receiving view offers the same
complete inspection and adoption over the same workspace.

## Adopt the exact inspected history

~~~sh
starforge flowable-product adopt --dir /srv/private/customer-flowable \
  --request ADOPTION_REQUEST_UUID --id RECEIVING_RECORD_ID \
  --revision INSPECTED_REVISION --manifest-sha256 ORIGINAL_MANIFEST_SHA256
~~~

The store checks original history and request collisions before publishing
the adopted revisions. It keeps complete record histories, current heads,
request indexes, native source blobs and retained journal prefixes.
Conflicting editions of the same original record remain explicit and require
a different receiving workspace.

If adoption is interrupted, retain the same request UUID, receiving ID,
original inspected revision and manifest SHA. A saved ADOPTING transaction
resumes through the original model on workspace reopen. An ADOPTED record
reopens its completed receiving result.

The workspace archive contains environment-variable names from the saved
connections. Supply their corresponding credential values on the receiving
host before operating the original engine.

## Open the received process history

~~~sh
starforge flowable-product status --dir /srv/private/customer-flowable

starforge flowable-product records --dir /srv/private/customer-flowable \
  --kind portfolio --offset 0 --limit 50
starforge flowable-product records --dir /srv/private/customer-flowable \
  --kind migration --offset 0 --limit 50
starforge flowable-product record --dir /srv/private/customer-flowable \
  --kind receiving --id RECEIVING_RECORD_ID
~~~

Open an original portfolio definition and download its complete resource.
Open a release, task or migration record to read the exact native request,
validation, response and current/history observations. Imported operations
retain their original dispatch identities and uncertainty states.

Stop and reopen the receiving product. Verify the same workspace UUID,
selected original records and ADOPTED result remain available. Later source
editions can be exported and inspected through the same original format.

## Receive source and review files

Every native review exposes complete original source references. Use
`download-source --reference PRIVATE_REFERENCE_JSON --out PRIVATE_FILE`
for a BPMN resource, native request, validation, exchange, readback or
journal. The reference binds the full byte length and SHA-256.

For a large original JSON action response, use
`call --method METHOD --input PRIVATE_ARGS_JSON --out PRIVATE_JSON`.
The caller's exact saved request ID remains part of write operations.

## Use the typed receiving client

~~~js
const file = await sourceClient.downloadDelivery({
  id: originalDelivery.id,
  expectedSha256: originalDelivery.value.file.sha256,
  path: '/srv/private/received-flowable/customer.ndjson'
});

const inspection = await customerClient.inspectDeliveryFile({
  requestId: savedInspectionRequestId,
  path: file.path,
  expectedSha256: file.sha256,
  label: 'Original process workspace'
});

const received = await customerClient.adoptDelivery({
  requestId: savedAdoptionRequestId,
  id: inspection.id,
  expectedRevision: inspection.revision,
  manifestSha256: inspection.value.manifestSha256
});
~~~

Keep the original UUIDs and results across client restarts. The complete
source file, inspected manifest and adoption transaction are the same
ones used by the browser and command line.

## Receive complete case history

A case programme uses the same complete NDJSON handover. Export and cold receiving preserve every casePortfolio, caseRelease, caseInstance, casePlanItem and caseTask revision, together with original CMMN deployment resources, binary variable data, native exchanges and journals. The received workspace opens its saved Cases view and can continue against its actual named CMMN service. See the [complete case programme](CASES.md).
