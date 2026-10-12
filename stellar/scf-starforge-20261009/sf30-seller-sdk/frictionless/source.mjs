// MIT. Trusted Python bridge into the original dataset publisher.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { object, identity, fault } from '../postgres/publisher/files.mjs';

const PROGRAM = fileURLToPath(new URL('./package.py', import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const errorCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value) ? value : 'PACKAGE_PROCESS_FAILED';

async function runPython(args, { env = process.env, timeoutMs = 300000, signal, onRecord, stdout = process.stdout } = {}) {
  if (!Array.isArray(args) || args.some(v => typeof v !== 'string')) throw fault('PACKAGE_ARGUMENTS_INVALID');
  if (signal?.aborted) throw fault('PACKAGE_CANCELLED');
  const python = env.SF_FRICTIONLESS_PYTHON || 'python3';
  const child = spawn(python, ['-B', '-u', PROGRAM, ...args], {
    env: { ...env, PYTHONDONTWRITEBYTECODE: '1' }, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '', timedOut = false, cancelled = false, killTimer, spawnError;
  const closed = new Promise(resolve => {
    child.once('error', issue => { spawnError = issue; });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-32768); });
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 3000);
      killTimer.unref();
    }
  };
  const abort = () => { cancelled = true; stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  timer.unref();
  let output = '', pending = '', total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const data of child.stdout) {
      if (signal?.aborted) abort();
      const text = decoder.decode(data, { stream: true });
      if (onRecord) {
        pending += text;
        let line;
        while ((line = pending.indexOf('\n')) !== -1) {
          const value = pending.slice(0, line); pending = pending.slice(line + 1);
          if (!value || value.length > 16777216) throw fault('PACKAGE_PROTOCOL_RECORD_INVALID');
          await onRecord(JSON.parse(value));
        }
        if (pending.length > 16777216) throw fault('PACKAGE_PROTOCOL_RECORD_TOO_LARGE');
      } else if (stdout === null) {
        total += data.length;
        if (total > 16777216) throw fault('PACKAGE_RESPONSE_TOO_LARGE');
        output += text;
      } else {
        if (!stdout.write(data)) await new Promise(resolve => stdout.once('drain', resolve));
      }
    }
    const remainder = decoder.decode();
    if (onRecord && (pending + remainder).length) throw fault('PACKAGE_PROTOCOL_TRUNCATED');
    if (!onRecord && stdout === null) output += remainder;
    const ended = await closed;
    if (timedOut) throw fault('PACKAGE_PROCESS_TIMEOUT');
    if (cancelled) throw fault('PACKAGE_CANCELLED');
    if (spawnError) throw fault('PACKAGE_PYTHON_UNAVAILABLE', 'Select an installed Python 3 runtime with SF_FRICTIONLESS_PYTHON.');
    if (ended.code !== 0) {
      let record;
      try { record = JSON.parse(stderr.trim().split('\n').at(-1)); } catch {}
      throw fault(errorCode(record?.error), record?.message || 'The retained package operation did not complete.');
    }
    return stdout === null && !onRecord ? JSON.parse(output) : undefined;
  } catch (issue) {
    stop(); await closed;
    if (timedOut) throw fault('PACKAGE_PROCESS_TIMEOUT');
    if (cancelled) throw fault('PACKAGE_CANCELLED');
    throw issue;
  } finally {
    clearTimeout(timer); clearTimeout(killTimer);
    signal?.removeEventListener('abort', abort);
  }
}

export function runFrictionlessCommand(argv, options = {}) { return runPython(argv, options); }
export function inspectFrictionlessSource(sourceFile, { env = process.env } = {}) {
  return runPython(['inspect-source', '--source', resolve(sourceFile)], { env, stdout: null });
}

export function checkFrictionlessColumnTypes(columns, types) {
  if (!object(columns) || !Array.isArray(types)) throw fault('PACKAGE_COLUMN_TYPES_INVALID');
  const names = new Set();
  const byName = new Map(types.map(field => {
    if (!object(field) || names.has(field.name)) throw fault('PACKAGE_COLUMN_TYPES_INVALID');
    names.add(field.name); return [field.name, field];
  }));
  for (const [name, spec] of Object.entries(columns)) {
    const source = byName.get(name);
    if (!source || spec.type !== source.type || (spec.nullable ?? false) !== source.nullable)
      throw fault('PACKAGE_DATASET_PROJECTION_MISMATCH', 'Use the reviewed type and missing-value choice for ' + name + '.');
  }
}

export function encodeFrictionlessRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const value = row[name];
    if (value === null) {
      if (!spec.nullable) throw fault('PACKAGE_DATASET_NULL_NOT_ALLOWED');
      return '';
    }
    if (typeof value !== 'string' || value.length > dataset.maxCellChars)
      throw fault('PACKAGE_DATASET_CELL_INVALID');
    if (value === '' && spec.nullable) throw fault('PACKAGE_EMPTY_NULL_CONFLICT');
    if (spec.type === 'integer' && (!/^-?(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))))
      throw fault('PACKAGE_INTEGER_REQUIRES_EXACT_STRING');
    if (spec.type === 'number' && (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(value) || !Number.isFinite(Number(value))))
      throw fault('PACKAGE_NUMBER_REQUIRES_EXACT_STRING');
    if (spec.type === 'boolean' && !['true', 'false'].includes(value)) throw fault('PACKAGE_BOOLEAN_PROJECTION_INVALID');
    return value;
  }));
}

export async function openFrictionlessSourceFile(sourceFile, { env = process.env } = {}) {
  sourceFile = resolve(sourceFile);
  const selected = await inspectFrictionlessSource(sourceFile, { env });
  if (!HASH.test(selected.captureSha256 ?? '') || !object(selected.queries)) throw fault('PACKAGE_SOURCE_RESPONSE_INVALID');
  const columnTypes = Object.fromEntries(Object.entries(selected.queries).map(([name, query]) =>
    [name, Object.entries(query.projection).map(([alias, spec]) => ({
      name: alias, type: spec.type, nullable: spec.missing === 'null',
    }))]));
  let active = null, isClosed = false;
  const source = {
    inspect() { return { sourceName: 'Frictionless Data Package', queries: selected.queries, columnTypes }; },
    async exportDataset(name, input = {}, supplied = {}) {
      if (isClosed || active) throw fault(isClosed ? 'PACKAGE_SOURCE_CLOSED' : 'PACKAGE_SOURCE_BUSY');
      const query = selected.queries[name];
      if (!query) throw fault('QUERY_NOT_FOUND');
      if (!object(input) || Object.keys(input).length) throw fault('PACKAGE_QUERY_INPUT_NOT_SUPPORTED');
      const { onRow, signal, ...limits } = supplied;
      if (typeof onRow !== 'function') throw fault('PACKAGE_ROW_CALLBACK_REQUIRED');
      const options = datasetExtractionOptions(query, limits);
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      let header = false, complete = null, count = 0, sourceTextBytes = 0;
      const operation = { controller, promise: null };
      active = operation;
      operation.promise = runPython(['export-rows', '--source', sourceFile, '--query', name,
        '--options', JSON.stringify(options)], { env, timeoutMs: options.timeoutMs, signal: controller.signal,
        onRecord: async record => {
          if (!object(record) || complete) throw fault('PACKAGE_PROTOCOL_ORDER_INVALID');
          if (record.kind === 'header') {
            if (header || identity(record.columnTypes) !== identity(columnTypes[name])) throw fault('PACKAGE_PROJECTION_CHANGED');
            header = true; return;
          }
          if (!header) throw fault('PACKAGE_PROTOCOL_HEADER_REQUIRED');
          if (record.kind === 'row') {
            if (!object(record.row) || record.rowCount !== count + 1 || count >= options.maxRows ||
                identity(Object.keys(record.row)) !== identity(query.columns) ||
                Object.values(record.row).some(value => value !== null && typeof value !== 'string'))
              throw fault('PACKAGE_PROTOCOL_ROW_INVALID');
            const rowBytes = Object.values(record.row).reduce((total, value) => total + (value === null ? 0 : Buffer.byteLength(value)), 0);
            sourceTextBytes += rowBytes;
            if (rowBytes > options.maxRowBytes || sourceTextBytes > options.maxBytes) throw fault('PACKAGE_EXTRACTION_BYTE_LIMIT');
            await onRow(record.row, columnTypes[name], { rowCount: count + 1, sourceTextBytes });
            count++; return;
          }
          if (record.kind !== 'complete') throw fault('PACKAGE_PROTOCOL_RECORD_INVALID');
          complete = record.extraction;
          if (!complete || complete.schema !== 'stellar-forge.frictionless-extraction.v1' ||
              complete.captureSha256 !== selected.captureSha256 || !HASH.test(complete.descriptorSha256 ?? '') ||
              complete.resource !== query.resource || complete.query !== name || complete.rowCount !== count ||
              complete.sourceTextBytes !== sourceTextBytes || identity(complete.columnTypes) !== identity(columnTypes[name]) ||
              identity(complete.columns) !== identity(query.columns) || identity(complete.order) !== identity(options.order))
            throw fault('PACKAGE_EXTRACTION_BINDING_CHANGED');
        },
      });
      try {
        await operation.promise;
        if (!complete) throw fault('PACKAGE_EXTRACTION_INCOMPLETE');
        return complete;
      } finally {
        signal?.removeEventListener('abort', abort);
        if (active === operation) active = null;
      }
    },
    async close() {
      isClosed = true;
      if (active) { active.controller.abort(); try { await active.promise; } catch {} }
    },
  };
  return { source, config: selected.config };
}
