# Carry and restore a complete original source file

A large ordinary source attachment can exceed a connector's response capacity even when the underlying mailbox retains the whole file. This workflow compresses the complete original UTF-8 file before it reaches that response boundary. It extends the existing MIME receiver and uses the maintained gzip, byte codec and SHA-256 modules.

The carrier is an ordinary JSON file using the existing `commons.complete-source-gzip/v1` schema. Its gzip member contains the original file bytes, including the original JSON formatting, number spelling, byte-order mark and final newline. Source JSON is never parsed and reserialized. The carrier contains no project-specific installer, sender, network call or executable bootstrap. Use the original project's installer after restoring the file.

## Prepare the ordinary carrier in the existing native workspace

Node's standard library and the maintained host files are sufficient:

```sh
node host/connected_mime_attachment_native.cjs pack complete-source.json complete-source-gzip.json complete-source-selection.json
```

This reads the whole original source, validates UTF-8 without constructing another full source string, creates a deterministic gzip member, restores it through the same receiver, and writes two new files:

- `complete-source-gzip.json`: the complete compressed carrier.
- `complete-source-selection.json`: the original filename, complete source and carrier byte counts and SHA-256 identities, and selected receiving capacities.

Both files use exclusive creation. A repeat accepts an already-existing regular file only when its complete bytes match. Neither file is replaced by a different version. Keep both files with the existing project and send/save them using its already-authorized ordinary transport. Save the returned identities in that same work record before handing off.

The default carrier capacity is 2 MiB. A carrier crosses a raw-mail response through additional MIME and connector base64 framing, so the appropriate limit depends on the actual connector. This default is a practical starting value, not a universal provider limit. If an existing authorized route supports a larger carrier, select its actual capacity explicitly as the final pack argument:

```sh
node host/connected_mime_attachment_native.cjs pack complete-source.json complete-source-gzip.json complete-source-selection.json 4194304
```

The complete original source limit is 64 MiB. Incompressible source may still exceed the chosen carrier capacity. The command reports the actual required carrier length before writing output; retain the complete source and use an existing suitable ordinary-file route. It never drops files, truncates content or substitutes a summary.

## Restore from an ordinary carrier

Retain the sender's selection independently of the carrier and run:

```sh
node host/connected_mime_attachment_native.cjs unpack complete-source-gzip.json complete-source-selection.json restored-source.json
```

The output path is explicitly chosen by the receiver. The embedded original filename is checked as identity metadata and is never used as a filesystem destination. The command verifies the complete carrier, gzip and restored source identities; checks gzip member headers, boundaries, CRC and declared lengths; validates original UTF-8; writes the new file; flushes it; closes it; and reads its complete bytes back.

The command prints only compact identity/output information. It does not print source bodies. Continue the existing application's original receive/install command with `restored-source.json`.

All output parent directories must already exist. An interrupted write can leave its original incomplete destination; a later attempt rejects that different file instead of overwriting it. Preserve that path and choose a fresh output. A complete identical output is an ordinary successful repeat. If packing stopped after the carrier but before the selection, repeat the same command: the identical carrier is reused and the missing selection is written.

## Restore directly through the original Gmail RAW intake

The old three-argument raw-message command is unchanged. Add `source_carrier` to its original selection to restore a compressed source in the same operation:

```json
{
  "read_request": {
    "link_id": "the-original-authorized-account-link",
    "message_id": "the-original-message-id"
  },
  "filename": "complete-source-gzip.json",
  "expected": {
    "bytes": 351464,
    "sha256": "the-independently-retained-carrier-sha256"
  },
  "source_carrier": {
    "filename": "complete-source.json",
    "bytes": 4868458,
    "sha256": "the-independently-retained-original-sha256"
  },
  "maxCarrierBytes": 2097152,
  "maxSourceBytes": 67108864
}
```

The illustrative lengths above are not identities for another file. Copy the actual complete carrier and source descriptors from its original selection. Keep the existing numeric `part_path` when duplicate attachment filenames require explicit selection.

```sh
node host/connected_mime_attachment_native.cjs raw-response.json mime-selection.json restored-source.json
```

The receiver accepts the normalized raw message, its `structuredContent` envelope, or a connector envelope containing exactly one complete JSON text item. It first performs the existing original account/message/filename/MIME selection. Only the explicitly selected `source_carrier` path then decompresses. Ordinary attachments use the original behavior. Output retains both the actual MIME attachment identity and the recovered original file identity.

In connected JavaScript:

```js
const received = receiveGmailSourceCarrier(actualRawMessage, mimeSelection);
// received.data: complete original source bytes
// received.attachment: retained compressed MIME attachment
// received.original: original filename, bytes and SHA-256
// received.carrier: carrier/gzip identities and original gzip member boundaries
```

Load `connected_mime_attachment.cjs`, `connected_source_carrier.cjs`, `connected_gzip.cjs`, `connected_zip.cjs` and `connected_sha256.cjs` through the existing CommonJS loader. Ordinary MIME-only calls load no gzip dependency.

## Connected preparation and ordinary carrier receipt

```js
const packed = packSourceCarrier(originalBytes, {filename: originalFilename});
// Save packed.data as the complete ordinary carrier.
// Retain packed.selection separately with the original work record.
const restored = receiveSourceCarrier(packed.data, packed.selection);
// restored.data has the exact original byte identity.
```

Both APIs accept `maxSourceBytes` and `maxCarrierBytes` options. No function fetches, publishes, executes or installs source. SHA-256 detects a change relative to the caller's independently retained identities; a digest supplied solely by the same untrusted file does not establish authorship or authority.

The receiver accepts the existing carrier schema directly. Ordinary valid concatenated gzip members restore to one original byte stream, with each member checked separately. An incomplete member, changed gzip/source identity, trailing non-member data, invalid UTF-8, changed filename or capacity overflow rejects before output publication.

## Focused operation

The maintained source was exercised against an existing complete original carrier: its 346,675-byte attachment restored the exact 4,868,458-byte original file through the original Gmail RAW selector. Packing those original bytes produced a 351,464-byte carrier and recovered the unchanged source SHA-256. The original private bytes and mailbox references remain in their existing work case.

Targeted operation covers changed/truncated gzip, complete concatenated members, UTF-8 boundaries and the original CLI paths with explicit filesystem adapters. Connected execution and adapter behavior are separate from native filesystem execution on a receiving host. No hosted workflow or additional service is required.
