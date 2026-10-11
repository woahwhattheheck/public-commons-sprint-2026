// MIT. Optional application validation before the original native payment lifecycle.
// This module does not interpret Bazaar examples as API request validation schemas.
export function validateAdmissionTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new TypeError('admissionTimeoutMs must be 1–60000');
  }
  return timeoutMs;
}

/**
 * Run trusted, side-effect-free application admission on an isolated request copy.
 * Return true to continue, false for a generic rejection, or a nonpayment 4xx
 * response. The resource adapter validates response status, headers and size.
 * A late result after timeout/disconnect never resumes the payment lifecycle.
 */
export async function evaluateAdmission(admit, request, { timeoutMs = 2000, signal } = {}) {
  if (typeof admit !== 'function') throw new TypeError('Admission callback required');
  validateAdmissionTimeout(timeoutMs);
  const controller = new AbortController();
  let timer, onAbort;
  try {
    const interruption = new Promise((_resolve, reject) => {
      onAbort = () => {
        controller.abort();
        reject(new Error('REQUEST_ADMISSION_UNAVAILABLE'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(onAbort, timeoutMs);
      if (signal?.aborted) onAbort();
    });
    const input = {
      method: request.method, url: new URL(request.url.href),
      query: structuredClone(request.query), body: structuredClone(request.body),
      ...(request.bodyPresent===undefined?{}:{bodyPresent:request.bodyPresent}),
      ...(request.bodyType===undefined?{}:{bodyType:request.bodyType}),
      ...(request.rawBody===undefined?{}:{rawBody:Uint8Array.from(request.rawBody)}),
      ...(request.multipart===undefined?{}:{multipart:structuredClone(request.multipart)}),
      pathParams: structuredClone(request.pathParams ?? {}),
      headers: structuredClone(request.headers), signal: controller.signal,
    };
    const answer = await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return admit(input);
      }),
      interruption,
    ]);
    controller.signal.throwIfAborted();
    return answer;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
