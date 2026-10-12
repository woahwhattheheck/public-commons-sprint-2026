import { createHash } from 'node:crypto';

export const NETWORK_PASSPHRASES = Object.freeze({
  'stellar:testnet': 'Test SDF Network ; September 2015',
  'stellar:pubnet': 'Public Global Stellar Network ; September 2015',
});
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const clone = (value) => structuredClone(value);

export class SorobanEventsError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SorobanEventsError';
    this.code = code;
    this.details = details;
  }
}
export function requireValue(condition, code, message, details) {
  if (!condition) throw new SorobanEventsError(code, message, details);
}
export function stableJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJSON(value[key])).join(',') + '}';
}
export function textValue(value, label, max = 200) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value), 'INVALID_ARGUMENT', label + ' must be a nonempty text value of at most ' + max + ' characters');
  return value;
}
export function integer(value, label, minimum = 1, maximum = 4294967295) {
  requireValue(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'INVALID_ARGUMENT', label + ' is outside its supported integer range');
  return value;
}
export function normalizedConnection(input) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'CONNECTION_REQUIRED', 'Configure the original Stellar RPC connection on the host');
  requireValue(Object.hasOwn(NETWORK_PASSPHRASES, input.network), 'INVALID_CONNECTION', 'Select stellar:testnet or stellar:pubnet');
  let url;
  try { url = new URL(input.rpcUrl); } catch { throw new SorobanEventsError('INVALID_CONNECTION', 'rpcUrl must be an absolute HTTP(S) URL'); }
  requireValue(!url.username && !url.password && !url.hash, 'INVALID_CONNECTION', 'Use host-configured headers for RPC credentials');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  requireValue(url.protocol === 'https:' || (url.protocol === 'http:' && input.allowHttp === true && local), 'INVALID_CONNECTION', 'RPC requires HTTPS, or explicit allowHttp for a local host');
  const headers = {};
  if (input.headers !== undefined) {
    requireValue(input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers), 'INVALID_CONNECTION', 'headers must be an object');
    for (const [key, value] of Object.entries(input.headers)) {
      requireValue(/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(key) && typeof value === 'string' && !/[\r\n]/.test(value), 'INVALID_CONNECTION', 'RPC headers contain an invalid field');
      requireValue(!['host', 'content-length', 'connection', 'transfer-encoding'].includes(key.toLowerCase()), 'INVALID_CONNECTION', 'The transport owns request framing headers');
      headers[key] = value;
    }
  }
  const description = { network: input.network, rpcOrigin: url.origin };
  description.id = digest(stableJSON(description));
  return { rpcUrl: url.href, network: input.network, headers, public: description,
    timeoutMs: input.timeoutMs === undefined ? 30000 : integer(input.timeoutMs, 'timeoutMs', 1000, 300000),
    maxResponseBytes: input.maxResponseBytes === undefined ? 64 * 1024 * 1024 : integer(input.maxResponseBytes, 'maxResponseBytes', 1024, 256 * 1024 * 1024) };
}
function topicSegment(value, index, length) {
  requireValue(typeof value === 'string', 'INVALID_PLAN', 'Topic segments must be base64 XDR, * or final **');
  if (value === '*') return value;
  if (value === '**') {
    requireValue(index === length - 1, 'INVALID_PLAN', '** must be the final topic segment');
    return value;
  }
  requireValue(value.length > 0 && value.length <= 16384 && value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'INVALID_PLAN', 'Topic segment must retain its canonical base64 XDR');
  return value;
}
export function normalizePlan(input) {
  const name = textValue(input.name, 'Plan name');
  let startLedger = input.startLedger ?? null;
  let endLedger = input.endLedger ?? null;
  if (startLedger !== null) startLedger = integer(startLedger, 'startLedger');
  if (endLedger !== null) endLedger = integer(endLedger, 'endLedger', 2, 4294967296);
  requireValue(startLedger === null || endLedger === null || endLedger > startLedger, 'INVALID_PLAN', 'endLedger must be greater than startLedger; the upper bound is exclusive');
  const pageSize = integer(input.pageSize ?? 1000, 'pageSize', 1, 10000);
  const filters = input.filters === undefined ? [] : clone(input.filters);
  requireValue(Array.isArray(filters) && filters.length <= 5, 'INVALID_PLAN', 'Use at most five event filters');
  for (const filter of filters) {
    requireValue(filter && typeof filter === 'object' && !Array.isArray(filter), 'INVALID_PLAN', 'Each event filter must be an object');
    requireValue(Object.keys(filter).every((key) => ['type', 'contractIds', 'topics'].includes(key)), 'INVALID_PLAN', 'Event filter has unsupported fields');
    if (filter.type !== undefined) requireValue(['contract', 'system'].includes(filter.type), 'INVALID_PLAN', 'Event type must be contract or system');
    if (filter.contractIds !== undefined) {
      requireValue(Array.isArray(filter.contractIds) && filter.contractIds.length > 0 && filter.contractIds.length <= 5, 'INVALID_PLAN', 'Use one to five contract identifiers in a filter');
      for (const id of filter.contractIds) requireValue(typeof id === 'string' && /^C[A-Z2-7]{55}$/.test(id), 'INVALID_PLAN', 'Contract identifiers must be C-address StrKeys');
    }
    if (filter.topics !== undefined) {
      requireValue(Array.isArray(filter.topics) && filter.topics.length > 0 && filter.topics.length <= 5, 'INVALID_PLAN', 'Use one to five topic filters');
      for (const topic of filter.topics) {
        requireValue(Array.isArray(topic) && topic.length >= 1 && topic.length <= 4, 'INVALID_PLAN', 'Each topic filter needs one to four segments');
        topic.forEach((segment, index) => topicSegment(segment, index, topic.length));
      }
    }
  }
  return { name, startLedger, endLedger, pageSize, filters };
}
export function requestParameters(capture) {
  const params = { filters: clone(capture.plan.filters), pagination: { limit: capture.plan.pageSize }, xdrFormat: 'base64' };
  if (capture.cursor !== null) params.pagination.cursor = capture.cursor;
  else { params.startLedger = capture.startLedger; params.endLedger = capture.endLedger; }
  return params;
}
const RESPONSE_HEADERS = new Set(['date', 'retry-after', 'x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']);
export function createRPCTransport(connection, customRequest) {
  return async function rpc(method, params, id) {
    requireValue(['getNetwork', 'getHealth', 'getEvents'].includes(method), 'INVALID_METHOD', 'The event source supports read-only network, health and event methods');
    const requestBytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    let status, headers = {}, responseBytes;
    const capturedAt = new Date().toISOString();
    try {
      if (customRequest) {
        const output = await customRequest({ method, params: clone(params), id, requestBytes: Buffer.from(requestBytes), connection: clone(connection.public) });
        requireValue(output && Number.isInteger(output.status) && (typeof output.body === 'string' || output.body instanceof Uint8Array), 'INVALID_RPC_TRANSPORT', 'Custom RPC transport must return {status, body} with exact response bytes');
        status = output.status;
        responseBytes = Buffer.from(output.body);
        for (const [key, value] of Object.entries(output.headers ?? {})) if (RESPONSE_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = String(value);
      } else {
        const response = await fetch(connection.rpcUrl, {
          method: 'POST', headers: { ...connection.headers, 'content-type': 'application/json', accept: 'application/json' },
          body: requestBytes, signal: AbortSignal.timeout(connection.timeoutMs), redirect: 'error',
        });
        status = response.status;
        for (const [key, value] of response.headers) if (RESPONSE_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = value;
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body ?? []) {
          size += chunk.byteLength;
          requireValue(size <= connection.maxResponseBytes, 'RPC_RESPONSE_TOO_LARGE', 'RPC response exceeded the host response limit');
          chunks.push(chunk);
        }
        responseBytes = Buffer.concat(chunks);
      }
      requireValue(responseBytes.byteLength <= connection.maxResponseBytes, 'RPC_RESPONSE_TOO_LARGE', 'RPC response exceeded the host response limit');
    } catch (error) {
      if (error instanceof SorobanEventsError) throw error;
      throw new SorobanEventsError('RPC_TRANSPORT_FAILED', 'The original RPC request did not produce a complete response', { method, retryable: true });
    }
    return { schema: 'stellar-forge.soroban-events.rpc-exchange.v1', capturedAt,
      request: { method, id, bodyBase64: requestBytes.toString('base64'), sha256: digest(requestBytes), bytes: requestBytes.length },
      response: { status, headers, bodyBase64: responseBytes.toString('base64'), sha256: digest(responseBytes), bytes: responseBytes.length } };
  };
}
export function rpcResult(exchange) {
  const raw = Buffer.from(exchange.response.bodyBase64, 'base64');
  requireValue(raw.length === exchange.response.bytes && digest(raw) === exchange.response.sha256, 'SOURCE_MISMATCH', 'Saved RPC response bytes differ from the original exchange');
  requireValue(exchange.response.status >= 200 && exchange.response.status < 300, 'RPC_HTTP_ERROR', 'Stellar RPC returned HTTP ' + exchange.response.status, { status: exchange.response.status, retryAfter: exchange.response.headers['retry-after'] ?? null });
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { throw new SorobanEventsError('RPC_INVALID_JSON', 'The original RPC response is not valid JSON'); }
  requireValue(body && body.jsonrpc === '2.0' && body.id === exchange.request.id, 'RPC_RESPONSE_MISMATCH', 'RPC response does not match the original request identifier');
  if (body.error) throw new SorobanEventsError('RPC_ERROR', 'Stellar RPC rejected the saved request', { rpcCode: body.error.code ?? null, rpcMessage: String(body.error.message ?? '').slice(0,1000) });
  requireValue(body.result && typeof body.result === 'object' && !Array.isArray(body.result), 'RPC_INVALID_RESULT', 'RPC response has no result object');
  return body.result;
}
export function validateEvent(event) {
  requireValue(event && typeof event === 'object' && !Array.isArray(event), 'RPC_INVALID_EVENT', 'RPC event must be an object');
  integer(event.ledger, 'event.ledger');
  textValue(event.id, 'event.id', 200);
  requireValue(['contract', 'system'].includes(event.type), 'RPC_INVALID_EVENT', 'RPC event has an unsupported type');
  requireValue((typeof event.contractId === 'string' && (event.contractId === '' || /^C[A-Z2-7]{55}$/.test(event.contractId))) || (event.type === 'system' && event.contractId == null), 'RPC_INVALID_EVENT', 'RPC event has an invalid contract identifier');
  requireValue(typeof event.ledgerClosedAt === 'string' && Number.isFinite(Date.parse(event.ledgerClosedAt)), 'RPC_INVALID_EVENT', 'RPC event has an invalid ledger close time');
  requireValue(Array.isArray(event.topic) && event.topic.length <= 4 && event.topic.every((value) => typeof value === 'string'), 'RPC_INVALID_EVENT', 'RPC event must retain original XDR topics');
  requireValue(typeof event.value === 'string', 'RPC_INVALID_EVENT', 'RPC event must retain its original XDR value');
  if (event.txHash !== undefined) requireValue(typeof event.txHash === 'string' && /^[a-f0-9]{64}$/.test(event.txHash), 'RPC_INVALID_EVENT', 'RPC transaction hash is invalid');
  return event;
}
