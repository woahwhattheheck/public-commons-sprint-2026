# Receive a complete Tyk workspace

The native Tyk handover is a complete NDJSON file containing the selected
workspace history, original records, source blobs and journals. The original
exporter freezes its source snapshot and writes the full file with native
header, member hashes and final digest. The receiver validates that same
format and adopts its original records through the existing workspace store.

## Export a frozen handover

Save one export request UUID before creating the delivery:

~~~sh
starforge tyk-product export --dir /srv/private/tyk-product \
  --request EXPORT_REQUEST_UUID --label "Customer API operations"
~~~

Retain the returned delivery record ID, revision and
`value.file.bytes` / `value.file.sha256`. Later work in the source workspace
does not change this frozen delivery. Repeating the same export request with
unchanged arguments reopens its original snapshot. If a generated delivery
file was lost, the original exporter can reconstruct its exact bytes from
that retained snapshot.

The complete history includes target revisions, captures, cohorts, reviewed
rollouts, original exchange/source data and retained journal prefixes.
Credential environment-variable names are part of saved target definitions;
the environment values remain on the respective native host.

## Download and reopen the original file

~~~sh
umask 077
mkdir -p /srv/private/received-tyk
chmod 700 /srv/private/received-tyk

starforge tyk-product download --dir /srv/private/tyk-product \
  --id DELIVERY_RECORD_ID --sha256 ORIGINAL_FILE_SHA256 \
  --out /srv/private/received-tyk/customer.ndjson
~~~

The client first selects the original EXPORTED record. It then verifies the
file endpoint's complete content length and `x-content-sha256` against that
record, streams every chunk, hashes the complete output and publishes it only
after file synchronization. The original per-output kernel lease serializes
its publication.

The returned receipt records the product and workspace identities, delivery
ID/revision, record SHA, path, complete byte count and file SHA. Save it with
the customer handover. The same command reopens an existing identical full
file. A different file at that path produces a conflict that preserves the
existing bytes.

A download interruption leaves the native export identity intact. Invoke the
same download with the same delivery ID, SHA and destination to complete its
original file.

## Open the receiving workspace

Use a fresh customer workspace when receiving an independent handover:

~~~sh
starforge tyk-product init --dir /srv/private/customer-tyk-product \
  --name "Customer API operations"
starforge tyk-product open --dir /srv/private/customer-tyk-product --port 0
~~~

In another terminal, inspect the complete received file:

~~~sh
starforge tyk-product receive --dir /srv/private/customer-tyk-product \
  --request INSPECTION_REQUEST_UUID \
  --file /srv/private/received-tyk/customer.ndjson \
  --label "Original customer handover"
~~~

The client streams the full private file to the original
`/api/delivery/inspect` endpoint. The request UUID and encoded delivery name
are retained through the native incoming-file selection. The model validates
the original package, every record revision and source reference, all file
bytes, the final digest and the complete source closure before returning its
INSPECTED receiving record.

Read that saved receiving record and its summary. Keep its actual record ID,
revision and `value.manifestSha256`. Inspection retains the full source needed
for the subsequent receiving transaction.

## Adopt the exact inspected history

~~~sh
starforge tyk-product adopt --dir /srv/private/customer-tyk-product \
  --request ADOPTION_REQUEST_UUID --id RECEIVING_RECORD_ID \
  --revision INSPECTED_REVISION --manifest-sha256 ORIGINAL_MANIFEST_SHA256
~~~

The original model checks history collisions before publication. It receives
the exact original records, request identities, current heads, blobs and
journals. A conflicting edition of the same original record requires a fresh
receiving workspace; existing customer history remains preserved.

If adoption is interrupted, continue the same request UUID, receiving record,
original inspected revision and manifest SHA. A retained ADOPTING operation
resumes through the original model on workspace reopen. An ADOPTED record
returns its completed original receiving result.

The receiving host retains its own workspace UUID while preserving the source
workspace's provenance and record identities. Configure its existing native
credentials using the saved environment-variable names before operating its
targets.

## Verify the customer's usable workspace

Read the current customer workspace and page its original saved records:

~~~sh
starforge tyk-product status --dir /srv/private/customer-tyk-product
starforge tyk-product records --dir /srv/private/customer-tyk-product \
  --kind capture --offset 0 --limit 50
starforge tyk-product records --dir /srv/private/customer-tyk-product \
  --kind rollout --offset 0 --limit 50
starforge tyk-product record --dir /srv/private/customer-tyk-product \
  --kind receiving --id RECEIVING_RECORD_ID
~~~

Open a retained capture definition and a selected rollout to inspect their
full original source, request plan, response and active-state observations.
The native history continues from those records. Imported completed or
uncertain operations retain their original dispatch identity.

Stop and reopen the same installed product. Confirm its workspace UUID, saved
record selections and ADOPTED receiving record remain available. Runtime
upgrades can select a new reviewed runtime directory while preserving this
private product and native workspace.

## Complete source and review files

The original field review returns a complete report reference and its
before/after native source references. Receive these through
`download-source --reference PRIVATE_REFERENCE_JSON --out PRIVATE_FILE`.
Their full SHA-256 and byte count travel with the original immutable reference.
For a large native action result, `call --method METHOD --input PRIVATE_ARGS_JSON
--out PRIVATE_JSON` streams the complete JSON reply into the selected file.
The same caller-owned request UUID is preserved for write actions.

## SDK file receiving

~~~js
const received = await sourceClient.downloadDelivery({
  id: originalDelivery.id,
  expectedSha256: originalDelivery.value.file.sha256,
  path: '/srv/private/received-tyk/customer.ndjson'
});

const inspection = await customerClient.inspectDeliveryFile({
  requestId: savedInspectionRequestId,
  path: received.path,
  label: 'Original customer handover'
});

const adopted = await customerClient.adoptDelivery({
  requestId: savedAdoptionRequestId,
  id: inspection.id,
  expectedRevision: inspection.revision,
  manifestSha256: inspection.value.manifestSha256
});
~~~

Use saved request IDs in these calls. The same complete file, inspected
manifest and original receiving transaction remain usable across SDK process
restarts and customer workspace reopen.
