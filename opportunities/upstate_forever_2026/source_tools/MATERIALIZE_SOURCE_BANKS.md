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
