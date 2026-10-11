#!/usr/bin/env node
/** MIT. Subprocess transport for the maintained MCP workspace and tool handler. */
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { Console } from 'node:console';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MCP_VERSION } from './agent-server.mjs';
import { startMcpWorkspace } from './serve.mjs';

const MAX_FRAME_BYTES = 128 * 1024;
const MAX_REPLY_BYTES = 8 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' || Number.isSafeInteger(value);
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const failure = code => Object.assign(new Error(code), { code });

/** One request, one original handler invocation. The private HTTP hop never retries. */
function forward(endpoint, token, rpc, signal) {
  const body = Buffer.from(JSON.stringify(rpc));
  return new Promise((done, reject) => {
    const req = request(endpoint, {
      method: 'POST', signal,
      headers: {
        authorization: `Bearer ${token}`, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': MCP_VERSION,
        'content-length': body.byteLength,
      },
    }, res => {
      let size = 0;
      const chunks = [];
      res.on('data', chunk => {
        size += chunk.byteLength;
        if (size > MAX_REPLY_BYTES) res.destroy(failure('MCP_LOCAL_REPLY_TOO_LARGE'));
        else chunks.push(chunk);
      });
      res.once('error', reject);
      res.once('end', () => {
        if (res.statusCode === 202 && size === 0) return done(null);
        try {
          const reply = JSON.parse(new TextDecoder('utf-8', { fatal: true })
            .decode(Buffer.concat(chunks, size)));
          if (!plain(reply) || reply.jsonrpc !== '2.0' || reply.id !== rpc.id ||
              Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error'))
            throw failure('MCP_LOCAL_REPLY_INVALID');
          done(reply);
        } catch { reject(failure('MCP_LOCAL_REPLY_INVALID')); }
      });
    });
    req.once('error', reject);
    req.end(body);
  });
}

/**
 * A trusted embedding can supply its existing workspace factory. It receives the
 * same environment as startMcpWorkspace, with an ephemeral loopback port and a
 * transport-only bearer generated here. It must return {address, close}.
 * The default factory owns the original broker, approval adapter and quote store.
 */
export async function startMcpStdio({
  environment = process.env, input = process.stdin, output = process.stdout,
  startWorkspace = startMcpWorkspace, cancelRequest = null, maxConcurrent = 32,
  diagnostic = code => process.stderr.write(`Stellar MCP stdio: ${code}\n`),
} = {}) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 256)
    throw new RangeError('maxConcurrent must be an integer from 1 to 256');
  if (typeof startWorkspace !== 'function' || typeof diagnostic !== 'function' ||
      (cancelRequest !== null && typeof cancelRequest !== 'function'))
    throw new TypeError('Workspace and diagnostic hooks must be functions');
  const token = randomBytes(32).toString('hex');
  const workspace = await startWorkspace({ environment: {
    ...environment, MCP_ACCESS_TOKEN: token, MCP_PORT: '0', MCP_CLIENT_ORIGINS: '',
  } });
  let endpoint;
  try {
    endpoint = new URL(workspace.address);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
        endpoint.username || endpoint.password || endpoint.hash || endpoint.search ||
        typeof workspace.close !== 'function') throw failure('MCP_WORKSPACE_INVALID');
  } catch (error) {
    await workspace?.close?.();
    throw error;
  }

  let phase = 'NEW', writing = Promise.resolve(), outputBroken = false, closing;
  let resolveClosed;
  const closed = new Promise(done => { resolveClosed = done; });
  const active = new Map();
  const report = code => { try { diagnostic(code); } catch {} };
  const emit = value => {
    writing = writing.then(() => {
      if (outputBroken) return;
      return new Promise((done, reject) => {
        output.write(JSON.stringify(value) + '\n', error => error ? reject(error) : done());
      });
    });
    // Attach a rejection observer immediately, even when the client disconnects
    // between the native result and the caller awaiting its write completion.
    writing.catch(() => { outputBroken = true; void close('OUTPUT_CLOSED'); });
    return writing;
  };

  function close(reason = 'HOST_SHUTDOWN') {
    if (closing) return closing;
    phase = 'CLOSING';
    input.pause();
    input.destroy();
    closing = (async () => {
      let errorCode = null;
      try { await workspace.close(); }
      catch (error) { errorCode = error.code ?? 'MCP_WORKSPACE_CLOSE_FAILED'; report(errorCode); }
      // The original workspace finishes/cancels its own payment operations and
      // saves their states before the transport releases outstanding HTTP hops.
      for (const entry of active.values()) entry.controller.abort();
      await Promise.allSettled([...active.values()].map(entry => entry.operation));
      await writing.catch(() => {});
      output.off('error', onOutputError);
      const result = { reason, errorCode };
      resolveClosed(result);
      return result;
    })();
    return closing;
  }
  const onOutputError = () => { outputBroken = true; void close('OUTPUT_CLOSED'); };
  output.on('error', onOutputError);

  async function notification(rpc) {
    if (rpc.method === 'notifications/initialized') {
      if (phase === 'WAITING_FOR_CLIENT') {
        await forward(endpoint, token, rpc);
        if (phase === 'WAITING_FOR_CLIENT') phase = 'READY';
      }
      return;
    }
    if (rpc.method !== 'notifications/cancelled' || !validId(rpc.params?.requestId)) return;
    const entry = active.get(JSON.stringify(rpc.params.requestId));
    if (!entry || entry.rpc.method === 'initialize') return;
    entry.cancelled = true;
    try {
      if (cancelRequest) await cancelRequest(entry.rpc, workspace);
      else if (entry.rpc.method === 'tools/call' &&
          entry.rpc.params?.name === 'bazaar_execute_approved' &&
          typeof entry.rpc.params.arguments?.quoteId === 'string')
        workspace.broker?.cancel({ quoteId: entry.rpc.params.arguments.quoteId });
    } catch (error) { report(error.code ?? 'MCP_CANCEL_FAILED'); }
    // Stop waiting for the local reply. Quote cancellation above is performed by
    // the original broker, which retains its signed-dispatch recovery state.
    entry.controller.abort();
  }

  async function acceptFrame(bytes) {
    if (phase === 'CLOSING') return;
    let rpc;
    try { rpc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return emit(rpcError(null, -32700, 'Invalid JSON or UTF-8 frame')); }
    if (!plain(rpc) || rpc.jsonrpc !== '2.0')
      return emit(rpcError(null, -32600, 'One JSON-RPC message is required per line'));
    // This fixed-tools server makes no server-to-client requests. A stray client
    // response is ignored; responses and notifications never receive responses.
    if (typeof rpc.method !== 'string') {
      if (validId(rpc.id) && (Object.hasOwn(rpc, 'result') || Object.hasOwn(rpc, 'error'))) return;
      return emit(rpcError(null, -32600, 'Invalid JSON-RPC message'));
    }
    if (!Object.hasOwn(rpc, 'id')) return notification(rpc);
    if (!validId(rpc.id)) return emit(rpcError(null, -32600, 'Request ID must be a string or integer'));
    const key = JSON.stringify(rpc.id);
    if (active.has(key)) return emit(rpcError(rpc.id, -32600, 'Request ID is already active'));
    if (rpc.method === 'initialize') {
      if (phase !== 'NEW') return emit(rpcError(rpc.id, -32600, 'This connection is already initialized'));
      if (!plain(rpc.params) || typeof rpc.params.protocolVersion !== 'string' ||
          !plain(rpc.params.capabilities) || !plain(rpc.params.clientInfo))
        return emit(rpcError(rpc.id, -32602, 'Initialization requires protocolVersion, capabilities and clientInfo'));
    } else if (phase !== 'READY' && rpc.method !== 'ping')
      return emit(rpcError(rpc.id, -32002, 'Complete MCP initialization before calling tools'));
    if (active.size >= maxConcurrent)
      return emit(rpcError(rpc.id, -32000, 'All request slots are occupied; inspect or cancel the original requests'));
    if (rpc.method === 'initialize') phase = 'INITIALIZING';
    const entry = { rpc, controller: new AbortController(), cancelled: false, operation: null };
    active.set(key, entry);
    entry.operation = (async () => {
      try {
        const reply = await forward(endpoint, token, rpc, entry.controller.signal);
        if (rpc.method === 'initialize' && phase === 'INITIALIZING')
          phase = reply?.result?.protocolVersion === MCP_VERSION ? 'WAITING_FOR_CLIENT' : 'NEW';
        if (!entry.cancelled && reply) await emit(reply);
      } catch {
        if (rpc.method === 'initialize' && phase === 'INITIALIZING') phase = 'NEW';
        if (!entry.cancelled && !outputBroken)
          await emit(rpcError(rpc.id, -32603,
            'Original workspace response unavailable; inspect its retained operation before retrying'));
      } finally { active.delete(key); }
    })();
    entry.operation.catch(() => { void close('OUTPUT_CLOSED'); });
  }

  // Frame bytes before UTF-8 decoding: multibyte characters can span arbitrary
  // stdin chunks. An oversized line is drained through its newline, once.
  const reading = (async () => {
    let chunks = [], size = 0, oversized = false;
    try {
      for await (const raw of input) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        let offset = 0;
        while (offset < chunk.length && phase !== 'CLOSING') {
          const newline = chunk.indexOf(10, offset);
          const end = newline < 0 ? chunk.length : newline;
          const part = chunk.subarray(offset, end);
          if (!oversized) {
            size += part.byteLength;
            if (size > MAX_FRAME_BYTES) { oversized = true; chunks = []; }
            else if (part.byteLength) chunks.push(part);
          }
          if (newline < 0) break;
          if (oversized) await emit(rpcError(null, -32700, 'Frame exceeds 128 KiB'));
          else if (size) {
            let line = Buffer.concat(chunks, size);
            if (line.at(-1) === 13) line = line.subarray(0, -1);
            if (line.length) await acceptFrame(line);
          }
          chunks = []; size = 0; oversized = false; offset = newline + 1;
        }
      }
      if (phase !== 'CLOSING' && (size || oversized))
        await emit(rpcError(null, -32700, 'Incomplete newline-delimited message at end of input'));
    } catch (error) {
      if (phase !== 'CLOSING') report(error.code ?? 'MCP_INPUT_FAILED');
    } finally { void close('INPUT_CLOSED'); }
  })();
  reading.catch(() => { void close('INPUT_CLOSED'); });
  return {
    close, closed, protocolVersion: MCP_VERSION,
    durable: workspace.durable === true,
    paymentAdapterConnected: workspace.paymentAdapterConnected === true,
  };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length) {
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
      process.stderr.write('Stellar Forge MCP stdio\n\nLaunch from an MCP host with BAZAAR_DISCOVERY_URL.\nSet MCP_STATE_DIR to retain original quote history. PAID_RESOURCE_ORIGINS\nselects allowed merchant origins. MCP_OPERATOR_MODULE loads the existing\ntrusted approval/signing adapter. Use client-config.mjs to generate host JSON.\n');
      return;
    }
    throw new TypeError('stdio takes configuration through the host environment; use --help');
  }
  // Trusted operator modules commonly use console.log. Keep those diagnostics
  // on stderr while reserving stdout exclusively for complete MCP messages.
  const previousConsole = globalThis.console;
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  let connection, stopRequested = false;
  const stop = () => { stopRequested = true; void connection?.close('HOST_SIGNAL'); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    connection = await startMcpStdio();
    if (stopRequested) await connection.close('HOST_SIGNAL');
    const result = await connection.closed;
    if (result.errorCode) process.exitCode = 2;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    globalThis.console = previousConsole;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(`Stellar MCP stdio startup failed (${error.code ?? 'CONFIGURATION_ERROR'}). Check the host environment and private workspace.\n`);
    process.exitCode = 2;
  });
