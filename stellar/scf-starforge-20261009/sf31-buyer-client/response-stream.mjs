// MIT — Incremental framing for one original HTTP response. No requests or retries.
const LIMIT = 64 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class BuyerResponseStreamError extends Error {
  constructor(code) { super(code); this.name = 'BuyerResponseStreamError'; this.code = code; }
}
const need = (condition, code) => { if (!condition) throw new BuyerResponseStreamError(code); };

/** Pure configuration validation, suitable before the original paid request. */
export function normalizeResponseStream(value) {
  need(object(value) && Object.keys(value).every(key =>
    ['format', 'maxRecordBytes', 'maxRecords'].includes(key)), 'BAD_RESPONSE_STREAM_OPTIONS');
  const { format, maxRecordBytes = 1048576, maxRecords = 100000 } = value;
  need(['sse', 'ndjson'].includes(format), 'BAD_RESPONSE_STREAM_FORMAT');
  need(Number.isSafeInteger(maxRecordBytes) && maxRecordBytes > 0 && maxRecordBytes <= LIMIT,
    'BAD_RESPONSE_STREAM_RECORD_LIMIT');
  need(Number.isSafeInteger(maxRecords) && maxRecords > 0 && maxRecords <= 1000000,
    'BAD_RESPONSE_STREAM_COUNT_LIMIT');
  return Object.freeze({ format, maxRecordBytes, maxRecords });
}

export function responseStreamContentType(format, value) {
  if (typeof value !== 'string') return false;
  const [type, ...parameters] = value.toLowerCase().split(';').map(part => part.trim());
  const charsets = parameters.filter(part => /^charset\s*=/.test(part));
  if (charsets.length > 1 || charsets.some(part =>
    !/^charset\s*=\s*(?:utf-8|utf8|"utf-8"|"utf8")$/.test(part))) return false;
  return format === 'sse' ? type === 'text/event-stream' : format === 'ndjson' &&
    ['application/x-ndjson', 'application/ndjson'].includes(type);
}

/**
 * Byte-preserving framing. Every returned record belongs to bytes already
 * supplied to push(). SSE follows the standard CR/LF, comment, data, event, id
 * and retry rules; EOF never dispatches an unfinished event. NDJSON requires
 * a newline after each JSON value and ignores empty/whitespace-only lines.
 * UTF-8 is fatal; limits apply to the complete wire record, including framing.
 */
export function createResponseStreamParser(options) {
  const config = normalizeResponseStream(options);
  const { format, maxRecordBytes, maxRecords } = config;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let lineBuffer = Buffer.allocUnsafe(Math.min(4096, maxRecordBytes));
  let lineBytes = 0, recordBytes = 0, lastRecordBytes = 0, totalBytes = 0;
  let records = 0, emptyLines = 0, complete = false, ended = false, failed = null;
  let firstLine = true, skipLF = false, lastCompleteByte = 0;
  let data = [], dataPresent = false, event = '', lastEventId = '', retryMilliseconds = null;
  const pending = () => lineBytes > 0 || (format === 'sse' && dataPresent);
  const summary = () => Object.freeze({ format, records, bytes: totalBytes,
    complete, pendingRecord: pending(), lastCompleteByte,
    ...(format === 'sse' ? { lastEventId, retryMilliseconds } : { emptyLines }),
    ...(failed ? { error: failed } : {}) });
  function error(code) {
    failed = code;
    const result = new BuyerResponseStreamError(code);
    result.stream = summary();
    throw result;
  }
  function append(piece) {
    if (piece.length === 0) return;
    if (piece.length > maxRecordBytes - recordBytes) error('RESPONSE_STREAM_RECORD_TOO_LARGE');
    const size = lineBytes + piece.length;
    if (size > lineBuffer.length) {
      const next = Buffer.allocUnsafe(Math.min(maxRecordBytes, Math.max(size, lineBuffer.length * 2)));
      lineBuffer.copy(next, 0, 0, lineBytes); lineBuffer = next;
    }
    lineBuffer.set(piece, lineBytes); lineBytes = size; recordBytes += piece.length;
  }
  function record(value, output) {
    if (records >= maxRecords) error('RESPONSE_STREAM_TOO_MANY_RECORDS');
    records++;
    output.push(Object.freeze({ index: records - 1, ...value }));
  }
  function line(output) {
    let text;
    try { text = decoder.decode(lineBuffer.subarray(0, lineBytes)); }
    catch { error('RESPONSE_STREAM_UTF8_INVALID'); }
    lineBytes = 0;
    if (firstLine) { firstLine = false; if (text.startsWith('\ufeff')) text = text.slice(1); }
    if (format === 'ndjson') {
      if (text.endsWith('\r')) text = text.slice(0, -1);
      if (text.includes('\r')) error('RESPONSE_STREAM_JSON_INVALID');
      if (text.trim().length === 0) emptyLines++;
      else {
        let value;
        try { value = JSON.parse(text); } catch { error('RESPONSE_STREAM_JSON_INVALID'); }
        record({ format, value }, output);
      }
      recordBytes = 0; lastCompleteByte = totalBytes;
      return;
    }
    if (text === '') {
      if (dataPresent) record({ format, event: event || 'message', data: data.join('\n'),
        id: lastEventId, ...(retryMilliseconds === null ? {} : { retry: retryMilliseconds }) }, output);
      else emptyLines++;
      data = []; dataPresent = false; event = ''; lastRecordBytes = recordBytes;
      recordBytes = 0; lastCompleteByte = totalBytes;
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') { data.push(value); dataPresent = true; }
    else if (field === 'event') event = value;
    else if (field === 'id' && !value.includes('\0')) lastEventId = value;
    else if (field === 'retry' && /^[0-9]+$/.test(value) && Number.isSafeInteger(Number(value)))
      retryMilliseconds = Number(value);
  }
  function push(value) {
    need(!ended && failed === null, 'RESPONSE_STREAM_PARSER_CLOSED');
    need(value instanceof Uint8Array, 'RESPONSE_STREAM_BAD_CHUNK');
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength), output = [];
    let start = 0;
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (skipLF) {
        skipLF = false;
        if (byte === 10) { totalBytes++; start = i + 1;
          if (recordBytes === 0) {
            if (++lastRecordBytes > maxRecordBytes) error('RESPONSE_STREAM_RECORD_TOO_LARGE');
            lastCompleteByte = totalBytes;
          }
          else { if (++recordBytes > maxRecordBytes) error('RESPONSE_STREAM_RECORD_TOO_LARGE'); }
          continue;
        }
      }
      if (byte !== 10 && (format !== 'sse' || byte !== 13)) continue;
      append(bytes.subarray(start, i));
      totalBytes += i - start + 1;
      if (++recordBytes > maxRecordBytes) error('RESPONSE_STREAM_RECORD_TOO_LARGE');
      line(output);
      skipLF = format === 'sse' && byte === 13;
      start = i + 1;
    }
    append(bytes.subarray(start)); totalBytes += bytes.length - start;
    return output;
  }
  function finish() {
    need(!ended && failed === null, 'RESPONSE_STREAM_PARSER_CLOSED');
    ended = true;
    // Validate even the undispatched tail. Do not emit it as a completed record.
    if (lineBytes) {
      try { decoder.decode(lineBuffer.subarray(0, lineBytes)); }
      catch { error('RESPONSE_STREAM_UTF8_INVALID'); }
    }
    complete = !pending();
    return [];
  }
  return Object.freeze({ push, finish, summary, options: config });
}

/** Decode retained bytes or one live body with normal async-iterator backpressure. */
export async function* parseResponseStream(chunks, { signal, ...options }) {
  need(signal === undefined || signal instanceof AbortSignal, 'BAD_RESPONSE_STREAM_SIGNAL');
  const parser = createResponseStreamParser(options);
  for await (const chunk of chunks) {
    need(!signal?.aborted, 'RESPONSE_STREAM_ABORTED');
    yield* parser.push(chunk);
  }
  need(!signal?.aborted, 'RESPONSE_STREAM_ABORTED');
  yield* parser.finish();
  if (!parser.summary().complete) {
    const error = new BuyerResponseStreamError('RESPONSE_STREAM_INCOMPLETE_RECORD');
    error.stream = parser.summary();
    throw error;
  }
}
