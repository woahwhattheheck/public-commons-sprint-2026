// MIT. Provider-native window plans and complete original request observations.
import { canonicalJson, queryRequests, compareCaptures } from './domain.mjs';
import { describeRequests, sourceDateTime } from './client.mjs';

export const COLLECTION_SCHEMA = 'commons.open311.collection.v1';
const DAY = 86400000;
const clone = value => JSON.parse(canonicalJson(value));
function invalid(message) {
  const error = new TypeError(message); error.code = 'INVALID_COLLECTION'; error.status = 400; throw error;
}
function integer(value, fallback, name, maximum = Number.MAX_SAFE_INTEGER) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) invalid(name + ' must be a positive integer at most ' + maximum + '.');
  return selected;
}
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(name + ' must be a JSON object.');
  return value;
}
function iso(value) { return new Date(value).toISOString(); }
function node(id, startDate, endDate, parentId = null) {
  return { id, parentId, startDate, endDate, state: 'PENDING', children: [], attempts: [], captureId: null };
}
export function normalizeCollectionPlan(connection, input) {
  object(input, 'Collection');
  const query = clone(object(input.query, 'Collection query'));
  if (!query.start_date || !query.end_date) invalid('A collection requires explicit start_date and end_date.');
  const start = sourceDateTime(query.start_date, 'start_date'), end = sourceDateTime(query.end_date, 'end_date');
  if (end <= start) invalid('The collection end must be later than its start.');
  for (const field of ['service_request_id', 'page', 'page_size'])
    if (query[field] !== undefined && query[field] !== null && query[field] !== '') invalid(field + ' cannot be combined with a date-window collection.');
  const supplied = input.policy === undefined ? {} : object(input.policy, 'Collection policy');
  const allowed = ['maxWindowDays', 'queryQuantumMs', 'minimumWindowMs', 'boundaryOverlapMs'];
  if (Object.keys(supplied).some(key => !allowed.includes(key))) invalid('The collection policy contains an unknown field.');
  const maxWindowDays = integer(supplied.maxWindowDays, 90, 'maxWindowDays', 90);
  const queryQuantumMs = integer(supplied.queryQuantumMs, 1000, 'queryQuantumMs', DAY);
  const minimumWindowMs = integer(supplied.minimumWindowMs, queryQuantumMs, 'minimumWindowMs', maxWindowDays * DAY);
  const boundaryOverlapMs = supplied.boundaryOverlapMs === undefined ? queryQuantumMs : supplied.boundaryOverlapMs;
  if (!Number.isSafeInteger(boundaryOverlapMs) || boundaryOverlapMs < 0 || boundaryOverlapMs >= maxWindowDays * DAY / 2 ||
      boundaryOverlapMs % queryQuantumMs !== 0 || minimumWindowMs % queryQuantumMs !== 0)
    invalid('Use minimumWindowMs and boundaryOverlapMs as multiples of queryQuantumMs; overlap must be less than half the initial window.');
  const policy = { maxWindowDays, queryQuantumMs, minimumWindowMs, boundaryOverlapMs };
  const filters = { ...query }; delete filters.start_date; delete filters.end_date;
  // The original normalizer validates provider filters without accessing a credential or source endpoint.
  const normalizedFilters = describeRequests(connection, filters).query;
  const normalizedQuery = { ...normalizedFilters, start_date: query.start_date, end_date: query.end_date };
  const nodes = [];
  let left = start, index = 1;
  while (left < end) {
    let right = Math.min(end, left + maxWindowDays * DAY);
    if (right < end) right = Math.floor(right / queryQuantumMs) * queryQuantumMs;
    if (right <= left) invalid('The selected query precision cannot represent the initial date windows.');
    nodes.push(node('w' + String(index++).padStart(6, '0'),
      left === start ? query.start_date : iso(left), right === end ? query.end_date : iso(right)));
    if (right === end) break;
    const next = right - boundaryOverlapMs;
    if (next <= left) invalid('The selected overlap prevents progress through the date range.');
    left = next;
  }
  const name = input.name === undefined ? 'Service requests ' + query.start_date + ' — ' + query.end_date : input.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || name.includes('\0')) invalid('Use a collection name of 1–200 characters.');
  return { name, query: normalizedQuery, requestedQuery: query, policy, nodes };
}
export function collectionNodeQuery(collection, window) {
  const query = { ...collection.query, start_date: window.startDate, end_date: window.endDate };
  return describeRequests(collection.connection, query).query;
}
export function splitCollectionWindow(window, policy) {
  const start = sourceDateTime(window.startDate, 'startDate'), end = sourceDateTime(window.endDate, 'endDate');
  const quantum = policy.queryQuantumMs, overlap = policy.boundaryOverlapMs;
  const middle = Math.floor(((start + end - overlap) / 2) / quantum) * quantum;
  const leftEnd = middle + overlap;
  if (end - start <= policy.minimumWindowMs || middle <= start || leftEnd >= end ||
      leftEnd - start < policy.minimumWindowMs || end - middle < policy.minimumWindowMs) return null;
  return [node(window.id + '.0', window.startDate, iso(leftEnd), window.id),
    node(window.id + '.1', iso(middle), window.endDate, window.id)];
}
function observedOrder(a, b) {
  const first = Date.parse(a.capture.capturedAt), second = Date.parse(b.capture.capturedAt);
  const compared = (Number.isFinite(first) ? first : 0) - (Number.isFinite(second) ? second : 0);
  return compared || a.capture.id.localeCompare(b.capture.id);
}
export function projectCollection(collection, records) {
  const nodes = new Map(collection.nodes.map(window => [window.id, window]));
  const byCapture = new Map();
  for (const window of collection.nodes) if (window.captureId) byCapture.set(window.captureId, window);
  const captured = records.filter(record => byCapture.has(record.capture.id)).sort(observedOrder);
  const identities = new Map();
  let returnedRows = 0, outOfWindowRows = 0, unknownDateRows = 0;
  for (const record of captured) {
    const window = byCapture.get(record.capture.id);
    const start = Date.parse(window.startDate), end = Date.parse(window.endDate);
    for (const row of record.items) {
      returnedRows++;
      const requested = Date.parse(row.requestedAt);
      const windowPosition = !Number.isFinite(requested) ? 'UNKNOWN_DATE'
        : requested < start || requested > end ? 'OUTSIDE_REQUESTED_WINDOW' : 'WITHIN_RECORDED_BOUNDS';
      if (windowPosition === 'UNKNOWN_DATE') unknownDateRows++;
      if (windowPosition === 'OUTSIDE_REQUESTED_WINDOW') outOfWindowRows++;
      const occurrence = { captureId: record.capture.id, windowId: window.id,
        capturedAt: record.capture.capturedAt, sourceSha256: row.sourceSha256,
        sourceResponseSha256: record.capture.sourceSha256, windowPosition,
        requestedAt: row.requestedAt, updatedAt: row.updatedAt };
      let entry = identities.get(row.key);
      if (!entry) { entry = { row, occurrences: [], versions: new Map() }; identities.set(row.key, entry); }
      entry.row = row; entry.captureId = record.capture.id;
      entry.occurrences.push(occurrence);
      let version = entry.versions.get(row.sourceSha256);
      if (!version) { version = { sourceSha256: row.sourceSha256, item: row, occurrences: [] }; entry.versions.set(row.sourceSha256, version); }
      version.occurrences.push(occurrence);
    }
  }
  const items = [...identities.values()].map(entry => ({ ...entry.row, collectionId: collection.id,
    captureId: entry.captureId, observationCount: entry.occurrences.length, versionCount: entry.versions.size }));
  const stateCount = state => collection.nodes.filter(window => window.state === state).length;
  const counts = { windowCount: collection.nodes.length, pendingWindows: stateCount('PENDING'),
    activeWindows: stateCount('FETCHING'), capturedWindows: stateCount('CAPTURED'),
    splitWindows: stateCount('SPLIT'), limitedWindows: stateCount('LIMITED'), failedWindows: stateCount('FAILED'),
    originalCaptureCount: captured.length, returnedRows, uniqueRequests: items.length,
    changedRequests: items.filter(item => item.versionCount > 1).length,
    duplicateObservations: returnedRows - items.length, outOfWindowRows, unknownDateRows };
  const terminal = ['COMPLETE', 'LIMITED'].includes(collection.state);
  const capResolved = terminal && counts.pendingWindows === 0 && counts.activeWindows === 0 &&
    counts.failedWindows === 0 && counts.limitedWindows === 0;
  const observed = captured.map(record => record.capture.capturedAt).sort();
  const summary = { id: collection.id, schema: collection.schema, name: collection.name,
    connectionId: collection.connectionId, query: collection.query, requestedQuery: collection.requestedQuery,
    policy: collection.policy, state: collection.state, createdAt: collection.createdAt, updatedAt: collection.updatedAt,
    pauseRequested: collection.pauseRequested, runRequestId: collection.runRequestId ?? null,
    lastError: collection.lastError ?? null, resumeAt: collection.resumeAt ?? null,
    counts, capResolved, firstObservedAt: observed[0] ?? null, lastObservedAt: observed.at(-1) ?? null,
    interpretation: 'Latest observed original version within this collection; source requests may change between window captures.' };
  return { summary, items, observations: identities, records: captured, nodes };
}
export function queryCollection(projection, filter = {}) {
  let rows = projection.items;
  if (filter.changedOnly === true || filter.changedOnly === 'true') rows = rows.filter(row => row.versionCount > 1);
  if (filter.reviewStatus !== undefined && filter.reviewStatus !== '') rows = rows.filter(row => (row.review?.status ?? 'new') === filter.reviewStatus);
  if (filter.assignee !== undefined && filter.assignee !== '') rows = rows.filter(row => (row.review?.assignee ?? '') === filter.assignee);
  return { ...queryRequests(rows, filter), collection: projection.summary };
}
export function compareCollections(before, after) {
  const fixed = projection => ({ connectionId: projection.summary.connectionId,
    connection: projection.records[0]?.capture.connection ?? projection.connection,
    query: projection.summary.query, rows: projection.items, kind: 'requests' });
  const comparison = compareCaptures(fixed(before), fixed(after));
  const scopeComparable = comparison.scopeComparable && before.summary.capResolved && after.summary.capResolved &&
    before.summary.counts.outOfWindowRows === 0 && after.summary.counts.outOfWindowRows === 0 &&
    before.summary.counts.unknownDateRows === 0 && after.summary.counts.unknownDateRows === 0;
  return { before: before.summary.id, after: after.summary.id, ...comparison,
    scopeComparable, missingFromCapture: scopeComparable ? comparison.missingFromCapture : [],
    coverage: { before: before.summary, after: after.summary },
    interpretation: 'Missing means absent from these retained observations. Internal reviews and source resolution status are unchanged.' };
}
export function validateCollectionRecord(collection, { connections, captures, operations }) {
  object(collection, 'Exported collection');
  if (collection.schema !== COLLECTION_SCHEMA || typeof collection.id !== 'string' ||
      !/^collection-[a-f0-9]{24}$/.test(collection.id)) invalid('An exported collection identity is invalid.');
  const connection = connections.get(collection.connectionId);
  if (!connection || collection.connection?.id !== collection.connectionId ||
      collection.connection?.baseUrl !== connection.baseUrl ||
      (collection.connection?.jurisdictionId ?? '') !== (connection.jurisdictionId ?? ''))
    invalid('An exported collection belongs to a different endpoint or jurisdiction.');
  const creation = operations.get(collection.creationRequestId);
  if (!creation || creation.kind !== 'collection-create' || creation.state !== 'SUCCEEDED' ||
      creation.result?.collection?.id !== collection.id || creation.intent?.connectionId !== collection.connectionId)
    invalid('An exported collection has no matching original creation operation.');
  const planned = normalizeCollectionPlan(collection.connection, { name: collection.name,
    query: collection.requestedQuery, policy: collection.policy });
  if (canonicalJson(planned.query) !== canonicalJson(collection.query) ||
      canonicalJson(planned.policy) !== canonicalJson(collection.policy)) invalid('An exported collection plan differs from its original selection.');
  if (!Array.isArray(collection.nodes) || !['PLANNED', 'PAUSED', 'INTERRUPTED', 'COMPLETE', 'LIMITED'].includes(collection.state))
    invalid('Finish or pause a running collection before receiving its complete workspace.');
  const nodes = new Map(), captureIds = new Set();
  for (const window of collection.nodes) {
    if (nodes.has(window.id)) invalid('An exported collection repeats a window identity.');
    nodes.set(window.id, window);
  }
  const expectedNodes = new Map(planned.nodes.map(window => [window.id, window]));
  for (const window of collection.nodes) {
    const expected = expectedNodes.get(window.id);
    if (!expected || window.startDate !== expected.startDate || window.endDate !== expected.endDate ||
        window.parentId !== expected.parentId) invalid('An exported collection window differs from its original subdivision.');
    if (!['PENDING', 'CAPTURED', 'SPLIT', 'LIMITED', 'FAILED'].includes(window.state) ||
        !Array.isArray(window.attempts) || !Array.isArray(window.children)) invalid('An exported collection contains an invalid or pending window.');
    if (window.captureId) {
      const captured = captures.get(window.captureId);
      if (!captured || captureIds.has(window.captureId) || captured.capture.kind !== 'requests' ||
          captured.capture.connectionId !== collection.connectionId ||
          canonicalJson(captured.capture.query) !== canonicalJson(collectionNodeQuery(collection, window)))
        invalid('An exported collection member does not match its original query and capture.');
      captureIds.add(window.captureId);
      if (window.state === 'CAPTURED' && captured.capture.saturated) invalid('A capped window is incorrectly marked below the response limit.');
      if (['SPLIT', 'LIMITED'].includes(window.state) && !captured.capture.saturated && !window.problem)
        invalid('An exported refinement lacks its original capped capture.');
    } else if (['CAPTURED', 'SPLIT', 'LIMITED'].includes(window.state)) invalid('An exported collection member is missing its complete source capture.');
    if (window.state === 'SPLIT') {
      const children = splitCollectionWindow(window, collection.policy);
      if (!children || canonicalJson(window.children) !== canonicalJson(children.map(child => child.id)))
        invalid('An exported split differs from the selected boundary policy.');
      for (const child of children) expectedNodes.set(child.id, child);
    } else if (window.children.length) invalid('An unsplit window contains child references.');
    for (const attempt of window.attempts) {
      const operation = operations.get(attempt.requestId);
      if (!operation || operation.kind !== 'capture' || !attempt.intent ||
          canonicalJson(Object.fromEntries(Object.entries(operation.intent).filter(([key]) => key !== 'selected'))) !== canonicalJson(attempt.intent))
        invalid('A collection attempt has no matching original capture request.');
      if (attempt.captureId && (operation.state !== 'SUCCEEDED' || operation.result?.capture?.id !== attempt.captureId))
        invalid('A collection attempt refers to a different original response.');
    }
  }
  if (expectedNodes.size !== nodes.size || [...expectedNodes.keys()].some(key => !nodes.has(key)))
    invalid('An exported collection is missing planned or refined windows.');
  if (['COMPLETE', 'LIMITED'].includes(collection.state) && collection.nodes.some(window => ['PENDING', 'FAILED'].includes(window.state)))
    invalid('An unfinished collection is marked terminal.');
  if (collection.state === 'COMPLETE' && collection.nodes.some(window => window.state === 'LIMITED'))
    invalid('A capped collection is marked complete.');
  return clone(collection);
}
