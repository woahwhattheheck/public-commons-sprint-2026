/** MIT. Original SF32 remote MCP transport; the official SDK owns protocol framing. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';

export const MCP_SDK_VERSION = '1.32.1';
export const MCP_ARGUMENT_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const validTool = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const validTransport = value => ['sse', 'streamable-http'].includes(value);

/** Canonical JSON is the exact argument representation approved and retained. */
export function mcpJson(value, maxBytes = MCP_ARGUMENT_BYTES) {
  let count = 0;
  function visit(item, depth) {
    if (++count > 10000 || depth > 32) fail('MCP_INPUT_TOO_COMPLEX');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(child => visit(child, depth + 1));
    if (!plain(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail('MCP_INPUT_NOT_JSON');
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key], depth + 1)]));
  }
  const text = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(text) > maxBytes) fail('MCP_INPUT_TOO_LARGE');
  return text;
}

function endpointUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('MCP_ENDPOINT_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    fail('MCP_ENDPOINT_INVALID');
  return url;
}

function resourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('MCP_RESOURCE_INVALID'); }
  if (!['mcp:', 'http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    fail('MCP_RESOURCE_INVALID');
  return url.href;
}

/** Optional overrides are trusted operator configuration, never MCP tool input. */
export function normalizeMcpPolicies(policies = []) {
  if (!Array.isArray(policies) || policies.length > 500) fail('MCP_POLICY_INVALID');
  const identities = new Set();
  return policies.map(policy => {
    if (!plain(policy) || Object.keys(policy).some(key =>
      !['endpoint', 'toolName', 'transport', 'paymentResourceUrl'].includes(key)) || !validTool(policy.toolName))
      fail('MCP_POLICY_INVALID');
    const endpoint = endpointUrl(policy.endpoint).href;
    const identity = JSON.stringify([endpoint, policy.toolName]);
    if (identities.has(identity)) fail('MCP_POLICY_DUPLICATE');
    identities.add(identity);
    if (policy.transport !== undefined && !validTransport(policy.transport)) fail('MCP_TRANSPORT_UNSUPPORTED');
    return { endpoint, toolName: policy.toolName,
      ...(policy.transport === undefined ? {} : { transport: policy.transport }),
      paymentResourceUrl: resourceUrl(policy.paymentResourceUrl ?? `mcp://tool/${policy.toolName}`) };
  }).sort((a, b) => JSON.stringify([a.endpoint, a.toolName]).localeCompare(JSON.stringify([b.endpoint, b.toolName])));
}

export function prepareMcpInvocation(record, input, policies = []) {
  if (!plain(input) || Object.keys(input).some(key => key !== 'arguments')) fail('MCP_ARGUMENT_CONTAINER_REQUIRED');
  const declaration = record.input;
  if (!validTool(declaration.toolName) || !plain(declaration.inputSchema) || declaration.inputSchema.type !== 'object')
    fail('MCP_DECLARATION_INVALID');
  const endpoint = endpointUrl(record.resource.url).href;
  const policy = policies.find(item => item.endpoint === endpoint && item.toolName === declaration.toolName);
  const transport = policy?.transport ?? declaration.transport;
  if (!validTransport(transport)) fail('MCP_TRANSPORT_UNSUPPORTED', 'Advertise sse or streamable-http, or configure this exact tool in remoteMcpPolicies.');
  const args = input.arguments ?? {};
  if (!plain(args)) fail('MCP_ARGUMENT_CONTAINER_REQUIRED');
  const text = mcpJson(args);
  return {
    endpoint, transport, toolName: declaration.toolName, arguments: JSON.parse(text),
    argumentsBytes: Buffer.byteLength(text), argumentsSha256: digest(text),
    inputSchemaSha256: digest(mcpJson(declaration.inputSchema)),
    paymentResourceUrl: policy?.paymentResourceUrl ?? `mcp://tool/${declaration.toolName}`,
  };
}

export function validateMcpInvocation(invocation) {
  if (!plain(invocation) || !validTool(invocation.toolName) || !validTransport(invocation.transport) ||
      endpointUrl(invocation.endpoint).href !== invocation.endpoint ||
      resourceUrl(invocation.paymentResourceUrl) !== invocation.paymentResourceUrl ||
      !/^[a-f0-9]{64}$/.test(invocation.inputSchemaSha256 ?? '') || !plain(invocation.arguments))
    fail('MCP_INVOCATION_INVALID');
  const text = mcpJson(invocation.arguments);
  if (Buffer.byteLength(text) !== invocation.argumentsBytes || digest(text) !== invocation.argumentsSha256)
    fail('MCP_ARGUMENT_BINDING_CHANGED');
  return invocation;
}

export function extractMcpChallenge(result) {
  if (result?.isError !== true) return null;
  let required = result.structuredContent;
  if (!plain(required) || !('x402Version' in required) || !('accepts' in required)) {
    try { required = JSON.parse(result.content?.[0]?.text); } catch { return null; }
  }
  return plain(required) && 'x402Version' in required && 'accepts' in required ? required : null;
}

export function requireMcpChallenge(required, invocation, accepted) {
  if (required?.x402Version !== 2 || !plain(required.resource) ||
      required.resource.url !== invocation.paymentResourceUrl || !Array.isArray(required.accepts) ||
      required.accepts.length < 1 || required.accepts.length > 32 ||
      required.accepts.filter(option => same(option, accepted)).length !== 1 ||
      (required.extensions !== undefined && !plain(required.extensions)))
    fail('CHALLENGE_MISMATCH', 'Remote MCP challenge differs from the exact approved resource and complete payment terms.');
  mcpJson(required, 128 * 1024);
}

export function requireMcpPayload(payload, required, accepted) {
  if (payload?.x402Version !== 2 || !plain(payload.payload) || !same(payload.accepted, accepted) ||
      !same(payload.resource, required.resource) || !same(payload.extensions ?? {}, required.extensions ?? {}))
    fail('SIGNER_INVALID', 'Signer did not preserve the original MCP challenge and selected payment option.');
  mcpJson(payload, 256 * 1024);
}

export function mcpResultContent(result) {
  const bytes = Buffer.from(JSON.stringify(result));
  const maximum = 64 * 1024;
  return { contentType: 'application/json', body: bytes.subarray(0, maximum).toString('utf8'),
    truncated: bytes.length > maximum };
}

let sdkPromise;
async function loadSdk() {
  sdkPromise ??= (async () => {
    let directory;
    try { directory = dirname(fileURLToPath(import.meta.resolve('@modelcontextprotocol/sdk/client/index.js'))); }
    catch { fail('MCP_SDK_NOT_INSTALLED', `Install @modelcontextprotocol/sdk@${MCP_SDK_VERSION}.`); }
    let version;
    for (let depth = 0; depth < 8; depth++) {
      try {
        const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (pkg.name === '@modelcontextprotocol/sdk') { version = pkg.version; break; }
      } catch { /* exported entrypoints can live below package.json */ }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (version !== MCP_SDK_VERSION) fail('MCP_SDK_VERSION_MISMATCH');
    const [{ Client }, { StreamableHTTPClientTransport }, { SSEClientTransport }, { CallToolResultSchema }] =
      await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
        import('@modelcontextprotocol/sdk/client/sse.js'), import('@modelcontextprotocol/sdk/types.js')]);
    return { Client, StreamableHTTPClientTransport, SSEClientTransport, CallToolResultSchema };
  })().catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

function boundedResponse(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    void response.body?.cancel(); fail('MCP_RESPONSE_TOO_LARGE');
  }
  if (!response.body) return response;
  const reader = response.body.getReader();
  let bytes = 0;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const part = await reader.read();
        if (part.done) { controller.close(); reader.releaseLock(); return; }
        bytes += part.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel(); reader.releaseLock(); fail('MCP_RESPONSE_TOO_LARGE');
        }
        controller.enqueue(part.value);
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** One initialized connection, one unsigned tool call and at most one signed call. */
export async function connectRemoteMcp({ invocation, fetchImpl = fetch, signal, timeoutMs = 8000 }) {
  validateMcpInvocation(invocation);
  const sdk = await loadSdk();
  const endpoint = endpointUrl(invocation.endpoint);
  const stop = new AbortController();
  const lifetime = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let closed = false, terminating = false, calls = 0;
  const requestOptions = () => ({ signal: lifetime, timeout: timeoutMs, maxTotalTimeout: timeoutMs });
  const guardedFetch = async (input, init = {}) => {
    const target = endpointUrl(input instanceof Request ? input.url : input);
    if (target.origin !== endpoint.origin ||
        (invocation.transport === 'streamable-http' && target.href !== endpoint.href)) fail('MCP_ENDPOINT_CHANGED');
    const cleanup = terminating && String(init.method ?? 'GET').toUpperCase() === 'DELETE';
    if (closed && !cleanup) fail('MCP_CONNECTION_CLOSED');
    const response = await fetchImpl(target, { ...init, redirect: 'manual',
      // Session cleanup remains possible after cancellation. It cannot send a
      // tool call and gets a fresh, short deadline of its own.
      signal: cleanup ? AbortSignal.timeout(Math.min(timeoutMs, 2000)) :
        AbortSignal.any([lifetime, ...(init.signal ? [init.signal] : []), AbortSignal.timeout(timeoutMs)]) });
    if (response.redirected || (response.status >= 300 && response.status < 400) ||
        (response.url && endpointUrl(response.url).origin !== endpoint.origin)) {
      await response.body?.cancel().catch(() => {}); fail('MCP_REDIRECT_REJECTED');
    }
    return boundedResponse(response);
  };
  const transportOptions = { fetch: guardedFetch, requestInit: { redirect: 'manual' } };
  const transport = invocation.transport === 'sse'
    ? new sdk.SSEClientTransport(endpoint, transportOptions)
    : new sdk.StreamableHTTPClientTransport(endpoint, { ...transportOptions,
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } });
  const client = new sdk.Client({ name: 'stellar-forge-approved-buyer', version: '1.0.0' }, { capabilities: {} });
  const abort = () => { void client.close().catch(() => {}); };
  lifetime.addEventListener('abort', abort, { once: true });
  const close = async () => {
    if (closed) return;
    closed = true; lifetime.removeEventListener('abort', abort);
    try {
      if (transport.sessionId && typeof transport.terminateSession === 'function') {
        terminating = true;
        await transport.terminateSession().catch(() => {});
      }
    } finally {
      terminating = false; stop.abort(); await client.close();
    }
  };
  try {
    lifetime.throwIfAborted();
    await client.connect(transport, requestOptions());
    let cursor, found;
    const cursors = new Set();
    for (let page = 0; page < 10; page++) {
      const result = await client.listTools(cursor ? { cursor } : {}, requestOptions());
      const matches = result.tools.filter(tool => tool.name === invocation.toolName);
      if (matches.length > 1) fail('MCP_TOOL_AMBIGUOUS');
      if (matches.length === 1) { found = matches[0]; break; }
      cursor = result.nextCursor;
      if (!cursor) break;
      if (cursors.has(cursor)) fail('MCP_TOOL_CURSOR_REPEATED');
      cursors.add(cursor);
    }
    if (!found) fail('MCP_TOOL_NOT_FOUND');
    if (digest(mcpJson(found.inputSchema)) !== invocation.inputSchemaSha256) fail('MCP_TOOL_SCHEMA_CHANGED');
    return {
      peer: { name:String(client.getServerVersion()?.name ?? '').slice(0,256),
        version:String(client.getServerVersion()?.version ?? '').slice(0,128), transport: invocation.transport,
        ...(transport.sessionId ? { sessionSha256: digest(transport.sessionId) } : {}) },
      async call(payment) {
        if (closed || (calls === 0 && payment !== undefined) || (calls === 1 && payment === undefined) || calls > 1)
          fail('MCP_CALL_SEQUENCE_INVALID');
        lifetime.throwIfAborted(); calls++;
        // request() preserves the native payment-required structuredContent. The
        // SDK's callTool() would apply the ordinary success output schema to it.
        return client.request({ method: 'tools/call', params: {
          name: invocation.toolName, arguments: structuredClone(invocation.arguments),
          ...(payment === undefined ? {} : { _meta: { 'x402/payment': payment } }),
        } }, sdk.CallToolResultSchema, requestOptions());
      },
      close,
    };
  } catch (error) { await close().catch(() => {}); throw error; }
}
