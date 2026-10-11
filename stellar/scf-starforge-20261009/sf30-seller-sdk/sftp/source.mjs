// MIT. Full retained SFTP bytes feed the original typed CSV publisher.
import { resolve, join } from 'node:path';
import { validateSftpSource, bindSftpParameters, relativePath, pointerParts, fail } from './config.mjs';
import { createSftpTransport, catalogueRemote, captureRemote } from './transport.mjs';
import { readSourceRecords, projectRecord, matchesWhere, sampleColumns, suggestedColumns } from './formats.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';

export const describeSftpQuery = query => ({ path: query.path, format: query.format, recordsPointer: query.recordsPointer,
  ...(query.expectedSha256 ? { expectedSha256: query.expectedSha256 } : {}),
  columns: [...query.columns], columnTypes: Object.entries(query.mapping).map(([name, spec]) => ({ name, type: spec.type, nullable: spec.nullable })),
  mapping: structuredClone(query.mapping), parameters: structuredClone(query.parameters),
  parameterOrder: [...query.parameterOrder], where: structuredClone(query.where) });
const columnTypes = query => Object.fromEntries(Object.entries(query.mapping).map(([name, spec]) =>
  [name, { type: spec.type, nullable: spec.nullable, counts: {}, sourceTypes: {} }]));
export function sftpDatasetExtractionOptions(query, supplied) {
  try { return datasetExtractionOptions(query, supplied); }
  catch (issue) { throw fail(issue.code ?? 'DATASET_EXTRACTION_OPTIONS_INVALID', issue.message); }
}
function countRow(types, row, observed) {
  for (const [name, value] of Object.entries(row)) {
    const type = value === null ? 'null' : typeof value;
    types[name].counts[type] = (types[name].counts[type] ?? 0) + 1;
    const source = observed[name]; types[name].sourceTypes[source] = (types[name].sourceTypes[source] ?? 0) + 1;
  }
}
function compareRows(order) {
  return (a, b) => {
    for (const { column, direction } of order) {
      const left = a.row[column], right = b.row[column];
      if (left === right || Object.is(left, right)) continue;
      if (left === null) return 1;
      if (right === null) return -1;
      const comparison = left < right ? -1 : 1;
      return direction === 'asc' ? comparison : -comparison;
    }
    return a.sourceOrdinal - b.sourceOrdinal;
  };
}

export function createSftpSource(declaration, { env = process.env, baseDirectory = process.cwd(),
  captureDirectory = join(baseDirectory, 'sftp-captures'), validated = false } = {}) {
  const config = validated ? declaration : validateSftpSource(declaration);
  const transport = createSftpTransport(config, { env, baseDirectory });
  const captures = resolve(captureDirectory); let tail = Promise.resolve(), closed = false;
  const enqueue = operation => {
    if (closed) return Promise.reject(fail('SFTP_SOURCE_CLOSED'));
    const pending = tail.then(() => { if (closed) throw fail('SFTP_SOURCE_CLOSED'); return operation(); });
    tail = pending.catch(() => {}); return pending;
  };
  function inspect() {
    return { schema: 'stellar-forge.sftp-source-inspection.v1', readOnly: true,
      connection: { host: config.connection.host, port: config.connection.port, username: config.connection.username,
        hostKeyFingerprints: [...config.connection.hostKeyFingerprints], authenticationReferences: { ...config.connection.auth } },
      root: config.root, limits: { ...config.limits },
      queries: Object.fromEntries(Object.entries(config.queries).map(([name, query]) => [name, describeSftpQuery(query)])),
      columnTypes: Object.fromEntries(Object.entries(config.queries).map(([name, query]) => [name, columnTypes(query)])) };
  }
  const capture = (path, options) => captureRemote(transport, config, captures, path, options);
  function catalogue(options) { return enqueue(() => catalogueRemote(transport, config, options)); }
  function captureFile(path, options = {}) { return enqueue(async () => (await capture(path, options)).receipt); }
  function sampleFile({ path, format, recordsPointer = '', limit = 20, expectedSha256, signal } = {}) {
    path = relativePath(path); pointerParts(recordsPointer);
    if (!['csv', 'json', 'ndjson'].includes(format) || format !== 'json' && recordsPointer !== '') throw fail('SFTP_FORMAT_INVALID');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw fail('SFTP_SAMPLE_LIMIT_INVALID');
    return enqueue(async () => {
      const captured = await capture(path, { signal, expectedSha256 });
      const rows = []; let recordCount = 0;
      for await (const row of readSourceRecords(captured.file, format, { recordsPointer, maxRowBytes: config.limits.maxRowBytes, signal,
        expectedSha256: captured.receipt.sha256, expectedBytes: captured.receipt.bytes })) {
        if (rows.length < limit) rows.push(row); recordCount++;
      }
      const columns = sampleColumns(rows);
      return { schema: 'stellar-forge.sftp-sample.v1', path, format, recordsPointer,
        capture: captured.receipt, columns, suggestedColumns: suggestedColumns(columns),
        rows: JSON.parse(JSON.stringify(rows)), sampledRows: rows.length, limit, recordCount, complete: recordCount <= limit,
        columnObservation: { scope: 'first-records', records: rows.length, numericTokens: 'exact strings in sample rows' } };
    });
  }
  function exportDataset(name, input = {}, { signal, onRow, ...supplied } = {}) {
    const query = config.queries[name]; if (!query) throw fail('QUERY_NOT_FOUND');
    if (typeof onRow !== 'function') throw fail('DATASET_ROW_WRITER_REQUIRED');
    const values = bindSftpParameters(query, input), limits = sftpDatasetExtractionOptions(query, supplied);
    return enqueue(async () => {
      const startedAt = new Date().toISOString();
      const abort = AbortSignal.any([AbortSignal.timeout(limits.timeoutMs), ...(signal ? [signal] : [])]);
      const captured = await capture(query.path, { signal: abort, expectedSha256: query.expectedSha256 });
      const selected = [], types = columnTypes(query); let inputRowCount = 0, sourceTextBytes = 0;
      try {
        for await (const raw of readSourceRecords(captured.file, query.format,
          { recordsPointer: query.recordsPointer, maxRowBytes: config.limits.maxRowBytes, signal: abort,
            expectedSha256: captured.receipt.sha256, expectedBytes: captured.receipt.bytes })) {
          abort.throwIfAborted(); inputRowCount++;
          const { row, observed } = projectRecord(raw, query);
          if (!matchesWhere(row, query, values)) continue;
          if (selected.length >= limits.maxRows) throw fail('DATASET_EXTRACTION_TOO_MANY_ROWS');
          const size = Buffer.byteLength(csvLine(query.columns.map(column => row[column] === null ? '' : String(row[column]))));
          if (size > limits.maxRowBytes) throw fail('DATASET_EXTRACTION_ROW_TOO_LARGE');
          sourceTextBytes += size;
          if (sourceTextBytes > limits.maxBytes) throw fail('DATASET_EXTRACTION_TOO_MANY_BYTES');
          selected.push({ row, observed, sourceOrdinal: inputRowCount });
        }
        abort.throwIfAborted(); selected.sort(compareRows(limits.order)); abort.throwIfAborted();
        let rowCount = 0;
        for (const { row, observed, sourceOrdinal } of selected) {
          abort.throwIfAborted(); countRow(types, row, observed);
          await onRow(row, types, { rowCount: rowCount + 1, sourceOrdinal, sourceTextBytes });
          rowCount++; abort.throwIfAborted();
        }
        return { schema: 'stellar-forge.sftp-dataset-extraction.v1', query: name, complete: true, readOnly: true,
          startedAt, completedAt: new Date().toISOString(), rowCount, inputRowCount, sourceTextBytes,
          columns: [...query.columns], columnTypes: types, capture: captured.receipt,
          sourceQuery: describeSftpQuery(query), boundInput: { ...values }, order: limits.order,
          ordering: { strings: 'ECMAScript UTF-16 code units', nulls: 'last', ties: 'original file record order' },
          valueEncoding: 'utf8-file-explicit-projection', limits };
      } catch (issue) {
        if (issue?.name === 'TimeoutError') throw fail('DATASET_EXTRACTION_TIMEOUT');
        if (issue?.name === 'AbortError') throw fail('DATASET_EXTRACTION_CANCELLED');
        throw issue;
      }
    });
  }
  return Object.freeze({ inspect, catalogue, sampleFile, captureFile, exportDataset,
    async close() { closed = true; transport.close(); await tail; } });
}
