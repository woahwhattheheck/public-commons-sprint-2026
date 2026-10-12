// MIT. Sheet Best joins the original durable dataset publisher.
import { join } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../../postgres/publisher/stream.mjs';
import { object, bytes, digest, identity, createFile, privateDirectory, syncDirectory, fault } from '../../postgres/publisher/files.mjs';
import { only, integer, HASH, readSheetBestSourceFile } from '../declaration.mjs';
import { readSheetBestCapture, bindSheetBestCapture } from '../capture.mjs';
import { inspectSheetBestSource, openSheetBestSourceFile, checkSheetBestColumnTypes, encodeSheetBestRow } from '../source.mjs';

export async function captureSheetBestPublicationPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128) throw fault('PLAN_TITLE_REQUIRED');
  const selected = await readSheetBestSourceFile(sourceFile);
  if (selected.hash !== input.sourceHash) throw fault('SOURCE_REVIEW_CHANGED', 'Reload the source before saving this plan.', 409);
  const query = selected.queries[input.query];
  if (!query) throw fault('QUERY_NOT_FOUND');
  if (!object(input.input ?? {}) || Object.keys(input.input ?? {}).length) throw fault('SHEETBEST_QUERY_INPUT_NOT_SUPPORTED');
  const extraction = datasetExtractionOptions(query, input.extraction);
  only(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length ||
      Object.keys(input.dataset.columns).some(name => !query.columns.includes(name))) throw fault('DATASET_COLUMN_NOT_IN_QUERY');
  const columns = Object.fromEntries(Object.entries(input.dataset.columns).map(([name, spec]) => {
    const value = typeof spec === 'string' ? { type: spec, nullable: false } : spec;
    only(value, ['type', 'nullable'], 'INVALID_DATASET_COLUMN');
    return [name, { type: value.type, nullable: value.nullable ?? false }];
  }));
  checkSheetBestColumnTypes(columns, Object.entries(query.projection).map(([name, spec]) => ({ name, type: spec.type })));
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
    const capture = await readSheetBestCapture(selected.captureFile, selected.config.connection.sha256);
    bindSheetBestCapture(capture, selected.config);
    const target = join(directory, 'capture'); await privateDirectory(target, true);
    await createFile(join(target, 'records.json'), capture.resourceBytes);
    await createFile(join(target, 'capture.json'), capture.manifestBytes); await syncDirectory(target);
    runtime.connection.file = 'capture/capture.json';
    retainedCapture = { manifestSha256: capture.manifestSha256, sourceSha256: capture.manifest.sourceSha256,
      sourceBytes: capture.manifest.sourceBytes, receivedAt: capture.manifest.receivedAt, transport: capture.manifest.transport };
  }
  const runtimeBytes = bytes(runtime);
  await createFile(join(directory, 'original-source.json'), selected.original);
  await createFile(join(directory, 'source.json'), runtimeBytes);
  const value = { schema: 'stellar-forge.sheetbest-dataset-plan.v1', title: input.title.trim(), query: input.query, input: {},
    dataset, extraction, sourceHash: selected.hash, sourceBytes: selected.original.length,
    runtimeSourceHash: digest(runtimeBytes), queryHash: identity(query), retainedCapture,
    sourceQuery: { sql: query.sql, columns: query.columns, parameters: {}, projection: query.projection,
      tab: selected.binding.tab, valueMode: selected.binding.valueMode } };
  value.digest = identity(value); await createFile(join(directory, 'plan.json'), bytes(value));
  return value;
}
export const sheetBestPublisherDriver = Object.freeze({
  sourceName: 'Sheet Best',
  workspaceSchema: 'stellar-forge.sheetbest-publisher-workspace.v1',
  statusSchema: 'stellar-forge.sheetbest-publisher-status.v1',
  candidateSchema: 'stellar-forge.sheetbest-dataset-candidate.v1',
  capturePlan: captureSheetBestPublicationPlan, inspectSource: inspectSheetBestSource, openSource: openSheetBestSourceFile,
  checkColumnTypes: checkSheetBestColumnTypes, encodeRow: encodeSheetBestRow,
  validateExtraction: record => record?.schema === 'stellar-forge.sheetbest-dataset-extraction.v1' &&
    ['sheetbest-strings', 'sheetbest-raw'].includes(record.valueEncoding) && record.nullEncoding === 'json-null' &&
    record.observation?.schema === 'stellar-forge.sheetbest-records-observation.v1' &&
    record.observation.kind === 'SINGLE_RECORDS_RESPONSE' && record.observation.readOnly === true &&
    record.observation.capture?.provider === 'sheetbest' &&
    record.valueEncoding === 'sheetbest-' + record.observation.capture.valueMode &&
    record.observation.capture.method === (record.observation.capture.transport === 'sheetbest-rest' ? 'GET' : 'IMPORT') &&
    record.observation.capture.readOnly === true && record.observation.capture.format === 'records' &&
    ['sheetbest-rest', 'operator-import'].includes(record.observation.capture.transport) &&
    HASH.test(record.observation.capture.sourceSha256 ?? '') && HASH.test(record.observation.capture.manifestSha256 ?? '') &&
    Number.isSafeInteger(record.rowCount) && record.rowCount >= 0 && record.rowCount === record.observation.capture.rowCount,
});
