// MIT. Private SFTP source authoring and original retained dataset operations.
import { lstat, open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateSftpSource, openSftpSourceFile } from '../config.mjs';
import { openSftpPublisher } from '../publisher/model.mjs';
import { startPostgresPublisherServer } from '../../postgres/publisher/server.mjs';
import { acquireWorkspace, privateDirectory, readPrivate, readJson, createFile, atomicJson,
  bytes, digest, fault, syncDirectory } from '../../postgres/publisher/files.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../../dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from '../../dataset-refresh/service.mjs';
import { readDatasetBuyerOffer, prepareDatasetBuyer } from '../../dataset-refresh/buyer-handoff.mjs';
import { datasetQueryParameters } from '../../dataset-cli.mjs';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../../seller.mjs';

const SCHEMA = 'stellar-forge.sftp-authoring-workspace.v1';
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
    description: value.description ?? 'Retained dataset from a private SFTP report',
    serviceName: value.serviceName ?? 'SFTP datasets', tags: value.tags ?? ['sftp', 'dataset'],
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
    serviceName: link.merchant.serviceName, tags: [...new Set([...link.merchant.tags, 'sftp', 'dataset'])],
    ...(link.merchant.paymentOptions ? { paymentOptions: structuredClone(link.merchant.paymentOptions) } :
      { payment: structuredClone(link.merchant.payment) }),
    queryParameters: [...datasetQueryParameters(description), { ...DATASET_SNAPSHOT_PARAMETER }],
    outputExample: { schema: 'stellar-forge.dataset-page.v1', rows: [],
      page: { limit: description.defaultLimit, total: 0, returned: 0, nextCursor: null } } };
  paymentRequiredResponse(compileHttpSellerOffer({ ...definition, url: link.merchant.publicOrigin + link.path }));
  return { schema: 'stellar-forge.seller-service.v1', publicOrigin: link.merchant.publicOrigin,
    routes: [{ id: 'dataset', path: link.path, definition, handler: 'queryDataset', admit: 'admitDataset' }] };
}

export async function openSftpWorkbench({ directory: selectedDirectory, sourcePath, merchantPath,
  environment = process.env, datasetNativeFactory = null } = {}) {
  if (typeof selectedDirectory !== 'string' || !selectedDirectory) throw fault('WORKSPACE_DIRECTORY_REQUIRED');
  const root = resolve(selectedDirectory);
  await directory(root);
  const release = await acquireWorkspace(root);
  const sessions = new Map(), operations = new Set(), sources = new Set();
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
      validateSftpSource(source);
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
  async function withSource(input, action) {
    const saved = await expected(input.expectedRevision);
    if (!saved) throw fault('SFTP_SOURCE_REQUIRED', 'Save this connection before inspecting its files.');
    const captureDirectory = await directory(join(root, 'captures'));
    const opened = await openSftpSourceFile(saved.sourceFile, { env: environment, captureDirectory });
    sources.add(opened.source);
    try {
      if (closed) throw fault('WORKSPACE_CLOSED', 'Reopen this private workspace.', 409);
      return await action(opened.source, saved);
    } finally {
      try { await opened.source.close(); }
      finally { sources.delete(opened.source); }
    }
  }
  async function catalogue(input) {
    fields(input, ['expectedRevision', 'path', 'limit', 'offset']);
    return withSource(input, async (source, saved) => ({ revision: saved.revision,
      catalogue: await source.catalogue({ path: input.path ?? '', limit: input.limit ?? 200, offset: input.offset ?? 0 }) }));
  }
  async function sample(input) {
    fields(input, ['expectedRevision', 'path', 'format', 'recordsPointer', 'limit']);
    return withSource(input, async (source, saved) => {
      const sample = await source.sampleFile({ path: input.path, format: input.format,
        recordsPointer: input.recordsPointer ?? '', limit: input.limit ?? 20 });
      const record = { id: key('sample'), revision: saved.revision, capturedAt: timestamp(), sample };
      await createFile(join(root, 'samples', record.id + '.json'), bytes(record));
      await syncDirectory(join(root, 'samples')); return record;
    });
  }
  const sellerView = session => session.seller ? { origin: session.seller.origin, mode: session.seller.mode,
    docs: session.seller.origin + '/_seller/docs', startedAt: session.startedAt } : null;
  async function setServiceIntent(session, running) {
    await atomicJson(session.directory, 'service-intent.json', { schema: 'stellar-forge.sftp-dataset-service-intent.v1', running, savedAt: timestamp() });
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
    return readDatasetBuyerOffer({ seller: session.seller.origin, resource: session.link.merchant.publicOrigin + session.link.path, snapshot, query });
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
      if (link.schema !== 'stellar-forge.sftp-browser-publication.v1' || link.id !== selected) throw fault('PUBLICATION_REFERENCE_INVALID');
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
      const publisher = await openSftpPublisher({ directory: publisherDirectory, create: !await exists(publisherDirectory),
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
            { seller: session.seller.origin, resource: link.merchant.publicOrigin + link.path } : null }),
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
    fields(input, ['expectedRevision', 'query', 'path']);
    return mutate(async () => {
      const saved = await expected(input.expectedRevision);
      if (!saved || !Object.hasOwn(saved.source.queries, input.query)) throw fault('SFTP_REPORT_REQUIRED', 'Save and select an SFTP report.');
      if (!saved.merchant) throw fault('MERCHANT_TERMS_REQUIRED', 'Save the public merchant origin and payment choices first.');
      const selected = key('publication'), location = await directory(join(root, 'publications', selected));
      await directory(join(location, 'buyers'));
      const boundSource = bytes({ ...saved.source, queries: { [input.query]: saved.source.queries[input.query] } });
      const link = { schema: 'stellar-forge.sftp-browser-publication.v1', id: selected, createdAt: timestamp(),
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
      return { bytes: content, name: 'SFTP-Dataset-Buyer-' + name + '.json', type: 'application/json' };
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
    const auth = saved?.source.connection.auth ?? {};
    const requiredEnvironment = Object.values(auth).filter(value => typeof value === 'string');
    return { schema: SCHEMA, directory: root, revision: saved?.revision ?? 0, savedAt: saved?.savedAt ?? null,
      sourceHash: saved?.sourceHash ?? null, source: saved?.source ?? null, merchant: saved?.merchant ?? null,
      requiredEnvironment, environment: requiredEnvironment.map(name => ({ name, configured: Boolean(environment[name]) })),
      history: current.revisions.slice().reverse(), publications };
  }
  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      // Stop current SSH reads, then settle every admitted operation before
      // closing publishers or releasing the original workspace lease.
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
    for (const name of ['revisions', 'publications', 'samples', 'captures']) await directory(join(root, name));
    const retained = await exists(join(root, 'workspace.json'));
    if (retained && (sourcePath || merchantPath)) throw fault('WORKSPACE_ALREADY_INITIALIZED', 'Reopen this workspace without import paths; edit its retained revisions in the browser.');
    if (!retained) {
      await atomicJson(root, 'workspace.json', { schema: SCHEMA, createdAt: timestamp(), revisions: [], publications: [] });
      if (sourcePath) await save({ expectedRevision: 0, source: await readJson(resolve(sourcePath), 1048576),
        merchant: merchantPath ? await readJson(resolve(merchantPath), 1048576) : null });
      else if (merchantPath) throw fault('SFTP_SOURCE_REQUIRED', 'Import the source file alongside its merchant settings.');
    }
    await inspect();
    return { directory: root,
      ...Object.fromEntries(Object.entries({ inspect, revision, save, catalogue, sample, createPublication,
        inspectPublication, publicationAction, buyerOffer, inspectRun, candidateFile, file })
        .map(([name, action]) => [name, admitted(action)])),
      close };
  } catch (issue) { await close(); throw issue; }
}
