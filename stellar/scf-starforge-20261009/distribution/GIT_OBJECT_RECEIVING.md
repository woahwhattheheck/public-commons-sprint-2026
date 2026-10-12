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

## Receive directly from a retained release

A completed merchant release can supply original blobs without another package
extraction. Pass its retained SHA-256 and absolute file path as one repeatable
`--donor-archive` pair alongside the current Git or source donors:

```sh
python3 git-object-receiving.py \
  --metadata /private/captured-source.json \
  --commit ORIGINAL_COMMIT \
  --directory /private/source-receiving \
  --donor-repository /existing/complete-source.git \
  --donor-archive ARCHIVE_SHA256 /existing/merchant-release.tgz \
  --materialize /private/original-consumer/source
```

The receiver checks the entire original archive digest before receiving any
member. It opens one regular file, streams its gzip/tar contents and matches
member bytes to missing objects in the selected Git tree. The archive can come
from an earlier or later release: only exact matching Git blob IDs and original
byte lengths enter the current immutable cache. Package prefixes and member
names do not affect matching. Archive paths and link targets are never
extracted or executed.

Compressed archives retain a 64 MiB limit. The expanded stream, including tar
headers, padding and skipped members, has a 256 MiB limit. This framing allowance
is separate from the 128 MiB aggregate selected-source limit and the original
2 MiB limit for an individual accepted source file. Metadata remains bounded to
8 MiB. The receiver consumes gzip checksums and verifies that the opened archive
stayed unchanged during the read.

The existing `donors` result adds an `original-release-archive` entry with its
archive path, checked SHA-256, compressed and expanded sizes, regular member
count and contributed object count. All Git/source/flat-blob donors, missing
object requests, cache resumption and source materialization keep their
existing contracts. An interrupted read can leave only independently verified
source blobs; resume the same original cache and archive.

## Receive a complete source snapshot in ZIP parts

When the available file service cannot carry the whole original source archive,
the same receiver accepts a complete manifested transfer:

```sh
python3 /existing/toolkit/git-object-receiving.py \
  --source-transfer /private/huwise-source/Huwise_Source_d1868_TRANSFER.json \
  --commit d1868cba6fd5f3b57e0445a094da8a3d4002b00e \
  --directory /private/huwise-source-receiving
```

Keep the original index beside its downloaded ZIP files, using each exact
relative filename and byte length recorded in the index. The download stage
owns HTTP continuation and destination delivery. The receiver reads those local
files and puts their original source objects directly into its existing
`repository.git` cache. ZIP contents never become extraction paths.

The captured Huwise source transfer contains 18 ZIP parts carrying the original
4,940 files and 65,179,698 source bytes at commit
`d1868cba6fd5f3b57e0445a094da8a3d4002b00e`. Its original root tree is
`9e4112bc3da8a93aaa1eab045330ff96ae23c7d6`. The ZIPs total 22,369,451 bytes.
This mode receives all original regular source files, so the maintained builder
can resolve the selected product's dependency closure offline. A Huwise release
then uses the existing source selection:

```sh
node /existing/toolkit/build.mjs \
  --repo /private/huwise-source-receiving/repository.git \
  --ref d1868cba6fd5f3b57e0445a094da8a3d4002b00e \
  --selection huwise \
  --offline \
  --out /private/original-huwise-release
```

The builder retains its own original output directory and `--resume`
contract. The received cache retains the selected historical revision, including
that revision's own tools. A newer receiving tool runs from its existing toolkit
location; receiving source does not replace historical files with newer tool
bytes. Use `--materialize /private/original-source` only when the original
consumer needs a complete source directory as well as the object cache.

### Transfer index and per-part contract

The immutable UTF-8 JSON index uses schema
`stellar-forge.git-source-transfer.v1`. It contains:

| Field | Meaning |
| --- | --- |
| `source.repository` | Original GitHub owner/repository. |
| `source.commit`, `source.tree` | Original commit and full recursive root tree. |
| `source.fileCount`, `source.sourceBytes` | Complete original regular-file count and byte total. |
| `parts` | Ordered, contiguous records numbered from 1. |
| `parts[].path`, `archiveBytes` | Exact local ZIP filename and compressed byte length. |
| `carrierCommit`, `carrierTree` | Git source-carrier identities, separate from the product commit. |
| `manifestGitBlob`, `manifestSha256`, `manifestBytes` | Exact manifest bytes under Git and SHA-256, with byte length. |
| `kind`, `sourceFiles`, `sourceBytes` | Authority or source-file part, and its original source totals. |
| `archiveSha256` | Optional previously captured ZIP digest; checked when present. |
| `sourceUrl`, `notionReference` | Optional original delivery references used by the download stage. |

Every ZIP has GitHub's one enclosing directory. At its root,
`SOURCE-PART.json` uses schema `stellar-forge.git-source-part.v1` and
repeats the original `source`, part number, total part count and kind.
Each original source member declares `path`, `mode`, `gitBlob`
and `bytes`. Paths and executable modes are the original Git values.

Part 1 is the sole `git-authority` part. It carries the exact
`SOURCE-COMMIT.json` GitData commit response and
`SOURCE-TREE.json` complete recursive tree response. Its
`authorities` array declares each filename, kind, byte length and SHA-256.
The authority part has an empty `members` array and zero source-file totals.
Every later `source-files` part carries its own unique original paths.
The union must equal the complete original regular-file tree.

The receiver derives the exact original commit body from a captured
`commitText` or the GitHub verification payload and signature. In the signed
GitHub form, a final signature newline can create an additional continuation
line in the commit object; its bytes must be preserved. The resulting original
commit ID must match before cache creation. A GitData response without exact
raw bytes or a reconstructable signed payload needs its original raw
`commitText`; normalized date fields alone do not preserve timezone offsets.

### Receiving, interruption and reuse

Before creating the cache, the receiver opens each original regular ZIP,
checks its recorded size, computes its full SHA-256, checks its pinned manifest
and reconstructs its carrier root tree. It also reconstructs the original
signed commit and every original directory tree. The complete partition must
preserve every original path, mode, blob ID and byte length.

During import, every regular source member is read through its ZIP checksum
and checked against its original Git blob ID. Existing exact objects are
reused. Source members are written through the same synced, immutable Git
object writer used by the other receiving modes. The original limits remain
2 MiB per source file and 128 MiB across the complete source.

`source-receiving.json` retains a `sourceTransfer` record with the exact
index file SHA-256 and each completed part's archive digest, size, carrier
identities, source totals and first receiving time. Completion is saved after
each part. Repeating the same original invocation reuses verified source
objects and continues that cache. Keep the original index and ZIP bytes while
the receiving operation is active; the source and transfer identity remain
fixed on resume.

The normal `OBJECTS_AVAILABLE` result and `repository.git` output feed
the existing builder. Source transfer changes neither the selected product
commit nor the original release, runtime installation, merchant workspace,
customer receiving or payment identities.

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

Use the maintained object receiver, builder and runtime installer with compatible
source and package limits. Keep their toolkit location separate when receiving a
historical source edition. The current `MAX_SOURCE_BYTES` shared by `build.mjs` and
`git-source.mjs` permits 128 MiB of aggregate source; this receiver uses the same
budget. `MAX_SOURCE_FILE_BYTES` retains the 2 MiB individual source limit. The
builder also checks that the complete unpacked package, including its generated
manifest and package metadata, fits the installer's 128 MiB limit. Compressed
archives remain bounded to 64 MiB, and each installed member remains bounded to
4 MiB. A toolkit retaining the earlier 64 MiB unpacked limit cannot receive a
larger cumulative package; use the current maintained installer for that package.
The selected source commit, cache identity and previous READY runtime remain
unchanged when receiving an earlier original archive.

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
bytes and Git executable class. New source members receive their original
0644 or 0755 mode explicitly before being synced and linked, independently of
the caller's umask. A complete native source materialization does not require another
package build or dependency install.

Keep the cache and its metadata for the active receiving operations. Publish
the maintained source implementation and the original operation result through
the existing source owner, so following consumers reuse the same received
objects and package lineage.

## Completed original receiving operation

The original MPP source selection `9ef475062876557d6baf14e0e5414d7afbf3bc7f` was received and materialized on 2026-10-12. Git enumerated all 5,077 original file entries from the reconstructed commit and its 867 verified directory-tree objects. The selected native closure contained 2,698 regular files totaling 34,580,093 bytes, including the original merchant MCP operating command. The existing read-only Git donor supplied 2,667 exact blobs; the captured incoming carrier supplied the remaining 26 unique blobs. Receiving and materialization reported `OBJECTS_AVAILABLE` with zero missing objects.

The canonical metadata SHA-256 is `ff716cd6384798f415182f2c752c7a5287f96e6c94bfaa97d1e9116117485a40`. Its complete compressed carrier is 272,442 bytes, SHA-256 `0eea1c3f8f73488f31ad0a944db4fb7728447956653f9a0de90e9b6ebd7ca7c0`. The original root tree is `50d4476a168fbe24f506a4a2297a940a9029dc25`. The same receiver can resume this source in another owned directory from the retained metadata and captured blobs, with the existing donor available read only. A following source edition has its own immutable metadata and cache identity and may reuse these completed objects as a donor.
