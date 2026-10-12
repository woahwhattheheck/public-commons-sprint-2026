#!/usr/bin/env node
/**
 * Emit one retained Analysis event source through the original OpenLineage client.
 * The caller retains the exact request and decides whether to reconcile or resume it.
 */
import { constants, promises as fs } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { LineageClient } from '../../sf30-seller-sdk/openlineage-workspace/client.mjs';

const MODE = 'ANALYSIS_LINEAGE_BRIDGE';
const SCHEMA = 'stellar-forge.analysis-lineage-bridge-request.v1';
const MAX_SOURCE = 16_777_216;
const MAX_RESPONSE = 1_048_576;
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

class BridgeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new BridgeError(code); };
function keys(value, expected, code) {
  if (!plain(value) || Object.keys(value).length !== expected.length ||
      expected.some(key => !own(value, key))) fail(code);
}
function absolute(value, code) {
  if (typeof value !== 'string' || !value || value.includes('\0') || !isAbsolute(value)) fail(code);
  return value;
}
function decode(bytes, code) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail(code); }
}
function json(bytes, code) {
  try { return JSON.parse(decode(bytes, code)); }
  catch (error) { if (error instanceof BridgeError) throw error; fail(code); }
}
function unchanged(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.mode === right.mode;
}

async function execute(argv) {
  const controller = new AbortController();
  const signal = controller.signal;
  let timer = null;
  let dispatchStarted = false;
  let endpoint = null;
  let observedStatus = null;
  let observedRetryAfter = null;
  let binding = {};
  let result;
  const abort = code => {
    if (!signal.aborted) controller.abort(new BridgeError(code));
  };
  const onTerm = () => abort('CANCELLED');
  const onInterrupt = () => abort('CANCELLED');
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInterrupt);
  const check = () => {
    if (signal.aborted) throw signal.reason instanceof BridgeError
      ? signal.reason : new BridgeError('CANCELLED');
  };

  async function readFile(path, { limit, bytes = null, privateFile = false, code }) {
    absolute(path, code);
    check();
    let handle = null;
    let primary = null;
    try {
      const entry = await fs.lstat(path, { bigint: true });
      if (!entry.isFile() || entry.size < 1n || entry.size > BigInt(limit)) fail(code);
      handle = await fs.open(path, constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || !unchanged(entry, before)) fail(code);
      if (privateFile && typeof process.getuid === 'function' &&
          (before.uid !== BigInt(process.getuid()) || (before.mode & 0o077n) !== 0n)) fail(code);
      if (bytes !== null && before.size !== BigInt(bytes)) fail(code);
      const result = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < result.length) {
        check();
        const next = await handle.read(result, offset, Math.min(65_536, result.length - offset), offset);
        if (!next.bytesRead) fail(code);
        offset += next.bytesRead;
      }
      check();
      const [after, current] = await Promise.all([
        handle.stat({ bigint: true }), fs.lstat(path, { bigint: true }),
      ]);
      if (!current.isFile() || !unchanged(before, after) || !unchanged(before, current)) fail(code);
      return result;
    } catch (error) {
      primary = error;
      if (error instanceof BridgeError) throw error;
      check();
      fail(code);
    } finally {
      if (handle) {
        try { await handle.close(); }
        catch (error) { if (!primary) fail(code); }
      }
    }
  }

  async function boundedFetch(url, init) {
    check();
    let response;
    try { response = await globalThis.fetch(url, init); }
    catch (error) {
      check();
      throw new BridgeError('LINEAGE_TRANSPORT_ERROR');
    }
    observedStatus = response.status;
    observedRetryAfter = response.headers.get('retry-after');
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let complete = false;
    let primary = null;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) { complete = true; break; }
        total += item.value.byteLength;
        if (total > MAX_RESPONSE) {
          abort('LINEAGE_RESPONSE_TOO_LARGE');
          fail('LINEAGE_RESPONSE_TOO_LARGE');
        }
        chunks.push(Buffer.from(item.value));
      }
      const body = total ? Buffer.concat(chunks, total) : null;
      return new Response(body, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } catch (error) {
      primary = error;
      if (error instanceof BridgeError) throw error;
      check();
      fail('LINEAGE_RESPONSE_INCOMPLETE');
    } finally {
      if (!complete) {
        // Retire the same HTTP transport before waiting on its stream cancellation.
        abort(primary instanceof BridgeError ? primary.code : 'LINEAGE_RESPONSE_INCOMPLETE');
        try { await reader.cancel(primary ?? signal.reason); } catch { /* Original failure remains. */ }
      }
      try { reader.releaseLock(); } catch { /* A complete retained response remains usable. */ }
    }
  }

  try {
    try {
      if (argv.length !== 2 || argv[0] !== '--request') fail('REQUEST_ARGUMENTS_INVALID');
      const request = json(await readFile(argv[1], {
        limit: 65_536, privateFile: true, code: 'REQUEST_FILE_INVALID',
      }), 'REQUEST_JSON_INVALID');
      keys(request, [
        'schema', 'action', 'connection_file', 'token_file', 'expected_workspace_id',
        'reviewed_endpoint', 'timeout_ms', 'operation_id', 'source',
      ], 'REQUEST_INVALID');
      if (request.schema !== SCHEMA || request.action !== 'emit' ||
          typeof request.expected_workspace_id !== 'string' || !UUID.test(request.expected_workspace_id) ||
          !Number.isSafeInteger(request.timeout_ms) || request.timeout_ms < 1_000 || request.timeout_ms > 300_000)
        fail('REQUEST_INVALID');
      const identity = typeof request.operation_id === 'string' &&
        /^analysis-([a-f0-9]{32})-([a-f0-9]{32})$/.exec(request.operation_id);
      if (!identity) fail('OPERATION_ID_INVALID');
      keys(request.source, ['path', 'sha256', 'bytes', 'name', 'url'], 'SOURCE_DESCRIPTOR_INVALID');
      if (typeof request.source.sha256 !== 'string' || !SHA.test(request.source.sha256) ||
          !Number.isSafeInteger(request.source.bytes) || request.source.bytes < 1 ||
          request.source.bytes > MAX_SOURCE ||
          request.source.name !== 'analysis-lineage-' + identity[2] + '.json' ||
          request.source.url !== 'urn:stellar-forge:analysis:' + identity[1] + ':lineage:' + identity[2])
        fail('SOURCE_DESCRIPTOR_INVALID');
      absolute(request.connection_file, 'CONNECTION_FILE_INVALID');
      absolute(request.source.path, 'SOURCE_FILE_INVALID');
      if (request.token_file !== null) absolute(request.token_file, 'TOKEN_FILE_INVALID');
      binding = {
        operationId: request.operation_id,
        workspaceId: request.expected_workspace_id,
        sourceSha256: request.source.sha256,
        sourceBytes: request.source.bytes,
      };
      timer = setTimeout(() => abort('TIMEOUT'), request.timeout_ms);
      const connection = json(await readFile(request.connection_file, {
        limit: 65_536, code: 'CONNECTION_FILE_INVALID',
      }), 'CONNECTION_JSON_INVALID');
      if (!plain(connection) || connection.schema !== 'commons.openlineage.startup.v1' ||
          connection.workspaceId !== request.expected_workspace_id ||
          typeof connection.instanceId !== 'string' || !connection.instanceId ||
          typeof connection.url !== 'string') fail('CONNECTION_INVALID');
      let url;
      try { url = new URL(connection.url); } catch { fail('CONNECTION_URL_INVALID'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
          url.search || url.hash || !['', '/'].includes(url.pathname) || url.origin === 'null')
        fail('CONNECTION_URL_INVALID');
      endpoint = url.origin;
      let reviewed;
      try { reviewed = new URL(request.reviewed_endpoint); } catch { fail('COLLECTOR_ENDPOINT_CHANGED'); }
      if (typeof request.reviewed_endpoint !== 'string' ||
          !['http:', 'https:'].includes(reviewed.protocol) || reviewed.username || reviewed.password ||
          reviewed.search || reviewed.hash || !['', '/'].includes(reviewed.pathname) ||
          reviewed.origin === 'null') fail('COLLECTOR_ENDPOINT_CHANGED');
      const localPortChange = ['127.0.0.1', '[::1]'].includes(reviewed.hostname) &&
        url.hostname === reviewed.hostname && url.protocol === reviewed.protocol;
      if (url.origin !== reviewed.origin && !localPortChange) fail('COLLECTOR_ENDPOINT_CHANGED');
      let token = null;
      if (request.token_file !== null) {
        const raw = decode(await readFile(request.token_file, {
          limit: 65_536, privateFile: true, code: 'TOKEN_FILE_INVALID',
        }), 'TOKEN_FILE_INVALID');
        token = raw.trim();
        if (token.length < 24 || /[\r\n\0]/.test(token)) fail('TOKEN_FILE_INVALID');
      }
      const source = await readFile(request.source.path, {
        limit: MAX_SOURCE, bytes: request.source.bytes, code: 'SOURCE_FILE_INVALID',
      });
      if (digest(source) !== request.source.sha256) fail('SOURCE_DIGEST_MISMATCH');
      check();
      const client = new LineageClient(endpoint, {
        token, fetchImpl: boundedFetch, timeoutMs: request.timeout_ms,
        expectedWorkspaceId: request.expected_workspace_id, signal,
      });
      // This marker means admission to the original native emit call, not a proven server write.
      dispatchStarted = true;
      const receipt = await client.emitSource(source, {
        name: request.source.name,
        sourceUrl: request.source.url,
        contentEncoding: 'identity',
        operationId: request.operation_id,
      });
      // A complete valid native reply wins over a cancellation delivered after that reply.
      if (!plain(receipt) || receipt.workspaceId !== request.expected_workspace_id ||
          receipt.operationId !== request.operation_id || typeof receipt.replayed !== 'boolean' ||
          !['revision', 'added', 'retained'].every(key => Number.isSafeInteger(receipt[key]) && receipt[key] >= 0) ||
          !plain(receipt.source) || receipt.source.id !== request.source.sha256 ||
          receipt.source.name !== request.source.name || receipt.source.bytes !== request.source.bytes ||
          receipt.source.contentEncoding !== 'identity' || receipt.source.format !== 'array' ||
          receipt.added > receipt.retained)
        fail('LINEAGE_RECEIPT_INVALID');
      result = { mode: MODE, ok: true, ...binding, endpoint, receipt };
    } catch (error) {
      let code = error instanceof BridgeError ? error.code : null;
      if (!code && Number.isInteger(error?.status)) code = 'LINEAGE_HTTP_ERROR';
      if (!code && signal.aborted) code = signal.reason instanceof BridgeError ? signal.reason.code : 'CANCELLED';
      if (!code && error instanceof SyntaxError) code = 'LINEAGE_RESPONSE_INVALID';
      if (!code) code = dispatchStarted ? 'LINEAGE_RESPONSE_INVALID' : 'BRIDGE_REQUEST_FAILED';
      result = {
        mode: MODE, ok: false, error: code, processStarted: true, dispatchStarted,
        status: observedStatus ?? (Number.isInteger(error?.status) ? error.status : null),
        retryAfter: observedRetryAfter ?? (typeof error?.retryAfter === 'string' ? error.retryAfter : null),
        endpoint, ...binding,
      };
    }
    // Keep signal ownership until the complete original result reaches the caller.
    process.exitCode = result.ok ? 0 : 1;
    await new Promise((resolve, reject) => {
      process.stdout.write(JSON.stringify(result) + '\n', error => error ? reject(error) : resolve());
    });
  } finally {
    if (timer !== null) clearTimeout(timer);
    abort('BRIDGE_CLOSED');
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInterrupt);
  }
  return result;
}

await execute(process.argv.slice(2));
