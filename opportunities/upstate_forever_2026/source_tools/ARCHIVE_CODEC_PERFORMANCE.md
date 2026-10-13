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
