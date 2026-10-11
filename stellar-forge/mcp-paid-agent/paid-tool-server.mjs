/** MIT. Paid MCP tools over the official SDK and the original native facilitator. */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { ListToolsRequestSchema, CallToolRequestSchema, CallToolResultSchema,
  McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createPaymentWrapper } from '@x402/mcp';
import { x402ResourceServer } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { declareDiscoveryExtension, bazaarResourceServerExtension } from '@x402/extensions/bazaar';
import { createNativeFacilitator } from '../../stellar/scf-starforge-20261009/native-facilitator/runtime.mjs';
import { validateConfig } from '../../stellar/scf-starforge-20261009/native-facilitator/config.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireValue = (value, code) => { if (!value) throw Object.assign(new Error(code), {code}); };
const integer = (value, min, max, code) => requireValue(Number.isSafeInteger(value) && value >= min && value <= max, code);
const toolName = name => typeof name === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(name);
const toolError = code => ({isError:true, content:[{type:'text', text:code}]});
const copy = value => structuredClone(value);
// The buyer bounds the complete native transport to 2 MiB. Leave room for the
// original x402 receipt plus SDK JSON-RPC/SSE framing before authorizing settlement.
const MAX_HANDLER_RESULT_BYTES = 2 * 1024 * 1024 - 64 * 1024;

function boundedJson(value, maximum, code) {
  let text;
  try { text = JSON.stringify(value); } catch { requireValue(false, code); }
  requireValue(typeof text === 'string' && Buffer.byteLength(text) <= maximum, code);
  return JSON.parse(text);
}

function validateTerms(terms, policy) {
  requireValue(plain(terms) && terms.scheme === 'exact' && terms.network === policy.network &&
    policy.payments.assets.includes(terms.asset) && policy.payments.recipients.includes(terms.payTo) &&
    typeof terms.amount === 'string' && /^[1-9][0-9]{0,38}$/.test(terms.amount) &&
    BigInt(terms.amount) <= BigInt(policy.payments.maxAtomic), 'MCP_TERMS_OUTSIDE_FACILITATOR_POLICY');
  requireValue(Object.keys(terms).every(key => ['scheme','network','amount','asset','payTo','maxTimeoutSeconds','extra'].includes(key)),
    'MCP_PAYMENT_TERMS_FIELDS_INVALID');
  integer(terms.maxTimeoutSeconds, 1, 86400, 'MCP_PAYMENT_TIMEOUT_INVALID');
  requireValue(terms.extra?.areFeesSponsored === true &&
    [undefined, null, 'authorization'].includes(terms.extra?.paymentFlow), 'MCP_PAYMENT_PROFILE_INVALID');
  return boundedJson(terms, 16384, 'MCP_PAYMENT_TERMS_TOO_LARGE');
}

function jsonResponse(response, status, value, method = 'GET') {
  if (response.headersSent || response.destroyed) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(body), 'cache-control':'no-store', 'x-content-type-options':'nosniff'});
  response.end(method === 'HEAD' ? undefined : body);
}

/**
 * Tool functions, schemas, prices, RPC configuration and keys are trusted operator
 * inputs. Remote callers provide only the declared arguments and x402 metadata.
 * The official wrapper owns verification, authorization-flow settlement and receipts.
 */
export async function startNativePaidToolServer({facilitatorConfig, environment = process.env,
  tools, host = '127.0.0.1', port = 0, path = '/mcp', publicEndpoint,
  name = 'stellar-forge-paid-tools', version = '1.0.0', maxSessions = 32,
  sessionIdleMs = 15 * 60 * 1000, maxInFlight = 1, maxRequestBytes = 512 * 1024,
  maxResultBytes = 1024 * 1024, enableJsonResponse = false,
  jsonSchemaValidator = new AjvJsonSchemaValidator()} = {}) {
  const policy = validateConfig(facilitatorConfig);
  integer(port, 0, 65535, 'MCP_PORT_INVALID');
  integer(maxSessions, 1, 256, 'MCP_SESSION_LIMIT_INVALID');
  integer(sessionIdleMs, 1000, 86400000, 'MCP_SESSION_IDLE_INVALID');
  integer(maxInFlight, 1, 32, 'MCP_CALL_LIMIT_INVALID');
  integer(maxRequestBytes, 1024, 2 * 1024 * 1024, 'MCP_REQUEST_LIMIT_INVALID');
  integer(maxResultBytes, 1024, MAX_HANDLER_RESULT_BYTES, 'MCP_RESULT_LIMIT_INVALID');
  requireValue(['127.0.0.1', '::1', '0.0.0.0', '::'].includes(host), 'MCP_BIND_ADDRESS_INVALID');
  requireValue(typeof path === 'string' && /^\/[A-Za-z0-9/_-]{1,128}$/.test(path) &&
    !['/health', '/discovery/search', '/discovery/resources'].includes(path), 'MCP_PATH_INVALID');
  requireValue(typeof name === 'string' && name.length > 0 && name.length <= 128 &&
    typeof version === 'string' && version.length > 0 && version.length <= 64, 'MCP_IDENTITY_INVALID');
  requireValue(typeof enableJsonResponse === 'boolean' && typeof jsonSchemaValidator?.getValidator === 'function',
    'MCP_RUNTIME_OPTIONS_INVALID');
  let advertised;
  if (publicEndpoint !== undefined) {
    try { advertised = new URL(publicEndpoint); } catch { requireValue(false, 'MCP_PUBLIC_ENDPOINT_INVALID'); }
    requireValue(!advertised.username && !advertised.password && !advertised.search && !advertised.hash &&
      advertised.pathname === path && (advertised.protocol === 'https:' ||
      (advertised.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(advertised.hostname))),
      'MCP_PUBLIC_ENDPOINT_INVALID');
  }
  requireValue(advertised || ['127.0.0.1', '::1'].includes(host), 'MCP_PUBLIC_ENDPOINT_REQUIRED');
  requireValue(Array.isArray(tools) && tools.length > 0 && tools.length <= 32, 'MCP_TOOLS_REQUIRED');
  const entries = new Map();
  for (const tool of tools) {
    requireValue(plain(tool) && toolName(tool.name) && !entries.has(tool.name) &&
      typeof tool.description === 'string' && tool.description.length > 0 && tool.description.length <= 4096 &&
      typeof tool.handler === 'function' && plain(tool.inputSchema) && tool.inputSchema.type === 'object',
      'MCP_TOOL_INVALID');
    requireValue(tool.admit === undefined || typeof tool.admit === 'function', 'MCP_TOOL_ADMISSION_INVALID');
    requireValue(Array.isArray(tool.accepts) && tool.accepts.length > 0 && tool.accepts.length <= 32,
      'MCP_TOOL_ACCEPTS_REQUIRED');
    const inputSchema = boundedJson(tool.inputSchema, 65536, 'MCP_SCHEMA_TOO_LARGE');
    const validate = jsonSchemaValidator.getValidator(inputSchema);
    const example = tool.example === undefined ? undefined : boundedJson(tool.example, 65536, 'MCP_EXAMPLE_TOO_LARGE');
    requireValue(example === undefined || validate(example).valid, 'MCP_EXAMPLE_SCHEMA_MISMATCH');
    const descriptor = {name:tool.name, description:tool.description, inputSchema,
      ...(tool.annotations === undefined ? {} : {annotations:boundedJson(tool.annotations, 4096, 'MCP_ANNOTATIONS_INVALID')})};
    entries.set(tool.name, {descriptor, validate, handler:tool.handler, admit:tool.admit, example,
      accepts:tool.accepts.map(terms => validateTerms(terms, policy)),
      resource:{url:`mcp://tool/${tool.name}`, description:tool.description, mimeType:'application/json'}});
  }

  const facilitator = await createNativeFacilitator(policy, {environment});
  const resourceServer = new x402ResourceServer(facilitator);
  resourceServer.register(policy.network, new ExactStellarScheme());
  resourceServer.registerExtension(bazaarResourceServerExtension);
  const sessions = new Map(), records = new Set(), activeCalls = new Set();
  const counters = {toolRequests:0, challenges:0, handlerCalls:0, settlements:0, toolErrors:0, refused:0};
  let listener, sweep, endpoint, closing = false, closePromise;
  const stats = () => ({mode:'NATIVE_PAID_MCP', state:closing ? 'DRAINING' : 'ACCEPTING',
    endpoint, transport:'streamable-http', sessions:sessions.size, activeCalls:activeCalls.size,
    counters:{...counters}, facilitator:facilitator.status()});

  async function closeRecord(record) {
    if (record.closed) return;
    record.closed = true;
    records.delete(record);
    if (record.transport.sessionId) sessions.delete(record.transport.sessionId);
    await record.server.close().catch(() => {});
  }
  const close = () => closePromise ??= (async () => {
    closing = true;
    clearInterval(sweep);
    const stopped = listener?.listening ? new Promise(resolve => listener.close(resolve)) : Promise.resolve();
    // A disconnected caller does not cancel accepted native verification/settlement.
    // Keep signer ownership until the entire wrapper finishes, then drain the backend.
    await Promise.allSettled([...activeCalls]);
    await Promise.allSettled([...records].map(closeRecord));
    listener?.closeAllConnections();
    await stopped;
    let drained = await facilitator.drain();
    if (!drained.drained) drained = await facilitator.waitForIdle();
    return {drained:drained.drained, ...stats()};
  })();

  try {
    await resourceServer.initialize();
    for (const entry of entries.values()) {
      const accepts = [];
      for (const terms of entry.accepts) {
        const requirements = await resourceServer.buildPaymentRequirements({
          scheme:terms.scheme, network:terms.network, price:{amount:terms.amount, asset:terms.asset},
          payTo:terms.payTo, maxTimeoutSeconds:terms.maxTimeoutSeconds, extra:copy(terms.extra)});
        accepts.push(...requirements.map(item => validateTerms(item, policy)));
      }
      entry.accepts = accepts;
      entry.extensions = declareDiscoveryExtension({toolName:entry.descriptor.name,
        description:entry.descriptor.description, transport:'streamable-http',
        inputSchema:copy(entry.descriptor.inputSchema),
        ...(entry.example === undefined ? {} : {example:copy(entry.example)})});
      entry.wrap = createPaymentWrapper(resourceServer, {accepts:copy(accepts),
        resource:copy(entry.resource), extensions:copy(entry.extensions)});
    }

    async function createSession() {
      const record = {activeCalls:0, touched:Date.now(), closed:false};
      record.transport = new StreamableHTTPServerTransport({sessionIdGenerator:() => randomUUID(),
        onsessioninitialized:id => sessions.set(id, record),
        onsessionclosed:() => { void closeRecord(record); },
        enableJsonResponse, maxRequestBodySize:maxRequestBytes,
        allowedHosts:[new URL(endpoint).host, listener.address().family === 'IPv6' ?
          `[::1]:${listener.address().port}` : `127.0.0.1:${listener.address().port}`],
        allowedOrigins:[new URL(endpoint).origin], enableDnsRebindingProtection:true});
      record.server = new Server({name, version}, {capabilities:{tools:{}}});
      record.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools:[...entries.values()].map(entry => copy(entry.descriptor))}));
      record.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        counters.toolRequests++;
        if (closing || activeCalls.size >= maxInFlight) { counters.refused++; return toolError('MCP_SELLER_BUSY_OR_DRAINING'); }
        if (request.params.task !== undefined) throw new McpError(ErrorCode.InvalidParams, 'Task execution is not supported.');
        const entry = entries.get(request.params.name);
        if (!entry) throw new McpError(ErrorCode.InvalidParams, 'Unknown tool.');
        const payment = extra._meta?.['x402/payment'];
        if (payment !== undefined && (!plain(payment) || payment.resource?.url !== entry.resource.url))
          return toolError('MCP_PAYMENT_RESOURCE_MISMATCH');
        const args = boundedJson(request.params.arguments ?? {}, 65536, 'MCP_ARGUMENTS_TOO_LARGE');
        if (!entry.validate(args).valid) throw new McpError(ErrorCode.InvalidParams, 'Arguments do not match the advertised tool schema.');
        if (extra.signal.aborted) return toolError('MCP_CALL_CANCELLED_BEFORE_ADMISSION');
        record.activeCalls++;
        record.touched = Date.now();
        // Reserve before yielding: two concurrent requests cannot both take the last slot.
        const work = Promise.resolve().then(async () => {
          const context = {toolName:entry.descriptor.name, signal:extra.signal};
          if (entry.admit) {
            const admission = await entry.admit(copy(args), context);
            if (admission !== true) {
              counters.refused++;
              const checked = CallToolResultSchema.safeParse(admission);
              return checked.success && checked.data.isError === true
                ? boundedJson(checked.data, maxResultBytes, 'MCP_ADMISSION_RESULT_TOO_LARGE')
                : toolError('MCP_ADMISSION_RESULT_INVALID');
            }
          }
          if (extra.signal.aborted) return toolError('MCP_CALL_CANCELLED_BEFORE_PAYMENT');
          return entry.wrap(async handlerArgs => {
            counters.handlerCalls++;
            const result = await entry.handler(copy(handlerArgs), context);
            const checked = CallToolResultSchema.safeParse(result);
            if (!checked.success) return toolError('MCP_HANDLER_RESULT_INVALID');
            return boundedJson(checked.data, maxResultBytes, 'MCP_HANDLER_RESULT_TOO_LARGE');
          })(args, extra);
        });
        activeCalls.add(work);
        try {
          const result = await work;
          const challenge = result.isError && result.structuredContent?.x402Version === 2;
          if (challenge) counters.challenges++;
          if (result.isError && (!challenge || extra._meta?.['x402/payment'])) counters.toolErrors++;
          if (result._meta?.['x402/payment-response']?.success === true) counters.settlements++;
          return result;
        } catch { counters.toolErrors++; return toolError('MCP_TOOL_EXECUTION_FAILED'); }
        finally { activeCalls.delete(work); record.activeCalls--; record.touched = Date.now(); }
      });
      records.add(record);
      try { await record.server.connect(record.transport); }
      catch (error) { await closeRecord(record); throw error; }
      return record;
    }

    const catalogRows = () => [...entries.values()].map(entry => ({x402Version:2, type:'mcp',
      resource:{url:endpoint, description:entry.descriptor.description, mimeType:'application/json'},
      accepts:copy(entry.accepts), extensions:copy(entry.extensions)}));
    async function handle(request, response) {
      if (closing) return jsonResponse(response, 503, {error:'MCP_SELLER_DRAINING'}, request.method);
      const allowedHosts = [new URL(endpoint).host, new URL(localEndpoint()).host];
      if (!allowedHosts.includes(request.headers.host) || (request.headers.origin !== undefined &&
          request.headers.origin !== new URL(endpoint).origin))
        return jsonResponse(response, 403, {error:'MCP_ORIGIN_OR_HOST_DENIED'}, request.method);
      let url;
      try { url = new URL(request.url, endpoint); } catch { return jsonResponse(response, 400, {error:'URL_INVALID'}); }
      if (url.pathname === '/health' && ['GET','HEAD'].includes(request.method))
        return jsonResponse(response, 200, stats(), request.method);
      if (['/discovery/search','/discovery/resources'].includes(url.pathname) && ['GET','HEAD'].includes(request.method)) {
        const query = (url.searchParams.get('query') ?? '').toLowerCase();
        const rawLimit = url.searchParams.get('limit') ?? '100', rawCursor = url.searchParams.get('cursor') ?? '0';
        if (query.length > 1024 || !/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100 ||
            !/^(0|[1-9][0-9]{0,5})$/.test(rawCursor)) return jsonResponse(response, 400, {error:'DISCOVERY_QUERY_INVALID'});
        const limit = Number(rawLimit), offset = Number(rawCursor), maxAmount = url.searchParams.get('maxAmount');
        if (maxAmount !== null && !/^(0|[1-9][0-9]{0,38})$/.test(maxAmount))
          return jsonResponse(response, 400, {error:'DISCOVERY_AMOUNT_INVALID'});
        const rows = catalogRows().filter(row => {
          const input = row.extensions.bazaar.info.input;
          return `${input.toolName} ${input.description}`.toLowerCase().includes(query) && row.accepts.some(terms =>
            ['network','scheme','asset'].every(key => !url.searchParams.has(key) || terms[key] === url.searchParams.get(key)) &&
            (maxAmount === null || BigInt(terms.amount) <= BigInt(maxAmount)));
        });
        return jsonResponse(response, 200, {resources:rows.slice(offset, offset + limit), partialResults:false,
          pagination:{limit, offset, total:rows.length, nextCursor:offset + limit < rows.length ? String(offset + limit) : null}}, request.method);
      }
      if (url.pathname !== path || url.search) return jsonResponse(response, 404, {error:'NOT_FOUND'}, request.method);
      if (!['GET','POST','DELETE'].includes(request.method)) return jsonResponse(response, 405, {error:'METHOD_NOT_ALLOWED'});
      const sessionId = request.headers['mcp-session-id'];
      let record = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (sessionId !== undefined && !record) return jsonResponse(response, 404, {error:'MCP_SESSION_NOT_FOUND'});
      if (!record) {
        if (request.method !== 'POST') return jsonResponse(response, 400, {error:'MCP_INITIALIZE_REQUIRED'});
        if (records.size >= maxSessions) return jsonResponse(response, 503, {error:'MCP_SESSION_CAPACITY'});
        record = await createSession();
      }
      record.touched = Date.now();
      try { await record.transport.handleRequest(request, response); }
      finally { if (!record.transport.sessionId) await closeRecord(record); }
    }
    listener = createServer((request, response) => {
      void handle(request, response).catch(() => jsonResponse(response, 500, {error:'MCP_REQUEST_FAILED'}));
    });
    listener.requestTimeout = 30000;
    listener.headersTimeout = 10000;
    listener.maxHeadersCount = 64;
    function localEndpoint() {
      const address = listener.address();
      return `http://${address.family === 'IPv6' ? '[::1]' : '127.0.0.1'}:${address.port}${path}`;
    }
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(port, host, () => { listener.off('error', reject); resolve(); });
    });
    endpoint = advertised?.href ?? localEndpoint();
    sweep = setInterval(() => {
      for (const record of records) if (record.activeCalls === 0 && Date.now() - record.touched > sessionIdleMs)
        void closeRecord(record);
    }, Math.min(sessionIdleMs, 30000));
    sweep.unref();
    return Object.freeze({endpoint, discoveryUrl:new URL('/discovery/search', endpoint).href,
      catalogRows, tools:() => [...entries.values()].map(entry => copy(entry.descriptor)),
      status:stats, probeReadiness:facilitator.probeReadiness, close});
  } catch (error) { await close(); throw error; }
}

/** Useful original merchant data, read through a fixed operator-owned file path. */
export function createMerchantRecordTool({recordPath, recordId, accepts, name = 'get_merchant_record',
  description = 'Read the current merchant record, including its label and revision.'} = {}) {
  requireValue(typeof recordPath === 'string' && isAbsolute(recordPath) &&
    typeof recordId === 'string' && recordId.length > 0 && recordId.length <= 256, 'MERCHANT_RECORD_CONFIG_INVALID');
  return {name, description, accepts, inputSchema:{type:'object',
    properties:{recordId:{type:'string', const:recordId}}, required:['recordId'], additionalProperties:false},
    example:{recordId}, annotations:{readOnlyHint:true, destructiveHint:false, idempotentHint:false, openWorldHint:false},
    handler:async () => {
      let file;
      try {
        file = await open(recordPath, 'r');
        const stat = await file.stat();
        requireValue(stat.isFile() && stat.size <= 65536, 'MERCHANT_RECORD_TOO_LARGE');
        const bytes = Buffer.alloc(65537);
        let length = 0;
        while (length < bytes.length) {
          const part = await file.read(bytes, length, bytes.length - length, null);
          if (!part.bytesRead) break;
          length += part.bytesRead;
        }
        requireValue(length <= 65536, 'MERCHANT_RECORD_TOO_LARGE');
        const record = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes.subarray(0, length)));
        requireValue(plain(record) && record.recordId === recordId && typeof record.label === 'string' &&
          Number.isSafeInteger(record.revision) && record.revision >= 0, 'MERCHANT_RECORD_INVALID');
        const content = {recordId:record.recordId, label:record.label, revision:record.revision};
        return {content:[{type:'text', text:JSON.stringify(content)}], structuredContent:content};
      } catch { return toolError('MERCHANT_RECORD_UNAVAILABLE'); }
      finally { await file?.close(); }
    }};
}
