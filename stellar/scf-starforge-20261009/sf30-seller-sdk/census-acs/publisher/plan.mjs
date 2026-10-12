// MIT. Census source retention and explicit projection through the original publisher.
import { join } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { bytes, digest, identity, createFile, privateDirectory, fault, object } from '../../postgres/publisher/files.mjs';
import { readCensusSource, queryDefinitions, CENSUS_COLUMNS, columnTypes, extractionOptions, MANIFEST_PATH } from '../source.mjs';

const only = (value, allowed, code) => {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fault(code);
};
export function checkCensusColumnTypes(columns, types) {
  if (!Array.isArray(types)) throw fault('DATASET_COLUMN_TYPE_MISMATCH');
  const known = new Map(types.map(item => [item.name, item]));
  for (const [name, spec] of Object.entries(columns)) {
    const native = known.get(name);
    if (!native || !['string', 'integer', 'number', 'boolean'].includes(spec.type) ||
        typeof spec.nullable !== 'boolean' ||
        spec.type !== 'string' && spec.type !== native.type && !(spec.type === 'number' && native.type === 'integer'))
      throw fault('DATASET_COLUMN_TYPE_MISMATCH');
  }
}
export function encodeCensusRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const value = row[name];
    if (value === null) {
      if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED');
      return '';
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw fault('CENSUS_VALUE_INVALID');
    if (spec.type === 'integer' && !Number.isSafeInteger(value) ||
        spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)) ||
        spec.type === 'boolean' && typeof value !== 'boolean') throw fault('CENSUS_PROJECTION_TYPE_INVALID');
    const text = String(value);
    if (text.length > dataset.maxCellChars) throw fault('DATASET_CELL_TOO_LARGE');
    if (text === '' && spec.nullable) throw fault('DATASET_EMPTY_NULL_CONFLICT');
    return text;
  }));
}
export function validateCensusExtraction(value) {
  return value?.schema === 'stellar-forge.census-acs-extraction.v1' &&
    Object.hasOwn(CENSUS_COLUMNS, value.projection) && /^[a-f0-9]{64}$/.test(value.captureHash ?? '') &&
    value.completeSelection === true && value.sourceVerified === true && value.rawValuesPreserved === true &&
    value.confidenceLevel === 90 && Number.isSafeInteger(value.rowCount) && value.rowCount >= 0;
}
export async function captureCensusPublicationPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128) throw fault('PLAN_TITLE_REQUIRED');
  const capture = await readCensusSource(sourceFile), queries = queryDefinitions(capture);
  if (input.sourceHash !== capture.hash) throw fault('SOURCE_REVIEW_CHANGED', 'Reload the captured source before saving.', 409);
  if (!Object.hasOwn(queries, input.query)) throw fault('CENSUS_QUERY_NOT_FOUND');
  if (!object(input.input ?? {}) || Object.keys(input.input ?? {}).length) throw fault('CENSUS_SELECTION_IS_CAPTURED');
  const definition = queries[input.query], extraction = extractionOptions(input.query, input.extraction);
  only(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars',
    'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length) throw fault('DATASET_COLUMNS_REQUIRED');
  const columns = Object.fromEntries(Object.entries(input.dataset.columns).map(([name, given]) => {
    if (!Object.hasOwn(CENSUS_COLUMNS[input.query], name)) throw fault('DATASET_COLUMN_NOT_IN_QUERY');
    const supplied = typeof given === 'string' ? { type: given, nullable: false } : given;
    only(supplied, ['type', 'nullable'], 'INVALID_DATASET_COLUMN');
    return [name, { type: supplied.type, nullable: supplied.nullable ?? false }];
  }));
  checkCensusColumnTypes(columns, definition.columnTypes);
  if (input.query === 'source_files' && identity(columns) !== identity(CENSUS_COLUMNS.source_files))
    throw fault('CENSUS_COMPLETE_SOURCE_PROJECTION_REQUIRED', 'The source-file delivery retains every inventory and chunk column.');
  const dataset = { schema: 'stellar-forge.csv-dataset.v1', file: 'data.csv', name: input.dataset.name,
    columns, filters: input.dataset.filters ?? [], ranges: input.dataset.ranges ?? [], sorts: input.dataset.sorts ?? [],
    maxBytes: extraction.maxBytes, maxRows: extraction.maxRows,
    maxCellChars: input.dataset.maxCellChars ?? 65536, defaultLimit: input.dataset.defaultLimit ?? (input.query === 'source_files' ? 10 : 50),
    maxLimit: input.dataset.maxLimit ?? (input.query === 'source_files' ? 10 : 250), maxPageBytes: input.dataset.maxPageBytes ?? 921600 };
  if (input.query === 'source_files' && (dataset.maxLimit > 10 || dataset.maxCellChars < 65536))
    throw fault('CENSUS_SOURCE_PAGE_POLICY', 'Use at most ten source chunks per page and a cell limit of at least 65536.');
  await createFile(join(directory, 'original-source.json'), capture.original);
  const retained = join(directory, 'capture'); await privateDirectory(retained, true);
  for (const member of [...capture.manifest.files, { path: MANIFEST_PATH }]) {
    const parts = member.path.split('/'); parts.pop();
    let parent = retained;
    for (const part of parts) { parent = join(parent, part); await privateDirectory(parent, true); }
    await createFile(join(retained, member.path), await capture.read(member.path));
  }
  const runtime = { ...capture.declaration, capture: 'capture/' + MANIFEST_PATH }, runtimeBytes = bytes(runtime);
  await createFile(join(directory, 'source.json'), runtimeBytes);
  // Reopen from only the retained source before accepting this plan.
  const restored = await readCensusSource(join(directory, 'source.json'));
  if (restored.captureHash !== capture.captureHash) throw fault('CENSUS_RETAINED_SOURCE_CHANGED');
  await createFile(join(directory, 'schema.csv'), csvLine(Object.keys(columns)));
  await loadCsvDataset({ ...dataset, file: join(directory, 'schema.csv') });
  const value = { schema: 'stellar-forge.census-acs-plan.v1', title: input.title.trim(),
    query: input.query, input: {}, dataset, extraction, sourceHash: capture.hash, sourceBytes: capture.original.length,
    captureHash: capture.captureHash, runtimeSourceHash: digest(runtimeBytes), queryHash: identity(definition), sourceQuery: definition };
  value.digest = identity(value); await createFile(join(directory, 'plan.json'), bytes(value));
  return value;
}
export async function censusPlanTemplate(sourceFile, query = 'observations', name = 'ACS observations') {
  const capture = await readCensusSource(sourceFile);
  if (!Object.hasOwn(CENSUS_COLUMNS, query)) throw fault('CENSUS_QUERY_NOT_FOUND');
  const sourceFiles = query === 'source_files';
  return { title: 'ACS ' + capture.manifest.year + ' ' + query, query, input: {}, sourceHash: capture.hash,
    dataset: { name, columns: structuredClone(CENSUS_COLUMNS[query]),
      filters: sourceFiles ? ['capture_id', 'path'] : ['release_year', 'table_id', 'geo_id', 'indicator_id', 'estimate_status', 'moe_status'],
      ranges: sourceFiles ? [] : ['estimate'], sorts: sourceFiles ? ['path'] : ['geo_id', 'estimate', 'table_id'],
      maxCellChars: 65536, defaultLimit: sourceFiles ? 10 : 50, maxLimit: sourceFiles ? 10 : 250, maxPageBytes: 921600 },
    extraction: extractionOptions(query) };
}
