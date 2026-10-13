# Transfer complete gzip/Base64 source packets in JavaScript

This companion to the existing large-artifact transfer helper compresses and recovers a complete UTF-8 JSON packet when the calling runtime has no Node, atob, TextDecoder or DecompressionStream. Use normal provider downloads and native compression when they are available.

The existing operation owns the provider receipt, complete source manifest, numbered part selection and destination. This helper returns data and never evaluates received source. A specialized CredentialRequest or assemble_result response continues through its own adapter.

## APIs

`createGzipJsonPacket({text, sha256Bytes, compression = "fixed"})` accepts the exact already-authored JSON text. It validates JSON without reserializing it, encodes UTF-8, computes the whole-source SHA-256, and returns:

```js
{encoding: "gzip+base64", base64, decodedBytes, compressedBytes, sha256}
```

The caller retains those fields in the original artifact manifest and uses the existing part writer. JSON whitespace, key order and final newline remain part of the original bytes.

`recoverGzipJsonPacket({base64, expectedBytes, expectedSha256, sha256Bytes})` returns:

```js
{packet, text, bytes, compressedBytes, decodedBytes, sha256}
```

- `base64` is the complete declared source block, or its actual numbered parts joined in order.
- `expectedBytes` is the original decoded byte count, from 0 through 16 MiB.
- `expectedSha256` is the original lowercase whole-source SHA-256.
- `sha256Bytes` is the receiver's existing synchronous hash function, adapted to return the lowercase digest string.

Additional codec exports are `encodeBase64`, `decodeBase64`, `gzipFixed`, `gzipAdaptive`, `gunzipExact` and `decodeUtf8`. Existing receivers that already own the manifest and JSON steps can use these directly. The native-compatible transfer APIs below use the existing manifest and part schemas.

## Complete packet use

```js
import {
  createGzipJsonPacket,
  recoverGzipJsonPacket
} from "./gzip_source_packet.mjs";

const sha256Bytes = bytes => existingHashes.sha256Bytes(bytes).sha256;

// Use the complete original JSON text, including its final newline.
const outbound = createGzipJsonPacket({
  text: originalSourceJson,
  sha256Bytes
});

// Retain outbound's size/digest with the original operation and source identity.
// Transfer outbound.base64 through the existing numbered-part helper.

const received = recoverGzipJsonPacket({
  base64: selectedOriginalParts.join(""),
  expectedBytes: originalManifest.decodedBytes,
  expectedSha256: originalManifest.sha256,
  sha256Bytes
});

// Continue through the known package schema and the original destination writer.
const packet = received.packet;
```

When the existing hash function already returns the digest string, pass it directly. In an isolate without ES module imports, include these maintained function declarations using the same mechanism as its existing utilities. Received JSON remains data; validate its declared package schema and source paths before passing files to the original materializer.

## Compression and byte recovery

The encoder uses a deterministic gzip header, fixed-Huffman DEFLATE, a 32 KiB LZ77 window and up to 128 match candidates. It is a small dependency-free encoder, not an optimal gzip compressor. It accepts exact UTF-8 text or bytes and returns a Uint8Array. This fixed encoder and the default packet output remain byte-compatible. Explicit `compression: "adaptive"` also produces a deterministic dynamic-Huffman candidate and uses whichever complete gzip member is shorter. The decoded source bytes and digest are unchanged; compressed bytes, transfer ID and part boundaries belong to the selected original edition. Retain that selected compressed file for continuation instead of recompressing it after a library upgrade.

The decoder accepts one RFC 1952 gzip member with stored, fixed-Huffman or dynamic-Huffman RFC 1951 blocks. It checks the gzip header and optional header CRC, manifest-bound output allocation, stored lengths, Huffman symbol/distance bounds, member boundary, CRC32 and declared size. The wrapper then checks the original whole-source SHA-256 before JSON parsing. The strict UTF-8 decoder rejects malformed sequences.

The Base64 decoder permits surrounding/interstitial whitespace introduced by a source carrier, while rejecting bad alphabet, misplaced padding and noncanonical unused padding bits. Preserve encoded characters and actual part order. It does not guess a source from an arbitrary code fence.

The wrapper's 16 MiB decoded limit keeps its allocation explicit. Larger artifacts should use the existing streamed/native transfer and part-assembly helpers. Concatenated gzip members, ZIP archives and files inside an archive remain the responsibility of those maintained adapters.

## Existing full-source acceptance

The original decoder recovered a complete 414,331-byte JSON packet from 77,559 native gzip bytes and preserved all 19 files. A second receiving session independently recovered the same complete source. Its original source and private operation remain in their approved case.

The combined encoder/decoder then compressed that same original 414,331-byte packet to 91,148 bytes and recovered every original UTF-8 byte, including the same complete 19-file map. This is a 78.0% byte reduction. Different valid gzip encoders can produce different compressed bytes for the same verified source.

A separate actual 95,784-byte integration packet compressed to 26,791 bytes, a 72.0% reduction. Its full source round-tripped before publication and again from the provider-returned Base64 section. These existing source operations are the acceptance examples; no additional fixture suite or customer payload is included with this generic helper.


## Prepare the existing native file transfer directly from JavaScript

Use these APIs when complete source bytes already exist in the JavaScript isolate and the selected original destination accepts the maintained Python receiver's envelopes. A working binary file service remains the first choice. This avoids inventing another Canvas chunk format or starting a process merely to split the source.

| API | Result |
| --- | --- |
| `createFileTransfer({bytes, maxRequestBytes, rawChunkLimit?, sha256Bytes})` | Original manifest, its exact JSON, and functions for selected original parts and receiver continuation. |
| `reopenFileTransfer({bytes, manifest, sha256Bytes})` | The same transfer from retained exact bytes and the original manifest. |
| `recoverFileTransfer({manifest, parts, sha256Bytes})` | Complete original bytes and verified native manifest after provider readback. |
| `createGzipJsonTransfer({text, sha256Bytes, maxRequestBytes, rawChunkLimit?, compression?})` | Existing gzip packet metadata plus a native-compatible file transfer of its exact compressed bytes. |
| `recoverGzipJsonTransfer({packet, manifest, parts, sha256Bytes})` | Complete original JSON/text/bytes through the existing decoder. |

The file manifest is the existing `commons.file-transfer.v1`; each part is the existing `commons.file-part.v1` with exactly the original eight fields. The Python receiver, part indexes, source offsets, digest names and zero-byte behavior are unchanged. The caller owns network publication, the actual response, destination and application. These APIs do not upload, create a journal or run the application.

The planner uses the original Python helper's conservative metadata calculation, including its 20-digit bound. `maxRequestBytes` measures the complete canonical part JSON, including Base64 and all metadata. Deduct any provider's outer request, markup or framing allowance before supplying the budget. The minimum is 512 bytes; at most 100,000 parts are planned. `rawChunkLimit` can further constrain the original raw fragment size. Every emitted part is measured against the original budget.

~~~javascript
const prepared = createGzipJsonTransfer({
  text: completeOriginalJson,
  sha256Bytes,
  maxRequestBytes: selectedPartJsonBudget,
  compression: "adaptive"
});

// Retain these complete values in the existing operation before publication.
const sourceMetadata = prepared.packet;
const manifest = prepared.transfer.manifest;
const manifestJson = prepared.transfer.manifestText;

// The original connector or native stdin writer consumes this complete JSON.
const firstPartJson = prepared.transfer.partText(0);
~~~

`prepared.packet.sha256` describes the original decoded JSON. `manifest.sha256` describes the exact compressed file; its `transfer_id` is `sha256-` followed by that compressed-file digest. Preserve both identities.

For an already-published gzip member, use `createFileTransfer` with those exact compressed bytes. Do not recompress a saved source merely to fit this API. Other complete binary files can use the file-transfer APIs without gzip or JSON decoding.

The transfer retains a private byte copy. Changing the caller's original Uint8Array cannot change a later part. `manifest` is frozen. `part(index)` returns an ordinary envelope object; `partText(index)` returns canonical compact JSON with the same sorted ASCII field names as the original Python writer. Select only the needed part without printing the whole artifact.

## Reopen the original transfer and continue its actual saved prefix

Retain the original manifest and exact compressed source bytes through existing source custody. Those reconstruct every original part deterministically:

~~~javascript
const transfer = reopenFileTransfer({
  bytes: originalCompressedBytes,
  manifest: originalManifest,
  sha256Bytes
});
~~~

This verifies the whole original file and preserves its selected chunk size and request budget. Pass the saved manifest object or `manifest.json` text; do not substitute the native split command's surrounding status report.

Start or reopen the original durable receiver with its actual selected paths:

~~~bash
python scripts/transfer_parts.py receive /source/manifest.json \
  --directory /persistent/operation/source-transfer \
  --output /persistent/operation/original-source.json.gz --stdio
~~~

Keep this process inside the existing source-stream/native-session owner. Feed the original manifest through its existing source route before starting the command. Its first response describes the actual retained prefix:

~~~javascript
const continuation = transfer.resume(actualReceiverStatus, {
  directory: originalReceivingDirectory,
  path: originalDestination
});

if (continuation.next_part_index !== null) {
  const frame = transfer.partText(continuation.next_part_index);
  // Send frame + newline through the original native input binding.
} else if (continuation.finish_required) {
  // Send {"command":"finish"} through the same receiver.
} else {
  // The original destination is restored. Continue the original application.
}
~~~

Use the actual `receive`, `status` or `finish` response, which includes `prefix_sha256`. An individual `accept` acknowledgement intentionally has no full-prefix hash; it is not an input to `resume`. Continue an acknowledged part through the original writer. After a lost reply, short write, process loss or uncertain publication, request actual `status` and resume from that verified response.

The helper checks original transfer ID, full size/digest, native state, destination fields, prefix byte count/hash and both next-part fields. A partial saved suffix selects the original containing part. Re-sending that original part allows the unchanged receiver to compare overlap and write only the missing suffix. Do not truncate a saved prefix or advance from an old acknowledgement.

Supply the selected original `directory` and `path` when reconnecting. If omitted, the result retains the actual response's paths but does not establish a previously selected filesystem destination. Only these two optional binding keys are accepted, so a misspelled argument cannot silently change the comparison.

A full prefix with `state: "receiving"` still requires `finish`; it has not been published to the destination. A full `restored` response reopens the completed result. The helper never sends a receiver command automatically. The Python receiver retains its filesystem lock, fsync, no-overwrite publication and recovery between publication and removal of its partial name.

## Recover complete provider-returned source

Read the original provider's complete manifest and parts. `recoverFileTransfer` accepts part objects or complete JSON strings and restores declared index order. It rejects duplicate/missing indexes, unexpected fields, repeated JSON keys, changed identities/offsets/sizes, noncanonical Base64, bad part digests, over-budget messages and a changed whole-file digest.

~~~javascript
const received = recoverGzipJsonTransfer({
  packet: originalSourceMetadata,
  manifest: originalFileManifest,
  parts: completeProviderReturnedParts,
  sha256Bytes
});

const completeSource = received.text;
const originalDocument = received.packet;
// Continue through the original application-specific importer.
~~~

Parts may arrive in provider read order; original indexes select assembly. Include each original part once. If pagination repeats a previously retained provider message, reconcile that message in the existing provider reader before passing source bodies.

The compressed file is allocated only after every supplied part verifies its complete bytes. Gzip recovery then checks its original 16 MiB decoded bound, member boundary, CRC, decoded length, source SHA-256 and UTF-8 before JSON parsing. It does not select source from unrelated code fences.

Native `finish` publishes the exact compressed file. Continue through the existing source decoder/materializer with the retained decoded length/SHA before running the application. Transport and original product completion remain distinct steps in the same operation.

## Complete-source operation results

The maintained APIs operated on a complete 32-file programme: 1,557,230 decoded bytes and its original 364,936-byte gzip member. A 52,000-byte envelope budget produced ten original-protocol parts; the largest complete JSON was 51,933 bytes. Full part readback recovered the identical compressed member and decoded source. A retained 116,382-byte prefix selected its correct original containing part; a full prefix preserved the separate finish step.

On another complete 418,286-byte application source, the old/default packet stayed byte-identical. Explicit adaptive compression reduced its fixed-encoder member from 135,424 to 117,481 bytes, and the unchanged original decoder recovered every source byte. These were executions of the maintained JavaScript on actual source packets. The full Python receiver supplied the compatibility contract; this does not describe an unperformed native filesystem invocation.


## Maintained integration

Place the JavaScript companion beside the existing `scripts/transfer_parts.py` in the actual `commons-transfer-large-artifacts` skill source, using the current publisher's resolved directory. Add the small usage link to that skill's transfer guidance. Commons tool-result guidance may link to this byte-recovery helper after selecting the documented original payload; it should not duplicate the codec.

The helper does not change authorization, source ownership, operation IDs or destination selection. Publication uses the existing skill publisher and portable plugin/catalog pipeline.

## Format references

- RFC 1951, DEFLATE: https://www.rfc-editor.org/rfc/rfc1951.html
- RFC 1952, gzip: https://www.rfc-editor.org/rfc/rfc1952.html
