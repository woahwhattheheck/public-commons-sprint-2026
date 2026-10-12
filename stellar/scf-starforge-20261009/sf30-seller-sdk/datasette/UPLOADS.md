# Receiving an original Datasette archive

The original Datasette retained-file authority accepts a complete source-edition archive or whole-workspace archive in bounded byte ranges. It retains the caller's upload UUID, original filename, byte count and SHA-256 before the first body byte. The completed file is then an input to the existing `source.receive` or `workspace.receive` operation.

This is a file intake step. Source review, edition creation, the publisher, dataset versions, customer Analysis and the original archive receivers continue through their existing operations.

## Original owner and methods

`retainedDatasetteFiles({directory, workspaceId})` preserves its existing `inspect`, `list`, `read` and `relativeName` methods. It also supplies:

```js
await files.uploadStatus({ uploadId });
await files.receiveUpload(
  { uploadId, name, bytes, sha256, offset, length },
  originalRawByteStream,
  { signal: originalOperationAbortController.signal }
);
await files.close();
```

The caller must be the current Datasette workspace owner. Put each `receiveUpload` call inside that workspace's existing active-operation gate, using the original upload UUID as its operation identity. Its controller owns cancellation. Abort and drain the current stream, close this file authority, and then release the original workspace lease. The helper opens no lease and launches no background process.

The helper serializes its file-intake work and status reads. That queue does not replace the workspace's gate against concurrent capture, edition, archive or publisher writes. Keep the original source and publisher dispatch records and their existing request-recovery semantics.

## Declared input

| Field | Required value |
| --- | --- |
| `uploadId` | One caller-retained lowercase UUID. Keep it across interruptions and exact repeated ranges. |
| `name` | The original file basename, at most 240 UTF-8 bytes, without path separators or control characters. |
| `bytes` | Complete original file size as canonical decimal text. The limit is 2 GiB. |
| `sha256` | Lowercase SHA-256 of all original file bytes. |
| `offset` | Start of this raw range as canonical decimal text. |
| `length` | Exact raw request body length as canonical decimal text, at most 8 MiB. |

Use strings such as `"59792"` and `"0"`; numeric JSON values are rejected. The byte range must fit the complete declared size. At most 32,768 nonempty range checkpoints are retained. Each checkpoint records its exact offset, length and chunk SHA-256, so smaller ranges can be repeated after a response is lost without rewriting them.

The same upload UUID cannot be rebound to another name, total size or SHA-256. A repeated range must have the same offset, length and byte hash as one of its recorded chunks. An arbitrary overlap or a differently partitioned earlier prefix is rejected.

The server wrapper keeps its original authentication, Origin, loopback/workspace-identity checks and request admission. Forward the raw byte stream to this method; do not buffer or embed a large archive in the normal 1 MiB operation envelope. Bound the declared raw request by the helper's chunk limit. If the method rejects before consuming a request body, preserve its complete JSON error while safely ending or draining that request through the existing server transport.

## State and interruption recovery

`uploadStatus` is a read. It verifies the durable prefix and returns the original declaration, received byte count, prefix SHA-256, chunk count and maximum chunk size. The immutable source filename and total SHA-256 remain visible on every returned state.

| State | Meaning and continuation |
| --- | --- |
| `RECEIVING` | The saved `receivedBytes` prefix is durable and hash verified. Continue at that exact offset. |
| `FINALIZABLE` | All declared bytes and the full SHA agree, but the completed publication/receipt is unfinished. An empty range at the total byte offset finishes that same upload. |
| `COMPLETE` | The original private file and final hash are verified. The result supplies `archiveFile` and its native `retainedFile` descriptor. |
| `REJECTED` | All received bytes are retained but their full SHA differs from the original declaration. The error includes the actual hash. No archive path is released for receiving. |

After an interrupted raw request, read the original status before continuing. A recorded `uncheckpointedBytes` suffix is not part of the durable prefix. On the next admitted continuation, the helper verifies the saved prefix before truncating only its own unfinished partial suffix and writing the requested range.

A fresh process rehashes the saved prefix with a 256 KiB buffer. Within one process, a small incremental-hash cache is reused only when the private inode, length, times, mode and link count still match. Range bodies and complete files are never loaded into memory as a whole.

A completed publication whose response was lost stays the same upload. An exact earlier chunk returns the verified current result with `replayed: true`; an empty range at the complete byte offset also returns that result. The helper never changes source or edition selections during either path.

If the original upload ID has no saved declaration, `DATASETTE_UPLOAD_NOT_FOUND` is returned with HTTP status 404. Re-read the current native workspace identity and original request before deciding whether that same request can start. Missing declarations beside existing payload files, different declarations, changed prefixes, unexpected links and unrelated destinations are rejected explicitly.

## Retained files and publication

The original workspace owns:

```text
imports/uploads/<uploadId>/upload.json
imports/uploads/<uploadId>/payload.part
imports/uploads/<uploadId>/file/<original-name>
```

The partial path exists only while receiving or completing publication. The metadata preserves every committed chunk and its source declaration. Final publication creates the destination without replacing any other file, syncs it, removes only the same staged inode and verifies the completed file through the original `files.inspect` method before saving `COMPLETE`.

An interrupted publication that left both names is resumed only when both names are the same exact inode and the saved complete byte count/SHA agree. The normal file authority continues to require one private regular-file link after publication.

Both the completed original file and its upload history are visible through the existing file inventory and complete workspace export. The current original exclusion of `dataset/control.json` and `dataset/control.sock` is preserved; dataset versions and snapshots remain retained.

## Applying a completed archive

Use the returned values directly:

```js
const upload = await files.uploadStatus({ uploadId });
if (upload.state !== 'COMPLETE') {
  throw new Error('Finish the original upload before receiving its archive.');
}

await workspace.dispatch('source.receive', {
  archiveFile: upload.archiveFile,
  sha256: upload.sha256,
  id: retainedEditionReceivingId
});
```

For a complete workspace, pass the same `archiveFile` and `sha256` to the existing `workspace.receive` with an explicitly selected receiving directory. That original receiver owns archive validation, source/edition/publisher/customer history, no-overwrite checks and cold reopen.

The browser should retain the original upload ID, declaration and last confirmed range in its existing pending-operation record. Display progress, the original filename and the actionable state. Keep full hashes and checkpoint history available in details. A successful file intake becomes reviewable source input; it does not itself approve an edition or publish a merchant dataset.
