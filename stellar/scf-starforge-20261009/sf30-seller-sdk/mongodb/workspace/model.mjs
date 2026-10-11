// MIT. Browser operations compose the native immutable plan store and original seller/buyer.
import { mkdir, lstat, readdir, rename, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createMongoWorkspace, openMongoWorkspace, saveMongoWorkspacePlan, inspectMongoWorkspace,
  previewMongoWorkspace, prepareMongoWorkspace, listMongoWorkspaceRevisions } from '../onboarding.mjs';
import { compileMongoMerchantPlan, verifyPreparedMongoSeller } from '../prepare.mjs';
import { validateMongoSource } from '../config.mjs';
import { startMongoSeller } from '../merchant.mjs';
import { readMongoBuyerOffer, prepareMongoBuyer } from '../buyer.mjs';
import { openMongoPublisher } from '../publisher/model.mjs';
import { openPostgresSchedule } from '../../postgres/publisher/schedule.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../../dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from '../../dataset-refresh/service.mjs';
import { readDatasetBuyerOffer, prepareDatasetBuyer } from '../../dataset-refresh/buyer-handoff.mjs';
import { datasetQueryParameters } from '../../dataset-cli.mjs';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../../seller.mjs';
import { encode, digest, limited, readJson, writeNew, privateDirectory, syncDirectory } from '../common.mjs';

const ITEM = /^[a-z][a-z0-9-]{0,95}$/;
const identifier = value => {
  if (typeof value !== 'string' || !ITEM.test(value)) throw new TypeError('Select an existing workspace item');
  return value;
};
const key = prefix => prefix + '-' + Date.now() + '-' + randomUUID();
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const conflict = message => Object.assign(new Error(message), { status: 409 });
const READ_LIMIT = 16 * 1024 * 1024;
async function ensureDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateDirectory(path);
}

/** A portable standard tar.gz containing only the already verified named files. */
function archive(files, prefix) {
  const blocks = [];
  for (const [name, bytes] of Object.entries(files)) {
    const path = prefix + '/' + name, header = Buffer.alloc(512);
    if (Buffer.byteLength(path) > 100 || !Buffer.isBuffer(bytes)) throw new TypeError('Unsupported package member');
    header.write(path, 0, 100, 'utf8');
    const octal = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
    octal(0o600, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(bytes.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii'); header.write('merchant', 265, 32, 'ascii');
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 6 });
}

const RELOCATE_BUYER = [
  '// MIT. Retain the original request and terms; resolve the saved body locally.',
  "import { readFile, writeFile } from 'node:fs/promises';",
  "import { createHash } from 'node:crypto';",
  "import { dirname, resolve } from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  'const root = dirname(fileURLToPath(import.meta.url));',
  "const manifest = JSON.parse(await readFile(resolve(root, 'buyer-manifest.json'), 'utf8'));",
  'for (const [name, binding] of Object.entries(manifest.files)) {',
  '  const bytes = await readFile(resolve(root, name));',
  "  if (bytes.length !== binding.bytes || createHash('sha256').update(bytes).digest('hex') !== binding.sha256)",
  "    throw new Error('Retained buyer file changed: ' + name);",
  '}',
  "const config = JSON.parse(await readFile(resolve(root, 'review.json'), 'utf8'));",
  "if (config.operation.bodyFile) config.operation.bodyFile = resolve(root, 'request-body.json');",
  "const output = resolve(root, 'review.local.json');",
  "await writeFile(output, JSON.stringify(config, null, 2) + '\\n', { mode: 0o600, flag: 'wx' });",
  'console.log(JSON.stringify({ config: output, intentId: config.operation.intentId, seller: config.operation.url }));',
  '',
].join('\n');

export async function openMongoWorkbench({ directory, sourcePath, planPath, environment = process.env,
  datasetNativeFactory = null } = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('Supply the private native workspace directory');
  const root = resolve(directory);
  let exists = true; try { await lstat(root); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
  if (!exists) await createMongoWorkspace({ directory: root, sourceFile: sourcePath, planFile: planPath });
  else if (sourcePath || planPath) throw new TypeError('Reopen an existing workspace with --state only; edit its retained source and plan in the browser');
  await openMongoWorkspace(root);
  const browser = await ensureDirectory(join(root, 'browser'));
  for (const name of ['catalogues', 'results', 'packages', 'package-links', 'buyers',
    'publications', 'publication-links', 'dataset-buyers']) await ensureDirectory(join(browser, name));
  let seller = null;
  const publicationSessions = new Map();
  const path = (kind, item) => join(browser, kind, identifier(item));
  const reopenCommand = 'node ' + quote(fileURLToPath(new URL('./server.mjs', import.meta.url))) + ' --state ' + quote(root);
  async function current(expectedRevision) {
    const snapshot = await openMongoWorkspace(root);
    if (expectedRevision !== undefined && snapshot.revision !== expectedRevision)
      throw conflict('A newer native revision has been saved. Reload it or retain your draft and reconcile the changes.');
    return snapshot;
  }
  async function writeRecord(kind, id, value) {
    const destination = path(kind, id) + '.json';
    await writeNew(destination, encode(value)); await syncDirectory(join(browser, kind));
    return destination;
  }
  async function records(kind) {
    const entries = await readdir(join(browser, kind), { withFileTypes: true });
    return entries.filter(item => item.isFile() && item.name.endsWith('.json') && ITEM.test(item.name.slice(0, -5)))
      .map(item => item.name.slice(0, -5)).sort().reverse();
  }
  function review(source, plan) {
    const config = validateMongoSource(source), compiled = compileMongoMerchantPlan(config.queries, plan);
    return { database: config.connection.database, queryCount: Object.keys(config.queries).length,
      publicOrigin: plan.publicOrigin, routes: compiled.service.routes.map(item => {
        const original = plan.routes.find(route => route.id === item.id), query = config.queries[original.query];
        return { id: item.id, query: original.query, method: original.method, url: item.offer.resource.url,
          description: original.description, collection: query.collection, readConcern: query.readConcern ?? 'snapshot',
          columns: structuredClone(query.columns), parameters: structuredClone(query.parameters ?? {}),
          maxRows: query.maxRows ?? 100, example: structuredClone(original.example), offer: structuredClone(item.offer) };
      }) };
  }
  async function catalogue({ expectedRevision, collections, sampleSize = 200 } = {}) {
    const snapshot = await current(expectedRevision);
    const value = await inspectMongoWorkspace(root, { environment, ...(collections === undefined ? {} : { collections }), sampleSize });
    if (value.revision !== snapshot.revision) throw conflict('The source revision changed during catalogue inspection. Inspect the current saved source.');
    const id = key('catalogue'), result = { id, revision: snapshot.revision, capturedAt: new Date().toISOString(), catalogue: value };
    await writeRecord('catalogues', id, result); return result;
  }
  async function preview({ expectedRevision, query, input } = {}) {
    const snapshot = await current(expectedRevision);
    const value = await previewMongoWorkspace({ directory: root, expectedRevision, query, input, environment });
    const id = key('result'), result = { id, revision: snapshot.revision, query, input,
      createdAt: new Date().toISOString(), result: value };
    await writeRecord('results', id, result); return result;
  }
  function sellerView() {
    return seller ? { packageId: seller.packageId, origin: seller.origin, mode: seller.mode,
      operationsUrl: seller.operationsUrl, startedAt: seller.startedAt } : null;
  }
  async function inspectPackage(id) {
    identifier(id);
    const link = await readJson(path('package-links', id) + '.json');
    if (link.id !== id || !Number.isSafeInteger(link.revision)) throw new TypeError('Invalid browser package reference');
    const manifest = await verifyPreparedMongoSeller(path('packages', id));
    if (manifest.manifestSha256 !== link.manifestSha256) throw conflict('The retained package manifest changed');
    const plan = await readJson(join(manifest.directory, 'merchant-plan.json'));
    const command = 'Reopen this authoring workspace:\n' + reopenCommand + '\n\nPrepared native seller package:\n' + manifest.directory +
      '\n\nUse the native MongoDB launcher with source.json and service.json. Its environment references are: ' +
      manifest.requiredEnvironment.join(', ') + '.\nThe browser can start this same package and open its original operations console.';
    return { ...link, manifest, plan, commands: command, seller: sellerView() };
  }
  async function prepare({ expectedRevision } = {}) {
    const id = key('package'), manifest = await prepareMongoWorkspace({ directory: root,
      destination: path('packages', id), expectedRevision });
    await verifyPreparedMongoSeller(manifest.directory);
    await writeRecord('package-links', id, { id, revision: manifest.workspaceRevision,
      createdAt: manifest.createdAt, manifestSha256: manifest.manifestSha256 });
    return inspectPackage(id);
  }
  async function packages() {
    const items = [];
    for (const id of (await records('package-links')).slice(0, 100)) {
      const item = await readJson(path('package-links', id) + '.json');
      items.push({ id, revision: item.revision, createdAt: item.createdAt });
    }
    return { items };
  }
  async function stopSeller() {
    if (seller) { const previous = seller; seller = null; await previous.session.close(); }
    return { status: 'STOPPED' };
  }
  async function startSeller(packageId) {
    const item = await inspectPackage(packageId);
    if (seller) {
      if (seller.packageId === packageId) return sellerView();
      throw conflict('Stop the running seller before starting another prepared package');
    }
    const session = await startMongoSeller({ sourceFile: join(item.manifest.directory, 'source.json'),
      configFile: join(item.manifest.directory, 'service.json'), port: 0, operationsPort: 0, environment });
    try {
      const response = await fetch(session.url + '/_seller/health', { signal: AbortSignal.timeout(10000) });
      if (response.status !== 200) throw new Error('The original seller health check failed');
      const health = await response.json();
      seller = { packageId, session, origin: session.url, mode: health.mode,
        operationsUrl: session.operations?.url ?? null, startedAt: new Date().toISOString() };
      return sellerView();
    } catch (error) { await session.close(); throw error; }
  }
  async function buyer({ packageId, routeId, input, acceptIndex, intentId } = {}) {
    if (!seller || seller.packageId !== packageId) throw conflict('Start the selected package’s local seller before preparing a buyer request');
    const item = await inspectPackage(packageId);
    const [source, service] = await Promise.all([readJson(join(item.manifest.directory, 'source.json')),
      readJson(join(item.manifest.directory, 'service.json'), 1048576)]);
    const review = await readMongoBuyerOffer({ seller: seller.origin, source, service, routeId, input });
    const id = key('buyer'), target = path('buyers', id), bodyFile = join(target, 'request-body.json');
    const prepared = prepareMongoBuyer(review, { intentId, acceptIndex, offerSha256: review.offerSha256,
      ...(review.bodyText === undefined ? {} : { bodyFile }) });
    await mkdir(target, { mode: 0o700 });
    const files = { 'review.json': Buffer.from(prepared.configText),
      'original-offer.json': encode(review),
      ...(review.bodyText === undefined ? {} : { 'request-body.json': Buffer.from(review.bodyText) }),
      'relocate.mjs': Buffer.from(RELOCATE_BUYER),
      'README.md': Buffer.from('# MongoDB buyer request\n\nThis package retains the selected live seller offer, exact request inputs and original SF88 buyer review.\n\n' +
        'Run node relocate.mjs after unpacking. It checks the original retained files and creates review.local.json, resolving the request body beside that file. ' +
        'The resource, method, intent and payment terms remain unchanged. Review that local file with the original SF88 buyer workflow and your existing operator settings.\n\n' +
        'Selected source package: ' + packageId + '\nSaved revision: ' + item.revision + '\nSeller mode at preparation: ' + prepared.sellerMode + '\n') };
    const manifest = { schema: 'stellar-forge.mongodb-browser-buyer.v1', id, packageId, revision: item.revision,
      routeId, createdAt: new Date().toISOString(), configSha256: prepared.configSha256, offerSha256: prepared.offerSha256,
      files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: digest(bytes) }])) };
    for (const [name, bytes] of Object.entries(files)) await writeNew(join(target, name), bytes);
    await writeNew(join(target, 'buyer-manifest.json'), encode(manifest)); await syncDirectory(target);
    return { id, view: { id, packageId, revision: item.revision, routeId, intentId, acceptIndex,
      sellerMode: prepared.sellerMode, request: { url: review.url, method: review.method, input: review.input },
      acceptedTerms: prepared.config.operation.expect, configSha256: prepared.configSha256,
      offerSha256: prepared.offerSha256 } };
  }
  function publicationSellerView(session) {
    return session.service ? { origin: session.service.url, mode: session.service.mode,
      resource: session.link.publicOrigin + session.link.path, startedAt: session.startedAt,
      docs: session.service.url + '/_seller/docs' } : null;
  }
  function datasetConfig(link, description) {
    const queryParameters = [...datasetQueryParameters(description), { ...DATASET_SNAPSHOT_PARAMETER }];
    const definition = { method: 'GET', description: link.description,
      serviceName: link.serviceName, tags: [...new Set([...link.tags, 'dataset'])],
      ...structuredClone(link.terms), queryParameters,
      outputExample: { schema: 'stellar-forge.dataset-page.v1', rows: [],
        page: { limit: description.defaultLimit, total: 0, returned: 0, nextCursor: null } } };
    paymentRequiredResponse(compileHttpSellerOffer({ ...definition, url: link.publicOrigin + link.path }));
    return { schema: 'stellar-forge.seller-service.v1', publicOrigin: link.publicOrigin,
      routes: [{ id: 'dataset', path: link.path, definition, handler: 'queryDataset', admit: 'admitDataset' }] };
  }
  async function serviceIntent(session, running) {
    const target = join(session.directory, 'service-intent.json'), temporary = target + '.' + randomUUID();
    await writeNew(temporary, encode({ schema: 'stellar-forge.mongodb-dataset-service-intent.v1',
      running, savedAt: new Date().toISOString() }));
    await rename(temporary, target); await syncDirectory(session.directory);
  }
  async function startPublicationService(session, persist = true) {
    if (session.service) return publicationSellerView(session);
    if ((await session.publisher.target()).initializable)
      throw conflict('Publish the first reviewed candidate before starting this dataset seller');
    const versions = await openDatasetVersions({ directory: session.publisher.settings.targetDirectory });
    let service;
    try {
      const config = datasetConfig(session.link, versions.describe()), configFile = join(session.directory, 'seller.json');
      try { await writeNew(configFile, encode(config)); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (digest(await limited(configFile, 1048576)) !== digest(encode(config)))
          throw conflict('The retained seller configuration differs from this publication’s source contract');
      }
      service = await startVersionedDatasetSeller({ versions, config, port: 0,
        nativeFactory: datasetNativeFactory, controlTransport: 'loopback' });
      session.service = service; session.startedAt = new Date().toISOString(); session.startError = null;
      if (persist) await serviceIntent(session, true);
      return publicationSellerView(session);
    } catch (error) {
      session.service = null;
      if (service) await service.close(); else await versions.close();
      throw error;
    }
  }
  async function publication(id) {
    identifier(id);
    if (publicationSessions.has(id)) return publicationSessions.get(id);
    const opening = (async () => {
      const link = await readJson(path('publication-links', id) + '.json');
      if (link.schema !== 'stellar-forge.mongodb-browser-publication.v1' || link.id !== id ||
          !Number.isSafeInteger(link.revision)) throw new TypeError('Invalid retained publication reference');
      const directory = await privateDirectory(path('publications', id));
      const revision = await openMongoWorkspace(root, { revision: link.revision });
      const publisher = await openMongoPublisher({ directory: join(directory, 'publisher'),
        sourceFile: revision.sourceFile, targetDirectory: join(directory, 'dataset'), environment });
      let schedule;
      try {
        schedule = await openPostgresSchedule({ publisher });
        const session = { id, directory, link, publisher, schedule, service: null, startError: null };
        let intent;
        try { intent = await readJson(join(directory, 'service-intent.json')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (intent?.running === true) {
          try { await startPublicationService(session, false); }
          catch (error) { session.startError = error.message; }
        }
        schedule.start(); return session;
      } catch (error) { await schedule?.close(); await publisher.close(); throw error; }
    })();
    publicationSessions.set(id, opening);
    try { return await opening; }
    catch (error) { publicationSessions.delete(id); throw error; }
  }
  async function createPublication({ expectedRevision, routeId, path: resourcePath } = {}) {
    const snapshot = await current(expectedRevision), route = snapshot.plan.routes.find(item => item.id === routeId);
    if (!route) throw new TypeError('Select a merchant route from this saved revision');
    review(snapshot.source, snapshot.plan);
    if (typeof resourcePath !== 'string' || !/^\/[A-Za-z0-9_.~/-]+$/.test(resourcePath) ||
        resourcePath.includes('//') || resourcePath === '/_seller' || resourcePath.startsWith('/_seller/') ||
        new URL(resourcePath, snapshot.plan.publicOrigin).pathname !== resourcePath)
      throw new TypeError('Choose a fixed application path for this dataset');
    const payment = Object.hasOwn(route, 'paymentOptions') || Object.hasOwn(route, 'payment') ? route : snapshot.plan;
    const id = key('publication'), directory = path('publications', id);
    const link = { schema: 'stellar-forge.mongodb-browser-publication.v1', id, revision: snapshot.revision,
      createdAt: new Date().toISOString(), query: route.query, routeId: route.id,
      publicOrigin: new URL(snapshot.plan.publicOrigin).origin, path: resourcePath,
      description: route.description, serviceName: route.serviceName, tags: structuredClone(route.tags ?? []),
      example: structuredClone(route.example ?? {}),
      terms: Object.hasOwn(payment, 'paymentOptions') ? { paymentOptions: structuredClone(payment.paymentOptions) } :
        { payment: structuredClone(payment.payment) } };
    await mkdir(directory, { mode: 0o700 });
    const publisher = await openMongoPublisher({ directory: join(directory, 'publisher'), create: true,
      sourceFile: snapshot.sourceFile, targetDirectory: join(directory, 'dataset'), environment });
    let schedule;
    try {
      schedule = await openPostgresSchedule({ publisher });
      await writeRecord('publication-links', id, link);
      const session = { id, directory, link, publisher, schedule, service: null, startError: null };
      publicationSessions.set(id, Promise.resolve(session)); schedule.start();
      return inspectPublication(id);
    } catch (error) { await schedule?.close(); await publisher.close(); throw error; }
  }
  async function publications() {
    const items = [];
    for (const id of await records('publication-links')) {
      const link = await readJson(path('publication-links', id) + '.json');
      items.push({ id, revision: link.revision, query: link.query, routeId: link.routeId,
        resource: link.publicOrigin + link.path, createdAt: link.createdAt });
    }
    return { items };
  }
  async function inspectPublication(id, options = {}) {
    const session = await publication(id);
    return { ...session.link, source: await session.publisher.source(), snapshot: session.publisher.status(options),
      target: await session.publisher.target(), seller: publicationSellerView(session),
      startError: session.startError, schedule: session.schedule.status() };
  }
  async function publicationBuyerOffer(session, id, query = '') {
    if (!session.service) throw conflict('Start this dataset’s seller before preparing its buyer handoff');
    const candidate = await session.publisher.candidate(id), target = await session.publisher.target();
    const snapshot = candidate.manifest.dataset.snapshot, resource = session.link.publicOrigin + session.link.path;
    if (!target.connected || !target.resources?.some(item => item.resource === resource && item.snapshotSelection))
      throw conflict('The current target must advertise this publication’s snapshot-selectable resource');
    if (typeof query !== 'string' || query.length > 8192) throw new TypeError('Use a dataset query string up to 8192 characters');
    const parameters = new URLSearchParams(query);
    if (parameters.has('cursor') || parameters.has('snapshot')) throw new TypeError('Prepare the first page; select its snapshot using the retained extraction');
    parameters.set('snapshot', snapshot);
    const preview = await datasetControl(session.publisher.settings.targetDirectory, 'preview', { query: parameters.toString() });
    if (preview.dataset?.snapshot !== snapshot) throw conflict('The selected retained snapshot changed');
    return readDatasetBuyerOffer({ seller: session.service.url, resource, snapshot, query });
  }
  async function readPublication(id, operation, input = {}) {
    const session = await publication(id), publisher = session.publisher;
    if (operation === 'run') {
      const run = publisher.run(input.id);
      // In-progress and failed extractions have a useful native status even
      // before a complete immutable candidate exists.
      if (!run.data.candidate) return { run, plan: publisher.plan(run.plan), preview: null };
      return publisher.inspect(input.id, input.query);
    }
    if (operation === 'plan') return publisher.plan(input.id);
    if (operation === 'schedule') return session.schedule.status(input);
    if (operation === 'buyer') return publicationBuyerOffer(session, input.id, input.query);
    throw new TypeError('Select a publication view');
  }
  async function changePublication(id, operation, input = {}) {
    const session = await publication(id), publisher = session.publisher;
    if (operation === 'plans') {
      if (input.query !== session.link.query) throw new TypeError('This publication retains its named source report');
      return publisher.savePlan(input);
    }
    if (operation === 'extract') {
      // A browser retry retains the same native extraction rather than executing
      // a new aggregation when the first HTTP acknowledgement was lost.
      if (input.id) {
        const prior = (() => { try { return publisher.run(input.id); } catch (error) {
          if (error.code !== 'RUN_NOT_FOUND') throw error; return null;
        } })();
        if (prior) {
          if (prior.plan !== input.plan) throw conflict('This extraction identifier belongs to another saved plan');
          return { id: prior.id };
        }
      }
      return { id: publisher.startExtraction(input.plan, input.id ? { id: input.id } : {}).id };
    }
    if (operation === 'cancel') return publisher.cancel(input.id);
    if (operation === 'review') return publisher.review(input.id, input);
    if (operation === 'publish') return publisher.publish(input.id, input.reviewId);
    if (operation === 'recover') return publisher.recover(input.id);
    if (operation === 'seller/start') return startPublicationService(session);
    if (operation === 'seller/stop') {
      const schedule = session.schedule.status();
      if (schedule.enabled) await session.schedule.pause({ revision: schedule.revision });
      if (schedule.active || publisher.status().active) throw conflict('Wait for the original extraction or publication to finish, then stop the seller');
      await serviceIntent(session, false);
      const service = session.service; session.service = null; await service?.close();
      return { status: 'STOPPED' };
    }
    if (operation === 'activate') return datasetControl(publisher.settings.targetDirectory, 'activate', input);
    if (operation.startsWith('schedule/')) {
      const name = operation.slice(9);
      if (name === 'save') return session.schedule.configure(input);
      if (name === 'enable') return session.schedule.enable(input);
      if (name === 'pause') return session.schedule.pause(input);
      if (name === 'run') return { id: session.schedule.runNow(input).id };
      if (name === 'continue') return { id: session.schedule.continueRun(input).id };
    }
    if (operation === 'buyer') {
      const offer = await publicationBuyerOffer(session, input.id, input.query);
      const prepared = prepareDatasetBuyer(offer, input), buyerId = key('dataset-buyer');
      await writeRecord('dataset-buyers', buyerId, { id: buyerId, publicationId: id, run: input.id,
        createdAt: new Date().toISOString(), offer, prepared });
      return { id: buyerId, ...prepared };
    }
    throw new TypeError('Select a publication action');
  }
  async function publicationDownload(id, runId, file) {
    const session = await publication(id), candidate = await session.publisher.candidate(runId);
    const allowed = { 'data.csv': 'text/csv; charset=utf-8', 'dataset.json': 'application/json',
      'candidate.json': 'application/json' };
    if (!Object.hasOwn(allowed, file)) throw new TypeError('Select an original candidate file');
    const handle = await open(join(session.publisher.directory, 'runs', runId, file), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || (file === 'data.csv' ? info.size !== candidate.manifest.csvBytes : info.size > READ_LIMIT))
        throw conflict('The retained candidate file changed');
      return { handle, size: info.size, name: file, mime: allowed[file] };
    } catch (error) { await handle.close(); throw error; }
  }
  async function download(kind, id, file) {
    identifier(id);
    let bytes, name = file.split('/').at(-1);
    if (kind === 'packages') {
      const item = await inspectPackage(id), names = [...Object.keys(item.manifest.files), 'manifest.json'];
      if (file === 'package.tar.gz') {
        const files = {};
        for (const member of names) files[member] = await limited(join(item.manifest.directory, member), READ_LIMIT);
        bytes = archive(files, 'mongodb-merchant');
      } else {
        if (!names.includes(file)) throw new TypeError('Select an original package file');
        bytes = await limited(join(item.manifest.directory, file), READ_LIMIT);
      }
    } else if (kind === 'results' && file === 'result.json') {
      bytes = await limited(path('results', id) + '.json', READ_LIMIT);
    } else if (kind === 'buyers' && file === 'buyer.tar.gz') {
      const target = path('buyers', id), manifest = await readJson(join(target, 'buyer-manifest.json')), files = {};
      if (manifest.schema !== 'stellar-forge.mongodb-browser-buyer.v1' || manifest.id !== id) throw new TypeError('Invalid retained buyer manifest');
      const allowed = ['review.json', 'original-offer.json', 'request-body.json', 'relocate.mjs', 'README.md'];
      for (const [member, binding] of Object.entries(manifest.files)) {
        if (!allowed.includes(member)) throw new TypeError('Invalid retained buyer file');
        const data = await limited(join(target, member), READ_LIMIT);
        if (data.length !== binding.bytes || digest(data) !== binding.sha256) throw conflict('A retained buyer file changed');
        files[member] = data;
      }
      files['buyer-manifest.json'] = await limited(join(target, 'buyer-manifest.json'));
      bytes = archive(files, 'mongodb-buyer');
    } else if (kind === 'dataset-buyers' && file === 'buyer.tar.gz') {
      const record = await readJson(path('dataset-buyers', id) + '.json', READ_LIMIT);
      if (record.id !== id || digest(Buffer.from(record.prepared.configText)) !== record.prepared.configSha256)
        throw conflict('The retained original buyer configuration changed');
      bytes = archive({ 'review.json': Buffer.from(record.prepared.configText),
        'original-offer.json': encode(record.offer),
        'README.md': Buffer.from('# Dataset buyer request\n\nOpen review.json with the original SF88 buyer workflow. ' +
          'It retains the selected payment choice and immutable dataset snapshot.\n\nPublication: ' + record.publicationId +
          '\nExtraction: ' + record.run + '\nSeller mode: ' + record.prepared.sellerMode + '\n') }, 'dataset-buyer');
    } else throw new TypeError('Select an exported workspace file');
    return { bytes, name, mime: file.endsWith('.gz') ? 'application/gzip' :
      file.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8' };
  }
  async function close() {
    const sessions = await Promise.allSettled([...publicationSessions.values()]);
    const results = await Promise.allSettled([stopSeller(), ...sessions.filter(item => item.status === 'fulfilled').map(async ({ value }) => {
      try { await value.schedule.close(); } finally {
        try { await value.publisher.close(); } finally { await value.service?.close(); }
      }
    })]);
    const error = results.find(item => item.status === 'rejected'); if (error) throw error.reason;
  }
  // Reopen the original enabled seller/schedule lifetimes when the merchant
  // reopens this workbench. Database extraction remains owned by each schedule.
  try { for (const id of await records('publication-links')) await publication(id); }
  catch (error) { await close(); throw error; }
  return {
    root, review, catalogue, preview, prepare, inspectPackage, packages, startSeller, stopSeller, buyer, download,
    publications, createPublication, inspectPublication, readPublication, changePublication, publicationDownload,
    save: ({ source, plan, expectedRevision }) => saveMongoWorkspacePlan({ directory: root, source, plan, expectedRevision }),
    history: options => listMongoWorkspaceRevisions(root, options),
    revision: revision => openMongoWorkspace(root, { revision }),
    seller: sellerView,
    close,
    async bootstrap() {
      const snapshot = await current(), latest = (await records('catalogues'))[0];
      const catalogue = latest ? await readJson(path('catalogues', latest) + '.json', READ_LIMIT) : null;
      return { snapshot, commands: reopenCommand, seller: sellerView(),
        ...(catalogue?.revision === snapshot.revision ? { catalogue } : {}) };
    },
  };
}
