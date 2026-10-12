# Grants.gov capture storage and receiving

The workspace retains each immutable capture packet once and supplies its exact stored representation to the existing dataset publisher. New packets use gzip when that representation is smaller. Reading an edition, exporting a workspace, or receiving a merchant source reconstructs the original capture packet and validates its original source identity.

The public opportunity rows, selected-edition coverage, qualification notes, capture operation, and portable workspace APIs retain their existing meanings. A representation change does not create another Grants.gov acquisition.

## Stored and decoded identities

An edition continues to identify its source with the original packet SHA-256. Storage adds a separate, explicit description of the bytes on disk:

| Field | Meaning |
| --- | --- |
| `packetSha256` | Original capture export identity, as validated by `inspectCaptureExport`. |
| `captureId` | Original source acquisition ID. |
| `sourceSignature` | Original capture source signature; partial captures can retain a null signature. |
| `encoding` | `gzip` or `identity`. |
| `file` | Relative path of the actual stored member. |
| `storedBytes`, `storedSha256` | Length and hash of the exact transported or stored bytes. |
| `decodedBytes`, `decodedSha256` | Length and hash of the unchanged UTF-8 capture packet bytes. |

The descriptor schema is `stellar-forge.grantsgov-capture-storage.v1`. Its fields are closed: unexpected fields, invalid relative paths, inconsistent identity-encoding lengths or hashes, and invalid digest strings are rejected.

The workspace's `edition-sources/` directory contains:

~~~text
<packet-sha256>.storage.json
<packet-sha256>.json.gz
~~~

If gzip is larger, the body uses `<packet-sha256>.json` with an identity descriptor. An older `<packet-sha256>.json` without an index remains a supported original representation.

Each source body is private, regular, and separate from other files. The original private-file readers enforce the existing ownership, link, mode, and symlink rules.

## Maintained API

Import `capture-storage.mjs` beside the existing Grants capture and workspace modules.

| Function | Result and intended use |
| --- | --- |
| `encodeCapturePacket(packet, options)` | Validates the original packet and returns `{descriptor, body}`. Optional `originalBytes` preserves an existing packet's exact whitespace and byte representation. |
| `decodeCapturePacket(body, descriptor)` | Returns `{packet, descriptor, decodedBytes}` after validating both byte layers and the full original source packet. |
| `retainCapturePacket(directory, packet)` | Writes the first immutable representation under the original storage lock, or returns the existing validated representation with `reused: true`. |
| `readStoredCapture(directory, packetSha256)` | Reopens indexed storage or legacy JSON and returns the original packet, descriptor, retained body, decoded bytes, and legacy status. |
| `captureMerchantMember(directory, packetSha256)` | Produces the exact source member and descriptor required by the native publisher's `sourceFiles` interface. |
| `readMerchantCapture(directory)` | Opens a received package's `source.json` and declared source member, validates their relationship, and returns the original capture packet. |

For a received merchant package:

~~~js
import { readMerchantCapture } from './capture-storage.mjs';
import { readCaptureExport } from './capture.mjs';

const received = await readMerchantCapture('/absolute/received-package');
const capture = readCaptureExport(received.packet);

console.log({
  captureId: capture.captureId,
  opportunities: capture.opportunities.length,
  coverage: capture.coverage,
  storedBytes: received.descriptor.storedBytes,
  decodedBytes: received.descriptor.decodedBytes,
});
~~~

Use `readCaptureExport` on the reconstructed packet for the original verified normalized opportunities, requests, pages, detail descriptors, source links, and coverage. The storage layer does not normalize those fields again.

## Native merchant and SF82 publication

The existing merchant package still contains `dataset.csv`, `dataset.json`, `source.json`, and the selected immutable edition. The source packet member now commonly has the path `source/capture.json.gz`.

The merchant's `source.json` contains:

~~~json
{
  "sourceSignature": "<original capture signature>",
  "captureStorage": {
    "schema": "stellar-forge.grantsgov-capture-storage.v1",
    "encoding": "gzip",
    "file": "source/capture.json.gz",
    "captureId": "<original capture ID>",
    "sourceSignature": "<original capture signature>",
    "packetSha256": "<original packet SHA-256>",
    "storedBytes": 2886232,
    "storedSha256": "<actual compressed SHA-256>",
    "decodedBytes": 9696131,
    "decodedSha256": "<actual original file SHA-256>"
  },
  "sourceFiles": [
    {
      "path": "source/capture.json.gz",
      "bytes": 2886232,
      "sha256": "<actual compressed SHA-256>"
    }
  ]
}
~~~

The native `sourceFiles` entry describes the actual compressed bytes. The existing publisher and SF82 release machinery can copy and verify that member without interpreting or altering it. Other provenance members, including `source/edition.json`, remain in the same list.

Use `readMerchantCapture` for capture reconstruction instead of assuming that `source/capture.json` exists. Older merchant packages with that uncompressed member and no `captureStorage` descriptor remain readable. Their existing member length/hash and original capture signature are still checked.

Workspace `exportEdition`, full-workspace export, and full-workspace restoration continue to carry the original decoded capture packet. Their public packet formats do not change. Receiving a workspace retains the original source packet ID and makes the new local storage choice once.

## Replay and interrupted writes

First retention takes the existing private workspace lock within the capture-storage directory. The body is written to an exclusively created temporary file, synchronized, and renamed before its descriptor index is committed. The directory is synchronized at both commit boundaries.

A repeated retention reads and validates the first retained representation. It preserves its body, hash, inode, and modification time. This also preserves actual encoded bytes if a later runtime uses a different compressor implementation.

If execution ended after a complete gzip body was committed but before its index was written, the same retention can recover that body. Recovery uses a bounded decoder and verifies the complete original packet before writing the missing descriptor. A malformed, truncated, or unrelated body produces an error tied to that same retained path.

A legacy JSON body stays in its original form. Building a new merchant from it may encode the exact old bytes for transport while keeping the original local JSON intact.

## Decoder and allocation limits

The maximum decoded packet and maximum stored body are each 256 MiB. The descriptor index is limited to 64 KiB. Gzip decoding also uses the descriptor's exact decoded length as its output limit, so a small declared packet cannot silently expand to the global maximum.

Decoding verifies, in order:

1. Closed descriptor shape, paths, sizes, and identities.
2. Exact stored length and SHA-256.
3. Gzip decoding within the declared output bound.
4. Exact decoded length and SHA-256.
5. Valid UTF-8 JSON and the existing full capture-export validation.
6. Matching original capture ID, packet SHA-256, and source signature.

Gzip level 6 uses a zero timestamp and a platform-neutral header. The descriptor retains the actual output hash. Storage savings depend on the original source; a smaller on-disk representation does not imply a proportional decrease in runtime memory.

## Dataset source-copy behavior

The maintained SF82 `copyDatasetSourceFiles` helper attempts a forced filesystem reflink for nonempty provenance members while preserving an exclusive destination. A supported reflink creates a separate native inode with copy-on-write storage. Unsupported filesystems use the original 64 KiB streamed copy.

Both paths validate the original descriptor, check the source's identity and stability, verify the actual copied content, retain a single-link destination, and synchronize the output. The descriptor list returned by the helper remains unchanged.

An optional observer records how the actual copy occurred:

~~~js
const observations = [];
const descriptors = await copyDatasetSourceFiles(
  originalPackage,
  retainedPackage,
  originalSourceManifest,
  { onCopy: value => observations.push(value) },
);
~~~

Each observation includes the member path, actual `method`, any unsupported-clone error code, verified bytes/hash, and source/destination inode and allocated-block observations. Filesystem allocated-block counts can count shared extents more than once; use them as per-file observations. The method reports whether the filesystem actually accepted a reflink.

## Original source operation observed on 2026-10-12

The native storage operation completed at 03:29:38 UTC using Node 24.19.0 and the complete original Grants.gov AI source capture:

| Property | Observed value |
| --- | --- |
| Capture | `GSC-161aa4d7c78274c0ef74682e96188d4b` |
| Original source coverage | 164 opportunities, 7 search pages, 164 detail records, 171 retained source files |
| Decoded file size | 9,696,131 bytes |
| Stored gzip size | 2,886,232 bytes |
| Logical bytes saved | 6,809,899 bytes, or 70.23% |
| Original packet SHA-256 | `a13daeb858075b52dcab708d49e9357c4e60dae6d0cc9b609e2d0e9e4c0c1ec3` |
| Original file SHA-256 | `922740dea9de519619b69a858720f8603d19e93ae20f0b0e315eb0d2992a674e` |
| Stored gzip SHA-256 | `0055fe5e53fa8c3e9c8bf0f0b841c957fb994f2e51e49120ae5df468f8b309ab` |
| Source signature | `436839aeb39144dc3b0ad617d7ecdf62e1e8699698fc798fd745b5f54e53f5df` |

The operation opened the compressed native merchant source, reconstructed byte-identical original capture data, reopened the same storage without a rewrite, read the original legacy JSON form, produced the same compressed member from those legacy bytes, and exercised the declared output limit with the same retained source.

The measured filesystem rejected a forced reflink with `ENOTSUP`. The original SF82 source-copy helper then copied the actual 2,886,232-byte compressed member through its streamed fallback at 03:36:02 UTC. The copied SHA-256 matched the original compressed descriptor, the destination had a distinct inode with one link, and the returned source descriptor remained unchanged. The observed storage reduction above comes from the actual gzip representation.

This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services.
