# Retained file ranges for native owners

The maintained reader serves one verified snapshot across repeated byte ranges. Each native owner supplies its existing scope, selection key, private temporary directory and original file hash. A read ID stays bound to that scope and key. The shared downloader continues to use its original checkpoint and resume protocol.

## Select a retained file without loading it into one Buffer

Configure the maximum aggregate snapshot bytes explicitly for the owner's native artifact size. Existing users retain the 256,000,000-byte default and the four-snapshot limit.

~~~js
import { RetainedFileReads } from './retained-file-reads.mjs';

const reads = new RetainedFileReads({
  errorPrefix: 'BASEROW',
  maxSnapshotBytes: 553_648_128,
});

const first = await reads.read({
  scope: originalWorkspaceId,
  key: originalExportSelection,
  kind: 'source-packet',
  directory: originalPrivateWorkspaceDirectory,
  expectedSha256: originalExport.sha256,
  offset: 0,
  limit: 65536,
  loadFile: async () => ({
    path: originalExport.path,
    name: originalExport.name,
    type: 'application/zip',
    bytes: originalExport.bytes,
  }),
});
~~~

The host selects the original retained file after reading its existing export manifest. The file loader returns an absolute path, download name, optional content type, and exact declared byte count. A file read requires the original lowercase SHA-256. The selected regular file must belong to the current OS user and have private permissions, such as 0600 or 0400.

The file path and capacity are host configuration. HTTP or MCP clients choose an original export identifier through the native owner's existing API. They do not provide arbitrary file paths, temporary directories or higher capacity values.

The reader opens the source without following a final symbolic link, checks its file type, ownership, permissions and declared size, and copies it in 1 MiB pieces. It computes SHA-256 during that single pass and verifies the source's identity, size, timestamps, mode and owner afterward. An EOF check rejects growth beyond the declared size. A size, source-state or digest change discards the incomplete snapshot.

The temporary snapshot is private and unlinked immediately. Only its open descriptor remains during the copy and later ranges. Each subsequent range reads that descriptor directly; it does not reload, rehash or re-export the original file.

## Continue, resume and release

The first result uses the original response contract:

~~~js
{
  readId,
  file: { name, contentType, bytes, sha256 },
  offset,
  bytesRead,
  nextOffset,
  encoding: 'base64',
  data,
}
~~~

Continue with the returned read ID, the same scope/key and SHA-256, and the next byte offset. A later range can omit the loader because it uses the existing read ID. Every continuing read or nonzero offset requires the exact hash. The maximum individual range remains 196,608 bytes.

Reaching EOF releases the snapshot. An idle snapshot expires after two minutes. Release an unfinished read explicitly with:

~~~js
await reads.release(originalWorkspaceId, readId);
~~~

If the original read expires or a process restarts, the native owner reopens its retained source using the same export identity and expected hash. The downloader verifies its retained prefix and resumes from that byte offset. The original export stays create-only under its existing owner.

**closeScope(scope)** drains that scope's admitted acquisitions and range operations, then releases its snapshots. During that drain, new reads for the scope return the existing closing error family. The same scope may be explicitly reopened after the drain completes. **close()** drains all owners and permanently closes this reader.

## Existing Buffer owners

The original loader continues to work:

~~~js
const result = await reads.read({
  scope, key, kind, directory, expectedSha256,
  load: async () => ({ bytes: originalBuffer, name: originalName, type: contentType }),
});
~~~

Select exactly one loader for a new read. Small Buffer results use an independent memory snapshot; larger results use the same private descriptor. Existing constructor calls, range response fields, scope/key binding, idle expiry and explicit release remain compatible.

The aggregate capacity counts verified active snapshots. Original acquisition is serialized, so two initial requests cannot reserve the same remaining capacity concurrently. The source file loader is called once for an accepted acquisition. **status(scope).originalFileReads** continues to count original loader attempts, and the existing session metadata identifies memory or private descriptor storage.
