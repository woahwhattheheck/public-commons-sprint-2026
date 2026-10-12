# Native workspace transfer and receiving

This is the operating reference for the original `grpc-transfer` command and `transfer/client.mjs`. The helper uses Python's standard library for bounded-memory archive packing and receiving; the installed original gRPC engine validates and reopens the received project.

## Setup

Use the existing SDK/runtime dependency closure. The native operator's private connection file contains either its full private URL string or a JSON object with a `url` field. Pass the filename to the CLI. The file is read again by each invocation; keep it and result files private.

The commands below use `GRPC_TRANSFER_CLI` for the installed `grpc/transfer/cli.mjs` path. Capture, upload and receive inputs are saved JSON files with stable UUIDs generated once for their respective operations.

```sh
GRPC_TRANSFER_CLI=/opt/starforge/source/stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/transfer/cli.mjs

node "$GRPC_TRANSFER_CLI" list \
  --connection /srv/grpc/operator/connection.json \
  --output /srv/grpc/transfer/list.json
```

Create the parent of output/download/receiving paths as a private real directory. Source and destination workspaces must be disjoint. Directory parents containing a symbolic link are rejected before receiving publication.

## Capture the current saved workspace

The list result includes the current `binding`. Save a private capture input with this shape, substituting the actual binding from that result:

```json
{
  "id": "8ebabe98-365b-4785-b8e0-78a790b00e50",
  "expectedBinding": {
    "schema": "stellar-forge.grpc-workspace-binding.v1",
    "directory": "/srv/grpc/original",
    "identity": {"device": "ACTUAL_DEVICE", "inode": "ACTUAL_INODE"},
    "current": {
      "revision": "ACTUAL_REVISION_SHA256",
      "generation": 1,
      "sha256": "ACTUAL_CURRENT_RECORD_SHA256"
    }
  },
  "maxBytes": 8589934592
}
```

The UUID above illustrates one retained operation. Generate and save a new UUID for each new capture; use the same saved input to continue that capture.

```sh
node "$GRPC_TRANSFER_CLI" capture \
  --connection /srv/grpc/operator/connection.json \
  --input /srv/grpc/transfer/capture-input.json \
  --output /srv/grpc/transfer/capture.json

node "$GRPC_TRANSFER_CLI" read \
  --connection /srv/grpc/operator/connection.json \
  --id CAPTURE_UUID --output /srv/grpc/transfer/capture-current.json

node "$GRPC_TRANSFER_CLI" files \
  --connection /srv/grpc/operator/connection.json \
  --id CAPTURE_UUID --limit 250
```

For later file pages, pass the first page's `snapshot` as `--snapshot` and its `nextOffset` as `--offset`. Keep filters unchanged while paging. The same rule applies to capture and receipt lists.

An offline capture can acquire the original closed workspace directly:

```sh
node "$GRPC_TRANSFER_CLI" capture --workspace /srv/grpc/original \
  --input /srv/grpc/transfer/capture-input.json \
  --output /srv/grpc/transfer/capture.json
```

Offline capture/read/list/files/receipt open and close the original native writer. The online commands use the operator that already owns it.

## Download or move the complete archive

```sh
node "$GRPC_TRANSFER_CLI" download \
  --connection /srv/grpc/operator/connection.json \
  --id CAPTURE_UUID --directory /srv/grpc/transfer/download \
  --manifest-sha256 NATIVE_MANIFEST_SHA256 \
  --output /srv/grpc/transfer/download-result.json
```

The downloader retains the first exact descriptor and a checkpointed prefix. Repeating the command verifies that prefix, resumes its original file and preserves a completed download. The archive is streamed to a private partial file and its full hash is checked before publication.

To inspect a local archive independently:

```sh
node "$GRPC_TRANSFER_CLI" archive-inspect \
  --archive /srv/grpc/transfer/download/grpc-workspace.tar.gz \
  --sha256 ARCHIVE_SHA256 --bytes ARCHIVE_BYTES \
  --manifest-sha256 NATIVE_MANIFEST_SHA256 \
  --output /srv/grpc/transfer/archive-inspection.json
```

`expectedManifestSha256` and `--manifest-sha256` mean the native manifest's canonical `sha256` field for these native commands. The archive separately retains and validates the manifest's exact UTF-8 bytes.

## Upload into another existing operator

Save a new upload UUID and the exact archive path/hash/length. The `upload` command hashes the complete source file, reads the server's durable offset, and sends chunks of at most 1 MiB.

```sh
node "$GRPC_TRANSFER_CLI" upload \
  --connection /srv/grpc/receiving-operator/connection.json \
  --id UPLOAD_UUID --archive /srv/grpc/transfer/download/grpc-workspace.tar.gz \
  --sha256 ARCHIVE_SHA256 --bytes ARCHIVE_BYTES \
  --output /srv/grpc/transfer/upload.json

node "$GRPC_TRANSFER_CLI" upload-status \
  --connection /srv/grpc/receiving-operator/connection.json --id UPLOAD_UUID

node "$GRPC_TRANSFER_CLI" inspect \
  --connection /srv/grpc/receiving-operator/connection.json \
  --archive-kind upload --archive-id UPLOAD_UUID \
  --output /srv/grpc/transfer/inspection.json
```

A repeated chunk must match the durable prefix. A bad replay returns its own error and preserves an already completed intake.

## Receive and open the complete workspace

Save a receiving input with `id`, `archive: {kind: "upload", id: UPLOAD_UUID}`, an absolute `directory`, and the three inspected values `expectedSha256`, `expectedBytes`, `expectedManifestSha256`.

```sh
node "$GRPC_TRANSFER_CLI" receive \
  --connection /srv/grpc/receiving-operator/connection.json \
  --input /srv/grpc/transfer/receive-input.json \
  --output /srv/grpc/transfer/received.json

node "$GRPC_TRANSFER_CLI" receipt \
  --connection /srv/grpc/receiving-operator/connection.json \
  --id RECEIVING_UUID --output /srv/grpc/transfer/receipt.json

node "$GRPC_TRANSFER_CLI" open \
  --connection /srv/grpc/receiving-operator/connection.json \
  --id RECEIVING_UUID --binding /srv/grpc/transfer/receipt.json \
  --output /srv/grpc/transfer/received-editor.json
```

The open result contains the new private editor link. The parent operator owns the received editor until `close --id RECEIVING_UUID` or parent shutdown. Read a fresh receipt before opening after other edits, because its `binding` reflects the current destination.

For receiving a local archive without an already running operator, use the same retained UUID and exact descriptors:

```sh
node "$GRPC_TRANSFER_CLI" archive-receive \
  --id RECEIVING_UUID --archive /srv/grpc/transfer/download/grpc-workspace.tar.gz \
  --directory /srv/grpc/received \
  --sha256 ARCHIVE_SHA256 --bytes ARCHIVE_BYTES \
  --manifest-sha256 NATIVE_MANIFEST_SHA256 \
  --output /srv/grpc/transfer/offline-received.json
```

This completes archive publication and original native validation, then closes that writer. Open the new workspace with the usual native editor or installed product command.

## Interruption and recovery

| State | Continue the existing operation |
| --- | --- |
| CAPTURING or FAILED before a committed manifest | Repeat the saved capture UUID and input. The original binding still determines the selected source. |
| PACKING or FAILED with a committed manifest | Repeat the capture. Its already selected manifest and source files remain the archive input. |
| Partial local download | Repeat its exact descriptor and receiving directory. The retained prefix is hashed before append. |
| Partial uploaded archive | Repeat the upload UUID/hash/length and exact source. The original accepted bytes determine the next offset. |
| Receiving stopped while extracting | Repeat the receiving UUID/archive/manifest/target. The same private stage and prefix are verified and continued. |
| Native validation failed after directory publication | Correct the receiving runtime/environment dependency and repeat the same operation. The published original receipt is reused. |
| Receiving already completed, destination edited later | Repeat returns the original receiving identity and validates the original native records while retaining the new current revision and later history. |
| Parent operator closes | Its active capture/receive settles, its original busy native action is awaited, and all received child editors close before the workspace lease is released. |

`cancel --id UUID` requests cancellation of that operator's active capture or receiving action and awaits its settled storage. SIGINT/SIGTERM cancels the CLI's owned requests and waits for owned client/native cleanup. A subsequent invocation uses the saved operation input.

## Format and limits

| Item | Bound |
| --- | --- |
| Default capture payload budget | 8 GiB |
| Maximum total payload | 64 GiB |
| Maximum regular file | 1 GiB |
| Maximum file entries | 50,000 |
| Maximum native manifest | 16 MiB |
| Maximum archive | 64 GiB + 256 MiB |
| Archive pack/receive stream buffer | 1 MiB |
| Upload chunk | 1 MiB |
| File inventory page | 250 entries |
| Received editors owned by one source operator | 4 |

The archive contains regular files under `workspace/` and `observations/`, plus one `grpc-workspace-transfer.json`. Workspace payloads relocate under the selected destination. Observations relocate under the original transfer observation directory. The receiver rejects duplicate members, ancestor/file conflicts, special files, unexpected members, invalid paths and any complete hash mismatch before publishing the new target.

## Typed client

```js
import { createGrpcTransferClient } from './transfer/client.mjs';

const client = createGrpcTransferClient({url: originalPrivateConnectionUrl});
try {
  const inventory = await client.request('list', {});
  const captured = await client.request('capture', savedCaptureInput);
  const downloaded = await client.downloadTo(savedDownloadInput, {signal});
  const uploaded = await client.uploadFile(savedUploadInput, {signal});
  const received = await client.request('receive', savedReceiveInput);
  // Save the receipt and select its current binding before opening.
} finally {
  await client.close();
}
```

The client tracks complete upload/download tasks and their file handles, including work outside an individual HTTP request. Its close operation cancels and awaits those tasks. All financial values, protobuf bytes, operation IDs and review decisions remain in the original native representation.

## Original customer continuation

The installed source includes `grpc/native-transfer/journey.mjs`. Run it after the same package's completed original operations receiving, with that original workspace and journal:

```sh
node /opt/starforge/source/stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/native-transfer/journey.mjs \
  --source-root /opt/starforge/source --source-commit SELECTED_GIT_COMMIT \
  --work /srv/grpc/migration-receiving --workspace /srv/grpc/original \
  --operations-run /srv/grpc/operations-receiving/journey.json \
  --chromium /opt/native-browser/chrome-headless-shell \
  --playwright-modules /opt/native-browser/node_modules
```

The continuation freezes the actual preceding completed operation and its original call-file identities. Eleven retained phases carry complete capture and file pages, installed CLI forwarding, interrupted file-prefix continuation, original upload replay, native receiving and later source editing, following archive receiving, merchant host/customer delivery, desktop/mobile browser receiving, and cold reopening of all selected histories. It records each request before its native effect and reuses original capture/export/receiving identities on continuation. The final result includes the exact source edition, archive/manifest hashes, original operation IDs, received current revision and owned-resource closure.
