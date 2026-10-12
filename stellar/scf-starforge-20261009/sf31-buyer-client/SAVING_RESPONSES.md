# Save the delivered response

The buyer returns an HTTP `Response`. Use `response-file.mjs` to keep its body as
an operator-selected local file, including binary data and JSON datasets. The
writer streams bytes to disk and computes SHA-256 without parsing or reformatting
the content. It uses Node's standard library and requires Node 22+.

Prepare the output destination before invoking the existing buyer. Then keep the
original buyer result and receipt, and save that result's response once. The file
writer does not make HTTP requests, invoke a signer, retry an operation or update
the spend ledger.

## Compose with the existing operator flow

Choose an absolute output path in an existing directory controlled by the local
operator. Do not derive the destination from a seller's `Content-Disposition`,
URL or other supplied filename. Files are created with mode `0600`.
The parent directory must remain under the operator's control for the complete
operation, on a filesystem that supports hard links. Destination preparation
creates a local reservation and a private sibling partial file. This is a local
file reservation, separate from the buyer's payment reservation.
The ordinary preparation reserves filenames. Use the optional actual-descriptor
allocator below when the output also needs reserved storage. Permissions, I/O
errors, process termination and the separate payment journals retain their own
failure paths.

```js
import { prepareBuyerResponseFile } from './response-file.mjs';

// buyer and call are the operator's existing SF31 or SF81 objects.
// Keep their original stable intent ID, approval and signer configuration.
const output = await prepareBuyerResponseFile({
  destination: '/private/downloads/purchased-dataset.json',
  maxBytes: 64 * 1024 * 1024,
  timeoutMs: 30_000,
});
let result;
try {
  result = await buyer.call(call);
  // Preserve the original result/receipt in the existing operation record here.
  const saved = await output.save(result, { signal: call.signal });
  console.log(saved); // path, bytes, sha256, contentType, cleanupWarnings
} catch (error) {
  console.error({
    code: error.code,
    partialPath: error.partialPath,
    bytes: error.bytes,
    cleanupWarnings: error.cleanupWarnings,
    buyerStatus: result?.status,
  });
  // Do not invoke buyer.call again to recover a failed local save.
  throw error;
} finally {
  await output.abort(); // releases an unused destination; safe after completion
}
```

Start saving promptly when the original buyer returns. SF31's public transport
has its own deadline, including body consumption; the writer's timeout does not
extend it. Do not read or clone the original response while saving it.

### Allocate the actual output before purchase

Pass an operator-supplied `reserveFile` function to reserve storage on each live
descriptor the writer already owns. The same callback contract is used by the
native Node runtime for its private stdout and stderr files.

```js
const output = await prepareBuyerResponseFile({
  destination: '/private/downloads/purchased-dataset.json',
  maxBytes: 16 * 1024 * 1024,
  timeoutMs: 30_000,
  signal: call.signal,
  reserveFile, // the installed, reviewed destination-descriptor allocator
});
```

The callback receives `{fileHandle, path, kind, bytes, signal}`. It is awaited
during preparation, before the caller enters the buyer. For
`kind: 'buyer-response'`, `bytes` is the full configured `maxBytes`; for
`kind: 'buyer-response-reservation'`, it is the exact serialized local
reservation length. It must allocate the range `[0, bytes)` on the supplied
descriptor while preserving its identity, logical length, permissions and file
position. It must retain the caller's ownership of that descriptor. It must not
close it, rename it, write payload bytes, or substitute another file.

On Linux, a reviewed allocator can apply `fallocate(FALLOC_FL_KEEP_SIZE)` to an
inherited descriptor. Linux documents that this reserves the specified range
without increasing logical EOF; subsequent writes within the allocated range
do not fail for lack of disk space. See the
[Linux system-call manual](https://man.archlinux.org/man/fallocate.2.en).
The writer checks that the named file and held descriptor still refer to the
same inode/device, that the logical length and mode are unchanged, and that the
descriptor reports at least the requested allocated bytes.

The writer retains those same descriptors through saving or cancellation.
Unused allocation is truncated on that inode before synchronization and close;
an interrupted partial preserves its actual logical bytes. The returned writer
and successful saved record include `allocation` metadata describing the
reserved descriptors. Ordinary byte limits, SHA-256, stream framing, deadlines,
exclusive publication and cleanup rules still apply.

The allocator should honor the supplied preparation signal and finish any
in-progress native allocation before it rejects. A partial allocation or an
allocation failure closes and cleans this writer's files before preparation can
return. The callback must reserve the actual descriptors through the later
write; creating and releasing an unrelated probe does not provide that storage.

These reservations cover the response and its local filename reservation. The
native runtime and accounting modules must reserve their own result, evidence
and journal destinations through their original writers.

### With SF82 evidence recording

SF82 may perform independent RPC verification before returning. Start the file
write when its original buyer returns, so downloading and receipt verification
can proceed together. Disable SF82's optional cloned-body capture in this flow;
keep its original receipt/reservation recording and independent verification.

```js
// Prepare output as above, before executeWithEvidence can invoke the buyer.
let download;
const savingBuyer = {
  async call(options) {
    const result = await buyer.call(options); // the original buyer, exactly once
    // Handle rejection immediately while SF82 continues its independent work.
    download = output.save(result, { signal: options.signal }).then(
      saved => ({ saved }), error => ({ error }),
    );
    return result;
  },
};
try {
  const evidence = await executeWithEvidence({
    ...originalEvidenceOptions,
    buyer: savingBuyer,
    call,
    captureBody: false,
  });
  const delivery = download ? await download : null;
  // Retain both independently: evidence.error and delivery?.error are distinct.
  // A saved file never upgrades evidence.report or proves chain settlement.
  console.log({ evidencePath: evidence.evidencePath, delivery });
} finally {
  await output.abort();
}
```

The saved file and its digest do not replace SF82's record or change its report.

## Interrupted delivery

A completed destination is published only after the body ends and the file is
synced. An existing destination is never overwritten. A failure retains any
nonempty incomplete bytes under `error.partialPath`
(`.x402-response-<uuid>.partial`); `error.bytes` records their length. It does not
publish them as
the requested completed file. Keep the original buyer status, receipt and
reservation even when local saving fails.

An empty aborted destination is cleaned up. `cleanupWarnings` identifies any
owned temporary or reservation path that could not be removed. A successfully
published file stays a successful save even if this housekeeping fails. After a
process crash, a stale local reservation may remain: stop or identify the owner
process, inspect its partial file and original operation record, then remove
only the abandoned local reservation manually. Never remove an active writer's
reservation or interpret its absence as permission to repeat a purchase.
The reservation is `.<destination filename>.x402-download.lock` in the same
directory; its JSON records `destination`, `partialPath` and the local `pid`.

Check the partial file and the original operation record before choosing any
recovery action. The writer cannot resume the HTTP stream after it has failed.
Calling the buyer again may cause another paid operation; changing the intent ID
does not recover the previous purchase. Use the existing ledger and independent
transaction reconciliation for payment recovery.

Only successful HTTP responses (2xx) are saved. A successful HTTP response with
an unknown payment outcome can still contain useful data; saving it preserves
that existing unknown outcome. The default byte limit is 64 MiB and the default
stream deadline is 30 seconds, starting when `save` begins. Local filesystem
operations must complete before the writer can close its file. `signal` cancels
the local download; it does not reverse a payment or release a reservation.
`abort()` waits for an active save to stop; its outstanding `save()` promise
reports any partial-file details. If atomic publication finishes while an abort
arrives, successful save metadata still identifies the completed local file.

The writer's byte count and SHA-256 describe bytes exposed by the HTTP response
stream. Fetch may decode transport compression. They do not attest to the
seller's advertised content, chain settlement or usefulness of the result.
