// MIT. Original WebDAV bytes -> existing lossless projector -> native CSV dataset.
import { constants, createReadStream } from 'node:fs';
import { mkdir, open, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { privateDirectory, acquireWorkspace, readJson, createFile, hashPrivate, syncDirectory } from '../postgres/publisher/files.mjs';
import { readSourceRecords, projectRecord, sampleColumns, suggestedColumns } from '../sftp/formats.mjs';
import { escapePointer } from '../sftp/config.mjs';
import { encodeSftpDatasetRow } from '../sftp/publisher/plan.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { loadCsvDataset, loadDatasetConfig, createCsvRecordParser } from '../dataset-handler.mjs';
import { fail, exact, integer, text, validateSource, validateProjection, projectionDocument, readSourceFile,
  identity, jsonBytes, sha256, clone, now, ID } from './config.mjs';
import { createHttpTransport, readCollection } from './http.mjs';
import { captureFile, readCapture, listCaptures } from './capture.mjs';

async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function csvHeaders(file) {
  let headers = null;
  const parser = createCsvRecordParser(row => { headers ??= row; }, 1048576);
  const decoder = new TextDecoder('utf-8', { fatal: true }), stream = createReadStream(file, { highWaterMark: 32768, flags: constants.O_RDONLY | constants.O_NOFOLLOW });
  try {
    for await (const chunk of stream) { parser.feed(decoder.decode(chunk, { stream: true })); if (headers) break; }
    if (!headers) { parser.feed(decoder.decode()); parser.end(); }
    return headers ?? [];
  } finally { stream.destroy(); }
}
function datasetConfig(projection, input) {
  exact(input, ['name', 'filters', 'ranges', 'sorts', 'maxBytes', 'maxRows', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'the dataset');
  return { schema: 'stellar-forge.csv-dataset.v1', file: 'dataset.csv', name: text(input.name, 128, 'the dataset name'),
    columns: Object.fromEntries(projection.columns.map(name => [name, { type: projection.mapping[name].type, nullable: projection.mapping[name].nullable }])),
    filters: clone(input.filters ?? []), ranges: clone(input.ranges ?? []), sorts: clone(input.sorts ?? []),
    maxBytes: integer(input.maxBytes ?? 67108864, 1, 268435456, 'dataset bytes'),
    maxRows: integer(input.maxRows ?? 250000, 1, 1000000, 'dataset records'),
    maxCellChars: integer(input.maxCellChars ?? 65536, 1, 1048576, 'cell characters'),
    defaultLimit: integer(input.defaultLimit ?? 50, 1, 1000, 'default page size'),
    maxLimit: integer(input.maxLimit ?? 250, 1, 1000, 'maximum page size'),
    maxPageBytes: integer(input.maxPageBytes ?? 921600, 1024, 921600, 'page bytes') };
}
export async function buildDatasetEdition({ capture, projection: requested, dataset: supplied, review, destination, signal } = {}) {
  const projection = validateProjection(requested), config = datasetConfig(projection, supplied);
  exact(review, ['reviewer', 'decision', 'note', 'expectedCaptureSha256', 'projectionHash'], 'the edition review');
  text(review.reviewer, 160, 'the reviewer'); text(review.note ?? '', 4000, 'the review note', true);
  if (review.decision !== 'approve' || review.expectedCaptureSha256 !== capture.sha256 || review.projectionHash !== identity(projectionDocument(projection)))
    fail('WEBDAV_REVIEW_CHANGED', 'Review the exact selected capture and public projection before building.', 409);
  destination = resolve(destination);
  const intent = { schema: 'stellar-forge.webdav-edition-intent.v1', captureId: capture.id, captureSha256: capture.sha256,
    projection: projectionDocument(projection), dataset: config, review: clone(review) };
  if (await exists(destination)) {
    await privateDirectory(destination);
    const previous = await readJson(join(destination, 'intent.json'));
    if (identity(previous) !== identity(intent)) fail('WEBDAV_EDITION_ID_REUSED', 'This edition already belongs to a different reviewed projection.', 409);
    if (!await exists(join(destination, 'edition.json'))) fail('WEBDAV_EDITION_INCOMPLETE', 'This interrupted edition is retained. Build a new edition from the same completed capture.', 409);
    const edition = await readJson(join(destination, 'edition.json')), native = await loadDatasetConfig(join(destination, 'dataset.json'));
    const csv = await hashPrivate(join(destination, 'dataset.csv'), config.maxBytes);
    if (edition.csvSha256 !== csv.hash || edition.csvBytes !== csv.bytes || edition.dataset.snapshot !== native.describe().snapshot)
      fail('WEBDAV_EDITION_CHANGED', 'The retained edition differs from its original native snapshot.', 409);
    return { ...edition, directory: destination };
  }
  await mkdir(destination, { mode: 0o700 }); await privateDirectory(destination);
  await createFile(join(destination, 'intent.json'), jsonBytes(intent));
  await createFile(join(destination, 'schema.csv'), csvLine(projection.columns));
  await loadCsvDataset({ ...config, file: join(destination, 'schema.csv') });
  const path = join(destination, 'dataset.csv'), handle = await open(path, 'wx', 0o600);
  let rowCount = 0, csvBytes = 0;
  const observed = Object.fromEntries(projection.columns.map(name => [name, { type: projection.mapping[name].type,
    nullable: projection.mapping[name].nullable, counts: {}, sourceTypes: {} }]));
  const write = async supplied => {
    const content = Buffer.isBuffer(supplied) ? supplied : Buffer.from(supplied);
    if (csvBytes + content.length > config.maxBytes) fail('WEBDAV_DATASET_BYTES', 'The projected dataset exceeds its declared byte limit.', 413);
    await handle.writeFile(content); csvBytes += content.length;
  };
  try {
    await write(csvLine(projection.columns));
    for await (const raw of readSourceRecords(capture.path, projection.format, {
      recordsPointer: projection.recordsPointer, maxRowBytes: 1048576, signal,
      expectedSha256: capture.sha256, expectedBytes: capture.bytes,
    })) {
      if (rowCount >= config.maxRows) fail('WEBDAV_DATASET_ROWS', 'The projected dataset exceeds its declared record limit.', 413);
      let projected, encoded;
      try { projected = projectRecord(raw, projection); encoded = encodeSftpDatasetRow(projected.row, config); }
      catch (error) { fail(error.code ?? 'WEBDAV_PROJECTION_ROW', 'Original source record ' + (rowCount + 1) + ': ' + error.message,
        error.status ?? 400, { captureId: capture.id, ordinal: rowCount + 1, sourceCode: error.code ?? null }); }
      await write(encoded);
      for (const name of projection.columns) {
        const kind = projected.row[name] === null ? 'null' : typeof projected.row[name];
        observed[name].counts[kind] = (observed[name].counts[kind] ?? 0) + 1;
        const sourceKind = projected.observed[name];
        observed[name].sourceTypes[sourceKind] = (observed[name].sourceTypes[sourceKind] ?? 0) + 1;
      }
      rowCount++;
    }
    await handle.sync();
  } finally { await handle.close(); }
  await createFile(join(destination, 'dataset.json'), jsonBytes(config));
  const native = await loadDatasetConfig(join(destination, 'dataset.json')), csv = await hashPrivate(path, config.maxBytes);
  if (native.describe().rowCount !== rowCount || csv.bytes !== csvBytes) fail('WEBDAV_EDITION_COUNT', 'The original dataset loader returned a different record count.', 409);
  const source = { schema: 'stellar-forge.webdav-dataset-source.v1', capture: {
    id: capture.id, href: capture.selection.href, etag: capture.etag, selectedEtag: capture.selection.etag,
    bytes: capture.bytes, sha256: capture.sha256, contentCondition: capture.contentCondition,
    startedAt: capture.startedAt, completedAt: capture.completedAt, http: capture.http,
  }, projection: projectionDocument(projection), review: clone(review), columnTypes: observed };
  await createFile(join(destination, 'source.json'), jsonBytes(source));
  const edition = { schema: 'stellar-forge.webdav-dataset-edition.v1', builtAt: now(), captureId: capture.id,
    intentSha256: identity(intent), captureSha256: capture.sha256, projectionHash: identity(projectionDocument(projection)),
    csvBytes, csvSha256: csv.hash, rowCount, dataset: native.describe(), sourceSha256: sha256(jsonBytes(source)), review: clone(review), columnTypes: observed };
  await createFile(join(destination, 'edition.json'), jsonBytes(edition)); await syncDirectory(destination);
  return { ...edition, directory: destination };
}
export async function openWebDavSource({ directory, source, sourceFile, environment = process.env, python = 'python3' } = {}) {
  if ((source === undefined) === (sourceFile === undefined)) fail('WEBDAV_SOURCE_REQUIRED', 'Choose one source declaration or source file.');
  const config = sourceFile ? (await readSourceFile(resolve(sourceFile))).config : validateSource(source);
  directory = resolve(directory);
  await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory), captures = join(directory, 'captures'), listings = join(directory, 'listings');
  let transport, tail = Promise.resolve(), closing = null, closed = false;
  const active = new Set();
  try {
    await privateDirectory(captures, true); await privateDirectory(listings, true);
    transport = createHttpTransport(config, { environment });
  } catch (error) { await release(); throw error; }
  function call(fn, externalSignal) {
    if (closed) return Promise.reject(new Error('WEBDAV_CLOSED'));
    const controller = new AbortController(), forward = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    externalSignal?.addEventListener('abort', forward, { once: true });
    active.add(controller);
    const operation = tail.catch(() => {}).then(() => {
      if (closed || controller.signal.aborted) fail('WEBDAV_CANCELLED', 'The source operation was cancelled.', 409);
      return fn(controller.signal);
    }).finally(() => { active.delete(controller); externalSignal?.removeEventListener('abort', forward); });
    tail = operation; return operation;
  }
  async function captured(id) {
    const result = await readCapture(captures, id, { verify: true });
    if (!result.receipt) fail('WEBDAV_CAPTURE_INCOMPLETE', 'Complete the original capture before using its bytes.', 409);
    return result.receipt;
  }
  function sampleFile(input) {
    exact(input, ['captureId', 'format', 'recordsPointer', 'limit', 'signal'], 'the retained sample');
    return call(async signal => {
      if (!['csv', 'json', 'ndjson'].includes(input.format)) fail('WEBDAV_FORMAT', 'Choose CSV, JSON, or NDJSON.');
      const receipt = await captured(input.captureId), limit = integer(input.limit ?? 20, 1, 100, 'sample records');
      const rows = [], ordinals = []; let rowCount = 0, sampleBytes = 0;
      for await (const raw of readSourceRecords(receipt.path, input.format, { recordsPointer: input.recordsPointer ?? '', signal,
        maxRowBytes: 1048576, expectedSha256: receipt.sha256, expectedBytes: receipt.bytes })) {
        if (++rowCount > 1000000) fail('WEBDAV_SAMPLE_ROWS', 'The source exceeds one million supported records.', 413);
        const size = Buffer.byteLength(JSON.stringify(raw));
        if (rows.length < limit && sampleBytes + size <= 2097152) { rows.push(raw); ordinals.push(rowCount); sampleBytes += size; }
      }
      let columns = sampleColumns(rows);
      if (input.format === 'csv' && !rowCount) columns = (await csvHeaders(receipt.path)).map(name => ({
        name, pointer: escapePointer(name), types: {}, present: 0, missing: 0, nullable: false,
      }));
      return { schema: 'stellar-forge.webdav-sample.v1', captureId: receipt.id, captureSha256: receipt.sha256,
        bytes: receipt.bytes, format: input.format, recordsPointer: input.recordsPointer ?? '', rowCount,
        sampleCount: rows.length, sampleBytes, sampleLimited: rows.length < Math.min(rowCount, limit), rows: rows.map((raw, index) => ({ ordinal: ordinals[index], raw })), columns,
        suggestedColumns: suggestedColumns(columns), note: 'Numeric JSON tokens remain exact strings in this sample; types are explicit in the reviewed projection.' };
    }, input.signal);
  }
  const close = () => closing ??= (async () => {
    closed = true; for (const controller of active) controller.abort();
    await transport.close(); await tail.catch(() => {}); await release();
  })();
  return {
    directory, config,
    inspect: () => call(async () => ({ schema: 'stellar-forge.webdav-source-status.v1', source: config,
      sourceHash: identity(config), captures: await listCaptures(captures) })),
    catalogue: options => call(signal => readCollection(transport, listings, { ...(options ?? {}), python, signal }), options?.signal),
    captureFile: (selection, options = {}) => call(signal => captureFile(transport, captures, selection, { ...options, signal }), options.signal),
    capture: (id, { verify = true } = {}) => call(() => readCapture(captures, id, { verify })),
    sampleFile,
    exportDataset: input => call(async signal => buildDatasetEdition({ ...input, capture: await captured(input.captureId), signal }), input?.signal),
    close,
  };
}
