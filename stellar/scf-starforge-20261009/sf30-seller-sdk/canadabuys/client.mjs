/** Browser and Node client for the original CanadaBuys operator HTTP service. */
export class CanadaBuysClientError extends Error {
  constructor(message, { code = 'CanadaBuys_REQUEST_FAILED', status = null, details = null } = {}) {
    super(message);
    this.name = 'CanadaBuysClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class CanadaBuysClient {
  constructor(baseUrl, { fetch: fetchImplementation = globalThis.fetch, headers = {}, timeoutMs = 30000, maxResponseBytes = 256 * 1024 * 1024 } = {}) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Use an HTTP(S) operator URL without embedded credentials.');
    if (typeof fetchImplementation !== 'function') throw new TypeError('A fetch implementation is required.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) throw new TypeError('Use positive integer timeout and response limits.');
    this.baseUrl = url.origin;
    this.fetch = fetchImplementation;
    this.headers = { ...headers };
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
  }

  async request(path, { method = 'GET', body, signal, raw = false, binary = false, onChunk, timeoutMs = this.timeoutMs } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('Use a positive integer request timeout.');
    if (onChunk !== undefined && (typeof onChunk !== 'function' || (!raw && !binary))) throw new TypeError('A download sink requires raw or binary response mode.');
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl || url.username || url.password) throw new TypeError('Requests must target the configured operator origin.');
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('CanadaBuys request timed out')), timeoutMs);
    try {
      const response = await this.fetch(url, {
        method, signal: controller.signal, redirect: 'error', credentials: 'same-origin',
        headers: { accept: raw || binary ? '*/*' : 'application/json', ...this.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const expectedLength = response.headers.get('content-length');
      if (expectedLength !== null && Number(expectedLength) > this.maxResponseBytes) {
        await response.body?.cancel();
        throw new CanadaBuysClientError('Response exceeds the configured client limit.', { code: 'RESPONSE_TOO_LARGE', status: response.status });
      }
      const reader = response.body?.getReader();
      const streaming = response.ok && typeof onChunk === 'function';
      const binaryResponse = binary && response.ok;
      const decoder = binaryResponse ? null : new TextDecoder('utf-8', { fatal: true });
      const chunks = [], textParts = [];
      let bytes = 0;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > this.maxResponseBytes) {
              throw new CanadaBuysClientError('Response exceeds the configured client limit.', { code: 'RESPONSE_TOO_LARGE', status: response.status });
            }
            if (streaming) {
              if (decoder) decoder.decode(value, { stream: true });
              // Await the caller's durable write before reading another chunk.
              await onChunk(value);
            } else if (binaryResponse) chunks.push(value);
            else textParts.push(decoder.decode(value, { stream: true }));
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        } finally { reader.releaseLock(); }
      }
      if (streaming) {
        if (decoder) decoder.decode();
        return {
          mime: response.headers.get('content-type') ?? 'application/octet-stream',
          filename: response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? null,
          bytes
        };
      }
      if (binaryResponse) {
        const joined = new Uint8Array(bytes);
        let position = 0;
        for (const chunk of chunks) { joined.set(chunk, position); position += chunk.byteLength; }
        chunks.length = 0;
        return {
          mime: response.headers.get('content-type') ?? 'application/octet-stream',
          filename: response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? null,
          body: joined, bytes
        };
      }
      textParts.push(decoder.decode());
      const bodyText = textParts.join('');
      textParts.length = 0;
      // A successful raw download is retained as text. Parsing its JSON media
      // type would allocate a second complete report that the caller never uses.
      if (raw && response.ok) return { mime: response.headers.get('content-type') ?? 'application/octet-stream',
        filename: response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? null, body: bodyText, bytes };
      let value;
      const json = response.headers.get('content-type')?.includes('json');
      if (json && bodyText) {
        try { value = JSON.parse(bodyText); }
        catch { throw new CanadaBuysClientError('Operator returned invalid JSON.', { code: 'INVALID_RESPONSE', status: response.status }); }
      }
      if (!response.ok) {
        const error = value?.error;
        throw new CanadaBuysClientError(error?.message ?? value?.message ?? 'CanadaBuys request returned HTTP ' + response.status, {
          code: error?.code ?? (typeof error === 'string' ? error : 'CanadaBuys_REQUEST_FAILED'),
          status: response.status, details: error?.details ?? null,
        });
      }
      if (!json || !bodyText) throw new CanadaBuysClientError('Expected an operator JSON response.', { code: 'INVALID_RESPONSE', status: response.status });
      return value;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  bidderIntakeEvidence(intake, options = {}) { return this.request('/api/bidder/evidence-intake', { ...options, method: 'POST', body: intake }); }
  bidderStatus(options) { return this.request('/api/bidder/status', options); }
  bidderList(kind, { noticeId, offset = 0, limit = 100, ...options } = {}) {
    const query = new URLSearchParams({ offset, limit });
    if (noticeId !== undefined) query.set('noticeId', noticeId);
    return this.request('/api/bidder/records/' + encodeURIComponent(kind) + '?' + query, options);
  }
  bidderRecord(kind, id, { revision, history = false, ...options } = {}) {
    const query = new URLSearchParams({ history });
    if (revision !== undefined) query.set('revision', revision);
    return this.request('/api/bidder/records/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id) + '?' + query, options);
  }
  bidderCreate(kind, record, expectedRevision, options = {}) {
    return this.request('/api/bidder/records/' + encodeURIComponent(kind), { ...options, method: 'POST', body: { ...record, expectedRevision } });
  }
  bidderUpdate(kind, id, record, options = {}) {
    return this.request('/api/bidder/records/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id), { ...options, method: 'PATCH', body: record });
  }
  bidderFit(profileId, { profileRevision, noticeIds = [], now, ...options } = {}) {
    return this.request('/api/bidder/fit', { ...options, method: 'POST', body: { profileId, profileRevision, noticeIds, now } });
  }
  bidderAssess(selection, options = {}) { return this.request('/api/bidder/assess', { ...options, method: 'POST', body: selection }); }
  bidderComparison(id, options) { return this.request('/api/bidder/decisions/' + encodeURIComponent(id) + '/compare', options); }
  bidderReport(id, { revision, format = 'html', ...options } = {}) {
    const query = new URLSearchParams({ format });
    if (revision !== undefined) query.set('revision', revision);
    return this.request('/api/bidder/decisions/' + encodeURIComponent(id) + '/report?' + query, { ...options, raw: true });
  }
  bidderEvidence(id, { revision, ...options } = {}) {
    const query = new URLSearchParams();
    if (revision !== undefined) query.set('revision', revision);
    return this.request('/api/bidder/evidence/' + encodeURIComponent(id) + '/file?' + query, { ...options, binary: true });
  }
  workspace(options) { return this.request('/api/workspace', options); }
  notice(id, options) { return this.request('/api/notices/' + encodeURIComponent(id), options); }
  workshare(id, options) { return this.request('/api/workshares/' + encodeURIComponent(id), options); }
  entry(id, options) { return this.request('/api/entries/' + encodeURIComponent(id), options); }
  source(id, options) { return this.request('/api/sources/' + encodeURIComponent(id), options); }
  captureRecord(id, options) { return this.request('/api/captures/' + encodeURIComponent(id), options); }
  receiving(packageId, options) { return this.request('/api/receiving/' + encodeURIComponent(packageId), options); }
  compare(before, after, options) {
    return this.request('/api/compare?' + new URLSearchParams({ before, after }), options);
  }
  importCsv(rawText, { stream, label, url, retrievedAt, expectedRevision, expectedSha256, response, coverage, bodyKind, derivation, derivationSha256, ...options } = {}) {
    return this.request('/api/import', { ...options, method: 'POST', body: { rawText, stream, label, url, retrievedAt, expectedRevision, expectedSha256, response, coverage, bodyKind, derivation, derivationSha256 } });
  }
  createWorkshare(workshare, expectedRevision, options = {}) {
    return this.request('/api/workshares', { ...options, method: 'POST', body: { ...workshare, expectedRevision } });
  }
  updateWorkshare(id, workshare, options = {}) {
    return this.request('/api/workshares/' + encodeURIComponent(id), { ...options, method: 'PATCH', body: workshare });
  }
  qualify(profile, options = {}) { return this.request('/api/qualify', { ...options, method: 'POST', body: { profile } }); }
  capture(selection, options = {}) { return this.request('/api/capture', { timeoutMs: Math.max(this.timeoutMs, 195000), ...options, method: 'POST', body: selection }); }
  updateReview(noticeId, review, options = {}) {
    return this.request('/api/notices/' + encodeURIComponent(noticeId) + '/review', { ...options, method: 'PATCH', body: review });
  }
  report({ format = 'json', scope = 'all', noticeIds = [], ...options } = {}) {
    const query = new URLSearchParams({ format, scope });
    for (const noticeId of noticeIds) query.append('noticeId', noticeId);
    return this.request('/api/export?' + query, { ...options, raw: true });
  }
  reportTo(onChunk, { format = 'json', scope = 'all', noticeIds = [], ...options } = {}) {
    if (typeof onChunk !== 'function') throw new TypeError('Supply a report chunk consumer.');
    const query = new URLSearchParams({ format, scope });
    for (const noticeId of noticeIds) query.append('noticeId', noticeId);
    return this.request('/api/export?' + query, { ...options, raw: true, binary: false, onChunk });
  }
  exportPackage({ scope = 'all', noticeIds = [], ...options } = {}) {
    const query = new URLSearchParams({ scope });
    for (const id of noticeIds) query.append('noticeId', id);
    return this.request('/api/package?' + query, options);
  }
  receivePackage(pkg, expectedRevision, options = {}) {
    return this.request('/api/receive', { ...options, method: 'POST', body: { package: pkg, expectedRevision } });
  }
}
