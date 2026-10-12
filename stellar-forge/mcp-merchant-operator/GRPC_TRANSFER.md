# Merchant agent: complete gRPC workspace migration

The original merchant operator exposes thirteen transfer tools over its configured gRPC workspaces. They preserve the native capture, intake and receiving operation IDs and reuse the existing merchant export/file reader.

## Host configuration

Extend the existing private gRPC workspace configuration. Each workspace chooses its original private console URL file or environment reference. The host declares destination aliases and optional complete archive files.

```json
{
  "schema": "stellar-forge.grpc-workspace-connection.v1",
  "workspaces": {
    "merchant": {
      "label": "Original merchant",
      "consoleUrlFile": "/srv/grpc/operator/connection.json",
      "destinations": {
        "receiving": {
          "label": "Received merchant workspace",
          "directory": "/srv/grpc/received"
        }
      },
      "files": {
        "migration": {
          "label": "Reviewed complete workspace archive",
          "kind": "workspace-transfer",
          "path": "/srv/grpc/transfer/grpc-workspace.tar.gz",
          "sha256": "ACTUAL_ARCHIVE_SHA256"
        }
      }
    }
  }
}
```

The configured destination's real private parent must exist before receiving. It must be disjoint from the source workspace. Agent requests select these host aliases; the host retains their actual filesystem paths. Existing capture, reflection, revision and request handles continue in the same configuration.

## Complete workflow

| Step | Tool and retained input |
| --- | --- |
| Select source | `merchant_grpc_transfer_list` with `workspace`; save its current native `binding`. |
| Capture | `merchant_grpc_transfer_capture` with `workspace`, saved `operationId`, `expectedBinding` and optional `maxBytes`. |
| Recover/read | `merchant_grpc_transfer_read` with the same operation ID. `section: "manifest"` returns the complete source manifest through the original bounded result/file route. |
| Review files | `merchant_grpc_transfer_files` with the same capture ID; continue returned snapshot/offset and unchanged filters. |
| Move into a host | `merchant_grpc_transfer_upload` with a new saved upload ID, archive bytes/hash and exactly one declared `file` or previously retained `exportId`. |
| Resume upload | `merchant_grpc_transfer_upload_status`; repeat the original upload input to continue its durable prefix. |
| Inspect | `merchant_grpc_transfer_inspect` with `archive: {kind: "capture"|"upload", id}`. |
| Receive | `merchant_grpc_transfer_receive` with new saved receiving ID, inspected archive selection, destination alias, archive bytes/hash and native manifest hash. |
| Recover receipt | `merchant_grpc_transfer_receipt` with the original receiving ID; this also reports the destination's current native binding. |
| Open editor | `merchant_grpc_transfer_open` with the receipt's current binding and receiving ID. |
| Close editor | `merchant_grpc_transfer_close` with that same receiving ID. |
| Cancel active work | `merchant_grpc_transfer_cancel` with the active capture or receiving ID; it reaches the original owner even while that operation occupies the operator. |
| Export to a customer | `merchant_grpc_transfer_export` with the capture ID and native manifest hash. Save the returned immutable export ID and outer export-manifest hash. |

All tool names, request objects and limits are declared in `catalog/grpc-transfer.mjs`. The original source handles and native writer remain the owner of each operation. A request repeated with another archive, binding or destination conflicts with its existing operation input.

## Full customer export

A workspace-transfer export contains these original files:

1. `grpc-workspace-transfer.json`: exact native capture manifest bytes.
2. `grpc-workspace.tar.gz`: complete original workspace archive.

The existing merchant export manifest binds their paths, exact lengths and SHA-256 values. Its `kind` is `workspace-transfer`; its original operation metadata identifies the native capture UUID and canonical manifest hash. Large manifest results use the existing retained result/file transport rather than a truncated tool message.

Use `merchant_grpc_export_manifest`, `merchant_grpc_export_file` and `merchant_grpc_export_file_release` through the original download helper. The whole archive uses an owned read-only descriptor and bounded-memory full hashing. Its per-file request timeout is one hour to cover the first complete hash on a slow disk; other files retain the existing two-minute timeout. The same selection applies when reopening an expired original read ID. Cancellation continues to reach the current file request, and release uses its original short independent cleanup deadline.

## Receive through the existing customer downloader

```js
import { downloadGrpcWorkspaceTransfer } from './grpc-transfer-download.mjs';

const received = await downloadGrpcWorkspaceTransfer({
  client: originalMerchantFileClient,
  exportId: savedExportId,
  directory: '/srv/grpc/customer-download',
  destination: '/srv/grpc/received',
  operationId: savedReceivingUuid,
  expectedManifestSha256: savedOuterExportManifestSha256,
  expectedTransferManifestSha256: savedNativeManifestSha256,
  expectedArchiveSha256: savedArchiveSha256,
  expectedArchiveBytes: savedArchiveBytes,
  signal,
  receivingEnvironment: process.env
});
```

The download directory and native destination are separate selections. The helper first resumes the original retained-file transport, verifies the outer manifest and both full files, then receives and reopens the archive through the installed original native engine. It returns the original receipt, complete native counts and the new location binding.

After a partial download, repeat the saved export ID and outer/inner hashes. After a completed receiving followed by native edits, repeat the same receiving operation to preserve those edits. A different project or destination uses a distinct operation selection.

## Source and lifecycle

The merchant provider's concurrency metadata allows the original transfer cancellation tool to reach its owner. The source operator serializes capture, inspection, upload, receiving and editor launch through its existing native busy action. Parent shutdown waits for that action and closes its received editors before releasing the writer lease.

Source-owned modules are `grpc-transfer.mjs`, `grpc-transfer-download.mjs`, the original gRPC workspace/export/download modules and the native `grpc/transfer/` directory. The distribution contribution `grpc-workspace-transfer` includes the Python archive helper, typed client and operating guides. The installed product's source selection carries this same contribution.
