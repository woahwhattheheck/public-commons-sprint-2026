// MIT. Resumable WordPress discovery and native collection capture.
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { privateDirectory, acquireWorkspace, readJson, atomicJson, immutableJson, exists, hashPrivate } from './files.mjs';
import { captureRequest, responseBody, nativeFailure, retryAt } from './transport.mjs';
import { JOB_SCHEMA, UUID, object, clone, now, id, identity, validateSource, validateSelection,
  collectionIndex, nativeQuery, nativeIdentity, directory as absolute, fail, errorRecord, integer } from './config.mjs';
const STATE_BYTES = 134217728;
const responseName = sequence => String(sequence).padStart(7, '0') + '.json';
const totalHeader = (record, name) => {
  const value = record.response.headers[name];
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
};
export async function openWordPressSource({ directory, source, environment = process.env, fetchImpl = fetch, onEvent } = {}) {
  directory = absolute(directory); source = validateSource(source);
  await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory), jobsDirectory = join(directory, 'jobs'), active = new Map();
  let closed = false, closePromise;
  try {
    await privateDirectory(jobsDirectory, true);
    await immutableJson(join(directory, 'source.json'), source);
  } catch (error) { await release(); throw error; }
  const home = jobId => join(jobsDirectory, id(jobId));
  async function intent(jobId) {
    const value = await readJson(join(home(jobId), 'intent.json'), 33554432);
    if (value.schema !== JOB_SCHEMA || value.id !== jobId || value.sourceSha256 !== identity(source) ||
        value.intentSha256 !== identity({ kind: value.kind, sourceSha256: value.sourceSha256, input: value.input }))
      fail('WORDPRESS_CAPTURE_IDENTITY', 'The retained capture intent has changed.', 409);
    return value;
  }
  async function state(jobId) {
    const value = await readJson(join(home(jobId), 'progress.json'), STATE_BYTES);
    if (value.schema !== JOB_SCHEMA || value.id !== jobId || !Array.isArray(value.responses) || !Array.isArray(value.pages))
      fail('WORDPRESS_CAPTURE_STATE', 'The retained capture cursor is invalid.', 409);
    return value;
  }
  async function save(value) {
    value.revision++; value.updatedAt = now();
    await atomicJson(home(value.id), 'progress.json', value);
    return value;
  }
  async function completion(jobId) {
    const value = await readJson(join(home(jobId), 'complete.json'), STATE_BYTES);
    const { sha256, ...original } = value;
    if (sha256 !== identity(original)) fail('WORDPRESS_CAPTURE_CHANGED', 'The completed capture identity has changed.', 409);
    const selected = await intent(jobId);
    if (value.intentSha256 !== selected.intentSha256) fail('WORDPRESS_CAPTURE_CHANGED', 'The completed capture and original intent differ.', 409);
    return value;
  }
  async function create({ id: jobId, kind, discoveryId, selection } = {}) {
    if (closed) fail('WORDPRESS_SOURCE_CLOSED', 'The original source is closed.', 409);
    id(jobId);
    let input;
    if (kind === 'discovery') {
      if (discoveryId !== undefined || selection !== undefined) fail('WORDPRESS_DISCOVERY_FIELDS', 'Discovery reads the selected native source.');
      input = {};
    } else if (kind === 'capture') {
      const discovery = await completion(id(discoveryId));
      if (discovery.kind !== 'discovery') fail('WORDPRESS_DISCOVERY_REQUIRED', 'Select the completed native discovery.');
      input = { discoveryId, discoverySha256: discovery.sha256, discovery,
        selection: validateSelection(selection, discovery) };
    } else fail('WORDPRESS_JOB_KIND', 'Select discovery or capture.');
    const original = { kind, sourceSha256: identity(source), input }, intentSha256 = identity(original);
    const path = home(jobId);
    if (await exists(join(path, 'intent.json'))) {
      const previous = await intent(jobId);
      if (previous.intentSha256 !== intentSha256) fail('WORDPRESS_JOB_ID_REUSED', 'This capture UUID belongs to a different original selection.', 409);
      if (await exists(join(path, 'progress.json'))) return inspect(jobId);
      await atomicJson(path, 'progress.json', { schema: JOB_SCHEMA, id: jobId, kind, sourceSha256: identity(source),
        intentSha256, status: 'queued', revision: 0, createdAt: previous.createdAt, updatedAt: previous.createdAt,
        responseCount: 0, responseBytes: 0, recordCount: 0, collectionIndex: 0, page: 1,
        responses: [], pages: [], collections: [], findings: [] });
      return inspect(jobId);
    }
    await privateDirectory(path, true); await privateDirectory(join(path, 'responses'), true);
    const retained = { schema: JOB_SCHEMA, id: jobId, ...original, createdAt: now(), intentSha256 };
    await immutableJson(join(path, 'intent.json'), retained, 33554432);
    await atomicJson(path, 'progress.json', { schema: JOB_SCHEMA, id: jobId, kind, sourceSha256: identity(source),
      intentSha256, status: 'queued', revision: 0, createdAt: retained.createdAt, updatedAt: retained.createdAt,
      responseCount: 0, responseBytes: 0, recordCount: 0, collectionIndex: 0, page: 1,
      responses: [], pages: [], collections: [], findings: [] });
    return inspect(jobId);
  }
  async function inspect(jobId) {
    const original = await intent(jobId), current = await state(jobId);
    const complete = await exists(join(home(jobId), 'complete.json')) ? await completion(jobId) : null;
    return { ...current, status: complete ? 'complete' : current.status === 'running' && !active.has(jobId) ? 'interrupted' : current.status,
      storedStatus: current.status, active: active.has(jobId), intent: original, complete };
  }
  async function list() {
    const values = [];
    for (const item of await readdir(jobsDirectory, { withFileTypes: true })) {
      if (!item.isDirectory() || !UUID.test(item.name) || !await exists(join(jobsDirectory, item.name, 'intent.json'))) continue;
      try {
        const value = await inspect(item.name);
        values.push({ id: value.id, kind: value.kind, status: value.status, active: value.active,
          revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt,
          responseCount: value.responseCount, responseBytes: value.responseBytes, recordCount: value.recordCount,
          collectionIndex: value.collectionIndex, page: value.page, nextRetryAt: value.nextRetryAt ?? null,
          error: value.error ?? null, findings: value.findings, sha256: value.complete?.sha256 ?? null,
          collectionKeys: value.intent.input.selection?.collections.map(row => row.key) ?? [] });
      } catch (error) { values.push({ id: item.name, status: 'attention', error: errorRecord(error) }); }
    }
    return values.sort((a,b) => b.createdAt?.localeCompare(a.createdAt || '') || a.id.localeCompare(b.id));
  }
  async function response(jobId, sequence) {
    const original = await intent(jobId), current = await state(jobId);
    integer(sequence, 1, current.responseCount, 'the retained response sequence');
    const selected = current.responses.find(row => row.sequence === sequence);
    if (!selected) fail('WORDPRESS_RESPONSE_NOT_FOUND', 'Select a retained response.', 404);
    const path = join(home(jobId), 'responses', responseName(sequence));
    const observed = await hashPrivate(path, source.maxResponseBytes * 2 + 1048576);
    if (observed.hash !== selected.fileSha256 || observed.bytes !== selected.fileBytes)
      fail('WORDPRESS_RESPONSE_CHANGED', 'The captured response file differs from its original cursor.', 409);
    const record = await readJson(path, source.maxResponseBytes * 2 + 1048576);
    if (record.request.sourceSha256 !== original.sourceSha256)
      fail('WORDPRESS_RESPONSE_CHANGED', 'The captured response belongs to a different source.', 409);
    return record;
  }
  async function finish(original, current) {
    if (await exists(join(home(original.id), 'complete.json'))) {
      const complete = await completion(original.id); current.status = 'complete'; current.completedAt = complete.completedAt;
      return save(current);
    }
    let details;
    if (original.kind === 'discovery') {
      const records = [];
      for (const page of current.pages) records.push(responseBody(await response(original.id, page.sequence)));
      const [index, types, taxonomies] = records;
      details = { site: { name: index.name ?? null, description: index.description ?? null, url: index.url ?? null,
        home: index.home ?? null, gmtOffset: index.gmt_offset ?? null, timezoneString: index.timezone_string ?? null,
        namespaces: index.namespaces, authentication: Object.keys(index.authentication ?? {}) },
        collections: collectionIndex(index, types, taxonomies) };
    } else {
      const seen = new Map(); let duplicates = 0;
      for await (const row of records(original.id, { requireComplete: false })) {
        if (seen.has(row.key)) duplicates++;
        seen.set(row.key, row.responseSequence);
      }
      if (duplicates) current.findings.push({ code: 'DUPLICATE_NATIVE_IDS', count: duplicates,
        message: 'Native records appeared on more than one captured page; the reviewed projection selects first or last observed values.' });
      for (const row of current.collections) {
        if (row.firstTotal !== row.lastTotal || row.firstPages !== row.lastPages)
          current.findings.push({ code: 'COLLECTION_CHANGED_DURING_CAPTURE', collection: row.key,
            initialTotal: row.firstTotal, finalTotal: row.lastTotal, initialPages: row.firstPages, finalPages: row.lastPages });
        const unique = [...seen.keys()].filter(key => key.startsWith(row.key + ':')).length;
        if (row.lastTotal !== null && unique !== row.lastTotal)
          current.findings.push({ code: 'CAPTURED_TOTAL_DIFFERS', collection: row.key, nativeTotal: row.lastTotal, uniqueCaptured: unique });
      }
      details = { collections: clone(current.collections), uniqueRecords: seen.size, duplicateRecords: duplicates,
        selection: original.input.selection, discoveryId: original.input.discoveryId, discoverySha256: original.input.discoverySha256 };
    }
    const base = { schema: JOB_SCHEMA, id: original.id, kind: original.kind, sourceSha256: original.sourceSha256,
      intentSha256: original.intentSha256, context: source.context, apiRoot: source.apiRoot,
      startedAt: current.startedAt ?? original.createdAt, completedAt: now(), responseCount: current.responseCount,
      responseBytes: current.responseBytes, recordCount: current.recordCount, pages: clone(current.pages),
      responses: clone(current.responses), findings: clone(current.findings), ...details };
    const complete = { ...base, sha256: identity(base) };
    await immutableJson(join(home(original.id), 'complete.json'), complete, STATE_BYTES);
    current.status = 'complete'; current.completedAt = complete.completedAt; delete current.error; delete current.nextRetryAt;
    return save(current);
  }
  async function advance(jobId, signal) {
    const original = await intent(jobId), current = await state(jobId);
    if (current.status === 'complete') return current;
    if (current.nextRetryAt && Date.parse(current.nextRetryAt) > Date.now()) return current;
    signal?.throwIfAborted();
    current.status = 'running'; current.startedAt ??= now(); delete current.error; delete current.nextRetryAt;
    await save(current);
    let route, query, collection, selected;
    if (original.kind === 'discovery') {
      if (current.pages.length >= 3) return finish(original, current);
      route = ['/', '/wp/v2/types', '/wp/v2/taxonomies'][current.pages.length];
      query = current.pages.length ? { context: source.context } : {};
    } else {
      selected = original.input.selection.collections[current.collectionIndex];
      if (!selected) return finish(original, current);
      collection = original.input.discovery.collections.find(row => row.key === selected.key);
      route = collection.route; query = nativeQuery(source, collection, selected, current.page);
      if (current.pages.length >= original.input.selection.maxPages)
        fail('WORDPRESS_CAPTURE_PAGE_LIMIT', 'The retained capture reached its declared page ceiling.', 413);
    }
    const sequence = current.responseCount + 1, name = responseName(sequence), path = join(home(jobId), 'responses', name);
    const captured = await captureRequest({ source, route, query, path, environment, fetchImpl, signal, onRetained: onEvent });
    const record = captured.record, actual = await hashPrivate(path, source.maxResponseBytes * 2 + 1048576);
    const retained = { sequence, route, collection: collection?.key ?? null, page: original.kind === 'capture' ? current.page : null,
      file: 'responses/' + name, fileSha256: actual.hash, fileBytes: actual.bytes, status: record.response.status,
      requestSha256: record.requestSha256, responseSha256: record.response.sha256, responseBytes: record.response.bytes,
      observedAt: record.observedAt, reused: captured.reused };
    current.responseCount++; current.responseBytes += record.response.bytes; current.responses.push(retained);
    if (record.response.status < 200 || record.response.status >= 300) {
      current.error = nativeFailure(record);
      current.status = [408,425,429,500,502,503,504].includes(record.response.status) ? 'retry_later' : 'attention';
      current.nextRetryAt = retryAt(record);
      if (record.response.status >= 300 && record.response.status < 400)
        current.error.message = 'Review the native redirect and save its canonical REST root: ' + (record.response.headers.location ?? '');
      return save(current);
    }
    let body;
    try { body = responseBody(record, { exact: original.kind === 'capture' }); }
    catch (error) { current.status = 'attention'; current.error = errorRecord(error); return save(current); }
    if (original.kind === 'discovery') {
      if (!object(body)) { current.status = 'attention'; current.error = { code: 'WORDPRESS_DISCOVERY_OBJECT', message: 'The native discovery route did not return an object.' }; return save(current); }
      current.pages.push({ ...retained, records: 1 }); current.recordCount++;
      await save(current);
      if (current.pages.length === 3) return finish(original, current);
      return current;
    }
    if (!Array.isArray(body)) { current.status = 'attention'; current.error = { code: 'WORDPRESS_NATIVE_ARRAY', message: 'The native collection did not return an array.' }; return save(current); }
    try { for (const row of body) nativeIdentity(row, collection); }
    catch (error) { current.status = 'attention'; current.error = errorRecord(error); return save(current); }
    const total = totalHeader(record, 'x-wp-total'), pages = totalHeader(record, 'x-wp-totalpages');
    let coverage = current.collections.find(row => row.key === collection.key);
    if (!coverage) {
      coverage = { key: collection.key, kind: collection.kind, route, firstTotal: total, lastTotal: total,
        firstPages: pages, lastPages: pages, capturedPages: 0, capturedRecords: 0, startedAt: record.observedAt, finishedAt: null };
      current.collections.push(coverage);
      if (total === null || pages === null) current.findings.push({ code: 'PAGINATION_HEADERS_MISSING', collection: collection.key,
        message: 'The native route did not expose both WordPress total headers; the capture follows pages until a short native page.' });
    }
    coverage.lastTotal = total; coverage.lastPages = pages; coverage.capturedPages++; coverage.capturedRecords += body.length;
    current.recordCount += body.length; current.pages.push({ ...retained, records: body.length, nativeTotal: total, nativePages: pages });
    if (current.recordCount > original.input.selection.maxRecords || current.responseBytes > original.input.selection.maxBytes) {
      current.status = 'attention'; current.error = { code: 'WORDPRESS_CAPTURE_LIMIT', message: 'The native source exceeded the selected record or byte ceiling; completed responses remain retained.' };
      return save(current);
    }
    const finished = pages !== null ? current.page >= pages : body.length < source.perPage || !Object.hasOwn(collection.arguments, 'page');
    if (finished) {
      coverage.finishedAt = record.observedAt; current.collectionIndex++; current.page = 1;
    } else current.page++;
    await save(current);
    if (current.collectionIndex === original.input.selection.collections.length) return finish(original, current);
    return current;
  }
  async function* records(jobId, { requireComplete = true } = {}) {
    const original = await intent(jobId), current = await state(jobId);
    if (original.kind !== 'capture') fail('WORDPRESS_CAPTURE_REQUIRED', 'Select a native content capture.');
    if (requireComplete && current.status !== 'complete' && !await exists(join(home(jobId), 'complete.json'))) fail('WORDPRESS_CAPTURE_INCOMPLETE', 'Complete the same original capture before building a public edition.', 409);
    for (const page of current.pages) {
      const collection = original.input.discovery.collections.find(row => row.key === page.collection);
      const body = responseBody(await response(jobId, page.sequence), { exact: true });
      for (let index = 0; index < body.length; index++) {
        const native = body[index], key = nativeIdentity(native, collection);
        yield { key, collection: collection.key, kind: collection.kind, nativeId: key.slice(key.lastIndexOf(':') + 1),
          responseSequence: page.sequence, responseSha256: page.responseSha256, ordinal: index,
          observedAt: page.observedAt, native };
      }
    }
  }
  async function sample(jobId, { offset = 0, limit = 50, collection = null } = {}) {
    integer(offset,0,10000000,'the record offset'); integer(limit,1,250,'the visible record count');
    const rows = []; let count = 0, shownBytes = 0, clipped = false;
    for await (const row of records(jobId, { requireComplete: false })) {
      if (collection && row.collection !== collection) continue;
      const ordinal = count++;
      if (ordinal < offset || ordinal >= offset + limit) continue;
      const bytes = Buffer.byteLength(JSON.stringify(row));
      if (bytes + shownBytes > 4194304) {
        clipped = true; const { native, ...metadata } = row;
        rows.push({ ...metadata, native: null, originalRecordBytes: bytes, nativeOmitted: true });
      } else { shownBytes += bytes; rows.push(row); }
    }
    return { jobId, offset, limit, rows, recordCount: count, nextOffset: offset + limit < count ? offset + limit : null,
      bytes: shownBytes, clipped };
  }
  function run(jobId, { oneStep = false } = {}) {
    id(jobId);
    if (closed) fail('WORDPRESS_SOURCE_CLOSED', 'The original source is closed.', 409);
    if (active.has(jobId)) return { id: jobId, active: true, reused: true };
    if (active.size) fail('WORDPRESS_SOURCE_BUSY', 'Continue or pause the source’s current original capture first.', 409, { active: [...active.keys()] });
    const controller = new AbortController(), entry = { controller, promise: null }; active.set(jobId, entry);
    entry.promise = (async () => {
      try {
        while (!closed) {
          controller.signal.throwIfAborted();
          const value = await advance(jobId, controller.signal);
          if (oneStep || value.status !== 'running') break;
        }
      } catch (error) {
        try {
          const value = await state(jobId);
          if (value.status !== 'complete') {
            value.status = controller.signal.aborted ? 'paused' : 'attention';
            value.error = controller.signal.aborted ? { code: 'WORDPRESS_CAPTURE_PAUSED', message: 'The same capture can resume from its saved response cursor.' } : errorRecord(error);
            await save(value);
          }
        } catch {}
      } finally { active.delete(jobId); }
    })();
    return { id: jobId, active: true, reused: false };
  }
  async function wait(jobId) { await active.get(id(jobId))?.promise; return inspect(jobId); }
  async function cancel(jobId) {
    const entry = active.get(id(jobId));
    if (entry) { entry.controller.abort(); await entry.promise; }
    else { const value = await state(jobId); if (value.status !== 'complete') { value.status = 'paused'; value.error = { code: 'WORDPRESS_CAPTURE_PAUSED', message: 'Resume this original capture to continue its saved cursor.' }; await save(value); } }
    return inspect(jobId);
  }
  const close = () => {
    if (closePromise) return closePromise;
    const disposing = (async () => {
      closed = true; const entries = [...active.values()];
      for (const entry of entries) entry.controller.abort();
      await Promise.allSettled(entries.map(entry => entry.promise)); await release();
    })();
    closePromise = disposing;
    void disposing.catch(() => { if (closePromise === disposing) closePromise = null; });
    return disposing;
  };
  return { directory, source, sourceSha256: identity(source), create, run, wait, cancel, inspect, list, completion, response, records, sample, close };
}
