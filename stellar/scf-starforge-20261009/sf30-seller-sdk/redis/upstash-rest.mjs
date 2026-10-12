// MIT. Upstash's native Redis REST transport, retaining binary RESP2 values.
export class RedisHttpError extends Error {
  constructor(code, retryAfter) {
    super(code); this.name = 'RedisHttpError'; this.code = code;
    if (typeof retryAfter === 'string' && retryAfter.length <= 128 &&
        !/[\r\n]/.test(retryAfter) && (/^\d+$/.test(retryAfter) || Number.isFinite(Date.parse(retryAfter))))
      this.retryAfter = retryAfter;
  }
}
const invalid = () => new RedisHttpError('QUERY_RESULT_INVALID');
export function validateUpstashEndpoint(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > 1024 ||
      value !== value.trim() || /[\x00-\x20\x7f]/.test(value)) throw new TypeError('REDIS_HTTP_ENDPOINT_INVALID');
  let url; try { url = new URL(value); } catch { throw new TypeError('REDIS_HTTP_ENDPOINT_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.upstash\.io$/i.test(url.hostname))
    throw new TypeError('REDIS_HTTP_ENDPOINT_INVALID');
  return url.origin;
}
function providerError(message, status, retryAfter) {
  let code = 'QUERY_UNAVAILABLE';
  if (status === 401 || status === 403 || /NOPERM|NOAUTH|WRONGPASS/i.test(message)) code = 'SOURCE_ACCESS_DENIED';
  else if (/SF30_RESULT_TOO_LARGE/.test(message)) code = 'QUERY_RESULT_TOO_LARGE';
  else if (/WRONGTYPE/.test(message)) code = 'QUERY_SOURCE_TYPE_CHANGED';
  else if (/unknown command.*EVAL_RO|EVAL_RO.*not supported/i.test(message)) code = 'SOURCE_REQUIRES_READONLY_SCRIPTING';
  else if (/max (?:daily )?requests limit exceeded|quota exceeded|command limit exceeded/i.test(message)) code = 'SOURCE_QUOTA_EXCEEDED';
  else if (status === 429) code = 'SOURCE_RATE_LIMITED';
  return new RedisHttpError(code, retryAfter);
}
function decodeResp2(bytes) {
  let offset = 0, nodes = 0;
  function line() {
    const end = bytes.indexOf('\r\n', offset);
    if (end < 0 || end - offset > 4096) throw invalid();
    const value = bytes.subarray(offset, end); offset = end + 2; return value;
  }
  function integer(value) {
    const text = value.toString('latin1');
    if (!/^-?(?:0|[1-9]\d*)$/.test(text)) throw invalid();
    const number = Number(text);
    if (!Number.isSafeInteger(number)) throw invalid();
    return number;
  }
  function parse(depth) {
    if (depth > 12 || ++nodes > 100000 || offset >= bytes.length) throw invalid();
    const type = bytes[offset++];
    if (type === 43) return line(); // Simple string; retain the original bytes.
    if (type === 45) throw providerError(line().toString('utf8'), 400);
    if (type === 58) return integer(line());
    if (type === 36) {
      const length = integer(line());
      if (length === -1) return null;
      if (length < 0 || length > bytes.length - offset - 2 ||
          bytes[offset + length] !== 13 || bytes[offset + length + 1] !== 10) throw invalid();
      const value = bytes.subarray(offset, offset + length); offset += length + 2; return value;
    }
    if (type === 42) {
      const length = integer(line());
      if (length === -1) return null;
      if (length < 0 || length > 100000 - nodes || length > Math.floor((bytes.length - offset) / 3)) throw invalid();
      const values = [];
      for (let i = 0; i < length; i++) values.push(parse(depth + 1));
      return values;
    }
    throw invalid();
  }
  const result = parse(0);
  if (offset !== bytes.length) throw invalid();
  return result;
}
async function readResponse(response, maximum) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(maximum))
    throw new RedisHttpError('QUERY_RESULT_TOO_LARGE');
  if (!response.body) throw invalid();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new RedisHttpError('QUERY_RESULT_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
export function createUpstashRestClient({ endpoint, token } = {}) {
  endpoint = validateUpstashEndpoint(endpoint);
  if (typeof token !== 'string' || token.length < 1 || token.length > 16384 || /[^\x21-\x7e]/.test(token))
    throw new TypeError('REDIS_HTTP_TOKEN_INVALID');
  const requests = new Set(); let open = false, closed = false;
  const client = {
    get isOpen() { return open && !closed; },
    get isReady() { return open && !closed; },
    async connect() {
      if (closed) throw new RedisHttpError('SOURCE_CLOSED');
      open = true; return client;
    },
    destroy() {
      closed = true; open = false;
      for (const controller of requests) controller.abort();
      requests.clear();
    },
    async sendCommand(command, { maxResponseBytes = 4096 } = {}) {
      if (!client.isOpen) throw new RedisHttpError('SOURCE_CLOSED');
      if (!Array.isArray(command) || command[0] !== 'EVAL_RO' ||
          command.some(value => typeof value !== 'string' || !value.isWellFormed()))
        throw new TypeError('REDIS_HTTP_REQUIRES_READONLY_COMMAND');
      if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 4194304)
        throw new TypeError('REDIS_HTTP_RESPONSE_LIMIT_INVALID');
      const body = JSON.stringify(command);
      if (Buffer.byteLength(body) > 262144) throw new TypeError('REDIS_HTTP_REQUEST_TOO_LARGE');
      const controller = new AbortController(); requests.add(controller);
      try {
        const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
            'upstash-response-format': 'resp2', 'user-agent': 'starforge-merchant/redis-http' }, body });
        const retryAfter = response.headers.get('retry-after');
        if ([401, 403, 429].includes(response.status)) throw providerError('', response.status, retryAfter);
        const bytes = await readResponse(response, response.status === 200 ? maxResponseBytes : 8192);
        // Provider errors can retain the JSON error envelope even when RESP2 was requested.
        if (bytes[0] === 123) {
          let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid(); }
          if (value && typeof value.error === 'string') throw providerError(value.error, response.status, retryAfter);
          throw new RedisHttpError('SOURCE_REQUIRES_BINARY_RESP2');
        }
        if (response.status !== 200) {
          if (bytes[0] === 45) throw providerError(bytes.subarray(1).toString('utf8'), response.status, retryAfter);
          throw providerError('', response.status, retryAfter);
        }
        return decodeResp2(bytes);
      } finally {
        requests.delete(controller); controller.abort();
      }
    },
  };
  return Object.freeze(client);
}
