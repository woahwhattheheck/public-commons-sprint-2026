# Exact source through rich-text connectors

`v8_source_carrier_codec.cjs` supplies a standalone pure JavaScript factory for carrying complete UTF-8 source through connector text fields. It requires no Node runtime, filesystem, network, browser globals, or installed package. Node can also load it through its ordinary CommonJS interface.

A Canvas read changed ordinary spaces inside pasted JSON source strings into non-breaking spaces. An encoded carrier preserves the original source body even when a connector reformats surrounding rich text. The codec produces the existing `commons.artifact-base64/v1` gzip/base64 envelope accepted by the Eco source-bank materializer.

## Use

```js
const {createSourceCarrierCodec} = require("./v8_source_carrier_codec.cjs");
const codec = createSourceCarrierCodec();

const original = JSON.stringify(completeSourceBank);
const envelope = codec.encodeText(original, {
  decodedSchema: "commons.source-bank/v1"
});
const serializedEnvelope = JSON.stringify(envelope);

// Transfer serializedEnvelope through the existing authorized destination.
// After reading the complete envelope:
const recovered = codec.decodeText(JSON.parse(serializedEnvelope));
const bank = JSON.parse(recovered);
```

In a JavaScript isolate without module loading, load the reviewed complete factory source and use `createSourceCarrierCodec()`. The source only defines the factory and optionally exports it when a CommonJS module exists.

`identity(text)` returns the UTF-8 byte count and SHA-256. `encodeText` retains the complete original text, produces standard gzip using fixed-Huffman DEFLATE, and returns both compressed and uncompressed identities. The decoder also accepts stored and dynamic-Huffman DEFLATE blocks. It checks input shape, canonical Base64, compressed byte count/SHA, gzip CRC and uncompressed size, the original text SHA, and strict UTF-8 before returning the original text.

Unicode non-breaking spaces, ordinary spaces, BOMs, line endings and literal escape sequences are preserved. Invalid unpaired UTF-16 surrogates are rejected before encoding. The codec does not trim, reformat JSON, repair source text or execute the decoded source.

## Complete receiving

Save the original envelope and its own externally recorded byte identity with the operation. The envelope's `original_sha256` identifies the decoded text; `gzip_sha256` identifies the compressed payload. They are distinct from the serialized envelope's hash and from a Git blob ID.

An ordinary complete source-bank envelope can be received through the existing materializer:

```sh
python -B source_tools/materialize_source_banks.py \
  --bank /actual/complete-source-envelope.json \
  --bank-bytes ACTUAL_ENVELOPE_BYTES \
  --bank-sha256 ACTUAL_ENVELOPE_SHA256 \
  --operation ACTUAL_EXISTING_OPERATION \
  --output /actual/owned-source-stage
```

That receiver checks the complete bank and every original file. Continue its original application assembler and native operation afterward. The codec handles bytes; the existing receiver handles source selection, paths, current application composition and publication.

For a provider that cannot accept the whole envelope, retain the same original payload and use its supported multipart transport. Number the exact parts and retain their offsets, lengths and hashes; concatenate their original ASCII content in order before decoding. The existing Commons Artifact Transfer helper owns incremental filesystem receiving and interrupted-transfer continuation. Keep private source in its original authorized internal destination.

## Limits and recovery

The default original-text limit is 16 MiB; callers may choose a limit through 64 MiB. Decoding also has a separate compressed-input limit, defaulting to 32 MiB. The limit covers payload bytes; JavaScript arrays and strings use additional memory. Prefer the native streaming receiver for large artifacts when a functioning native runtime is available.

The decoder accepts one gzip member and rejects concatenated members or trailing data. The expected envelope identity should come from the retained original operation. A content hash verifies the selected bytes; it is not an authentication mechanism.

If a connector changes an existing plaintext source body, return to the exact original producer or retained artifact. A candidate recovery is usable only when its entire original byte count and hash match; do not treat visually similar text as the original source. Use an encoded carrier for its next transfer.

## Validation performed

The factory round-tripped empty text, ordinary text, non-breaking spaces, emoji, BOMs, CRLF, literal escape characters and a 240,000-byte repeated input. SHA-256 was checked against the standard `abc` value. Invalid Unicode and changed declared identities were rejected. A complete retained 532,998-byte source packet was independently decoded from its existing gzip carrier and matched its original SHA and complete text. No customer source is included in this reusable codec.


## Compose source into the current application

Use [Source bank receiving](SOURCE_BANK_RECEIVING.md) to apply complete source families to a fresh copy of an existing application, retain concurrent source changes through exact guarded edits, and continue the original native operation with its existing Workspace.
