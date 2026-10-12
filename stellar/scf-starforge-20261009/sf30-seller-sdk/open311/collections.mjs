// MIT. Durable multi-window operations in the original Open311 SQLite workspace.
import { COLLECTION_SCHEMA, normalizeCollectionPlan, collectionNodeQuery, splitCollectionWindow, nextCollectionPage,
  projectCollection, queryCollection, compareCollections, validateCollectionRecord } from './collection-domain.mjs';
import { collectionExport } from './collection-report.mjs';

export function createCollectionOperations(context) {
  const { all, get, run, transaction, meta, saveMeta, mutation, previous, expected,
    commitOperation, mutate, connection, captureRecord, rowsForCapture, attachReview,
    originalOperation, captureSelected, fail, id, now, canonical, sha256, copy, owner, activeOwner, inflight } = context;
  function read(collectionId) {
    id(collectionId, 'collectionId');
    const row = get('SELECT value FROM collections WHERE id=?', collectionId);
    if (!row) fail('COLLECTION_NOT_FOUND', 'The selected source collection was not found.', 404);
    return JSON.parse(row.value);
  }
  function save(value, bump = true) {
    value.updatedAt = now();
    run('INSERT INTO collections(id,connection_id,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      value.id, value.connectionId, canonical(value));
    if (bump) { const metadata = meta(); metadata.revision++; saveMeta(metadata); }
  }
  function records(value, full = false) {
    return value.nodes.filter(node => node.captureId).map(node => {
      const saved = captureRecord(node.captureId);
      return { ...(full ? saved : { capture: saved.capture }), items: rowsForCapture(node.captureId) };
    });
  }
  function projection(value, full = false) {
    const result = projectCollection(value, records(value, full));
    result.items = result.items.map(attachReview);
    result.connection = value.connection;
    return result;
  }
  function summary(value) { return projection(value).summary; }
  function summaries() {
    return all('SELECT value FROM collections ORDER BY id').map(row => summary(JSON.parse(row.value)))
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  function create(supplied) {
    return mutate('collection-create', supplied, input => {
      id(input.connectionId, 'connectionId');
      const selected = copy(connection(input.connectionId));
      const plan = normalizeCollectionPlan(selected, input);
      const value = { schema: COLLECTION_SCHEMA, id: 'collection-' + sha256(input.requestId).slice(0,24),
        connectionId: selected.id, connection: selected, creationRequestId: input.requestId, ...plan,
        state: 'PLANNED', pauseRequested: false, runRequestId: null,
        createdAt: now(), updatedAt: now(), lastError: null, resumeAt: null };
      save(value, false);
      return { collection: summary(value) };
    });
  }
  function info({ id: collectionId, offset = 0, limit = 100 } = {}) {
    return transaction(() => {
      offset = Number(offset); limit = Number(limit);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
        fail('INVALID_PAGE', 'Use a nonnegative offset and a window page size from 1 to 1000.');
      const value = read(collectionId), projected = projection(value);
      const selected = value.nodes.slice(offset, offset + limit).map(node => ({
        ...node, capture: node.captureId ? captureRecord(node.captureId).capture : null
      }));
      const next = offset + selected.length;
      return { workspaceId: meta().workspaceId, revision: meta().revision,
        collection: projected.summary, connection: value.connection,
        items: selected, total: value.nodes.length, offset, limit, nextOffset: next < value.nodes.length ? next : null };
    }, false);
  }
  function requests(filter = {}) {
    return transaction(() => {
      const value = read(filter.collection);
      return queryCollection(projection(value), filter);
    }, false);
  }
  function request(filter = {}) {
    return transaction(() => {
      const value = read(filter.collection), projected = projection(value);
      const item = projected.items.find(row => row.serviceRequestId === String(filter.id));
      if (!item) fail('REQUEST_NOT_FOUND', 'This service request is absent from the selected source collection.', 404);
      const original = projected.observations.get(item.key);
      const versions = [...original.versions.values()].map(version => ({ ...version, item: attachReview(version.item) }));
      const history = original.occurrences.slice().reverse().map(occurrence => {
        const version = original.versions.get(occurrence.sourceSha256);
        return { ...occurrence, item: attachReview(version.item) };
      });
      return { item, history, review: item.review, versions, collection: projected.summary };
    }, false);
  }
  function diff({ before, after }) {
    return transaction(() => compareCollections(projection(read(before)), projection(read(after))), false);
  }
  function retryAt(error) {
    const receipt = error?.receipt;
    const header = receipt?.headers?.['retry-after'];
    if (header == null) return null;
    const base = Date.parse(receipt.observedAt);
    const result = /^[0-9]+$/.test(String(header))
      ? (Number.isFinite(base) ? base : Date.now()) + Number(header) * 1000 : Date.parse(header);
    return Number.isFinite(result) ? new Date(result).toISOString() : null;
  }
  function errorValue(error) {
    return { code: String(error.code || 'SOURCE_ERROR'), message: String(error.message || 'The source collection was interrupted.'),
      status: Number.isInteger(error.status) ? error.status : Number.isInteger(error.receipt?.status) && error.receipt.status >= 400 ? error.receipt.status : 502,
      ...(error.receipt ? { receipt: copy(error.receipt) } : {}),
      ...(error.details ? { details: copy(error.details) } : {}) };
  }
  function finish(input, state, error = null) {
    return transaction(() => {
      const { op, hash } = previous('collection-run', input);
      if (op?.state === 'SUCCEEDED') return op.result;
      const value = read(input.collectionId);
      if (value.runRequestId !== input.requestId) fail('COLLECTION_RUN_CHANGED', 'Another saved collection run owns this plan.', 409);
      value.state = state; value.pauseRequested = false;
      value.lastError = error; value.resumeAt = error ? retryAt(error) : null;
      save(value, false);
      return commitOperation('collection-run', input, hash, { collection: summary(value) }, op?.createdAt || now());
    });
  }
  function pause(supplied) {
    return mutate('collection-pause', supplied, input => {
      const value = read(input.collectionId);
      if (value.state === 'RUNNING') value.pauseRequested = true;
      else if (!['COMPLETE','LIMITED'].includes(value.state)) value.state = 'PAUSED';
      save(value, false);
      return { collection: summary(value) };
    });
  }
  async function execute(supplied) {
    const input = mutation(supplied);
    id(input.collectionId, 'collectionId');
    const prepared = transaction(() => {
      const { op, hash } = previous('collection-run', input);
      if (op?.state === 'SUCCEEDED') return { result: op.result };
      if (op && op.state !== 'RUNNING') fail('COLLECTION_OPERATION_STATE', 'Inspect the saved collection operation before continuing.', 409);
      if (op && (inflight.has(input.requestId) || activeOwner(op.owner)))
        fail('OPERATION_RUNNING', 'This original collection run is still active.', 409, { requestId: input.requestId });
      const value = read(input.collectionId);
      if (value.runRequestId && value.runRequestId !== input.requestId) {
        const active = originalOperation(value.runRequestId);
        if (active?.state === 'RUNNING') fail('COLLECTION_RUN_PENDING',
          'Resume the original retained run before starting a different run.', 409, { requestId: value.runRequestId });
      }
      if (!op) expected(input);
      if (value.resumeAt && Date.parse(value.resumeAt) > Date.now())
        fail('SOURCE_RETRY_AFTER', 'The source requested a later retry; use the retained retry time.', 429, { resumeAt: value.resumeAt });
      if (['COMPLETE','LIMITED'].includes(value.state))
        return { result: commitOperation('collection-run', input, hash, { collection: summary(value) }) };
      value.state = 'RUNNING'; value.pauseRequested = false; value.runRequestId = input.requestId;
      value.lastError = null; value.resumeAt = null; save(value);
      run('INSERT INTO operations(request_id,payload_hash,kind,state,intent,result,error,staged,owner,created_at,updated_at) VALUES(?,?,?,?,?,NULL,NULL,NULL,?,?,?) ON CONFLICT(request_id) DO UPDATE SET state=excluded.state,owner=excluded.owner,updated_at=excluded.updated_at',
        input.requestId, hash, 'collection-run', 'RUNNING', canonical(input), canonical(owner), op?.createdAt || now(), now());
      return {};
    });
    if (prepared.result) return prepared.result;
    inflight.add(input.requestId);
    try {
      for (;;) {
        const action = transaction(() => {
          const value = read(input.collectionId);
          if (value.runRequestId !== input.requestId) fail('COLLECTION_RUN_CHANGED', 'Another saved run owns this collection.', 409);
          if (value.pauseRequested) return { stop: 'PAUSED' };
          const window = value.nodes.find(node => ['PENDING','FETCHING','FAILED'].includes(node.state));
          if (!window) return { stop: value.nodes.some(node => node.state === 'LIMITED') ? 'LIMITED' : 'COMPLETE' };
          let attempt = window.state === 'FETCHING' ? window.attempts.at(-1) : null;
          if (!attempt) {
            const requestId = 'collection-capture-' + sha256(canonical([value.id,window.id,window.attempts.length])).slice(0,32);
            attempt = { requestId, startedAt: now(), finishedAt: null, captureId: null, error: null,
              intent: { requestId, expectedRevision: meta().revision + 1, connectionId: value.connectionId,
                kind: 'requests', query: collectionNodeQuery(value, window) } };
            window.attempts.push(attempt);
          }
          window.state = 'FETCHING';
          save(value);
          return { windowId: window.id, requestId: attempt.requestId, intent: attempt.intent, connection: value.connection };
        });
        if (action.stop) return finish(input, action.stop);
        let result;
        try {
          // The entire plan has already passed the operator's revision check.
          // Its internal source members retain their own original request identities.
          result = await captureSelected(action.intent, action.connection);
        } catch (error) {
          const saved = errorValue(error);
          transaction(() => {
            const value = read(input.collectionId), window = value.nodes.find(node => node.id === action.windowId);
            const attempt = window.attempts.find(item => item.requestId === action.requestId);
            attempt.finishedAt = now(); attempt.error = saved; window.state = 'FAILED'; save(value);
          });
          return finish(input, 'INTERRUPTED', saved);
        }
        transaction(() => {
          const value = read(input.collectionId), window = value.nodes.find(node => node.id === action.windowId);
          const attempt = window.attempts.find(item => item.requestId === action.requestId);
          attempt.finishedAt = now(); attempt.captureId = result.capture.id; attempt.error = null;
          window.captureId = result.capture.id;
          const intended = collectionNodeQuery(value, window);
          if (canonical(result.capture.query) !== canonical(intended)) {
            window.state = 'LIMITED'; window.problem = 'SOURCE_QUERY_MISMATCH';
          } else if (result.capture.saturated && value.policy.strategy === 'pages') {
            const repeated = value.nodes.some(previous => previous.id !== window.id && previous.captureId &&
              previous.startDate === window.startDate && previous.endDate === window.endDate &&
              captureRecord(previous.captureId).capture.sourceSha256 === result.capture.sourceSha256);
            if (repeated) {
              window.state = 'LIMITED'; window.problem = 'REPEATED_SOURCE_PAGE';
            } else {
              const next = nextCollectionPage(window, value.policy);
              window.state = 'PAGED'; window.children = [next.id]; value.nodes.push(next);
            }
          } else if (result.capture.saturated) {
            const children = splitCollectionWindow(window, value.policy);
            if (children) {
              window.state = 'SPLIT'; window.children = children.map(child => child.id);
              value.nodes.push(...children);
            } else { window.state = 'LIMITED'; window.problem = 'RESPONSE_CAP_AT_SELECTED_PRECISION'; }
          } else window.state = 'CAPTURED';
          save(value);
        });
      }
    } catch (error) {
      const saved = errorValue(error);
      try { return finish(input, 'INTERRUPTED', saved); } catch { throw error; }
    } finally { inflight.delete(input.requestId); }
  }
  function exportRecords() { return all('SELECT value FROM collections ORDER BY id').map(row => JSON.parse(row.value)); }
  function validateReceived(values, inventories) {
    if (!Array.isArray(values)) fail('INVALID_SOURCE_COLLECTION', 'The complete collection inventory must be an array.');
    const ids = new Set();
    return values.map(value => {
      if (ids.has(value.id)) fail('DUPLICATE_COLLECTION', 'An exported collection identity is duplicated.');
      ids.add(value.id);
      return validateCollectionRecord(value, inventories);
    });
  }
  function receive(values) {
    for (const value of values) run('INSERT INTO collections(id,connection_id,value) VALUES(?,?,?)', value.id, value.connectionId, canonical(value));
  }
  function exported(selection) {
    return transaction(() => {
      const value = read(selection.collection), projected = projection(value, selection.kind === 'json');
      return collectionExport({ collection: value, projection: projected,
        workspace: meta(), kind: selection.kind, originalOperation });
    }, false);
  }
  return { create, execute, pause, info, requests, request, diff, summaries,
    exportRecords, validateReceived, receive, exported };
}
