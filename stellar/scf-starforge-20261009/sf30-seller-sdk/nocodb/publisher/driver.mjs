// MIT. NocoDB joins the original retained plan, review, version and buyer engine.
import { join } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../../postgres/publisher/stream.mjs';
import { object, bytes, digest, identity, createFile, fault } from '../../postgres/publisher/files.mjs';
import { only, integer, HASH, readNocoDBSourceFile } from '../declaration.mjs';
import { readNocoDBCapture, bindNocoDBCapture, copyNocoDBCapture } from '../capture.mjs';
import { inspectNocoDBSource, openNocoDBSourceFile, checkNocoDBColumnTypes, encodeNocoDBRow } from '../source.mjs';

export async function captureNocoDBPublicationPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128) throw fault('PLAN_TITLE_REQUIRED');
  const selected = await readNocoDBSourceFile(sourceFile);
  if (selected.hash !== input.sourceHash) throw fault('SOURCE_REVIEW_CHANGED', 'Reload the source before saving this plan.', 409);
  const query = selected.queries[input.query];
  if (!query) throw fault('QUERY_NOT_FOUND');
  if (!object(input.input ?? {}) || Object.keys(input.input ?? {}).length) throw fault('NOCODB_QUERY_INPUT_NOT_SUPPORTED');
  const extraction = datasetExtractionOptions(query, input.extraction);
  only(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length ||
      Object.keys(input.dataset.columns).some(name => !query.columns.includes(name))) throw fault('DATASET_COLUMN_NOT_IN_QUERY');
  const columns = Object.fromEntries(Object.entries(input.dataset.columns).map(([name, spec]) => {
    const value = typeof spec === 'string' ? { type: spec, nullable: false } : spec;
    only(value, ['type', 'nullable'], 'INVALID_DATASET_COLUMN');
    return [name, { type: value.type, nullable: value.nullable ?? false }];
  }));
  checkNocoDBColumnTypes(columns, Object.entries(query.projection).map(([name, spec]) => ({ name, type: spec.type })));
  const dataset = { schema: 'stellar-forge.csv-dataset.v1', file: 'data.csv', name: input.dataset.name, columns,
    filters: input.dataset.filters ?? [], ranges: input.dataset.ranges ?? [], sorts: input.dataset.sorts ?? [],
    maxBytes: extraction.maxBytes, maxRows: extraction.maxRows,
    maxCellChars: integer(input.dataset.maxCellChars ?? 65536, 1, 1048576, 'DATASET_CELL_SIZE_INVALID'),
    defaultLimit: input.dataset.defaultLimit ?? 50, maxLimit: input.dataset.maxLimit ?? 250,
    maxPageBytes: input.dataset.maxPageBytes ?? 921600 };
  await createFile(join(directory, 'schema.csv'), csvLine(Object.keys(columns)));
  await loadCsvDataset({ ...dataset, file: join(directory, 'schema.csv') });
  const runtime = structuredClone(selected.config); let retainedCapture = null;
  if (selected.captureFile) {
    const capture = await readNocoDBCapture(selected.captureFile, selected.config.connection.sha256);
    bindNocoDBCapture(capture, selected.config);
    await copyNocoDBCapture(capture, join(directory, 'capture'));
    runtime.connection.file = 'capture/capture.json';
    retainedCapture = { manifestSha256: capture.manifestSha256, selectionSha256: capture.manifest.selectionSha256,
      schemaSha256: capture.manifest.schemaSha256, sourceBytes: capture.manifest.sourceBytes,
      rowCount: capture.manifest.rowCount, pageCount: capture.manifest.pageCount,
      startedAt: capture.manifest.startedAt, completedAt: capture.manifest.completedAt, transport: capture.manifest.transport };
  }
  const runtimeBytes = bytes(runtime);
  await createFile(join(directory, 'original-source.json'), selected.original);
  await createFile(join(directory, 'source.json'), runtimeBytes);
  const value = { schema: 'stellar-forge.nocodb-dataset-plan.v1', title: input.title.trim(), query: input.query, input: {},
    dataset, extraction, sourceHash: selected.hash, sourceBytes: selected.original.length,
    runtimeSourceHash: digest(runtimeBytes), queryHash: identity(query), retainedCapture,
    sourceQuery: { sql: query.sql, columns: query.columns, parameters: {}, projection: query.projection,
      selection: selected.binding, responseKind: 'PAGED_TABLE_READ', atomicSourceSnapshot: false } };
  value.digest = identity(value); await createFile(join(directory, 'plan.json'), bytes(value));
  return value;
}
export const nocoDBPublisherDriver = Object.freeze({
  sourceName: 'NocoDB', workspaceSchema: 'stellar-forge.nocodb-publisher-workspace.v1',
  statusSchema: 'stellar-forge.nocodb-publisher-status.v1', candidateSchema: 'stellar-forge.nocodb-dataset-candidate.v1',
  capturePlan: captureNocoDBPublicationPlan, inspectSource: inspectNocoDBSource, openSource: openNocoDBSourceFile,
  checkColumnTypes: checkNocoDBColumnTypes, encodeRow: encodeNocoDBRow,
  validateExtraction: record => record?.schema === 'stellar-forge.nocodb-dataset-extraction.v1' &&
    record.valueEncoding === 'nocodb-v3-explicit-scalars' && record.nullEncoding === 'json-null' &&
    record.observation?.schema === 'stellar-forge.nocodb-records-observation.v1' &&
    record.observation.kind === 'PAGED_TABLE_READ' && record.observation.atomicSourceSnapshot === false &&
    record.observation.readOnly === true && record.observation.capture?.provider === 'nocodb' &&
    record.observation.capture.apiVersion === 'v3' && record.observation.capture.method === 'GET' &&
    record.observation.capture.transport === 'nocodb-rest' && record.observation.capture.complete === true && record.observation.capture.countVerified === true &&
    record.observation.capture.readOnly === true && record.observation.capture.atomicSourceSnapshot === false &&
    HASH.test(record.observation.capture.selectionSha256 ?? '') && HASH.test(record.observation.capture.schemaSha256 ?? '') &&
    HASH.test(record.observation.capture.recordIdentitiesSha256 ?? '') && HASH.test(record.observation.capture.manifestSha256 ?? '') &&
    Number.isSafeInteger(record.rowCount) && record.rowCount >= 0 && record.rowCount === record.observation.capture.rowCount &&
    Number.isSafeInteger(record.observation.capture.pageCount) && record.observation.capture.pageCount >= 1,
});
