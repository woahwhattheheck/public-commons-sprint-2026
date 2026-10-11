// MIT. Native Blockworks reads compose the original SF31 transport and SF88 custody.
import { join, relative, resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { initializationDirectory, initializationBytes, optionalInitializationBytes,
  acquireInitialization } from '../../sf88-operator-buyer-cli/initialization.mjs';
import { openCaptureStore, jsonBytes, need, now, validId } from './capture-store.mjs';
import { ORIGIN, canonical, sha256, prepareRequest, requestURL, comparableURL,
  responseHeaders, retryTime, interpret, assess, createNativeTransport } from './provider.mjs';

export const ACQUISITION_SCHEMA = 'starforge.blockworks-acquisition/v1';
const clean = value => JSON.parse(canonical(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const envName = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
const problem = (code, message, extra = {}) => ({ code, message, ...extra });

/** New runs select a source; existing runs always reopen their own retained edition. */
export async function openAcquisitions({ directory, source = null, python,
  transport = null, buyerTransport = null, maxResponseBytes = 128 * 1024 * 1024 } = {}) {
  const store = await openCaptureStore(directory, { ...(python ? { python } : {}), maxResponseBytes });
  const currentSource = source === null ? null : await store.retainSource(source);
  const send = transport ?? createNativeTransport({ buyerTransport, maxResponseBytes });
  need(typeof send === 'function', 'ACQUISITION_TRANSPORT_INVALID');

  async function verified(id) {
    const manifest = await store.get(id);
    need(manifest.schema === ACQUISITION_SCHEMA && Array.isArray(manifest.captures), 'ACQUISITION_MANIFEST_INVALID');
    const document = await store.readSource(manifest.sourceHash);
    const compiled = prepareRequest(document, { path: manifest.request.path, query: manifest.request.query });
    need(canonical(compiled) === canonical(manifest.request), 'ACQUISITION_RETAINED_OPERATION_CHANGED');
    return { manifest, document };
  }
  async function get(id) { return (await verified(id)).manifest; }
  async function list() { return Promise.all((await store.list()).map(value => get(value.id))); }

  async function create({ id, request, review = {}, credentialEnv = null } = {}) {
    need(validId(id), 'ACQUISITION_ID_INVALID');
    need(currentSource, 'ACQUISITION_SOURCE_REQUIRED', 'Select the actual retained provider source for a new acquisition.');
    need(object(review), 'ACQUISITION_REVIEW_INVALID');
    need(credentialEnv === null || envName(credentialEnv), 'ACQUISITION_CREDENTIAL_ENV_INVALID');
    const binding = { request: prepareRequest(currentSource.document, request), source: currentSource.source,
      review: clean(review), credentialEnv };
    const fingerprint = sha256(canonical(binding));
    return store.withRun(id, async path => {
      const original = await store.readJson(join(path, 'intent.json'), true);
      if (original) need(original.id === id && canonical(original.binding) === canonical(binding),
        'ACQUISITION_IMMUTABLE_REQUEST_CHANGED', 'Reopen this exact request or create a new reviewed run with a new ID.');
      const prior = await store.readJson(join(path, 'manifest.json'), true);
      if (prior) return get(id);
      const contents = await readdir(path);
      need(contents.every(name => ['.initialization.lock', 'intent.json'].includes(name) || name.startsWith('.initializing-')),
        'ACQUISITION_INCOMPLETE_CONSTRUCTOR_HAS_DATA');
      const at = original?.createdAt ?? now();
      const intent = original ?? { schema: ACQUISITION_SCHEMA, id, createdAt: at, binding };
      await store.retain(join(path, 'intent.json'), jsonBytes(intent));
      const manifest = { schema: ACQUISITION_SCHEMA, id, fingerprint, request: binding.request,
        requestHash: sha256(canonical(binding.request)), source: binding.source, sourceHash: binding.source.sha256,
        review: binding.review, credentialEnv, createdAt: at, updatedAt: at, revision: 1,
        state: 'ready', cursor: { page: 1 }, pending: null, captures: [], attempts: [], problem: null,
        retryAt: null, coverage: { kind: binding.request.kind, pages: [], observedRows: 0,
          totalRows: null, totalPages: null, window: binding.request.window, bounds: binding.request.query.bounds ?? false, complete: false } };
      await store.retain(join(path, 'manifest.json'), jsonBytes(manifest));
      return manifest;
    });
  }

  async function retainedCapture(manifest, captureId) {
    const id = manifest.id;
    const metadata = manifest.captures.find(value => value.id === captureId);
    need(metadata, 'ACQUISITION_CAPTURE_NOT_FOUND');
    const retained = await store.readJson(join(store.runDirectory(id), 'responses', captureId + '.json'));
    need(canonical(retained) === canonical(metadata), 'ACQUISITION_CAPTURE_METADATA_CHANGED');
    return { body: await store.captureBody(id, metadata), metadata };
  }
  async function readCapture(id, captureId) { return retainedCapture(await get(id), captureId); }
  async function existingKeys(manifest) {
    const keys = new Set();
    if (!manifest.request.paged || !manifest.request.keyField) return keys;
    for (const capture of manifest.captures.filter(value => value.accepted)) {
      const document = JSON.parse((await store.captureBody(manifest.id, capture)).toString('utf8').replace(/^\uFEFF/, ''));
      for (const row of interpret(manifest.request, document).rows) {
        const key = row[manifest.request.keyField];
        need(!keys.has(key), 'ACQUISITION_RETAINED_ENTITY_REPEATED'); keys.add(key);
      }
    }
    return keys;
  }
  function assessmentFor(manifest, response, page, keys) {
    const previous = manifest.coverage.totalRows === null ? null : manifest.coverage;
    const result = assess(manifest.request, response, page, previous);
    if (!result.accepted || !manifest.request.paged) return result;
    if (manifest.request.keyField) {
      const rows = interpret(manifest.request, JSON.parse(response.body.toString('utf8').replace(/^\uFEFF/, ''))).rows;
      const pageKeys = new Set();
      for (const row of rows) {
        const key = row[manifest.request.keyField];
        if (keys.has(key) || pageKeys.has(key)) return { accepted: false, reviewRequired: true,
          problem: problem('native_entity_repeated', 'A native entity occurs more than once across retained pages. Review a fresh request without silently dropping rows.', { key, page }) };
        pageKeys.add(key);
      }
    }
    if (result.complete && manifest.coverage.observedRows + result.rowCount !== result.totalRows) return { accepted: false, reviewRequired: true,
      problem: problem('native_page_coverage_changed', 'The captured row count does not equal the provider total for the complete page sequence.',
        { observedRows: manifest.coverage.observedRows + result.rowCount, totalRows: result.totalRows }) };
    return result;
  }
  async function commitCapture(path, manifest, capture, body, keys) {
    need(manifest.pending?.id === capture.id && capture.sourceHash === manifest.sourceHash &&
      capture.requestHash === manifest.requestHash && capture.request.url === manifest.pending.request.url &&
      capture.request.page === manifest.cursor.page && capture.bodyFile === 'responses/' + capture.id + '.body',
      'ACQUISITION_PENDING_RESPONSE_CHANGED');
    const computed = assessmentFor(manifest, { ...capture, body }, capture.request.page, keys);
    need(canonical(computed) === canonical(capture.assessment), 'ACQUISITION_RETAINED_ASSESSMENT_CHANGED');
    need(!manifest.captures.some(value => value.id === capture.id), 'ACQUISITION_CAPTURE_ALREADY_COMMITTED');
    await retainRetry(manifest, capture);
    manifest.captures.push(capture); manifest.pending = null;
    manifest.problem = computed.problem ?? null; manifest.retryAt = computed.retryAt ?? null;
    if (computed.accepted) {
      const coverage = manifest.coverage;
      coverage.pages.push(capture.request.page); coverage.observedRows += computed.rowCount;
      if (manifest.request.paged) {
        coverage.totalRows = computed.totalRows; coverage.totalPages = computed.totalPages;
        if (manifest.request.keyField) {
          const document = JSON.parse(body.toString('utf8').replace(/^\uFEFF/, ''));
          for (const row of interpret(manifest.request, document).rows) keys.add(row[manifest.request.keyField]);
        }
      } else {
        coverage.totalRows = computed.rowCount; coverage.totalPages = 1;
        if (manifest.request.kind === 'timeseries') {
          coverage.pointCount = computed.rowCount; coverage.seriesKeys = computed.seriesKeys;
          coverage.pointSchema = computed.pointSchema;
        }
      }
      coverage.complete = computed.complete;
      manifest.state = computed.complete ? 'completed' : 'ready';
      manifest.cursor = { page: capture.request.page + (computed.complete ? 0 : 1) };
    } else manifest.state = computed.reviewRequired ? 'review_required' : 'paused';
    return store.checkpoint(path, manifest);
  }
  async function reconcilePending(path, manifest, keys) {
    if (!manifest.pending) return manifest;
    const pending = manifest.pending;
    const record = await store.readJson(join(path, 'responses', pending.id + '.json'), true);
    if (record) return commitCapture(path, manifest, record, await store.captureBody(manifest.id, record), keys);
    const body = await optionalInitializationBytes(join(path, 'responses', pending.id + '.body'), maxResponseBytes);
    manifest.attempts.push({ ...pending, disposition: 'no_complete_response_record', endedAt: now(),
      ...(body ? { orphanBody: { bodyFile: 'responses/' + pending.id + '.body', sha256: sha256(body), bytes: body.length } } : {}) });
    manifest.pending = null; manifest.state = 'paused';
    manifest.problem = problem('read_interrupted', 'The original GET has no complete retained response record. Its request and any retained body remain available; explicit resume can repeat this same read.');
    return store.checkpoint(path, manifest);
  }
  async function retainResponse(path, manifest, pending, response, keys) {
    need(response && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599, 'ACQUISITION_RESPONSE_STATUS_INVALID');
    need(comparableURL(response.url) === comparableURL(pending.request.url), 'ACQUISITION_RESPONSE_REQUEST_MISMATCH');
    need(response.body instanceof Uint8Array || typeof response.body === 'string', 'ACQUISITION_RESPONSE_BYTES_REQUIRED');
    const body = Buffer.from(response.body);
    need(body.length <= maxResponseBytes, 'ACQUISITION_RESPONSE_LIMIT_EXCEEDED');
    need(typeof response.capturedAt === 'string' && Number.isFinite(Date.parse(response.capturedAt)), 'ACQUISITION_CAPTURE_TIME_REQUIRED');
    const headers = responseHeaders(response.headers);
    const assessment = assessmentFor(manifest, { ...response, body, headers }, pending.request.page, keys);
    const capture = { id: pending.id, request: pending.request, sourceHash: manifest.sourceHash,
      requestHash: manifest.requestHash, status: response.status, headers, capturedAt: response.capturedAt,
      sha256: sha256(body), bytes: body.length, bodyFile: 'responses/' + pending.id + '.body',
      accepted: assessment.accepted, assessment, provenance: clean(response.provenance ?? { kind: 'native-http', origin: ORIGIN }) };
    if (response.sha256 !== undefined) need(response.sha256 === capture.sha256, 'ACQUISITION_IMPORTED_HASH_MISMATCH');
    await initializationDirectory(join(path, 'responses'), { create: true });
    await store.retain(join(path, capture.bodyFile), body);
    await store.retain(join(path, 'responses', capture.id + '.json'), jsonBytes(capture));
    return commitCapture(path, manifest, capture, body, keys);
  }

  const rateKey = manifest => ORIGIN + '\n' + (manifest.credentialEnv ?? 'public');
  async function sharedRetry(manifest) {
    return store.withRate(rateKey(manifest), async path => {
      const retained = await store.readJson(join(path, 'state.json'), true);
      return retained?.retryAt && Date.parse(retained.retryAt) > Date.now() ? retained.retryAt : null;
    });
  }
  async function retainRetry(manifest, response) {
    const at = retryTime(responseHeaders(response.headers), Date.parse(response.capturedAt));
    if (!at) return;
    await store.withRate(rateKey(manifest), async path => {
      const prior = await store.readJson(join(path, 'state.json'), true);
      if (!prior?.retryAt || Date.parse(prior.retryAt) < Date.parse(at)) await store.atomicJson(join(path, 'state.json'), {
        schema: 'starforge.blockworks-retry/v1', origin: ORIGIN, credentialEnv: manifest.credentialEnv,
        retryAt: at, recordedAt: now(), runId: manifest.id, status: response.status });
    });
  }
  async function run(id, { signal } = {}) {
    return store.withRun(id, async path => {
      let { manifest } = await verified(id);
      const keys = await existingKeys(manifest);
      manifest = await reconcilePending(path, manifest, keys);
      if (['completed', 'review_required'].includes(manifest.state)) return manifest;
      for (;;) {
        if (signal?.aborted) {
          manifest.state = 'paused'; manifest.problem = problem('read_paused', 'The operator paused acquisition before the next GET.');
          return store.checkpoint(path, manifest);
        }
        const retryAt = await sharedRetry(manifest);
        if (retryAt || (manifest.retryAt && Date.parse(manifest.retryAt) > Date.now())) {
          manifest.state = 'paused'; manifest.retryAt = retryAt ?? manifest.retryAt;
          manifest.problem = problem('provider_retry_after', 'The original provider Retry-After remains active for this credential reference.', { retryAt: manifest.retryAt });
          return store.checkpoint(path, manifest);
        }
        const headers = { accept: 'application/json' };
        if (manifest.credentialEnv !== null) {
          const value = process.env[manifest.credentialEnv];
          if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) {
            manifest.state = 'paused'; manifest.problem = problem('credential_environment_missing', 'Set the selected API key environment variable in this requesting process.', { credentialEnv: manifest.credentialEnv });
            return store.checkpoint(path, manifest);
          }
          headers['X-Blockworks-API-Key'] = value;
        }
        const pending = { id: 'capture-' + randomUUID(), startedAt: now(),
          request: { method: 'GET', url: requestURL(manifest.request, manifest.cursor.page), page: manifest.cursor.page }, kind: 'native-http' };
        manifest.pending = pending; manifest.state = 'running'; manifest.problem = null; manifest.retryAt = null;
        await store.checkpoint(path, manifest);
        let response;
        try { response = await send({ ...pending.request, headers, signal }); }
        catch (error) {
          manifest.attempts.push({ ...pending, endedAt: now(), disposition: signal?.aborted ? 'read_aborted' : 'transport_error',
            code: typeof error.code === 'string' ? error.code : 'NATIVE_READ_FAILED' });
          manifest.pending = null; manifest.state = 'paused';
          manifest.problem = problem(signal?.aborted ? 'read_aborted' : 'transport_error', signal?.aborted ?
            'The operator aborted the original GET; no complete response was retained.' :
            'The original native GET did not return a complete response. Resume retains completed pages and requests this same cursor.');
          return store.checkpoint(path, manifest);
        }
        manifest = await retainResponse(path, manifest, pending, response, keys);
        if (manifest.state !== 'ready') return manifest;
      }
    });
  }

  async function importResponse(id, response) {
    return store.withRun(id, async path => {
      let { manifest } = await verified(id);
      need(response && (response.body instanceof Uint8Array || typeof response.body === 'string'), 'ACQUISITION_RESPONSE_BYTES_REQUIRED');
      need(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599, 'ACQUISITION_RESPONSE_STATUS_INVALID');
      need(typeof response.capturedAt === 'string' && Number.isFinite(Date.parse(response.capturedAt)), 'ACQUISITION_CAPTURE_TIME_REQUIRED');
      clean(response.provenance ?? {});
      const body = Buffer.from(response.body);
      need(body.length <= maxResponseBytes, 'ACQUISITION_RESPONSE_LIMIT_EXCEEDED');
      const hash = sha256(body);
      if (response.sha256 !== undefined) need(response.sha256 === hash, 'ACQUISITION_IMPORTED_HASH_MISMATCH');
      const duplicate = manifest.captures.find(capture => capture.sha256 === hash && capture.status === response.status &&
        comparableURL(capture.request.url) === comparableURL(response.url));
      if (duplicate) { await readCapture(id, duplicate.id); return manifest; }
      const keys = await existingKeys(manifest);
      manifest = await reconcilePending(path, manifest, keys);
      const recoveredDuplicate = manifest.captures.find(capture => capture.sha256 === hash && capture.status === response.status &&
        comparableURL(capture.request.url) === comparableURL(response.url));
      if (recoveredDuplicate) { await retainedCapture(manifest, recoveredDuplicate.id); return manifest; }
      need(!['completed', 'review_required'].includes(manifest.state), 'ACQUISITION_IMPORT_STATE_CONFLICT',
        'This acquisition is complete or needs a new reviewed request; captured pages cannot be replaced.');
      const request = { method: 'GET', url: requestURL(manifest.request, manifest.cursor.page), page: manifest.cursor.page };
      need(comparableURL(response.url) === comparableURL(request.url), 'ACQUISITION_IMPORT_REQUEST_MISMATCH',
        'Import the exact selected native cursor, including original filters and window.');
      const pending = { id: 'capture-' + sha256(canonical({ request, status: response.status, sha256: hash })).slice(0, 48),
        startedAt: now(), request, kind: 'imported-response' };
      manifest.pending = pending; manifest.state = 'running'; manifest.problem = null;
      await store.checkpoint(path, manifest);
      manifest = await retainResponse(path, manifest, pending, response, keys);
      return manifest;
    });
  }

  async function readRows(id) {
    const manifest = await get(id);
    const rows = [], series = [], metadata = { pages: [], nativeErrors: [] };
    let pointSchema = null;
    for (const capture of manifest.captures) {
      const retained = await retainedCapture(manifest, capture.id);
      if (!capture.accepted) {
        metadata.nativeErrors.push({ captureId: capture.id, status: capture.status, problem: capture.assessment.problem });
        continue;
      }
      const document = JSON.parse(retained.body.toString('utf8').replace(/^\uFEFF/, ''));
      const native = interpret(manifest.request, document);
      rows.push(...native.rows); series.push(...native.series); pointSchema = native.pointSchema;
      metadata.pages.push({ captureId: capture.id, page: capture.request.page, ...native.metadata });
      if (native.metadata.catalog) metadata.catalog = native.metadata.catalog;
      if (native.metadata.matchedField !== undefined) metadata.matchedField = native.metadata.matchedField;
      if (native.metadata.window !== undefined) metadata.window = native.metadata.window;
    }
    return { kind: manifest.request.kind, rows, series, pointSchema, metadata, coverage: clean(manifest.coverage),
      complete: manifest.coverage.complete && manifest.state === 'completed', state: manifest.state, problem: manifest.problem,
      request: clean(manifest.request), requestHash: manifest.requestHash, source: clean(manifest.source), sourceHash: manifest.sourceHash };
  }

  async function exportRun(id, { directory: destination } = {}) {
    need(typeof destination === 'string' && resolve(destination) === destination && destination !== '/' &&
      destination !== directory && !destination.startsWith(directory + '/') && !directory.startsWith(destination + '/'),
      'ACQUISITION_EXPORT_DIRECTORY_INVALID');
    return store.withRun(id, async path => {
      const manifest = await get(id);
      const target = await openCaptureStore(destination, { python: store.python, maxResponseBytes });
      const lease = await acquireInitialization(destination, { python: store.python, resume: true });
      try {
        const indexPath = join(destination, 'export-intent.json');
        const index = { schema: 'starforge.blockworks-portable/v1', runId: id, fingerprint: manifest.fingerprint,
          manifestSha256: sha256(jsonBytes(manifest)) };
        const prior = await target.readJson(indexPath, true);
        if (prior) need(canonical(prior) === canonical(index), 'ACQUISITION_EXPORT_SNAPSHOT_CHANGED',
          'Resume the original export bytes or choose a new destination for this later acquisition state.');
        else {
          need((await readdir(destination)).every(name => ['runs', 'sources', 'rate', '.initialization.lock'].includes(name)), 'ACQUISITION_EXPORT_DESTINATION_NOT_EMPTY');
          need((await readdir(join(destination, 'runs'))).length === 0 &&
            (await readdir(join(destination, 'sources'))).length === 0, 'ACQUISITION_EXPORT_DESTINATION_NOT_EMPTY');
          await target.retain(indexPath, jsonBytes(index));
        }
        const targetRun = target.runDirectory(id);
        await initializationDirectory(targetRun, { create: true });
        const files = [
          { source: join(directory, 'sources', manifest.sourceHash + '.json'), target: join(destination, 'sources', manifest.sourceHash + '.json') },
          { source: join(path, 'intent.json'), target: join(targetRun, 'intent.json') },
          { source: join(path, 'manifest.json'), target: join(targetRun, 'manifest.json') }
        ];
        let responseNames = [];
        try { responseNames = await readdir(join(path, 'responses')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (responseNames.length) await initializationDirectory(join(targetRun, 'responses'), { create: true });
        for (const name of responseNames.sort()) {
          if (!/^capture-[a-z0-9-]+\.(?:body|json)$/.test(name)) continue;
          files.push({ source: join(path, 'responses', name), target: join(targetRun, 'responses', name) });
        }
        const exported = [];
        for (const file of files) {
          const body = await initializationBytes(file.source, maxResponseBytes);
          await target.retain(file.target, body);
          exported.push({ path: relative(destination, file.target), sha256: sha256(body), bytes: body.length });
        }
        const completion = { ...index, files: exported, complete: true };
        await target.retain(join(destination, 'export.json'), jsonBytes(completion));
        return { directory: destination, manifest, ...completion };
      } finally { await lease.close(); }
    });
  }
  return { directory, create, list, get, run, resume: run, importResponse, readRows, readCapture, exportRun };
}

