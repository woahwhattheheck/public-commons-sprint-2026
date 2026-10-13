# Stream complete CanadaBuys reports to a caller-owned destination

`CanadaBuysClient.reportTo(onChunk, options)` downloads the same complete HTTP report as `report(options)`, delivering original UTF-8 bytes to an awaited callback. Options retain the existing format, scope, noticeIds, timeoutMs and AbortSignal. It resolves to {mime, filename, bytes}; the body remains in the destination. The existing buffered report() API is unchanged.

Each callback receives one Uint8Array. Consume it before resolving, and do not mutate it. The client awaits the callback before reading the next response chunk, keeping destination backpressure. Do not collect chunks if the purpose is a bounded-memory download. A rejected callback cancels the response reader and rejects the operation. Text remains strict UTF-8, including incomplete sequences at the end; invalid text, response-size limits, timeout and transport failures reject the operation. HTTP error responses are decoded using the original status/code/details contract and are never written to the successful download sink. The callback may already have received partial successful data when a later error occurs.

Use a private temporary destination and commit it only after reportTo resolves. The original OPERATING_API.mjs demonstrates this with an exclusive sibling file, handling partial writes, an incremental SHA256 digest, a final count comparison, fsync and atomic rename. On failure it closes and removes the temporary file and keeps any previous complete destination. Each complete report is checkpointed before the next format.

```js
// Supply a dedicated Web WritableStream (available in browsers and Node).
// Its default writer returns a promise that carries destination backpressure.
const writer = writableStream.getWriter();
try {
  const response = await client.reportTo(
    chunk => writer.write(chunk),
    {format: 'json', scope: 'all', signal}
  );
  await writer.close();
  // Retain response.mime, response.filename and response.bytes with the output.
} catch (error) {
  await writer.abort(error).catch(() => {});
  throw error;
} finally {
  writer.releaseLock();
}
```

For a Node file destination, use the complete partial-write loop in `retainReport` above. A Node `stream.Writable.write()` returns a boolean; its callback/drain/error contract must be adapted before it can be used as an awaited `ResponseSink`.

This removes the download-side complete decoded string and secondary Buffer from the saved-customer report course. Server report construction retains its existing complete native model and output contract. Existing source, package, qualification, workshare, receiving and merchant operations are unchanged. Source validation keeps the full original CSV identity, then releases its temporary response objects after the exact bytes are saved.

The same saved 908-notice original customer receives this continuation. Its earlier operation identified the raw-report allocation through actual native execution; its original workshare and receiving identities persist through resume.
