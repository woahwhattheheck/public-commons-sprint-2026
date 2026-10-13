# Receive complete source banks through small verified parts

The native cloud receiver exposed an actual size limit: a large managed Git blob response omitted part of its source-bank JSON. This transfer format keeps complete original sources while making every individual response small enough to receive through that connection.

## Receive and reconstruct

Fetch the published transfer manifest through the connected repository reader. Save its complete JSON body as `transfer.json`. For every entry in `banks[].parts[]`, fetch the exact `git_blob` from the same repository and save the returned complete JSON body as `parts/<git_blob>.json`. The materializer also accepts a saved ordinary structured tool response wrapping that JSON.

Run from an owned input directory:

~~~sh
python -B materialize_source_banks.py \
  --manifest transfer.json \
  --parts parts \
  --output /path/to/new-owned-source-receiving
~~~

The helper is `source_tools/materialize_source_banks.py` in the maintained application. It requires only Python's standard library.

The receiving output contains:

- `banks/<name>.json`: each byte-identical original source bank.
- `source/`: all original project-relative source files.
- `receiving.json`: the complete source inventory and original byte/hash identities.

Save these ordinary native files through the normal file interface for subsequent receivers. The output is a source directory; compose it into a separate copy of the retained complete application, preserving active local or later published changes. Keep the original scientific Workspace and actual project identity.

## Complete source identity

Each part records its original bank, zero-based index, offset, byte count and SHA256. The part's base64 content is one contiguous segment of that bank's gzip stream. The manifest records every exact Git blob plus the complete compressed and original JSON sizes and hashes.

The receiver verifies the contiguous part order and every part hash, reconstructs and verifies the full gzip stream, decompresses it, and verifies the full original JSON. Each source member is checked against its byte count and SHA256. Every declared Git identity must match the actual bytes; the receiver derives the Git identity for retained text contracts that omit it. All declared bank counts and totals, and the complete transfer inventory, must agree.

A file path must remain relative to the received source directory. Duplicate paths across banks are rejected. The receiving directory and its source/banks subdirectories must be ordinary directories. Existing identical files can be reused; a different existing file is preserved and the operation reports the exact conflict. Atomic publication uses a same-directory temporary file and a non-overwriting hard link.

All source members are validated before any source file is published. If receiving is interrupted, the same command verifies and reuses completed original files.

## Retained text-source contracts

The same materializer accepts the original `commons.source-bank/v1`, `commons.source-text-bank/v1` and `upstate.source-bank/v1` JSON. Every member has its original relative `path`, `bytes` and `sha256`. The first schema supports either canonical `content_base64` with its original `git_blob`, or a literal UTF-8 `content` string. The two text schemas require literal `content`. A member cannot contain both representations.

The two Commons contracts require original `file_count` and `source_bytes`. The retained Upstate text contract may omit those totals and member Git identities. The receiver computes the complete inventory from actual bytes and verifies it against the transfer manifest; every field declared by the original bank is still enforced. It records computed Git identities in `receiving.json`, while retaining the exact original bank JSON without adding or rewriting metadata.

For a directly pasted three-line Python receiver prepared by `prepareInlineReceiver`, run that script with one new owned output directory. It retains the exact maintained materializer plus manifest/parts beneath `input/`, then uses this same receiving implementation beneath `received/`. Both payload and bootstrap are encoded so Canvas whitespace transformations cannot alter executable indentation. See [SOURCE_BANK_TRANSFER.md](SOURCE_BANK_TRANSFER.md) for the sender API and complete size budget.

## Complete Sampling source and input carriers

The existing `--carrier` mode also reads the retained Sampling component and input envelopes. Save the complete original JSON, Markdown or provider result, then use the same qualified Python and separate receiving directory:

~~~sh
python -B source_tools/materialize_source_banks.py \
  --carrier /retained/complete-sampling-inputs.md \
  --expect-source-sha256 ORIGINAL_DECODED_BANK_SHA256 \
  --application /path/to/current/application \
  --workspace /path/to/current/workspace \
  --output /path/to/new-owned-sampling-inputs
~~~

`commons.complete-source-gzip.v1` declares its decoded `bytes`/`sha256` and compressed `gzip_bytes`/`gzip_sha256`. `commons.gzip-source-bank/v1` declares `payload_bytes`/`payload_sha256` and `compressed_bytes`/`compressed_sha256`. Both require `gzip+base64` encoding and their complete declared identity pairs. Every supplied identity alias is checked; conflicting declarations fail. The first carrier's original `commons.complete-source/v1` member list is supported alongside the existing source-bank formats. The full original bank, including retained shared preimages, repository, source prefix and merge identity, remains unchanged in `banks/original.json`. A declared `operation` is retained as the receiving operation when `operation_id` is absent.

This mode checks every member's original bytes, hash, path and any declared Git identity, then compiles Python source before publishing the complete staging directory. It never installs or executes the received source. A syntactically damaged old component still fails before staging; use the producer's complete corrected source edition and retain the original. Do not remove syntax checks or overwrite a working application to admit an older member. Original scientific inputs need no new model run to be received.

The matching `materialize_source_banks.bootstrap.txt` contains this exact receiver and accepts the same arguments. See [SOURCE_BANK_TRANSFER.md](SOURCE_BANK_TRANSFER.md) for protected roots, atomic staging, retry behavior and complete output layout.

## Windows and Linux receiving

All three input routes remain standard-library-only and independent of an installed application. On Windows, run the ordinary Python helper directly with the same current interpreter and original retained carrier:

~~~powershell
python -B .\source_tools\materialize_source_banks.py `
  --carrier "C:\owned\input\complete-source.json" `
  --expect-source-sha256 ORIGINAL_DECODED_BANK_SHA256 `
  --application "C:\owned\application" `
  --workspace "C:\owned\workspace" `
  --output "C:\owned\source-receiving"
~~~

The matching `.bootstrap.txt` remains the original POSIX-shell transport of this exact Python body; its embedded byte count and SHA-256 are regenerated together. It does not require or import the application's `model.common`, `model.windows_fs`, scientific dependencies or any received source. Native Windows users run the complete `.py` body, without WSL or a replacement interpreter. The existing Windows inline `--manifest` receiver continues to use its same source/parts layout and non-overwriting hard-link publication.

The complete `--carrier` path uses Windows no-reparse file handles and native `FILE_BASIC_INFO.ChangeTime` for both path and opened-file comparisons. It retains the original device, file, size, modification and change-time checks. These standalone primitives match the current received `model/windows_fs.py` semantics (source SHA-256 `5f968b8c7248a8dae36f4a13b1c9edb3c85bca14abc1b1dd5a81c3b4022aae36`); they are included in the helper because receiving precedes application installation.

A complete carrier is prepared in an owned sibling directory, fully read back, then published in one no-replacement directory move. Linux keeps `renameat2(RENAME_NOREPLACE)`. Windows uses same-volume `MoveFileExW` with write-through, without replacement or copy-across-volume flags. An existing destination remains intact, including a destination created by a concurrent receiver. Repeating the same completed command verifies and reuses its original output; it does not install into the protected application or Workspace.

Original Git modes remain exact in `source-bank.json` and `receiving.json`. Linux applies and verifies `0644`/`0755`. Windows keeps the received files writable and verifies their complete content; its filesystem does not represent the POSIX executable bit, so that bit remains declared metadata for later Linux installation. Do not describe Windows permissions as byte-for-byte POSIX mode preservation. File bodies are flushed on both systems. Linux also fsyncs directories; Windows validates ordinary directory handles and uses write-through publication, without claiming an equivalent directory power-loss durability guarantee.

### Whole selection before publication

Every input route rejects duplicate files, case aliases of both files and parent directories, file/directory collisions, Windows device names (including extension and superscript-digit spellings), invalid Windows filename characters, and trailing-dot/space aliases. This portable path rule applies before any bank is installed, including when the sender is Linux. `A/one.py` together with `a/two.py` is an alias, even though their full filenames differ.

The multipart route validates the complete union of all selected banks, their distinct bank names, the receiving record and all existing destinations before writing its first source or bank file. A later-bank collision therefore cannot leave an earlier bank partially published. Existing case-aliased directories, symlinks, junctions and other Windows reparse points are preserved as conflicts. Ordinary existing identical files retain the existing resumable behavior; different files are never overwritten.

### Continue the original Windows receiver

Use the existing Windows7256 / cumulative15227 source-receiving operation and its already-retained complete source packet. Keep current platform8011, later portable identity, operator lifecycle, source-inspection and Measurements postimages. This helper does not select an older bank as the current application and must not replace those advancing source files wholesale.

Receive that original packet into a separate owned source directory, open its retained bank and complete source tree, and repeat the same command to confirm original receiving is reusable. Continue the existing manifest receiver at its next normal source boundary. Report the first actual exception with the helper's exact source identity, original carrier identity and destination; no numerical case, source acquisition, controller or browser operation is restarted for this repair.

Current owner direction is `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4`. The producing peer still opens/runs and personally looks at the exact outgoing populated UI and all attachments, operates the important desktop/narrow controls and downloads, and cold-reopens the delivered application. Source receiving alone is not that product acceptance.

## Original Ecosystem Sciences receiving transfer

The 13 October 2026 S1 cloud receiving transfer contains four original banks:

| Bank | Files | Original source bytes |
| --- | ---: | ---: |
| Implementation, Outcomes, laboratory, evidence and saved-report review | 104 | 3,296,625 |
| Shared scientific Workspace/report/review runtime | 154 | 3,898,574 |
| Existing extension providers and their model dependencies | 166 | 3,337,104 |
| Existing browser assets and extension descriptors | 236 | 4,007,367 |
| Complete source transfer | 660 | 14,539,670 |

The manifest is Git blob `44998071fca54ed36850e0d4847580e8a2be3d19` in `woahwhattheheck/public-commons-sprint-2026`: 7,108 bytes, SHA256 `74fdc11d673198d48f9aaf92133650b061c50e64724cd40c6b209e03f1f2f513`. Its eighteen parts are at most 533,548 JSON bytes each. Every part was fetched back and reconstructed into the exact four original banks before native delivery.

This is a retained source snapshot: its basis is commit `5f7a049133c2629733e1465965154cf3defaf6cb`, with the complete PR3550 source-review additions in the family bank. Preserve the native receiver's subsequent scientific-table/PDF and scientific-content changes, the PR3560 evidence/server/installer additions, and later maintained receiving entrypoints when composing its current application.

The existing WQP case remains project `dc92b8b9-6eda-4362-b12d-3cf2ef6c9007`. Source transfer reuses its already completed original 88-result import. The original 178D project remains a separately retained project. Outcomes, laboratory, evidence and report receiving continue through their existing operation and actual returned IDs.

## Prepare a new transfer

Use [SOURCE_BANK_TRANSFER.md](SOURCE_BANK_TRANSFER.md) and the dependency-free `source_bank_transfer.cjs` encoder to prepare new complete banks in JavaScript or Node. It validates every original member and measures the full Git connector request, including nested JSON/base64 overhead, before splitting. Keep the existing receiver and publish a reachable transfer directory.

The maintained receiving branch also retains the 22-file current-successor package and 29-file source-tools closure under `source/receiving/20261013/`. Compose those separate source editions with the original 660-file package while preserving later working changes. The resulting retained source inventory contains 703 unique application files.

Carry the current application instruction copies with the handoff. Owner instruction `2026-10-13.1` requires opening and inspecting the exact outgoing client-facing product, operating its important populated controls, downloads and reopening, and checking screenshare and narrow/mobile layouts where relevant. View actual rendered output and repair clipping or unreadable presentation. Keep the plain industrial design and existing native source/computation owners.

The current owner-directed inspection rule includes every outgoing attachment. Producing workers open and actually view the exact PDF/report pages, HTML, maps and usable archive/project contents, and operate their recipient-facing controls and downloads. Capturing screenshots without viewing them is insufficient. Carry the current application AGENTS and instruction copies with a standalone handoff, perform focused repairs, and continue the existing delivery course.
