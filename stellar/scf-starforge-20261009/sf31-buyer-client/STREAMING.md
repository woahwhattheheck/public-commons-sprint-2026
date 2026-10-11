# Finite SSE and NDJSON purchases

Use the original buyer request and response-file writer to consume a finite event
stream. The writer saves the exact response bytes while the shared parser delivers
complete records. A successful save has the same `path`, `bytes`, `sha256`,
`contentType` and `cleanupWarnings` fields as an ordinary saved response, plus a
`stream` summary. The original payment result and accounting continuation remain
attached to the same request.

## Select the payment flow explicitly

An omitted `expect.paymentFlow` selects `authorization`. Use
`expect.paymentFlow: 'upfront'` only for the matching offered requirement when
settlement before generation is the intended purchase. The native signer compares
that selection, its independent operator configuration, and the complete original
accepted terms. The merchant's response format alone cannot select the payment flow.

For an authorization stream, the original seller finishes generation before native
settlement and transfer. For an upfront stream, the native supported flow settles
before live generation. The buyer always makes its original unsigned request and
at most one signed request. Event IDs and `retry` fields never cause a reconnect.

## Capture and consume the same bytes

Prepare output before invoking the buyer. `client`, `approve`, `sign`, and `expect`
below are the application's existing native buyer, approval, signer and selected
merchant terms. `destination` is a new absolute filename in a trusted directory.

```js
import { prepareBuyerResponseFile } from './response-file.mjs';

const output = await prepareBuyerResponseFile({
  destination,
  maxBytes: 64 * 1024 * 1024,
  timeoutMs: 120000,
  stream: { format: 'sse', maxRecordBytes: 1024 * 1024, maxRecords: 100000 },
});

try {
  const result = await client.call({
    url, method: 'POST', body, headers: { 'content-type': 'application/json' },
    expect, approve, sign, intentId, signal,
  });
  const saved = await output.save(result, {
    signal,
    async onRecord(record) {
      // Called after the corresponding raw bytes have been written.
      // Awaiting this callback provides application backpressure.
      await renderProgress(record.event, record.data, record.id);
    },
  });
  await retainPurchase({ result, saved });
} finally {
  await output.abort();
}
```

For NDJSON use `format: 'ndjson'`. Its callback receives
`{ index, format: 'ndjson', value }`. SSE callbacks receive
`{ index, format: 'sse', event, data, id, retry? }`. Indices start at zero. `retry`
retains a valid server instruction as metadata; this capture never acts on it.
The callback is optional. Its failure or stalled promise is governed by the same
capture deadline, cancellation and partial-file handling as the original response.
Progress callbacks precede the final file hash and completion checks; retain the
successful save receipt before treating a whole response as complete.
An arriving chunk can contain several complete records. Cancellation from one
callback retains all bytes already written, so reopening may expose additional
complete records from that same chunk. Use the recorded indices when continuing
application processing.

## Use the original native operator

The same options are accepted in `operator.json`:

```json
{
  "responseFile": {
    "destination": "/absolute/private/operator/events.sse",
    "maxBytes": 67108864,
    "timeoutMs": 120000,
    "stream": { "format": "sse", "maxRecordBytes": 1048576, "maxRecords": 100000 }
  }
}
```

Merge this field into the existing complete operator configuration and keep
`captureBody` absent or `false`. The original review prints the selected output
configuration. The original execute path starts capture as soon as the buyer
returns the response, while its existing accounting observation continues. Native
streaming transport uses the selected capture duration when `requestTimeoutMs`
is omitted, with a maximum of 300000 ms. A top-level `requestTimeoutMs` selects
the complete HTTP exchange deadline explicitly, including DNS, TLS, response
headers and body consumption. `responseFile.timeoutMs` starts when capture begins.
Each limit is independent, and the first one reached ends the transfer.

The private result is still `responseFile.status: 'SAVED'` on complete delivery.
Its additional summary includes `format`, `records`, parsed `bytes`, `complete`,
`pendingRecord`, and `lastCompleteByte`; SSE also carries `lastEventId` and the
last valid `retryMilliseconds`. Stream options are local capture limits and do not
change the accepted price or spending reservation.

The maintained [Node application reader](../sf88-operator-buyer-cli/node/STREAMS.md)
opens these same retained bytes through `events()` and `ndjson()`.

## Framing and completion

| Property | SSE | NDJSON |
| --- | --- | --- |
| Media type | `text/event-stream` | `application/x-ndjson` or `application/ndjson` |
| Encoding | UTF-8; invalid bytes fail | UTF-8; invalid bytes fail |
| Record delimiter | Blank line; LF, CRLF and lone CR accepted | LF; an immediately preceding CR is accepted |
| Data | Consecutive `data` fields join with LF | One JSON value per nonempty line |
| Metadata | Standard `event`, persistent `id`, numeric `retry`; comments and unknown fields ignored | Empty and whitespace-only lines ignored |
| End of body | An unfinished event stays undispatched | A final JSON value without LF stays undispatched |

One initial UTF-8 BOM is removed. SSE fields split at their first colon, and only
one optional leading space is removed from the field value. A NUL in an `id`
field causes that field to be ignored. `[DONE]` has no special parser meaning; an
application may interpret it as ordinary event data.
An explicit charset must be UTF-8/utf8 and occur at most once in the content type.

`maxRecordBytes` bounds wire bytes in one pending framed record. `maxRecords`
bounds dispatched records. The separate original `maxBytes` limit bounds the
whole saved response. A body ending with an unfinished event or NDJSON line
returns `RESPONSE_STREAM_INCOMPLETE_RECORD` and retains the partial capture.
Normal connection closure completes only the HTTP capture; any application-level
end marker belongs to that application's own contract.

The framing follows [WHATWG's event-stream parsing rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream)
and the [NDJSON serialization/parsing specification](https://github.com/ndjson/ndjson-spec#3-functional-specification).
This finite acquisition applies fatal UTF-8 validation and an explicit incomplete
tail result in addition to the standard field dispatch rules.

## Continue after an interruption

On a stopped, failed, malformed or over-limit stream, the existing response-file
error still contains its original `bytes`, `partialPath` and `cleanupWarnings`.
Streaming adds `partialSha256`, the digest of exactly those written bytes, and
`stream.lastCompleteByte`, the end of the last complete frame. The original SF88
summary retains these fields alongside its existing payment and accounting result.
The final destination is published only after complete capture and its configured
integrity checks succeed.

Node's explicit `events({ allowPartial: true })` and
`ndjson({ allowPartial: true })` inspect the recorded complete prefix after
verifying the retained partial-file hash. They reopen the same operation and do
not start a request. Use the existing native financial continuation for the
original payment outcome and the merchant's own recovery procedure for additional
delivery; reopening the local stream does not change either operation.

The pure shared parser exports `createResponseStreamParser(options)` with
`push(Uint8Array)`, `finish()` and `summary()` for hosts already consuming raw
bytes. `parseResponseStream(asyncIterable, options)` provides a backpressured
async iterator with the same strict completion result.
