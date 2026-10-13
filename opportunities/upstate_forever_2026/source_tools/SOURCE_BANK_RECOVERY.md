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

Source-bank paths are preserved relative to the chosen destination. The bank's `source_root`, `base_path`, or `commons.source-map/1` `prefix` is returned as provenance metadata and is not prepended silently. A project-relative bank can therefore be recovered into a new project staging directory and installed through its existing source-specific workflow.

## Receive original JSON source packets

The same command accepts an original `upstate.application-source-part/v1` JSON object directly, or a JSON array containing its complete packet cohort. A single object must declare `part: 1` and `parts: 1`. A multipart edition must include every original packet; the decoder orders packets by their declared index and rejects mixed editions, missing parts and duplicates. No Markdown wrapping or manual decompression is needed.

For the [complete prepared tributary source](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9L50G0GY), the original single-packet body is also retained as Git blob `83071835c3f7f2b7fd701a1e7ff134cf645d8370` in `woahwhattheheck/public-commons-sprint-2026`. Save that exact returned packet text as `prepared-tributaries-source.json` and run:

```sh
node source_tools/source_bank_cli.mjs inspect prepared-tributaries-source.json
node source_tools/source_bank_cli.mjs extract prepared-tributaries-source.json received-prepared-tributaries
```

The complete result contains 38 files and 1,351,991 original source bytes. Its decoded JSON is 1,437,686 bytes with SHA-256 `5542892c2ce03fe7872b8f1f1b3125dbc12ef5a4fda35dfdd71bf89f75f88ff6`; the original gzip is 384,653 bytes with SHA-256 `02f8766608a776e61e8f5ef8c957c264a0104c796e1ce5e28592da1022157ad4`. All original prepared source paths and per-file identities survive extraction. Use the retained preparation guide and existing `source_tools.sparrow_reference bind` command for the actual Workspace admission.

Every source-packet cohort must declare its edition, positive part count, decoded/gzip byte lengths and both SHA-256 identities. The decoder checks declared sizes before base64 decoding and limits decompression to the declared decoded length. Optional source-file count and summed source-byte declarations are checked when present.

## Receive native Slack Canvas responses

The same receiver accepts the exact JSON returned by `slack_read_canvas`, including its single-text MCP result wrapper. Save the complete provider response, preserving its `canvas_id` and `markdown_content`, and inspect or extract it directly:

```sh
node source_tools/source_bank_cli.mjs inspect delivery-source-canvas-response.json
node source_tools/source_bank_cli.mjs extract delivery-source-canvas-response.json received-delivery-source
```

For [the six-file delivery and portable source carrier](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KMMH8DT), all six original files recover to 114,891 bytes. The retained source JSON is 121,369 bytes, SHA-256 `db241e9512cee077075969fe165b961931b8819e4e98ebcab600a8ff916e580c`. Its files preserve the original coherent repository commit and each Git blob.

A `commons.source-bank-envelope/v1` declares `encoding: "base64+gzip"`, `data`, decoded `bytes`/`sha256`, and `gzip_bytes`/`gzip_sha256`. All four identity fields are required. The receiver checks the compressed identity before decompression, caps expansion at the declared decoded length, then verifies decoded identity and every source member. It retains both envelope identities in the inventory.

Native Canvas responses can add Markdown escaping inside JSON fences. The receiver removes one such transport layer only within an identified Canvas response; ordinary Markdown keeps strict JSON parsing. The inventory also records the Canvas ID and exact returned Markdown identity. The original provider response remains in `.source-bank-recovery/input`.

Provider error responses, multiple text results and excessive wrapper nesting fail explicitly. A single source cohort is required throughout, including numbered packet collections. This lets an equipped receiver use the original result directly without manually rewriting source or stripping transport escaping.

## Receive the complete cumulative application

The same commands accept the current [ECD1 edition 3 application carrier](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KFCT3S9). Save its complete Markdown, including all 148 JSON packet fences:

```sh
node source_tools/source_bank_cli.mjs inspect cumulative-application.md
node source_tools/source_bank_cli.mjs extract cumulative-application.md received-cumulative-application
```

This original cohort contains 586 files and 9,132,400 source bytes. Its `commons.source-map/1` payload is 10,018,711 bytes, SHA-256 `4064517a7a3ca09db90dc3d936413cf07e8af96e4b30e5cb4a3c9c88a91514a8`; the 3,090,920-byte gzip has SHA-256 `ecbcf5601f579f9df775259b146ec75167fc4f0c44fe2025907118e8b239e548`.

A source map stores UTF-8 bodies or explicitly base64-encoded binary bodies in `files`, with each member's encoding and original descriptors in `file_metadata`. An omitted encoding means UTF-8. Byte counts and SHA-256 always describe the decoded original file. The decoder requires a one-to-one path match, checks every descriptor's required byte length and SHA-256, and accepts only regular source modes `100644` and `100755` when a mode is supplied. Older banks may omit mode; those members have no declared executable flag. The inventory retains each complete descriptor as `declaredMetadata`, including original Git references and source origins. SHA-256 and byte counts are verified against the recovered body; additional provenance fields preserve the publisher's declarations. The cohort's edition, repository, source reference and application prefix remain in the inventory.

The current source edition has 11 executable-marked members. As with other inputs, the extractor writes all recovered files privately with mode 0600; apply the maintained installer after source inspection to perform the normal application installation.

## Receive the published station assessment source

The station assessment carrier uses a single `commons.gzip-source-bank/v1` envelope. It contains ordered base64 `chunks`, mandatory decoded byte/hash identity, and one complete compressed identity pair: `compressed_bytes`/`compressed_sha256` or `gzip_bytes`/`gzip_sha256`. The carrier may label this representation `base64+gzip`, `gzip+base64` or `base64+gzip+utf8-json`. Chunks may be strings or objects carrying a zero-based `index` and `content_base64`. Object chunks must already be in their complete declared order; mixed representations, missing indices, duplicate indices and reordered chunks are rejected. If both compressed identity pairs are supplied, they must agree. A declared `file_count` must match every decoded member. The decoder checks the compressed identity, bounded gzip output, decoded identity and every leaf descriptor before extraction.

For [the complete maintained revision 2 station assessment edition](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JP4654K):

```sh
node source_tools/source_bank_cli.mjs inspect station-assessment-source.md
node source_tools/source_bank_cli.mjs extract station-assessment-source.md received-station-assessment
```

This original carrier recovers 302,938 source bytes in ten files. Its gzip is 77,923 bytes, SHA-256 `f9d1b3499477a7a16e18bd494c69d1bf17ce1fe56023b07c0e34e124ef19abdc`; its decoded source-map JSON is 323,022 bytes, SHA-256 `9573f57e9fdafeb7044c518cf3cf7605bca7689e749c38c0c43d026bdae2612f`. It includes the exact 111,624-byte published assessment inventory: 192 records at 159 station IDs, with separate 2024 and July 2026 source editions.

The current maintained station application and original receiving operation remain the installation route. This example demonstrates receipt of that retained source edition. Select the newest source cohort from its original owner when composing with an existing application.

Slack's exported JSON indentation can contain non-breaking spaces. Parsing normalizes these only outside quoted strings; source bodies, quoted paths, encoded data and literal source characters remain unchanged. Original carrier bytes and their hash are retained. The optional `--sha256` argument checks those outer Markdown bytes; the envelope's declared inner hashes are checked automatically.

The original [17-file priority and assessment source bank](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KECMA4V) uses the same envelope schema with the `gzip_bytes`/`gzip_sha256` pair and `encoding: "gzip+base64"`. The ordinary inspector/extractor accepts its complete original Canvas response. It recovers all 5,787,182 source bytes, including the full original normalized 2024 and July 2026 banks, the 217-HUC comparison and its actual 192-record CSV. Its compressed identity is 532,533 bytes / SHA-256 `c12c4d5af49f0a61636266a32d31e53d33661e39f5f500efe0c1000729f9ed4b`; its decoded source bank is 6,398,128 bytes / SHA-256 `38d107f670cd69b6b259600af54cfd06cc51da9b4541e5675922326292d7847d`.

## Receive the complete 53-file station family

The original [station, assessment and microbial source family](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9KGS3K40) carries 53 complete files in 49 numbered base64 parts. The current edition includes the maintained 164-station / 293-record selection, the multi-inventory assessment context and its native report producers.

Save the complete carrier Markdown, including its introductory identities and every part:

```sh
node source_tools/source_bank_cli.mjs inspect native-station-family.md
node source_tools/source_bank_cli.mjs extract native-station-family.md /absolute/new/native-station-family
```

This carrier declares gzip length 434,497 bytes and SHA-256 `6dbeb87f8947e57042ee915a487b2fa450351723490dc508096ba16b0807a4d8`; its complete decoded JSON is 2,634,598 bytes and SHA-256 `bfc124913387832c10a3b65378d157a5bc6a58ae01ffd06c83b160950503b4b7`. Every recovered original member matches its declared bytes and SHA-256.

The decoder recognizes this numbered carrier only when the introductory `Complete JSON:`, `Gzip:` and `Parts:` identities are present exactly once, all base64 fences belong to the cohort, and every `## Part NN of TOTAL` header forms the complete one-based sequence. The original compressed and decoded hashes are checked before its source files are returned. JSON-fenced source envelopes retain precedence.

This native bank uses `commons.source-map/1` with `files` as an array of descriptors. Each descriptor must carry `path`, original `bytes`, `sha256` and supported content. Optional regular-file modes are `100644` or `100755`. Its original `git_blob` and other descriptor metadata remain in the recovery inventory; source text is stored only in the recovered file. Array descriptors carry their own metadata and cannot also supply a separate `file_metadata` map. Existing source-map files/metadata mappings remain supported with their same exact-key checks.

After extraction, use the included maintained `operator/install_station_geography.py` against the existing complete application. Its original 45-member install plan and backups remain authoritative. The complete original assessment inputs are available through [the native 164-station receiving workflow](NATIVE_STATION164_RECEIVING.md); its ready-import source ZIP retains all eight typed entries and the original publisher records.

## Receive the current annual and microbial context source

The [complete 17-file scientific-context carrier](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8URGSUFK) preserves the original eight annual/native assessment files, eight measured microbial files and the maintained annual-context receiving driver. Save its complete original Canvas response or exported Markdown and use the existing commands:

```sh
node source_tools/source_bank_cli.mjs inspect scientific-context-source.json
node source_tools/source_bank_cli.mjs extract scientific-context-source.json received-scientific-context
```

The outer `upstate.scientific-context-source-carrier/v1` has `encoding: "gzip+base64"` and an ordered `parts` array of base64 strings. It requires both `gzip_bytes`/`gzip_sha256` and `decoded_bytes`/`decoded_sha256`. The receiver checks compressed identity before expanding, caps expansion at the declared decoded length, and verifies decoded identity before accepting the original inner `upstate.scientific-context-receiving-source/v1`.

That inner bank carries `files` as descriptors with original UTF-8 `content`, mandatory `bytes` and `sha256`, and optional regular-file mode. Every descriptor is verified. The inventory keeps each original descriptor without duplicating its content, plus the bank's title, project ID, source commits and descriptive path base under `sourceContext`. Those declarations remain provenance; a descriptive `path_base` never changes the extraction destination. The original envelope remains in the recovery metadata.

For the retained edition, the gzip is 218,719 bytes with SHA-256 `dbab8c73d1931ddf1ee410ccb87846eff81c7916167b70918764f98719006b68`. Its decoded source JSON is 1,890,171 bytes with SHA-256 `1fbd583a8835e28114faa163622e0ac6cd4185a0bc2702faaee91f47eb402843`. All 17 files expand to 1,766,496 original source bytes. The driver is `source_tools/operate_annual_assessment_context.py`, 27,430 bytes, SHA-256 `6970b516bf3dffe25f1e7f8f791b66a9519a2aa1b906c057a180d4c2b235912a`.

The extracted files belong in the receiver's existing complete application. Continue its current `operate_annual_assessment_context.py` operation with the existing Workspace, project, output directory and progress file. The driver resumes recorded tasks from that progress file. Its `--manifest` and `--microbial-manifest` options select the two unchanged source manifests. Preserve the original 217-watershed domain collection and source when supplying `--domain-collection` and `--domain-source-id`.

The same decoder accepts the original inner source JSON directly when the native byte bridge has already reconstructed it. Passing the complete Canvas response preserves its transport identity as well. Missing parts, a changed gzip identity, or an absent per-file hash fail before any extracted file is written.

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

`decode` accepts a `Uint8Array` or UTF-8 text. For a Slack file read, pass the returned `structuredContent.text_content` directly. For a native Canvas read, pass `JSON.stringify(readCanvasResult)` or its complete returned JSON text. Both the Canvas record and its original single-text MCP wrapper are recognized. For an already parsed original bank or packet array, use `sourceBank(bank)` or `packets(parts)`.

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

## XZ-compressed source banks

The same `inspect` and `extract` commands receive single-stream plain LZMA2 XZ source banks. The retained input SHA-256 identifies the XZ bytes; the inventory also records the decoded payload identity, stream check and block positions. See [XZ source banks](XZ_SOURCE_RECOVERY.md) for exact format support, dictionary/output limits, original upstream sources and the complete receiving commands. ZIP, gzip and the existing provider envelopes retain their current behavior.

## Binary source-map members

Both `source_bank.mjs` and `receive_application_source.py` apply the declared per-member encoding before comparing original byte counts, SHA-256 and any supported original Git identity. Omitted encoding and explicit `utf-8`/`utf8` mean text; `base64` recovers the original binary bytes. The Python source-map receiver accepts its existing plain or gzip source-map carriers; an XZ bank uses the JavaScript inspector/extractor above.

The retained `integration/source_binary_inputs.json` includes the original `source/overlay-metadata/oconee-parcels/body.json.gz` companion: 1,906 bytes, SHA-256 `439a6c21e06b6690babbaade0d40597388cd416e485f5028547c29017a857304`. Its source-map descriptor uses `encoding: "base64"`; the digest describes the original gzip file, not its encoded text. The complete companion therefore travels with the other application source through source-map receiving and application ZIP receiving.

## Supported contracts

| Input | Supported behavior |
|---|---|
| ZIP | Single-disk classic ZIP, methods 0 (stored) and 8 (DEFLATE), ASCII or explicitly UTF-8 names, ordinary files and directory records, optional central comments and ordinary extra fields |
| ZIP descriptors | Both signed and unsigned 32-bit data descriptors; local and central names, flags, methods, sizes and CRCs must agree |
| DEFLATE | Stored, fixed-Huffman and dynamic-Huffman blocks; emitted bytes are capped during decompression |
| gzip | Header extras, names, comments, header CRC, concatenated members, CRC32 and ISIZE verification; output and member-count limits |
| Source banks | `commons.source-bank/v1`, `upstate.source-files/v1`, `eco-source-text-v1` and legacy `schema: 1`; arrays of descriptors or plain path-to-text mappings |
| XZ | Single-stream plain LZMA2 source banks; bounded dictionary/output, complete metadata/index checks and None, CRC32, CRC64 or SHA-256 block checks; see the linked XZ guide |
| Cumulative source maps | `commons.source-map/1`; `files` mapping using UTF-8 by default or `file_metadata[path].encoding: "base64"`, with mandatory original byte length and SHA-256 and optional regular-file mode; complete original descriptors retained |
| Leaf contents | Exact UTF-8 `content`, `content_base64`, or explicit `encoding: "base64"` plus `content`; declared byte lengths and hashes are checked |
| Carriers | One supported JSON bank/envelope fence, or a complete `upstate.application-source-part/v1` gzip+base64 cohort as a JSON object, JSON array or Markdown JSON fences |
| Source envelopes | `commons.source-bank-envelope/v1` with required decoded/compressed lengths and SHA-256 identities; `commons.gzip-source-bank/v1` with ordered base64 chunks and both original byte/hash pairs |
| Scientific-context carriers | Original ordered `upstate.scientific-context-source-carrier/v1` base64 parts with mandatory gzip/decoded identities; original receiving-source descriptor array with mandatory per-file bytes/SHA and retained project/source metadata |
| Native Canvas results | Original `canvas_id`/`markdown_content` JSON, optionally in one text MCP result; Canvas transport escaping and original carrier identity retained |

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
| Current scientific-context carrier, original 17-file Canvas/MCP response | All 17 files and 1,766,496 original source bytes matched; exact project/source metadata retained; unchanged CLI inspect and extract paths exercised with an in-memory filesystem adapter, preserving the original input and full inventory |
| Native ZIP, 121,182 bytes, SHA-256 `716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5` | All 17 members decoded; 1,084,587 output bytes; every ZIP CRC and size matched |
| Same ZIP in its original Markdown artifact envelope | Same 17 complete member identities |
| Six-part ECO-SOURCE12 carrier | All 19 files; 573,918 source bytes; decoded JSON SHA-256 `0e79fb406d92a517f294e8be89f8ea143c23ac91096b952779bb06e63662622f` |
| ECD1 edition 3, 148 packets, 10,018,711-byte JSON | All 586 files and 9,132,400 source bytes matched; every original descriptor retained; 11 executable-marked members recorded |
| Actual six-file Canvas, its native MCP response, unescaped Markdown and original source JSON | All four input forms recovered the same six paths and hashes, totaling 114,891 bytes |
| Published station revision 2, original MCP/Canvas response with NBSP indentation | All 10 files and 302,938 source bytes matched; exact 111,624-byte assessment inventory recovered |
| Original 87-station supplement | All eight files and 122,947 source bytes matched their declared hashes |
| Complete priority/assessment carrier, original MCP/Canvas response | All 17 files and 5,787,182 source bytes matched; both gzip identity aliases and declared file count checked |
| Quoted NBSP characters and source-map modes | Quoted source bytes preserved; an explicitly supplied symlink mode rejected |
| Changed source-envelope gzip identity or excessive provider wrapper nesting | Rejected before source recovery |
| Changed source-map byte count/hash, missing or orphan metadata, unsupported file mode | Rejected at the source-map descriptor check |
| Actual ZIP/gzip with lower output limits, altered local ZIP name, mixed packet editions and traversal path | Rejected at the corresponding size, identity or path check |

These checks exercise the original archive and source formats in the JavaScript runtime. The Node filesystem adapter has received source review; run `inspect` followed by `extract` on the retained ZIP above when receiving it on the native host.
