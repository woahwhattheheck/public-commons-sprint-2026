# Archive codec throughput on the complete retained application source

The maintained `archive_codec.mjs` keeps its synchronous API and exact archive format. This update reduces the measured allocation and loop costs of the existing implementation.

## Actual workload and result

The source is the complete 570-file application map from commit `60d028318626c091a126ab8708f380021a7e257a`, received through the ordinary text companion published in PR4601. The original JSON is 13,485,181 bytes / SHA-256 `1827cecd39b28a11298ee085449ed884f3337f13cc33dcedd621fc54cf1db300`. Its fixed-Huffman gzip is 3,806,053 bytes / `b64241f89b4284e1156095fdd51b870d4e12b574daf1734e93e8e17f828decf2`.

Matched single executions in the same Functions V8 environment measured 35,434 ms for the original codec `95ce050082ae61a862d7a32ac9f37c92eaecee7b` and 26,795 ms for this implementation: **24.4% less stage time (1.32× throughput)**. These are local observations, not a cross-runtime performance guarantee.

| Stage | Original ms | Updated ms |
| --- | ---: | ---: |
| base64Decode | 507 | 500 |
| sha256_gzip | 3286 | 2271 |
| gunzip_including_crc | 4728 | 3878 |
| sha256_raw | 12068 | 7970 |
| utf8Decode | 1436 | 1440 |
| JSON_parse | 35 | 34 |
| utf8Encode | 1049 | 1385 |
| 570_member_encode_and_sha | 11841 | 8872 |
| base64Encode | 484 | 445 |
| Total measured stages | 35,434 | 26,795 |

The JSON parse is included; carrier retrieval, result serialization and the byte-by-byte equality loop are outside these individual stage timings. All 570 decoded source members match their declared byte counts and SHA-256 identities. Recompressing the entire original source took 9,400 ms and reproduced **every original gzip byte**.

## Implementation

- UTF-8 encoding checks surrogate validity and computes the exact output length before allocating one byte array. It avoids a boxed-number array for all source bytes. This workload's extra counting pass costs time; its reduced allocation is an intentional tradeoff.
- SHA-256 reads complete blocks directly from the input. Only the final 64 or 128 bytes are padded. State words stay in scalar variables; fixed rotations are inline, and block iteration no longer creates state/iterator arrays.
- CRC32 uses indexed byte access.
- Inflate reserves each LZ77 match once, then copies it sequentially so overlapping references retain their original meaning.
- A single gzip member returns its already independent decoded byte array without another full concatenation copy.

Base64, UTF-8 decoding, Huffman construction and fixed-Huffman compression are unchanged. Existing gzip framing, CRC32/ISIZE checks, member/output limits, strict Unicode behavior and SHA-256 results remain in place. No native dependency, new data format or asynchronous API is introduced.

The actual original corpus passed full digest/member verification and byte-for-byte recompression. Focused compatibility checks also cover standard SHA/CRC identities, SHA padding and nonzero-offset byte views, unpaired surrogates, overlapping-copy exact/exceeded output limits, invalid CRC/ISIZE, empty and concatenated members, member limits and a truncated trailer.

## Repeat on an existing Node host

Download the ordinary text companion from the immutable PR4601 path:

```text
https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/cab42490aebad48213f6c68923000eb7a203980a/operations/ecosystem-source12/receiving-full-dependency-20261013/application-source.text.json
```

Run the small profiling entry against that same carrier:

```sh
node opportunities/upstate_forever_2026/source_tools/archive_codec_profile.mjs \
  /absolute/application-source.text.json --gzip-check
```

To compare an exact retained previous codec, add `--codec /absolute/archive_codec_previous.mjs`. Both runs verify the original complete source and every member; `--gzip-check` additionally compares the full encoded output. The profile does not modify the source carrier or any Workspace and does not require a browser or network access after the carrier is present.

The ordinary source-bank/inspect/extract and existing source-envelope entry points continue using the maintained codec automatically. Existing scientific and customer inputs remain with their original receiving operations.


## Bounded compressor allocation — 15 October 2026

The earlier throughput measurements above remain historical results. This successor changes only `deflateRaw` inside the codec: its predecessor table is a 32,768-entry `Int32Array`, and compressed output is accumulated in 64 KiB `Uint8Array` chunks before one exact-sized return buffer. Hash heads remain 65,536 entries. The public API, 64-candidate search order, fixed Huffman symbols, gzip framing and all decoding/source validation remain unchanged.

[RFC 1951](https://www.rfc-editor.org/info/rfc1951/) limits backward match distances to 32 KiB. The ring preserves the original chain for every eligible candidate: a position `c` can be overwritten at `c + 32768`, which is at or after the current search position `p` whenever `p - c <= 32768`. Searching happens before inserting `p`. Thus the exact-distance edge remains eligible. Traversal checks the window before reading a candidate's link, so it never follows a reused out-of-window slot. Positions crossed by a match are still inserted in their original order.

### Complete paired observations

One execution of each implementation in the same Functions V8 environment used the complete deterministic authored inputs below. These are compression fixtures made from source-like UTF-8 text and, for the mixed case, pseudorandom bytes; they contain no customer data. The mixed input makes the first quarter of each 64 KiB block pseudorandom. Full gzip bytes were compared, then every recovered input byte was compared. The measurements are local observations rather than a universal speed guarantee.

| Input | Input bytes | Gzip bytes | Previous gzip ms | Current gzip ms | Current restore ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Compressible source text | 20,971,520 | 183,023 | 5,850 | 5,656 | 2,469 |
| Mixed source text/binary | 46,137,344 | 12,466,874 | 16,684 | 15,389 | 17,674 |

| Allocation model | 20 MiB input | 44 MiB input |
| --- | ---: | ---: |
| Previous hash heads plus predecessor table | 84,148,224 bytes | 184,811,520 bytes |
| Current hash heads plus predecessor ring | 393,216 bytes | 393,216 bytes |
| Current typed deflate output payload bound | 431,546 bytes | 24,999,248 bytes |

Table sizes follow directly from the array lengths. During final deflate consolidation, typed chunk payload plus returned output is less than `2 * deflateBytes + 65536`; small chunk-reference overhead is separate. The input, source strings, gzip framing copy, decoded output, caller-retained buffers and runtime garbage collection are outside this bound. These values are **not observed total process peaks**. No causal relationship to a host reset was established.

The exact retained predecessor is Git blob `e36e5ad678f0cc83edda8fa48e7e62de344a7404`, SHA-256 `466a77c5d96eb492bd8b9b86b7468abf2a8ea3f64e547cb20188a89d8bc0cf87`. The same input-sized model should not be attributed to an arbitrary alternative codec selected for comparison.

| Fixture | Input SHA-256 | Exact old/current gzip SHA-256 |
| --- | --- | --- |
| Compressible | `0a3746aab38bb875c401fa5142b0f1a2cd66a7693eeab2a5179082500f4478d2` | `706664e95011d4bd80f8517544649d10a525592820ca26531824fd0dcd67064a` |
| Mixed | `ab19a840963b6a179fa34681d55d7663350c9779d99130151da2d2a8481a34f2` | `c9deb8ec096576c303944cb210b2798a283550fa0301b9fd637b99436ba2d7c6` |

The focused boundary receiving also covered empty/one/two/three-byte inputs, a 70,000-byte overlap run and repeated sequences placed at distances 32,767, 32,768 and 32,769. All eight match the prior gzip exactly and fully restore. A complete three-file source bank (330,239 bytes, including Unicode and an exact large-decimal string) also reproduces the old gzip and reopens with every file unchanged. The unchanged profile's retained-source receiving mode remains available for the original complete application carrier.

### Reproduce using the existing profiling command

Save the exact predecessor module from commit `5559a29611fbd4b6c5a9b464b4f573c6678d9767` as a separate local module:

```text
https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/5559a29611fbd4b6c5a9b464b4f573c6678d9767/opportunities/upstate_forever_2026/source_tools/archive_codec.mjs
```

On an existing Node host:

```sh
node opportunities/upstate_forever_2026/source_tools/archive_codec_profile.mjs \
  --authored-compression compressible --reference-codec /absolute/archive_codec_previous.mjs

node opportunities/upstate_forever_2026/source_tools/archive_codec_profile.mjs \
  --authored-compression mixed --reference-codec /absolute/archive_codec_previous.mjs
```

The defaults generate the exact 20 MiB and 44 MiB fixtures above. Optional `--bytes N` selects a different size up to 128 MiB and is reported as that selected input. Optional `--codec` selects a complete current module. The Node command compares the whole previous/current gzip and restores with built-in `node:zlib`; the recorded V8 observations used the maintained pure decoder, not a claimed Node execution. Each complete compression/restore phase prints progress. The exported `profileAuthoredCompression` can use an explicit restore implementation in another host.

Source-bank consumers import the same maintained codec automatically. Pinned historical source packets remain unchanged; adopt this successor deliberately when composing a new source package. Release large derived buffers between independent receiving operations when they are no longer needed, retaining the complete original source through its existing durable transport.
