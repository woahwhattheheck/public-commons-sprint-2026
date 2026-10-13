# XZ source banks

The existing Source Bank toolkit receives XZ-compressed UTF-8 JSON through the same API and CLI as ZIP and gzip. Decoded JSON continues through the existing envelope and source-bank validator, preserving original file bytes, declared identities, complete inventory and portable-path checks.

## Receive a source archive

From the application root, with the original archive at its actual path:

```sh
node source_tools/source_bank_cli.mjs inspect original-source.json.xz
node source_tools/source_bank_cli.mjs extract original-source.json.xz received-source
```

The destination must be new. Supply the original archive's published SHA-256 using the existing `--sha256` option. If the retained input is plain base64, use `--base64`; the expected hash then refers to the decoded XZ bytes. The existing extractor retains the full original input and inventory in `.source-bank-recovery` and writes source without executing it.

```js
import {createSourceBankToolkit} from "./source_bank.mjs";
const recovery = createSourceBankToolkit();
const received = recovery.decode(originalXzBytes, {expectedSha256: originalArchiveSha256});
const inventory = recovery.inventory(received);
```

The resulting metadata includes `payloadSha256`, `xzBytes`, and `xz` with the stream check type and complete block input/output positions. Original input identity and every source leaf remain in the normal inventory.

## Supported XZ input

One XZ stream with zero or more plain LZMA2 blocks is supported. Block compressed and expanded sizes may be omitted or explicitly declared. Stream padding must be a multiple of four zero bytes. Stream checks None, CRC32, CRC64 and SHA-256 are supported; CRC64 uses JavaScript BigInt.

The decoder verifies all header, footer, index and block-header CRC32 values; matching stream flags; canonical variable integers; index and block sizes; exact LZMA2 chunk inventory; zero padding; and each selected block data check. Other filter chains and concatenated streams produce explicit unsupported-input errors. Use the existing native compression tools for those formats.

The container implementation follows the [XZ specification](https://tukaani.org/xz/xz-file-format.txt). It is separate from the upstream XZ container and supplies its own complete metadata and data-check validation.

## Limits and memory

XZ shares the original toolkit's `maxInputBytes`, `maxOutputBytes` and `maxMembers` (block count). The integrated dictionary cap is 64 MiB. The lower-level `createXzSourceDecoder(codec, options)` additionally accepts `maxDictionaryBytes` and `maxBlocks`. The supplied codec is the existing `createArchiveCodec()` result.

Total declared output is checked before allocation. Dictionary size and the full compressed chunk inventory are checked before each block is decoded, including exact termination and expanded length. Range-coded reads are bounded to the declared compressed chunk; the zero-leading five-byte range initializer, exact compressed consumption, decoded length and unsigned terminal range state are checked before accepting the block. A malformed declaration cannot silently request a larger dictionary or expanded chunk cohort.

This is an in-memory receiver: input, complete output, one decoded block and its dictionary can coexist. The JSON parser, decoded strings and source-bank files use additional memory. Choose limits with room for those copies. Large rasters and multi-gigabyte scientific datasets continue through the native streaming receiving paths.

## Upstream source and license

`xz_lzma2.mjs` statically scopes five LZMA/LZMA2 decoder modules from [xz-compat 1.2.11](https://github.com/kmalakoff/xz-compat). The complete unchanged upstream bodies live in `vendor/xz-compat`, with their original MIT license and an inventory. The adapter supplies bounded Uint8Array operations and an independent chunk preflight. The decoder algorithms are retained from upstream; no runtime package installation is required.

Both installed adapters use ordinary functions and typed arrays. They contain no dynamic evaluation, downloaded-source execution, filesystem calls or network calls. Their original upstream source modules are retained for provenance and are not imported at runtime. The existing Node CLI supplies filesystem receiving.

## Focused receiving

The complete joined toolkit was exercised on an actual original 37,480-byte XZ with one LZMA2 block, dictionary property 28 and CRC64. It recovered 144,525 bytes of source JSON and all 23 original files / 141,217 source bytes. Every decoded source body matched the independently retained original. The complete original fixture remains in its existing project source carrier.

Focused checks rejected an output cap below the original expanded size, a dictionary cap below its declared dictionary, altered stream-header CRC32 and altered block CRC64. The source-bank integration preserves the current optional source-map modes and provider-envelope receiving additions.
