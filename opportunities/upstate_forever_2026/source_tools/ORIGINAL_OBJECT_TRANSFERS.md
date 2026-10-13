# Exact original source transfers

Version 1.0.0. Python 3.10 or newer. Standard library only. Receiving requires Linux or another POSIX host providing directory-relative no-follow access and `flock`.

## Purpose

Recover an exact selection of original application or geographic-input files from retained archives and directories. Send each unique byte object once while restoring every named companion to an independently editable file. The same workflow handles a small missing-input request and a complete metadata-defined source edition.

The workflow is **request → locate retained originals → export one complete packet → receive at an owned destination**. It uses the existing `commons.original-source-missing-objects-request/v1` and `commons.original-source-objects/v1` formats. It does not submit a scientific model or take ownership of a Workspace queue. Retain the original application planner, native driver, project and run IDs.

## Select the original files

Use an existing missing-object request unchanged whenever one has already been issued. A request contains `schema`, `operation`, `objects_count`, `unique_bytes`, and `objects`. Each object has its exact `sha256`, `bytes`, and nonempty `paths` array. Keep `source_manifest_sha256` when supplied by the producer.

For an original portable archive, select complete logical prefixes from its actual `ARCHIVE.json`:

```sh
python -B source_tools/original_object_transfer.py request-archive \
  --archive retained-study.zip \
  --prefix application/model/ --prefix application/operator/ \
  --prefix application/source_tools/ --prefix application/integration/ \
  --strip-prefix application/ --output requested-source.json
```

`--prefix` means a literal starts-with match; include the terminal `/` for a directory. Supply `--archive-sha256` when the source archive has a known delivery identity. The generated request preserves all matching manifest entries and reports its physical SHA-256. It is a selection, not an assertion that those folders alone form the complete application.

For the existing metadata-only source inventory, use:

```sh
python -B source_tools/original_object_transfer.py request-inventory \
  --inventory original-edition.inventory.json \
  --inventory-sha256 EXPECTED_INVENTORY_SHA256 \
  --output requested-source.json
```

The inventory schema is `commons.source-inventory/v1`, with `file_count`, total logical `source_bytes`, and `files: [{path, bytes, sha256}]`. The converter preserves source commit, edition, repository, and application-prefix context. It groups only identical byte identities; different source editions at the same path must be handled as separate requests and destinations. Original path names remain relative to the original application root. Counts, sizes, identities and every logical destination are checked before a request is issued.

## Locate and export the complete original selection

```sh
python -B source_tools/original_object_transfer.py plan \
  --request requested-source.json --request-sha256 EXPECTED_REQUEST_SHA256 \
  --source retained-study.zip --source another-original-tree \
  --index work/source-index.sqlite --report work/source-plan.json

python -B source_tools/original_object_transfer.py export \
  --request requested-source.json --request-sha256 EXPECTED_REQUEST_SHA256 \
  --source retained-study.zip --source another-original-tree \
  --index work/source-index.sqlite --report work/export.json \
  --gzip --output exact-original-objects.json.gz
```

The index scans explicitly supplied ZIPs and directory trees. It does not recursively interpret nested archives, source-code JSON banks, or remote URLs. To use source-bank bodies, first receive their exact original files with the bank's maintained receiver into a separate owned directory, then pass that directory as another `--source`.

The scan considers member sizes first, hashes candidate bodies and records completed member identities in SQLite. Source identity includes device, inode, size, modification time and change time. A repeat scan reuses completed entries; export independently checks every chosen body again. ZIP members are streamed without whole-archive extraction, and held readers avoid repeated central-directory loading. ZIP64 is handled by Python's ZIP reader.

The plan reports all unresolved original objects, every requested path, and the retained location of each exact match. Exit `2` means a complete missing-object inventory was written. Locate those original editions, add their retained source directory or ZIP, then repeat the same operation. The exporter creates a packet only for the complete requested selection. It preserves binary bodies byte-for-byte, including bytes that themselves happen to be compressed. An existing packet destination is never replaced.

## Receive, reopen and edit

```sh
python -B source_tools/original_object_transfer.py receive \
  --request requested-source.json --request-sha256 EXPECTED_REQUEST_SHA256 \
  --packet exact-original-objects.json.gz --packet-sha256 EXPECTED_PACKET_SHA256 \
  --destination received/original-source --report work/received.json
```

Use the exact hexadecimal hashes produced and shared with the original request and packet; placeholders above are deliberately not valid hashes. Reading plain JSON packets works with the same command. Compression is detected from the file's actual bytes, not its filename.

The receiver checks the physical packet hash, decodes and verifies all object bodies, binds the packet to the exact original request and source manifest when supplied, and preflights all logical paths before publishing new original files. A bad later object cannot cause earlier unvalidated files to appear in the destination. All identical existing paths are reused. An existing differing file, symlink or nonregular file is preserved and reported as a conflict.

For a destination review, create the owned directory and add `--dry-run`. It verifies and stages packet bytes but does not publish logical source files. The temporary decoded cache is removed after a successful dry run. Consequently this is read-only with respect to the source destination, not a promise of zero scratch-disk use.

After interruption, rerun the same command with the same request, packet and destination. The receiver uses one deterministic sibling decode stage for that destination/packet pair, checks existing byte prefixes and continues incomplete files. Each completed path is published with a no-replace operation and directory synchronization. A lost response does not require another destination or copy of the entire application. Receiving is file-atomic, not a transaction that rolls back already completed files. A final read verifies every selected logical path.

Two paths containing equal bytes receive independent file inodes. Editing one companion does not edit the other. Keep deliberate edits in place: the next receive reports the affected paths and leaves them untouched. Receive another edition to a separately named destination, or reconcile changes through the original application's maintained source-refresh workflow.

The lock covers only the owned receiving directory. No scientific task, shared application, native run scheduler, server process, or source archive is executed or edited. Keep sufficient space for the unique decoded objects plus the complete logical received selection. Retained stages after a failure are named `.source-objects-<identity>` and contain an ownership record; preserve them for a restart, rather than deleting unknown directories.

## Application integration

`integration/component_fragments/original-object-transfer.json` extends the original `core` component with this script and guide, so the existing static component composer can include them in complete source receiving. This is an additive tool, not a replacement operator entry point. Original native application backups still use their maintained `model/cli.py restore` and original `operator/server.py`.

Read the received application's `AGENTS.md` and `CURRENT_OWNER_DIRECTION.md` before continuing work. During the October 13 sprint the retained owner direction is `2026-10-13.3`, ending at 14:00 UTC; newer actual owner direction takes precedence. An older source packet is never a reason to replace a newer owner brief. Retain the complete original brief in any downstream handoff, and keep prospect-specific communication in the authorized internal surface.

## Executed original-archive journey

The actual retained archive was 157,219,641 bytes, SHA-256 `0134ee8a7750ce39c11024cc149f7f178bc51ee30a69e0a6c9edd4015caf7a4e`. Its selected source recovery comprised 1,857 unique objects, 46,338,043 original unique bytes and 1,861 logical paths. The gzip packet was 24,362,258 bytes, SHA-256 `aaa7bb5f36ea435f8af7da7398486e88ced60a44745d6a9791dcd145baf94c8f`.

On the Linux host, export took 3.74 seconds and receive 1.89 seconds, with measured peak process memory below 109,000 KiB. An actual OS SIGKILL after 368 published paths was followed by a restart that reused 368 and wrote the remaining 1,493. A cold repeat reused all 1,861 paths and wrote none. Equal-content companion files had independent inodes; editing one survived a refused receive and left the other unchanged. These measurements concern original-source transfer, not a regional watershed model result or a general performance guarantee.
