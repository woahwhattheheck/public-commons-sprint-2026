// MIT. One retained Census intake; existing publishers own release and buyer actions.
import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { bytes, digest, identity, readPrivate, readJson, createFile, atomicJson,
  privateDirectory, acquireWorkspace, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { CENSUS_API, MAX_INPUT_BYTES, MAX_RESPONSE_BYTES, COLUMNS, COORDINATE_MEANING,
  only, inputAddresses, metadata, parseBatchResponse, censusRequest } from './source.mjs';
import { reviewSelection, createEdition, reopenEdition, copyEdition, writeExact } from './edition.mjs';
import { readGeocoderRecording } from './recording.mjs';

const SCHEMA = 'stellar-forge.census-geocoder-workspace.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const clone = value => structuredClone(value);
const publicError = error => ({ code: typeof error.code === 'string' ? error.code : 'GEOCODER_OPERATION_FAILED', message: error.message });
async function absent(path) { try { await lstat(path); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; } }
function key(value) { if (typeof value !== 'string' || !UUID.test(value)) throw fault('GEOCODER_ID_REQUIRED'); return value; }
function text(value, name, limit = 128) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\x00-\x1f\x7f]/.test(value))
    throw fault('GEOCODER_TEXT_REQUIRED', 'Enter ' + name + '.');
  return value;
}
export async function openGeocoderWorkspace({ directory, create = false, fetch: fetcher = globalThis.fetch } = {}) {
  if (typeof directory !== 'string' || !directory) throw fault('GEOCODER_DIRECTORY_REQUIRED');
  directory = resolve(directory);
  const index = join(directory, 'workspace.json');
  if (create && !await absent(index)) throw fault('GEOCODER_WORKSPACE_EXISTS', 'Reopen this existing workspace.');
  await privateDirectory(directory, create); const release = await acquireWorkspace(directory);
  let state, active = null, closing = null, closed = false, publisher = null, publisherOpening = null;
  const pending = new Set();
  const save = async () => { state.updatedAt = stamp(); await atomicJson(directory, 'workspace.json', state); };
  const selected = (list, id, label) => {
    const entry = state[list].find(item => item.id === key(id));
    if (!entry) throw fault('GEOCODER_NOT_FOUND', 'Choose a retained ' + label + '.', 404);
    return entry;
  };
  const batchPath = id => join(directory, 'batches', key(id));
  const attemptPath = (id, attempt) => join(batchPath(id), 'attempts', key(attempt));
  async function retainedMetadata(id, kind) {
    const item = selected('metadata', id, 'selection list');
    if (item.kind !== kind || item.state !== 'COMPLETE') throw fault('GEOCODER_DISCOVERY_REQUIRED');
    const raw = await readPrivate(join(directory, 'metadata', item.id, 'response.json'), 1024 * 1024);
    const exchange = await readJson(join(directory, 'metadata', item.id, 'http.json'));
    if (digest(raw) !== item.exchange.sha256 || identity(exchange) !== identity(item.exchange))
      throw fault('GEOCODER_DISCOVERY_CHANGED');
    return { item, raw, parsed: metadata(raw, kind, item.benchmark) };
  }
  async function batchInputs(batch) {
    const original = await readPrivate(join(batchPath(batch.id), 'input.csv'), MAX_INPUT_BYTES);
    const submitted = await readPrivate(join(batchPath(batch.id), 'submitted.csv'), MAX_INPUT_BYTES);
    const input = inputAddresses(original, { header: batch.header });
    const declaration = await readJson(join(batchPath(batch.id), 'batch.json'));
    if (identity(declaration) !== identity({ id: batch.id, label: batch.label, createdAt: batch.createdAt,
      header: batch.header, selection: batch.selection, input: batch.input }) ||
      digest(original) !== batch.input.originalSha256 || digest(submitted) !== batch.input.submittedSha256 ||
      (batch.input.submission === 'retained' ? identity(input.records) !== identity(inputAddresses(submitted).records) : !submitted.equals(input.submitted)) || input.count !== batch.input.count)
      throw fault('GEOCODER_INPUT_CHANGED', 'The submitted address batch differs from its retained selection.');
    return { original, submitted, input };
  }
  async function retainedResponse(batch, attemptId = batch.currentAttempt ?? batch.attempts.at(-1)?.id) {
    const inputs = await batchInputs(batch);
    const attempt = batch.attempts.find(item => item.id === key(attemptId));
    if (!attempt?.exchange) throw fault('GEOCODER_RETAINED_RESPONSE_REQUIRED', 'This attempt did not retain an HTTP response.');
    const raw = await readPrivate(join(attemptPath(batch.id, attempt.id), 'response.csv'), MAX_RESPONSE_BYTES);
    const exchange = await readJson(join(attemptPath(batch.id, attempt.id), 'http.json'));
    const request = await readJson(join(attemptPath(batch.id, attempt.id), 'request.json'));
    if (digest(raw) !== attempt.exchange.sha256 || identity(exchange) !== identity(attempt.exchange) ||
      request.batchId !== batch.id || request.attemptId !== attempt.id ||
      request.submittedSha256 !== batch.input.submittedSha256 || identity(request.selection) !== identity(batch.selection) ||
      exchange.submittedSha256 !== batch.input.submittedSha256)
      throw fault('GEOCODER_RESPONSE_CHANGED', 'The retained response no longer belongs to its original request.');
    return { ...inputs, raw, exchange, attempt, request };
  }
  async function retainedBatch(batch, attemptId = batch.currentAttempt) {
    const response = await retainedResponse(batch, attemptId);
    if (response.attempt.state !== 'COMPLETE') throw fault('GEOCODER_COMPLETE_RESPONSE_REQUIRED', 'Select a completed original batch response.');
    const parsed = parseBatchResponse(response.raw, response.input.records, batch.selection.returnType);
    return { ...response, parsed };
  }
  async function recoverAttempt(batch, attempt) {
    const folder = attemptPath(batch.id, attempt.id);
    try {
      const exchange = await readJson(join(folder, 'http.json'));
      const raw = await readPrivate(join(folder, 'response.csv'), MAX_RESPONSE_BYTES);
      const input = await batchInputs(batch), request = await readJson(join(folder, 'request.json'));
      if (digest(raw) !== exchange.sha256 || exchange.submittedSha256 !== batch.input.submittedSha256 ||
          request.batchId !== batch.id || request.attemptId !== attempt.id ||
          request.submittedSha256 !== batch.input.submittedSha256 || identity(request.selection) !== identity(batch.selection))
        throw fault('GEOCODER_RETAINED_REQUEST_CHANGED');
      attempt.exchange = exchange;
      if (exchange.status !== 200) {
        attempt.state = 'PROVIDER_ERROR'; attempt.error = { code: 'CENSUS_HTTP_' + exchange.status,
          message: 'The original Census HTTP response is retained. Review it before an explicit retry.' };
      } else {
        const parsed = parseBatchResponse(raw, input.input.records, batch.selection.returnType);
        attempt.state = 'COMPLETE'; attempt.counts = parsed.counts; attempt.responseSha256 = parsed.responseSha256;
        attempt.error = null; batch.currentAttempt = attempt.id;
      }
    } catch (error) {
      attempt.state = error.code === 'ENOENT' ? 'INTERRUPTED' : 'RESPONSE_ERROR';
      attempt.error = publicError(error);
    }
    attempt.endedAt = stamp();
  }
  try {
    if (create) {
      for (const name of ['metadata', 'batches', 'reviews', 'editions']) await privateDirectory(join(directory, name), true);
      state = { schema: SCHEMA, id: randomUUID(), createdAt: stamp(), updatedAt: stamp(), metadata: [], batches: [], reviews: [], editions: [], imports: [] };
      await createFile(index, bytes(state)); await syncDirectory(directory);
    } else state = await readJson(index, 16 * 1024 * 1024);
    if (state.schema !== SCHEMA || !UUID.test(state.id) || ['metadata', 'batches', 'reviews', 'editions'].some(name => !Array.isArray(state[name])))
      throw fault('GEOCODER_WORKSPACE_INVALID');
    state.imports ??= [];
    if (!Array.isArray(state.imports)) throw fault('GEOCODER_WORKSPACE_INVALID');
    let recovered = false;
    for (const batch of state.batches) for (const attempt of batch.attempts) if (attempt.state === 'REQUESTING') {
      await recoverAttempt(batch, attempt); recovered = true;
    }
    for (const item of state.metadata) if (item.state === 'REQUESTING') {
      try {
        const folder = join(directory, 'metadata', item.id), raw = await readPrivate(join(folder, 'response.json'), 1024 * 1024);
        const exchange = await readJson(join(folder, 'http.json'));
        if (exchange.status !== 200 || digest(raw) !== exchange.sha256) throw fault('GEOCODER_DISCOVERY_RESPONSE');
        item.options = metadata(raw, item.kind, item.benchmark).options; item.exchange = exchange; item.state = 'COMPLETE'; item.error = null;
      } catch (error) { item.state = 'INTERRUPTED'; item.error = publicError(error); }
      recovered = true;
    }
    if (recovered) await save();
  } catch (error) { await release(); throw error; }

  function ensureOpen() { if (closed || closing) throw fault('GEOCODER_WORKSPACE_CLOSED'); }
  async function getPublisher() {
    if (publisher) return publisher;
    publisherOpening ??= (async () => {
      // This original shared implementation owns drafts, version IPC, SF82 and SF88.
      const { openSocrataPublisher } = await import('../socrata/publisher.mjs');
      return openSocrataPublisher({ directory: join(directory, 'publisher') });
    })();
    try { publisher = await publisherOpening; return publisher; } finally { publisherOpening = null; }
  }
  async function status({ includePublisher = true } = {}) {
    return { ...clone(state), directory, columns: clone(COLUMNS), coordinateMeaning: COORDINATE_MEANING,
      limits: { inputBytes: MAX_INPUT_BYTES, addresses: 10000, responseBytes: MAX_RESPONSE_BYTES },
      active: active ? { action: active.action, id: active.id, startedAt: active.startedAt } : null,
      publisher: includePublisher && publisher ? await publisher.state() : null };
  }
  async function inspectBatch(id, { attemptId, status: matchStatus = 'all', offset = 0, limit = 100 } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 250 ||
        !['all', 'Match', 'No_Match', 'Tie', 'Exact', 'Non_Exact'].includes(matchStatus)) throw fault('GEOCODER_REVIEW_PAGE');
    const batch = selected('batches', id, 'batch'), chosen = attemptId ?? batch.currentAttempt ?? batch.attempts.at(-1)?.id;
    if (!chosen) {
      const inputs = await batchInputs(batch);
      return { batch: clone(batch), response: null, inputPreview: inputs.input.records.slice(offset, offset + limit),
        total: inputs.input.count, offset, limit };
    }
    const attempt = batch.attempts.find(item => item.id === key(chosen));
    if (!attempt) throw fault('GEOCODER_NOT_FOUND', 'Choose a retained attempt.', 404);
    if (attempt.state !== 'COMPLETE') {
      const response = attempt.exchange ? await retainedResponse(batch, chosen) : null;
      return { batch: clone(batch), attempt: clone(attempt), responseState: attempt.state,
        responseSha256: response?.exchange.sha256 ?? null, rawAvailable: Boolean(response),
        inputPreview: (await batchInputs(batch)).input.records.slice(offset, offset + limit), offset, limit, total: batch.input.count };
    }
    const captured = await retainedBatch(batch, chosen);
    const rows = captured.parsed.rows.filter(row => matchStatus === 'all' || row.match_status === matchStatus || row.match_type === matchStatus);
    return { batch: clone(batch), attempt: clone(captured.attempt), counts: captured.parsed.counts,
      responseSha256: captured.parsed.responseSha256, rows: rows.slice(offset, offset + limit),
      total: rows.length, offset, limit, next: offset + limit < rows.length ? offset + limit : null,
      coordinateMeaning: COORDINATE_MEANING };
  }
  async function discover(input, kind) {
    only(input, kind === 'benchmarks' ? [] : ['discoveryId', 'benchmark']);
    let benchmark = null;
    if (kind === 'vintages') {
      const found = await retainedMetadata(input.discoveryId, 'benchmarks');
      benchmark = found.parsed.options.find(item => item.id === String(input.benchmark))?.id;
      if (!benchmark) throw fault('GEOCODER_BENCHMARK_SELECTION', 'Choose a benchmark from the retained official list.');
    }
    const id = randomUUID(), item = { id, kind, benchmark, state: 'REQUESTING', createdAt: stamp(), options: [], exchange: null };
    active.id = id; state.metadata.push(item); await privateDirectory(join(directory, 'metadata', id), true); await save();
    try {
      const response = await censusRequest('/' + kind, { benchmark, fetch: fetcher, signal: active.controller.signal });
      await createFile(join(directory, 'metadata', id, 'response.json'), response.bytes);
      await createFile(join(directory, 'metadata', id, 'http.json'), bytes(response.exchange));
      await syncDirectory(join(directory, 'metadata', id)); item.exchange = response.exchange;
      if (response.exchange.status !== 200) throw fault('CENSUS_HTTP_' + response.exchange.status, 'Official Census metadata returned HTTP ' + response.exchange.status + '.');
      item.options = metadata(response.bytes, kind, benchmark).options; item.state = 'COMPLETE'; item.error = null;
      await save(); return clone(item);
    } catch (error) { item.state = active.controller.signal.aborted ? 'INTERRUPTED' : 'FAILED'; item.error = publicError(error); await save(); throw error; }
  }
  async function createBatch(input) {
    only(input, ['label', 'inputText', 'header', 'discoveryId', 'vintagesId', 'benchmark', 'vintage', 'returnType']);
    const label = text(input.label, 'a batch label');
    if (typeof input.inputText !== 'string') throw fault('GEOCODER_INPUT_CSV', 'Select the original address CSV.');
    const original = Buffer.from(input.inputText, 'utf8'), parsed = inputAddresses(original, { header: input.header ?? false });
    const discovered = await retainedMetadata(input.discoveryId, 'benchmarks');
    const benchmark = discovered.parsed.options.find(item => item.id === String(input.benchmark));
    const returnType = input.returnType ?? 'geographies';
    if (!benchmark || !['locations', 'geographies'].includes(returnType)) throw fault('GEOCODER_BENCHMARK_SELECTION');
    let vintage = null, vintages = null;
    if (returnType === 'geographies') {
      vintages = await retainedMetadata(input.vintagesId, 'vintages');
      if (vintages.item.benchmark !== benchmark.id) throw fault('GEOCODER_VINTAGE_BENCHMARK');
      vintage = vintages.parsed.options.find(item => item.id === String(input.vintage));
      if (!vintage) throw fault('GEOCODER_VINTAGE_SELECTION', 'Choose a vintage belonging to the selected benchmark.');
    } else if (input.vintage !== undefined && input.vintage !== null && input.vintage !== '') throw fault('GEOCODER_LOCATIONS_VINTAGE');
    const id = randomUUID(), folder = batchPath(id);
    const batch = { id, label, createdAt: stamp(), header: input.header ?? false,
      selection: { returnType, benchmark: clone(benchmark), vintage: vintage ? clone(vintage) : null,
        discoveryId: discovered.item.id, discoverySha256: discovered.item.exchange.sha256,
        vintagesId: vintages?.item.id ?? null, vintagesSha256: vintages?.item.exchange.sha256 ?? null,
        endpoint: CENSUS_API + '/' + returnType + '/addressbatch' },
      input: { count: parsed.count, originalSha256: parsed.originalSha256, submittedSha256: parsed.submittedSha256,
        originalBytes: parsed.originalBytes, submittedBytes: parsed.submittedBytes },
      attempts: [], currentAttempt: null };
    await privateDirectory(folder, true); await privateDirectory(join(folder, 'attempts'), true);
    await createFile(join(folder, 'input.csv'), original); await createFile(join(folder, 'submitted.csv'), parsed.submitted);
    const { attempts, currentAttempt, ...declaration } = batch;
    await createFile(join(folder, 'batch.json'), bytes(declaration)); await syncDirectory(folder);
    state.batches.push(batch); await save(); return clone(batch);
  }
  async function capture(input) {
    only(input, ['batchId', 'retry', 'timeoutMs']);
    const batch = selected('batches', input.batchId, 'batch'), previous = batch.attempts.at(-1);
    if (previous && input.retry !== true) {
      if (previous.state === 'COMPLETE') return inspectBatch(batch.id, { attemptId: previous.id });
      throw fault('GEOCODER_RETRY_REVIEW', 'The prior attempt is retained. Explicitly select Retry to request Census again.');
    }
    if (previous?.state === 'COMPLETE') throw fault('GEOCODER_CAPTURE_COMPLETE', 'This batch already has its captured response. Create a new batch to request a new observation.');
    const inputs = await batchInputs(batch), id = randomUUID(), folder = attemptPath(batch.id, id);
    const attempt = { id, state: 'REQUESTING', startedAt: stamp(), endedAt: null, exchange: null, error: null };
    await privateDirectory(folder, true);
    const request = { schema: 'stellar-forge.census-geocoder-request.v1', batchId: batch.id, attemptId: id,
      submittedSha256: batch.input.submittedSha256, selection: batch.selection, startedAt: attempt.startedAt };
    await createFile(join(folder, 'request.json'), bytes(request)); await syncDirectory(folder);
    batch.attempts.push(attempt); active.id = id; await save();
    try {
      const response = await censusRequest('/' + batch.selection.returnType + '/addressbatch', {
        method: 'POST', submitted: inputs.submitted, benchmark: batch.selection.benchmark.id,
        vintage: batch.selection.vintage?.id, signal: active.controller.signal,
        timeoutMs: input.timeoutMs ?? 300000, fetch: fetcher });
      await createFile(join(folder, 'response.csv'), response.bytes);
      await createFile(join(folder, 'http.json'), bytes(response.exchange)); await syncDirectory(folder);
      await recoverAttempt(batch, attempt); await save();
      if (attempt.state !== 'COMPLETE') throw fault(attempt.error.code, attempt.error.message, 502);
      return inspectBatch(batch.id, { attemptId: id });
    } catch (error) {
      if (attempt.state === 'REQUESTING') {
        await recoverAttempt(batch, attempt);
        if (attempt.state === 'INTERRUPTED') attempt.error = publicError(error);
        await save();
      }
      throw error;
    }
  }

  async function importRecording(input) {
    only(input, ['directory']);
    const original = await readGeocoderRecording(input.directory);
    let transaction = state.imports.find(item => item.recordingSha256 === original.recordingSha256);
    if (transaction?.state === 'COMPLETE') return inspectBatch(transaction.batchId, { attemptId: transaction.attemptId });
    if (!transaction) {
      transaction = { id: randomUUID(), recordingSha256: original.recordingSha256, createdAt: stamp(), state: 'PREPARING',
        batchId: randomUUID(), attemptId: randomUUID(), discoveryId: randomUUID(),
        vintagesId: original.vintage ? randomUUID() : null };
      state.imports.push(transaction); await save();
    }
    active.id = transaction.id;
    const retainMetadata = async (kind, id) => {
      const observed = original.options[kind], folder = join(directory, 'metadata', id);
      await privateDirectory(folder, true);
      await writeExact(join(folder, 'response.json'), observed.raw);
      await writeExact(join(folder, 'http.json'), observed.httpBytes); await syncDirectory(folder);
      const item = { id, kind, benchmark: kind === 'vintages' ? original.benchmark.id : null,
        state: 'COMPLETE', createdAt: transaction.createdAt, options: observed.parsed.options,
        exchange: observed.http, error: null, importedCapture: original.recordingSha256 };
      const existing = state.metadata.find(value => value.id === id);
      if (existing && identity(existing) !== identity(item)) throw fault('GEOCODER_IMPORT_CHANGED');
      if (!existing) state.metadata.push(item);
      return item;
    };
    const discovered = await retainMetadata('benchmarks', transaction.discoveryId);
    const vintages = transaction.vintagesId ? await retainMetadata('vintages', transaction.vintagesId) : null;
    const folder = batchPath(transaction.batchId), attemptFolder = attemptPath(transaction.batchId, transaction.attemptId);
    await privateDirectory(folder, true); await privateDirectory(join(folder, 'attempts'), true);
    await privateDirectory(attemptFolder, true);
    await writeExact(join(folder, 'input.csv'), original.originals['input.csv']);
    await writeExact(join(folder, 'submitted.csv'), original.originals['submitted.csv']);
    await writeExact(join(folder, 'capture.json'), original.originals['capture.json']);
    const declaration = { id: transaction.batchId, label: original.manifest.label, createdAt: transaction.createdAt,
      header: original.manifest.header,
      selection: { returnType: original.manifest.returnType, benchmark: clone(original.benchmark),
        vintage: original.vintage ? clone(original.vintage) : null, discoveryId: discovered.id,
        discoverySha256: discovered.exchange.sha256, vintagesId: vintages?.id ?? null,
        vintagesSha256: vintages?.exchange.sha256 ?? null,
        endpoint: CENSUS_API + '/' + original.manifest.returnType + '/addressbatch' },
      input: { count: original.input.count, originalSha256: digest(original.originals['input.csv']),
        submittedSha256: digest(original.originals['submitted.csv']), originalBytes: original.originals['input.csv'].length,
        submittedBytes: original.originals['submitted.csv'].length, submission: 'retained',
        importedCapture: original.recordingSha256 } };
    await writeExact(join(folder, 'batch.json'), bytes(declaration));
    const request = { schema: 'stellar-forge.census-geocoder-request.v1',
      batchId: transaction.batchId, attemptId: transaction.attemptId,
      submittedSha256: declaration.input.submittedSha256, selection: declaration.selection,
      startedAt: original.http.startedAt, transport: 'IMPORTED_ORIGINAL_HTTP',
      importedAt: transaction.createdAt, captureSha256: original.recordingSha256 };
    await writeExact(join(attemptFolder, 'request.json'), bytes(request));
    await writeExact(join(attemptFolder, 'response.csv'), original.originals['response.csv']);
    await writeExact(join(attemptFolder, 'http.json'), original.originals['http.json']);
    await syncDirectory(attemptFolder); await syncDirectory(folder);
    let batch = state.batches.find(value => value.id === transaction.batchId);
    if (!batch) { batch = { ...declaration, attempts: [], currentAttempt: null }; state.batches.push(batch); }
    else if (identity({ id: batch.id, label: batch.label, createdAt: batch.createdAt, header: batch.header,
      selection: batch.selection, input: batch.input }) !== identity(declaration)) throw fault('GEOCODER_IMPORT_CHANGED');
    let attempt = batch.attempts.find(value => value.id === transaction.attemptId);
    if (!attempt) {
      attempt = { id: transaction.attemptId, state: 'REQUESTING', startedAt: original.http.startedAt,
        endedAt: null, exchange: null, error: null, importedCapture: original.recordingSha256 };
      batch.attempts.push(attempt);
    }
    await recoverAttempt(batch, attempt);
    if (attempt.state !== 'COMPLETE') { await save(); throw fault(attempt.error.code, attempt.error.message); }
    transaction.state = 'COMPLETE'; await save();
    return inspectBatch(batch.id, { attemptId: attempt.id });
  }

  async function review(input) {
    only(input, ['batchId', 'attemptId', 'responseSha256', 'plan']);
    const batch = selected('batches', input.batchId, 'batch'), captured = await retainedBatch(batch, input.attemptId);
    if (captured.parsed.responseSha256 !== input.responseSha256) throw fault('GEOCODER_REVIEW_CHANGED');
    const value = reviewSelection(input.plan, captured.parsed);
    const saved = { id: randomUUID(), createdAt: stamp(), batchId: batch.id, attemptId: captured.attempt.id,
      responseSha256: captured.parsed.responseSha256, ...value };
    await createFile(join(directory, 'reviews', saved.id + '.json'), bytes(saved));
    state.reviews.push(saved); await save(); return clone(saved);
  }
  async function build(input) {
    only(input, ['reviewId', 'payment', 'origin', 'path']);
    const saved = selected('reviews', input.reviewId, 'review'), exact = await readJson(join(directory, 'reviews', saved.id + '.json'));
    if (identity(saved) !== identity(exact)) throw fault('GEOCODER_REVIEW_CHANGED');
    const batch = selected('batches', saved.batchId, 'batch'), captured = await retainedBatch(batch, saved.attemptId);
    const binding = identity({ reviewId: saved.id, payment: input.payment ?? null, origin: input.origin ?? null, path: input.path ?? '/geocodes' });
    let previous = state.editions.find(item => item.binding === binding);
    if (previous?.state === 'COMPLETE') return { id: previous.id, ...await reopenEdition(join(directory, 'editions', previous.id)) };
    if (!previous) {
      previous = { id: randomUUID(), binding, reviewId: saved.id, createdAt: stamp(), state: 'BUILDING', hasSeller: input.payment !== undefined };
      state.editions.push(previous); await save();
    }
    const id = previous.id, originals = {
      'batch.json': await readPrivate(join(batchPath(batch.id), 'batch.json')),
      'input.csv': captured.original, 'submitted.csv': captured.submitted,
      'response.csv': captured.raw, 'http.json': bytes(captured.exchange), 'request.json': bytes(captured.request)
    };
    if (batch.input.importedCapture)
      originals['capture.json'] = await readPrivate(join(batchPath(batch.id), 'capture.json'), 65536);
    for (const [prefix, metadataId] of [['benchmarks', batch.selection.discoveryId], ['vintages', batch.selection.vintagesId]]) {
      if (!metadataId) continue;
      originals[prefix + '.json'] = await readPrivate(join(directory, 'metadata', metadataId, 'response.json'), 1024 * 1024);
      originals[prefix + '-http.json'] = await readPrivate(join(directory, 'metadata', metadataId, 'http.json'));
    }
    try {
      const result = await createEdition({ directory: join(directory, 'editions', id), batch, attempt: captured.attempt,
        review: saved, captured: captured.parsed, originals, payment: input.payment, origin: input.origin, path: input.path });
      Object.assign(previous, { state: 'COMPLETE', dataset: result.dataset, operationId: result.operationId,
        hasSeller: Boolean(result.sellerPath), error: null }); await save();
      return { id, ...result };
    } catch (error) { previous.state = 'INCOMPLETE'; previous.error = publicError(error); await save(); throw error; }
  }
  async function dispatch(action, input) {
    if (action === 'discovery.benchmarks') return discover(input, 'benchmarks');
    if (action === 'discovery.vintages') return discover(input, 'vintages');
    if (action === 'batch.create') return createBatch(input);
    if (action === 'capture.import') return importRecording(input);
    if (action === 'batch.capture') return capture(input);
    if (action === 'batch.review') return review(input);
    if (action === 'edition.build') return build(input);
    if (action === 'edition.export') {
      only(input, ['id', 'directory']); const edition = selected('editions', input.id, 'edition');
      return copyEdition(join(directory, 'editions', edition.id), input.directory);
    }
    if (action === 'edition.query') {
      only(input, ['id', 'query']); const edition = selected('editions', input.id, 'edition');
      const reopened = await reopenEdition(join(directory, 'editions', edition.id));
      const native = await loadDatasetConfig(reopened.datasetPath);
      if (typeof input.query !== 'string' || input.query.length > 8192) throw fault('GEOCODER_QUERY');
      return native.handle({ query: new URLSearchParams(input.query) });
    }
    if (action === 'publisher.open') { only(input, []); return (await getPublisher()).state(); }
    if (action === 'publisher.prepareEdition') {
      only(input, ['id']); const edition = selected('editions', input.id, 'edition');
      const original = await reopenEdition(join(directory, 'editions', edition.id));
      if (!original.sellerPath) throw fault('GEOCODER_MERCHANT_REQUIRED', 'Build the reviewed edition with the operator public payment terms first.');
      return (await getPublisher()).act('publisher.prepare', { exportDirectory: original.directory });
    }
    if (action.startsWith('publisher.')) {
      if (action === 'publisher.prepare') throw fault('GEOCODER_EDITION_SELECTION', 'Choose a retained geocoder edition.');
      return (await getPublisher()).act(action, input);
    }
    throw fault('GEOCODER_ACTION_UNKNOWN', 'Choose an available workspace action.', 404);
  }
  async function act(action, input = {}) {
    if (action === 'operation.cancel') {
      only(input, []); if (!active || !['discovery.benchmarks', 'discovery.vintages', 'batch.capture'].includes(active.action))
        throw fault('GEOCODER_CAPTURE_NOT_ACTIVE');
      active.controller.abort(); return { cancelling: active.id, action: active.action };
    }
    if (active) throw fault('GEOCODER_WORKSPACE_BUSY', 'The current operation is still running.', 409);
    const operation = { action, id: null, controller: new AbortController(), startedAt: stamp(), promise: null };
    active = operation;
    operation.promise = Promise.resolve().then(() => dispatch(action, input)).finally(() => { if (active === operation) active = null; });
    return operation.promise;
  }
  async function download(kind, id) {
    if (kind.startsWith('publisher:')) return (await getPublisher()).readExport(kind.slice(10), id);
    if (['input', 'response'].includes(kind)) {
      const batch = selected('batches', id, 'batch');
      if (kind === 'input') return { bytes: (await batchInputs(batch)).original, filename: 'addresses-' + batch.id + '.csv', contentType: 'text/csv; charset=utf-8' };
      const captured = await retainedResponse(batch);
      return { bytes: captured.raw, filename: 'census-response-' + captured.attempt.id + (captured.attempt.state === 'COMPLETE' ? '.csv' : '.txt'),
        contentType: captured.exchange.contentType ?? 'application/octet-stream' };
    }
    const edition = selected('editions', id, 'edition'), root = join(directory, 'editions', edition.id);
    await reopenEdition(root);
    const names = { dataset: ['dataset.csv', 'text/csv; charset=utf-8'], provenance: ['source.json', 'application/json'],
      seller: ['seller.json', 'application/json'], manifest: ['edition.json', 'application/json'] };
    if (!names[kind]) throw fault('GEOCODER_DOWNLOAD_KIND');
    const [name, contentType] = names[kind];
    return { bytes: await readPrivate(join(root, name), 64 * 1024 * 1024), filename: name, contentType };
  }
  const track = fn => (...args) => {
    ensureOpen(); const task = Promise.resolve().then(() => fn(...args)); pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => {}); return task;
  };
  return { directory, status: track(status), inspectBatch: track(inspectBatch), act: track(act), download: track(download),
    close() {
      closing ??= (async () => {
        const current = active;
        if (current && ['discovery.benchmarks', 'discovery.vintages', 'batch.capture'].includes(current.action)) current.controller.abort();
        try { await Promise.allSettled([...pending, ...(current?.promise ? [current.promise] : [])]);
          if (publisherOpening) publisher = await publisherOpening; }
        finally {
          try { await publisher?.close(); } finally { closed = true; await release(); }
        }
      })();
      return closing;
    }
  };
}
