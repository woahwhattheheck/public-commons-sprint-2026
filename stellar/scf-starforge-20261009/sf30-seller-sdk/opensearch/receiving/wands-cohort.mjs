#!/usr/bin/env node
/**
 * Full original WANDS retrieval evaluation on a private native OpenSearch index.
 * Source license: MIT (WANDS). This runner is part of the maintained seller SDK.
 * No fabricated requests, judgments, scores, product fields or commerce records.
 */
import { createReadStream } from 'node:fs';
import { open, readFile, mkdir, stat, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'stellar-forge.wands-native-cohorts.v1';
const PIN = '3b74dcf4ba29ab8ff3e6a50b5b09fc627cb882b5';
export const WANDS_SOURCES = Object.freeze({
  products: {
    file: 'dataset/product.csv', bytes: 90621131,
    gitBlob: 'a415f7295dc0d90b3163ef606da611a4e9ddeca8',
    sha256: 'd993926254572e6eba96c8fd87cc549a17fb91ad3748308036eee4cf92b10ac6',
    rows: 42994,
    columns: ['product_id', 'product_name', 'product_class', 'category_hierarchy',
      'product_description', 'product_features', 'rating_count', 'average_rating', 'review_count'],
    retainedSlackFile: 'F0C8DPVAWUE'
  },
  queries: {
    file: 'dataset/query.csv', bytes: 19942,
    gitBlob: 'acb3c1f4cf1b775f494225afec79ec2163fc3e03',
    rows: 480, columns: ['query_id', 'query', 'query_class']
  },
  labels: {
    file: 'dataset/label.csv', bytes: 5736234,
    gitBlob: '2c09a0d7b1f77f6040deb5873b5a90b8ef1e3ae9',
    rows: 233448, columns: ['id', 'query_id', 'product_id', 'label']
  }
});
const LABELS = Object.freeze({ Exact: 2, Partial: 1, Irrelevant: 0 });
const FIELDS = Object.freeze({
  baseline: ['product_name', 'product_class', 'category_hierarchy',
    'product_description', 'product_features'],
  identifier_title: ['product_id^8', 'product_name^4', 'product_class^2',
    'category_hierarchy', 'product_description', 'product_features']
});
const PROPERTIES = Object.freeze({
  product_id: { type: 'keyword' },
  product_name: { type: 'text', analyzer: 'standard' },
  product_class: { type: 'text', analyzer: 'standard' },
  category_hierarchy: { type: 'text', analyzer: 'standard' },
  product_description: { type: 'text', analyzer: 'standard' },
  product_features: { type: 'text', analyzer: 'standard' },
  _source_record_sha256: { type: 'keyword', index: false, doc_values: false }
});

class WandsError extends Error {
  constructor(code, message, detail = undefined) {
    super(message); this.name = 'WandsError'; this.code = code; this.detail = detail;
  }
}
function fail(code, message, detail) { throw new WandsError(code, message, detail); }
function insist(value, code, message, detail) { if (!value) fail(code, message, detail); }
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function same(left, right) { return stable(left) === stable(right); }
function sourceUrl(name) {
  return 'https://raw.githubusercontent.com/wayfair/WANDS/' + PIN + '/' + WANDS_SOURCES[name].file;
}
function abortIf(signal) { if (signal?.aborted) throw signal.reason || new Error('Interrupted'); }
function now() { return new Date().toISOString(); }
function event(kind, value) { process.stdout.write(JSON.stringify({ time: now(), kind, ...value }) + '\n'); }
async function exists(file) {
  try { return await stat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function atomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.tmp-' + randomUUID();
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, file); await syncDirectory(path.dirname(file));
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {}); throw error;
  }
}
async function atomicJson(file, value) { await atomic(file, JSON.stringify(value, null, 2) + '\n'); }
async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function identify(file, expected = undefined, signal = undefined) {
  const info = await stat(file);
  insist(info.isFile(), 'WANDS_SOURCE_FILE', 'Source must be a regular file: ' + file);
  if (expected) insist(info.size === expected.bytes, 'WANDS_SOURCE_LENGTH',
    'Original source length differs: ' + file, { expected: expected.bytes, actual: info.size });
  const digest = createHash('sha256'), git = createHash('sha1');
  git.update('blob ' + info.size + '\0');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    abortIf(signal); bytes += chunk.length; digest.update(chunk); git.update(chunk);
  }
  insist(bytes === info.size, 'WANDS_SOURCE_CHANGED', 'Source changed while hashing: ' + file);
  const result = { bytes, sha256: digest.digest('hex'), gitBlob: git.digest('hex') };
  if (expected) {
    insist(result.gitBlob === expected.gitBlob, 'WANDS_SOURCE_GIT_BLOB',
      'Original Git blob differs: ' + file, { expected: expected.gitBlob, actual: result.gitBlob });
    if (expected.sha256) insist(result.sha256 === expected.sha256, 'WANDS_SOURCE_SHA256',
      'Original SHA-256 differs: ' + file);
  }
  return result;
}

/** RFC-style streaming TSV, including quoted delimiters, newlines and escaped quotes. */
export async function* parseTsv(file, signal = undefined) {
  let field = '', row = [], state = 'start', skipLF = false, first = true, characters = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  async function* accept(text) {
    for (const char of text) {
      characters++;
      if (first) { first = false; if (char === '\uFEFF') continue; }
      if (skipLF) { skipLF = false; if (char === '\n') continue; }
      if (state === 'quoted') {
        if (char === '"') state = 'after-quote'; else field += char;
        continue;
      }
      if (state === 'after-quote' && char === '"') { field += '"'; state = 'quoted'; continue; }
      if (char === '\t') { row.push(field); field = ''; state = 'start'; continue; }
      if (char === '\n' || char === '\r') {
        row.push(field); yield row; row = []; field = ''; state = 'start'; skipLF = char === '\r';
        continue;
      }
      insist(state !== 'after-quote', 'WANDS_TSV_QUOTE',
        'Unexpected text after a quoted TSV field', { characters });
      if (state === 'start' && char === '"') { state = 'quoted'; continue; }
      insist(char !== '"', 'WANDS_TSV_QUOTE', 'Unescaped quote in an unquoted TSV field', { characters });
      field += char; state = 'plain';
    }
  }
  for await (const chunk of createReadStream(file, { highWaterMark: 256 * 1024 })) {
    abortIf(signal); yield* accept(decoder.decode(chunk, { stream: true }));
  }
  yield* accept(decoder.decode());
  insist(state !== 'quoted', 'WANDS_TSV_UNCLOSED', 'Source ends inside a quoted TSV field');
  if (field.length || row.length || state !== 'start') { row.push(field); yield row; }
}
async function* records(file, expectedColumns, signal) {
  let columns, rowNumber = 0;
  for await (const row of parseTsv(file, signal)) {
    if (row.length === 1 && row[0] === '') continue;
    if (!columns) {
      columns = row;
      insist(same(columns, expectedColumns), 'WANDS_SOURCE_COLUMNS',
        'Original TSV columns differ', { file, expected: expectedColumns, actual: columns });
      continue;
    }
    rowNumber++;
    insist(row.length === columns.length, 'WANDS_TSV_WIDTH', 'TSV field count differs',
      { file, rowNumber, expected: columns.length, actual: row.length });
    yield Object.fromEntries(columns.map((column, index) => [column, row[index]]));
  }
  insist(columns, 'WANDS_SOURCE_EMPTY', 'Source has no header: ' + file);
}
async function downloadLabels(file, signal) {
  if (await exists(file)) return identify(file, WANDS_SOURCES.labels, signal);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const partial = file + '.partial';
  let offset = (await exists(partial))?.size || 0;
  insist(offset <= WANDS_SOURCES.labels.bytes, 'WANDS_DOWNLOAD_PARTIAL',
    'Retained original label partial is larger than the source');
  if (offset !== WANDS_SOURCES.labels.bytes) {
    const headers = { 'accept-encoding': 'identity' };
    if (offset) headers.range = 'bytes=' + offset + '-';
    const response = await fetch(sourceUrl('labels'), {
      headers, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120000)])
    });
    insist(response.ok && response.body, 'WANDS_DOWNLOAD_HTTP',
      'Original label retrieval failed', { status: response.status });
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      insist(range && Number(range[1]) === offset && Number(range[3]) === WANDS_SOURCES.labels.bytes,
        'WANDS_DOWNLOAD_RANGE', 'Original label resume returned a different range');
    } else {
      insist(response.status === 200, 'WANDS_DOWNLOAD_STATUS', 'Unexpected original source status');
      offset = 0;
    }
    const handle = await open(partial, offset ? 'a' : 'w', 0o600);
    let received = offset;
    try {
      for await (const chunk of response.body) {
        abortIf(signal); received += chunk.length;
        insist(received <= WANDS_SOURCES.labels.bytes, 'WANDS_DOWNLOAD_LIMIT',
          'Original label response exceeds the pinned length');
        await handle.writeFile(chunk);
      }
      await handle.sync();
    } finally { await handle.close(); }
    event('labels-received', { status: response.status, resumedAt: offset, bytes: received });
  }
  const identity = await identify(partial, WANDS_SOURCES.labels, signal);
  await rename(partial, file); await syncDirectory(path.dirname(file));
  await atomicJson(file + '.source.json', {
    schema: SCHEMA, url: sourceUrl('labels'), commit: PIN, ...identity, retainedAt: now()
  });
  return identity;
}
async function lock(directory) {
  const child = spawn('flock', [
    '--exclusive', '--nonblock', path.join(directory, '.wands-operation.lock'),
    process.execPath, '-e', "process.stdout.write('READY\\n');process.stdin.resume();"
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let alive = true, text = '', errorText = '';
  child.stderr.on('data', chunk => { errorText += chunk.toString().slice(0, 1024); });
  child.once('exit', () => { alive = false; });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (!text.includes('READY\n')) reject(new WandsError('WANDS_OPERATION_BUSY',
        'The retained operation is already running or its filesystem lease could not open',
        { code, signal, error: errorText }));
    });
    child.stdout.on('data', chunk => {
      text += chunk.toString();
      if (text.includes('READY\n')) resolve();
    });
  });
  return {
    assert() { insist(alive, 'WANDS_OPERATION_LEASE_LOST', 'The retained operation lease ended'); },
    async close() {
      if (!alive) return;
      const ended = once(child, 'exit'); child.stdin.end(); await ended;
    }
  };
}

async function inspectInputs({ products, queries, labels, signal }) {
  const identities = {};
  for (const [name, file] of Object.entries({ products, queries, labels }))
    identities[name] = await identify(file, WANDS_SOURCES[name], signal);
  const productHashes = new Map();
  let productsWithTitle = 0;
  for await (const record of records(products, WANDS_SOURCES.products.columns, signal)) {
    const id = record.product_id;
    insist(id !== '' && !productHashes.has(id), 'WANDS_PRODUCT_ID',
      'An original product ID is empty or repeated', { id });
    productHashes.set(id, sha256(stable(record)));
    if (record.product_name.trim()) productsWithTitle++;
  }
  insist(productHashes.size === WANDS_SOURCES.products.rows, 'WANDS_PRODUCT_COUNT',
    'Original product row count differs', { actual: productHashes.size });
  const queryRows = [], queryById = new Map(), queryTexts = new Set(), classes = new Set();
  for await (const record of records(queries, WANDS_SOURCES.queries.columns, signal)) {
    insist(record.query_id !== '' && !queryById.has(record.query_id), 'WANDS_QUERY_ID',
      'An original query ID is empty or repeated', { id: record.query_id });
    insist(record.query.trim() !== '' && !queryTexts.has(record.query), 'WANDS_QUERY_TEXT',
      'An original query is empty or repeated', { id: record.query_id });
    queryRows.push(record); queryById.set(record.query_id, record);
    queryTexts.add(record.query); classes.add(record.query_class);
  }
  insist(queryRows.length === WANDS_SOURCES.queries.rows, 'WANDS_QUERY_COUNT',
    'Original query row count differs', { actual: queryRows.length });
  const ratings = new Map(queryRows.map(query => [query.query_id, new Map()]));
  const labelIds = new Set(), labelCounts = { Exact: 0, Partial: 0, Irrelevant: 0 };
  let labelRows = 0, duplicateEqualPairs = 0;
  for await (const record of records(labels, WANDS_SOURCES.labels.columns, signal)) {
    labelRows++;
    insist(record.id !== '' && !labelIds.has(record.id), 'WANDS_LABEL_ID',
      'An original judgment ID is empty or repeated', { id: record.id });
    labelIds.add(record.id);
    insist(queryById.has(record.query_id), 'WANDS_LABEL_QUERY',
      'A judgment refers to an unknown original query', { id: record.query_id });
    insist(productHashes.has(record.product_id), 'WANDS_LABEL_PRODUCT',
      'A judgment refers to an unknown original product', { id: record.product_id });
    insist(Object.hasOwn(LABELS, record.label), 'WANDS_LABEL_VALUE',
      'An original label is not Exact, Partial or Irrelevant', { label: record.label });
    labelCounts[record.label]++;
    const queryRatings = ratings.get(record.query_id), rating = LABELS[record.label];
    if (queryRatings.has(record.product_id)) {
      insist(queryRatings.get(record.product_id) === rating, 'WANDS_LABEL_CONFLICT',
        'The source contains conflicting judgments for one query/product pair',
        { queryId: record.query_id, productId: record.product_id });
      duplicateEqualPairs++;
    } else queryRatings.set(record.product_id, rating);
  }
  insist(labelRows === WANDS_SOURCES.labels.rows, 'WANDS_LABEL_COUNT',
    'Original judgment row count differs', { actual: labelRows });
  const unratedQueries = queryRows.filter(query => !ratings.get(query.query_id).size).map(query => query.query_id);
  insist(!unratedQueries.length, 'WANDS_QUERY_UNRATED', 'Original queries lack judgments', { unratedQueries });
  return {
    identities, productHashes, queryRows, ratings,
    profile: {
      products: productHashes.size, productsWithTitle, queries: queryRows.length,
      queryClasses: classes.size, labelRows, uniqueQueryProductPairs: labelRows - duplicateEqualPairs,
      duplicateEqualPairs, labelCounts, queryIds: queryRows.map(query => query.query_id),
      queryIdsAreContiguous: queryRows.every((query, index) => query.query_id === String(index))
    }
  };
}
function validateEndpoint(value) {
  const url = new URL(value);
  insist(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    && !url.search && !url.hash, 'WANDS_ENDPOINT',
  'Use an HTTP(S) cluster base URL without URL credentials, query or fragment');
  const loopback = url.hostname === 'localhost' || /^127\./.test(url.hostname)
    || url.hostname === '[::1]' || url.hostname === '::1';
  insist(url.protocol === 'https:' || loopback, 'WANDS_ENDPOINT_TRANSPORT',
    'Plain HTTP is supported for the local development cluster; other endpoints require HTTPS');
  return url;
}
function createApi(endpoint, headers, signal, lease) {
  return async function request(method, route, body = undefined, options = {}) {
    abortIf(signal); lease.assert();
    const url = new URL(endpoint);
    const [pathname, query = ''] = route.split('?', 2);
    url.pathname = endpoint.pathname.replace(/\/$/, '') + '/' + pathname.replace(/^\//, '');
    url.search = query;
    const payload = body === undefined ? undefined : options.ndjson ? body : JSON.stringify(body);
    const response = await fetch(url, {
      method, redirect: 'error',
      headers: { ...headers, ...(payload === undefined ? {} : {
        'content-type': options.ndjson ? 'application/x-ndjson' : 'application/json'
      }) },
      body: payload, signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeout || 120000)])
    });
    const chunks = []; let bytes = 0;
    if (response.body) for await (const chunk of response.body) {
      bytes += chunk.length;
      insist(bytes <= 32 * 1024 * 1024, 'WANDS_NATIVE_RESPONSE_LIMIT',
        'Native response exceeds the 32 MiB operation limit');
      chunks.push(chunk);
    }
    let value;
    try { value = bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
    catch { fail('WANDS_NATIVE_JSON', 'Native cluster returned a non-JSON response', { status: response.status }); }
    if (!response.ok && !(options.accept || []).includes(response.status))
      fail('WANDS_NATIVE_HTTP', 'Native cluster request failed', {
        method, route, status: response.status,
        type: value.error?.type, reason: String(value.error?.reason || value.error || '').slice(0, 1500)
      });
    lease.assert();
    return { status: response.status, body: value };
  };
}
function mappingDefinition(identities) {
  return {
    schema: SCHEMA, dataset: { repository: 'wayfair/WANDS', commit: PIN, sources: identities },
    projection: { id: 'product_id', dynamic: false, properties: PROPERTIES },
    shards: 1, replicas: 0
  };
}
async function exactExistingDocuments(api, index, ids, productHashes) {
  if (!ids.length) return;
  const response = (await api('POST', index + '/_mget', {
    docs: ids.map(id => ({ _id: id, _source: [...WANDS_SOURCES.products.columns, '_source_record_sha256'] }))
  })).body;
  insist(Array.isArray(response.docs) && response.docs.length === ids.length,
    'WANDS_EXISTING_DOCUMENTS', 'Native retained document lookup is incomplete');
  for (let i = 0; i < ids.length; i++) {
    const document = response.docs[i], id = ids[i];
    insist(document.found && document._index === index && document._id === id
      && document._source?.product_id === id
      && document._source?._source_record_sha256 === productHashes.get(id),
    'WANDS_EXISTING_DOCUMENT_CHANGED',
    'A retained benchmark document differs from its exact original source record', { id });
    const original = Object.fromEntries(WANDS_SOURCES.products.columns.map(field => [field, document._source[field]]));
    insist(Object.values(original).every(value => typeof value === 'string')
      && sha256(stable(original)) === productHashes.get(id),
    'WANDS_EXISTING_DOCUMENT_CHANGED',
    'A retained native product body differs from its complete original source record', { id });
  }
}
async function prepareIndex({ api, index, input, products, signal, output, lease, expectedNative, retainNative }) {
  const definition = mappingDefinition(input.identities), definitionSha256 = sha256(stable(definition));
  const root = (await api('GET', '')).body;
  const version = String(root.version?.number || '');
  const match = /^(\d+)\.(\d+)\./.exec(version);
  insist(root.cluster_uuid && root.version?.distribution === 'opensearch' && match
    && (Number(match[1]) > 3 || Number(match[1]) === 3 && Number(match[2]) >= 3),
  'WANDS_NATIVE_VERSION', 'This operation requires a native OpenSearch 3.3+ cluster',
  { distribution: root.version?.distribution, version });
  const binding = {
    distribution: 'opensearch', version, buildHash: root.version.build_hash || null,
    clusterUuid: root.cluster_uuid, index, definitionSha256
  };
  if (expectedNative) {
    for (const key of Object.keys(binding))
      insist(expectedNative[key] === binding[key], 'WANDS_NATIVE_REPLACED',
        'The retained native operation points to a different cluster, version or index definition', { field: key });
  } else await retainNative(binding);
  const health = (await api('GET', '_cluster/health?wait_for_status=yellow&timeout=60s')).body;
  insist(!health.timed_out && health.status !== 'red', 'WANDS_NATIVE_HEALTH',
    'Native cluster did not reach an available state', { status: health.status });
  let response = await api('GET', index + '/_mapping', undefined, { accept: [404] });
  let retainedSettings;
  if (expectedNative?.indexUuid) {
    insist(response.status !== 404, 'WANDS_NATIVE_REPLACED',
      'The original retained index generation is absent; select a new operation/output for a new index');
    retainedSettings = (await api('GET', index + '/_settings')).body[index]?.settings?.index;
    insist(retainedSettings?.uuid === expectedNative.indexUuid, 'WANDS_NATIVE_REPLACED',
      'The original retained index UUID changed before ingestion');
  }
  if (response.status === 404) {
    response = await api('PUT', index, {
      settings: { number_of_shards: 1, number_of_replicas: 0, refresh_interval: '-1' },
      mappings: {
        dynamic: false, properties: PROPERTIES,
        _meta: { wands: { ...definition, definitionSha256 } }
      }
    }, { accept: [400] });
    if (response.status === 400)
      insist(response.body.error?.type === 'resource_already_exists_exception',
        'WANDS_NATIVE_CREATE', 'Dedicated benchmark index could not be created',
        { type: response.body.error?.type });
    response = await api('GET', index + '/_mapping');
  }
  insist(Object.keys(response.body).length === 1 && response.body[index],
    'WANDS_INDEX_ALIAS', 'Select the exact dedicated index, without aliases or wildcards');
  const mappings = response.body[index].mappings;
  insist(same(mappings?._meta?.wands, { ...definition, definitionSha256 }),
    'WANDS_INDEX_OWNERSHIP',
    'This index belongs to a different source or projection; select a new dedicated index');
  insist(mappings.dynamic === 'false' || mappings.dynamic === false, 'WANDS_INDEX_MAPPING',
    'The retained native index changed its dynamic mapping policy');
  for (const [field, mapping] of Object.entries(PROPERTIES)) {
    insist(mappings.properties?.[field]?.type === mapping.type
      && (!mapping.analyzer || mappings.properties[field].analyzer === mapping.analyzer),
    'WANDS_INDEX_MAPPING', 'The retained index mapping differs', { field });
  }
  let settings = retainedSettings || (await api('GET', index + '/_settings')).body[index]?.settings?.index;
  insist(settings && Number(settings.number_of_shards) === 1 && Number(settings.number_of_replicas) === 0,
    'WANDS_INDEX_SETTINGS', 'Dedicated benchmark index must retain one shard and zero replicas');
  insist(settings.uuid, 'WANDS_INDEX_IDENTITY', 'Native index omitted its original UUID');
  if (!expectedNative?.indexUuid) await retainNative({ ...binding, indexUuid: settings.uuid });
  const sealed = settings.blocks?.write === 'true' || settings.blocks?.write === true;
  if (sealed) {
    let ids = [];
    for (const id of input.productHashes.keys()) {
      ids.push(id);
      if (ids.length === 1000) { await exactExistingDocuments(api, index, ids, input.productHashes); ids = []; }
    }
    await exactExistingDocuments(api, index, ids, input.productHashes);
    event('index-retained', { index, products: input.productHashes.size });
  } else {
    let batch = [], batchBytes = 0, completed = 0, created = 0, retained = 0, batchNumber = 0;
    async function flush() {
      if (!batch.length) return;
      abortIf(signal); lease.assert();
      const payload = batch.map(item => JSON.stringify({ create: { _id: item.id } }) + '\n'
        + JSON.stringify(item.body) + '\n').join('');
      const result = (await api('POST', index + '/_bulk', payload, { ndjson: true })).body;
      insist(result.items?.length === batch.length, 'WANDS_BULK_INCOMPLETE',
        'Native bulk response did not account for every original product');
      const duplicates = [];
      for (let i = 0; i < batch.length; i++) {
        const item = result.items[i].create, expected = batch[i];
        insist(item && item._id === expected.id && item._index === index,
          'WANDS_BULK_IDENTITY', 'Native bulk returned a different product identity');
        if (item.status === 201) created++;
        else if (item.status === 409 && item.error?.type === 'version_conflict_engine_exception')
          duplicates.push(expected.id);
        else fail('WANDS_BULK_PRODUCT', 'A native original product creation failed', {
          id: expected.id, status: item.status, type: item.error?.type, reason: item.error?.reason
        });
      }
      await exactExistingDocuments(api, index, duplicates, input.productHashes);
      retained += duplicates.length; completed += batch.length; batchNumber++;
      if (batchNumber % 4 === 0 || completed === input.productHashes.size)
        event('products-indexed', { completed, created, retained, expected: input.productHashes.size });
      batch = []; batchBytes = 0;
    }
    for await (const record of records(products, WANDS_SOURCES.products.columns, signal)) {
      const recordSha = sha256(stable(record));
      insist(input.productHashes.get(record.product_id) === recordSha, 'WANDS_PRODUCT_CHANGED',
        'The original product source changed after review', { id: record.product_id });
      const body = { ...record, _source_record_sha256: recordSha };
      const bytes = Buffer.byteLength(JSON.stringify(body)) + 100;
      if (batch.length && (batchBytes + bytes > 2 * 1024 * 1024 || batch.length >= 1000)) await flush();
      batch.push({ id: record.product_id, body }); batchBytes += bytes;
    }
    await flush();
    insist(completed === input.productHashes.size, 'WANDS_INGEST_COUNT',
      'Native ingest did not account for the complete original catalog');
    await api('PUT', index + '/_settings', { index: { refresh_interval: '1s', blocks: { write: true } } });
  }
  await api('POST', index + '/_refresh');
  const count = (await api('GET', index + '/_count')).body;
  insist(count.count === input.productHashes.size && count._shards?.failed === 0,
    'WANDS_INDEX_COUNT', 'Native index contains a different number of products', { actual: count.count });
  settings = (await api('GET', index + '/_settings')).body[index]?.settings?.index;
  insist(settings.uuid && (settings.blocks?.write === 'true' || settings.blocks?.write === true),
    'WANDS_INDEX_UNSEALED', 'The native benchmark index is not sealed against later writes');
  const native = {
    distribution: 'opensearch', version, buildHash: root.version.build_hash || null,
    clusterUuid: root.cluster_uuid, index, indexUuid: settings.uuid,
    documents: count.count, shards: 1, replicas: 0, writeBlocked: true, definitionSha256
  };
  await atomicJson(path.join(output, 'native-index.json'), { schema: SCHEMA, ...native, definition });
  return native;
}

export function wandsQuery(text, variant = 'baseline', k = 10) {
  insist(Object.hasOwn(FIELDS, variant), 'WANDS_VARIANT', 'Unknown original-query variant');
  return {
    size: k, _source: false,
    query: { multi_match: { query: text, type: 'best_fields', operator: 'or', fields: FIELDS[variant] } },
    sort: [{ _score: 'desc' }, { product_id: 'asc' }]
  };
}
function rankRequest(queries, input, index, variant, k) {
  return {
    requests: queries.map(query => ({
      id: query.query_id,
      request: wandsQuery(query.query, variant, k),
      ratings: [...input.ratings.get(query.query_id)].map(([id, rating]) => ({
        _index: index, _id: id, rating
      }))
    })),
    metric: { dcg: { k, normalize: true, unknown_doc_rating: 0 } },
    max_concurrent_searches: 2
  };
}
function dcg(values) {
  return values.reduce((total, rating, index) =>
    total + (Math.pow(2, rating) - 1) / Math.log2(index + 2), 0);
}
export function fixedKNdcg(retrievedRatings, allRatings, k) {
  const denominator = dcg([...allRatings].sort((a, b) => b - a).slice(0, k));
  return { value: denominator ? dcg(retrievedRatings.slice(0, k)) / denominator : 0,
    idealDcg: denominator, dcg: dcg(retrievedRatings.slice(0, k)) };
}
function average(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function summarize(rows, k) {
  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  const returned = sum('returnedHits'), judged = sum('judgedHits'), positive = sum('positiveHits');
  return {
    queries: rows.length, fixedKNdcg: average(rows.map(row => row.fixedKNdcg)),
    nativeNdcg: average(rows.map(row => row.nativeNdcg)), requestedSlots: rows.length * k,
    returnedHits: returned, judgedHits: judged, unjudgedHits: returned - judged,
    positiveHits: positive, returnedSlotCoverage: returned / (rows.length * k),
    judgmentCoverageOfReturnedHits: returned ? judged / returned : 0,
    knownPositiveRecall: average(rows.map(row => row.knownPositiveRecall)),
    queriesWithNoHits: rows.filter(row => !row.returnedHits).length,
    queriesWithNoKnownPositiveJudgments: rows.filter(row => !row.positiveJudgments).length,
    queriesWithFewerThanKHits: rows.filter(row => row.returnedHits < k).length,
    nativeVersusFixedKDifference: average(rows.map(row => row.nativeNdcg - row.fixedKNdcg)),
    ratedPairsIncluded: sum('judgments')
  };
}
function extractCohort(raw, queries, input, index, variant, k) {
  const value = raw.rank_eval && typeof raw.rank_eval === 'object' ? raw.rank_eval : raw;
  insist(value.details && Number.isFinite(value.metric_score), 'WANDS_NATIVE_METRIC',
    'Native rank-eval response omitted its actual metric or per-query details');
  insist(Object.keys(value.failures || {}).length === 0, 'WANDS_NATIVE_QUERY_FAILURE',
    'Native rank-eval reported failed queries', { failures: value.failures });
  const expectedIds = new Set(queries.map(query => query.query_id));
  insist(Object.keys(value.details).length === expectedIds.size
    && Object.keys(value.details).every(id => expectedIds.has(id)), 'WANDS_NATIVE_QUERY_COVERAGE',
  'Native response did not include exactly the requested original queries');
  const rows = queries.map(query => {
    const detail = value.details[query.query_id], ratings = input.ratings.get(query.query_id);
    insist(Number.isFinite(detail.metric_score) && Array.isArray(detail.hits) && detail.hits.length <= k,
      'WANDS_NATIVE_QUERY_METRIC', 'Native query detail is incomplete', { queryId: query.query_id });
    const seen = new Set(), actualRatings = [];
    let judgedHits = 0, positiveHits = 0;
    const hits = detail.hits.map(item => {
      const hit = item.hit || item, id = hit._id;
      insist(typeof id === 'string' && input.productHashes.has(id)
        && hit._index === index && !seen.has(id), 'WANDS_NATIVE_HIT_IDENTITY',
      'Native result refers to a duplicate or different source product', { queryId: query.query_id, id });
      seen.add(id);
      const judged = ratings.has(id), rating = judged ? ratings.get(id) : 0;
      if (item.rating !== undefined && item.rating !== null)
        insist(judged && item.rating === rating, 'WANDS_NATIVE_RATING_CHANGED',
          'Native rated hit differs from its original judgment', { queryId: query.query_id, id });
      if (judged) judgedHits++;
      if (rating > 0) positiveHits++;
      actualRatings.push(rating);
      return { productId: id, rank: actualRatings.length, judged, rating: judged ? rating : null,
        nativeScore: hit._score ?? null };
    });
    const allRatings = [...ratings.values()];
    const fixed = fixedKNdcg(actualRatings, allRatings, k);
    if (hits.length === k)
      insist(Math.abs(fixed.value - detail.metric_score) < 1e-8,
        'WANDS_NATIVE_METRIC_DISAGREEMENT',
        'Native full-k NDCG differs from the exact original-rating calculation', { queryId: query.query_id });
    const positiveJudgments = allRatings.filter(rating => rating > 0).length;
    return {
      queryId: query.query_id, query: query.query, queryClass: query.query_class, variant,
      judgments: ratings.size, positiveJudgments, returnedHits: hits.length,
      judgedHits, unjudgedHits: hits.length - judgedHits, positiveHits,
      fixedKNdcg: fixed.value, nativeNdcg: detail.metric_score, idealDcgAtK: fixed.idealDcg,
      observedDcg: fixed.dcg, knownPositiveRecall: positiveJudgments ? positiveHits / positiveJudgments : 0,
      hits
    };
  });
  const summary = summarize(rows, k);
  insist(Math.abs(summary.nativeNdcg - value.metric_score) < 1e-8,
    'WANDS_NATIVE_AGGREGATE', 'Native cohort aggregate differs from its complete per-query response');
  return { rows, summary, nativeMetricScore: value.metric_score };
}
async function evaluate({ api, index, input, native, output, runIdentity, cohortSize, k, signal, lease }) {
  const allRows = [], cohorts = [], groups = [];
  for (let offset = 0; offset < input.queryRows.length; offset += cohortSize)
    groups.push(input.queryRows.slice(offset, offset + cohortSize));
  for (let group = 0; group < groups.length; group++) {
    const queries = groups[group];
    for (const variant of Object.keys(FIELDS)) {
      abortIf(signal); lease.assert();
      const request = rankRequest(queries, input, index, variant, k);
      const requestSha256 = sha256(JSON.stringify(request));
      const file = path.join(output, 'cohorts', variant + '-' + String(group + 1).padStart(3, '0') + '.json');
      const identity = { schema: SCHEMA, runIdentity, native, variant, cohort: group + 1,
        queryIds: queries.map(query => query.query_id), requestSha256 };
      let receipt, reused = false;
      if (await exists(file)) {
        receipt = await readJson(file);
        insist(same(receipt.identity, identity), 'WANDS_COHORT_IDENTITY',
          'A retained cohort belongs to a different source, request or native index', { file });
        insist(sha256(JSON.stringify(receipt.response)) === receipt.responseSha256,
          'WANDS_COHORT_BYTES', 'A retained native cohort response changed', { file });
        reused = true;
      } else {
        event('cohort-start', { cohort: group + 1, cohorts: groups.length, variant, queries: queries.length });
        const response = (await api('POST', index + '/_rank_eval', request)).body;
        extractCohort(response, queries, input, index, variant, k);
        receipt = { identity, receivedAt: now(), responseSha256: sha256(JSON.stringify(response)), response };
        lease.assert(); await atomicJson(file, receipt);
      }
      const evaluated = extractCohort(receipt.response, queries, input, index, variant, k);
      allRows.push(...evaluated.rows);
      cohorts.push({
        cohort: group + 1, variant, queryIds: identity.queryIds, requestSha256,
        responseSha256: receipt.responseSha256,
        receipt: path.relative(output, file), receiptSha256: (await identify(file)).sha256,
        nativeMetricScore: evaluated.nativeMetricScore, ...evaluated.summary
      });
      event('cohort-complete', { cohort: group + 1, variant, reused, ...evaluated.summary });
    }
  }
  return { rows: allRows, cohorts };
}
function tsv(value) {
  const text = String(value ?? '');
  return /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
async function writeNativeLookup(output, index, productHashes) {
  const file = path.join(output, 'native-products.ndjson'), temporary = file + '.tmp-' + randomUUID();
  const handle = await open(temporary, 'wx', 0o600);
  try {
    let batch = '';
    for (const [id, sourceRecordSha256] of productHashes) {
      batch += JSON.stringify({ product_id: id, _index: index, _id: id, sourceRecordSha256 }) + '\n';
      if (batch.length >= 128 * 1024) { await handle.writeFile(batch); batch = ''; }
    }
    if (batch) await handle.writeFile(batch);
    await handle.sync(); await handle.close();
    await rename(temporary, file); await syncDirectory(output);
  } catch (error) { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
  return { file: path.basename(file), rows: productHashes.size, ...(await identify(file)) };
}
function selectedTypeScript(variant, k, index) {
  return [
    '// Original WANDS full-cohort recommendation; generated from native OpenSearch results.',
    '// Dedicated source IDs remain raw product_id values. Catalog-workspace IDs use its separate lookup.',
    'export const wandsIndex = ' + JSON.stringify(index) + ';',
    'export const wandsFields = ' + JSON.stringify(FIELDS[variant]) + ' as const;',
    'export function wandsQuery(text: string, size: number = ' + k + ') {',
    '  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error("size must be 1..100");',
    '  return { size, _source: ["product_id", "product_name", "product_class"],',
    '    query: { multi_match: { query: text, type: "best_fields", operator: "or", fields: [...wandsFields] } },',
    '    sort: [{ _score: "desc" }, { product_id: "asc" }] };',
    '}', ''
  ].join('\n');
}
async function writeOutputs({ output, input, native, result, k, cohortSize, runIdentity, executedSource, sourceRef, state }) {
  const byVariant = Object.fromEntries(Object.keys(FIELDS).map(variant => [
    variant, new Map(result.rows.filter(row => row.variant === variant).map(row => [row.queryId, row]))
  ]));
  for (const variant of Object.keys(FIELDS))
    insist(byVariant[variant].size === input.queryRows.length, 'WANDS_FULL_QUERY_COVERAGE',
      'Completed comparison does not cover all original queries', { variant });
  const comparison = input.queryRows.map(query => {
    const baseline = byVariant.baseline.get(query.query_id), candidate = byVariant.identifier_title.get(query.query_id);
    return { queryId: query.query_id, query: query.query, queryClass: query.query_class,
      judgments: baseline.judgments, positiveJudgments: baseline.positiveJudgments,
      baseline, identifierTitle: candidate, deltaFixedKNdcg: candidate.fixedKNdcg - baseline.fixedKNdcg };
  });
  const variants = Object.fromEntries(Object.keys(FIELDS).map(variant => [
    variant, { fields: FIELDS[variant], ...summarize([...byVariant[variant].values()], k) }
  ]));
  const delta = variants.identifier_title.fixedKNdcg - variants.baseline.fixedKNdcg;
  const recommendedVariant = delta > 0 ? 'identifier_title' : 'baseline';
  const nativeProducts = await writeNativeLookup(output, native.index, input.productHashes);
  const sourceIndex = {
    schema: SCHEMA, repository: 'wayfair/WANDS', commit: PIN, license: 'MIT',
    sourceRelease: 'https://github.com/wayfair/WANDS/tree/' + PIN,
    inputs: Object.fromEntries(Object.entries(input.identities).map(([name, identity]) => [
      name, { path: WANDS_SOURCES[name].file, url: sourceUrl(name), ...identity }
    ])),
    profile: input.profile, native, nativeProducts, executedSource, sourceRef: sourceRef || null
  };
  await atomicJson(path.join(output, 'source-index.json'), sourceIndex);
  await atomicJson(path.join(output, 'per-query.json'), { schema: SCHEMA, k, rows: comparison });
  const columns = ['query_id', 'query', 'query_class', 'judgments', 'positive_judgments',
    'baseline_fixed_k_ndcg', 'candidate_fixed_k_ndcg', 'delta_fixed_k_ndcg',
    'baseline_native_ndcg', 'candidate_native_ndcg', 'baseline_returned_hits',
    'candidate_returned_hits', 'baseline_judged_hits', 'candidate_judged_hits'];
  const tabular = [columns, ...comparison.map(row => [
    row.queryId, row.query, row.queryClass, row.judgments, row.positiveJudgments,
    row.baseline.fixedKNdcg, row.identifierTitle.fixedKNdcg, row.deltaFixedKNdcg,
    row.baseline.nativeNdcg, row.identifierTitle.nativeNdcg, row.baseline.returnedHits,
    row.identifierTitle.returnedHits, row.baseline.judgedHits, row.identifierTitle.judgedHits
  ])].map(row => row.map(tsv).join('\t')).join('\n') + '\n';
  await atomic(path.join(output, 'per-query.tsv'), tabular);
  await atomicJson(path.join(output, 'query-selection.json'), {
    schema: SCHEMA, runIdentity, recommendedVariant,
    selectionRule: 'Highest mean fixed-k NDCG across all original queries; baseline on exact ties.',
    k, fields: FIELDS[recommendedVariant], native, sources: input.identities,
    originalProductIdField: 'product_id', nativeProducts,
    template: wandsQuery('{{query}}', recommendedVariant, k)
  });
  await atomic(path.join(output, 'query-selection.ts'), selectedTypeScript(recommendedVariant, k, native.index));
  const artifacts = {};
  for (const name of ['source-index.json', 'native-products.ndjson', 'per-query.json', 'per-query.tsv',
    'query-selection.json', 'query-selection.ts'])
    artifacts[name] = await identify(path.join(output, name));
  const report = {
    schema: SCHEMA, status: 'COMPLETE', operationId: state.operationId, runIdentity,
    startedAt: state.startedAt, completedAt: state.completedAt || now(), native, executedSource,
    sourceRef: sourceRef || null, dataset: input.profile, sourceIdentities: input.identities,
    k, cohortSize, cohortCountPerVariant: Math.ceil(input.queryRows.length / cohortSize),
    scorePolicy: {
      primary: 'Mean fixed-k NDCG over all 480 original queries, gain=2^rating-1, log2 rank discount.',
      labels: LABELS, unjudgedReturnedRating: 0,
      idealRanking: 'All original judgments for each query, sorted by rating, truncated to k.',
      native: 'Original native _rank_eval normalized DCG is retained beside the fixed-k value.',
      nativeShortLists: 'OpenSearch 3.3 computes native ideal DCG using the number of returned hits; fixed-k retains the requested denominator.',
      coverage: 'Judgment coverage uses returned hits; returned-slot coverage uses queries multiplied by k.'
    },
    variants, comparison: {
      candidateMinusBaselineFixedKNdcg: delta,
      candidateMinusBaselineNativeNdcg: variants.identifier_title.nativeNdcg - variants.baseline.nativeNdcg,
      improvedQueries: comparison.filter(row => row.deltaFixedKNdcg > 1e-12).length,
      worseQueries: comparison.filter(row => row.deltaFixedKNdcg < -1e-12).length,
      tiedQueries: comparison.filter(row => Math.abs(row.deltaFixedKNdcg) <= 1e-12).length,
      recommendedVariant
    }, cohorts: result.cohorts, artifacts
  };
  await atomicJson(path.join(output, 'report.json'), report);
  const f = value => value.toFixed(6);
  const markdown = [
    '# WANDS native catalog comparison', '',
    'Operation: ' + state.operationId + '. Native OpenSearch ' + native.version + '.',
    'The original ' + input.profile.products + ' products, ' + input.profile.queries + ' queries and '
      + input.profile.labelRows + ' judgment rows are included. Source commit: ' + PIN + '.', '',
    '| Variant | Fixed-k NDCG@' + k + ' | Native NDCG@' + k + ' | Returned-slot coverage | Judged returned hits |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(variants).map(([name, value]) => '| ' + name + ' | ' + f(value.fixedKNdcg)
      + ' | ' + f(value.nativeNdcg) + ' | ' + f(value.returnedSlotCoverage) + ' | '
      + value.judgedHits + '/' + value.returnedHits + ' |'),
    '',
    'Candidate fixed-k change: ' + f(delta) + '. Improved/worse/tied queries: '
      + report.comparison.improvedQueries + '/' + report.comparison.worseQueries + '/'
      + report.comparison.tiedQueries + '. Recommended variant: ' + recommendedVariant + '.', '',
    'The primary mean weights every original query equally. Exact/Partial/Irrelevant map to 2/1/0. '
      + 'Unjudged returned products contribute zero gain, and the ideal ranking uses all original judgments up to k. '
      + 'The native metric is retained separately because OpenSearch 3.3 normalizes a short result list against its returned length.', '',
    'Every original query ID is retained, including noncontiguous IDs. Each cohort file contains its exact request hash, '
      + 'native index identity and original server response. Completed cohorts reopen from these files after source and index checks.', '',
    'Files: report.json, per-query.json, per-query.tsv, query-selection.json, query-selection.ts, source-index.json, '
      + 'native-products.ndjson and cohorts/*.json. The lookup preserves raw WANDS product IDs for original native ratings. '
      + 'The catalog workspace uses its own catalog/tenant bindings and exported native-ID lookup.', '',
    'WANDS source and MIT license: https://github.com/wayfair/WANDS/tree/' + PIN, '',
    'OpenSearch API: https://docs.opensearch.org/docs/latest/api-reference/rank-eval/', ''
  ].join('\n');
  await atomic(path.join(output, 'REPORT.md'), markdown);
  return report;
}

export async function runWandsCohorts(options) {
  process.umask(0o077);
  const output = path.resolve(options.output), products = path.resolve(options.products);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const directory = await realpath(output), lease = await lock(directory);
  const controller = new AbortController(), signal = controller.signal;
  const interrupt = () => controller.abort(new WandsError('WANDS_INTERRUPTED',
    'The retained native operation was interrupted; rerun the same command to continue'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let state;
  const stateFile = path.join(directory, 'run.json');
  try {
    const k = options.k ?? 10, cohortSize = options.cohortSize ?? 100;
    insist(Number.isInteger(k) && k >= 1 && k <= 100, 'WANDS_K', 'k must be an integer from 1 to 100');
    insist(Number.isInteger(cohortSize) && cohortSize >= 1 && cohortSize <= 100,
      'WANDS_COHORT_SIZE', 'Each native cohort must contain 1 to 100 original queries');
    const index = options.index || 'wands-3b74dcf4';
    insist(/^[a-z0-9][a-z0-9._-]{0,199}$/.test(index),
      'WANDS_INDEX_NAME', 'Use one explicit lowercase dedicated index name');
    const operationId = options.operationId || 'wands-native-3b74dcf4';
    insist(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(operationId),
      'WANDS_OPERATION_ID', 'Use a stable operation identifier');
    if (options.sourceRef) insist(/^[a-f0-9]{40}$/.test(options.sourceRef),
      'WANDS_SOURCE_REF', 'Source provenance uses the full executed feature commit SHA');
    const queries = path.resolve(options.queries || path.join(HERE, '../examples/material-catalog/wands-query.tsv'));
    const labels = path.resolve(options.labels || path.join(directory, 'sources', 'label.tsv'));
    if (!options.labels) await downloadLabels(labels, signal);
    else insist(await exists(labels), 'WANDS_LABEL_PATH',
      'The selected retained label file is not present; finish that same source intake first');
    const input = await inspectInputs({ products, queries, labels, signal });
    const executedSource = { file: 'opensearch/receiving/wands-cohort.mjs',
      ...(await identify(fileURLToPath(import.meta.url), undefined, signal)), nodeVersion: process.version };
    const definition = {
      schema: SCHEMA, operationId, sources: input.identities, index, k, cohortSize,
      fields: FIELDS, ratings: LABELS, projection: mappingDefinition(input.identities),
      executedSource, sourceRef: options.sourceRef || null
    };
    const runIdentity = sha256(stable(definition));
    if (await exists(stateFile)) {
      state = await readJson(stateFile);
      insist(state.schema === SCHEMA && state.runIdentity === runIdentity,
        'WANDS_RUN_IDENTITY', 'The retained output belongs to another source or evaluation definition');
    } else state = { schema: SCHEMA, operationId, runIdentity, definition, startedAt: now(), status: 'SOURCE_READY' };
    lease.assert();
    await atomicJson(path.join(directory, 'inputs.json'), {
      schema: SCHEMA, commit: PIN, sources: input.identities, profile: input.profile,
      paths: { products, queries, labels }
    });
    await atomicJson(stateFile, { ...state, updatedAt: now() });
    event('sources-ready', { runIdentity, ...input.profile, queryIds: undefined });
    if (options.mode === 'prepare') return {
      status: 'SOURCE_READY', operationId, runIdentity, output: directory, sources: input.identities, profile: input.profile
    };
    const endpoint = validateEndpoint(options.url || 'http://127.0.0.1:9200');
    let headers = {};
    if (options.headersEnv) {
      insist(/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.headersEnv) && process.env[options.headersEnv],
        'WANDS_HEADERS_ENV', 'The named native header environment variable is unavailable');
      headers = JSON.parse(process.env[options.headersEnv]);
      insist(headers && typeof headers === 'object' && !Array.isArray(headers)
        && Object.entries(headers).every(([name, value]) => typeof value === 'string'
          && !/^(host|content-length|transfer-encoding|content-type|connection)$/i.test(name)),
      'WANDS_HEADERS', 'Native header configuration must contain valid string-valued request headers');
    }
    const api = createApi(endpoint, headers, signal, lease);
    state.status = 'INDEX_PREPARING'; await atomicJson(stateFile, { ...state, updatedAt: now() });
    const native = await prepareIndex({
      api, index, input, products, signal, output: directory, lease,
      expectedNative: state.native || state.nativeBinding,
      async retainNative(binding) {
        lease.assert(); state.nativeBinding = binding;
        await atomicJson(stateFile, { ...state, updatedAt: now() });
      }
    });
    if (state.native) insist(same(state.native, native), 'WANDS_NATIVE_REPLACED',
      'The retained operation now points to a different cluster or index generation');
    state.native = native; state.status = 'EVALUATING';
    await atomicJson(stateFile, { ...state, updatedAt: now() });
    event('native-ready', native);
    const result = await evaluate({
      api, index, input, native, output: directory, runIdentity, cohortSize, k, signal, lease
    });
    lease.assert(); abortIf(signal);
    const report = await writeOutputs({
      output: directory, input, native, result, k, cohortSize, runIdentity,
      executedSource, sourceRef: options.sourceRef, state
    });
    state.status = 'COMPLETE'; state.completedAt = report.completedAt;
    state.report = { file: 'report.json', ...(await identify(path.join(directory, 'report.json'))) };
    delete state.error;
    await atomicJson(stateFile, { ...state, updatedAt: now() });
    event('complete', { operationId, output: directory, report: state.report,
      comparison: report.comparison, variants: report.variants });
    return report;
  } catch (error) {
    const failure = { code: error.code || 'WANDS_NATIVE_OPERATION', message: error.message, detail: error.detail };
    if (state) {
      state.status = signal.aborted ? 'INTERRUPTED' : 'RETAINED_ERROR'; state.error = failure;
      try { lease.assert(); await atomicJson(stateFile, { ...state, updatedAt: now() }); } catch {}
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    await lease.close();
  }
}
const HELP = [
  'Full original WANDS native OpenSearch comparison',
  '',
  'node wands-cohort.mjs run --products FILE --labels FILE --output DIR',
  '  [--queries FILE] [--url http://127.0.0.1:9200] [--index NAME]',
  '  [--operation-id ID] [--source-ref FULL_COMMIT_SHA] [--k 10] [--cohort-size 100]',
  '  [--headers-env NATIVE_HEADERS_JSON]',
  '',
  'prepare validates and retains the same complete source selection before a cluster is ready.',
  'If --labels is omitted, the operation streams the pinned 5,736,234-byte original into its own',
  'output/sources/label.tsv and resumes its own partial download. A supplied --labels path is reused.',
  'Products always come from the already-retained original full catalog; this runner never fetches it.',
  'The bundled exact query TSV supplies all 480 actual, noncontiguous query IDs.',
  '',
  'run creates or continues one dedicated source-bound index, then evaluates both variants over',
  'all original 233,448 judgment rows in cohorts of at most 100 queries. Repeating the same command',
  'reuses exact retained products and completed native cohorts, and writes complete source, metrics',
  'and query/TypeScript handover exports. Linux flock and Node 24+ are required.',
  ''
].join('\n');
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); return; }
  const options = { mode: argv[0] === 'prepare' || argv[0] === 'run' ? argv.shift() : 'run' };
  const keys = {
    '--products': 'products', '--queries': 'queries', '--labels': 'labels', '--output': 'output',
    '--url': 'url', '--index': 'index', '--operation-id': 'operationId', '--source-ref': 'sourceRef',
    '--k': 'k', '--cohort-size': 'cohortSize', '--headers-env': 'headersEnv'
  };
  while (argv.length) {
    const flag = argv.shift(), key = keys[flag];
    insist(key && argv.length && !argv[0].startsWith('--'), 'WANDS_ARGUMENT',
      'Expected a documented flag and value: ' + flag);
    insist(options[key] === undefined, 'WANDS_ARGUMENT_REPEAT', 'Repeated option: ' + flag);
    const value = argv.shift();
    options[key] = key === 'k' || key === 'cohortSize' ? Number(value) : value;
  }
  insist(options.products && options.output, 'WANDS_ARGUMENT_REQUIRED', '--products and --output are required');
  return runWandsCohorts(options);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({
      status: 'RETAINED_ERROR', code: error.code || 'WANDS_NATIVE_OPERATION',
      message: error.message, detail: error.detail
    }) + '\n');
    process.exitCode = error.code === 'WANDS_INTERRUPTED' ? 130 : 1;
  });
}
