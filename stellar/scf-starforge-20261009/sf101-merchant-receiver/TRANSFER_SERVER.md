# SF101 paid-file transfer protocol

The existing merchant receiver can serve an approved file in one response or
continue a partial download. The route remains `GET /deliver/<order-reference>`
with the buyer's existing `Authorization: Bearer <claim-token>`. There is also a
`HEAD` request for the same route. Install the current `receiver.py` and
`access.py` together, then restart the existing receiver with its retained state,
webhook secret and reverse-proxy configuration.

The original health endpoint now includes:

```json
{"fileTransfer":"stellar-forge.sf101.byte-ranges.v1"}
```

That field identifies the running transfer implementation. It appears alongside
the existing service, status and access-controls fields.

## Authorization and byte identity

Every request reads the original order and current access policy in one SQLite
transaction. It requires the existing entitlement, claim token, enabled access
and unexpired deadline. A resumed request therefore observes a suspension,
expiry or token rotation performed after the previous request. Unavailable
entitlements and incorrect tokens return the original generic `404` before any
file metadata or range decision is exposed.

The receiver then opens the enrolled source as a private regular file. It checks
the path observation against the opened descriptor, refuses a final symlink,
and compares file identity, size, permissions and modification metadata before
and after reading. It hashes the whole file and copies its bytes into a private
temporary snapshot. Both the digest and size must equal the original enrolled
order before a successful transfer response begins. A changed or unavailable
source returns the original `503 MERCHANT_SOURCE_UNAVAILABLE`.

The snapshot uses at most 1 MiB of in-memory spool storage, plus small transfer
buffers; larger content spills to an anonymous temporary file in the original
private merchant state directory. The existing product size limit remains
1 byte through 32 MiB. Reads and writes use 64 KiB chunks. The snapshot is closed
when the request finishes or its connection fails. Provision temporary free
space for each concurrent large transfer under the existing merchant worker's
resource limits.

Response bytes come from that already verified snapshot. A source edit after
verification cannot change the current response. Later requests re-open and
verify the enrolled source. Downloads that passed authorization may finish while
an operator changes access; the next request applies the new access state.

## Response metadata

A successful full `GET` has status `200`. An authorized `HEAD` has the same full
file metadata and an empty body. Both include:

| Header | Meaning |
| --- | --- |
| `ETag: "sha256-<64 lowercase hex characters>"` | Strong validator for the exact enrolled file bytes. The digest is also in the original merchant handoff. |
| `Accept-Ranges: bytes` | This endpoint supports a single byte range on `GET`. |
| `Content-Length` | Full file size for a `200` or `HEAD`; selected range size for a `206`. |
| `Content-Type: application/octet-stream` | Original file bytes. |
| `Content-Disposition: attachment` | Download response. |
| `Cache-Control: private, no-store, no-transform` | Keep the customer response private and preserve its exact byte representation. |

The receiver applies no content encoding. Configure the existing HTTPS reverse
proxy to forward `Authorization`, `Range`, `If-Match` and `If-Range`, and preserve
the response status, `ETag`, `Content-Range`, `Content-Length` and bytes. Keep
authorization headers redacted in logs. The original loopback binding and
merchant HTTPS route remain the deployment path.

## Continue a partial transfer

For a locally retained prefix of `N` verified bytes, request:

```http
GET /deliver/approved-order-reference HTTP/1.1
Authorization: Bearer <existing-private-claim-token>
Range: bytes=N-
If-Match: "sha256-<original-approved-file-digest>"
If-Range: "sha256-<original-approved-file-digest>"
```

Replace `N` and the digest with the actual local checkpoint and original merchant
handoff values. The matching response has status `206` and:

```http
ETag: "sha256-<original-approved-file-digest>"
Content-Range: bytes N-LAST/TOTAL
Content-Length: REMAINING
```

`LAST` is `TOTAL - 1` and `REMAINING` is `TOTAL - N`. A client appends a suffix
only after checking status `206`, the exact validator, requested start, expected
end, total length and identity encoding. Before publishing the completed file,
it checks the combined byte count and SHA-256 against the original handoff.
The original buyer retrieval command owns the private checkpoint and final-file
publication; a resumed delivery request uses the existing entitlement.

The server also accepts `bytes=START-END` and `bytes=-SUFFIX_LENGTH`. Ranges are
inclusive, a missing or oversized end is clamped to the file's last byte, and a
suffix longer than the file selects its complete bytes in a `206` response.

| Request condition | Result after normal authorization and source checks |
| --- | --- |
| Satisfiable single byte range | `206` with exact `Content-Range` and selected bytes. |
| Start at or beyond the file size, or zero-length suffix | `416 BYTE_RANGE_NOT_SATISFIABLE`, `Content-Range: bytes */TOTAL` and a JSON error body. Its `Content-Length` describes that error body. |
| Malformed single byte range or repeated `Range` header | `400 INVALID_BYTE_RANGE`. |
| Unknown range unit or multiple ranges in one header | The range is ignored and the complete file is returned with `200`. Multipart responses are not emitted. |
| `Range` on `HEAD` | The range is ignored; full-file headers and an empty body. |
| `If-Match` without a matching strong tag | `412 FILE_PRECONDITION_FAILED`; no file bytes. A valid list and `*` are accepted. |
| Exact strong `If-Range` tag | Process the requested byte range. |
| Different, weak, repeated or date-form `If-Range` | Ignore the range and return the complete file with `200`. This endpoint has no date validator. |
| Matching `If-None-Match` tag or `*` | `304` with no body, after `If-Match` evaluation. Weak comparison applies to this condition. |

`If-Range` without a range is ignored. Authentication and source failures take
precedence over conditional responses. Error responses to `HEAD` also have empty
bodies. The range and conditional behavior follows
[RFC 9110 sections 9.3.2, 13.1 and 14](https://www.rfc-editor.org/rfc/rfc9110.html).

## Original embedding interfaces

`get_entitled_file(state, ref, token)` still returns the complete authorized
`bytes` or `None`, and `read_private_file(path)` still returns `(bytes, sha256)`.
These compatibility callers can allocate the full original 32 MiB limit.

The HTTP handler uses `get_entitled_snapshot(state, ref, token)`, which returns
`None` or a context-managed `VerifiedPrivateFile`. Its `stream`, `size`, `sha256`
and `etag` describe the exact verified snapshot. Close it with `with content:`
or `content.close()`. `snapshot_private_file(path, directory=state)` performs
the same private-file snapshot operation without establishing an entitlement;
it is used by enrollment and the existing operator `verify-file` command.

Existing order records, accepted event identities, recipient binding and access
history require no migration for byte-range delivery.
