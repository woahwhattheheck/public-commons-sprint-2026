// MIT. Frictionless source retention in the original durable dataset publisher.
import { dirname, join, posix } from 'node:path';
import { loadCsvDataset } from '../dataset-handler.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { object, bytes, digest, identity, readPrivate, createFile, privateDirectory, syncDirectory, fault } from '../postgres/publisher/files.mjs';
import { inspectFrictionlessSource, openFrictionlessSourceFile, checkFrictionlessColumnTypes, encodeFrictionlessRow } from './source.mjs';

const HASH = /^[a-f0-9]{64}$/;
const only = (value, keys, code) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
};
function captureMember(name) {
  if (typeof name !== 'string' || !name || name.length > 1024 || name.includes('\\') || name.includes('\0') ||
      posix.isAbsolute(name) || posix.normalize(name) !== name || name.split('/').some(v => !v || v === '.' || v === '..') ||
      name === 'capture.json') throw fault('PACKAGE_CAPTURE_MEMBER_INVALID');
  return name;
}
async function retainCapture(selected, target) {
  const manifest = selected.capture;
  if (manifest?.schema !== 'stellar-forge.frictionless-capture.v1' || manifest.state !== 'COMPLETE' ||
      !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 10000)
    throw fault('PACKAGE_CAPTURE_INVALID');
  const original = await readPrivate(selected.captureFile, 8388608);
  if (digest(original) !== selected.captureSha256) throw fault('PACKAGE_CAPTURE_CHANGED');
  await privateDirectory(target, true);
  const names = new Set();
  for (const item of manifest.files) {
    const name = captureMember(item.file);
    if (names.has(name) || !HASH.test(item.sha256 ?? '') || !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
        item.bytes > 268435456) throw fault('PACKAGE_CAPTURE_FILES_INVALID');
    names.add(name);
    const content = await readPrivate(join(dirname(selected.captureFile), name), 268435456);
    if (digest(content) !== item.sha256 || content.length !== item.bytes) throw fault('PACKAGE_CAPTURE_MEMBER_CHANGED');
    await privateDirectory(dirname(join(target, name)), true);
    await createFile(join(target, name), content);
  }
  await createFile(join(target, 'capture.json'), original);
  await syncDirectory(join(target, 'files')); await syncDirectory(target);
}

export async function captureFrictionlessPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128) throw fault('PLAN_TITLE_REQUIRED');
  const selected = await inspectFrictionlessSource(sourceFile);
  const original = await readPrivate(sourceFile, 8388608);
  if (digest(original) !== selected.hash || selected.hash !== input.sourceHash)
    throw fault('SOURCE_REVIEW_CHANGED', 'Reload the Frictionless source before saving this plan.', 409);
  const query = selected.queries[input.query];
  if (!query) throw fault('QUERY_NOT_FOUND');
  if (!object(input.input ?? {}) || Object.keys(input.input ?? {}).length) throw fault('PACKAGE_QUERY_INPUT_NOT_SUPPORTED');
  const extraction = datasetExtractionOptions(query, input.extraction);
  only(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length ||
      Object.keys(input.dataset.columns).some(name => !query.columns.includes(name))) throw fault('DATASET_COLUMN_NOT_IN_QUERY');
  const columns = Object.fromEntries(Object.entries(input.dataset.columns).map(([name, spec]) => {
    const value = typeof spec === 'string' ? { type: spec, nullable: false } : spec;
    only(value, ['type', 'nullable'], 'INVALID_DATASET_COLUMN');
    return [name, { type: value.type, nullable: value.nullable ?? false }];
  }));
  const types = Object.entries(query.projection).map(([name, spec]) => ({
    name, type: spec.type, nullable: spec.missing === 'null',
  }));
  checkFrictionlessColumnTypes(columns, types);
  const dataset = { schema: 'stellar-forge.csv-dataset.v1', file: 'data.csv', name: input.dataset.name,
    columns, filters: input.dataset.filters ?? [], ranges: input.dataset.ranges ?? [], sorts: input.dataset.sorts ?? [],
    maxBytes: extraction.maxBytes, maxRows: extraction.maxRows, maxCellChars: input.dataset.maxCellChars ?? 65536,
    defaultLimit: input.dataset.defaultLimit ?? 50, maxLimit: input.dataset.maxLimit ?? 250,
    maxPageBytes: input.dataset.maxPageBytes ?? 921600 };
  await createFile(join(directory, 'schema.csv'), csvLine(Object.keys(columns)));
  await loadCsvDataset({ ...dataset, file: join(directory, 'schema.csv') });
  await retainCapture(selected, join(directory, 'capture'));
  const runtime = structuredClone(selected.config);
  runtime.connection.file = 'capture/capture.json';
  const runtimeBytes = bytes(runtime);
  await createFile(join(directory, 'original-source.json'), original);
  await createFile(join(directory, 'source.json'), runtimeBytes);
  const value = { schema: 'stellar-forge.frictionless-dataset-plan.v1', title: input.title.trim(),
    query: input.query, input: {}, dataset, extraction, sourceHash: selected.hash, sourceBytes: original.length,
    runtimeSourceHash: digest(runtimeBytes), queryHash: identity(query),
    retainedCapture: { manifestSha256: selected.captureSha256, resource: query.resource,
      descriptorFile: selected.capture.descriptorFile, origin: selected.capture.origin },
    sourceQuery: { ...query } };
  value.digest = identity(value);
  await createFile(join(directory, 'plan.json'), bytes(value));
  return value;
}

export const frictionlessPublisherDriver = Object.freeze({
  sourceName: 'Frictionless Data Package',
  workspaceSchema: 'stellar-forge.frictionless-publisher-workspace.v1',
  statusSchema: 'stellar-forge.frictionless-publisher-status.v1',
  candidateSchema: 'stellar-forge.frictionless-dataset-candidate.v1',
  capturePlan: captureFrictionlessPlan, inspectSource: inspectFrictionlessSource, openSource: openFrictionlessSourceFile,
  checkColumnTypes: checkFrictionlessColumnTypes, encodeRow: encodeFrictionlessRow,
  validateExtraction: value => value?.schema === 'stellar-forge.frictionless-extraction.v1' &&
    value.valueEncoding === 'frictionless-reviewed-projection' && value.nullEncoding === 'json-null' &&
    value.tieBreak === 'original-member-and-record-order' && HASH.test(value.captureSha256 ?? '') &&
    HASH.test(value.descriptorSha256 ?? '') && Number.isSafeInteger(value.rowCount) && value.rowCount >= 0 &&
    Array.isArray(value.columnTypes) && Array.isArray(value.columns) && Array.isArray(value.order),
});
