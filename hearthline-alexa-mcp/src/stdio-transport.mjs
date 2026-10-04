import { createInitializeResult, dispatchMcpMethod, jsonRpcError, jsonRpcResult, validateMcpMessage } from './mcp-server.mjs';

const MAX_STDIO_LINE_BYTES = 1_000_000;
function requestIdKey(value) { return `${typeof value}:${String(value)}`; }
function isNotificationCandidate(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && value.jsonrpc === '2.0' && typeof value.method === 'string' && !Object.prototype.hasOwnProperty.call(value, 'id'); }
function errorBody(id, error) { return jsonRpcError(id, Number.isInteger(error?.jsonRpcCode) ? error.jsonRpcCode : -32603, error?.message ?? 'Internal error', error?.jsonRpcData); }

export function createMcpStdioProcessor({ orchestrator, logger = console } = {}) {
  const state = { initializeComplete: false, initialized: false, protocolVersion: null, toolCalls: [], seenRequestIds: new Set() };
  return async function processMessage(input) {
    const notification = isNotificationCandidate(input);
    let message;
    try { message = validateMcpMessage(input); }
    catch (error) { if (notification) { logger.error?.('mcp stdio notification validation failed', { method: input?.method, error: error?.message }); return null; } return errorBody(input?.id, error); }

    if (message.id !== undefined) {
      const key = requestIdKey(message.id);
      if (state.seenRequestIds.has(key)) return jsonRpcError(message.id, -32600, 'request id already used in this stdio connection');
      state.seenRequestIds.add(key);
    }

    if (message.method === 'initialize') {
      if (message.id === undefined) return null;
      if (state.initializeComplete) return jsonRpcError(message.id, -32600, 'initialize already completed for this stdio connection');
      try {
        const result = createInitializeResult(message.params);
        state.initializeComplete = true;
        state.protocolVersion = result.protocolVersion;
        return jsonRpcResult(message.id, result);
      } catch (error) { return errorBody(message.id, error); }
    }

    if (!state.initializeComplete) {
      if (message.id === undefined) { logger.error?.('mcp stdio notification rejected before initialize', { method: message.method }); return null; }
      return jsonRpcError(message.id, -32003, 'initialize must be the first MCP interaction');
    }

    if (message.id === undefined) {
      if (message.method === 'notifications/initialized') state.initialized = true;
      else if (!state.initialized) logger.error?.('mcp stdio notification rejected before initialized', { method: message.method });
      return null;
    }

    if (message.method !== 'ping' && !state.initialized) return jsonRpcError(message.id, -32003, 'session not initialized; send notifications/initialized first');
    try { return jsonRpcResult(message.id, await dispatchMcpMethod(message.method, message.params ?? {}, orchestrator, state)); }
    catch (error) { logger.error?.('mcp stdio method error', { method: message.method, error: error?.message }); return errorBody(message.id, error); }
  };
}

async function* boundedLines(input, maxBytes) {
  let pending = Buffer.alloc(0);
  let dropping = false;
  for await (const rawChunk of input) {
    let chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    while (chunk.length) {
      const newline = chunk.indexOf(0x0a);
      const segment = newline === -1 ? chunk : chunk.subarray(0, newline);
      if (dropping) {
        if (newline === -1) break;
        dropping = false;
        yield { tooLarge: true };
        chunk = chunk.subarray(newline + 1);
        continue;
      }
      if (pending.length + segment.length > maxBytes) {
        pending = Buffer.alloc(0);
        if (newline === -1) { dropping = true; break; }
        yield { tooLarge: true };
        chunk = chunk.subarray(newline + 1);
        continue;
      }
      if (segment.length) pending = pending.length ? Buffer.concat([pending, segment]) : Buffer.from(segment);
      if (newline === -1) break;
      if (pending.length && pending[pending.length - 1] === 0x0d) pending = pending.subarray(0, -1);
      yield { line: pending.toString('utf8') };
      pending = Buffer.alloc(0);
      chunk = chunk.subarray(newline + 1);
    }
  }
  if (dropping) yield { tooLarge: true };
  else if (pending.length) yield { line: pending.toString('utf8') };
}

export async function runMcpStdio({ orchestrator, input = process.stdin, output = process.stdout, logger = console, maxLineBytes = MAX_STDIO_LINE_BYTES } = {}) {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) throw new Error('maxLineBytes must be a positive safe integer');
  const processMessage = createMcpStdioProcessor({ orchestrator, logger });
  for await (const item of boundedLines(input, maxLineBytes)) {
    if (item.tooLarge) { output.write(`${JSON.stringify(jsonRpcError(null, -32600, 'stdio message too large'))}\n`); continue; }
    if (!item.line) continue;
    let message;
    try { message = JSON.parse(item.line); }
    catch { output.write(`${JSON.stringify(jsonRpcError(null, -32700, 'Parse error'))}\n`); continue; }
    const response = await processMessage(message);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}
