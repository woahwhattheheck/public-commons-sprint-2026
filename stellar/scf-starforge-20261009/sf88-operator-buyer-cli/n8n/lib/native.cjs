// MIT — n8n calls the installed original SF88 customer inbox.
'use strict';

const { join, isAbsolute } = require('node:path');
const { pathToFileURL } = require('node:url');
const { realpath } = require('node:fs/promises');

const SCHEMA = 'stellar-forge.n8n-buyer.v1';
const MAX_ITEM_BYTES = 64 * 1024 * 1024;
const ACTIONS = new Set(['list', 'show', 'inspectHandoff', 'enqueueHandoff',
  'enqueuePrepared', 'enqueueConfig', 'review', 'recover', 'cancel',
  'finalize', 'response', 'report']);

class AdapterError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'StarforgeBuyerError';
    this.code = code;
    Object.assign(this, details);
  }
}
const need = (condition, code) => { if (!condition) throw new AdapterError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const codeOf = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,120}$/.test(error.code)
  ? error.code : 'NATIVE_INBOX_OPERATION_FAILED';

function integer(value, minimum, maximum, code) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum, code);
  return value;
}
function required(value, code) {
  need(typeof value === 'string' && value.length > 0 && !value.includes('\0'), code);
  return value;
}
function safeName(value, fallback) {
  const name = value || fallback;
  need(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(name) &&
    name !== '.' && name !== '..', 'EXPORT_FILENAME_INVALID');
  return name;
}
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

async function openNative(credentials, context) {
  need(plain(credentials), 'ORIGINAL_WORKSPACE_CONFIGURATION_REQUIRED');
  const runtimeDirectory = required(credentials.runtimeDirectory, 'ORIGINAL_RUNTIME_DIRECTORY_REQUIRED');
  need(isAbsolute(runtimeDirectory), 'ABSOLUTE_RUNTIME_DIRECTORY_REQUIRED');
  // The runtime supplies the maintained SDK, validation and immutable file helper.
  const sdk = await import(pathToFileURL(join(runtimeDirectory, 'node', 'index.mjs')).href);
  const store = await import(pathToFileURL(join(runtimeDirectory, 'node', 'store.mjs')).href);
  need(typeof sdk.Buyer === 'function' && typeof store.privateDirectory === 'function' &&
    typeof store.writeBytes === 'function', 'ORIGINAL_NODE_BUYER_RUNTIME_REQUIRED');
  const paths = {
    runtimeDirectory: store.absolute(runtimeDirectory),
    stateDirectory: store.absolute(required(credentials.stateDirectory, 'ORIGINAL_NODE_STATE_REQUIRED')),
    inboxDirectory: store.absolute(required(credentials.inboxDirectory, 'ORIGINAL_INBOX_REQUIRED')),
  };
  // Opening a node must not silently initialize a replacement application/inbox.
  await store.privateDirectory(paths.stateDirectory, { create: false });
  await store.privateDirectory(paths.inboxDirectory, { create: false });
  need(await realpath(paths.stateDirectory) === paths.stateDirectory,
    'CANONICAL_NODE_STATE_DIRECTORY_REQUIRED');
  for (const name of ['operatorProfile', 'workspaceDirectory', 'outboxDirectory', 'reportDirectory']) {
    if (credentials[name]) paths[name] = store.absolute(credentials[name]);
  }
  const timeoutMs = integer(credentials.timeoutMs ?? 360000, 1000, 3600000, 'NATIVE_TIMEOUT_INVALID');
  const buyer = new sdk.Buyer({
    runtimeDirectory: paths.runtimeDirectory,
    stateDirectory: paths.stateDirectory,
    ...(paths.operatorProfile ? { operatorProfile: paths.operatorProfile } : {}),
    timeoutMs,
  });
  const inbox = buyer.inbox(paths.inboxDirectory);
  const controller = new AbortController();
  const parentSignal = context.signal;
  const abort = () => controller.abort();
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener('abort', abort, { once: true });
  const stop = () => parentSignal?.removeEventListener('abort', abort);
  return { sdk, store, buyer, inbox, paths, signal: controller.signal, stop };
}

function envelope(operation, native, extra = {}) {
  return {
    schema: SCHEMA,
    operation,
    ...(native?.operation?.intentId ? { intentId: native.operation.intentId } : {}),
    native,
    ...extra,
  };
}
function fromResult(operation, result, extra = {}) {
  return envelope(operation, result.native, {
    process: result.process,
    ...(result.commandDirectory ? { commandDirectory: result.commandDirectory } : {}),
    ...extra,
  });
}
async function publishBytes(native, directoryName, raw, suffix) {
  const { store, paths } = native;
  const directory = await store.privateDirectory(join(paths.stateDirectory, directoryName));
  const sha256 = store.digest(raw);
  const file = join(directory, sha256 + suffix);
  try { await store.writeBytes(file, raw, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await store.readBytes(file, raw.length);
    need(existing.length === raw.length && store.digest(existing) === sha256,
      'RETAINED_INPUT_CHANGED');
  }
  return { path: file, bytes: raw.length, sha256 };
}
async function packet(native, params) {
  const original = await import(pathToFileURL(join(native.paths.runtimeDirectory,
    'operation-handoff.mjs')).href);
  const maximum = original.OPERATION_HANDOFF_MAX_BYTES;
  need(Number.isSafeInteger(maximum) && maximum > 0, 'ORIGINAL_HANDOFF_LIMIT_REQUIRED');
  if (params.packetSource === 'file') {
    const path = native.store.absolute(required(params.packetFile, 'HANDOFF_FILE_REQUIRED'));
    // The native reader validates private ownership, canonical paths and bytes.
    return { path };
  }
  let raw;
  if (params.packetSource === 'binary') {
    need(params.packetBytes instanceof Uint8Array, 'HANDOFF_BINARY_REQUIRED');
    raw = Buffer.from(params.packetBytes);
  } else if (params.packetSource === 'json') {
    need(typeof params.packetJson === 'string' || plain(params.packetJson), 'HANDOFF_JSON_REQUIRED');
    raw = typeof params.packetJson === 'string'
      ? Buffer.from(params.packetJson, 'utf8') : native.store.jsonBytes(params.packetJson);
  } else throw new AdapterError('HANDOFF_SOURCE_REQUIRED');
  need(raw.length > 0 && raw.length <= maximum, 'OPERATION_HANDOFF_FILE_TOO_LARGE');
  return publishBytes(native, 'n8n-packets', raw, '.handoff.json');
}
function command(native, intentId, reviewFile) {
  const argv = [
    join(native.paths.runtimeDirectory, 'node', 'examples', 'customer.mjs'),
    'inbox-execute',
    '--runtime', native.paths.runtimeDirectory,
    '--state', native.paths.stateDirectory,
    '--inbox', native.paths.inboxDirectory,
    '--intent', intentId,
    '--review-file', reviewFile,
    ...(native.paths.workspaceDirectory ? ['--workspace', native.paths.workspaceDirectory] : []),
  ];
  return {
    program: process.execPath,
    argv,
    posixCommand: [process.execPath, ...argv].map(quote).join(' '),
    reviewFile,
    approval: 'ORIGINAL_OPERATOR_TERMINAL',
  };
}
function readOptions(params, signal) {
  return {
    limit: integer(params.readLimit ?? 8388608, 0, MAX_ITEM_BYTES, 'N8N_READ_LIMIT_INVALID'),
    signal,
  };
}

async function consumeResponse(native, intentId, params) {
  const { inbox, signal } = native;
  const response = await inbox.response(intentId, { signal });
  if (!response) {
    const current = await inbox.show(intentId, { signal });
    return { json: fromResult('response', current, {
      intentId, responseAvailable: false, response: null,
    }) };
  }
  const format = params.responseFormat || 'binary';
  need(['binary', 'json', 'csv', 'ndjson', 'sse'].includes(format), 'RESPONSE_FORMAT_REQUIRED');
  const options = readOptions(params, signal);
  const source = {
    status: response.status,
    delivery: response.delivery,
    stream: response.stream,
  };
  const json = envelope('response', response.job, {
    intentId, responseAvailable: true, response: source, format,
  });
  // Native consumer completes its digest checks before this function emits an item.
  if (format === 'binary') {
    const data = await response.bytes(options);
    return { json, binary: {
      data,
      fileName: safeName(params.filename, intentId + '.bin'),
      mimeType: response.delivery.contentType || 'application/octet-stream',
    } };
  }
  if (format === 'json') {
    json.data = await response.json(options);
    return { json };
  }
  const maxRecords = integer(params.maxRecords ?? 10000, 1, 1000000, 'N8N_RECORD_LIMIT_INVALID');
  // n8n items are in-memory; native capture/stream ceilings remain unchanged.
  const metadata = response.delivery;
  need(Number.isSafeInteger(metadata.bytes) && metadata.bytes >= 0 &&
    metadata.bytes <= options.limit, 'N8N_READ_LIMIT_EXCEEDED');
  let iterator;
  if (format === 'csv') {
    need(typeof (params.csvHeaders ?? true) === 'boolean', 'CSV_OPTIONS_INVALID');
    iterator = response.csvRows({ headers: params.csvHeaders ?? true, signal });
  } else {
    const streamOptions = {
      signal, maxRecords,
      allowPartial: params.allowPartial === true,
      ...(params.maxRecordBytes === undefined ? {} : {
        maxRecordBytes: integer(params.maxRecordBytes, 1, MAX_ITEM_BYTES, 'N8N_RECORD_SIZE_INVALID'),
      }),
    };
    iterator = format === 'ndjson' ? response.ndjson(streamOptions) : response.events(streamOptions);
  }
  const records = [];
  for await (const record of iterator) {
    need(records.length < maxRecords, 'N8N_RECORD_LIMIT_EXCEEDED');
    records.push(record);
  }
  json.records = records;
  json.recordCount = records.length;
  json.completeFile = response.delivery.status === 'SAVED';
  // Partial streams retain the native partial/hash/boundary facts, never SAVED.
  return { json };
}

async function exportHistory(native, params, context) {
  const { store, paths, inbox, signal } = native;
  const directory = paths.reportDirectory
    ? await store.privateDirectory(paths.reportDirectory, { create: false })
    : await store.privateDirectory(join(paths.stateDirectory, 'n8n-reports'));
  const key = String(context.executionId || Date.now()).replace(/[^A-Za-z0-9._-]/g, '_').slice(0,80);
  const fileName = safeName(params.reportFilename, 'buyer-history-' + key + '.html');
  const destination = join(directory, fileName);
  const result = await inbox.exportReport(destination, {
    ...(paths.workspaceDirectory ? { workspaceDirectory: paths.workspaceDirectory } : {}),
    signal,
  });
  const saved = result.native;
  need(saved.path === destination && Number.isSafeInteger(saved.bytes) && saved.bytes >= 0 &&
    typeof saved.sha256 === 'string', 'ORIGINAL_REPORT_METADATA_INVALID');
  const limit = readOptions(params, signal).limit;
  const data = await store.readBytes(destination, limit);
  need(data.length === saved.bytes && store.digest(data) === saved.sha256,
    'ORIGINAL_REPORT_CHANGED');
  return {
    json: fromResult('report', result),
    binary: { data, fileName, mimeType: 'text/html' },
  };
}

async function executeOperation(credentials, operation, params = {}, context = {}) {
  need(ACTIONS.has(operation), 'INBOX_OPERATION_REQUIRED');
  const native = await openNative(credentials, context);
  const { inbox, buyer, paths, store, signal } = native;
  try {
    if (operation === 'list') return { json: fromResult(operation, await inbox.list({ signal })) };
    if (operation === 'inspectHandoff' || operation === 'enqueueHandoff') {
      const selected = operation === 'enqueueHandoff'
        ? integer(params.acceptIndex, 0, 31, 'EXPLICIT_SELECTION_INDEX_REQUIRED') : undefined;
      const saved = await packet(native, params);
      const inspected = await buyer.inspectOperationHandoff(saved.path, {
        ...(selected === undefined ? {} : { accept: selected }), signal,
      });
      if (saved.sha256) need(inspected.handoffSha256 === saved.sha256, 'RETAINED_INPUT_CHANGED');
      if (operation === 'inspectHandoff') return { json: {
        schema: SCHEMA, operation, intentId: inspected.intentId, packet: inspected,
      } };
      need(paths.operatorProfile, 'ORIGINAL_OPERATOR_PROFILE_REQUIRED');
      // Existing intent is intentionally not imported again. The native error
      // retains that intent; enqueuePrepared completes an interrupted prior intake.
      let prepared;
      try {
        prepared = await buyer.fromOperationHandoff(saved.path, {
          accept: selected, signal,
          ...(params.responseMaxBytes === undefined ? {} : {
            responseFile: {
              maxBytes: integer(params.responseMaxBytes, 0, 1073741824, 'RESPONSE_CAPTURE_LIMIT_INVALID'),
            },
          }),
        });
      } catch (error) {
        error.intentId = inspected.intentId;
        error.packetSha256 = inspected.handoffSha256;
        throw error;
      }
      let result;
      try { result = await inbox.enqueue(prepared, { signal }); }
      catch (error) { error.intentId = prepared.intentId; error.packetSha256 = inspected.handoffSha256; throw error; }
      return { json: fromResult(operation, result, {
        intentId: prepared.intentId, packet: inspected,
      }) };
    }
    if (operation === 'enqueueConfig') {
      const result = await inbox.enqueueConfig(store.absolute(required(params.configFile,
        'ORIGINAL_CONFIGURATION_FILE_REQUIRED')), { signal });
      return { json: fromResult(operation, result) };
    }
    if (operation === 'report') return await exportHistory(native, params, context);
    const intentId = store.intent(params.intentId);
    if (operation === 'enqueuePrepared') {
      const result = await inbox.enqueue(buyer.operation(intentId), { signal });
      return { json: fromResult(operation, result, { intentId }) };
    }
    if (operation === 'review') {
      const review = await inbox.review(intentId, { signal });
      const current = await inbox.show(intentId, { signal });
      const ready = current.native.state === 'QUEUED' && !current.native.attempt;
      const saved = await publishBytes(native, 'n8n-reviews', store.jsonBytes(review), '.review.json');
      return { json: fromResult(operation, current, {
        intentId, review,
        operatorHandoff: ready ? command(native, intentId, saved.path) : null,
        reviewFile: saved,
      }) };
    }
    if (operation === 'response') return await consumeResponse(native, intentId, params);
    if (operation === 'finalize') {
      need(paths.workspaceDirectory, 'ORIGINAL_OPERATOR_WORKSPACE_REQUIRED');
      need(Boolean(paths.outboxDirectory) === Boolean(params.merchantRoute),
        'ORIGINAL_OUTBOX_AND_MERCHANT_ROUTE_REQUIRED_TOGETHER');
      const result = await inbox.finalize(intentId, {
        workspaceDirectory: paths.workspaceDirectory,
        ...(paths.outboxDirectory ? { outboxDirectory: paths.outboxDirectory,
          merchantRoute: required(params.merchantRoute, 'MERCHANT_ROUTE_REQUIRED') } : {}),
        signal,
      });
      return { json: fromResult(operation, result, { intentId }) };
    }
    const result = await inbox[operation](intentId, { signal });
    return { json: fromResult(operation, result, { intentId }) };
  } finally {
    native.stop();
  }
}

function errorItem(error, operation, intentId) {
  return {
    schema: SCHEMA,
    operation,
    ...(error.intentId || intentId ? { intentId: error.intentId || intentId } : {}),
    error: { code: codeOf(error) },
    ...(error.packetSha256 ? { packetSha256: error.packetSha256 } : {}),
    ...(error.result ? { native: error.result.native, process: error.result.process } : {}),
    ...(error.commandDirectory ? { commandDirectory: error.commandDirectory } : {}),
    retry: 'NO_AUTOMATIC_RETRY',
  };
}

module.exports = { executeOperation, errorItem, AdapterError, SCHEMA };
