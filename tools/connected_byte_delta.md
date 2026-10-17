# Complete-file delta transport

`connected_byte_delta.mjs` reduces transfers when a receiving worker already retains the exact prior complete file. It works in connected JavaScript and native JavaScript runtimes without a filesystem, network access or Node packages.

## Use

Supply a SHA256 function returning lowercase hexadecimal, a base64 encoder and a base64 decoder. Each accepts or returns Uint8Array as appropriate. The repository's existing `createArchiveCodec()` provides this interface.

```js
import { createByteDeltaCodec } from './connected_byte_delta.mjs';

const transport = createByteDeltaCodec(archiveCodec);
const packet = transport.encode(previousCompleteBytes, currentCompleteBytes);
// Serialize packet as JSON and transfer it through the authorized source channel.
const current = transport.decode(retainedPreviousBytes, packet);
// Save current as the complete ordinary file at the existing destination.
```

The packet binds the original and current file with their byte lengths and SHA256. It contains original-byte copy ranges and new literal bytes, or a full base64 payload when that is smaller. Decoding rejects an incorrect original, invalid ranges, ambiguous operations, missing bytes, output beyond the declared limit and an incorrect final identity.

A recipient must retain or recover the identified original before applying the packet. The packet is a transport representation. Preserve the reconstructed complete current artifact and its existing delivery identity. Compress or split the JSON using the normal approved transport after encoding.

## Limits and cost

The default maximum input/output is128MiB. Options allow `maxBytes`, `blockBytes` (default64), `maxCandidates` (default8), and `maxSegments` (default1,000,000). A larger block such as256 reduces index memory for large files at the cost of slightly larger patches. Copy matching is byte-exact even when hash candidates collide.

The encoder compares complete serialized packet sizes and falls back to a full payload when a delta would be larger. Exactness does not depend on finding the best possible match.

## Operated receiving checks

Three actual complete source/archive revisions reconstructed byte-for-byte:

| Current complete file | Serialized packet | Transfer mode |
| --- | ---: | --- |
| 1,266,157-byte JSON source | 1,433 bytes |19 segments |
| 1,097,744-byte JSON source |819 bytes |9 segments |
| 1,371,630-byte ZIP archive |1,554,493 bytes |171 segments |

The ZIP measurement includes base64 and JSON overhead; compare it with a full base64 JSON transfer rather than the bare ZIP. Both large JSON transfers shrink by more than99.8% while retaining the entire reconstructed file.

Empty, short, unchanged, Unicode-insertion and unrelated binary inputs also reconstructed exactly. Incorrect originals, out-of-bounds copies, altered target identities and mixed copy/literal operations were rejected. The operated customer/source bytes stay in their original private custody.
