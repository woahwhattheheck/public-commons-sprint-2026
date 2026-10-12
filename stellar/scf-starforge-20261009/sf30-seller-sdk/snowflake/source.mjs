// MIT. Original Snowflake SQL API operations, with durable same-request recovery.
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createUpstreamHandler, UPSTREAM_ATTEMPT } from '../upstream-handler.mjs';
import { compileSnowflakeSource, accountOrigin, statementBody, fault } from './declaration.mjs';
import { UUID, canonical, sha256 } from './store.mjs';

const TERMINAL = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'REJECTED']);
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const bodyCode = value => typeof value?.code === 'string' ? value.code : null;
function handleOf(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fault('SNOWFLAKE_STATEMENT_HANDLE_INVALID');
  return value.toLowerCase();
}
function metadata(value, query) {
  if (!value || !validCount(value.numRows) || value.numRows > query.maxRows + 1 ||
      !Array.isArray(value.rowType) || value.rowType.length !== query.columns.length ||
      value.rowType.some((column, index) => column?.name !== query.columns[index] ||
        typeof column.type !== 'string' || !column.type || column.type.length > 256))
    throw fault('SNOWFLAKE_RESULT_SCHEMA_CHANGED', 'The native result metadata differs from the declared ordered columns.');
  if (value.format !== undefined && value.format !== 'jsonv2') throw fault('SNOWFLAKE_RESULT_FORMAT_UNSUPPORTED');
  const parts = value.partitionInfo;
  if (!Array.isArray(parts) || !parts.length && value.numRows !== 0 || parts.length > 20000 ||
      parts.some(part => !validCount(part?.rowCount)) ||
      parts.reduce((sum, part) => sum + part.rowCount, 0) !== value.numRows)
    throw fault('SNOWFLAKE_PARTITION_METADATA_INVALID', 'The complete native partition row counts are required.');
  return value;
}
export function inspectSnowflakePartition(value, { query, resultMetadata, index = 0, statementHandle } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || bodyCode(value) === '391908')
    throw fault('SNOWFLAKE_RESULT_INCOMPLETE', 'Snowflake reported an incomplete result.');
  if (value.statementHandle !== undefined && handleOf(value.statementHandle) !== statementHandle)
    throw fault('SNOWFLAKE_STATEMENT_CHANGED', 'A partition belongs to a different Snowflake statement.');
  const meta = index === 0 ? metadata(value.resultSetMetaData, query) : resultMetadata;
  if (!meta) throw fault('SNOWFLAKE_METADATA_REQUIRED');
  if (index > 0 && value.resultSetMetaData !== undefined) {
    const received = metadata(value.resultSetMetaData, query);
    if (canonical(received.rowType) !== canonical(meta.rowType) || received.numRows !== meta.numRows ||
        canonical(received.partitionInfo) !== canonical(meta.partitionInfo))
      throw fault('SNOWFLAKE_RESULT_SCHEMA_CHANGED');
  }
  const count = meta.partitionInfo[index]?.rowCount ?? (index === 0 && meta.numRows === 0 ? 0 : null);
  if (count === null || !Array.isArray(value.data) || value.data.length !== count ||
      value.data.some(row => !Array.isArray(row) || row.length !== query.columns.length ||
        row.some(cell => cell !== null && typeof cell !== 'string')))
    throw fault('SNOWFLAKE_PARTITION_INCOMPLETE', 'Retain the complete native string/null rows for this partition.');
  return { metadata: meta, rows: value.data };
}
function retryTime(headers, attempt) {
  const raw = headers?.['retry-after'];
  const time = typeof raw === 'string' && /^\d+$/.test(raw) ? Date.now() + Number(raw) * 1000 :
    typeof raw === 'string' && Number.isFinite(Date.parse(raw)) ? Date.parse(raw) :
      Date.now() + Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
  return Math.max(Date.now() + 500, Math.min(time, Number.MAX_SAFE_INTEGER));
}

/** Credentials are resolved only inside the ORIGINAL upstream transport. */
export function createSnowflakeOperations(store, { env = process.env, agent, lookup, credentialProvider, supplierQuota } = {}) {
  const active = new Map(); let closed = false;
  function context(operation) {
    const source = compileSnowflakeSource(store.source(operation.sourceId).config);
    return { source, query: source.queries[operation.queryName] };
  }
  function check() { if (closed) throw fault('SNOWFLAKE_OPERATIONS_CLOSED', undefined, 503); store.check(); }
  async function request(operation, method, path, query, body, signal) {
    check();
    const { source } = context(operation);
    if (accountOrigin(source.config, env) !== operation.origin)
      throw fault('SNOWFLAKE_ACCOUNT_CHANGED', 'This request belongs to the originally selected account. Restore that account configuration.');
    const cooldown = Math.max(store.summary().cooldownUntil, operation.nextAttemptAt ?? 0);
    if (Date.now() < cooldown) throw fault('SNOWFLAKE_COOLDOWN', 'The existing provider cooldown ends at ' + new Date(cooldown).toISOString() + '.', 429);
    const headers = () => {
      const value = { 'user-agent': 'StellarForge-Snowflake/1.0',
        'x-snowflake-authorization-token-type': source.config.tokenType };
      if (!credentialProvider) {
        const token = env[source.config.tokenEnv];
        if (typeof token !== 'string' || !token || token.length > 8100 || /[\x00-\x20\x7f]/.test(token))
          throw fault('SNOWFLAKE_CREDENTIAL_UNAVAILABLE');
        value.authorization = 'Bearer ' + token;
      }
      return value;
    };
    const handler = createUpstreamHandler({ baseUrl: operation.origin, path, method, query: Object.keys(query),
      headers, responseHeaders: ['content-type', 'retry-after'], responseType: 'json', retainErrorResponse: true,
      timeoutMs: source.requestTimeoutMs, maxResponseBytes: source.maxPartitionBytes,
      maxRequestBytes: 1048576, maxInFlight: 1, ...(agent ? { agent } : {}), ...(lookup ? { lookup } : {}),
      ...(credentialProvider ? { credentialProvider } : {}), ...(supplierQuota ? { supplierQuota } : {}) });
    const url = new URL('https://sf30.invalid/source-operation');
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
    const result = await handler({ method, url, pathParams: { statement: operation.statementHandle },
      headers: {}, body, ...(body === undefined ? { bodyPresent: false } : {}), signal });
    const original = Buffer.isBuffer(result.body) ? await store.putObject(result.body) : null;
    const observed = { method, path: path.replace(':statement', operation.statementHandle ?? ''),
      query, status: result.status, upstreamStatus: result.body?.upstreamStatus ?? null,
      dispatched: result[UPSTREAM_ATTEMPT]?.dispatched === true, original,
      error: original ? null : result.body?.error ?? 'SNOWFLAKE_TRANSPORT_FAILED',
      retryAfter: result.headers?.['retry-after'] ?? null };
    const sequence = store.observe(operation.id, observed);
    if (result.status === 429 || result.body?.upstreamStatus === 429 || result.status === 503)
      store.cooldown(retryTime(result.headers, operation.attempts));
    return { ...observed, sequence, value: original ? parse(result.body) : null, headers: result.headers };
  }
  function errorState(operation, response) {
    const status = response.upstreamStatus ?? response.status;
    const terminal = status === 408 || status === 422;
    const auth = status === 401 || status === 403;
    const missing = status === 404;
    return store.updateOperation(operation.id, {
      status: terminal ? 'FAILED' : auth ? 'AUTH_REQUIRED' : missing ? 'RESULT_UNAVAILABLE' : 'INTERRUPTED',
      lastError: { code: response.value?.code ?? response.error ?? 'SNOWFLAKE_REQUEST_FAILED', status, observation: response.sequence,
        ...(typeof response.value?.message === 'string' ? { message: response.value.message } : {}),
        ...(typeof response.value?.sqlState === 'string' ? { sqlState: response.value.sqlState } : {}) },
      nextAttemptAt: !terminal && !auth && !missing ? retryTime(response.headers, operation.attempts) : 0,
    });
  }
  async function retainResult(operation, response, index, { finalizeResult = true } = {}) {
    const { query } = context(operation), value = response.value;
    const statementHandle = operation.statementHandle ?? handleOf(value?.statementHandle);
    if (bodyCode(value) && !['090001', '000000'].includes(bodyCode(value)))
      throw fault('SNOWFLAKE_RESULT_CODE', 'The successful HTTP response does not contain a complete query result.');
    const checked = inspectSnowflakePartition(value, { query, resultMetadata: operation.metadata, index, statementHandle });
    const current = operation.partitions.find(part => part.index === index);
    const part = { index, rows: checked.rows.length, ...response.original, observation: response.sequence };
    if (current && (current.sha256 !== part.sha256 || current.bytes !== part.bytes))
      throw fault('SNOWFLAKE_PARTITION_CHANGED', 'Snowflake returned different bytes for an already retained partition.');
    const parts = [...operation.partitions.filter(item => item.index !== index), part].sort((a, b) => a.index - b.index);
    const totalBytes = parts.reduce((total, item) => total + item.bytes, 0);
    operation = store.updateOperation(operation.id, { statementHandle, metadata: checked.metadata,
      partitions: parts, status: 'FETCHING', nextAttemptAt: 0, lastError: null });
    if (totalBytes > query.maxResultBytes || checked.metadata.numRows > query.maxRows)
      return store.updateOperation(operation.id, { status: 'REJECTED', lastError: {
        code: totalBytes > query.maxResultBytes ? 'SNOWFLAKE_RESULT_BYTES_EXCEEDED' : 'SNOWFLAKE_RESULT_ROWS_EXCEEDED',
        message: 'The declared capture budget was exceeded. The original response remains retained.' } });
    return finalizeResult ? finalize(operation) : operation;
  }
  function finalize(operation) {
    const { query } = context(operation);
    const parts = operation.partitions, totalBytes = parts.reduce((sum, part) => sum + part.bytes, 0);
    const checked = { metadata: operation.metadata };
    if (!checked.metadata || operation.receiving && !operation.receiving.complete) return operation;
    if (checked.metadata.numRows > query.maxRows || totalBytes > query.maxResultBytes)
      return store.updateOperation(operation.id, { status: 'REJECTED', lastError: { code: 'SNOWFLAKE_CAPTURE_BUDGET_EXCEEDED' } });
    const statementHandle = operation.statementHandle;
    const count = Math.max(1, checked.metadata.partitionInfo.length);
    if (parts.length !== count || parts.some((item, position) => item.index !== position)) return operation;
    if (parts.reduce((total, item) => total + item.rows, 0) !== checked.metadata.numRows)
      throw fault('SNOWFLAKE_RESULT_ROW_COUNT_CHANGED');
    const manifest = { schema: 'stellar-forge.snowflake-edition.v1', operationId: operation.id,
      sourceId: operation.sourceId, queryName: operation.queryName, origin: operation.origin, statementHandle,
      requestId: operation.requestId, requestSha256: sha256(canonical(operation.body)),
      metadata: checked.metadata, columns: query.columns, keyColumns: query.keyColumns,
      rowCount: checked.metadata.numRows, partitionCount: count, resultBytes: totalBytes,
      encoding: 'Snowflake SQL API jsonv2; original strings and JSON null',
      outputParameters: operation.body.parameters ?? null, partitions: parts,
      receiptKind: operation.receiptKind ?? 'SQL_API', requestMatchesCompiled: operation.requestMatchesCompiled ?? true, complete: true };
    store.finishEdition(operation.id, manifest);
    return store.operation(operation.id);
  }
  async function oneStep(id, { signal, retry = true } = {}) {
    let operation = store.operation(id); id = operation.id;
    if (operation.metadata && !TERMINAL.has(operation.status)) operation = finalize(operation);
    if (TERMINAL.has(operation.status)) return operation;
    if (operation.receiving && !operation.receiving.complete)
      throw fault('SNOWFLAKE_RECEIVING_INCOMPLETE', 'Reopen the original receiving file to finish verifying its complete partition stream.');
    const isSubmit = !operation.statementHandle;
    if (isSubmit && operation.receiptKind === 'RECEIVED_SQL_API')
      throw fault('SNOWFLAKE_IMPORTED_HANDLE_REQUIRED', 'Receive partition zero from the original remote statement first.');
    const recovering = operation.status !== 'PREPARED';
    if (isSubmit && recovering && !retry)
      throw fault('SNOWFLAKE_RESUME_REQUIRED', 'Resume the original request ID to recover its statement.');
    operation = store.updateOperation(id, { status: isSubmit ? 'SUBMITTING' : operation.metadata ? 'FETCHING' : 'RUNNING',
      attempts: operation.attempts + 1 });
    let response, partition = 0;
    try {
      if (isSubmit) {
        response = await request(operation, 'POST', '/api/v2/statements',
          { requestId: operation.requestId, async: true, ...(recovering ? { retry: true } : {}) }, operation.body, signal);
      } else {
        partition = operation.metadata ? [...Array(Math.max(1, operation.metadata.partitionInfo.length)).keys()]
          .find(index => !operation.partitions.some(part => part.index === index)) : 0;
        if (partition === undefined) throw fault('SNOWFLAKE_EDITION_FINALIZATION_REQUIRED');
        response = await request(operation, 'GET', '/api/v2/statements/:statement',
          { ...(operation.metadata ? { partition } : {}) }, undefined, signal);
      }
      if (!response.original || response.status >= 400) return errorState(operation, response);
      if (response.status === 202) {
        const handle = handleOf(response.value?.statementHandle);
        if (operation.statementHandle && operation.statementHandle !== handle) throw fault('SNOWFLAKE_STATEMENT_CHANGED');
        return store.updateOperation(id, { statementHandle: handle, status: 'RUNNING',
          nextAttemptAt: Date.now() + context(operation).source.pollIntervalMs, lastError: null });
      }
      if (response.status !== 200) throw fault('SNOWFLAKE_RESPONSE_STATUS_UNEXPECTED');
      return await retainResult(store.operation(id), response, isSubmit ? 0 : partition);
    } catch (error) {
      const state = store.operation(id);
      if (TERMINAL.has(state.status)) throw error;
      const protocol = /^(?:SNOWFLAKE_(?:RESULT_(?:SCHEMA|FORMAT|INCOMPLETE|CODE)|PARTITION|STATEMENT_(?:CHANGED|HANDLE)|METADATA))/.test(error.code ?? '');
      store.updateOperation(id, { status: protocol ? 'REJECTED' : 'INTERRUPTED',
        lastError: { code: error.code ?? 'SNOWFLAKE_OPERATION_INTERRUPTED', observation: response?.sequence ?? null },
        ...(error.code === 'SNOWFLAKE_COOLDOWN' ? {} : { nextAttemptAt: Date.now() + 1000 }) });
      throw error;
    }
  }
  async function resume(id, options = {}) {
    check(); id = store.operation(id).id;
    if (active.has(id)) return active.get(id).promise;
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
    const promise = oneStep(id, { ...options, signal: controller.signal }).finally(() => {
      options.signal?.removeEventListener('abort', abort); active.delete(id);
    });
    active.set(id, { promise, controller });
    return promise;
  }
  async function receiveOriginal({ sourceId, queryName, arguments: input = {}, requestId, origin, body, partitions, partitionCount }, signal) {
      check();
      const selected = store.source(sourceId), source = compileSnowflakeSource(selected.config);
      if (!source.queries[queryName] || !body || typeof body.statement !== 'string' || !body.statement.trim() || body.statement.length > 65536 ||
          typeof body !== 'object' || Array.isArray(body))
        throw fault('SNOWFLAKE_IMPORTED_REQUEST_INVALID', 'Retain the original provider request and its declared result columns.');
      const requestMatchesCompiled = canonical(statementBody(source, queryName, input)) === canonical(body);
      const supplied = { ...env, [source.config.accountUrlEnv]: origin };
      if (accountOrigin(source.config, supplied) !== origin || !UUID.test(requestId ?? '') ||
          (!Array.isArray(partitions) && typeof partitions?.[Symbol.asyncIterator] !== 'function') || Array.isArray(partitions) && !partitions.length)
        throw fault('SNOWFLAKE_RECEIVING_INPUT_INVALID');
      const expectedParts = Array.isArray(partitions) ? partitions.length : partitionCount;
      if (!Number.isInteger(expectedParts) || expectedParts < 1 || expectedParts > 20000)
        throw fault('SNOWFLAKE_RECEIVING_PARTITION_COUNT_REQUIRED');
      let operation = store.createOperation({ id: requestId, sourceId: selected.id, queryName, arguments: input, origin, body });
      const alreadyComplete = operation.status === 'COMPLETE';
      if (!alreadyComplete) operation = store.updateOperation(operation.id, {
        receiptKind: 'RECEIVED_SQL_API', requestMatchesCompiled,
        receiving: { expectedParts, complete: false } });
      let index = 0;
      try {
        for await (const bytes of partitions) {
          signal.throwIfAborted();
          if (!(bytes instanceof Uint8Array)) throw fault('SNOWFLAKE_RECEIVING_INPUT_INVALID');
          if (index === 0) {
            const first = parse(bytes), info = first?.resultSetMetaData?.partitionInfo;
            if (!Array.isArray(info) || Math.max(1, info.length) !== expectedParts)
              throw fault('SNOWFLAKE_RECEIVING_PARTITION_COUNT_CHANGED', 'The supplied partition list must exactly cover the original result metadata.');
          }
          if (index >= expectedParts) throw fault('SNOWFLAKE_RECEIVING_PARTITION_COUNT_CHANGED');
          if (alreadyComplete) {
            if (!operation.partitions[index] || sha256(bytes) !== operation.partitions[index].sha256)
              throw fault('SNOWFLAKE_IMPORTED_PARTITIONS_CHANGED');
          } else {
            const original = await store.putObject(bytes);
            const sequence = store.observe(operation.id, { method: 'RECEIVED', partition: index, original, status: 200 });
            operation = await retainResult(store.operation(operation.id),
              { value: parse(bytes), original, sequence }, index, { finalizeResult: false });
            if (operation.status === 'REJECTED') return operation;
          }
          index++;
        }
        if (index !== expectedParts || index !== operation.partitions.length)
          throw fault('SNOWFLAKE_RECEIVING_PARTITIONS_MISSING');
        signal.throwIfAborted();
        if (!alreadyComplete) {
          // Commit stream closure before creating its edition. A journal reopen can
          // finish locally after this point without another provider request.
          operation = store.updateOperation(operation.id, { receiving: { expectedParts, complete: true } });
          operation = finalize(operation);
        }
        if (operation.status !== 'COMPLETE')
          throw fault('SNOWFLAKE_RECEIVING_PARTITIONS_MISSING', 'The original provider result includes more partitions.');
        return operation;
      } catch (error) {
        const current = store.operation(operation.id);
        if (!alreadyComplete && !TERMINAL.has(current.status))
          store.updateOperation(operation.id, { status: 'INTERRUPTED', nextAttemptAt: 0,
            lastError: { code: error.code ?? 'SNOWFLAKE_RECEIVING_INTERRUPTED' } });
        throw error;
      }
  }
  return {
    begin({ sourceId, queryName, arguments: input = {}, requestId = randomUUID() }) {
      check(); const selected = store.source(sourceId), source = compileSnowflakeSource(selected.config);
      const body = statementBody(source, queryName, input);
      return store.createOperation({ id: requestId, sourceId: selected.id, queryName, arguments: input,
        origin: accountOrigin(source.config, env), body });
    },
    resume,
    async complete(id, { signal, onProgress } = {}) {
      check();
      while (true) {
        signal?.throwIfAborted();
        const current = store.operation(id);
        if (TERMINAL.has(current.status)) return current;
        const wait = Math.max(current.nextAttemptAt ?? 0, store.summary().cooldownUntil) - Date.now();
        if (wait > 0) await delay(Math.min(wait, 30000), undefined, { signal });
        if (Date.now() < Math.max(store.operation(id).nextAttemptAt ?? 0, store.summary().cooldownUntil)) continue;
        const result = await resume(id, { signal });
        await onProgress?.(result);
        if (['INTERRUPTED', 'AUTH_REQUIRED', 'RESULT_UNAVAILABLE'].includes(result.status)) return result;
      }
    },
    async cancel(id, { signal } = {}) {
      check(); id = store.operation(id).id;
      let running = active.get(id);
      if (running?.kind === 'cancel') return running.promise;
      if (running) { running.controller.abort(); await running.promise.catch(() => {}); }
      check();
      running = active.get(id);
      if (running?.kind === 'cancel') return running.promise;
      const controller = new AbortController();
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const promise = (async () => {
        let operation = store.operation(id);
        if (TERMINAL.has(operation.status)) return operation;
        if (!operation.statementHandle)
          throw fault('SNOWFLAKE_HANDLE_REQUIRED', 'Resume this original request once to recover its statement handle, then cancel it.');
        operation = store.updateOperation(id, { cancelRequestId: operation.cancelRequestId ?? randomUUID(), status: 'CANCELLING' });
        const response = await request(operation, 'POST', '/api/v2/statements/:statement/cancel',
          { requestId: operation.cancelRequestId }, {}, combined);
        if (response.status === 200 && response.value?.code === '000604' &&
            handleOf(response.value.statementHandle) === operation.statementHandle)
          return store.updateOperation(id, { status: 'CANCELLED', cancellationObservation: response.sequence, nextAttemptAt: 0 });
        return errorState(operation, response);
      })().finally(() => { if (active.get(id)?.promise === promise) active.delete(id); });
      active.set(id, { kind: 'cancel', controller, promise });
      return promise;
    },
    /** Receive the exact original responses produced by the SAME selected remote
     * account operation. This does not make a second provider request. */
    receive(input) {
      check();
      if (!UUID.test(input.requestId ?? '')) return Promise.reject(fault('SNOWFLAKE_OPERATION_ID_INVALID'));
      const id = input.requestId.toLowerCase();
      if (active.has(id)) return Promise.reject(fault('SNOWFLAKE_OPERATION_RUNNING', 'The original operation is receiving a response.', 409));
      const controller = new AbortController();
      const promise = receiveOriginal(input, controller.signal).finally(() => active.delete(id));
      active.set(id, { promise, controller }); return promise;
    },
    status() { return { active: [...active.keys()], closed }; },
    async close() {
      if (closed) return; closed = true;
      for (const entry of active.values()) entry.controller.abort();
      await Promise.allSettled([...active.values()].map(entry => entry.promise));
    },
  };
}
