// MIT. Private RisingWave source authoring and original retained dataset operations.
import { lstat, open, readdir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { validateRisingWaveSource, openRisingWaveSourceFile } from '../config.mjs';
import { compileRisingWaveReport, compileRisingWaveQueries, bindRisingWaveParameters } from '../report.mjs';
import { readRisingWaveCapture, inspectRisingWaveCapture } from '../source.mjs';
import { openRisingWavePublisher } from '../publisher/model.mjs';
import { startPostgresPublisherServer } from '../../postgres/publisher/server.mjs';
import { acquireWorkspace, privateDirectory, readPrivate, readJson, createFile, atomicJson,
  bytes, digest, fault, syncDirectory } from '../../postgres/publisher/files.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../../dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from '../../dataset-refresh/service.mjs';
import { readDatasetBuyerOffer, prepareDatasetBuyer } from '../../dataset-refresh/buyer-handoff.mjs';
import { datasetQueryParameters } from '../../dataset-cli.mjs';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../../seller.mjs';

const SCHEMA = 'stellar-forge.risingwave-authoring-workspace.v1';
const ITEM = /^[a-z][a-z0-9-]{0,100}$/;
const id = value => {
  if (typeof value !== 'string' || !ITEM.test(value)) throw fault('WORKSPACE_ITEM_INVALID');
  return value;
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function fields(value, names) {
  if (!object(value) || Object.keys(value).some(key => !names.includes(key))) throw fault('WORKSPACE_INPUT_INVALID');
}
const key = prefix => prefix + '-' + Date.now() + '-' + randomUUID();
const timestamp = () => new Date().toISOString();
const conflict = () => fault('WORKSPACE_REVISION_CHANGED', 'A newer source revision is saved. Reload it or keep this draft and reconcile the changes.', 409);
async function exists(path) {
  try { await lstat(path); return true; } catch (issue) { if (issue.code !== 'ENOENT') throw issue; return false; }
}
async function directory(path) { await privateDirectory(path, true); return path; }
function merchantTerms(value) {
  if (value === null || value === undefined) return null;
  fields(value, ['publicOrigin', 'description', 'serviceName', 'tags', 'payment', 'paymentOptions']);
  if (value.payment !== undefined && value.paymentOptions !== undefined)
    throw fault('MERCHANT_PAYMENT_CHOICES_INVALID', 'Use one payment object or the complete paymentOptions array.');
  let origin;
  try { origin = new URL(value.publicOrigin); } catch { throw fault('MERCHANT_ORIGIN_INVALID', 'Enter the public HTTPS merchant origin.'); }
  if (origin.protocol !== 'https:' || origin.origin !== value.publicOrigin || origin.username || origin.password)
    throw fault('MERCHANT_ORIGIN_INVALID', 'Use a public HTTPS origin without a path or credentials.');
  const definition = { method: 'GET', url: value.publicOrigin + '/datasets/source-report',
    description: value.description ?? 'Retained dataset from a private RisingWave time-series report',
    serviceName: value.serviceName ?? 'RisingWave datasets', tags: value.tags ?? ['risingwave', 'dataset'],
    ...(value.paymentOptions ? { paymentOptions: structuredClone(value.paymentOptions) } : { payment: structuredClone(value.payment) }),
    queryParameters: [], outputExample: { rows: [], page: { total: 0, returned: 0 } } };
  paymentRequiredResponse(compileHttpSellerOffer(definition));
  return { publicOrigin: value.publicOrigin, description: definition.description, serviceName: definition.serviceName,
    tags: definition.tags, ...(value.paymentOptions ? { paymentOptions: definition.paymentOptions } : { payment: definition.payment }) };
}
function resourcePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 512 ||
      /[?#\s\x00-\x1f]/.test(value) || value.split('/').some(part => part === '.' || part === '..') ||
      new URL(value, 'https://merchant.example').pathname !== value) throw fault('DATASET_RESOURCE_PATH_INVALID');
  return value;
}
function sellerConfig(link, description) {
  const definition = { method: 'GET', description: link.merchant.description,
    serviceName: link.merchant.serviceName, tags: [...new Set([...link.merchant.tags, 'risingwave', 'dataset'])],
    ...(link.merchant.paymentOptions ? { paymentOptions: structuredClone(link.merchant.paymentOptions) } :
      { payment: structuredClone(link.merchant.payment) }),
    queryParameters: [...datasetQueryParameters(description), { ...DATASET_SNAPSHOT_PARAMETER }],
    outputExample: { schema: 'stellar-forge.dataset-page.v1', rows: [],
      page: { limit: description.defaultLimit, total: 0, returned: 0, nextCursor: null } } };
  paymentRequiredResponse(compileHttpSellerOffer({ ...definition, url: link.merchant.publicOrigin + link.path }));
  return { schema: 'stellar-forge.seller-service.v1', publicOrigin: link.merchant.publicOrigin,
    routes: [{ id: 'dataset', path: link.path, definition, handler: 'queryDataset', admit: 'admitDataset' }] };
}

export async function openRisingWaveWorkbench({ directory: selectedDirectory, sourcePath, merchantPath,
  environment = process.env, datasetNativeFactory = null } = {}) {
  if (typeof selectedDirectory !== 'string' || !selectedDirectory) throw fault('WORKSPACE_DIRECTORY_REQUIRED');
  const root = resolve(selectedDirectory);
  await directory(root);
  const release = await acquireWorkspace(root);
  const sessions = new Map(), operations = new Set(), sources = new Set(), captureTasks = new Map(), verifiedFiles = new Map(), sourceConnections = new Map();
  let queue = Promise.resolve(), closing = null, closed = false;
  const admitted = action => (...args) => {
    if (closed) return Promise.reject(fault('WORKSPACE_CLOSED', 'Reopen this private workspace.', 409));
    let operation;
    try { operation = Promise.resolve(action(...args)); }
    catch (issue) { return Promise.reject(issue); }
    operations.add(operation);
    operation.then(() => operations.delete(operation), () => operations.delete(operation));
    return operation;
  };
  const mutate = action => {
    if (closed) throw fault('WORKSPACE_CLOSED', 'Reopen this private workspace.', 409);
    const pending = queue.then(action); queue = pending.catch(() => {}); return pending;
  };
  async function state() {
    const value = await readJson(join(root, 'workspace.json'), 2097152);
    if (value.schema !== SCHEMA || !Array.isArray(value.revisions) || !Array.isArray(value.publications))
      throw fault('WORKSPACE_STATE_INVALID');
    return value;
  }
  async function revision(requested) {
    const saved = await state();
    const value = requested === undefined ? saved.revisions.at(-1) : saved.revisions.find(item => item.revision === requested);
    if (!value) {
      if (requested === undefined && !saved.revisions.length) return null;
      throw fault('WORKSPACE_REVISION_NOT_FOUND', 'Select a retained source revision.', 404);
    }
    const location = join(root, 'revisions', id(value.id));
    await privateDirectory(location);
    const sourceBytes = await readPrivate(join(location, 'source.json'), 1048576);
    const merchantBytes = await readPrivate(join(location, 'merchant.json'), 1048576);
    if (digest(sourceBytes) !== value.sourceHash || digest(merchantBytes) !== value.merchantHash)
      throw fault('WORKSPACE_REVISION_BYTES_CHANGED', 'Restore the original saved source revision.', 409);
    return { ...value, sourceFile: join(location, 'source.json'), source: JSON.parse(sourceBytes), merchant: JSON.parse(merchantBytes) };
  }
  async function expected(value) {
    const current = await revision();
    if (!Number.isSafeInteger(value) || value !== (current?.revision ?? 0)) throw conflict();
    return current;
  }
  async function save(input) {
    fields(input, ['expectedRevision', 'source', 'merchant']);
    return mutate(async () => {
      const before = await expected(input.expectedRevision);
      const source = structuredClone(input.source);
      validateRisingWaveSource(source);
      const merchant = merchantTerms(input.merchant);
      const sourceBytes = bytes(source), merchantBytes = bytes(merchant), number = (before?.revision ?? 0) + 1;
      const item = { id: key('revision'), revision: number, savedAt: timestamp(), sourceHash: digest(sourceBytes),
        merchantHash: digest(merchantBytes), reports: Object.keys(source.queries).length };
      const location = await directory(join(root, 'revisions', item.id));
      await createFile(join(location, 'source.json'), sourceBytes);
      await createFile(join(location, 'merchant.json'), merchantBytes);
      await createFile(join(location, 'revision.json'), bytes(item)); await syncDirectory(location);
      const current = await state();
      if ((current.revisions.at(-1)?.revision ?? 0) !== input.expectedRevision) throw conflict();
      current.revisions.push(item); current.updatedAt = timestamp();
      await atomicJson(root, 'workspace.json', current);
      return inspect();
    });
  }
  async function sourceFor(saved) {
    if (closed) throw fault('WORKSPACE_CLOSED', 'Reopen this private workspace.', 409);
    if (sourceConnections.has(saved.id)) return sourceConnections.get(saved.id);
    const pending = (async () => {
      const captureDirectory = await directory(join(root, 'captures'));
      const opened = await openRisingWaveSourceFile(saved.sourceFile, { env: environment, captureDirectory });
      if (closed) { await opened.source.close(); throw fault('WORKSPACE_CLOSED'); }
      sources.add(opened.source); return opened.source;
    })();
    sourceConnections.set(saved.id, pending);
    try { return await pending; } catch (issue) { sourceConnections.delete(saved.id); throw issue; }
  }
  const normalizedInput = (saved, query, input) => {
    const declaration = compileRisingWaveQueries(saved.source.queries)[query];
    if (!declaration) throw fault('RISINGWAVE_REPORT_REQUIRED');
    return bindRisingWaveParameters(declaration, input ?? {});
  };
  async function withSource(input, action) {
    const saved = await expected(input.expectedRevision);
    if (!saved) throw fault('RISINGWAVE_SOURCE_REQUIRED', 'Save this connection before discovering its tables.');
    return action(await sourceFor(saved), saved);
  }
  async function catalogue(input) {
    fields(input, ['expectedRevision', 'schemas', 'relations', 'subscriptions']);
    return withSource(input, async (source, saved) => ({ revision: saved.revision,
      catalogue: await source.discover({ schemas: input.schemas, relations: input.relations, subscriptions: input.subscriptions }) }));
  }
  async function compileReport(input) {
    fields(input, ['report']);
    return compileRisingWaveReport(input.report);
  }
  async function subscriptionRecord(selected) {
    id(selected);
    const record = await readJson(join(root, 'subscriptions', selected, 'review.json'), 2097152);
    if (record.schema !== 'stellar-forge.risingwave-workbench-subscription.v1' || record.requestId !== selected)
      throw fault('SUBSCRIPTION_RECORD_INVALID');
    const result = await readJson(join(root, 'subscriptions', selected, 'result.json'), 2097152).catch(issue => {
      if (issue.code !== 'ENOENT') throw issue;
      return null;
    });
    return { ...record, result };
  }
  async function subscriptions() {
    const names = (await readdir(join(root, 'subscriptions'))).filter(name => /^subscription-[a-z0-9-]+$/.test(name)).sort().reverse();
    const items = [];
    for (const name of names) items.push(await subscriptionRecord(name));
    return { total: items.length, items };
  }
  async function subscriptionInspect(input) {
    fields(input, ['expectedRevision', 'query']);
    return withSource(input, async source => source.inspectSubscription(input.query));
  }
  async function subscriptionPrepare(input) {
    fields(input, ['expectedRevision', 'query', 'requestId', 'retention']);
    id(input.requestId);
    if (!input.requestId.startsWith('subscription-')) throw fault('SUBSCRIPTION_REQUEST_ID_INVALID');
    return mutate(async () => {
      const location = join(root, 'subscriptions', input.requestId);
      const request = { expectedRevision: input.expectedRevision, query: input.query, retention: input.retention ?? '1 day' };
      if (await exists(join(location, 'review.json'))) {
        const retained = await subscriptionRecord(input.requestId);
        if (digest(bytes(retained.request)) !== digest(bytes(request))) throw fault('SUBSCRIPTION_REQUEST_CHANGED');
        return retained;
      }
      return withSource(input, async (source, saved) => {
        const review = await source.prepareSubscription(input.query, { requestId: input.requestId, retention: request.retention });
        if (review.requestId !== input.requestId || review.sourceHash !== saved.sourceHash ||
            review.query !== input.query || !/^[a-f0-9]{64}$/.test(review.reviewHash ?? ''))
          throw fault('SUBSCRIPTION_REVIEW_BINDING_CHANGED');
        await directory(location);
        const record = { schema: 'stellar-forge.risingwave-workbench-subscription.v1',
          requestId: input.requestId, revision: saved.revision, sourceHash: saved.sourceHash,
          createdAt: timestamp(), request, review };
        await createFile(join(location, 'review.json'), bytes(record));
        await syncDirectory(location);
        return { ...record, result: null };
      });
    });
  }
  async function subscriptionCreate(input) {
    fields(input, ['expectedRevision', 'requestId', 'reviewHash']);
    return mutate(async () => {
      const retained = await subscriptionRecord(input.requestId);
      if (retained.revision !== input.expectedRevision || retained.review.reviewHash !== input.reviewHash)
        throw fault('SUBSCRIPTION_REVIEW_CHANGED', 'Use the exact saved subscription review and request.');
      if (retained.result) return retained;
      const saved = await revision(retained.revision);
      if (saved.sourceHash !== retained.sourceHash) throw fault('SUBSCRIPTION_SOURCE_CHANGED');
      const source = await sourceFor(saved);
      const result = await source.createSubscription(retained.review, {
        requestId: retained.requestId, directory: join(root, 'subscriptions', retained.requestId, 'native'),
      });
      if (result.requestId !== retained.requestId || result.reviewHash !== retained.review.reviewHash ||
          !['CREATED', 'EXISTING', 'RECONCILED'].includes(result.status)) throw fault('SUBSCRIPTION_RESULT_INVALID');
      await createFile(join(root, 'subscriptions', retained.requestId, 'result.json'), bytes(result));
      await syncDirectory(join(root, 'subscriptions', retained.requestId));
      return subscriptionRecord(retained.requestId);
    });
  }
  async function sample(input) {
    fields(input, ['expectedRevision', 'query', 'input']);
    return withSource(input, async (source, saved) => {
      const sample = await source.query(input.query, input.input ?? {});
      const record = { id: key('sample'), revision: saved.revision, capturedAt: timestamp(), sample };
      await createFile(join(root, 'samples', record.id + '.json'), bytes(record));
      await syncDirectory(join(root, 'samples')); return record;
    });
  }
  async function publicationCommand(selected, action, input = {}) {
    const session = await sessionFor(selected), publisher = session.publisher, schedule = session.console.schedule;
    if (action === 'source') { fields(input, []); return publisher.source(); }
    if (action === 'plan') { fields(input, ['plan']); return publisher.plan(input.plan); }
    if (action === 'plan/save') return publisher.savePlan(input);
    if (action === 'extract') { fields(input, ['plan']); return publisher.startExtraction(input.plan).completion; }
    if (action === 'extract/start') { fields(input, ['plan']); return { id: publisher.startExtraction(input.plan).id }; }
    if (action === 'cancel') { fields(input, ['id']); return publisher.cancel(input.id); }
    if (action === 'review') return publisher.review(input.id, input);
    if (action === 'publish') { fields(input, ['id','reviewId']); return publisher.publish(input.id, input.reviewId); }
    if (action === 'recover') { fields(input, ['id']); return publisher.recover(input.id); }
    if (action === 'schedule/status') return schedule.status(input);
    if (action === 'schedule/save') return schedule.configure(input);
    if (action === 'schedule/enable') return schedule.enable(input);
    if (action === 'schedule/pause') return schedule.pause(input);
    if (action === 'schedule/run') return schedule.runNow(input).completion;
    if (action === 'schedule/continue') return schedule.continueRun(input).completion;
    throw fault('WORKSPACE_ACTION_NOT_FOUND', 'Select a publication action.', 404);
  }
  const captureNames = Object.freeze({ json: 'data.json', ndjson: 'data.ndjson', csv: 'data.csv',
    events: 'events.ndjson', checkpoint: 'checkpoint.json', state: 'state.sqlite', manifest: 'capture.json' });
  async function captureRecord(selected) {
    id(selected);
    const record = await readJson(join(root, 'captures', selected + '.json'), 8388608);
    if (record.schema !== 'stellar-forge.risingwave-workbench-capture.v1' || record.id !== selected)
      throw fault('CAPTURE_RECORD_INVALID');
    return record;
  }
  async function captures(input = {}) {
    fields(input, ['limit', 'offset']);
    const limit = input.limit ?? 20, offset = input.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
      throw fault('CAPTURE_PAGE_INVALID');
    const names = (await readdir(join(root, 'captures'))).filter(name => /^capture-[a-z0-9-]+\.json$/.test(name)).sort().reverse();
    const items = [];
    for (const name of names.slice(offset, offset + limit)) items.push(await captureRecord(name.slice(0, -5)));
    return { total: names.length, offset, limit, items, nextOffset: offset + items.length < names.length ? offset + items.length : null };
  }
  async function capture(input) {
    fields(input, ['expectedRevision', 'query', 'input', 'captureId', 'mode', 'baseCaptureId', 'onGap', 'extraction']);
    const mode = input.mode ?? 'auto', onGap = input.onGap ?? 'error';
    if (!['full','changes','auto'].includes(mode) || !['error','rebuild'].includes(onGap))
      throw fault('CAPTURE_MODE_INVALID');
    if (input.baseCaptureId !== undefined && input.baseCaptureId !== null) id(input.baseCaptureId);
    fields(input.extraction ?? {}, ['maxRows','maxBytes','batchSize','timeoutSeconds']);
    if (mode === 'full' && input.baseCaptureId) throw fault('CAPTURE_BASE_NOT_USED', 'A full edition begins at the native initial snapshot.');
    const requestFor = saved => ({ revision: input.expectedRevision, query: input.query,
      input: normalizedInput(saved, input.query, input.input), mode,
      baseCaptureId: input.baseCaptureId ?? null, onGap, extraction: structuredClone(input.extraction ?? {}) });
    if (input.captureId !== undefined) {
      id(input.captureId);
      if (!input.captureId.startsWith('capture-')) throw fault('CAPTURE_ID_INVALID');
      if (await exists(join(root, 'captures', input.captureId + '.json'))) {
        const retained = await captureRecord(input.captureId), original = await revision(retained.revision);
        if (digest(bytes(retained.request)) !== digest(bytes(requestFor(original)))) throw fault('CAPTURE_REQUEST_CHANGED');
        return retained;
      }
    }
    const saved = await expected(input.expectedRevision);
    if (!saved || !Object.hasOwn(saved.source.queries, input.query))
      throw fault('RISINGWAVE_REPORT_REQUIRED', 'Save and select a report before capturing an edition.');
    const request = requestFor(saved), selected = input.captureId ?? key('capture');
    let base = null;
    const compatible = record => record.state === 'COMPLETE' && record.sourceHash === saved.sourceHash &&
      record.query === input.query && digest(bytes(record.input)) === digest(bytes(request.input));
    if (input.baseCaptureId) {
      base = await captureRecord(input.baseCaptureId);
      if (!compatible(base)) throw fault('CAPTURE_BASE_CHANGED', 'Choose a complete edition of this exact saved report and parameter selection.');
    } else if (mode !== 'full') {
      const names = (await readdir(join(root, 'captures'))).filter(name => /^capture-[a-z0-9-]+\.json$/.test(name)).sort().reverse();
      for (const name of names) {
        const candidate = await captureRecord(name.slice(0,-5));
        if (compatible(candidate)) { base = candidate; break; }
      }
    }
    if (mode === 'changes' && !base) throw fault('CAPTURE_BASE_REQUIRED', 'Capture a complete first edition or choose its retained checkpoint.');
    const location = await directory(join(root, 'captures', selected));
    const record = { schema: 'stellar-forge.risingwave-workbench-capture.v1', id: selected, state: 'CAPTURING',
      revision: saved.revision, sourceHash: saved.sourceHash, query: input.query, input: request.input, request,
      startedAt: timestamp(), directory: location, mode, onGap, extraction: request.extraction,
      baseCaptureId: base?.id ?? null, baseCaptureSha256: base?.files?.manifest?.sha256 ?? null, progress: null };
    await createFile(join(root, 'captures', selected + '.json'), bytes(record));
    await syncDirectory(join(root, 'captures'));
    const controller = new AbortController();
    let writes = Promise.resolve();
    const persist = () => {
      const snapshot = structuredClone(record);
      const next = writes.then(() => atomicJson(join(root, 'captures'), selected + '.json', snapshot));
      writes = next.catch(() => {});
      return next;
    };
    const completion = (async () => {
      try {
        const source = await sourceFor(saved);
        if (closed) controller.abort();
        const result = await source.capture(input.query, record.input, {
          ...record.extraction, directory: location, mode, onGap,
          ...(base ? { baseCaptureDirectory: join(root, 'captures', base.id) } : {}),
          signal: controller.signal,
          onProgress: async progress => { record.progress = structuredClone(progress); await persist(); },
        });
        if (resolve(result.directory) !== location || !object(result.files) || !result.manifest ||
            result.manifest.complete !== true || result.manifest.sourceHash !== record.sourceHash ||
            result.manifest.query !== record.query || digest(bytes(result.manifest.input)) !== digest(bytes(record.input)))
          throw fault('CAPTURE_RESULT_INVALID');
        for (const [name, file] of Object.entries(result.files)) {
          if (!Object.hasOwn(captureNames, name) || file.path !== captureNames[name] ||
              !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256))
            throw fault('CAPTURE_FILE_INVALID');
        }
        if (Object.keys(captureNames).some(name => !result.files[name])) throw fault('CAPTURE_FILE_MISSING');
        Object.assign(record, { state: 'COMPLETE', completedAt: timestamp(), manifest: result.manifest, files: result.files });
      } catch (issue) {
        Object.assign(record, { state: controller.signal.aborted ? 'CANCELLED' : 'FAILED', completedAt: timestamp(),
          error: { code: issue.code ?? 'RISINGWAVE_CAPTURE_FAILED', message: issue.code ? issue.message : 'The source capture did not complete.' } });
        try { record.progress = await inspectRisingWaveCapture(location); } catch {}
      } finally { await persist(); }
      return record;
    })();
    captureTasks.set(selected, { controller, completion }); operations.add(completion);
    completion.finally(() => { captureTasks.delete(selected); operations.delete(completion); }).catch(() => {});
    return record;
  }
  async function cancelCapture(selected) {
    const task = captureTasks.get(id(selected));
    if (task) { task.controller.abort(); return task.completion; }
    return captureRecord(selected);
  }
  async function captureFile(selected, name) {
    const record = await captureRecord(selected), file = record.files?.[name];
    if (record.state !== 'COMPLETE' || !file || file.path !== captureNames[name]) throw fault('CAPTURE_FILE_NOT_FOUND');
    const handle = await open(join(root, 'captures', selected, file.path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== file.bytes) throw fault('CAPTURE_FILE_CHANGED');
      const fileIdentity = value => [value.dev,value.ino,value.size,value.mtimeMs,value.ctimeMs].join(':');
      const cacheKey = selected + '/' + name, identity = fileIdentity(info);
      if (verifiedFiles.get(cacheKey) !== identity + ':' + file.sha256) {
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
        if (hash.digest('hex') !== file.sha256 || fileIdentity(await handle.stat()) !== identity) throw fault('CAPTURE_FILE_CHANGED');
        verifiedFiles.set(cacheKey, identity + ':' + file.sha256);
      }
      return { handle, size: info.size, name: file.path, type: name.toLowerCase().includes('csv') ? 'text/csv; charset=utf-8' :
        ['ndjson','events'].includes(name) ? 'application/x-ndjson' : name === 'state' ? 'application/octet-stream' : 'application/json', sha256: file.sha256 };
    } catch (issue) { await handle.close(); throw issue; }
  }
  async function recoverCapture(selected) {
    const record = await captureRecord(selected);
    if (captureTasks.has(selected) || record.state === 'COMPLETE') return record;
    const result = await readRisingWaveCapture(join(root, 'captures', selected));
    if (result.manifest.sourceHash !== record.sourceHash || result.manifest.query !== record.query ||
        digest(bytes(result.manifest.input)) !== digest(bytes(record.input)))
      throw fault('CAPTURE_BINDING_CHANGED');
    Object.assign(record, { state: 'COMPLETE', completedAt: result.manifest.completedAt,
      recoveredAt: timestamp(), manifest: result.manifest, files: result.files });
    delete record.error;
    await atomicJson(join(root, 'captures'), selected + '.json', record); return record;
  }
  async function captureChunk(selected, name, input = {}) {
    fields(input, ['offset','limit']);
    const offset = input.offset ?? 0, limit = input.limit ?? 196608;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 196608)
      throw fault('CAPTURE_RANGE_INVALID');
    const file = await captureFile(selected, name);
    try {
      if (offset > file.size) throw fault('CAPTURE_RANGE_INVALID');
      const chunk = Buffer.alloc(Math.min(limit, file.size - offset));
      let read = 0;
      while (read < chunk.length) {
        const result = await file.handle.read(chunk, read, chunk.length-read, offset+read);
        if (!result.bytesRead) throw fault('CAPTURE_FILE_CHANGED'); read += result.bytesRead;
      }
      return { captureId:selected,file:name,name:file.name,totalBytes:file.size,sha256:file.sha256,
        offset,bytes:read,nextOffset:offset+read<file.size?offset+read:null,base64:chunk.toString('base64') };
    } finally { await file.handle.close(); }
  }
  async function compareCaptures(input) {
    fields(input, ['before', 'after', 'keys', 'sampleLimit']);
    const before = await captureRecord(input.before), after = await captureRecord(input.after);
    const original = await revision(before.revision), keys = input.keys ?? original.source.queries[before.query]?.key ?? [];
    if (before.state !== 'COMPLETE' || after.state !== 'COMPLETE' || !Array.isArray(keys) || keys.length === 0 ||
        keys.some(value => typeof value !== 'string' || !value) || new Set(keys).size !== keys.length)
      throw fault('CAPTURE_COMPARISON_INVALID', 'Select two complete editions and distinct row identity fields.');
    const limit = input.sampleLimit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw fault('CAPTURE_COMPARISON_LIMIT_INVALID');
    const selected = key('comparison'), dbPath = join(root, 'comparisons', selected + '.sqlite');
    const db = new DatabaseSync(dbPath);
    const handles = [];
    try {
      db.exec('PRAGMA journal_mode=DELETE; PRAGMA temp_store=FILE; CREATE TABLE rows(side INTEGER,key TEXT,payload TEXT,hash TEXT,PRIMARY KEY(side,key));');
      const put = db.prepare('INSERT INTO rows VALUES(?,?,?,?)');
      for (const [side, record] of [[0,before],[1,after]]) {
        const file = await captureFile(record.id, 'ndjson'); handles.push(file.handle);
        let ordinal = 0; db.exec('BEGIN');
        try {
          const lines = createInterface({ input: file.handle.createReadStream({ autoClose: false, start: 0 }), crlfDelay: Infinity });
          for await (const line of lines) {
            if (!line) continue;
            const row = JSON.parse(line);
            if (!object(row) || keys.some(name => !Object.hasOwn(row, name) || row[name] === null)) throw fault('CAPTURE_KEY_NOT_FOUND');
            const identity = JSON.stringify(keys.length ? keys.map(name => row[name]) : [ordinal]);
            const payload = JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(name => [name, row[name]])));
            try { put.run(side, identity, payload, digest(Buffer.from(payload))); }
            catch (issue) {
              if (String(issue.message).includes('UNIQUE')) throw fault('CAPTURE_KEY_NOT_UNIQUE', 'Use fields that identify one row in each edition.');
              throw issue;
            }
            ordinal++;
            if (ordinal % 1000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
          }
          db.exec('COMMIT');
        } catch (issue) { try { db.exec('ROLLBACK'); } catch {} throw issue; }
      }
      const count = sql => Number(db.prepare(sql).get().count);
      const sample = (sql, ...args) => db.prepare(sql).all(...args).map(row => ({
        key: JSON.parse(row.key), ...(row.before ? { before: JSON.parse(row.before) } : {}),
        ...(row.after ? { after: JSON.parse(row.after) } : {}) }));
      const counts = {
        before: count('SELECT count(*) count FROM rows WHERE side=0'),
        after: count('SELECT count(*) count FROM rows WHERE side=1'),
        added: count('SELECT count(*) count FROM rows r LEFT JOIN rows l ON l.side=0 AND l.key=r.key WHERE r.side=1 AND l.key IS NULL'),
        removed: count('SELECT count(*) count FROM rows l LEFT JOIN rows r ON r.side=1 AND r.key=l.key WHERE l.side=0 AND r.key IS NULL'),
        changed: count('SELECT count(*) count FROM rows l JOIN rows r ON r.side=1 AND r.key=l.key WHERE l.side=0 AND l.hash<>r.hash'),
        unchanged: count('SELECT count(*) count FROM rows l JOIN rows r ON r.side=1 AND r.key=l.key WHERE l.side=0 AND l.hash=r.hash'),
      };
      const result = { schema: 'stellar-forge.risingwave-capture-comparison.v1', id: selected, comparedAt: timestamp(),
        before: { id: before.id, sourceHash: before.sourceHash, query: before.query, input: before.input, sha256: before.files.ndjson.sha256 },
        after: { id: after.id, sourceHash: after.sourceHash, query: after.query, input: after.input, sha256: after.files.ndjson.sha256 },
        sameSelection: before.query === after.query && digest(bytes(before.input)) === digest(bytes(after.input)),
        identity: keys.length ? { kind: 'keyed', fields: keys } : { kind: 'ordered-row-position' }, counts, sampleLimit: limit,
        added: sample('SELECT r.key,r.payload AS "after" FROM rows r LEFT JOIN rows l ON l.side=0 AND l.key=r.key WHERE r.side=1 AND l.key IS NULL ORDER BY r.key LIMIT ?', limit),
        removed: sample('SELECT l.key,l.payload AS "before" FROM rows l LEFT JOIN rows r ON r.side=1 AND r.key=l.key WHERE l.side=0 AND r.key IS NULL ORDER BY l.key LIMIT ?', limit),
        changed: sample('SELECT l.key,l.payload AS "before",r.payload AS "after" FROM rows l JOIN rows r ON r.side=1 AND r.key=l.key WHERE l.side=0 AND l.hash<>r.hash ORDER BY l.key LIMIT ?', limit),
      };
      await createFile(join(root, 'comparisons', selected + '.json'), bytes(result)); return result;
    } finally {
      await Promise.allSettled(handles.map(handle => handle.close())); db.close();
      await unlink(dbPath).catch(issue => { if (issue.code !== 'ENOENT') throw issue; });
    }
  }
  const sellerView = session => session.seller ? { origin: session.seller.url, mode: session.seller.mode,
    docs: session.seller.url + '/_seller/docs', startedAt: session.startedAt } : null;
  async function setServiceIntent(session, running) {
    await atomicJson(session.directory, 'service-intent.json', { schema: 'stellar-forge.risingwave-dataset-service-intent.v1', running, savedAt: timestamp() });
  }
  async function startSeller(session, persist = true) {
    if (session.seller) return sellerView(session);
    if ((await session.publisher.target()).initializable)
      throw fault('DATASET_PUBLICATION_REQUIRED', 'Publish the first reviewed candidate in its publication console, then start the seller.', 409);
    const versions = await openDatasetVersions({ directory: session.publisher.settings.targetDirectory });
    let seller;
    try {
      const config = sellerConfig(session.link, versions.describe()), file = join(session.directory, 'seller.json');
      if (await exists(file)) {
        if (digest(await readPrivate(file, 1048576)) !== digest(bytes(config)))
          throw fault('DATASET_SELLER_BINDING_CHANGED', 'The seller must keep this publication’s saved merchant terms.', 409);
      } else await createFile(file, bytes(config));
      seller = await startVersionedDatasetSeller({ versions, config, port: 0, nativeFactory: datasetNativeFactory, controlTransport: 'loopback' });
      if (persist) await setServiceIntent(session, true);
      session.seller = seller; session.startedAt = timestamp(); session.startError = null;
      return sellerView(session);
    } catch (issue) { if (seller) await seller.close(); else await versions.close(); throw issue; }
  }
  async function offer(session, runId, query = '') {
    if (!session.seller) throw fault('DATASET_SELLER_REQUIRED', 'Start this publication’s dataset seller.', 409);
    const candidate = await session.publisher.candidate(runId);
    const snapshot = candidate.manifest.dataset.snapshot;
    const selection = new URLSearchParams(query);
    if (selection.has('cursor') || selection.has('snapshot')) throw fault('BUYER_FIRST_PAGE_REQUIRED');
    selection.set('snapshot', snapshot);
    const preview = await datasetControl(session.publisher.settings.targetDirectory, 'preview', { query: selection.toString() });
    if (preview.dataset?.snapshot !== snapshot) throw fault('TARGET_SNAPSHOT_CHANGED');
    return readDatasetBuyerOffer({ seller: session.seller.url, resource: session.link.merchant.publicOrigin + session.link.path, snapshot, query });
  }
  async function buyer(session, runId, input) {
    const selected = await offer(session, runId, input.query ?? '');
    const prepared = prepareDatasetBuyer(selected, input), item = key('buyer');
    await createFile(join(session.directory, 'buyers', item + '.json'), Buffer.from(prepared.configText));
    const record = { id: item, createdAt: timestamp(), runId, snapshot: prepared.snapshot,
      configSha256: prepared.configSha256, offerSha256: prepared.offerSha256, intentId: input.intentId };
    await createFile(join(session.directory, 'buyers', item + '.manifest.json'), bytes(record));
    await syncDirectory(join(session.directory, 'buyers'));
    return { ...prepared, id: item, path: join(session.directory, 'buyers', item + '.json') };
  }
  async function sessionFor(selected) {
    id(selected);
    if (sessions.has(selected)) return sessions.get(selected);
    const pending = (async () => {
      const current = await state();
      if (!current.publications.includes(selected)) throw fault('PUBLICATION_NOT_FOUND', 'Select a saved dataset publication.', 404);
      const location = join(root, 'publications', selected);
      const link = await readJson(join(location, 'publication.json'), 1048576);
      if (link.schema !== 'stellar-forge.risingwave-browser-publication.v1' || link.id !== selected) throw fault('PUBLICATION_REFERENCE_INVALID');
      const source = await revision(link.revision);
      if (source.id !== link.sourceRevisionId || source.sourceHash !== link.sourceHash || source.merchantHash !== link.merchantHash ||
          !Object.hasOwn(source.source.queries, link.query) || digest(bytes(source.merchant)) !== digest(bytes(link.merchant)))
        throw fault('PUBLICATION_SOURCE_BINDING_CHANGED', 'Use this publication’s original saved source and merchant terms.', 409);
      const boundSource = { ...source.source, queries: { [link.query]: source.source.queries[link.query] } };
      const sourceFile = join(location, 'source.json');
      if (digest(await readPrivate(sourceFile, 1048576)) !== link.publicationSourceHash ||
          digest(bytes(boundSource)) !== link.publicationSourceHash)
        throw fault('PUBLICATION_REPORT_BINDING_CHANGED', 'Retain the exact selected report for this dataset product.', 409);
      const publisherDirectory = join(location, 'publisher');
      const publisher = await openRisingWavePublisher({ directory: publisherDirectory, create: !await exists(publisherDirectory),
        sourceFile, targetDirectory: join(location, 'dataset'), environment });
      const session = { directory: location, link, publisher, console: null, seller: null, startError: null };
      try {
        const intent = await readJson(join(location, 'service-intent.json'), 4096).catch(issue => {
          if (issue.code !== 'ENOENT') throw issue; return null;
        });
        if (intent?.running) {
          try { await startSeller(session, false); } catch (issue) { session.startError = issue.message; }
        }
        const surface = { ...publisher,
          status: options => ({ ...publisher.status(options), buyer: session.seller ?
            { seller: session.seller.url, resource: link.merchant.publicOrigin + link.path } : null }),
          buyerOffer: (runId, query) => offer(session, runId, query),
          prepareBuyer: (runId, input) => buyer(session, runId, input),
        };
        session.console = await startPostgresPublisherServer({ publisher: surface, port: 0 });
        return session;
      } catch (issue) { await session.seller?.close(); await publisher.close(); throw issue; }
    })();
    sessions.set(selected, pending);
    try { return await pending; } catch (issue) { sessions.delete(selected); throw issue; }
  }
  async function publicationView(session) {
    const buyers = [];
    for (const name of (await readdir(join(session.directory, 'buyers'))).filter(name => name.endsWith('.manifest.json')).sort().reverse().slice(0, 20))
      buyers.push(await readJson(join(session.directory, 'buyers', name), 16384));
    return { ...session.link, consoleUrl: session.console.url, seller: sellerView(session), startError: session.startError,
      status: session.publisher.status({ limit: 20 }), target: await session.publisher.target(),
      schedule: session.console.schedule.status({ limit: 10 }), buyers };
  }
  async function inspectPublication(selected) { return publicationView(await sessionFor(selected)); }
  async function createPublication(input) {
    fields(input, ['expectedRevision', 'query', 'path', 'publicationId']);
    return mutate(async () => {
      const saved = await expected(input.expectedRevision);
      if (!saved || !Object.hasOwn(saved.source.queries, input.query)) throw fault('RISINGWAVE_REPORT_REQUIRED', 'Save and select a RisingWave report.');
      if (!saved.merchant) throw fault('MERCHANT_TERMS_REQUIRED', 'Save the public merchant origin and payment choices first.');
      const selected = input.publicationId ?? key('publication');
      id(selected); if (!selected.startsWith('publication-')) throw fault('PUBLICATION_ID_INVALID');
      const currentState = await state();
      if (currentState.publications.includes(selected)) {
        const retained = await inspectPublication(selected);
        if (retained.revision !== saved.revision || retained.query !== input.query || retained.path !== resourcePath(input.path) ||
            retained.sourceHash !== saved.sourceHash || retained.merchantHash !== saved.merchantHash) throw fault('PUBLICATION_REQUEST_CHANGED');
        return retained;
      }
      const location = await directory(join(root, 'publications', selected));
      await directory(join(location, 'buyers'));
      const boundSource = bytes({ ...saved.source, queries: { [input.query]: saved.source.queries[input.query] } });
      const link = { schema: 'stellar-forge.risingwave-browser-publication.v1', id: selected, createdAt: timestamp(),
        revision: saved.revision, sourceRevisionId: saved.id, sourceHash: saved.sourceHash, merchantHash: saved.merchantHash,
        publicationSourceHash: digest(boundSource), query: input.query, path: resourcePath(input.path), merchant: structuredClone(saved.merchant) };
      await createFile(join(location, 'source.json'), boundSource);
      await createFile(join(location, 'publication.json'), bytes(link)); await syncDirectory(location);
      const current = await state(); current.publications.push(selected); current.updatedAt = timestamp();
      await atomicJson(root, 'workspace.json', current);
      return inspectPublication(selected);
    });
  }
  async function publicationAction(selected, action, input = {}) {
    fields(input, action === 'buyer' ? ['runId', 'query', 'intentId', 'acceptIndex', 'offerSha256'] : []);
    return mutate(async () => {
      const session = await sessionFor(selected);
      if (action === 'seller/start') { await startSeller(session); return publicationView(session); }
      if (action === 'seller/stop') {
        if (session.publisher.status().active || session.console.schedule.status().active)
          throw fault('PUBLICATION_BUSY', 'Wait for the current source read or publication to finish before closing its seller.', 409);
        await session.console.schedule.pause({ revision: session.console.schedule.status().revision });
        await session.seller?.close(); session.seller = null; await setServiceIntent(session, false);
        return publicationView(session);
      }
      if (action === 'buyer') return buyer(session, input.runId, input);
      throw fault('WORKSPACE_ACTION_NOT_FOUND', 'Action not found.', 404);
    });
  }
  async function buyerOffer(selected, runId, query) { return offer(await sessionFor(selected), runId, query); }
  async function inspectRun(selected, runId) { return (await sessionFor(selected)).publisher.inspect(runId); }
  async function candidateFile(selected, runId, name) {
    const session = await sessionFor(selected), candidate = await session.publisher.candidate(runId);
    const types = { 'data.csv': 'text/csv; charset=utf-8', 'dataset.json': 'application/json', 'candidate.json': 'application/json' };
    if (!Object.hasOwn(types, name)) throw fault('WORKSPACE_FILE_NOT_FOUND', 'File not found.', 404);
    const handle = await open(join(session.publisher.directory, 'runs', runId, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || (name === 'data.csv' ? info.size !== candidate.manifest.csvBytes : info.size > 16777216))
        throw fault('CANDIDATE_FILE_CHANGED');
      return { handle, size: info.size, name, type: types[name] };
    } catch (issue) { await handle.close(); throw issue; }
  }
  async function file(kind, selected, name) {
    if (kind === 'revision') {
      const saved = await revision(Number(selected));
      if (!['source.json', 'merchant.json'].includes(name)) throw fault('WORKSPACE_FILE_NOT_FOUND', 'File not found.', 404);
      return { bytes: await readPrivate(join(root, 'revisions', saved.id, name), 1048576), name, type: 'application/json' };
    }
    if (kind === 'buyer') {
      const session = await sessionFor(selected); id(name);
      const record = await readJson(join(session.directory, 'buyers', name + '.manifest.json'), 16384);
      const content = await readPrivate(join(session.directory, 'buyers', name + '.json'), 1048576);
      if (digest(content) !== record.configSha256) throw fault('BUYER_REQUEST_BYTES_CHANGED');
      return { bytes: content, name: 'RisingWave-Dataset-Buyer-' + name + '.json', type: 'application/json' };
    }
    throw fault('WORKSPACE_FILE_NOT_FOUND', 'File not found.', 404);
  }
  async function inspect() {
    const current = await state(), saved = await revision();
    const publications = [];
    for (const selected of current.publications) {
      const session = await sessionFor(selected), status = session.publisher.status({ limit: 1 });
      publications.push({ ...session.link, consoleUrl: session.console.url, seller: sellerView(session), startError: session.startError,
        active: status.active, runs: status.pages?.runs?.total ?? status.runs.length, schedule: session.console.schedule.status({ limit: 1 }) });
    }
    const requiredEnvironment = [...new Set(['connectionStringEnv', 'caFileEnv']
      .map(name => saved?.source[name]).filter(value => typeof value === 'string'))];
    return { schema: SCHEMA, directory: root, revision: saved?.revision ?? 0, savedAt: saved?.savedAt ?? null,
      sourceHash: saved?.sourceHash ?? null, source: saved?.source ?? null, merchant: saved?.merchant ?? null,
      requiredEnvironment, environment: requiredEnvironment.map(name => ({ name, configured: Boolean(environment[name]) })),
      history: current.revisions.slice().reverse(), publications };
  }
  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      // Stop current native cursors, then settle every admitted operation before
      // closing publishers or releasing the original workspace lease.
      for (const task of captureTasks.values()) task.controller.abort();
      const stoppingSources = Promise.allSettled([...sources].map(source => source.close()));
      await Promise.allSettled([...operations]);
      await queue;
      const stoppedSources = await stoppingSources;
      const opened = await Promise.allSettled([...sessions.values()]);
      try {
        const results = await Promise.allSettled(opened.filter(item => item.status === 'fulfilled').map(async item => {
          try { await item.value.console.close(); } finally { await item.value.seller?.close(); }
        }));
        const failed = [...stoppedSources, ...results].find(item => item.status === 'rejected');
        if (failed) throw failed.reason;
      } finally { await release(); }
    })(); return closing;
  }
  try {
    for (const name of ['revisions', 'publications', 'samples', 'captures', 'comparisons', 'subscriptions']) await directory(join(root, name));
    const retained = await exists(join(root, 'workspace.json'));
    if (retained && (sourcePath || merchantPath)) throw fault('WORKSPACE_ALREADY_INITIALIZED', 'Reopen this workspace without import paths; edit its retained revisions in the browser.');
    if (!retained) {
      await atomicJson(root, 'workspace.json', { schema: SCHEMA, createdAt: timestamp(), revisions: [], publications: [] });
      if (sourcePath) await save({ expectedRevision: 0, source: await readJson(resolve(sourcePath), 1048576),
        merchant: merchantPath ? await readJson(resolve(merchantPath), 1048576) : null });
      else if (merchantPath) throw fault('RISINGWAVE_SOURCE_REQUIRED', 'Import the source file alongside its merchant settings.');
    }
    for (const name of (await readdir(join(root, 'captures'))).filter(name => /^capture-[a-z0-9-]+\.json$/.test(name))) {
      const record = await captureRecord(name.slice(0,-5));
      if (record.state === 'CAPTURING') {
        record.state = 'INTERRUPTED'; record.interruptedAt = timestamp();
        await atomicJson(join(root, 'captures'), name, record);
      }
    }
    await inspect();
    return { directory: root,
      ...Object.fromEntries(Object.entries({ inspect, revision, save, catalogue, compileReport, subscriptionInspect, subscriptionPrepare, subscriptionCreate, subscriptionRecord, subscriptions, sample, capture, captures, captureRecord, cancelCapture, recoverCapture, captureFile, captureChunk, compareCaptures,
        publicationCommand, createPublication,
        inspectPublication, publicationAction, buyerOffer, inspectRun, candidateFile, file })
        .map(([name, action]) => [name, admitted(action)])),
      close };
  } catch (issue) { await close(); throw issue; }
}
