// MIT. Captured OpenSearch editions through the original SF30 dataset engine.
import { constants } from 'node:fs';
import { open, mkdir, link, unlink, rm, lstat, realpath } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openWorkspaceStore } from './workspace/store.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { datasetControl } from '../dataset-refresh/service.mjs';
import { startDatasetWorkspace } from '../dataset-workspace.mjs';
import { exportSellerClient, inspectSellerClientExport } from '../developer/client-export.mjs';
import { DATASET_BINDING_SCHEMA, datasetContractSha256, prepareDatasetRelease,
  stageDatasetRelease, inspectDatasetRelease, startDatasetRelease } from '../../sf82-seller-pilot/release-dataset.mjs';

export const CAPTURED_DATASET_SCHEMA = 'stellar-forge.opensearch-captured-dataset.v1';
const ORIGIN_SCHEMA = 'stellar-forge.opensearch-captured-origin.v1';
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const CORE = { rank: 'integer', document_index: 'string', document_id: 'string',
  score_json: 'string', source_json: 'string', sort_json: 'string', exact_integer_paths_json: 'string' };
const FILES = ['dataset.csv', 'dataset.json', 'seller.json', 'binding.json', 'source.json',
  'capture/result.json', 'capture/edition.json', 'capture/projection.json'];
const MAXIMUM = 64 * 1024 * 1024;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const stable = x => JSON.stringify(x, (_, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const encode = x => Buffer.from(JSON.stringify(x, null, 2) + '\n');
const hash = x => createHash('sha256').update(x).digest('hex');
const same = (a, b) => stable(a) === stable(b);
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
function need(condition, message, code = 'CAPTURED_DATASET_INVALID') {
  if (!condition) throw fail(code, message);
}
function checkedHash(value, name) { need(HASH.test(value ?? ''), name + ' must be an original SHA-256.'); return value; }
function bindingPath(value) {
  need(typeof value === 'string' && value && !value.includes('\0'), 'Choose a version-store directory.');
  const path = resolve(value); need(path !== '/', 'Choose a private version-store directory.'); return path;
}
function separate(left, right) {
  const part = relative(left, right);
  return part && (part === '..' || part.startsWith('..' + sep) || isAbsolute(part));
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path,
    'Use a canonical directory without symlink parents.');
}
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}
async function originalBytes(path, maximum = MAXIMUM) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(maximum), 'The selected source is not a bounded regular file.');
    const raw = await file.readFile(), after = await file.stat({ bigint: true });
    need(BigInt(raw.length) === before.size && raw.length <= maximum &&
      before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs,
      'The selected source changed while being retained.', 'CAPTURED_SOURCE_CHANGED');
    return raw;
  } finally { await file.close(); }
}
async function jsonFile(path, maximum) {
  const bytes = await originalBytes(path, maximum);
  try { return { bytes, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }; }
  catch { throw fail('CAPTURED_JSON_INVALID', 'Use complete original UTF-8 JSON.'); }
}
async function writeNew(path, raw) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
}
async function installExact(path, raw) {
  const temporary = join(dirname(path), '.captured-' + randomUUID());
  try {
    await writeNew(temporary, raw);
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need((await originalBytes(path)).equals(raw), 'The retained destination contains different bytes.', 'CAPTURED_DESTINATION_CHANGED');
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
const descriptor = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });
function projectedValue(source, field) {
  function visit(value, parts) {
    if (!parts.length) return value;
    if (Array.isArray(value)) {
      const selected = value.map(item => visit(item, parts));
      return selected.every(item => item === undefined) ? undefined : selected.map(item => item === undefined ? null : item);
    }
    if (!object(value)) return undefined;
    const literal = parts.join('.');
    if (Object.hasOwn(value, literal)) return value[literal];
    return Object.hasOwn(value, parts[0]) ? visit(value[parts[0]], parts.slice(1)) : undefined;
  }
  return visit(source, field.split('.'));
}
function projectionDefinition(value, fields) {
  need(Array.isArray(value) && value.length <= 32, 'Choose at most 32 explicit projected fields.');
  const used = new Set(Object.keys(CORE));
  return value.map(item => {
    need(object(item) && Object.keys(item).every(key => ['field', 'name', 'type', 'nullable', 'encoding'].includes(key)) &&
      typeof item.field === 'string' && fields.includes(item.field) && NAME.test(item.name ?? '') && !used.has(item.name) &&
      ['string', 'integer', 'number', 'boolean'].includes(item.type) &&
      (item.nullable === undefined || typeof item.nullable === 'boolean') &&
      (item.encoding === undefined || item.encoding === 'json' && item.type === 'string'),
      'Each projection needs an original declared field, unique dataset column and explicit native type.');
    used.add(item.name);
    return { field: item.field, name: item.name, type: item.type, nullable: item.nullable ?? false,
      ...(item.encoding ? { encoding: item.encoding } : {}) };
  });
}
function columnValue(hit, item) {
  const value = projectedValue(hit._source, item.field);
  if (item.encoding === 'json') return JSON.stringify(value === undefined ? null : value);
  if (value === null || value === undefined) {
    need(item.nullable, 'A selected non-nullable field is absent: ' + item.field); return '';
  }
  need(item.type === 'string' && typeof value === 'string' ||
    item.type === 'integer' && Number.isSafeInteger(value) ||
    item.type === 'number' && typeof value === 'number' && Number.isFinite(value) ||
    item.type === 'boolean' && typeof value === 'boolean',
    'A source value does not match its declared projection type: ' + item.field);
  return String(value);
}
function csvCell(value) {
  const text = String(value);
  need(text.length <= 1048576, 'A source value exceeds the native dataset cell limit.');
  return '"' + text.replaceAll('"', '""') + '"';
}
function projectionCsv(result, projection) {
  const names = [...Object.keys(CORE), ...projection.map(item => item.name)], seen = new Set();
  const rows = [names.map(csvCell).join(',')];
  result.hits.forEach((hit, index) => {
    need(object(hit) && typeof hit._index === 'string' && typeof hit._id === 'string',
      'The original result lacks index/document identity.');
    const key = JSON.stringify([hit._index, hit._id]); need(!seen.has(key), 'The original result repeats a document identity.'); seen.add(key);
    const values = [index + 1, hit._index, hit._id, JSON.stringify(hit._score ?? null),
      JSON.stringify(hit._source ?? null), JSON.stringify(hit.sort ?? []), JSON.stringify(hit.exactIntegerPaths ?? []),
      ...projection.map(item => columnValue(hit, item))];
    rows.push(values.map(csvCell).join(','));
  });
  const raw = Buffer.from(rows.join('\r\n') + '\r\n');
  need(raw.length <= MAXIMUM, 'The complete projection exceeds its 64 MiB budget.'); return raw;
}
function capabilities(value, columns, fallback, label) {
  const selected = value ?? fallback;
  need(Array.isArray(selected) && selected.length <= 8 && new Set(selected).size === selected.length &&
    selected.every(name => Object.hasOwn(columns, name)), label + ' must name distinct projected columns.');
  return selected;
}
async function publishPackage(output, files) {
  const root = resolve(output);
  await directory(dirname(root)); await directory(root); await directory(join(root, 'capture'));
  // This exact source declaration binds retries before their remaining payloads.
  await installExact(join(root, 'source.json'), files['source.json']);
  for (const name of FILES.filter(name => name !== 'source.json')) await installExact(join(root, name), files[name]);
  await syncDirectory(join(root, 'capture')); await syncDirectory(root);
  return readCapturedDataset(root);
}

/** Project a real retained edition; no provider is opened or impersonated. */
export async function prepareCapturedDataset({ store, editionId, directory: output, versionDirectory,
  payment, origin, path = '/captured-results', projection: supplied = [], filters, ranges, sorts } = {}) {
  need(store && typeof store.edition === 'function' && typeof store.resultText === 'function',
    'Use the original OpenSearch workspace store.');
  const root = resolve(output), versions = bindingPath(versionDirectory);
  need(separate(root, versions) && separate(versions, root), 'Keep the immutable package and mutable version store separate.');
  const edition = store.edition(editionId), resultRaw = Buffer.from(store.resultText(editionId));
  need(hash(resultRaw) === checkedHash(edition.resultSha256, 'Result identity'), 'The retained result checksum changed.');
  const result = JSON.parse(resultRaw);
  need(Array.isArray(result.hits) && result.hits.length <= 1000000 && Array.isArray(result.fields),
    'Use the complete original OpenSearch result.');
  need(edition.sourceProfileSha256 === store.profileHash, 'The retained edition belongs to a different source profile.');
  const projection = projectionDefinition(supplied, result.fields), csv = projectionCsv(result, projection);
  const columns = { ...CORE, ...Object.fromEntries(projection.map(item => [item.name, { type: item.type, nullable: item.nullable }])) };
  const config = { schema: 'stellar-forge.csv-dataset.v1', file: 'dataset.csv',
    name: 'Captured OpenSearch results ' + store.id, columns,
    filters: capabilities(filters, columns, ['document_index', 'document_id'], 'Filters'),
    ranges: capabilities(ranges, columns, ['rank'], 'Ranges'),
    sorts: capabilities(sorts, columns, ['rank'], 'Sorts'),
    maxBytes: MAXIMUM, maxRows: Math.max(1, result.hits.length), maxCellChars: 1048576,
    defaultLimit: 25, maxLimit: 250 };
  // maxRows is an operational limit, not the capture count: keep it stable across editions.
  config.maxRows = 1000000;
  const editionRaw = encode(edition), projectionRaw = encode({ schema: 'stellar-forge.opensearch-captured-projection.v1',
    columns: projection, filters: config.filters, ranges: config.ranges, sorts: config.sorts,
    semantics: { rank: 'Original retained hit order, starting at one.',
      rows: 'Exactly the saved captured result set.',
      nulls: 'Nullable primitive columns use empty CSV for missing/null. The original result JSON preserves their distinction.',
      integers: 'Original exact integer encodings remain in source_json and exact_integer_paths_json.',
      query: 'Dataset filters apply to these captured rows; the original native query is retained in capture/edition.json.' } });
  await directory(dirname(root));
  const temporary = join(dirname(root), '.captured-package-' + randomUUID());
  await directory(temporary); await directory(join(temporary, 'capture'));
  try {
    const files = { 'dataset.csv': csv, 'dataset.json': encode(config),
      'capture/result.json': resultRaw, 'capture/edition.json': editionRaw, 'capture/projection.json': projectionRaw };
    for (const [name, raw] of Object.entries(files)) await writeNew(join(temporary, name), raw);
    const dataset = await loadDatasetConfig(join(temporary, 'dataset.json')), description = dataset.describe();
    const source = { schema: CAPTURED_DATASET_SCHEMA, mode: 'CAPTURED_EDITION',
      workspaceId: store.id, sourceProfileSha256: store.profileHash, editionId: edition.id,
      capturedAt: edition.capturedAt, resultSha256: edition.resultSha256,
      resultRows: result.hits.length, total: edition.total ?? result.total ?? null,
      truncated: Boolean(edition.truncated ?? result.truncated), queryName: edition.queryName,
      query: edition.query, input: edition.input, source: edition.source ?? result.source ?? null,
      numberEncoding: edition.numberEncoding ?? null, datasetSnapshot: description.snapshot,
      projection: JSON.parse(projectionRaw), sourceFiles: ['capture/result.json', 'capture/edition.json', 'capture/projection.json']
        .map(name => descriptor(name, files[name])) };
    const seller = await buildDatasetSellerConfig(dataset, { payment, origin, path });
    need(seller.routes[0].definition.queryParameters.length < 32, 'Keep one original query slot for snapshot selection.');
    seller.routes[0].definition.queryParameters.push({ ...DATASET_SNAPSHOT_PARAMETER });
    files['seller.json'] = encode(seller); files['source.json'] = encode(source);
    files['binding.json'] = encode({ schema: DATASET_BINDING_SCHEMA, datasetDirectory: versions,
      contractSha256: datasetContractSha256(description), baselineSnapshot: description.snapshot,
      sourceSha256: hash(files['source.json']) });
    for (const name of ['seller.json', 'source.json', 'binding.json']) await writeNew(join(temporary, name), files[name]);
    await prepareDatasetRelease(temporary);
    return await publishPackage(root, files);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function readCapturedDataset(directory) {
  const prepared = await prepareDatasetRelease(resolve(directory));
  const source = JSON.parse(prepared.retained['source.json']);
  need(source.schema === CAPTURED_DATASET_SCHEMA && source.mode === 'CAPTURED_EDITION' &&
    HASH.test(source.resultSha256 ?? '') && HASH.test(source.sourceProfileSha256 ?? '') &&
    source.datasetSnapshot === prepared.description.snapshot &&
    source.resultRows === prepared.description.rowCount, 'Select a complete captured-edition dataset package.');
  need(same(prepared.sourceFiles.map(item => item.path).sort(),
    ['capture/edition.json', 'capture/projection.json', 'capture/result.json']), 'The captured source packet inventory changed.');
  const resultRaw = await originalBytes(join(prepared.directory, 'capture/result.json'));
  const edition = (await jsonFile(join(prepared.directory, 'capture/edition.json'))).value;
  need(hash(resultRaw) === source.resultSha256 && edition.resultSha256 === source.resultSha256 &&
    edition.id === source.editionId && edition.sourceProfileSha256 === source.sourceProfileSha256,
    'The source edition and its exact native result differ.');
  const projection = (await jsonFile(join(prepared.directory, 'capture/projection.json'))).value;
  const result = JSON.parse(resultRaw), definitions = projectionDefinition(projection.columns, result.fields);
  const expectedColumns = { ...CORE, ...Object.fromEntries(definitions.map(item => [item.name, { type: item.type, nullable: item.nullable }])) };
  need(same(prepared.config.columns, expectedColumns) && same(prepared.config.filters, projection.filters) &&
    same(prepared.config.ranges, projection.ranges) && same(prepared.config.sorts, projection.sorts) &&
    prepared.config.name === 'Captured OpenSearch results ' + source.workspaceId,
    'The native query contract differs from its original captured projection.');
  need(projectionCsv(result, definitions).equals(prepared.retained['dataset.csv']) &&
    same(projection, source.projection), 'The dataset projection differs from the original retained hits.');
  return { ...prepared, captured: source };
}
function originBinding(prepared) {
  return { schema: ORIGIN_SCHEMA, workspaceId: prepared.captured.workspaceId,
    sourceProfileSha256: prepared.captured.sourceProfileSha256,
    contractSha256: prepared.binding.contractSha256,
    sellerSha256: hash(prepared.retained['seller.json']) };
}
async function assertOrigin(prepared, { allowMissing = false } = {}) {
  const filename = join(prepared.binding.datasetDirectory, 'opensearch-captured-origin.json');
  if (allowMissing && !await exists(filename)) return false;
  need(same((await jsonFile(filename, 16384)).value, originBinding(prepared)),
    'Use this version store with its original captured source, query contract and public terms.'); return true;
}
/** Initialize through the native kernel writer lease, then release it. */
export async function initializeCapturedDataset(directory) {
  const prepared = await readCapturedDataset(directory), root = prepared.binding.datasetDirectory;
  await directoryParent(root);
  const initialized = await exists(join(root, 'state.json'));
  const bound = initialized && await assertOrigin(prepared, { allowMissing: true });
  const versions = await openDatasetVersions({ directory: root, maxCachedVersions: 2, maxResidentRows: 1000000,
    ...(!initialized ? { initialConfig: join(prepared.directory, 'dataset.json'), retentionMs: 86400000,
      maxVersions: 8, maxRetainedBytes: 512 * 1024 * 1024 } : {}) });
  try {
    need(datasetContractSha256(versions.describe()) === prepared.binding.contractSha256,
      'The version store has a different original dataset contract.');
    if (!bound) {
      need(versions.status().current === prepared.binding.baselineSnapshot,
        'An unbound existing store has a different initial captured edition.');
      await installExact(join(root, 'opensearch-captured-origin.json'), encode(originBinding(prepared)));
      await syncDirectory(root);
    }
    return { source: prepared.captured, versions: versions.status() };
  } finally { await versions.close(); }
}
async function directoryParent(path) { await directory(dirname(path)); }

/** Publish another actual saved capture through the existing running writer CAS. */
export async function publishCapturedDataset({ directory, expectedSnapshot, expectedRevision } = {}) {
  const prepared = await readCapturedDataset(directory);
  await assertOrigin(prepared);
  checkedHash(expectedSnapshot, 'Current snapshot');
  need(Number.isSafeInteger(expectedRevision) && expectedRevision >= 1, 'Use the current original revision.');
  const result = await datasetControl(prepared.binding.datasetDirectory, 'refresh', {
    configPath: join(prepared.directory, 'dataset.json'), expectedSnapshot, expectedRevision });
  need(result.current === prepared.description.snapshot, 'The original version writer selected a different snapshot.');
  return { capture: prepared.captured, versions: result };
}

/** A receiver changes only the declared store location in a new package. */
export async function rebindCapturedDataset({ directory, versionDirectory, output } = {}) {
  const prepared = await readCapturedDataset(directory), root = resolve(output), versions = bindingPath(versionDirectory);
  need(separate(root, versions) && separate(versions, root) && root !== prepared.directory,
    'Choose a new immutable receiving package and separate version store.');
  const files = { ...prepared.retained };
  for (const file of prepared.sourceFiles) files[file.path] = await originalBytes(join(prepared.directory, file.path));
  files['binding.json'] = encode({ ...prepared.binding, datasetDirectory: versions });
  return publishPackage(root, files);
}

/** Own the original in-process seller and attach its existing query/rollback UI. */
export async function startCapturedDataset({ directory: packageDirectory, releaseDirectory,
  port = 0, workspacePort = 0, facilitator } = {}) {
  const prepared = await readCapturedDataset(packageDirectory), root = resolve(releaseDirectory);
  need(separate(prepared.directory, root) && separate(root, prepared.directory),
    'Keep the staged native release outside its immutable source package.');
  await initializeCapturedDataset(prepared.directory); await directoryParent(root);
  if (await exists(root)) {
    const existing = await inspectDatasetRelease(root);
    need(same(existing.dataset, prepared.dataset), 'The staged release belongs to different captured source bytes.');
  } else await stageDatasetRelease(root, prepared.directory);
  const runtime = { port, ...(facilitator === undefined ? {} : { facilitator }) };
  const session = await startDatasetRelease(root, { runtime });
  let workspace, closing, closed = false;
  const exportTasks = new Set();
  try {
    workspace = await startDatasetWorkspace({ stateDirectory: prepared.binding.datasetDirectory, port: workspacePort,
      resource: prepared.service.publicOrigin + prepared.service.routes[0].path });
    return {
      mode: 'CAPTURED_EDITION', session, workspace, package: prepared,
      source: prepared.captured, url: session.url, operatorUrl: workspace.url,
      versionDirectory: prepared.binding.datasetDirectory, releaseDirectory: root,
      status: () => datasetControl(prepared.binding.datasetDirectory, 'status'),
      publish: input => publishCapturedDataset(input),
      exportClient: ({ directory, exportId }) => {
        const task = (async () => {
        need(!closed, 'The original captured seller has closed.');
        const response = await fetch(session.url + '/_seller/openapi.json', { redirect: 'error',
          signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } });
        need(response.ok, 'The original seller API description is unavailable.');
        const chunks = []; let length = 0;
        for await (const chunk of response.body) {
          length += chunk.length;
          need(length <= 16 * 1024 * 1024, 'The original seller API description exceeds the export limit.');
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks);
        const target = resolve(directory); await directoryParent(target);
        if (await exists(target)) {
          const existing = await inspectSellerClientExport({ directory: target, exportId });
          need(existing.state === 'COMPLETE' && existing.sourceSha256 === hash(raw),
            'An existing export has different or incomplete original client bytes.');
          return existing;
        }
        const temporary = join(dirname(target), '.captured-openapi-' + randomUUID() + '.json');
        try {
          await writeNew(temporary, raw);
          return await exportSellerClient({ openapi: temporary, out: target, provenance: { exportId } });
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
        })();
        exportTasks.add(task);
        task.then(() => exportTasks.delete(task), () => exportTasks.delete(task));
        return task;
      },
      close: () => {
        if (!closing) closing = (async () => {
          closed = true;
          await Promise.allSettled([...exportTasks]);
          try { await workspace.close(); } finally { await session.close(); }
        })();
        return closing;
      },
    };
  } catch (error) { await workspace?.close().catch(() => {}); await session.close().catch(() => {}); throw error; }
}

const HELP = [
  'Captured OpenSearch editions — original dataset operator and seller',
  'prepare --workspace ORIGINAL_DIR --profile ORIGINAL_SHA --edition ORIGINAL_ID --out PACKAGE --state VERSION_DIR',
  '        --payment PUBLIC_TERMS.json --origin HTTPS_ORIGIN [--path /captured-results] [--projection PROJECTION.json]',
  'inspect --package PACKAGE',
  'rebind --package PACKAGE --state NEW_VERSION_DIR --out NEW_PACKAGE',
  'serve --package PACKAGE --release STAGED_RELEASE [--port 0] [--workspace-port 0] [--facilitator HTTPS_URL]',
  '      [--client-out NEW_DIR --client-id ID]',
  'publish --package NEW_CAPTURE_PACKAGE --expect CURRENT_SNAPSHOT --expect-revision REVISION',
  'status --state VERSION_DIR',
  'activate --state VERSION_DIR --snapshot RETAINED_SNAPSHOT --expect CURRENT_SNAPSHOT --expect-revision REVISION',
  'The original captured query/result travel with every package. Dataset requests query the saved rows.',
  'Open the printed operator URL for native query preparation, exports and snapshot rollback.',
  'Choose the original configured facilitator for payment verification and settlement; otherwise serve advertises HTTP 402 challenges.',
].join('\n');
function options(args) {
  const [action, ...tokens] = args;
  const allowed = {
    prepare: ['--workspace','--profile','--edition','--out','--state','--payment','--origin','--path','--projection'],
    inspect: ['--package'], rebind: ['--package','--state','--out'],
    serve: ['--package','--release','--port','--workspace-port','--facilitator','--client-out','--client-id'],
    publish: ['--package','--expect','--expect-revision'],
    status: ['--state'], activate: ['--state','--snapshot','--expect','--expect-revision'],
  }[action];
  need(allowed && tokens.length % 2 === 0, HELP, 'CAPTURED_OPTIONS');
  const flags = {};
  for (let i = 0; i < tokens.length; i += 2) {
    need(allowed.includes(tokens[i]) && !Object.hasOwn(flags, tokens[i]) && tokens[i + 1] && !tokens[i + 1].startsWith('--'),
      HELP, 'CAPTURED_OPTIONS'); flags[tokens[i]] = tokens[i + 1];
  }
  return { action, flags };
}
const required = (f, key) => { need(f[key], key + ' is required.', 'CAPTURED_OPTIONS'); return f[key]; };
function integer(f, key, fallback) {
  if (f[key] === undefined) return fallback;
  need(/^(0|[1-9][0-9]*)$/.test(f[key]) && Number.isSafeInteger(Number(f[key])), key + ' must be an integer.');
  return Number(f[key]);
}
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args.length === 1 && ['--help', 'help'].includes(args[0])) { process.stdout.write(HELP + '\n'); return; }
  const { action, flags: f } = options(args);
  if (action === 'prepare') {
    const profile = checkedHash(required(f, '--profile'), 'Source profile');
    const store = await openWorkspaceStore(required(f, '--workspace'), profile);
    try {
      const projection = f['--projection'] ? (await jsonFile(f['--projection'], 65536)).value : {};
      need(object(projection) && Object.keys(projection).every(key => ['projection','filters','ranges','sorts'].includes(key)), 'Use declared projection options.');
      const result = await prepareCapturedDataset({ store, editionId: required(f, '--edition'), directory: required(f, '--out'),
        versionDirectory: required(f, '--state'), payment: (await jsonFile(required(f, '--payment'), 16384)).value,
        origin: required(f, '--origin'), path: f['--path'] ?? '/captured-results', ...projection });
      return print({ directory: result.directory, capture: result.captured, dataset: result.description });
    } finally { store.close(); }
  }
  if (action === 'inspect') {
    const value = await readCapturedDataset(required(f, '--package'));
    return print({ directory: value.directory, capture: value.captured, dataset: value.description, binding: value.binding });
  }
  if (action === 'rebind') {
    const value = await rebindCapturedDataset({ directory: required(f, '--package'), versionDirectory: required(f, '--state'), output: required(f, '--out') });
    return print({ directory: value.directory, capture: value.captured, binding: value.binding });
  }
  if (action === 'status') return print(await datasetControl(required(f, '--state'), 'status'));
  if (action === 'publish') return print(await publishCapturedDataset({ directory: required(f, '--package'),
    expectedSnapshot: required(f, '--expect'), expectedRevision: integer(f, '--expect-revision') }));
  if (action === 'activate') return print(await datasetControl(required(f, '--state'), 'activate', {
    snapshot: required(f, '--snapshot'), expectedSnapshot: required(f, '--expect'), expectedRevision: integer(f, '--expect-revision') }));
  need(Boolean(f['--client-out']) === Boolean(f['--client-id']), 'Choose both client output and its original export ID.');
  const app = await startCapturedDataset({ directory: required(f, '--package'), releaseDirectory: required(f, '--release'),
    port: integer(f, '--port', 0), workspacePort: integer(f, '--workspace-port', 0),
    facilitator: f['--facilitator'] });
  try {
    const client = f['--client-out'] ? await app.exportClient({ directory: f['--client-out'], exportId: f['--client-id'] }) : null;
    print({ mode: app.mode, source: app.source, seller: app.url, operator: app.operatorUrl,
      versions: await app.status(), ...(client ? { client } : {}) });
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; app.close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return app;
  } catch (error) { await app.close(); throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'CAPTURED_DATASET', message: error.message }) + '\n'); process.exitCode = 1; });
