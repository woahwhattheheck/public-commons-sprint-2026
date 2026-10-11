// MIT. Named native OpenSearch PIT searches behind the original SF30 seller.
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { record } from '../sqlite/parameters.mjs';
import { validateOpenSearchSource, compileOpenSearchQueries, describeOpenSearchQueries,
  bindOpenSearchParameters, QueryInputError } from './declaration.mjs';
import { NativeInteger, OpenSearchSourceError, fail, assertLosslessJSONSupport,
  nativeJSON, portableJSON, resolveConnection, createWire } from './wire.mjs';
import { validateOpenSearchProjection } from './projection.mjs';
export { OpenSearchSourceError, validateOpenSearchSource };

export async function readJSONFile(filename, cap = 262144) {
  const handle = await open(resolve(filename), 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > cap) throw new TypeError('OPENSEARCH_CONFIGURATION_FILE_INVALID');
    const bytes = Buffer.alloc(cap + 1); let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > cap) throw new RangeError('OPENSEARCH_CONFIGURATION_TOO_LARGE');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } finally { await handle.close(); }
}
export async function readOpenSearchSourceFile(filename) {
  const path = resolve(filename), config = validateOpenSearchSource(await readJSONFile(path));
  return { path, config, description: describeOpenSearchQueries(compileOpenSearchQueries(config.queries)) };
}
function bindQuery(query, input) {
  const values = bindOpenSearchParameters(query, input);
  const parameters = Object.fromEntries(query.parameterOrder.map((name, index) => [name, values[index]]));
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (record(value)) {
      if (Object.hasOwn(value, '$param')) {
        const name = value.$param, supplied = parameters[name];
        return query.parameters[name].type === 'integer' && supplied !== null ? new NativeInteger(supplied) : supplied;
      }
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    }
    return value;
  }
  const bound = visit(query.query);
  if (Buffer.byteLength(nativeJSON(bound)) > 196608) throw new QueryInputError(null, 'ENCODED_QUERY_TOO_LARGE');
  return bound;
}
function completeShards(value, name) {
  if (!record(value) || !Number.isSafeInteger(value.total) || value.total < 1 ||
      value.successful !== value.total || value.failed !== 0) fail('OPENSEARCH_INCOMPLETE_SHARDS', name);
}
function pitId(value) {
  if (typeof value !== 'string' || !value || value.length > 65536 || /[\x00-\x20\x7f]/.test(value))
    fail('OPENSEARCH_PIT_ID_INVALID');
  return value;
}
function fieldContract(value, query, name) {
  if (!record(value) || !record(value.fields) || !Array.isArray(value.indices) || !value.indices.length ||
      value.indices.some(index => typeof index !== 'string' || !index)) fail('OPENSEARCH_FIELD_CAPS_INVALID', name);
  const wanted = [...new Set([...query.fields, ...query.sort.flatMap(item => Object.keys(item)).filter(key => key !== '_score')])];
  const sorted = new Set(query.sort.flatMap(item => Object.keys(item)));
  const types = Object.create(null);
  for (const field of wanted) {
    const capabilities = value.fields[field];
    if (!record(capabilities)) fail('OPENSEARCH_FIELD_UNMAPPED', name);
    const mapped = Object.entries(capabilities);
    if (mapped.length !== 1 || mapped[0][0] === 'unmapped' || !record(mapped[0][1]))
      fail('OPENSEARCH_FIELD_TYPE_CONFLICT', name);
    const [type, info] = mapped[0];
    if (typeof info.searchable !== 'boolean' || typeof info.aggregatable !== 'boolean' ||
        sorted.has(field) && (!info.aggregatable || (info.non_aggregatable_indices?.length ?? 0) > 0))
      fail('OPENSEARCH_SORT_FIELD_UNAVAILABLE', name);
    types[field] = { type, searchable: info.searchable, aggregatable: info.aggregatable };
  }
  return types;
}
const same = (left, right) => nativeJSON(left) === nativeJSON(right);

export async function createOpenSearchQuerySource(raw, { env = process.env } = {}) {
  assertLosslessJSONSupport();
  const config = validateOpenSearchSource(raw), queries = compileOpenSearchQueries(config.queries);
  const wire = createWire(resolveConnection(config, env));
  const pinned = Object.create(null), projections = Object.create(null), jobs = new Set(), pendingCleanup = new Map();
  let closed = false, closing, completed = 0, failures = 0, cleanupFailures = 0, serverVersion, sourceIdentity;

  function definition(name) {
    if (typeof name !== 'string' || !Object.hasOwn(queries, name)) fail('QUERY_NOT_FOUND');
    return queries[name];
  }
  function metadataPath(query) {
    const fields = [...new Set([...query.fields, ...query.sort.flatMap(item => Object.keys(item)).filter(key => key !== '_score')])];
    return query.indices.map(encodeURIComponent).join(',') + '/_field_caps?fields=' +
      encodeURIComponent(fields.join(',')) + '&include_unmapped=true&allow_no_indices=false&ignore_unavailable=false';
  }
  async function readFields(name, query, options = {}) {
    return fieldContract(await wire('GET', metadataPath(query), { maxBytes: 1048576, ...options }), query, name);
  }
  async function readProjection(name, query, options = {}) {
    const path = query.indices.map(encodeURIComponent).join(',') + '/_mapping?allow_no_indices=false&ignore_unavailable=false';
    return validateOpenSearchProjection(await wire('GET', path, { maxBytes: 2097152, ...options }), query.fields, { queryName: name });
  }
  async function cleanup(id) {
    // Delete only the snapshot owned by this query; never delete-all or list-all.
    try {
      const result = await wire('DELETE', '_search/point_in_time', {
        body: { pit_id: [id] }, timeoutMs: 3000, maxBytes: 131072,
      });
      if (!Array.isArray(result?.pits) || !result.pits.some(pit => pit.pit_id === id && pit.successful === true))
        fail('OPENSEARCH_PIT_RELEASE_FAILED');
      pendingCleanup.delete(id); return true;
    } catch {
      cleanupFailures++;
      const now = Date.now();
      for (const [pending, expires] of pendingCleanup) if (expires <= now) pendingCleanup.delete(pending);
      pendingCleanup.set(id, now + 60000); return false;
    }
  }
  async function execute(name, input, { signal } = {}) {
    const query = definition(name), bodyQuery = bindQuery(query, input);
    if (closed) fail('SOURCE_CLOSED', name);
    if (jobs.size >= config.maxInFlight) fail('SOURCE_BUSY', name);
    const controller = new AbortController(), deadline = Date.now() + query.timeoutMs;
    const cancel = () => controller.abort(signal?.reason);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new OpenSearchSourceError('QUERY_TIMEOUT', name)), query.timeoutMs);
    timer.unref?.();
    let finish, ownedPit, result;
    const job = { controller, done: new Promise(resolve => { finish = resolve; }) };
    jobs.add(job);
    const options = () => ({ signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now()) });
    try {
      const [currentFields, currentProjection] = await Promise.all([
        readFields(name, query, options()), readProjection(name, query, options()),
      ]);
      if (!same(currentFields, pinned[name]) || !same(currentProjection, projections[name])) fail('QUERY_SCHEMA_CHANGED', name);
      const keepAlive = String(Math.ceil(query.timeoutMs / 1000) + 15) + 's';
      const created = await wire('POST', query.indices.map(encodeURIComponent).join(',') +
        '/_search/point_in_time?keep_alive=' + keepAlive +
        '&allow_partial_pit_creation=false&allow_no_indices=false&ignore_unavailable=false',
        { ...options(), maxBytes: 131072 });
      // Retain the owned ID before inspecting shards so a partial creation is
      // still released in finally.
      ownedPit = pitId(created?.pit_id);
      completeShards(created._shards, name);
      const sort = [...query.sort, { _index: 'asc' }, { _shard_doc: 'asc' }];
      const hits = [], identities = new Set(), cursors = new Set();
      let cursor, total, pages = 0, exhausted = false, portableBytes = 0;
      while (hits.length <= query.maxHits && !exhausted) {
        const size = Math.min(query.pageSize, query.maxHits + 1 - hits.length);
        const body = { query: bodyQuery, pit: { id: ownedPit, keep_alive: keepAlive }, sort, size,
          track_total_hits: query.maxHits + 1, _source: { includes: query.fields },
          timeout: Math.max(1, deadline - Date.now()) + 'ms',
          ...(cursor === undefined ? {} : { search_after: cursor }) };
        const page = await wire('POST', '_search?allow_partial_search_results=false',
          { ...options(), body, maxBytes: Math.min(2097152, query.maxBytes + 262144) });
        if (page?.pit_id !== undefined) ownedPit = pitId(page.pit_id);
        if (!record(page) || page.timed_out !== false || page.terminated_early === true)
          fail('OPENSEARCH_INCOMPLETE_SEARCH', name);
        completeShards(page._shards, name);
        const found = page.hits;
        if (!record(found) || !record(found.total) || !Number.isSafeInteger(found.total.value) ||
            found.total.value < 0 || !['eq', 'gte'].includes(found.total.relation) ||
            !Array.isArray(found.hits) || found.hits.length > size) fail('OPENSEARCH_SEARCH_RESPONSE_INVALID', name);
        const counted = { value: found.total.value, relation: found.total.relation };
        if (total && !same(total, counted)) fail('OPENSEARCH_SNAPSHOT_COUNT_CHANGED', name);
        total = counted; pages++;
        for (const hit of found.hits) {
          if (!record(hit) || typeof hit._index !== 'string' || !hit._index || typeof hit._id !== 'string' ||
              !hit._id || hit._id.length > 4096 || !record(hit._source) || !Array.isArray(hit.sort) ||
              hit.sort.length !== sort.length || hit.sort[hit.sort.length - 2] !== hit._index ||
              hit.sort.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value) && !(value instanceof NativeInteger)))
            fail('OPENSEARCH_HIT_INVALID', name);
          const identity = JSON.stringify([hit._index, hit._id]), order = nativeJSON(hit.sort);
          if (identities.has(identity) || cursors.has(order)) fail('OPENSEARCH_CURSOR_NOT_UNIQUE', name);
          identities.add(identity); cursors.add(order);
          const port = portableJSON({ _index: hit._index, _id: hit._id, _source: hit._source,
            _score: hit._score ?? null, sort: hit.sort });
          const saved = { ...port.value, exactIntegerPaths: port.exactIntegerPaths };
          if (hits.length < query.maxHits) portableBytes += Buffer.byteLength(JSON.stringify(saved));
          if (portableBytes > query.maxBytes) fail('QUERY_RESULT_TOO_LARGE', name);
          hits.push(saved);
        }
        if (found.hits.length) cursor = found.hits[found.hits.length - 1].sort;
        exhausted = found.hits.length < size || total.relation === 'eq' && hits.length >= total.value;
        if (total.relation === 'eq' && hits.length > total.value) fail('OPENSEARCH_SNAPSHOT_COUNT_CHANGED', name);
        if (pages > query.maxHits + 1) fail('OPENSEARCH_PAGE_LIMIT', name);
      }
      const truncated = hits.length > query.maxHits;
      if (!truncated && (total.relation !== 'eq' || hits.length !== total.value))
        fail('OPENSEARCH_INCOMPLETE_SEARCH', name);
      if (controller.signal.aborted) fail(controller.signal.reason?.code === 'QUERY_TIMEOUT' ? 'QUERY_TIMEOUT' : 'QUERY_ABORTED', name);
      if (Date.now() >= deadline) fail('QUERY_TIMEOUT', name);
      result = { schema: 'stellar-forge.opensearch-result.v1', query: name, fields: [...query.fields],
        fieldTypes: structuredClone(pinned[name]), source: { ...sourceIdentity }, hits: hits.slice(0, query.maxHits),
        hitCount: Math.min(hits.length, query.maxHits), total, truncated, pages,
        snapshot: 'point-in-time', capturedAt: new Date().toISOString(),
        numberEncoding: 'unsafe-integer-decimal-text', snapshotReleased: false };
      if (Buffer.byteLength(JSON.stringify(result)) > query.maxBytes) fail('QUERY_RESULT_TOO_LARGE', name);
      completed++;
      return result;
    } catch (issue) {
      failures++;
      if (issue instanceof OpenSearchSourceError || issue instanceof QueryInputError) throw issue;
      fail('OPENSEARCH_QUERY_FAILED', name);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (ownedPit) {
        const released = await cleanup(ownedPit);
        if (result) result.snapshotReleased = released;
      }
      jobs.delete(job); finish();
    }
  }
  function close() {
    if (closing) return closing;
    closed = true;
    const current = [...jobs];
    for (const job of current) job.controller.abort(new OpenSearchSourceError('QUERY_ABORTED'));
    closing = Promise.allSettled(current.map(job => job.done)).then(async () => {
      // One resource-release retry on shutdown, never a search/payment replay.
      for (const [id, expires] of [...pendingCleanup]) {
        if (expires > Date.now()) await cleanup(id); else pendingCleanup.delete(id);
      }
    });
    return closing;
  }
  try {
    const version = await wire('GET', '', { timeoutMs: 5000, maxBytes: 65536 });
    serverVersion = version?.version?.number;
    const numbers = typeof serverVersion === 'string' ? /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(serverVersion) : null;
    if (version?.version?.distribution !== 'opensearch' || !numbers ||
        Number(numbers[1]) < 3 || Number(numbers[1]) === 3 && Number(numbers[2]) < 3)
      fail('OPENSEARCH_3_3_OR_NEWER_REQUIRED');
    if (typeof version.cluster_uuid !== 'string' || !version.cluster_uuid || version.cluster_uuid === '_na_' || version.cluster_uuid.length > 256)
      fail('OPENSEARCH_CLUSTER_IDENTITY_UNAVAILABLE');
    sourceIdentity = { clusterFingerprint: createHash('sha256').update(version.cluster_uuid).digest('hex'), serverVersion };
    for (const [name, query] of Object.entries(queries)) {
      [pinned[name], projections[name]] = await Promise.all([
        readFields(name, query, { timeoutMs: query.timeoutMs }),
        readProjection(name, query, { timeoutMs: query.timeoutMs }),
      ]);
      // Validate through the same native read capability used for delivery.
      // A zero-row probe compiles/executes the declared query without exposing
      // documents or requiring OpenSearch's administrative validate privilege.
      const validation = await wire('POST', query.indices.map(encodeURIComponent).join(',') +
        '/_search?allow_partial_search_results=false&allow_no_indices=false&ignore_unavailable=false', {
          body: { query: bindQuery(query, query.probe), size: 0, _source: false,
            track_total_hits: 1, timeout: query.timeoutMs + 'ms' },
          timeoutMs: query.timeoutMs, maxBytes: 65536,
        });
      if (!record(validation) || validation.timed_out !== false || validation.terminated_early === true ||
          !Array.isArray(validation.hits?.hits) || validation.hits.hits.length !== 0)
        fail('OPENSEARCH_QUERY_PREFLIGHT_FAILED', name);
      completeShards(validation._shards, name);
    }
  } catch (issue) { await close(); throw issue; }
  const invalid = issue => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: issue.code, field: issue.field } });
  function route(name, { input = 'body' } = {}) {
    const query = definition(name);
    if (!['body', 'query'].includes(input)) throw new TypeError('OPENSEARCH_ROUTE_INPUT_INVALID');
    function values(context) {
      if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(context?.method))
        throw new QueryInputError(null, 'JSON_BODY_METHOD_REQUIRED');
      return context?.[input];
    }
    return Object.freeze({
      admit(context) {
        try {
          bindQuery(query, values(context));
          if (closed) return { status: 503, body: { error: 'SOURCE_CLOSED' } };
          if (jobs.size >= config.maxInFlight) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
          return true;
        } catch (issue) { if (issue instanceof QueryInputError) return invalid(issue); throw issue; }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
          body: await execute(name, values(context), { signal: context?.signal }) }; }
        catch (issue) {
          if (issue instanceof QueryInputError) return invalid(issue);
          const code = issue instanceof OpenSearchSourceError ? issue.code : 'OPENSEARCH_QUERY_FAILED';
          return { status: code === 'QUERY_TIMEOUT' ? 504 : ['SOURCE_BUSY', 'OPENSEARCH_RATE_LIMITED'].includes(code) ? 429 : 503,
            body: { error: code } };
        }
      },
    });
  }
  return Object.freeze({
    query: execute, route, close,
    describe: () => describeOpenSearchQueries(queries),
    inspect: () => ({ schema: 'stellar-forge.opensearch-inspection.v1', serverVersion, source: { ...sourceIdentity },
      queries: describeOpenSearchQueries(queries), fieldTypes: structuredClone(pinned), projections: structuredClone(projections),
      snapshot: 'point-in-time', transport: 'native-http', maxInFlight: config.maxInFlight,
      numberEncoding: 'unsafe-integer-decimal-text' }),
    status: () => ({ schema: 'stellar-forge.opensearch-status.v1', state: closed ? 'CLOSED' : 'READY',
      active: jobs.size, maxInFlight: config.maxInFlight, completed, failures, cleanupFailures,
      pendingSnapshotRelease: pendingCleanup.size }),
  });
}
export async function openOpenSearchSourceFile(filename, options) {
  const declaration = await readOpenSearchSourceFile(filename);
  const source = await createOpenSearchQuerySource(declaration.config, options);
  return { ...declaration, source };
}
