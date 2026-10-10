// MIT. Absolute deadline for original x402 v2 POST request-body acquisition.
// Reading a request is admission work: a slow client must not occupy a shared
// facilitator frontdoor slot indefinitely before upstream timeout starts.
export class BodyReadError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/** Returns the exact original bytes, rejecting and terminating incomplete bodies. */
export async function boundedBodyBytes(req, maxBytes, timeoutMs) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError('Invalid inbound body limits');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new BodyReadError(413, 'BODY_TOO_LARGE');
  let timer;
  const read = (async () => {
    const chunks = [];
    let total = 0;
    for await (const part of req) {
      total += part.byteLength;
      if (total > maxBytes) throw new BodyReadError(413, 'BODY_TOO_LARGE');
      chunks.push(part);
    }
    if (!total) throw new BodyReadError(400, 'EMPTY_BODY');
    return Buffer.concat(chunks, total);
  })();
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // Fail the admitted read first, then tear down its untrusted socket.
      // This also settles the outstanding async iterator. Since the socket
      // is closed, no 408 response can be delivered to that slow client.
      reject(new BodyReadError(408, 'REQUEST_BODY_TIMEOUT'));
      req.destroy();
    }, timeoutMs);
    timer.unref?.();
  });
  try { return await Promise.race([read, deadline]); }
  finally { clearTimeout(timer); }
}
