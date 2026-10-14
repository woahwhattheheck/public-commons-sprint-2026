# Receive complete attachments from an original Gmail raw message

Use this receiver when the connected mailbox's parsed attachment preview is incomplete, or when a receiving worker needs the exact ordinary source file behind a retained attachment. It consumes an already-authorized read and returns the original attachment bytes. The caller selects the original account, immutable message ID, exact filename, and independently retained complete byte count and SHA-256.

This is a shared intake component. Keep the existing application, source-bank installer, archive receiver, and work case. A MIME attachment is transport; after receipt, use the owning project's ordinary receive command.

## Connected runtime

Read the message with the available Gmail tool:

```js
const request = {
  link_id: originalAccountLinkId,
  message_id: originalMessageId,
  format: 'raw',
};
const result = await tools.mcp__codex_apps__gmail_read_email(request);
const message = result.structuredContent;
const selection = {
  read_request: {
    link_id: request.link_id,
    message_id: request.message_id,
  },
  filename: originalFilename,
  expected: { bytes: originalByteCount, sha256: originalSha256 },
};
const received = receiveGmailRawAttachment(message, selection);
// received.data is Uint8Array containing the complete attachment.
// Report received.attachment and received.source; keep data out of logs.
```

Load `host/connected_mime_attachment.cjs` with the existing CommonJS module loader, alongside `connected_zip.cjs` and `connected_sha256.cjs`. The API has no filesystem, network, mailbox mutation, or evaluation of received content.

The original account is the account used for that exact read. A mailbox message ID is not interchangeable between accounts. The receiver checks that the response ID equals the requested ID and retains the account label from the request; this is request provenance, not an independent identity attestation.

If only a filename is known, inspect the decoded raw message with `inspectMimeAttachments(rawBytes)`. Its attachment entries expose the original filename, media type, transfer encoding, and zero-based numeric `part_path`. Avoid printing `encoded_body`. Obtain the original size and digest from the existing sender/source record, then receive. Inspection does not turn a preview's size or hash into a complete-source identity.

Duplicate filenames are rejected unless the caller explicitly selects the exact original `part_path`, for example `[1, 0]`. An optional `media_type` checks the expected MIME type.

## Compressed complete-source carriers

When the original source is too large for the raw connector response, use the same receiver's complete-source carrier workflow in [CONNECTED_SOURCE_CARRIER.md](CONNECTED_SOURCE_CARRIER.md). The native command now includes `pack` and `unpack`; an explicit `source_carrier` descriptor in the original MIME selection restores an already-retained compressed attachment directly. Every original byte and both carrier/source identities are preserved. Ordinary raw attachment calls retain their original API and behavior.

## Native receiver

Save the original raw tool response as JSON, either its normalized `structuredContent` value or the untouched envelope containing that value. Save the selection above as a second JSON file. Both are internal files: the raw message can contain private headers and other attachments.

Run from the existing repository:

```sh
node host/connected_mime_attachment_native.cjs raw-response.json selection.json received-source.json
```

Choose the output path explicitly. The command never uses an email-supplied filename as a filesystem destination. It creates a new file with exclusive creation and private mode where supported, reads it back, flushes and closes it, and prints a compact JSON result with the complete attachment identity and output path. Repeating the command accepts an already-existing regular file only when its bytes are identical; a different file or symlink is rejected. The destination's parent directory must already exist.

The command uses Node's built-in filesystem and path modules plus the maintained MIME, complete-source carrier, gzip, byte codec and SHA modules. It installs no dependencies and calls no external service. Retain the returned file in the existing receiving workspace and continue the original installer/consumer. A write failure may leave an incomplete file; choose a fresh destination rather than overwriting it.

## Data and failure behavior

The implementation follows multipart framing and transfer decoding from [RFC 2046 §5.1](https://www.rfc-editor.org/rfc/rfc2046#section-5.1), [RFC 2045 §6.7–6.8](https://www.rfc-editor.org/rfc/rfc2045#section-6.7), and filename continuations from [RFC 2231](https://www.rfc-editor.org/rfc/rfc2231).

It handles nested multipart messages, folded headers, quoted parameters, base64, quoted-printable, 7bit/8bit/binary bodies, and RFC 2231 filename continuations in UTF-8, US-ASCII, or ISO-8859-1. Quoted-printable soft breaks and transport-added trailing line whitespace are decoded while escaped whitespace and original hard newline octets are preserved. Ordinary filenames are interpreted as UTF-8. A `message/rfc822` attachment is returned as an opaque original file.

Repeated critical headers/parameters, missing closing boundaries, interrupted filename continuations, unsupported encodings/charsets, ambiguous selections, and digest/size differences are explicit failures. Unsupported encoded-word filenames stay as literal header values; there is no guessed filename rewrite. A digest mismatch does not produce output bytes through the receiving API.

Default capacities are 64 MiB of decoded message, 64 KiB per MIME header section, 1,000 parts, and 32 levels of nesting. The caller can set positive integer `maxMessageBytes`, `maxHeaderBytes`, `maxParts`, and `maxDepth` in the selection when the authorized original requires more. The native input JSON allowance follows the selected message capacity plus 8 MiB of envelope overhead; its selection file is limited to 64 KiB.

If the provider read itself fails, use the same original attachment's existing complete alternate carrier or an equipped receiving worker. Do not transform a partial preview into a replacement source, rotate mailbox identities, or create a competing source controller.

## Focused operation during development

The module actually received two retained source attachments from their original raw Gmail responses: 276,415 bytes and 860,554 bytes. Each complete byte count and SHA-256 matched the independently retained source identity. The larger raw message was 1,163,884 bytes. A small authored nested multipart operation exercised UTF-8 continued filenames, quoted-printable soft/hard breaks and whitespace, with exact eight-byte output. Incomplete multipart closure, a continuation gap, and unescaped parameter quotes were rejected.

Keep actual mailbox payloads, account/message identifiers, private source, and customer data in their original private work cases. The public repository contains only the reusable receiver and guide.
