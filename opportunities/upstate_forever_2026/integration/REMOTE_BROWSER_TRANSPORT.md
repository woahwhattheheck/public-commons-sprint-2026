# Browser uploads over the original HTTPS operator

The existing operator API uses `operatorFetch` only when its current capability is the edge login marker `eco-edge-session`. Local native sessions keep the identical original fetch call and options. The asset is served by the existing extension registry; no extra browser controller, model queue or scientific action is introduced.

## Integration

Apply the two exact `app.mjs` joins from this source bank to the actual current application: add the `operatorFetch` import and replace only the existing API fetch expression. Retain every current application change around those anchors. Transfer the complete module, `operator/extensions/remote-transport.json`, this guide and `integration/component_fragments/remote-browser-transport.json` together. The descriptor admits the module through the existing static-asset registry; the fragment retains all three feature members in the ordinary component closure.

The secure edge login writes `sessionStorage['upstate-operator-capability']='eco-edge-session'`. All transport control requests use the existing same-origin HttpOnly secure session cookie. Native bearer authorization is omitted from the staged request metadata and ordinary edge request; the original native connector supplies native authorization locally.

## Original request and byte contract

For an original File/Blob POST to `/api/upload`, the browser retains the original path/query, method, content type, encoded X-Upload-Filename and X-Workspace. It creates:

- `POST /_eco/v1/requests`: JSON `{id,method,path,headers,body_bytes}`.
- `PUT /_eco/v1/requests/<id>/input?offset=N`: at most 1,048,576 original bytes, with lowercase hexadecimal `X-Chunk-SHA256`.
- `POST /_eco/v1/requests/<id>/seal`: JSON `{body_bytes}`.
- `GET /_eco/v1/requests/<id>/result`: the original native HTTP status, headers and raw response body.

Each chunk is accepted only when its acknowledgement agrees on request ID, offset plus exact length, bytes and SHA-256. A lost acknowledgement retries the exact same chunk and offset. An INPUT_PENDING response reads the original request status before retrying that same chunk. A repeated manifest or seal retains its original identity; neither repeats a native upload.

The browser reads at most one file chunk at a time. Before creating the manifest it computes a bounded-memory fingerprint from the exact metadata and ordered chunk SHA-256 values. That fingerprint is an internal resume identity, not the original file's SHA-256. The session journal stores only fingerprint-to-request ID and creation time, without original bytes or credentials. A newly selected File with the same name but different contents therefore cannot reuse another upload. A browser reload or retry of the same exact content finds the same pending request and replays identical chunks from offset zero so every duplicate is checked against durable metadata. After the original response body is fully read, the journal is removed. Interruption, cancellation and uncertain native outcomes retain it.

## Ordinary API calls and cancellation

Ordinary remote API calls carry a generated `X-Eco-Request-ID`. They are sent once. If the original fetch loses its response, the browser requests the same ID's result; it does not send a replacement mutation. This preserves the original TaskRequest operation and native queue.

Only a response carrying `X-Eco-Pending: 1` is treated as a pending edge result. An ordinary native HTTP 202 with no such header is returned intact to the existing task handling. `X-Eco-Uncertain: 1` reports the original request reference for reconciliation and never resubmits it. Temporary control failures retry with backoff; after repeated connection failures the same upload reference remains available for the original selected file. Automatic redirects are rejected so credentials stay on the chosen canonical origin.

The caller's AbortSignal reaches every fetch, chunk boundary, digest boundary, result read and backoff. Cancelling browser receipt does not pretend to cancel an already accepted native task. Existing native task cancellation remains the original product operation.

## Source exercise and actual receiving

The source-level transport exercise used the actual retained Gura receiving ZIP, 2,928,829 bytes, SHA-256 `0b15da478cd31c0a148f60a1288b23c8dd729671b64c93b0301c1bc384b3c61f`. A simulated edge dropped the first chunk acknowledgement after retaining its bytes and dropped the first seal response. All three original chunks reassembled byte-exactly, with four input calls, one manifest ID and one native execution. A pending edge 202 followed by the real native 202 preserved the native response and headers. A separate lost ordinary mutation response performed one POST and one same-ID result read. The original local fetch options and AbortError behavior were also exercised directly.

The equipped native receiving course should now open the same current application over its actual canonical HTTPS address, upload an original workbook and an original archive larger than the provider's individual request allowance, and continue their existing native review/import operation. Interrupt one chunk response and resume the same selected file, checking the original upload/task identity and source bytes. Operate the same original source and saved worksheet at desktop and narrow widths, use its real downloads, and reopen its original saved state. This is the end-to-end receiving course for the original app, edge and connector together.

## Browser primitives

The implementation uses standard Blob slices and WebCrypto SHA-256 with AbortSignal-aware fetch:

- https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
- https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
