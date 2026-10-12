# Receive an original Git source cache

The Git object receiver carries an exact published source snapshot to the
maintained distribution builder when a complete source archive or an existing
Git fetch is unavailable. It can reuse a completed source installation and
existing Git object databases. Those donors stay read only.

The receiving result is an ordinary private Git object cache. The current
`buildDistribution`, archive inspection, runtime profile review, installation,
managed adoption, and Applications lifecycle continue to own their original
steps.

## Inputs and original source identity

Capture these inputs from the selected repository revision:

- The immutable commit ID and original root tree ID.
- A complete recursive GitData tree response with `truncated: false`.
- The exact UTF-8 commit object body in `commitText`.
- The original regular file paths selected by the maintained builder.

The receiver checks the commit's Git object hash before writing anything. It
reconstructs every directory tree with Git's mode, byte ordering, names, and raw
object IDs and checks every resulting tree hash. The root must match the commit.

A GitData commit response expresses dates in UTC, while the original Git
commit also retains the author's and committer's timezone offsets. Preserve the
original raw object from an existing Git donor where possible. A reconstructed
candidate is usable only after its complete Git object ID matches the selected
commit. The original MPP operation at
`9ef475062876557d6baf14e0e5414d7afbf3bc7f` uses `-0400` for both offsets.

Metadata may be supplied as UTF-8 JSON or a single gzip-compressed JSON member. Both retain an 8 MiB decompressed limit; the immutable metadata digest is calculated from the same canonical JSON regardless of carrier compression.

The metadata file has this shape:

```json
{
  "schema": "stellar-forge.git-object-receiving.v1",
  "source": {
    "repository": "owner/repository",
    "commit": "40-character original commit ID",
    "tree": "40-character original root tree ID"
  },
  "commitText": "tree ...\nparent ...\nauthor ...\ncommitter ...\n\noriginal message",
  "tree": {
    "sha": "40-character original root tree ID",
    "truncated": false,
    "tree": [
      {
        "path": "path/to/file.mjs",
        "mode": "100644",
        "type": "blob",
        "sha": "40-character original blob ID",
        "size": 1234
      }
    ]
  },
  "requiredPaths": ["LICENSE", "path/to/file.mjs"]
}
```

The real tree contains every directory and file record. The receiver requires
all intermediate tree entries. The abbreviated record above illustrates the
field layout.

## Receive from existing source

Use the same Git executable required by the maintained builder, including
`--no-lazy-fetch` support, and an owned private cache directory.

```sh
python3 git-object-receiving.py \
  --metadata /private/captured-source.json \
  --commit ORIGINAL_COMMIT \
  --directory /private/source-receiving \
  --donor-repository /existing/complete-source.git \
  --donor-source /existing/runtime/package/source \
  --incoming /private/received-original-blobs
```

Each donor argument is repeatable. Existing Git donors are read with the
original Git batch metadata and content interfaces. The receiver suppresses
lazy fetching and never changes their refs, object databases, alternates, or
configuration. File donors are read only at original selected paths, and their
bytes are accepted by exact Git blob ID.

The receiver also accepts native provider captures placed in the incoming
directory as `OBJECT_ID.blob`, containing the complete raw original bytes, or `OBJECT_ID.blob.gz` with one gzip member. The gzip carrier has the same 2 MiB decompressed source-file limit and rejects concatenated members and trailing compressed content. Preserve binary content and final newlines exactly. Each file's decompressed byte length and Git blob hash must match its original tree entry before it enters the cache.

The JSON result identifies the original source, owned cache path, verified tree
count, requested source size, donor contributions, and remaining original
objects. Exit code 2 writes `missing-objects.json`, which supplies each missing
object ID, original byte length, and selected paths. Acquire that exact set
through the existing provider/source transfer and repeat the same command.

Exit code 0 reports `OBJECTS_AVAILABLE`. All requested object bytes and complete
original tree metadata are then available in `repository.git`.

## Continue the original builder and runtime

Invoke the maintained builder against the receiving repository:

```js
const release = await buildDistribution({
  repository: '/private/source-receiving/repository.git',
  ref: 'ORIGINAL_COMMIT',
  output: '/private/original-release-operation',
  offline: true,
  onProgress: value => process.stdout.write(JSON.stringify(value) + '\n'),
});
```

Use the maintained producer's current implementation for the selected source.
For cumulative sources above 32 MiB, commit
`320668ac24e8c9868620546c76950d489654a50e` aligns source acquisition and final
unpacked package checks with the original 64 MiB installer. Its
`MAX_SOURCE_BYTES` and `MAX_SOURCE_FILE_BYTES` are shared by
`build.mjs` and `git-source.mjs`. The receiver retains that 64 MiB aggregate
budget and 2 MiB individual source limit.

The builder resolves its original declared commands, exports, browser assets,
and static imports. If it requests an additional original source path outside
the initial selection, add it to the same cache using repeatable
`--additional-path path/from/the/original/tree.mjs` arguments. These additions
are retained for later receiving resumes. Every added path must belong to the
same original tree and fit the same source limits.

The resulting archive and its actual digest go through the original
`upgradeRuntime` or workspace upgrade action. The previous READY runtime
remains available for its existing customers. The new runtime retains its own
source, profile, installation, managed release, and Applications identities.

## Receiving continuity and sharing

The cache has an exclusive local receiving lease and retains its original
source/metadata digest in `source-receiving.json`. Repeating the same operation
reuses complete verified objects. New objects and materialized source files are
written to temporary files and linked into place only after their full bytes
are synced. Original objects remain immutable.

The tree metadata includes the full repository. The cache initially holds the
selected native source blobs; other repository blobs can be received later
against the same original tree. Its `shallow` record preserves the commit's
actual parent IDs while allowing this one selected snapshot to stand alone.

A second original consumer can read this completed cache as its own Git donor.
It can materialize its required source closure with `--materialize` in that
consumer's private directory. Existing files must match the same original
bytes; the receiver preserves the original executable modes for new source
members. A complete native source materialization does not require another
package build or dependency install.

Keep the cache and its metadata for the active receiving operations. Publish
the maintained source implementation and the original operation result through
the existing source owner, so following consumers reuse the same received
objects and package lineage.

## Completed original receiving operation

The original MPP source selection `9ef475062876557d6baf14e0e5414d7afbf3bc7f` was received and materialized on 2026-10-12. Git enumerated all 5,077 original file entries from the reconstructed commit and its 867 verified directory-tree objects. The selected native closure contained 2,698 regular files totaling 34,580,093 bytes, including the original merchant MCP operating command. The existing read-only Git donor supplied 2,667 exact blobs; the captured incoming carrier supplied the remaining 26 unique blobs. Receiving and materialization reported `OBJECTS_AVAILABLE` with zero missing objects.

The canonical metadata SHA-256 is `ff716cd6384798f415182f2c752c7a5287f96e6c94bfaa97d1e9116117485a40`. Its complete compressed carrier is 272,442 bytes, SHA-256 `0eea1c3f8f73488f31ad0a944db4fb7728447956653f9a0de90e9b6ebd7ca7c0`. The original root tree is `50d4476a168fbe24f506a4a2297a940a9029dc25`. The same receiver can resume this source in another owned directory from the retained metadata and captured blobs, with the existing donor available read only. A following source edition has its own immutable metadata and cache identity and may reuse these completed objects as a donor.
