# Artifact archive reader and completed watershed context

## Reuse in code mode

`artifact-reader.mjs` provides base64 decoding, UTF-8 decoding, SHA256, ZIP extraction and single-member GZIP extraction using ordinary JavaScript. It requires no filesystem, network, Node module, browser, npm package or Python runtime. The completed watershed archive was recovered with this module while native execution transport was unavailable.

Exports: `base64Bytes`, `utf8Text`, `crc32`, `inflateRaw`, `readZip`, `readGzip`, `utf8`, `base64`, `sha256`.

```javascript
// In a normal ESM application:
import {base64Bytes, readZip, utf8Text, sha256} from "./artifact-reader.mjs";
const zipBytes = base64Bytes(carrier.content_base64);
if (zipBytes.length !== carrier.bytes || sha256(zipBytes) !== carrier.sha256) {
  throw new Error("Archive differs from its declared source");
}
const members = readZip(zipBytes);
const reportMember = members.find(file =>
  file.path.endsWith("/watershed-context.json")
);
const report = JSON.parse(utf8Text(reportMember.data));
```

In a code-only V8 isolate, recover the module's UTF-8 source and load its pure functions:

```javascript
const api = new Function(
  moduleSource.replaceAll("export function ", "function ") +
  "\nreturn {base64Bytes,readZip,readGzip,utf8Text,sha256};"
)();
const files = api.readZip(api.base64Bytes(carrier.content_base64));
store("received_members", files.map(file => ({
  path: file.path,
  bytes: file.bytes,
  sha256: api.sha256(file.data),
  content: api.utf8Text(file.data)
})));
```

Commit decoded data in a completed code-only isolate before making a native call. This keeps an unrelated process timeout from discarding the retained bytes.

The ZIP reader handles stored and DEFLATE members. It verifies member sizes and CRC32 and preserves the archive's relative paths. Its default limits are 32 MiB per member and 64 MiB total, configurable through `max_member_bytes` and `max_total_bytes`. Split archives, ZIP64, encrypted members and other compression methods return explicit errors. Filename text uses UTF-8; current source package paths are ASCII.

`readGzip(bytes)` returns `{data, bytes, crc32, filename, mtime}`, validates optional header fields and checks the trailer. It accepts one GZIP member per input. `inflateRaw` supports stored, fixed-Huffman and dynamic-Huffman blocks. The reader follows [RFC1951](https://www.rfc-editor.org/rfc/rfc1951) and [RFC1952](https://www.rfc-editor.org/rfc/rfc1952).

## Completed original watershed run

The original ECO-WATERSHED13 command completed on `4bdbb5b17718` using `/usr/bin/python3` 3.12.3 at 01:22:38 UTC on 13 October 2026. Its run record reports exit 0 in 0.310 seconds. The result is `watershed-4592eb077b7164d59ba4`. The original archive and full reports remain in [F0C9JNBA7EU](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9JNBA7EU).

All 17 ZIP members passed CRC32 after extraction. Each of the seven generated outputs matches the original programme's output SHA256; the five archived original inputs match their source bank. `watershed-received-context.json` carries the source identities, original command, output manifest, quantitative interpretation and selected state records.

| Context | HUC12s | Whole watershed acres | Selected-class source features |
| --- | ---: | ---: | ---: |
| NRCS priority | 15 | 467,561.88 | 0 |
| Selected stream classes | 19 | 410,787.63 | 1,886 |
| Remaining model watersheds | 183 | 3,780,722.59 | 0 |
| Complete domain | 217 | 4,659,072.10 | 1,886 |

NRCS priority and selected stream classifications remain separate source dimensions. The selected class query covers ORW, ONRW, TN, TPGT and TPT; its counts use the publisher's HUC12 attribute. The domain retains 116 South Carolina-bearing HUC12s and 101 other original model HUC12s. Native source geometry and hydrologic connectivity can supply the application’s spatial associations.

The 240 retained state records total 4,659,074.06895431 acres. The original whole-watershed and state-portion area values preserve their source rounding difference. Lower Tugaloo (`030601020507`) retains 59,689.69 whole-HUC acres, Georgia's 38,264.28633246 state acres, and South Carolina's 21,425.42741381 state acres. Both original state records designate high priority and retain the Ground / Water Quality resource concern.

## Current application continuation

The seven outputs reside under `application/outputs/watershed-context-20261013/` in the original ZIP. The original input edition is `application/source/water_context/20261013/`. Preserve that directory's companion relationships when importing and reopening it through the existing Workspace source importer. The current operator's source-loader entry point is `source_tools/prepare_watershed_context.py:load_source_edition(context_path.parent)`; the handoff JSON identifies the original source edition and current operator carriers.

The original report's native network status is `not_supplied`. The whole 217-HUC context and source-bound Lower Tugaloo selection are ready to reuse in the existing workbench. A later native-network join is a new input to the original context builder and receives its corresponding result identity.

## Preserve the source edition through reopen

`watershed-companion-plan.json` gives exact archive-member-to-edition paths, byte sizes and SHA256 values for the real later classification coverage, all seven completed outputs and the original run record. Apply these additions to the existing `upper-savannah-water-context-domain217-20261013` entry. Preserve its original source URI, metadata and companions, and preserve the separate NRCS priority table entry.

The original seven-file edition in F0C8RTULRB3 predates `scdes-domain217-source-coverage.json`. Recover that file from the actual completed ZIP, where it matches the later source bank. The loader's `complete-sources.json` is an ordinary `upstate.sources/v1` import manifest. `load_source_edition(context_path.parent)` reads the retained `full-domain-water-context.json` and `scdes-domain217-source-coverage.json` basenames directly, plus `native-network.json` when supplied. The import manifest itself is not a required context companion. Its `source_files` contains those two or three model inputs; publisher originals are tracked separately as supporting files. Preserve completed outputs below `received/watershed-context-20261013/` as retained companions, outside that model-input list.

The native importer reconstructs declared companion paths under each source entry's restored view. Keep the report copies under `received/watershed-context-20261013/` inside the edition. Resolve the separate NRCS table by its own source ID when it is needed. ECO13-47DB owns the maintained loader, edition preparation and operator continuation; this package supplies the already completed data and the exact receiving map.

## Maintained loader

The complete current producer and loader are in [F0C8QA3KZ42](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QA3KZ42), `source_tools/prepare_watershed_context.py`, 19,631 bytes, SHA256 `84fc86cc7ff3299ee3832c73d19b0cf5b5abdf552079d93a5b7eeff3e65a91d4`. ECO13-47DB retains its source/import/operator/model publication. The receiving data edition can use the original two model inputs and preserve optional original classification or network material when supplied.


## Complete receiving edition 1.0.2

The complete source bank supplied with this edition retains all 30 receiving files. Its ordinary import manifest preserves the original two source IDs and 22 context companions. The received run includes its referenced source-receipt.json, exact stdout and stderr, and the three original executed model/CLI/documentation files under received/watershed-context-20261013/original-source/model/. These are retained historical source bytes; the maintained application keeps its current model implementation. The source record binds all five files used by the original execution, while the run record binds all seven original outputs.

The exact original eco-watershed13-received.zip is also a retained binary companion (121,182 bytes, SHA256 716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5). The maintained operator/receive_watershed_context.py consumes this original ZIP to register the completed regional report and preserve its original source bundle.

## Compact source-bank transfer

artifact-writer.mjs adds deterministic GZIP encoding in the same ordinary JavaScript runtime. It uses fixed Huffman DEFLATE with a 32 KiB sliding window and bounded match search; it needs no process, network, package download or filesystem. Import writeGzip from the sibling module and pass Uint8Array input. For the reader's UTF-8 helper, use writeGzip(Uint8Array.from(utf8(jsonText))). Decode with readGzip or standard gzip, then verify the uncompressed length and SHA256 before parsing the source bank.

The receiving bank compressed from 1,380,519 bytes to 357,413 bytes during development, a 74.1% transfer reduction. Roundtrip verification used the complete source packet and boundary inputs including an empty stream, single bytes, repeated data and a 32 KiB window crossing. The encoder's default input limit is 64 MiB; the reader's existing default decompression limit remains separate.

## Repository composition 1.0.3

The maintained source directory now contains its network-enriched guide. Repository composition preserves that current README and appends the completed-run receiving workflow. Historical original guide/manifest bytes are retained as original-source-README.md and original-sources.json, and complete-sources.json points to those actual companion names. The original-sources manifest records the historical edition; use complete-sources.json to import this reconstructed receiving edition.
