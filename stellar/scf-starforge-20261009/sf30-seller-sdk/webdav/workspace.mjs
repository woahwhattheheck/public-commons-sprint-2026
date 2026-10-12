// MIT. Source-specific authoring; the original Socrata publisher owns all merchant state.
import { constants } from 'node:fs';
import { mkdir, open, copyFile, lstat, readdir } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, acquireWorkspace, readJson, readPrivate, hashPrivate, createFile, atomicJson, syncDirectory } from '../postgres/publisher/files.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { openSocrataPublisher } from '../socrata/publisher.mjs';
import { readDatasetSourceFiles } from '../../sf82-seller-pilot/release-dataset.mjs';
import { openWebDavSource, buildDatasetEdition } from './source.mjs';
import { listCaptures, readCapture } from './capture.mjs';
import { exportSourcePacket, inspectSourcePacket } from './packet.mjs';
import { fail, exact, ID, validateSource, validateProjection, projectionDocument, requiredEnvironment,
  identity, sha256, jsonBytes, clone, now, text, integer } from './config.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.webdav-workspace.v1';
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const safeId = id => { if (!ID.test(id ?? '')) fail('WEBDAV_ID', 'Select a retained original UUID.'); return id; };
const safeError = error => ({ code: error.code ?? 'WEBDAV_OPERATION_FAILED', message: error.message ?? 'The operation did not complete.' });
async function immutable(path, value) {
  const content = jsonBytes(value);
  try { await createFile(path, content); }
  catch (error) { if (error.code !== 'EEXIST') throw error;
    if (!(await readPrivate(path, Math.max(1048576, content.length))).equals(content)) fail('WEBDAV_SAVED_BYTES_CHANGED', 'The saved original record has changed.', 409); }
}
async function copied(source, destination, expected) {
  if (!await exists(destination)) {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    const file = await open(destination, constants.O_RDWR | constants.O_NOFOLLOW);
    try { await file.chmod(0o600); await file.sync(); } finally { await file.close(); }
  }
  const actual = await hashPrivate(destination, 268435456);
  if (actual.hash !== expected.hash || actual.bytes !== expected.bytes) fail('WEBDAV_EXPORT_CHANGED', 'The exported bytes differ from their original retained source.', 409);
  return actual;
}
export async function openWebDavWorkspace({ directory, environment = process.env, python = 'python3' } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/')
    fail('WEBDAV_WORKSPACE_DIRECTORY', 'Use a normalized absolute private workspace directory.');
  await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory), sources = new Map(), publishers = new Map(), active = new Map();
  let tail = Promise.resolve(), closing = null, closed = false;
  const root = name => join(directory, name);
  async function stored() {
    const value = await readJson(root('workspace.json'), 16777216);
    if (value.schema !== WORKSPACE_SCHEMA || !ID.test(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        ['sources', 'mappings', 'editions', 'exports', 'merchants', 'products', 'operations'].some(key => !Array.isArray(value[key])))
      fail('WEBDAV_WORKSPACE_STATE', 'The saved source workspace is invalid.', 409);
    return value;
  }
  async function commit(value) { value.revision++; value.updatedAt = now(); await atomicJson(directory, 'workspace.json', value); return value; }
  async function sourceRecord(sourceId, current) {
    const value = current ?? await stored(), record = value.sources.find(item => item.id === safeId(sourceId));
    if (!record) fail('WEBDAV_SOURCE_NOT_FOUND', 'Select a retained source revision.', 404);
    const content = await readPrivate(join(root('sources'), record.id + '.json'), 1048576);
    if (sha256(content) !== record.fileSha256) fail('WEBDAV_SOURCE_REVISION_CHANGED', 'The saved source declaration has changed.', 409);
    const source = validateSource(JSON.parse(content));
    if (identity(source) !== record.sourceHash) fail('WEBDAV_SOURCE_REVISION_CHANGED', 'The saved source declaration has changed.', 409);
    return { ...record, source };
  }
  async function sourceFor(sourceId) {
    const selected = await sourceRecord(sourceId);
    if (!sources.has(selected.sourceHash)) sources.set(selected.sourceHash, openWebDavSource({
      directory: join(root('cache'), selected.sourceHash), source: selected.source, environment, python,
    }));
    try { return await sources.get(selected.sourceHash); }
    catch (error) { sources.delete(selected.sourceHash); throw error; }
  }
  async function captures(current) {
    const value = current ?? await stored(), result = [], seen = new Set();
    for (const item of value.sources.slice().reverse()) {
      if (seen.has(item.sourceHash)) continue; seen.add(item.sourceHash);
      const path = join(root('cache'), item.sourceHash, 'captures');
      if (!await exists(path)) continue;
      result.push(...(await listCaptures(path)).map(record => ({ ...record, sourceId: item.id })));
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function captureRecord(id, { verify = true } = {}) {
    const list = await captures(), selected = list.find(item => item.id === safeId(id));
    if (!selected) fail('WEBDAV_CAPTURE_NOT_FOUND', 'Select a retained source capture.', 404);
    const record = await readCapture(join(root('cache'), selected.sourceHash, 'captures'), id, { verify });
    return { ...record, sourceId: selected.sourceId, sourceHash: selected.sourceHash };
  }
  async function mappingRecord(id) {
    const current = await stored(), item = current.mappings.find(row => row.id === safeId(id));
    if (!item) fail('WEBDAV_MAPPING_NOT_FOUND', 'Select a saved public projection.', 404);
    const raw = await readPrivate(join(root('mappings'), id + '.json'), 1048576);
    if (sha256(raw) !== item.sha256) fail('WEBDAV_MAPPING_CHANGED', 'The original saved projection has changed.', 409);
    return JSON.parse(raw);
  }
  async function editionRecord(id) {
    const current = await stored(), item = current.editions.find(row => row.id === safeId(id));
    if (!item) fail('WEBDAV_EDITION_NOT_FOUND', 'Select a retained dataset edition.', 404);
    const path = join(root('editions'), id), record = await readJson(join(path, 'edition.json'));
    const native = await loadDatasetConfig(join(path, 'dataset.json')), actual = await hashPrivate(join(path, 'dataset.csv'), 268435456);
    if (native.describe().snapshot !== item.dataset.snapshot || actual.hash !== item.csvSha256 || actual.bytes !== item.csvBytes ||
        record.intentSha256 !== item.intentSha256) fail('WEBDAV_EDITION_CHANGED', 'The edition differs from its original native dataset.', 409);
    return { ...item, directory: path, native };
  }
  async function publisherFor(id, create = false) {
    safeId(id);
    const path = join(root('publishers'), id);
    if (!create && !await exists(join(path, 'drafts'))) return null;
    if (!publishers.has(id)) publishers.set(id, openSocrataPublisher({ directory: path }));
    try { return await publishers.get(id); } catch (error) { publishers.delete(id); throw error; }
  }
  async function inspect() {
    const value = await stored(), selected = value.activeSourceId ? await sourceRecord(value.activeSourceId, value) : null;
    const required = selected ? requiredEnvironment(selected.source) : [];
    return { ...value, directory, source: selected?.source ?? null,
      environment: required.map(name => ({ name, configured: typeof environment[name] === 'string' && environment[name].length > 0 })),
      captures: await captures(value), running: [...active].map(([id, entry]) => ({ id, action: entry.action, startedAt: entry.startedAt })),
      operations: value.operations.slice(-100).reverse() };
  }
  async function preview({ editionId, query = '' }) {
    text(query, 8192, 'the original dataset query', true);
    const edition = await editionRecord(editionId), context = { query: new URLSearchParams(query.replace(/^\?/, '')) };
    const admission = await edition.native.admit(context);
    return { editionId, snapshot: edition.dataset.snapshot, ...(admission === true ? await edition.native.handle(context) : admission) };
  }
  async function dispatch(action, input, operation, signal) {
    const current = await stored(), sourceId = operation.sourceId;
    switch (action) {
      case 'source.save': {
        exact(input, ['source'], action);
        const source = validateSource(input.source), bytes = jsonBytes(source);
        await immutable(join(root('sources'), operation.id + '.json'), source);
        const record = { id: operation.id, createdAt: operation.createdAt, sourceHash: identity(source), fileSha256: sha256(bytes), rootUrl: source.connection.rootUrl };
        for (const suffix of ['', 'captures', 'listings']) await privateDirectory(join(root('cache'), record.sourceHash, suffix), true);
        return { result: record, apply: value => { if (!value.sources.some(x => x.id === record.id)) value.sources.push(record); value.activeSourceId = record.id; } };
      }
      case 'source.catalogue': {
        exact(input, ['href', 'depth', 'limit', 'offset'], action);
        if (!sourceId) fail('WEBDAV_SOURCE_REQUIRED', 'Save a source connection first.');
        const source = await sourceFor(sourceId), result = await source.catalogue({ ...input, signal });
        return { result, apply: value => { value.lastListing = { id: result.id, sourceId, sourceHash: identity(source.config), href: result.href, capturedAt: result.capturedAt }; } };
      }
      case 'capture.start': {
        exact(input, ['selection'], action);
        if (!sourceId) fail('WEBDAV_SOURCE_REQUIRED', 'Save a source connection first.');
        const result = await (await sourceFor(sourceId)).captureFile(input.selection, { signal });
        const { path, ...receipt } = result; return { result: receipt };
      }
      case 'capture.resume': {
        exact(input, ['captureId'], action);
        const original = await captureRecord(input.captureId, { verify: false });
        const result = await (await sourceFor(original.sourceId)).captureFile(original.intent.selection, { signal });
        const { path, ...receipt } = result; return { result: receipt };
      }
      case 'capture.sample': {
        exact(input, ['captureId', 'format', 'recordsPointer', 'limit'], action);
        const record = await captureRecord(input.captureId, { verify: false });
        return { result: await (await sourceFor(record.sourceId)).sampleFile({ ...input, signal }) };
      }
      case 'mapping.save': {
        exact(input, ['captureId', 'expectedCaptureSha256', 'projection'], action);
        const captured = await captureRecord(input.captureId);
        if (!captured.receipt || captured.receipt.sha256 !== input.expectedCaptureSha256) fail('WEBDAV_REVIEW_CHANGED', 'Select and review the completed original capture.', 409);
        const projection = projectionDocument(validateProjection(input.projection)), record = {
          id: operation.id, createdAt: operation.createdAt, captureId: input.captureId, sourceId: captured.sourceId,
          captureSha256: captured.receipt.sha256, projection, projectionHash: identity(projection),
        };
        await immutable(join(root('mappings'), record.id + '.json'), record);
        return { result: record, apply: value => { if (!value.mappings.some(x => x.id === record.id)) value.mappings.push({ ...record, sha256: sha256(jsonBytes(record)) }); } };
      }
      case 'edition.build': {
        exact(input, ['mappingId', 'dataset', 'review'], action);
        const mapping = await mappingRecord(input.mappingId), captured = await captureRecord(mapping.captureId);
        if (!captured.receipt || captured.receipt.sha256 !== mapping.captureSha256) fail('WEBDAV_REVIEW_CHANGED', 'The original mapping and capture differ.', 409);
        const built = await buildDatasetEdition({ capture: captured.receipt, projection: mapping.projection, dataset: input.dataset,
          review: input.review, destination: join(root('editions'), operation.id), signal });
        const { directory: unused, ...edition } = built, record = { id: operation.id, mappingId: mapping.id, sourceId: mapping.sourceId, ...edition };
        return { result: record, apply: value => { if (!value.editions.some(x => x.id === record.id)) value.editions.push(record); } };
      }
      case 'merchant.save': {
        exact(input, ['editionId', 'origin', 'path', 'payment', 'reviewer', 'note'], action);
        text(input.reviewer, 160, 'the merchant reviewer'); text(input.note ?? '', 4000, 'the merchant note', true);
        const edition = await editionRecord(input.editionId);
        await buildDatasetSellerConfig(edition.native, { origin: input.origin, path: input.path, payment: input.payment });
        const record = { id: operation.id, createdAt: operation.createdAt, origin: input.origin, path: input.path,
          payment: clone(input.payment), reviewer: input.reviewer, note: input.note ?? '' };
        await immutable(join(root('merchants'), record.id + '.json'), record);
        return { result: record, apply: value => { if (!value.merchants.some(x => x.id === record.id)) value.merchants.push(record); value.activeMerchantId = record.id; } };
      }
      case 'edition.export': {
        exact(input, ['editionId', 'merchantId', 'reviewer', 'note'], action);
        text(input.reviewer, 160, 'the export reviewer'); text(input.note ?? '', 4000, 'the export note', true);
        const edition = await editionRecord(input.editionId), merchant = current.merchants.find(x => x.id === safeId(input.merchantId));
        if (!merchant) fail('WEBDAV_MERCHANT_REQUIRED', 'Save and select original public merchant terms.');
        const seller = await buildDatasetSellerConfig(edition.native, { origin: merchant.origin, path: merchant.path, payment: merchant.payment });
        const location = join(root('exports'), operation.id); await privateDirectory(location, true);
        const files = [];
        for (const name of ['dataset.csv', 'dataset.json']) {
          const original = join(edition.directory, name), expected = await hashPrivate(original, 268435456);
          const actual = await copied(original, join(location, name), expected);
          files.push({ path: name, bytes: actual.bytes, sha256: actual.hash });
        }
        // The original shared publisher now accepts an explicit sourceFiles closure.
        // Preserve original provider/edition bytes beside the derived public inputs.
        const mapping = await mappingRecord(edition.mappingId), captured = await captureRecord(mapping.captureId);
        if (captured.receipt.sha256 !== mapping.captureSha256)
          fail('WEBDAV_SOURCE_CHANGED', 'The reviewed mapping no longer matches its completed original capture.', 409);
        const selectedSource = await sourceRecord(captured.sourceId), sourceFiles = [];
        const retain = async (original, name) => {
          const destination = join(location, name);
          await privateDirectory(dirname(destination), true);
          const actual = await copied(original, destination, await hashPrivate(original, 268435456));
          sourceFiles.push({ path: name, bytes: actual.bytes, sha256: actual.hash });
        };
        await retain(join(root('sources'), selectedSource.id + '.json'), 'webdav/source.json');
        await retain(join(root('mappings'), mapping.id + '.json'), 'webdav/mapping.json');
        await retain(join(root('merchants'), merchant.id + '.json'), 'webdav/merchant.json');
        const captureDirectory = join(root('cache'), captured.sourceHash, 'captures', mapping.captureId);
        for (const name of (await readdir(captureDirectory)).sort()) {
          if (['intent.json', 'progress.json', 'transfer.json', 'receipt.json', 'body.bin'].includes(name) ||
              /^uncheckpointed-[a-f0-9-]{36}\.bin$/.test(name))
            await retain(join(captureDirectory, name), 'webdav/capture/' + name);
        }
        for (const name of ['intent.json', 'schema.csv', 'dataset.csv', 'dataset.json', 'source.json', 'edition.json'])
          await retain(join(edition.directory, name), 'webdav/edition/' + name);
        const listingDirectory = join(root('cache'), captured.sourceHash, 'listings');
        if (await exists(listingDirectory)) for (const name of (await readdir(listingDirectory)).sort()) {
          if (/^[a-f0-9-]{36}\.(?:xml|json)$/.test(name))
            await retain(join(listingDirectory, name), 'webdav/listings/' + name);
        }
        sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
        await readDatasetSourceFiles(location, { sourceFiles });
        const originalSource = await readJson(join(edition.directory, 'source.json'), 1048576);
        const sourceBytes = jsonBytes({ ...originalSource, sourceFiles });
        await immutable(join(location, 'source.json'), { ...originalSource, sourceFiles });
        files.push({ path: 'source.json', bytes: sourceBytes.length, sha256: sha256(sourceBytes) });
        await immutable(join(location, 'seller.json'), seller);
        const sellerBytes = jsonBytes(seller); files.push({ path: 'seller.json', bytes: sellerBytes.length, sha256: sha256(sellerBytes) });
        files.push(...sourceFiles);
        const record = { schema: 'stellar-forge.webdav-merchant-export.v1', id: operation.id, createdAt: operation.createdAt,
          editionId: edition.id, merchantId: merchant.id, reviewer: input.reviewer, note: input.note ?? '',
          snapshot: edition.dataset.snapshot, rowCount: edition.rowCount, files,
          sourceClosure: { files: sourceFiles.length, bytes: sourceFiles.reduce((sum, file) => sum + file.bytes, 0) } };
        await immutable(join(location, 'manifest.json'), record); await syncDirectory(location);
        return { result: { ...record, directory: location }, apply: value => { if (!value.exports.some(x => x.id === record.id)) value.exports.push(record); } };
      }
      case 'source.packet': {
        exact(input, [], action);
        const output = join(root('packets'), operation.id + '.zip');
        if (await exists(output)) {
          const retained = await inspectSourcePacket({ input: output, python, signal });
          if (retained.originalWorkspace.id !== current.id) fail('WEBDAV_PACKET_CHANGED', 'The retained source packet belongs to another original workspace.', 409);
          return { result: { schema: retained.schema, path: output, ...retained.source,
            files: retained.files, expandedBytes: retained.expandedBytes, workspace: retained.originalWorkspace, publisherStateIncluded: false } };
        }
        return { result: await exportSourcePacket({ directory, output, python, signal }) };
      }
      case 'publisher.prepare': {
        exact(input, ['exportId', 'productId', 'title'], action);
        const selected = current.exports.find(x => x.id === safeId(input.exportId));
        if (!selected) fail('WEBDAV_EXPORT_REQUIRED', 'Select a complete reviewed merchant export.');
        const id = input.productId ? safeId(input.productId) : operation.id;
        const original = await publisherFor(id, true), prepared = await original.act('publisher.prepare', { exportDirectory: join(root('exports'), selected.id) });
        const record = { id, title: text(input.title ?? 'WebDAV dataset', 128, 'the product title'), createdAt: operation.createdAt };
        return { result: { productId: id, ...prepared }, apply: value => { if (!value.products.some(x => x.id === id)) value.products.push(record); value.activeProductId = id; } };
      }
      case 'publisher.act': {
        exact(input, ['productId', 'action', 'input'], action);
        if (typeof input.action !== 'string' || !input.action.startsWith('publisher.') || input.action === 'publisher.prepare')
          fail('WEBDAV_PUBLISHER_ACTION', 'Select an original publisher action.');
        const original = await publisherFor(input.productId);
        if (!original) fail('WEBDAV_PUBLISHER_REQUIRED', 'Prepare an existing export at this host first.');
        return { result: await original.act(input.action, input.input ?? {}) };
      }
      default: fail('WEBDAV_ACTION', 'Unknown workspace action.', 404);
    }
  }
  const resumable = new Set(['source.packet', 'source.catalogue', 'capture.start', 'capture.resume', 'capture.sample', 'mapping.save', 'edition.build', 'edition.export', 'publisher.prepare']);
  async function execute(action, payload) {
    if (closed) fail('WEBDAV_CLOSED', 'Reopen the workspace.', 409);
    exact(payload, ['expectedRevision', 'operationId', 'input'], 'the operation');
    const id = safeId(payload.operationId), input = clone(payload.input ?? {}), digest = identity({ action, input });
    let current = await stored(), operation = current.operations.find(item => item.id === id);
    if (operation) {
      if (operation.intentSha256 !== digest) fail('WEBDAV_OPERATION_ID_REUSED', 'This operation ID belongs to a different original intent.', 409);
      if (operation.status === 'COMPLETE') {
        const raw = await readPrivate(join(root('operations'), id + '.json'), 16777216);
        if (sha256(raw) !== operation.resultSha256) fail('WEBDAV_OPERATION_RESULT_CHANGED', 'The original operation result has changed.', 409);
        return { operation, result: JSON.parse(raw), state: await inspect(), replayed: true };
      }
      if (active.has(id)) return { operation, state: await inspect(), pending: true };
      if (operation.status === 'FAILED')
        fail('WEBDAV_OPERATION_FINISHED', 'The failed original result is retained. Use a new reviewed intent for corrected input.', 409, { operationId: id });
      if (!resumable.has(action) && current.revision !== operation.reservedRevision && payload.expectedRevision !== current.revision)
        fail('WEBDAV_OPERATION_REVIEW', 'Review the current saved revision before continuing this original source decision with its same ID and input.', 409,
          { operationId: id, currentRevision: current.revision });
      if (action === 'publisher.act') fail('WEBDAV_NATIVE_RECONCILE', 'Inspect the original publisher result before continuing its existing operation.', 409, { operationId: id });
      operation.status = 'RUNNING'; operation.resumedAt = now();
    } else {
      integer(payload.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'the saved revision');
      if (payload.expectedRevision !== current.revision) fail('WEBDAV_STALE_REVISION', 'The workspace changed. Your draft is retained; review the latest saved version.', 409, { currentRevision: current.revision });
      const intentBytes = jsonBytes({ id, action, input, intentSha256: digest });
      if (intentBytes.length > 1048576) fail('WEBDAV_INTENT_LIMIT', 'The original operation input exceeds one MiB.');
      await immutable(join(root('operations'), id + '.intent.json'), { id, action, input, intentSha256: digest });
      operation = { id, action, intentSha256: digest, intentFileSha256: sha256(intentBytes), createdAt: now(), sourceId: current.activeSourceId,
        status: 'RUNNING', result: null, reservedRevision: current.revision + 1 };
      current.operations.push(operation);
    }
    await commit(current);
    const controller = new AbortController(); active.set(id, { action, controller, startedAt: now() });
    try {
      const outcome = await dispatch(action, input, operation, controller.signal);
      current = await stored();
      outcome.apply?.(current);
      const saved = current.operations.find(item => item.id === id);
      const resultBytes = jsonBytes(outcome.result);
      if (resultBytes.length > 16777216) fail('WEBDAV_RESULT_LIMIT', 'The retained operation result exceeds its supported size.');
      const resultPath = join(root('operations'), id + '.json');
      if (!await exists(resultPath)) await createFile(resultPath, resultBytes);
      else if (!(await readPrivate(resultPath, 16777216)).equals(resultBytes)) fail('WEBDAV_OPERATION_RESULT_CHANGED', 'The retained operation result differs; inspect the original result.', 409);
      saved.status = 'COMPLETE'; saved.completedAt = now(); saved.result = null; saved.resultSha256 = sha256(resultBytes); saved.resultBytes = resultBytes.length; saved.error = null;
      await commit(current);
      return { operation: clone(saved), result: outcome.result, state: await inspect() };
    } catch (error) {
      current = await stored();
      const saved = current.operations.find(item => item.id === id);
      saved.status = action === 'capture.start' || action === 'capture.resume' ? 'INTERRUPTED' : 'FAILED';
      saved.error = safeError(error); saved.updatedAt = now(); await commit(current);
      throw error;
    } finally { active.delete(id); }
  }
  function act(action, payload) {
    if (closed) return Promise.reject(new Error('WEBDAV_CLOSED'));
    const operation = tail.catch(() => {}).then(() => execute(action, payload)); tail = operation; return operation;
  }
  async function operationRecord(id) {
    const current = await stored(), operation = current.operations.find(row => row.id === safeId(id));
    if (!operation) fail('WEBDAV_OPERATION_NOT_FOUND', 'This workspace has no retained operation with that ID.', 404);
    let result = null, input = operation.input ?? {};
    if (operation.intentFileSha256) {
      const intentBytes = await readPrivate(join(root('operations'), id + '.intent.json'), 1048576);
      if (sha256(intentBytes) !== operation.intentFileSha256) fail('WEBDAV_OPERATION_INTENT_CHANGED', 'The original operation input has changed.', 409);
      const intent = JSON.parse(intentBytes);
      if (intent.id !== id || intent.action !== operation.action || identity({ action: intent.action, input: intent.input }) !== operation.intentSha256)
        fail('WEBDAV_OPERATION_INTENT_CHANGED', 'The original operation input has changed.', 409);
      input = intent.input;
    }
    if (operation.resultSha256) {
      const raw = await readPrivate(join(root('operations'), id + '.json'), 16777216);
      if (sha256(raw) !== operation.resultSha256 || raw.length !== operation.resultBytes)
        fail('WEBDAV_OPERATION_RESULT_CHANGED', 'The original operation result has changed.', 409);
      result = JSON.parse(raw);
    }
    return { operation: { ...operation, input }, result, active: active.has(id), state: await inspect() };
  }
  async function cancel(id) {
    safeId(id); const selected = active.get(id);
    if (selected) selected.controller.abort();
    return { operationId: id, cancelling: Boolean(selected), state: await inspect() };
  }
  async function listing({ sourceId, id, offset = 0, limit = 200 }) {
    const selected = await sourceRecord(sourceId), record = await readJson(join(root('cache'), selected.sourceHash, 'listings', safeId(id) + '.json'), 67108864);
    integer(offset, 0, 20000, 'listing offset'); integer(limit, 1, 1000, 'displayed entries');
    if (!Array.isArray(record.entries)) return record;
    return { ...record, offset, limit, entries: record.entries.slice(offset, offset + limit),
      nextOffset: offset + limit < record.total ? offset + limit : null };
  }
  async function download(kind, id, name, sourceId) {
    let path, type = 'application/json', expected;
    if (kind === 'source') {
      const selected = await sourceRecord(id); path = join(root('sources'), id + '.json'); expected = selected.fileSha256; name = 'webdav-source.json';
    } else if (kind === 'capture') {
      const original = await captureRecord(id, { verify: false });
      if (!original.receipt) fail('WEBDAV_CAPTURE_INCOMPLETE', 'Complete this original capture first.', 409);
      if (name === 'body.bin') { path = original.receipt.path; type = 'application/octet-stream'; expected = original.receipt.sha256; }
      else if (name === 'receipt.json') path = join(root('cache'), original.sourceHash, 'captures', id, name);
      else fail('WEBDAV_FILE', 'Choose original bytes or their receipt.');
    } else if (kind === 'listing') {
      const selected = await sourceRecord(sourceId);
      if (!['xml', 'json'].includes(name)) fail('WEBDAV_FILE', 'Choose original XML or its property receipt.');
      const receipt = await readJson(join(root('cache'), selected.sourceHash, 'listings', safeId(id) + '.json'), 67108864);
      path = join(root('cache'), selected.sourceHash, 'listings', id + '.' + name);
      if (name === 'xml') { expected = receipt.sha256; type = 'application/xml'; }
      name = 'webdav-listing.' + name;
    } else if (kind === 'edition' || kind === 'export') {
      safeId(id);
      if (kind === 'edition') {
        if (!['dataset.csv', 'dataset.json', 'source.json', 'edition.json'].includes(name))
          fail('WEBDAV_FILE', 'Choose a retained dataset file.');
      } else {
        const record = (await stored()).exports.find(item => item.id === id);
        if (!record) fail('WEBDAV_EXPORT_REQUIRED', 'Choose a completed original export.', 404);
        if (name === 'manifest.json') expected = sha256(jsonBytes(record));
        else {
          const declared = record.files.find(file => file.path === name);
          if (!declared || typeof name !== 'string' || name.split('/').some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..'))
            fail('WEBDAV_FILE', 'Choose a declared original export member.');
          expected = declared.sha256;
        }
      }
      path = join(root(kind === 'edition' ? 'editions' : 'exports'), id, name);
      if (name.endsWith('.csv')) type = 'text/csv; charset=utf-8';
      else if (name.endsWith('.xml')) type = 'application/xml';
      else if (name.endsWith('.bin')) type = 'application/octet-stream';
    } else if (kind === 'packet') {
      safeId(id);
      const current = await stored(), selected = current.operations.find(row => row.id === id && row.action === 'source.packet' && row.status === 'COMPLETE');
      if (!selected) fail('WEBDAV_PACKET_NOT_FOUND', 'Create or select a completed source packet.', 404);
      const result = (await operationRecord(id)).result;
      path = join(root('packets'), id + '.zip'); expected = result.sha256; name = 'webdav-source-packet.zip'; type = 'application/zip';
    } else fail('WEBDAV_FILE', 'Choose a retained original file.', 404);
    const check = await hashPrivate(path, kind === 'packet' ? 553648128 : 268435456);
    if (expected && check.hash !== expected) fail('WEBDAV_DOWNLOAD_CHANGED', 'The retained download differs from its original hash.', 409);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    return { handle, size: check.bytes, sha256: check.hash, filename: name, contentType: type };
  }
  async function publisherState(id) {
    const original = await publisherFor(id); return original ? original.state() : { prepared: false, productId: id };
  }
  async function publisherDownload(id, kind, recordId) {
    const original = await publisherFor(id);
    if (!original) fail('WEBDAV_PUBLISHER_REQUIRED', 'Prepare this product at the current host.');
    return original.readExport(kind, recordId);
  }
  const close = () => closing ??= (async () => {
    closed = true; for (const item of active.values()) item.controller.abort();
    await tail.catch(() => {});
    const resources = await Promise.allSettled([...sources.values(), ...publishers.values()]);
    try {
      const results = await Promise.allSettled(resources.filter(x => x.status === 'fulfilled').map(x => x.value.close()));
      const failed = results.find(x => x.status === 'rejected'); if (failed) throw failed.reason;
    } finally { await release(); }
  })();
  try {
    for (const name of ['sources', 'cache', 'mappings', 'editions', 'merchants', 'exports', 'publishers', 'packets', 'operations']) await privateDirectory(root(name), true);
    if (!await exists(root('workspace.json'))) await atomicJson(directory, 'workspace.json', {
      schema: WORKSPACE_SCHEMA, id: randomUUID(), revision: 0, createdAt: now(), updatedAt: now(), activeSourceId: null,
      activeMerchantId: null, activeProductId: null, sources: [], mappings: [], editions: [], exports: [],
      merchants: [], products: [], operations: [],
    });
    await stored();
  } catch (error) { await close(); throw error; }
  return { directory, inspect, act, cancel, operation: operationRecord, listing, preview, capture: (id) => captureRecord(id, { verify: false }), mapping: mappingRecord,
    publisherState, publisherDownload, download, close };
}
