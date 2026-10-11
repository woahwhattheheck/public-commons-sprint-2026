// MIT. Native ranking metrics reconciled with complete same-PIT search windows.
import { randomUUID } from 'node:crypto';
import { record } from '../../sqlite/parameters.mjs';
import { createOpenSearchQuerySource, bindOpenSearchQuery, openSearchSort,
  completeOpenSearchShards, validateOpenSearchPitId } from '../source.mjs';
import { NativeInteger, OpenSearchSourceError, fail, nativeJSON, portableJSON,
  assertLosslessJSONSupport, resolveConnection, createWire } from '../wire.mjs';
import { validateRelevanceSuite, describeRelevanceMetrics } from './validation.mjs';
export { validateRelevanceSuite, describeRelevanceMetrics };

const MAX_NATIVE_RESPONSE = 33554432, MAX_NATIVE_REQUEST = 33554432;
const identity = hit => JSON.stringify([hit._index, hit._id]);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const issue = error => ({ code: typeof error?.code === 'string' ? error.code : 'OPENSEARCH_RELEVANCE_FAILED',
  ...(Number.isInteger(error?.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}) });
function abort(signal) {
  if (signal?.aborted) fail(signal.reason?.code === 'QUERY_TIMEOUT' ? 'QUERY_TIMEOUT' : 'QUERY_ABORTED');
}
function failedCase(row, error, status = 'FAILED') {
  return { id: row.id, status, score: null, hitCount: 0, judgedHitCount: 0,
    unjudgedHitCount: 0, judgmentCount: row.ratings.length, error };
}
async function timed(signal, timeoutMs, run) {
  abort(signal);
  const controller = new AbortController(), deadline = Date.now() + timeoutMs;
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new OpenSearchSourceError('QUERY_TIMEOUT')), timeoutMs);
  timer.unref?.();
  try {
    return await run(() => ({ signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now()) }), deadline);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}
function strictWindow(page, { query, sort, k, sourceIndices }) {
  if (!record(page) || page.timed_out !== false || page.terminated_early === true)
    fail('OPENSEARCH_INCOMPLETE_SEARCH');
  completeOpenSearchShards(page._shards);
  const found = page.hits;
  if (!record(found) || !record(found.total) || !Number.isSafeInteger(found.total.value) ||
      found.total.value < 0 || !['eq', 'gte'].includes(found.total.relation) ||
      !Array.isArray(found.hits) || found.hits.length > k)
    fail('OPENSEARCH_SEARCH_RESPONSE_INVALID');
  if (found.total.relation === 'eq' && found.hits.length !== Math.min(k, found.total.value) ||
      found.total.relation === 'gte' && (found.hits.length !== k || found.total.value < k))
    fail('OPENSEARCH_INCOMPLETE_SEARCH');
  const seen = new Set(), cursors = new Set();
  for (const hit of found.hits) {
    if (!record(hit) || typeof hit._index !== 'string' || !sourceIndices.includes(hit._index) ||
        typeof hit._id !== 'string' || !hit._id || hit._id.length > 4096 || !record(hit._source) ||
        !Array.isArray(hit.sort) || hit.sort.length !== sort.length || hit.sort.at(-2) !== hit._index ||
        hit.sort.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value) &&
          !(value instanceof NativeInteger))) fail('OPENSEARCH_HIT_INVALID');
    const id = identity(hit), cursor = nativeJSON(hit.sort);
    if (seen.has(id) || cursors.has(cursor)) fail('OPENSEARCH_CURSOR_NOT_UNIQUE');
    seen.add(id); cursors.add(cursor);
  }
  const selected = found.hits.map(hit => ({ _index: hit._index, _id: hit._id, _source: hit._source,
    _score: hit._score ?? null, sort: hit.sort }));
  const portable = portableJSON(selected);
  if (Buffer.byteLength(JSON.stringify(portable)) > query.maxBytes) fail('QUERY_RESULT_TOO_LARGE');
  return { state: 'COMPLETE', capturedAt: new Date().toISOString(), total: structuredClone(found.total),
    shards: structuredClone(page._shards), timedOut: false, hitCount: found.hits.length,
    hits: portable.value, exactIntegerPaths: portable.exactIntegerPaths };
}
function reconcile(row, native, window, responseValid) {
  const details = record(native?.details) ? native.details : {};
  const failures = record(native?.failures) ? native.failures : {};
  const ownDetail = Object.hasOwn(details, row.id), ownFailure = Object.hasOwn(failures, row.id);
  if (ownFailure) return failedCase(row, { code: 'OPENSEARCH_NATIVE_CASE_FAILED',
    native: portableJSON(failures[row.id]).value });
  if (!ownDetail || !record(details[row.id]))
    return failedCase(row, { code: 'OPENSEARCH_NATIVE_CASE_MISSING' }, 'INCOMPLETE');
  const detail = details[row.id], hits = Array.isArray(detail.hits) ? detail.hits : [];
  const grades = new Map(row.ratings.map(value => [identity(value), value.rating]));
  const judged = hits.filter(value => record(value?.hit) && grades.has(identity(value.hit))).length;
  const summary = { id: row.id, status: 'INCOMPLETE', score: finite(detail.metric_score) ? detail.metric_score : null,
    hitCount: hits.length, judgedHitCount: judged, unjudgedHitCount: hits.length - judged,
    judgmentCount: row.ratings.length, strictWindowState: window?.state ?? 'FAILED',
    total: window?.total ?? null, orderedWindowMatches: false };
  if (!responseValid || !finite(detail.metric_score) || !Array.isArray(detail.hits) ||
      !Array.isArray(detail.unrated_docs) || !record(detail.metric_details)) {
    summary.error = { code: 'OPENSEARCH_NATIVE_RESPONSE_INVALID' }; return summary;
  }
  if (window?.state !== 'COMPLETE') {
    summary.error = window?.error ?? { code: 'OPENSEARCH_STRICT_WINDOW_UNAVAILABLE' }; return summary;
  }
  const match = hits.length === window.hits.length && hits.every((value, index) =>
    record(value) && record(value.hit) && identity(value.hit) === identity(window.hits[index]) &&
    (grades.has(identity(value.hit)) ? value.rating === grades.get(identity(value.hit)) : value.rating === null));
  const expectedUnrated = hits.filter(value => record(value?.hit) && !grades.has(identity(value.hit)))
    .map(value => identity(value.hit)).sort();
  const actualUnrated = detail.unrated_docs.map(value => record(value) ? identity(value) : '').sort();
  if (!match || nativeJSON(expectedUnrated) !== nativeJSON(actualUnrated)) {
    summary.error = { code: 'OPENSEARCH_NATIVE_WINDOW_MISMATCH' }; return summary;
  }
  summary.status = 'COMPLETE'; summary.orderedWindowMatches = true;
  return summary;
}
async function release(wire, group) {
  if (!group.pitId) return true;
  try {
    const result = await wire('DELETE', '_search/point_in_time', {
      body: { pit_id: [group.pitId] }, timeoutMs: 5000, maxBytes: 131072 });
    const released = Array.isArray(result?.pits) && result.pits.some(row =>
      row.pit_id === group.pitId && row.successful === true);
    if (released) group.pitId = null;
    return released;
  } catch { return false; }
}
export async function evaluateOpenSearchRankings(input, { env = process.env, signal } = {}) {
  assertLosslessJSONSupport();
  const suite = validateRelevanceSuite(input), startedAt = new Date().toISOString();
  abort(signal);
  const source = await createOpenSearchQuerySource(suite.config, { env, signal });
  const inspection = source.inspect(), wire = createWire(resolveConnection(suite.config, env));
  const results = new Map(), groups = new Map();
  for (const variant of suite.variants) {
    const key = JSON.stringify([...variant.compiled.indices].sort());
    if (!groups.has(key)) groups.set(key, { scopeId: randomUUID(), indices: [...variant.compiled.indices],
      variants: [], pitId: null, createdAt: null, released: false });
    groups.get(key).variants.push(variant);
  }
  const keepAlive = '90s';
  try {
    for (const group of groups.values()) {
      abort(signal);
      try {
        const timeoutMs = Math.max(...group.variants.map(row => row.compiled.timeoutMs));
        const created = await timed(signal, timeoutMs, options => wire('POST',
          group.indices.map(encodeURIComponent).join(',') + '/_search/point_in_time?keep_alive=' + keepAlive +
          '&allow_partial_pit_creation=false&allow_no_indices=false&ignore_unavailable=false',
          { ...options(), maxBytes: 131072 }));
        group.pitId = validateOpenSearchPitId(created?.pit_id);
        completeOpenSearchShards(created._shards);
        group.createdAt = new Date().toISOString();
        for (const variant of group.variants) {
          abort(signal);
          const query = variant.compiled, sort = openSearchSort(query);
          const sourceIndices = Object.keys(inspection.projections[variant.internalName]).sort();
          const windows = {}, requests = suite.cases.map(row => ({
            id: row.id, request: { query: bindOpenSearchQuery(query, row.input),
              pit: { id: group.pitId, keep_alive: keepAlive }, sort, timeout: query.timeoutMs + 'ms' },
            ratings: row.ratings, summary_fields: query.fields }));
          const packet = () => ({ requests, metric: suite.metric, max_concurrent_searches: 1 });
          // Check the exact expanded request, including its owned PIT, before
          // any strict-window searches. Saved case collections may be broad.
          if (Buffer.byteLength(nativeJSON(packet())) > MAX_NATIVE_REQUEST)
            fail('OPENSEARCH_RELEVANCE_REQUEST_TOO_LARGE');
          for (const [caseIndex, row] of suite.cases.entries()) {
            abort(signal);
            const bodyQuery = requests[caseIndex].request.query;
            let window;
            try {
              const page = await timed(signal, query.timeoutMs, (options, deadline) => wire('POST',
                '_search?allow_partial_search_results=false', { ...options(), maxBytes: query.maxBytes + 262144,
                  body: { query: bodyQuery, pit: { id: group.pitId, keep_alive: keepAlive }, sort,
                    size: suite.k, track_total_hits: suite.k, _source: { includes: query.fields },
                    timeout: Math.max(1, deadline - Date.now()) + 'ms' } }));
              if (page?.pit_id !== undefined) group.pitId = validateOpenSearchPitId(page.pit_id);
              window = strictWindow(page, { query, sort, k: suite.k, sourceIndices });
            } catch (error) {
              abort(signal);
              window = { state: 'FAILED', capturedAt: new Date().toISOString(), error: issue(error) };
            }
            windows[row.id] = window;
          }
          // The newest owned PIT preserves the scope of every strict capture.
          for (const request of requests) request.request.pit = { id: group.pitId, keep_alive: keepAlive };
          let native = null, transportError;
          try {
            native = await timed(signal, query.timeoutMs * suite.cases.length + 5000, options =>
              wire('POST', '_rank_eval', { ...options(), body: packet(), maxRequestBytes: MAX_NATIVE_REQUEST,
                maxBytes: Math.min(MAX_NATIVE_RESPONSE, query.maxBytes * suite.cases.length + 262144) }));
          } catch (error) { abort(signal); transportError = issue(error); }
          const expected = new Set(suite.cases.map(row => row.id));
          const validMaps = record(native) && record(native.details) && record(native.failures);
          const responseValid = validMaps && [...Object.keys(native.details), ...Object.keys(native.failures)]
            .every(id => expected.has(id)) && Object.keys(native.details).every(id => !Object.hasOwn(native.failures, id));
          const cases = transportError ? suite.cases.map(row => failedCase(row, transportError)) :
            suite.cases.map(row => reconcile(row, native, windows[row.id], responseValid));
          const portable = portableJSON(native), complete = responseValid && finite(native.metric_score) &&
            cases.every(row => row.status === 'COMPLETE');
          results.set(variant.id, { id: variant.id, label: variant.label, queryName: variant.queryName,
            source: { ...inspection.source }, indices: [...query.indices], concreteIndices: sourceIndices,
            effectiveSort: structuredClone(sort), fields: [...query.fields], k: suite.k,
            snapshot: { scopeId: group.scopeId, createdAt: group.createdAt, released: false },
            metricScore: finite(native?.metric_score) ? native.metric_score : null,
            complete: Boolean(complete), cases, strictWindows: windows,
            native: portable.value, exactIntegerPaths: portable.exactIntegerPaths,
            ...(transportError ? { error: transportError } : {}) });
        }
      } catch (error) {
        abort(signal);
        for (const variant of group.variants) {
          if (results.has(variant.id)) continue;
          const failure = issue(error);
          results.set(variant.id, { id: variant.id, label: variant.label, queryName: variant.queryName,
            source: { ...inspection.source }, indices: [...variant.compiled.indices],
            concreteIndices: Object.keys(inspection.projections[variant.internalName]).sort(),
            effectiveSort: openSearchSort(variant.compiled), fields: [...variant.compiled.fields], k: suite.k,
            snapshot: { scopeId: group.scopeId, createdAt: group.createdAt, released: false },
            metricScore: null, complete: false, cases: suite.cases.map(row => failedCase(row, failure)),
            strictWindows: {}, native: null, exactIntegerPaths: [], error: failure });
        }
      } finally {
        group.released = await release(wire, group);
        if (!group.released) group.released = await release(wire, group);
        for (const variant of group.variants) {
          const result = results.get(variant.id);
          if (result) result.snapshot.released = group.released;
        }
      }
    }
  } finally { await source.close(); }
  const variants = suite.variants.map(row => results.get(row.id));
  return { schema: 'stellar-forge.opensearch-relevance-result.v1', startedAt,
    capturedAt: new Date().toISOString(), source: { ...inspection.source },
    metric: structuredClone(suite.metric), caseIds: suite.cases.map(row => row.id), variants,
    complete: variants.every(row => row.complete),
    snapshotReleased: variants.every(row => row.snapshot.released),
    numberEncoding: 'unsafe-integer-decimal-text',
    coverage: { requestedCases: suite.cases.length * variants.length,
      completeCases: variants.reduce((sum, row) => sum + row.cases.filter(item => item.status === 'COMPLETE').length, 0),
      failedCases: variants.reduce((sum, row) => sum + row.cases.filter(item => item.status === 'FAILED').length, 0),
      incompleteCases: variants.reduce((sum, row) => sum + row.cases.filter(item => item.status === 'INCOMPLETE').length, 0) } };
}
