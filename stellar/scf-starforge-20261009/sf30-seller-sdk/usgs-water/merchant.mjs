// MIT. Portable USGS editions on the ORIGINAL SF30 / SF61 / SF82 / SF88 stack.
import { constants } from 'node:fs';
import { open, lstat, realpath, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readCapture, captureRows, retainedFiles } from './provider.mjs';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { datasetQueryParameters, buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { readResponseAsset, assetRequestAdmission, MAX_ASSET_BYTES, MAX_ASSET_BUDGET } from '../response-asset.mjs';
import { readSellerConfig, startSellerService } from '../serve.mjs';
import { run as compileOpenApi } from '../../sf61-openapi-seller-import/cli.mjs';
import { launch as launchPilot } from '../../sf82-seller-pilot/pilot.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { writeBytes as writeNativeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { validateDatasetQuery, inspectDatasetPage } from '../../sf88-operator-buyer-cli/dataset-page.mjs';

const EDITION = 'starforge.usgs-water-edition.v1';
const PLAN = 'starforge.usgs-water-merchant.v1';
const PURCHASE = 'starforge.usgs-water-purchase.v1';
const PROJECTION = 'usgs-observation-csv.v1';
const MAX_FILE = 256 * 1024 * 1024;
const PAGE_BYTES = 900 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw new TypeError(message); };
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const copy = value => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  need(plain(value), 'Edition metadata must contain JSON values.');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const identityHash = value => digest(canonical(value));
const descriptor = (path, bytes, role) => ({ path, sha256: digest(bytes), bytes: bytes.length, role });

function memberPath(directory, relative) {
  need(typeof relative === 'string' && relative.length > 0 && relative.length <= 1024 &&
    !relative.includes('\\') && !relative.includes('\0') &&
    relative.split('/').every(part => part && part !== '.' && part !== '..'),
  'Use a retained relative edition member.');
  const path = resolve(directory, relative);
  need(path.startsWith(resolve(directory) + sep), 'Edition member leaves its directory.');
  return path;
}
async function readBytes(path, max = MAX_FILE) {
  need(await realpath(dirname(path)) === dirname(path), 'Retained file parent must be canonical.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) &&
      before.size <= max, 'Retained file must be private, regular, and within its byte ceiling.');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    need(bytes.length === before.size && bytes.length <= max && after.size === before.size &&
      after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
    'Retained file changed while it was read.');
    return bytes;
  } finally { await handle.close(); }
}
async function readMember(directory, item) {
  need(plain(item) && /^[a-f0-9]{64}$/.test(item.sha256) &&
    Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= MAX_FILE,
  'Invalid retained member descriptor.');
  const bytes = await readBytes(memberPath(directory, item.path), Math.max(1, item.bytes));
  need(bytes.length === item.bytes && digest(bytes) === item.sha256, 'Retained edition member changed: ' + item.path);
  return bytes;
}
async function writeMember(directory, relative, bytes) {
  bytes = Buffer.from(bytes);
  need(bytes.length <= MAX_FILE, 'Edition member exceeds the native 256 MiB file ceiling.');
  const path = memberPath(directory, relative);
  await privateDirectory(dirname(path));
  try { await writeNativeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need((await readBytes(path)).equals(bytes), 'Existing immutable edition member differs: ' + relative);
  }
}
async function optionalRecord(path) {
  try { return await readPrivateJson(path, 16 * 1024 * 1024); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const fields = [
  'feature_id', 'collection', 'monitoring_location_id', 'time_series_id',
  'parameter_code', 'statistic_id', 'time', 'value', 'value_state', 'unit_of_measure',
  'approval_status', 'qualifier_json', 'last_modified', 'method_category',
  'local_date', 'continuous_epoch_ms', 'source_url', 'source_sha256', 'source_stream',
  'source_page', 'source_index', 'duplicate', 'conflicting_duplicate',
  'properties_json', 'geometry_json',
];
const requiredStrings = new Set(['collection', 'value_state', 'source_url',
  'source_sha256', 'source_stream', 'properties_json', 'geometry_json']);
const columnSchema = Object.fromEntries(fields.map(name => [name,
  ['duplicate', 'conflicting_duplicate'].includes(name) ? 'boolean' :
  ['source_page', 'source_index'].includes(name) ? 'integer' :
  name === 'continuous_epoch_ms' ? { type: 'integer', nullable: true } :
  { type: 'string', nullable: !requiredStrings.has(name) }]));
function projection(row) {
  const time = typeof row.time === 'string' ? row.time : null;
  const instant = time && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(time)
    ? Date.parse(time) : NaN;
  const value = { ...row,
    qualifier_json: row.qualifier == null ? null : JSON.stringify(row.qualifier),
    local_date: time && /^\d{4}-\d\d-\d\d$/.test(time) ? time : null,
    continuous_epoch_ms: Number.isFinite(instant) ? instant : null,
    duplicate: row.duplicate === true, conflicting_duplicate: row.conflicting_duplicate === true,
    properties_json: JSON.stringify(row.properties), geometry_json: JSON.stringify(row.geometry ?? null),
  };
  need(typeof value.properties_json === 'string', 'Provider rows must retain original feature properties.');
  return fields.map(name => value[name] == null ? '' : String(value[name]));
}
const csvCell = value => '"' + value.replace(/"/g, '""') + '"';
function editionIdentity(manifest) {
  return { schema: EDITION, projection: PROJECTION, captureSha256: manifest.captureSha256,
    selectionSha256: manifest.selectionSha256, operationId: manifest.operationId,
    capturedAt: manifest.capturedAt, selection: manifest.selection, summary: manifest.summary,
    files: manifest.files, dataset: manifest.dataset, rowCount: manifest.rowCount };
}

/** Copy the entire capture, then build one native CSV generation. No upstream request. */
export async function prepareWaterEdition({ directory, capture, analysis, review } = {}) {
  directory = resolve(directory);
  await privateDirectory(directory);
  const source = await readCapture(typeof capture === 'string' ? capture : capture?.directory);
  need(source.status === 'COMPLETE', 'Complete the selected USGS capture before preparing its sale edition.');
  if (capture?.captureSha256) need(capture.captureSha256 === source.captureSha256, 'Capture identity changed.');
  const sourceFiles = await retainedFiles(source);
  const rows = await captureRows(source);
  need(Array.isArray(rows) && rows.length <= 1000000, 'The original dataset supports at most 1,000,000 rows.');
  const csv = Buffer.from([fields.map(csvCell).join(','),
    ...rows.map(row => projection(row).map(csvCell).join(','))].join('\n') + '\n');
  const jsonl = Buffer.from(rows.map(row => JSON.stringify(row) + '\n').join(''));
  need(csv.length <= MAX_FILE && jsonl.length <= MAX_FILE, 'Split a selection larger than the native 256 MiB edition file ceiling.');
  const datasetConfig = {
    schema: 'stellar-forge.csv-dataset.v1', file: 'observations.csv',
    name: 'USGS Water ' + source.captureSha256.slice(0, 16), columns: columnSchema,
    filters: ['collection', 'monitoring_location_id', 'time_series_id', 'parameter_code',
      'approval_status', 'value_state', 'duplicate', 'conflicting_duplicate'],
    ranges: ['local_date', 'continuous_epoch_ms'],
    sorts: ['local_date', 'continuous_epoch_ms', 'source_page', 'source_index'],
    maxBytes: MAX_FILE, maxRows: Math.max(1, rows.length), maxCellChars: 1024 * 1024,
    defaultLimit: 50, maxLimit: 250, maxPageBytes: PAGE_BYTES,
  };
  return withPrivateLock(directory, 'edition.lock', async () => {
    const members = [];
    for (const entry of sourceFiles) {
      const bytes = await readMember(source.directory, entry);
      const target = 'capture/' + entry.path;
      await writeMember(directory, target, bytes);
      members.push(descriptor(target, bytes, 'CAPTURE_MEMBER'));
    }
    for (const [path, bytes, role] of [
      ['observations.csv', csv, 'QUERY_PROJECTION'],
      ['observations.jsonl', jsonl, 'NORMALIZED_FEATURES'],
      ['dataset.json', json(datasetConfig), 'NATIVE_DATASET_CONFIG'],
      ...(analysis === undefined ? [] : [['analysis.json', json(analysis), 'ANALYSIS']]),
      ...(review === undefined ? [] : [['review.json', json(review), 'WORKSPACE_REVIEW']]),
    ]) {
      await writeMember(directory, path, bytes);
      members.push(descriptor(path, bytes, role));
    }
    const retained = await readCapture(join(directory, 'capture'));
    need(retained.captureSha256 === source.captureSha256, 'Copied capture identity differs.');
    const dataset = await loadDatasetConfig(join(directory, 'dataset.json'));
    const description = dataset.describe();
    need(description.rowCount === rows.length, 'Dataset projection row count differs.');
    const originalBodies = new Set(source.pages.map(page => 'capture/' + page.bodyFile));
    const manifest = {
      schema: EDITION, projection: PROJECTION, status: 'READY',
      captureSha256: source.captureSha256, selectionSha256: source.selectionSha256,
      operationId: source.operationId, capturedAt: source.completedAt,
      selection: copy(source.selection), summary: copy(source.summary), rowCount: rows.length,
      dataset: description, snapshot: description.snapshot,
      files: members.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    };
    manifest.editionId = 'usgs-' + identityHash(editionIdentity(manifest));
    manifest.downloads = manifest.files.filter(item =>
      originalBodies.has(item.path) || item.path === 'capture/capture.json' || item.role === 'ANALYSIS')
      .map(item => ({ ...item, contentType: 'application/json' }));
    const previous = await optionalRecord(join(directory, 'edition.json'));
    if (previous) need(canonical(previous) === canonical(manifest), 'This directory already contains a different immutable edition.');
    else await atomicJson(directory, 'edition.json', manifest, { exclusive: true });
    return { ...manifest, directory };
  });
}

/** Reopen a portable edition using only its own files. */
export async function readWaterEdition(directory) {
  directory = resolve(directory);
  await privateDirectory(directory);
  const manifest = await readPrivateJson(join(directory, 'edition.json'), 16 * 1024 * 1024);
  need(manifest.schema === EDITION && manifest.projection === PROJECTION && manifest.status === 'READY' &&
    Array.isArray(manifest.files) && manifest.files.length >= 4 &&
    new Set(manifest.files.map(item => item.path)).size === manifest.files.length &&
    manifest.editionId === 'usgs-' + identityHash(editionIdentity(manifest)) &&
    manifest.snapshot === manifest.dataset?.snapshot &&
    manifest.rowCount === manifest.dataset?.rowCount && Number.isSafeInteger(manifest.rowCount) &&
    manifest.rowCount >= 0 && manifest.rowCount <= 1000000,
  'Edition manifest identity is invalid.');
  for (const item of manifest.files) await readMember(directory, item);
  const capture = await readCapture(join(directory, 'capture'));
  need(capture.status === 'COMPLETE' && capture.captureSha256 === manifest.captureSha256 &&
    capture.selectionSha256 === manifest.selectionSha256, 'Edition capture binding changed.');
  const pages = new Set(capture.pages.map(page => 'capture/' + page.bodyFile));
  const expectedDownloads = manifest.files.filter(item =>
    pages.has(item.path) || item.path === 'capture/capture.json' || item.role === 'ANALYSIS')
    .map(item => ({ ...item, contentType: 'application/json' }));
  need(canonical(manifest.downloads) === canonical(expectedDownloads), 'Edition download map changed.');
  return { ...manifest, directory };
}

function merchantIdentity({ editionId, snapshot, origin, path, payment }) {
  return { schema: PLAN, editionId, snapshot, origin, path, payment };
}
function merchantLocation(origin, path) {
  const url = new URL(origin);
  need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === '/' && origin.replace(/\/$/, '') === url.origin,
  'Select a canonical HTTPS public origin.');
  need(typeof path === 'string' && /^\/[A-Za-z0-9_.~/-]+$/.test(path) && !path.includes('//') &&
    new URL(path, url).pathname === path && !/^\/_seller(?:\/|$)/.test(path),
  'Select a canonical application path outside /_seller.');
  return { origin: url.origin, path: path.replace(/\/$/, '') };
}
function paymentTerms(payment) {
  need(plain(payment) && Object.keys(payment).every(key =>
    ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds'].includes(key)),
  'Use only the original public payment terms.');
  return copy(payment);
}
async function compiledMerchant(directory, plan) {
  const output = join(directory, 'merchant');
  const manifest = await readPrivateJson(join(output, 'manifest.json'), 1048576);
  need(manifest.schema === 'stellar.open-api-seller-manifest.v1', 'Original SF61 compiler manifest is required.');
  for (const [name, field] of [['openapi.json', 'specSha256'], ['selections.json', 'selectionsSha256'],
    ['bindings.json', 'serviceBindingsSha256']]) {
    const bytes = await readBytes(join(directory, 'merchant-inputs', name), 4 * 1024 * 1024);
    need(digest(bytes) === manifest[field], 'Original SF61 merchant input changed: ' + name);
  }
  const offersBytes = await readBytes(join(output, 'offers.json'), 4 * 1024 * 1024);
  const configBytes = await readBytes(join(output, 'seller-service.json'), 1048576);
  need(digest(offersBytes) === manifest.offersSha256 && digest(configBytes) === manifest.serviceConfigSha256,
    'Original SF61 export changed.');
  if (plan.offersSha256) need(plan.offersSha256 === manifest.offersSha256 &&
    plan.serviceConfigSha256 === manifest.serviceConfigSha256, 'Merchant binding changed.');
  const exported = JSON.parse(offersBytes.toString('utf8'));
  need(exported.schema === 'stellar.open-api-seller-import.v1' && exported.offers.length === 3,
    'The original USGS seller must contain its three declared routes.');
  const offers = exported.offers.map(row => row.seller);
  const urls = new Set(offers.map(offer => typeof offer.resource === 'string' ? offer.resource : offer.resource.url));
  need(Object.values(plan.paths).every(path => urls.has(plan.origin + path)), 'Compiled merchant routes differ from this edition.');
  return { directory: output, manifest, offers, config: await readSellerConfig(join(output, 'seller-service.json')) };
}

/** Export original SF61 offers and executable service bindings, once per edition. */
export async function stageWaterMerchant({ editionDirectory, origin, path = '/water', payment } = {}) {
  const edition = await readWaterEdition(editionDirectory);
  const location = merchantLocation(origin, path), terms = paymentTerms(payment);
  const dataset = await loadDatasetConfig(join(edition.directory, 'dataset.json'));
  need(dataset.describe().snapshot === edition.snapshot, 'Native dataset snapshot changed.');
  const base = location.path + '/' + edition.editionId;
  const paths = { observations: base + '/observations', source: base + '/source', edition: base + '/edition' };
  // This maintained compiler validates public payment terms and native path rules.
  await buildDatasetSellerConfig(dataset, { payment: terms, origin: location.origin, path: paths.observations });
  const identity = merchantIdentity({ editionId: edition.editionId, snapshot: edition.snapshot,
    ...location, payment: terms });
  const plan = { ...identity, planSha256: identityHash(identity), paths };
  return withPrivateLock(edition.directory, 'merchant.lock', async () => {
    const existing = await optionalRecord(join(edition.directory, 'merchant-plan.json'));
    if (existing) need(existing.planSha256 === plan.planSha256 &&
      canonical(merchantIdentity(existing)) === canonical(identity) &&
      canonical(existing.paths) === canonical(paths), 'This edition is already bound to different seller terms or a different origin.');
    else await atomicJson(edition.directory, 'merchant-plan.json', plan, { exclusive: true });
    const input = join(edition.directory, 'merchant-inputs');
    await privateDirectory(input);
    const parameters = datasetQueryParameters(dataset.describe()).map(item => ({
      in: 'query', name: item.name, required: false, description: item.description,
      schema: { type: item.type }, ...(item.example === '' ? {} : { example: item.example }),
    }));
    parameters.push({ in: 'query', name: 'snapshot', required: false,
      description: 'Exact immutable dataset snapshot for this edition.', schema: { type: 'string' },
      example: edition.snapshot });
    const response = { '200': { description: 'Retained JSON response from this immutable USGS edition.',
      content: { 'application/json': { schema: { type: 'object' } } } } };
    const spec = {
      openapi: '3.1.0', info: { title: 'USGS Water Data edition', version: edition.editionId },
      servers: [{ url: location.origin + '/' }],
      paths: {
        [paths.observations]: { get: { operationId: 'usgsObservations',
          summary: 'Query original observations with value, time, geometry and source provenance.',
          parameters, responses: response } },
        [paths.source]: { get: { operationId: 'usgsSource',
          summary: 'Download exact retained USGS GeoJSON or edition analysis JSON.',
          parameters: [{ in: 'query', name: 'file', required: true,
            description: 'A path in the edition manifest downloads list.', schema: { type: 'string' },
            example: edition.downloads[0]?.path ?? 'capture/capture.json' }], responses: response } },
        [paths.edition]: { get: { operationId: 'usgsEdition',
          summary: 'Get immutable edition identity, observation schema and source SHA-256 values.',
          responses: response } },
      },
    };
    const selections = Object.values(paths).map(path => ({
      method: 'GET', path, serviceName: 'USGS Water Data', accepts: [terms],
    }));
    const bindings = [
      { id: 'usgs-observations', method: 'GET', path: paths.observations, handler: 'queryWater', admit: 'admitWater' },
      { id: 'usgs-source', method: 'GET', path: paths.source, handler: 'sourceWater', admit: 'admitSourceWater' },
      { id: 'usgs-edition', method: 'GET', path: paths.edition, handler: 'editionWater', admit: 'admitEditionWater' },
    ];
    for (const [name, value] of [['openapi.json', spec], ['selections.json', selections], ['bindings.json', bindings]])
      await writeMember(input, name, json(value));
    const output = join(edition.directory, 'merchant');
    try { await lstat(output); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const temporary = join(edition.directory, '.merchant-' + randomUUID());
      try {
        await compileOpenApi(['--spec', join(input, 'openapi.json'), '--config', join(input, 'selections.json'),
          '--service-bindings', join(input, 'bindings.json'), '--out', temporary]);
        await rename(temporary, output);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    const native = await compiledMerchant(edition.directory, existing ?? plan);
    const staged = { ...plan, status: 'STAGED', offersSha256: native.manifest.offersSha256,
      serviceConfigSha256: native.manifest.serviceConfigSha256 };
    await atomicJson(edition.directory, 'merchant-plan.json', staged);
    return { ...staged, directory: edition.directory, merchantDirectory: native.directory };
  });
}

async function readMerchant(editionDirectory) {
  const edition = await readWaterEdition(editionDirectory);
  const plan = await readPrivateJson(join(edition.directory, 'merchant-plan.json'), 1048576);
  need(plan.schema === PLAN && plan.status === 'STAGED' &&
    plan.planSha256 === identityHash(merchantIdentity(plan)) &&
    plan.editionId === edition.editionId && plan.snapshot === edition.snapshot,
  'Stage the exact edition merchant before starting or purchasing it.');
  const location = merchantLocation(plan.origin, plan.path);
  const base = location.path + '/' + edition.editionId;
  need(canonical(plan.paths) === canonical({ observations: base + '/observations',
    source: base + '/source', edition: base + '/edition' }), 'Merchant route binding changed.');
  return { edition, plan, native: await compiledMerchant(edition.directory, plan) };
}
function queryEntries(query = {}) {
  const entries = query instanceof URLSearchParams ? [...query] : Object.entries(query);
  const values = new Map();
  for (const [key, value] of entries) {
    need(typeof value === 'string' && !values.has(key), 'Each query parameter must occur once and contain a string.');
    values.set(key, value);
  }
  return values;
}
const refused = (message, status = 400) => ({ status, body: { error: 'USGS_EDITION_REQUEST_INVALID', message } });

/** Preload exact JSON assets once and retain the original dataset admission path. */
export async function createWaterHandlers(editionDirectory) {
  return waterHandlers(await readWaterEdition(editionDirectory));
}
async function waterHandlers(edition) {
  const dataset = await loadDatasetConfig(join(edition.directory, 'dataset.json'));
  need(dataset.describe().snapshot === edition.snapshot, 'Native dataset snapshot changed.');
  const editionBytes = await readBytes(join(edition.directory, 'edition.json'), MAX_ASSET_BYTES);
  const editionFile = { path: 'edition.json', bytes: editionBytes.length, sha256: digest(editionBytes),
    contentType: 'application/json' };
  const assets = new Map();
  let retainedBytes = 0, maxResponseBytes = 1048576;
  for (const item of [...edition.downloads, editionFile]) {
    need(item.bytes <= MAX_ASSET_BYTES, 'Retained JSON member exceeds the original 16 MiB response ceiling: ' + item.path);
    retainedBytes += item.bytes;
    need(retainedBytes <= MAX_ASSET_BUDGET, 'Retained JSON downloads exceed the original 64 MiB asset budget; prepare a smaller complete selection.');
    maxResponseBytes = Math.max(maxResponseBytes, item.bytes);
    const asset = await readResponseAsset({ file: memberPath(edition.directory, item.path),
      sha256: item.sha256, contentType: item.contentType, downloadName: basename(item.path) },
    { maxBytes: MAX_ASSET_BYTES });
    assets.set(item.path, asset);
  }
  const cleanContext = context => {
    const query = queryEntries(context.query);
    if (query.has('snapshot')) {
      need(query.get('snapshot') === edition.snapshot, 'The requested snapshot differs from this immutable edition.');
      query.delete('snapshot');
    }
    return { ...context, query: new URLSearchParams([...query]) };
  };
  // Native admission and handler execution receive separate request copies.
  // Selection is pure over startup-retained data, so both phases resolve it.
  const sourceAsset = context => {
    const query = queryEntries(context.query);
    need(query.size === 1 && query.has('file'), 'Select one exact retained file.');
    const file = query.get('file');
    need(file !== 'edition.json' && assets.has(file), 'The selected file is not in this edition download list.');
    return assets.get(file);
  };
  const handlers = {
    admitWater(context) {
      try {
        return dataset.admit(cleanContext(context));
      } catch (error) { return refused(error.message); }
    },
    async queryWater(context) {
      return dataset.handle(cleanContext(context));
    },
    admitSourceWater(context) {
      const native = assetRequestAdmission(context);
      if (native !== true) return native;
      try {
        sourceAsset(context);
        return true;
      } catch (error) { return refused(error.message, 404); }
    },
    async sourceWater(context) {
      return sourceAsset(context).handler(context);
    },
    admitEditionWater(context) {
      const native = assetRequestAdmission(context);
      if (native !== true) return native;
      try { need(queryEntries(context.query).size === 0, 'The edition route takes no query parameters.'); return true; }
      catch (error) { return refused(error.message); }
    },
    editionWater: assets.get('edition.json').handler,
  };
  return { handlers, edition, dataset, maxResponseBytes, retainedBytes, editionFile };
}

/** Original SDK facilitator, loaded only when an actual paid runtime is requested. */
export async function createWaterNativeFactory({ facilitator, allowLocalFacilitator = false } = {}) {
  const url = new URL(facilitator);
  const local = allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  need((local || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash,
    'Use a credential-free HTTPS facilitator URL, or explicitly enable a loopback HTTP facilitator.');
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../native-factory.mjs'),
  ]);
  const facilitatorClient = new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') });
  return compiled => createNativeSellerServer(compiled, { facilitatorClient });
}

/** Root embedding uses nativeFactory; normal restart/readback remains owned by SF82. */
export async function startWaterMerchant({ editionDirectory, origin, path = '/water', payment,
  port = 8423, nativeFactory, facilitator, allowLocalFacilitator = false,
  challengeOnly = false, maxInFlight = 64, drainGraceMs = 60000, requestTimeoutMs } = {}) {
  need(!(nativeFactory && facilitator) && !(challengeOnly && (nativeFactory || facilitator)),
    'Choose an injected native factory, facilitator, or explicit challenge mode.');
  if (origin !== undefined || payment !== undefined)
    await stageWaterMerchant({ editionDirectory, origin, path, payment });
  const { edition, plan, native } = await readMerchant(editionDirectory);
  const application = await waterHandlers(edition);
  const config = { ...native.config, maxResponseBytes: application.maxResponseBytes,
    assetBudgetBytes: MAX_ASSET_BUDGET };
  const start = factory => startSellerService({ config, handlers: application.handlers, port,
    nativeFactory: factory, maxInFlight, drainGraceMs, requestTimeoutMs });
  let session;
  if (nativeFactory) session = await start(nativeFactory);
  else {
    const args = ['--resume', native.directory, '--port', String(port)];
    if (facilitator !== undefined) args.push('--facilitator', facilitator);
    if (allowLocalFacilitator) args.push('--allow-local-facilitator');
    if (challengeOnly) args.push('--challenge-only');
    session = await launchPilot(args, { serve: async forwarded => {
      const index = forwarded.indexOf('--facilitator');
      const selected = index < 0 ? null : await createWaterNativeFactory({
        facilitator: forwarded[index + 1], allowLocalFacilitator: forwarded.includes('--allow-local-facilitator'),
      });
      return start(selected);
    } });
  }
  return { ...session, merchantUrl: session.url, editionId: edition.editionId,
    snapshot: edition.snapshot, paths: copy(plan.paths), publicOrigin: plan.origin,
    merchantDirectory: native.directory, retainedSourceBytes: application.retainedBytes };
}

export async function waterMerchantStatus(editionDirectory) {
  const { native } = await readMerchant(editionDirectory);
  return launchPilot(['--status', native.directory]);
}

function purchasePin(prepared) {
  return { schema: PURCHASE, editionId: prepared.editionId, captureSha256: prepared.captureSha256,
    snapshot: prepared.snapshot, planSha256: prepared.planSha256, kind: prepared.kind,
    file: prepared.file, intentId: prepared.intentId, url: prepared.url,
    previous: prepared.previous, expected: prepared.expected, configSha256: prepared.configSha256 };
}

/** Prepare native SF88 selection from the original compiler's exact saved offers. */
export async function prepareWaterPurchase({ editionDirectory, intentId, query = {}, file,
  kind = file === undefined ? 'observations' : 'source', acceptIndex = 0, previous = null } = {}) {
  const { edition, plan, native } = await readMerchant(editionDirectory);
  need(['observations', 'source', 'edition'].includes(kind), 'Select observations, source, or edition.');
  const url = new URL(plan.origin + plan.paths[kind]);
  let expected = null;
  if (kind === 'observations') {
    need(file === undefined, 'A dataset purchase takes query parameters.');
    const selected = queryEntries(query);
    need(!selected.has('snapshot') || selected.get('snapshot') === edition.snapshot, 'Snapshot pin differs from the retained edition.');
    selected.set('snapshot', edition.snapshot);
    for (const [key, value] of selected) url.searchParams.append(key, value);
    url.searchParams.sort();
    validateDatasetQuery(url.href, { initial: previous === null });
    if (previous !== null) need(previous.snapshot === edition.snapshot &&
      previous.nextCursor !== null && previous.nextCursor === url.searchParams.get('cursor'),
    'Continue with the preceding native page metadata and its next cursor.');
    const dataset = await loadDatasetConfig(join(edition.directory, 'dataset.json'));
    const nativeQuery = new URLSearchParams(url.searchParams); nativeQuery.delete('snapshot');
    const decision = dataset.admit({ query: nativeQuery });
    need(decision === true, decision?.body?.message ?? 'The query is not admitted by the original dataset.');
  } else {
    need(queryEntries(query).size === 0 && previous === null, 'Exact JSON file purchases take no dataset query or cursor.');
    if (kind === 'source') {
      expected = edition.downloads.find(item => item.path === file);
      need(expected, 'Select an exact file from edition.downloads.');
      url.searchParams.set('file', file);
    } else {
      need(file === undefined, 'The edition route selects its manifest directly.');
      const bytes = await readBytes(join(edition.directory, 'edition.json'), MAX_ASSET_BYTES);
      expected = { path: 'edition.json', sha256: digest(bytes), bytes: bytes.length, contentType: 'application/json' };
    }
    need(expected.bytes <= MAX_ASSET_BYTES, 'The selected JSON member exceeds the native response ceiling.');
  }
  const raw = json({ resources: native.offers });
  const rowIndex = native.offers.findIndex(offer => {
    const resource = typeof offer.resource === 'string' ? offer.resource : offer.resource.url;
    return resource === plan.origin + plan.paths[kind];
  });
  const nativeReview = prepareReview(raw, { rowIndex, acceptIndex, intentId, url: url.href, method: 'GET' });
  const config = { ...nativeReview.draft, responseFile: expected ? {
    maxBytes: Math.max(1, expected.bytes), expectedSha256: expected.sha256,
    expectedBytes: expected.bytes, expectedContentType: expected.contentType,
  } : { maxBytes: PAGE_BYTES } };
  const prepared = { schema: PURCHASE, editionId: edition.editionId, captureSha256: edition.captureSha256,
    snapshot: edition.snapshot, planSha256: plan.planSha256, kind, file: file ?? null,
    intentId, url: url.href, previous: previous === null ? null : copy(previous),
    expected: expected === null ? null : copy(expected), configSha256: digest(json(config)), config };
  const pin = purchasePin(prepared);
  prepared.purchaseSha256 = identityHash(pin);
  const directory = join(edition.directory, 'buyer-preparations', digest(intentId));
  await privateDirectory(directory);
  await writeMember(directory, 'prepared.json', json(prepared));
  return { ...prepared, editionDirectory: edition.directory, directory };
}

async function validatePrepared(prepared, editionDirectory) {
  need(prepared?.schema === PURCHASE && prepared.purchaseSha256 === identityHash(purchasePin(prepared)) &&
    digest(json(prepared.config)) === prepared.configSha256,
  'Prepared native buyer request changed.');
  const current = await prepareWaterPurchase({ editionDirectory, intentId: prepared.intentId,
    kind: prepared.kind, ...(prepared.file === null ? {} : { file: prepared.file }),
    query: prepared.kind === 'observations' ? new URL(prepared.url).searchParams : {},
    acceptIndex: prepared.config.preparedFrom.acceptIndex, previous: prepared.previous });
  need(current.purchaseSha256 === prepared.purchaseSha256 &&
    canonical(current.config) === canonical(prepared.config), 'The saved request belongs to a different edition or original offer.');
  return current;
}
async function inspectDelivery(result, pin) {
  result.raiseForStatus();
  const bytes = await result.bytes({ limit: pin.expected ? Math.max(1, pin.expected.bytes) : PAGE_BYTES });
  if (pin.expected) need(bytes.length === pin.expected.bytes && digest(bytes) === pin.expected.sha256,
    'Native retained delivery differs from the purchased exact source.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const metadata = pin.kind === 'observations'
    ? inspectDatasetPage(bytes, { url: pin.url, expectedSnapshot: pin.snapshot, previous: pin.previous })
    : { path: pin.expected.path, sha256: digest(bytes), bytes: bytes.length,
      contentType: pin.expected.contentType };
  return { result, intentId: pin.intentId, editionId: pin.editionId, captureSha256: pin.captureSha256,
    snapshot: pin.snapshot, kind: pin.kind, file: pin.file, url: pin.url, metadata,
    value, ...(pin.kind === 'observations' ? { rows: value.rows } : {}) };
}

/** One real SF88 attempt. The supplied Buyer owns its existing operator and signer. */
export async function purchaseWaterEdition({ buyer, prepared,
  editionDirectory = prepared?.editionDirectory, signal } = {}) {
  need(buyer && typeof buyer.fromConfig === 'function' && typeof buyer.operation === 'function',
    'Supply the original SF88 Node Buyer.');
  signal?.throwIfAborted();
  const current = await validatePrepared(prepared, editionDirectory);
  const operation = await buyer.fromConfig(current.config);
  const review = await operation.review();
  const binding = { ...purchasePin(current), purchaseSha256: current.purchaseSha256,
    nativeConfigSha256: review.configSha256 };
  await atomicJson(operation.directory, 'water-edition.json', binding, { exclusive: true });
  const result = await operation.execute({ review, signal });
  return inspectDelivery(result, binding);
}

/** Reopen retained native result bytes without constructing another buyer attempt. */
export async function reopenWaterPurchase({ buyer, intentId, editionDirectory } = {}) {
  need(buyer && typeof buyer.operation === 'function', 'Supply the original SF88 Node Buyer.');
  const operation = buyer.operation(intentId);
  const binding = await readPrivateJson(join(operation.directory, 'water-edition.json'), 1048576);
  need(binding.schema === PURCHASE && binding.intentId === intentId &&
    binding.purchaseSha256 === identityHash(purchasePin(binding)), 'Retained water purchase binding changed.');
  const { edition, plan } = await readMerchant(editionDirectory);
  need(binding.editionId === edition.editionId && binding.captureSha256 === edition.captureSha256 &&
    binding.snapshot === edition.snapshot && binding.planSha256 === plan.planSha256,
  'Select the immutable edition purchased by this original operation.');
  const configBytes = await readBytes(operation.configPath, 65536);
  const config = JSON.parse(configBytes.toString('utf8'));
  need(digest(configBytes) === binding.nativeConfigSha256 && config.operation.intentId === intentId &&
    config.operation.url === binding.url && config.operation.method === 'GET',
  'Original operation config no longer matches this water purchase.');
  const prepared = await prepareWaterPurchase({ editionDirectory, intentId,
    kind: binding.kind, ...(binding.file === null ? {} : { file: binding.file }),
    query: binding.kind === 'observations' ? new URL(binding.url).searchParams : {},
    acceptIndex: config.preparedFrom.acceptIndex, previous: binding.previous });
  need(prepared.purchaseSha256 === binding.purchaseSha256,
    'The original operation no longer matches this edition offer and selected response.');
  const result = await operation.recover();
  if (result === null) return { state: 'AWAITING_NATIVE_RESULT', intentId, editionId: edition.editionId };
  need(result.record.configSha256 === binding.nativeConfigSha256, 'Original buyer result belongs to another config.');
  return inspectDelivery(result, binding);
}
