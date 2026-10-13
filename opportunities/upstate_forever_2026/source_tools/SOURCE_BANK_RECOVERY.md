# Source archive recovery

This toolkit recovers the original files carried in the watershed sprint's ZIPs, gzip source banks and Slack source documents. The decoder uses ordinary JavaScript and typed arrays. It runs in a JavaScript-only environment without Node, a filesystem, network access, native compression libraries or execution of the decoded source.

The Node command adds local file reading and extraction. Use it to receive complete files into a new staging directory, inspect their identities, then apply the maintained application's existing installer or source-import command.

## Files

| File | Purpose |
|---|---|
| `archive_codec.mjs` | Pure UTF-8, base64, CRC32, SHA-256, bounded DEFLATE/gzip and exact source-bank encoding primitives |
| `source_bank.mjs` | Pure archive, envelope and source-bank decoder with member, size and portable-path validation |
| `source_bank_cli.mjs` | Node inspector and extraction command; uses Node's built-in modules only |

Authored by TokenJunkieLabs. The archive primitives continue the implementation used to recover the original application sources while the native executor was unavailable.

## Receive the completed native ZIP

From `opportunities/upstate_forever_2026`, place the retained original ZIP at its actual filename and inspect it:

```sh
node source_tools/source_bank_cli.mjs inspect eco-watershed13-received.zip \
  --sha256 716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5

node source_tools/source_bank_cli.mjs extract eco-watershed13-received.zip received-watershed-context \
  --sha256 716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5
```

The destination must be new; its parent must already exist. Every member is validated before extraction starts. The command writes source and output bytes without importing or executing them. Original executable flags remain in the inventory; extracted files have private mode 0600 and newly created directories have mode 0700.

The original native ZIP is retained in [the completed 217-HUC carrier](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9JNBA7EU). It contains 17 files and expands to 1,084,587 bytes. Its complete original package, seven generated outputs, model/source files and invocation records remain intact.

Extraction also writes:

- `.source-bank-recovery/input`: the exact original input file, including an envelope or Markdown carrier when that was supplied.
- `.source-bank-recovery/inventory.json`: all member paths, lengths and SHA-256 values, original input identity, selected recovered paths and resource limits.

The inspector emits metadata only. Use `--member application/source/water_context/20261013/full-domain-water-context.json` with `extract` to recover one named member; all archive members are still checked first. The complete original input and complete inventory remain in the recovery directory.

## Receive a source bank or exported carrier

Supported inputs can be supplied directly to the same command:

```sh
node source_tools/source_bank_cli.mjs inspect water-sources.md
node source_tools/source_bank_cli.mjs extract water-sources.md received-water-sources
node source_tools/source_bank_cli.mjs inspect source-bank.json.gz
```

Here `water-sources.md` is the complete exported Markdown of [the current 19-file source bank](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8RU4SK7B). Retain every JSON fence. The decoder orders the six numbered packets, checks a single consistent edition, checks compressed and decoded identities, verifies every leaf and reproduces all 573,918 original source bytes.

It also accepts the completed-run carrier's single `commons.artifact-base64/v1` JSON fence, verifies the contained ZIP's declared bytes and hash, then decodes that original ZIP. Plain base64 input is accepted with `--base64`.

For ordinary input, `--sha256` checks the supplied file bytes. With `--base64`, it checks the decoded archive bytes. For a Markdown envelope, the declared inner artifact hash is checked automatically; the outer Markdown identity is recorded separately.

Source-bank paths are preserved relative to the chosen destination. The bank's `source_root` or `base_path` is returned as provenance metadata and is not prepended silently. A project-relative bank can therefore be recovered into a new project staging directory and installed through its existing source-specific workflow.

## Pure JavaScript use

In a normal ES-module environment:

```js
import { createSourceBankToolkit } from "./source_tools/source_bank.mjs";

const recovery = createSourceBankToolkit({
  maxInputBytes: 2 * 1024 * 1024,
  maxOutputBytes: 8 * 1024 * 1024,
  maxMemberBytes: 2 * 1024 * 1024
});
const result = recovery.decode(originalZipBytes, {
  expectedSha256: "716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5"
});
const inventory = recovery.inventory(result);
const originalFile = result.files.find(
  file => file.path === "application/source/water_context/20261013/full-domain-water-context.json"
);
// originalFile.data is the exact Uint8Array; inventory contains metadata without file bodies.
```

`decode` accepts a `Uint8Array` or UTF-8 text. For a Slack file read, pass the returned `structuredContent.text_content` directly. For an already parsed original bank or packet array, use `sourceBank(bank)` or `packets(parts)`.

Environments that evaluate a trusted host script instead of loading ES modules can bundle these two reviewed modules at build time. Keep the resulting functions in the host's ordinary source and pass archive bytes as data. The toolkit contains no `eval`, dynamic source compilation, shell calls or fetches.

To preserve an exact JSON source bank while changing its transport:

```js
import { createArchiveCodec } from "./source_tools/archive_codec.mjs";
const codec = createArchiveCodec();
const packed = codec.encodeSourceBank(originalSourceBankText);
const restored = codec.decodeSourceBank(packed.gzipBase64, packed.sha256);
// restored.text preserves the original UTF-8 JSON text exactly.
```

Passing an object to `encodeSourceBank` creates a new JSON serialization; passing the original text preserves its byte identity. The high-level decoder verifies source-bank leaf bytes. The low-level encoder encodes supplied data and reports its identities.

## Supported contracts

| Input | Supported behavior |
|---|---|
| ZIP | Single-disk classic ZIP, methods 0 (stored) and 8 (DEFLATE), ASCII or explicitly UTF-8 names, ordinary files and directory records, optional central comments and ordinary extra fields |
| ZIP descriptors | Both signed and unsigned 32-bit data descriptors; local and central names, flags, methods, sizes and CRCs must agree |
| DEFLATE | Stored, fixed-Huffman and dynamic-Huffman blocks; emitted bytes are capped during decompression |
| gzip | Header extras, names, comments, header CRC, concatenated members, CRC32 and ISIZE verification; output and member-count limits |
| Source banks | `commons.source-bank/v1`, `upstate.source-files/v1`, `eco-source-text-v1` and legacy `schema: 1`; arrays of descriptors or plain path-to-text mappings |
| Leaf contents | Exact UTF-8 `content`, `content_base64`, or explicit `encoding: "base64"` plus `content`; declared byte lengths and hashes are checked |
| Carriers | One supported JSON bank/envelope fence, or one complete cohort of `upstate.application-source-part/v1` gzip+base64 packets |

Unsupported ZIP variants fail explicitly: encryption, ZIP64, multiple disks, alternate compression methods, symlinks/special files, executable archive preambles and unaccounted local data. Empty directory records are checked and counted; extraction creates the directories needed by files. The complete original archive retains every directory record.

Member paths must be relative and portable. Absolute paths, traversal, backslashes, control characters, Windows device names, trailing dots/spaces, case/normalization collisions and file-versus-parent collisions are rejected. The CLI reserves `.source-bank-recovery` for the original input and inventory.

## Resource behavior

Defaults:

| Limit | Value |
|---|---:|
| Input bytes | 64 MiB |
| Total expanded bytes | 128 MiB |
| One member | 32 MiB |
| Members | 10,000 |
| Concatenated gzip members | 1,024 |

CLI options use the corresponding kebab-case names shown by `--help`. Use positive integer byte counts. Lower the limits for a small receiving worker. For large scientific rasters and multi-gigabyte data, use the existing native streaming acquisition/transfer tools.

This is an in-memory decoder. It retains the compressed input, expanded members and inventory together. JSON parsing and UTF-8 strings require additional memory; gzip concatenation and SHA-256 can temporarily hold another byte copy. Compression uses an input-sized match index. Set limits below actual available process memory, allowing several times the expanded byte limit for parsing and hashing.

ZIP expanded sizes are checked before inflating members. A member's declared uncompressed size is also its DEFLATE emission cap, so an incorrect declaration cannot grow past that allocation limit. Gzip output is capped while bytes are emitted. Packet byte/count/hash checks bind every part to one source edition.

The CLI reads only regular input files within the configured input cap and rejects a file that changes while being read. It validates the complete archive before creating the destination, opens output files exclusively without following symlinks, and removes its newly created recovery directory if a write fails. Existing destination paths are left intact.

## Focused receiving results

The pure decoder was exercised on the actual retained originals:

| Original input | Result |
|---|---|
| Native ZIP, 121,182 bytes, SHA-256 `716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5` | All 17 members decoded; 1,084,587 output bytes; every ZIP CRC and size matched |
| Same ZIP in its original Markdown artifact envelope | Same 17 complete member identities |
| Six-part ECO-SOURCE12 carrier | All 19 files; 573,918 source bytes; decoded JSON SHA-256 `0e79fb406d92a517f294e8be89f8ea143c23ac91096b952779bb06e63662622f` |
| Actual ZIP/gzip with lower output limits, altered local ZIP name, mixed packet editions and traversal path | Rejected at the corresponding size, identity or path check |

These checks exercise the original archive and source formats in the JavaScript runtime. The Node filesystem adapter has received source review; run `inspect` followed by `extract` on the retained ZIP above when receiving it on the native host.
