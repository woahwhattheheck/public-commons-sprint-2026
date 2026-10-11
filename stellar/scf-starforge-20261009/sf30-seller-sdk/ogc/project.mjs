// MIT. Explicit OGC projection into the ORIGINAL SF30 immutable CSV dataset.
import { join, resolve } from 'node:path';
import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readCapture, parseSource, JsonNumber, sourceText, digest, identity, fault } from './source.mjs';
import { privateDirectory, acquireWorkspace, readPrivate, readJson, createFile, syncDirectory,
  hashPrivate, bytes, stamp, object } from '../postgres/publisher/files.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
const escape = key => key.replace(/~/g, '~0').replace(/\//g, '~1');
const typeOf = value => value === undefined ? 'missing' : value === null ? 'null' : value instanceof JsonNumber ?
  (/^-?(0|[1-9]\d*)$/.test(value.text) ? 'integer' : 'number') : Array.isArray(value) ? 'array' : typeof value;
export function pointer(value, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 4096 || /~(?![01])/u.test(path)) throw fault('OGC_POINTER_INVALID');
  for (const part of path.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (value === null || typeof value !== 'object' || value instanceof JsonNumber || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}
export async function* features(directory, manifest) {
  for (const page of manifest.pages) {
    const data = await readPrivate(join(directory, 'pages', page.file), manifest.config.pageBytes);
    if (digest(data) !== page.sha256) throw fault('OGC_PAGE_CHANGED');
    const doc = parseSource(data);
    for (let ordinal = 0; ordinal < doc.features.length; ordinal++) yield { feature: doc.features[ordinal], page: page.file, ordinal };
  }
}
export async function inspectCapture(directory, { sampleLimit = 12 } = {}) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 100) throw fault('OGC_SAMPLE_LIMIT_INVALID');
  const manifest = await readCapture(directory), inventory = new Map(), samples = [], ids = new Set();
  let duplicateIds = 0, absentIds = 0;
  const add = (path, value) => {
    if (!inventory.has(path)) {
      if (inventory.size >= 4096) throw fault('OGC_PROPERTY_LIMIT', 'More than 4096 distinct source property paths; select a narrower collection.');
      inventory.set(path, { pointer: path, present: 0, types: {}, examples: [], emptyStrings: 0, unsafeIntegers: 0 });
    }
    const item = inventory.get(path), type = typeOf(value);
    item.present++; item.types[type] = (item.types[type] ?? 0) + 1;
    if (value === '') item.emptyStrings++;
    if (type === 'integer' && !Number.isSafeInteger(Number(value.text))) item.unsafeIntegers++;
    const example = value instanceof JsonNumber ? value.text : typeof value === 'string' ? value : JSON.stringify(value);
    if (item.examples.length < 3 && !item.examples.includes(example)) item.examples.push(example?.slice(0, 500) ?? '');
  };
  const visit = (value, path, depth = 0) => {
    add(path, value);
    if (object(value) && !(value instanceof JsonNumber) && depth < 8)
      for (const [key, child] of Object.entries(value)) visit(child, path + '/' + escape(key), depth + 1);
  };
  for await (const { feature, page, ordinal } of features(directory, manifest)) {
    for (const key of ['id', 'geometry', 'bbox']) if (Object.hasOwn(feature, key)) add('/' + key, feature[key]);
    for (const [key, value] of Object.entries(feature.properties ?? {})) visit(value, '/properties/' + escape(key));
    if (feature.id === undefined || feature.id === null) absentIds++;
    else { const key = typeOf(feature.id) + ':' + sourceText(feature.id); if (ids.has(key)) duplicateIds++; ids.add(key); }
    if (samples.length < sampleLimit) samples.push({ page, ordinal, featureJson: JSON.stringify(feature) });
  }
  return { schema: 'stellar-forge.ogc-inspection.v1', sourceId: manifest.sourceId, name: manifest.config.name,
    complete: manifest.complete, rows: manifest.rows, pages: manifest.pages.length, bytes: manifest.totalBytes,
    next: manifest.next, itemsUrl: manifest.config.itemsUrl, capturedAt: manifest.updatedAt ?? manifest.createdAt,
    license: manifest.config.license ?? '', collection: manifest.config.collection ?? null,
    matchedCounts: [...new Set(manifest.pages.map(p => p.matched).filter(n => n !== null))],
    duplicateIds, absentIds, sourceKind: manifest.config.kind, coordinates: manifest.config.coordinateDescription ??
      (manifest.config.kind === 'geojson' ? 'Original source coordinates retained. Consult the source definition for units and vertical sign.' :
        'Original OGC Core GeoJSON CRS84 longitude/latitude; optional ellipsoidal height. No reprojection.'),
    properties: [...inventory.values()].map(p => ({ ...p, missing: manifest.rows - p.present })), samples };
}
export function validatePlan(input, sourceId) {
  if (!object(input) || input.schema !== 'stellar-forge.ogc-plan.v1' || input.sourceId !== sourceId ||
      Object.keys(input).some(k => !['schema','sourceId','name','columns','filters','ranges','sorts','defaultLimit','maxLimit',
        'maxCellChars','nullEmptyPolicy','notes'].includes(k)) ||
      !Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > 64)
    throw fault('OGC_PLAN_INVALID', 'Review 1–64 columns against this exact sourceId.');
  const names = new Set();
  for (const column of input.columns) {
    if (!object(column) || Object.keys(column).some(k => !['name','pointer','type','nullable','format'].includes(k)) ||
        !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(column.name ?? '') || ['constructor','prototype','__proto__'].includes(column.name) || names.has(column.name) ||
        !['string','integer','number','boolean'].includes(column.type) || typeof column.nullable !== 'boolean' ||
        !['scalar','json'].includes(column.format) || (column.format === 'json' && column.type !== 'string'))
      throw fault('OGC_COLUMN_INVALID', 'Each column needs a unique native name, source pointer, type, format and nullable decision.');
    pointer({}, column.pointer); names.add(column.name);
  }
  if (input.nullEmptyPolicy !== 'native-empty-is-null')
    throw fault('OGC_NULL_POLICY_REQUIRED', 'The native nullable CSV format maps both empty strings and null to null. Review this explicitly.');
  return { ...input, filters: input.filters ?? [], ranges: input.ranges ?? [], sorts: input.sorts ?? [],
    defaultLimit: input.defaultLimit ?? 50, maxLimit: input.maxLimit ?? 250, maxCellChars: input.maxCellChars ?? 65536 };
}
function cell(value, column, row) {
  const label = 'Feature ' + row + ' / ' + column.name;
  if (value === undefined || value === null) {
    if (!column.nullable) throw fault('OGC_MISSING_VALUE', label + ': select nullable or a present property.');
    return '';
  }
  if (column.format === 'json') return JSON.stringify(value);
  if (column.type === 'string') {
    if (typeof value === 'string') return value;
    if (value instanceof JsonNumber) return value.text;
    if (typeof value === 'boolean') return String(value);
    throw fault('OGC_OBJECT_NEEDS_JSON', label + ': use JSON format for arrays and objects.');
  }
  if (column.type === 'boolean' && typeof value === 'boolean') return String(value);
  if (column.type === 'integer' && value instanceof JsonNumber && /^-?(0|[1-9]\d*)$/.test(value.text) && Number.isSafeInteger(Number(value.text))) return value.text;
  if (column.type === 'number' && value instanceof JsonNumber && Number.isFinite(Number(value.text))) {
    if (/^-?\d+$/.test(value.text) && !Number.isSafeInteger(Number(value.text)))
      throw fault('OGC_EXACT_INTEGER_REQUIRED', label + ': keep this large identifier as string.');
    return value.text;
  }
  throw fault('OGC_TYPE_MISMATCH', label + ': source type is ' + typeOf(value) + ', selected ' + column.type + '.');
}
const csv = value => /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
async function createExact(path, data) {
  try { await createFile(path, data); }
  catch (error) {
    if (error.code !== 'EEXIST' || !data.equals(await readPrivate(path, Math.max(data.length, 1)))) throw error;
  }
}
export async function reopenExport(directory) {
  await privateDirectory(directory);
  const result = await readJson(join(directory, 'export.json'), 32*1024*1024);
  if (result.schema !== 'stellar-forge.ogc-export.v1' || !Array.isArray(result.files)) throw fault('OGC_EXPORT_INVALID');
  for (const file of result.files) {
    if (typeof file.path !== 'string' || file.path.startsWith('/') || file.path.split('/').some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || ['.','..'].includes(p))) throw fault('OGC_EXPORT_INVALID');
    const actual = await hashPrivate(join(directory, file.path), 256*1024*1024);
    if (actual.hash !== file.sha256 || actual.bytes !== file.bytes) throw fault('OGC_EXPORT_CHANGED', file.path);
  }
  const dataset = await loadDatasetConfig(join(directory, 'dataset.json'));
  if (dataset.describe().snapshot !== result.dataset.snapshot) throw fault('OGC_EXPORT_CHANGED');
  return { ...result, directory, datasetPath: join(directory, 'dataset.json') };
}
/** Export, validate with the original engine, and finish a resumable private receiving bundle. */
export async function exportDataset(captureDirectory, outputDirectory, inputPlan, { payment, origin, path = '/data' } = {}) {
  captureDirectory = resolve(captureDirectory); outputDirectory = resolve(outputDirectory);
  if (outputDirectory === captureDirectory || outputDirectory.startsWith(captureDirectory + '/')) throw fault('OGC_OUTPUT_SEPARATE');
  const manifest = await readCapture(captureDirectory);
  if (!manifest.complete) throw fault('OGC_CAPTURE_INCOMPLETE', 'Continue the same capture before exporting a complete dataset.');
  const plan = validatePlan(inputPlan, manifest.sourceId), planId = identity(plan);
  if ((payment === undefined) !== (origin === undefined)) throw fault('OGC_PAYMENT_ORIGIN_REQUIRED');
  const operationId = identity({ sourceId: manifest.sourceId, planId, payment: payment ?? null, origin: origin ?? null, path });
  await privateDirectory(outputDirectory, true);
  const release = await acquireWorkspace(outputDirectory);
  try {
    let existing;
    try { existing = await readJson(join(outputDirectory, 'export.json'), 32*1024*1024); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) {
      if (existing.operationId !== operationId) throw fault('OGC_OUTPUT_ALREADY_USED');
      return await reopenExport(outputDirectory);
    }
    await createExact(join(outputDirectory, 'preparing.json'), bytes({ schema: 'stellar-forge.ogc-export-preparing.v1', operationId, sourceId: manifest.sourceId, planId }));
    const temporary = join(outputDirectory, '.csv-' + randomUUID());
    const handle = await open(temporary, 'wx', 0o600); let size = 0, rowCount = 0, written = false;
    try {
      const write = async data => { size += Buffer.byteLength(data); if (size > 256*1024*1024) throw fault('OGC_NATIVE_DATASET_TOO_LARGE'); await handle.writeFile(data); };
      await write(plan.columns.map(c => c.name).join(',') + '\n');
      for await (const { feature } of features(captureDirectory, manifest)) {
        rowCount++;
        const values = plan.columns.map(c => cell(pointer(feature, c.pointer), c, rowCount));
        if (values.some(v => v.length > plan.maxCellChars)) throw fault('OGC_CELL_TOO_LARGE');
        await write(values.map(csv).join(',') + '\n');
      }
      await handle.sync(); written = true;
    } finally { await handle.close(); if (!written) await unlink(temporary).catch(() => {}); }
    const target = join(outputDirectory, 'features.csv');
    try {
      const previous = await hashPrivate(target, 256*1024*1024), current = await hashPrivate(temporary, 256*1024*1024);
      if (previous.hash !== current.hash || previous.bytes !== current.bytes) throw fault('OGC_EXPORT_CHANGED', 'Existing features.csv differs from the reviewed export.');
      await unlink(temporary);
    } catch (error) { if (error.code !== 'ENOENT') { await unlink(temporary).catch(() => {}); throw error; } await rename(temporary, target); }
    const config = { schema: 'stellar-forge.csv-dataset.v1', file: 'features.csv', name: plan.name,
      columns: Object.fromEntries(plan.columns.map(c => [c.name, { type: c.type, nullable: c.nullable }])),
      filters: plan.filters, ranges: plan.ranges, sorts: plan.sorts, maxBytes: 256*1024*1024, maxRows: 1000000,
      maxCellChars: plan.maxCellChars, defaultLimit: plan.defaultLimit, maxLimit: plan.maxLimit };
    await createExact(join(outputDirectory, 'dataset.json'), bytes(config));
    await createExact(join(outputDirectory, 'plan.json'), bytes(plan));
    const dataset = await loadDatasetConfig(join(outputDirectory, 'dataset.json'));
    if (dataset.describe().rowCount !== rowCount || rowCount !== manifest.rows) throw fault('OGC_ROW_COUNT_CHANGED');
    const files = ['features.csv', 'dataset.json', 'plan.json'];
    if (payment !== undefined) {
      const seller = await buildDatasetSellerConfig(dataset, { payment, origin, path });
      await createExact(join(outputDirectory, 'seller.json'), bytes(seller)); files.push('seller.json');
    }
    // Complete original source travels beside the derived dataset; no owner-host path binding.
    await privateDirectory(join(outputDirectory, 'source'), true);
    await privateDirectory(join(outputDirectory, 'source', 'pages'), true);
    await createExact(join(outputDirectory, 'source', 'capture.json'), await readPrivate(join(captureDirectory, 'capture.json'), 2*1024*1024)); files.push('source/capture.json');
    for (const [i, page] of manifest.pages.entries()) {
      const index = 'source/pages/p' + String(i).padStart(8, '0') + '.json';
      await createExact(join(outputDirectory, index), await readPrivate(join(captureDirectory, 'pages', index.split('/').at(-1)), 262144));
      files.push(index);
      const name = 'source/pages/' + page.file;
      await createExact(join(outputDirectory, name), await readPrivate(join(captureDirectory, 'pages', page.file), manifest.config.pageBytes));
      if (!files.includes(name)) files.push(name);
    }
    await syncDirectory(join(outputDirectory, 'source', 'pages')); await syncDirectory(join(outputDirectory, 'source'));
    const result = { schema: 'stellar-forge.ogc-export.v1', operationId, sourceId: manifest.sourceId, planId,
      createdAt: stamp(), dataset: dataset.describe(), files: [] };
    for (const name of files) { const info = await hashPrivate(join(outputDirectory, name), 256*1024*1024); result.files.push({ path: name, bytes: info.bytes, sha256: info.hash }); }
    await createFile(join(outputDirectory, 'export.json'), bytes(result)); await syncDirectory(outputDirectory);
    return { ...result, directory: outputDirectory, datasetPath: join(outputDirectory, 'dataset.json') };
  } finally { await release(); }
}
