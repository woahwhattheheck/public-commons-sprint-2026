# SensorThings source handover and receiving

This guide covers the complete source-edition transfer and file-access interfaces in the existing SensorThings workspace. It accompanies portable.mjs and files.mjs. The core, CLI, MCP listener and Operations desk retain their existing workspace and operation ownership.

The transfer carries the complete declared immutable source closure: the selected edition, its original query and scope, retained provider-response objects, stream and page metadata, source and licence context, and the original review history. A receiver gets the same source edition ID and a separate receiving receipt. Original reviews are retained as evidence; they do not become a new receiving approval.

A partial source edition remains partial after transfer. The archive does not turn a paginated capture into an atomic provider snapshot, fill missing observations, remove source qualifiers, or claim that the publisher approved an edited value. Read the retained edition scope and metadata before using the observations.

## 1. Identities and custody

Several hashes describe different objects. Keep the full set in a handover and compare the appropriate identity at each boundary.

| Identity | What it binds | How it is used |
|---|---|---|
| Edition ID | The original canonical source-edition structure | The same edition is reopened after receiving. |
| Source-object SHA256 and bytes | One complete original provider response or declared source member | Every original object is verified before export and after receipt. |
| Transfer-manifest SHA256 | The complete canonical transfer manifest, including the frozen edition, selected review history and object inventory | The receiving receipt binds the exact original source selection. |
| Archive SHA256 and bytes | The complete compressed transfer file | The receiver selects an exact file, verifies it, then decodes it. |
| Operation ID | One retained action and its original intent | An uncertain reply is reconciled through that same operation. |
| Receiving receipt ID | The receiving action in its own workspace | Original and receiving custody remain distinguishable. |
| Dataset or customer-file SHA256 | One selected completed product file | Range reads and complete downloads bind the original file bytes. |
| Read ID | One process-local retained file descriptor or generated snapshot | Subsequent ranges use the same selection and expected SHA256. |

The original source edition and the original dataset are different products. Transferring a source edition does not recreate a prior seller session, capture plan, payment journal or customer acquisition. Those operations remain with their existing native owners. A receiver that wants a new dataset selects and reviews the received source through the normal workspace workflow.

If the receiving workspace already knows the edition, the core preserves its existing local review history. The returned preservedLocalReviewId, when present, identifies that local decision. The archive's originalReviews remain attached to the receiving evidence.

## 2. Export a selected source edition

First open the existing workspace view and select its actual edition ID. Submit the normal source action through POST /api/action, or use the CLI or MCP action with the same fields.

The identifiers and revision below are illustrative. Use the actual current revision and an operation ID reserved for this action.

~~~json
{
  "operationId": "source_export_20261012_001",
  "expectedRevision": 12,
  "action": "edition.export",
  "payload": {
    "editionId": "<actual original edition SHA256>"
  }
}
~~~

The core freezes the selected edition and its original review snapshot in the operation context. The portable module retains an export-plan.json before building the file. A retry of this operation uses that same frozen selection and original creation time; later reviews do not silently change the archive under an existing operation ID.

The successful action returns a transfer receipt with this structure:

~~~json
{
  "schema": "stellar-forge.sensorthings-transfer-receipt.v1",
  "id": "<original export ID>",
  "kind": "source-edition",
  "createdAt": "<original operation creation time>",
  "editionId": "<original edition ID>",
  "originalWorkspaceId": "<original workspace UUID>",
  "manifestSha256": "<complete canonical manifest SHA256>",
  "objects": "<actual integer count>",
  "sourceBytes": "<actual integer byte count>",
  "file": {
    "filename": "<actual source archive filename>",
    "type": "application/gzip",
    "relativePath": "exports/<original export ID>/<actual filename>",
    "bytes": "<actual integer byte count>",
    "sha256": "<whole compressed-file SHA256>"
  }
}
~~~

The quoted count placeholders above describe fields; actual receipts contain integers.

The archive is an NDJSON stream compressed with gzip. It contains a complete manifest followed by the exact declared source objects. The exporter reads each original object through a held read-only file descriptor, verifies its complete bytes, and records an explicit final completion record. It writes and verifies a completed candidate before publishing the final archive and transfer receipt.

Use the completed receipt as the file selection. A started attempt or temporary prefix is not a completed handover.

## 3. List and read retained files

The file layer accepts manifest-backed selections, not caller filesystem paths. It resolves the selected edition, dataset, comparison, transfer, buyer receipt or publisher object in the original workspace and returns only the declared files.

The listener exposes:

| Request | Purpose |
|---|---|
| GET /api/files?selection=JSON | List the files for a JSON selection, URL-encoded as the query value. |
| POST /api/files/read | Read one bounded range of one selected file. |
| POST /api/files/release | Release the original read ID when finished. |

Use the existing listener's host binding and authorization. The file layer does not add a separate account or credential store. The listener's schema and CLI help define the final transport command names.

For the source archive, list this selection:

~~~json
{
  "kind": "transfer",
  "id": "<actual export ID>"
}
~~~

The list result includes:

~~~json
{
  "schema": "stellar-forge.sensorthings-files.v1",
  "workspaceId": "<workspace UUID>",
  "selection": {
    "kind": "transfer",
    "id": "<actual export ID>"
  },
  "files": [
    {
      "selection": {
        "kind": "transfer",
        "id": "<actual export ID>",
        "file": "archive"
      },
      "name": "<actual archive filename>",
      "type": "application/gzip",
      "bytes": "<actual integer byte count>",
      "sha256": "<whole compressed-file SHA256>",
      "retention": "ORIGINAL_IMMUTABLE_FILE",
      "verification": "COMPLETE_HELD_FD_HASH_BEFORE_FIRST_BYTE"
    }
  ],
  "reads": "<native retained-read status>",
  "contract": "<file-selection contract>"
}
~~~

The complete list can also include transfer.json. Do not assume the displayed example is the only member.

Select one listed file and request its first range:

~~~json
{
  "selection": {
    "kind": "transfer",
    "id": "<actual export ID>",
    "file": "archive"
  },
  "expectedSha256": "<SHA256 from the completed list or receipt>",
  "offset": 0,
  "limit": 65536
}
~~~

The response keeps the maintained RetainedFileReads result:

~~~json
{
  "readId": "<original native read UUID>",
  "file": {
    "name": "<actual filename>",
    "contentType": "application/gzip",
    "type": "application/gzip",
    "bytes": "<actual integer byte count>",
    "sha256": "<whole file SHA256>"
  },
  "offset": 0,
  "bytesRead": "<actual integer byte count>",
  "nextOffset": "<next integer offset, or null at completion>",
  "encoding": "base64",
  "data": "<exact returned bytes as base64>"
}
~~~

The type field is an alias for the native reader's contentType. Both describe the same original response.

Decode the returned base64 and write those bytes at the declared offset. Do not treat JSON response length, base64 length or the number of pages as the file's byte count. Repeat the same selection, readId and expectedSha256, and advance to the returned nextOffset. Stop when nextOffset is null. Verify the completed destination's exact byte count and whole SHA256 against the original receipt.

The maintained CLI composes this interface with the existing retained-download.mjs receiver. That receiver owns its existing destination lock, retained prefix checks, same-file resume and final digest verification. There is no second download journal in files.mjs.

### File descriptors and restart

Fixed files are fully hashed through the same held read-only descriptor before the first byte is returned. Original manifest hashes are checked against that descriptor. The native reader bounds ranges to 65,536 bytes and retains up to four reads per instance. Idle reads expire after 120 seconds.

A read ID belongs to the current process. After a listener restart or idle expiry, reopen an immutable file using the same manifest selection, expected SHA256 and saved byte offset. A nonzero offset requires the expected SHA256. The receiver must also verify its retained destination prefix before appending more bytes; the original retained-download.mjs handles this for complete CLI receiving.

If the original bytes no longer match the requested SHA256, the read fails. Do not replace the expected hash to make an interrupted file appear complete.

Release an active read ID when the file is complete or the operator abandons it. Closing the file-access owner releases its remaining reads.

### Generated publisher draft review

The native publisher's draft-review export is generated metadata. Its original implementation includes the export time, so it has no fixed immutable file identity before generation.

For this selection, list returns bytes:null and sha256:null, with retention ORIGINAL_GENERATED_READ_SESSION. The first read fixes a process-local snapshot and returns its actual read ID, bytes and SHA256. Continue that same snapshot with its returned identity.

After a cold restart, generating the review again can produce different bytes because its export time changed. A prior expected hash may correctly fail. The CLI's manifest-based whole-file receiving requires an already fixed identity; source objects, completed datasets, source-transfer archives and customer files provide one. A generated draft review must first be materialized through its original read session.

This distinction applies only to the native generated view. The original draft CSV and completed customer or session files retain their declared file hashes.

## 4. File selection reference

List operations may enumerate a collection of files. A read must resolve to one exact member.

| Kind | Required selection | Available files |
|---|---|---|
| source | id = edition ID; sha256 = exact member hash for a read | Complete original objects declared by that edition. Listing can omit sha256. |
| edition | id = edition ID | edition.json |
| dataset | id = native dataset ID | dataset.csv, dataset.json, source.json, dataset-receipt.json, and exact original source-manifest members. |
| comparison | id = retained comparison ID | comparison.json and changes.jsonl |
| transfer, exported | id = original export ID | archive and transfer.json |
| transfer, received | id = receiving receipt ID | source-receiving.json and original-transfer-manifest.json |
| buyer | id = original buyer receipt ID | dataset.csv, dataset.jsonl, review.html, delivery.json and manifest.json |
| publisher | datasetId = native dataset ID; id = original draft, buyer configuration or session UUID | draft-csv, draft-review, buyer-config, session-manifest, session-delivery-manifest, session-csv, session-jsonl and session-review |

For a source read, the original hash is the member selector. For the other fixed products, use the exact file value returned by list. Source-manifest members are checked against the original manifest and normalized relative layout. A client cannot request an unrelated host path by supplying a file name.

Buyer delivery reads validate the original buyer receipt and the fixed native dataset manifest. Publisher reads validate the original draft candidate, buyer configuration or session binding. These checks expose the retained files; they do not launch, retry or change the corresponding purchase, seller session or payment.

## 5. Receive into an existing SensorThings workspace

The host supplies a sourceInboxDirectory specifically for source-edition receiving. Keep it separate from the SF88 buyer inbox and the workspace's managed object directories.

Place the complete original archive in that host-bound inbox as an ordinary private file. Use the exact filename, byte count and whole SHA256 from the export receipt. Filenames are single components; path traversal, caller-selected host directories and workspace symlinks are not part of the receiving interface.

Submit the normal action:

~~~json
{
  "operationId": "source_receive_20261012_001",
  "expectedRevision": 4,
  "action": "edition.import",
  "payload": {
    "filename": "<actual archive filename in the configured inbox>",
    "expectedSha256": "<whole original compressed-file SHA256>",
    "expectedBytes": "<actual integer byte count>"
  }
}
~~~

Use actual integers and identities, not the illustrative placeholders.

Receiving proceeds through the following native boundaries:

1. Open the selected private regular file and verify its exact compressed byte count and SHA256 through the held descriptor.
2. Decode the bounded gzip/NDJSON stream, validate the canonical manifest and source-edition identity, and enforce the complete declared object inventory.
3. Stage each original object while verifying its ordered offsets, complete byte count and SHA256.
4. Verify the stream's final completion record and absence of trailing records before exposing the received edition.
5. Publish the exact objects into the original content-addressed store. Existing objects must match the same complete identities.
6. Retain the original transfer manifest and the new receiving receipt, then let the core record the received edition and receiving-review state in its normal operation.

The receipt uses schema stellar-forge.sensorthings-source-receiving.v1 and includes:

- The receiving operation ID and original creation time.
- The unchanged editionId.
- Both originalWorkspaceId and receivingWorkspaceId.
- The original archive filename, bytes and SHA256.
- The transfer manifest hash and complete object/source byte counts.
- originalReviews as retained evidence.
- reviewState: RECEIVING_REVIEW_REQUIRED.
- The receiving attempt identity and the declared scope.

The core retains this receipt in sourceReceipts. When the edition was already present, any existing local decision is preserved separately.

The received archive does not import old capture-resume plans, active seller processes, buyer queues or payment state. It also does not give a new workspace the source publisher's authority. The receiving operator makes the local review decision using the same source review workflow as other editions.

### Reopen after receipt

After successful receiving, the original decoded source objects, exact edition and complete transfer manifest are retained in the receiving workspace. The source inbox archive is not redundantly copied into the workspace object store.

A repeated completed receive verifies its existing receiving receipt, edition, manifest and all declared source objects. It can return that same result after the host moves the original archive out of the inbox. Keep the original archive and export receipt in the organization's normal delivery custody if it needs to reproduce that exact compressed file.

The receiving receipt and original manifest are also available through the transfer file selectors. This permits a complete receiving handoff without exposing the host's source-inbox path.

## 6. Recovery and operation meaning

The core operation ledger remains authoritative. Distinguish an uncertain response from a completed action and from a known failed attempt. Consult the existing operation state before changing identifiers or starting another action.

| Situation | Correct continuation |
|---|---|
| The export action completed but its reply was lost | Reconcile the same operation ID and return the retained completed transfer receipt. |
| Export file production stopped | Keep the frozen export plan and original attempt evidence. Continue the same original selection through the operation owner. |
| A complete export candidate exists but final publication was interrupted | Verify that candidate's exact file identity and publish the same candidate; do not rebuild it from newer reviews. |
| A file range response was lost | Use the receiver's retained prefix and same file hash. Read the corresponding original range again if necessary. |
| A retained read expired or its listener restarted | Reopen the immutable selection using its expected SHA256 and saved offset. |
| Receiving stopped while staging objects | Preserve the original failed attempt/prefix evidence. No staged prefix is treated as a received edition. |
| Object publication completed but the receiving reply was lost | Reconcile the existing operation/receipt and verify the original retained objects. |
| The received archive is no longer in the inbox | A completed receipt can reopen from its exact retained objects and original manifest. |
| A source or target file differs from its receipt | Stop that read or receive with its identity error; retain the original expected identity. |

Temporary staging is retired only after success and exact source-to-published byte/hash verification. Failed prefixes remain attempt evidence. A cleanup failure does not change a completed source receive into a failed source operation. The original attempt journal records completed publication and the cleanup state that could be retained.

Do not retire an input or a temporary file merely because another file has the same name or byte count. Complete byte hashes and the published receipt establish equivalence.

## 7. Transfer format and validation

The archive is gzip containing strict UTF-8 NDJSON. Its records are:

- One manifest containing the transfer schema, original workspace identity, complete original edition, selected review history and deduplicated source-object inventory.
- For each source object, an object declaration, ordered base64 chunk records and a complete object-end record.
- One final complete record binding the manifest and source totals.

The implementation rejects malformed UTF-8, duplicate JSON keys, undeclared record fields, noncanonical or malformed base64, out-of-order or overlapping chunk offsets, unexpected objects, size or hash mismatches, truncated lines and records after completion. It validates the full archive before publishing the source edition.

Object bytes remain the original provider bytes. The transfer wrapper does not parse and rewrite provider values, numeric lexemes, geometry or result qualifiers. Edition metadata remains the source owner's canonical declared structure.

The manifest is deduplicated by complete object SHA256. A source object referenced by multiple pages or metadata rows travels once, while the original edition retains all of those references.

## 8. Capacity and bounded I/O

The following are implementation admission limits, not statements about the size or completeness of a particular provider capture.

| Limit | Value |
|---|---:|
| Source-object chunk in the transfer stream | 48 KiB |
| Fixed-buffer file hashing | 64 KiB |
| One source object | 256 MiB |
| Sum of deduplicated source bytes | 2 GiB |
| Complete compressed source archive | 2 GiB |
| Expanded transfer stream | 4 GiB |
| One transfer line or retained transfer metadata file | 24 MiB |
| Retained source-edition metadata | 16 MiB |
| Deduplicated source objects | 100,000 |
| One manifest-selected fixed file | 8 GiB |
| One file range | 64 KiB |
| Simultaneous retained reads per file-access instance | 4 |
| Retained-read idle expiry | 120 seconds |

Files are streamed with bounded buffers. The current implementation keeps the edition/manifest and object inventory in memory; it does not hold all source-object bytes or the whole archive in memory.

Export staging requires space for the complete archive and its small receipts. Receiving staging requires space for the new source-object bytes before those objects are published. Successful matching staging files can then be retired. The implementation retains failed prefixes for custody, so operators should inspect actual completed and failed operation receipts when managing space.

A limit failure is explicit. Do not silently truncate a source object, omit archive members, or change the source edition to fit a transfer. If a future source exceeds an admission limit, the source owner must make a deliberate compatible implementation change or choose an explicitly scoped source edition.

## 9. Reusable module interface

The portable module uses the same openWorkspaceStore instance as the core:

~~~javascript
import { exportEdition, importEdition } from './portable.mjs';

const exported = await exportEdition(store, {
  edition,
  reviews,
  id: originalExportId,
  createdAt: originalCreationTime
});

const received = await importEdition(store, {
  inboxDirectory: configuredSourceInbox,
  filename: originalArchiveName,
  expectedSha256: originalArchiveSha256,
  expectedBytes: originalArchiveBytes,
  id: originalReceivingId,
  createdAt: originalReceivingCreationTime
});
~~~

The caller supplies the original retained operation identity and time. The module does not create an alternate workspace or operation ledger. The core publishes its returned receipt through the existing action/revision mechanism.

The file-access adapter uses the existing SensorThings workspace object:

~~~javascript
import { createFileAccess } from './files.mjs';

const access = createFileAccess(workspace);
try {
  const selected = {
    kind: 'transfer',
    id: originalExportId,
    file: 'archive'
  };
  const listing = await access.list(selected);
  const original = listing.files[0];
  const first = await access.read({
    selection: selected,
    expectedSha256: original.sha256,
    offset: 0,
    limit: 65536
  });
  // Continue using first.readId, first.file.sha256 and first.nextOffset.
  // Write and verify the complete output with the maintained receiver.
  await access.release(first.readId);
} finally {
  await access.close();
}
~~~

The example demonstrates binding and cleanup; it is not a complete-file downloader. The existing retained-download.mjs owns complete destination receiving, prefix recovery and final verification.

The adapter also exposes status(), which returns its native retained-read summary. Neither list nor read performs source capture, purchase, settlement or a new publisher release.

## 10. Original source and integration boundaries

The implementation reuses the following maintained source:

| Source | Responsibility |
|---|---|
| sensorthings/contract.mjs | Canonical source/workspace identities and validation errors. |
| stellar-expert/store.mjs | Existing owned workspace, immutable files, content-addressed source objects and kernel write ownership. |
| stellar-expert/exact-json.mjs | Exact JSON structure checking for transfer records. |
| stellar-forge/mcp-merchant-operator/retained-file-reads.mjs | Original held-file and generated-snapshot range reader. |
| stellar-forge/mcp-merchant-operator/retained-download.mjs | Existing complete-file receiving and destination journal used by CLI integration. |
| sensorthings/core.mjs | Edition actions, original operation state, local reviews and received-source state. |
| Original dataset, publisher and buyer modules | Completed product manifests, session bindings and customer files. |

The portable/file modules live under stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/. The maintained merchant reader is under the separate repository-root stellar-forge/mcp-merchant-operator/ path. Preserve that source join in packaging and installed-source composition.

## 11. Native operation and receiving status

At this guide's initial source publication, the complete portable/file modules are retained and their Git blob contents have been read back exactly. The native syntax/import check and the original live-provider capture-to-receiving journey are separate execution evidence; source publication alone does not claim they have occurred.

The source owner retains the sole actual provider capture. The browser owner retains the existing Operations desk and managed Applications integration. The portable/file owner joins their same captured source edition for complete export, exact file delivery, receiving review and reopen. No additional provider capture is needed to validate that receiving path.

Record the actual provider URL/scope, source edition ID, export receipt, archive bytes/hash, receiving workspace/receipt, selected local review and completed file-receiver result in that original operation. Keep the source packet and actual native output with the existing OGC/SensorThings project and normal cumulative release. The examples in this guide are interface examples, not observed Hamburg records or a completed customer delivery.
