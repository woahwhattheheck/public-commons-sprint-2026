// MIT. Socrata editions -> original dataset publisher, SF82 and SF88/SF100.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, readdir, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { DATASET_SNAPSHOT_PARAMETER, openDatasetVersions } from '../dataset-refresh/versions.mjs';
import { datasetControl } from '../dataset-refresh/service.mjs';
import { openPublisherDrafts, pendingDraftPublication } from '../dataset-refresh/workspace-state.mjs';
import { readDatasetBuyerOffer, prepareDatasetBuyer } from '../dataset-refresh/buyer-handoff.mjs';
import { DATASET_BINDING_SCHEMA, datasetContractSha256, prepareDatasetRelease } from '../../sf82-seller-pilot/release-dataset.mjs';
import { initReleaseStore, stageRelease, inspectRelease, activateRelease,
  rollbackRelease, releaseStatus, runActiveRelease } from '../../sf82-seller-pilot/releases.mjs';

const SCHEMA = 'stellar-forge.socrata-publisher.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MiB = 1024 * 1024;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const now = () => new Date().toISOString();
const fault = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
function absolute(value, label = 'directory') {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value === '/')
    throw fault('SOCRATA_PUBLISHER_DIRECTORY', 'Use a normalized absolute ' + label + '.', 400);
  return value;
}
function only(value, names) {
  if (!object(value) || Object.keys(value).some(key => !names.includes(key)))
    throw fault('SOCRATA_PUBLISHER_FIELDS', 'The action contains unsupported fields.', 400);
}
async function absent(path) {
  try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
async function bytes(path, maximum = MiB) {
  if (await realpath(path) !== resolve(path)) throw fault('SOCRATA_SOURCE_SYMLINK', 'Use canonical retained source files.', 400);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) throw fault('SOCRATA_SOURCE_SIZE', 'The source file exceeds its supported size.', 413);
    const data = await file.readFile(), after = await file.stat({ bigint: true });
    if (BigInt(data.length) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
      throw fault('SOCRATA_SOURCE_CHANGED', 'The retained source changed while it was being read.');
    return data;
  } finally { await file.close(); }
}
async function readJson(path, maximum = MiB) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(path, maximum)));
}
async function writeNew(path, data) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
}
async function immutable(path, data) {
  try { await writeNew(path, data); }
  catch (error) { if (error.code !== 'EEXIST') throw error;
    if (!(await bytes(path, Math.max(MiB, data.length))).equals(data))
      throw fault('SOCRATA_RETAINED_FILE_CHANGED', 'The existing retained output has different content.'); }
}
async function syncDirectory(path) {
  const file = await open(path, 'r');
  try { await file.sync(); } finally { await file.close(); }
}
function expected(input) {
  if (!HASH.test(input.expectedSnapshot ?? '') || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
    throw fault('SOCRATA_PUBLICATION_REVIEW', 'Use the displayed original snapshot and revision.', 400);
  return { expectedSnapshot: input.expectedSnapshot, expectedRevision: input.expectedRevision };
}
function generation(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw fault('SOCRATA_RELEASE_REVIEW', 'Use the displayed original release generation.', 400);
  return value;
}
function queryText(value) {
  if (typeof value !== 'string' || value.length > 8192) throw fault('SOCRATA_QUERY_REQUIRED', 'Supply the original query string.', 400);
  return value.replace(/^\?/, '');
}
const publicError = error => ({ code: typeof error.code === 'string' ? error.code : 'SOCRATA_PUBLISHER_OPERATION_FAILED',
  message: error.message });

/** The original draft workspace serializes source preparation and publication.
 * The running original dataset seller exclusively owns its version writer. */
export async function openSocrataPublisher({ directory } = {}) {
  directory = absolute(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== directory) throw fault('SOCRATA_PUBLISHER_DIRECTORY', 'Use a canonical private publisher directory.');
  const datasetDirectory = join(directory, 'dataset'), releaseDirectory = join(directory, 'releases');
  const packagesDirectory = join(directory, 'packages'), sessionsDirectory = join(directory, 'sessions');
  for (const path of [packagesDirectory, sessionsDirectory]) await mkdir(path, { recursive: true, mode: 0o700 });
  const drafts = await openPublisherDrafts({ datasetDirectory, directory: join(directory, 'drafts') });
  let closed = false, tail = Promise.resolve(), running = null, ownedRelease = null, closePromise;
  try {
    if (await absent(join(releaseDirectory, 'state.json'))) await initReleaseStore(releaseDirectory);
  } catch (error) { await drafts.close(); throw error; }
  async function target({ offline = true } = {}) {
    try {
      const result = await datasetControl(datasetDirectory, 'schema');
      return { connected: true, ...result };
    } catch (error) {
      if (!['ENOENT','ECONNREFUSED','ENOTSOCK','ECONNRESET','EPIPE'].includes(error.code)) throw error;
      if (!offline) throw fault('SOCRATA_SELLER_REQUIRED', 'Start the original dataset release before publishing or querying a retained version.');
      if (await absent(join(datasetDirectory, 'state.json'))) return { connected: false, initialized: false, dataset: null, versions: null };
      // Read retained status without taking a second writer while a seller runs.
      const versions = await readJson(join(datasetDirectory, 'state.json'));
      const manifest = await readJson(join(datasetDirectory, 'versions', versions.current, 'manifest.json'));
      return { connected: false, initialized: true, dataset: manifest.dataset, versions };
    }
  }
  async function savedCandidate(id) {
    const record = drafts.candidate(id), files = drafts.files(id);
    await drafts.csv(id); await drafts.export(id);
    const dataset = await loadDatasetConfig(files.configPath);
    if (dataset.describe().snapshot !== record.dataset.snapshot)
      throw fault('SOCRATA_CANDIDATE_CHANGED', 'The retained candidate no longer matches its native dataset snapshot.');
    return { record, files, dataset };
  }
  async function sessions() {
    const rows = [];
    for (const entry of await readdir(sessionsDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      try {
        const binding = await readJson(join(sessionsDirectory, entry.name, 'binding.json'));
        const { inspectDatasetSession } = await import('../../sf88-operator-buyer-cli/dataset-session.mjs');
        const report = await inspectDatasetSession(join(sessionsDirectory, entry.name, 'acquisition'));
        rows.push({ id: entry.name, binding, report });
      } catch (error) { rows.push({ id: entry.name, error: publicError(error) }); }
    }
    return rows;
  }
  async function state() {
    if (closed) throw fault('SOCRATA_PUBLISHER_CLOSED', 'Reopen the publisher.');
    const [selected, releases, acquired] = await Promise.all([target(), releaseStatus(releaseDirectory), sessions()]);
    return { schema: SCHEMA, directory, datasetDirectory, releaseDirectory,
      target: selected, drafts: drafts.view(), releases, sessions: acquired,
      running: running ? { action: running.action, startedAt: running.startedAt } : null,
      ownsRelease: ownedRelease !== null };
  }
  async function prepare(input) {
    only(input, ['exportDirectory']);
    const sourceDirectory = absolute(input.exportDirectory, 'export directory');
    const configBytes = await bytes(join(sourceDirectory, 'dataset.json'), 65536);
    const config = JSON.parse(configBytes), csv = await bytes(join(sourceDirectory, 'dataset.csv'), 256 * MiB);
    if (config.file !== 'dataset.csv') throw fault('SOCRATA_EXPORT_CONFIG', 'Use the original export with adjacent dataset.csv.', 400);
    const sourceBytes = await bytes(join(sourceDirectory, 'source.json'));
    const merchantBytes = await bytes(join(sourceDirectory, 'seller.json'), 65536);
    const source = JSON.parse(sourceBytes), merchant = JSON.parse(merchantBytes);
    const native = await loadDatasetConfig(join(sourceDirectory, 'dataset.json')), description = native.describe();
    if (!(await bytes(join(sourceDirectory, 'dataset.csv'), 256 * MiB)).equals(csv) ||
        !(await bytes(join(sourceDirectory, 'dataset.json'), 65536)).equals(configBytes))
      throw fault('SOCRATA_EXPORT_CHANGED', 'The immutable export changed during native inspection.');
    if (merchant.schema !== 'stellar-forge.seller-service.v1' || merchant.routes?.length !== 1 ||
        merchant.routes[0].handler !== 'queryDataset' || merchant.routes[0].admit !== 'admitDataset' ||
        !merchant.routes[0].definition?.payment)
      throw fault('SOCRATA_MERCHANT_REQUIRED', 'Export the edition with its original configured dataset merchant.', 400);
    const versioned = await buildDatasetSellerConfig(native, { payment: merchant.routes[0].definition.payment,
      origin: merchant.publicOrigin, path: merchant.routes[0].path });
    versioned.routes[0].definition.queryParameters.push(DATASET_SNAPSHOT_PARAMETER);
    const binding = { schema: DATASET_BINDING_SCHEMA, datasetDirectory,
      contractSha256: datasetContractSha256(description), baselineSnapshot: description.snapshot, sourceSha256: sha(sourceBytes) };
    const key = sha(json({ config: sha(configBytes), csv: sha(csv), merchant: sha(merchantBytes),
      source: sha(sourceBytes), binding }));
    const packageDirectory = join(packagesDirectory, key), staged = packageDirectory + '.stage-' + randomUUID();
    if (await absent(packageDirectory)) {
      await mkdir(staged, { mode: 0o700 });
      try {
        for (const [name,data] of [['dataset.csv',csv],['dataset.json',configBytes],['seller.json',json(versioned)],
          ['source.json',sourceBytes],['binding.json',json(binding)],['original-seller.json',merchantBytes]])
          await writeNew(join(staged, name), data);
        await prepareDatasetRelease(staged);
        await syncDirectory(staged); await rename(staged, packageDirectory); await syncDirectory(packagesDirectory);
      } catch (error) { await rm(staged, { recursive: true, force: true }); throw error; }
    }
    const prepared = await prepareDatasetRelease(packageDirectory);
    if (prepared.dataset.csvSha256 !== sha(csv) || prepared.dataset.sourceSha256 !== sha(sourceBytes))
      throw fault('SOCRATA_PREPARED_SOURCE_CHANGED', 'The retained package no longer matches this exact export.');
    let observed = await target(), initialized = false;
    if (!observed.initialized && !observed.connected) {
      const versions = await openDatasetVersions({ directory: datasetDirectory, initialConfig: join(packageDirectory, 'dataset.json') });
      try { observed = { connected: false, initialized: true, dataset: versions.describe(), versions: versions.status() }; initialized = true; }
      finally { await versions.close(); }
    }
    if (datasetContractSha256(observed.dataset) !== binding.contractSha256)
      throw fault('SOCRATA_CONTRACT_CHANGED', 'Use a separate publisher for changed query capabilities; this original version store preserves its existing cursor contract.');
    let record = drafts.view().candidates.find(candidate => candidate.socrata?.packageKey === key);
    if (!record) {
      const upload = await drafts.stage();
      try {
        // Original draft/version files use data.csv. packages/ keeps the export unchanged.
        const draftConfig = { ...config, file: './data.csv' }, draftConfigBytes = json(draftConfig);
        await writeNew(join(upload.directory, 'data.csv'), csv);
        await writeNew(join(upload.directory, 'dataset.json'), draftConfigBytes);
        record = await drafts.adopt(upload, { filename: description.name + '.csv', dataset: description,
          configHash: sha(draftConfigBytes), csvHash: sha(csv), sourceBytes: csv.length,
          expectedSnapshot: observed.versions.current, expectedRevision: observed.versions.revision,
          socrata: { packageKey: key, sourceSha256: sha(sourceBytes), originalSellerSha256: sha(merchantBytes),
            nativeSnapshot: description.snapshot, source, importedAt: now() } });
      } catch (error) { await rm(upload.directory, { recursive: true, force: true }); throw error; }
    }
    if (initialized) await drafts.publication(record.id, { id: randomUUID(), state: 'CONFIRMED',
      kind: 'ORIGINAL_DATASET_INITIALIZATION', startedAt: now(), completedAt: now(),
      targetSnapshot: description.snapshot, result: observed.versions });
    await drafts.select(record.id);
    return { draft: drafts.candidate(record.id), packageDirectory, target: observed, initialized };
  }
  async function preview(input) {
    only(input, ['target','query']);
    const query = queryText(input.query);
    if (typeof input.target === 'string' && input.target.startsWith('draft:')) {
      const selected = await savedCandidate(input.target.slice(6)), context = { query: new URLSearchParams(query) };
      const admitted = await selected.dataset.admit(context);
      const response = admitted === true ? await selected.dataset.handle(context) : admitted;
      await drafts.selection({ target: input.target, query, snapshot: selected.record.dataset.snapshot });
      return { mode: 'ORIGINAL_DRAFT_PREVIEW', target: input.target, status: response.status, body: response.body };
    }
    if (!HASH.test(input.target ?? '')) throw fault('SOCRATA_PREVIEW_TARGET', 'Select a draft or retained snapshot.', 400);
    await target({ offline: false });
    const parameters = new URLSearchParams(query); parameters.set('snapshot', input.target);
    const body = await datasetControl(datasetDirectory, 'preview', { query: parameters.toString() });
    await drafts.selection({ target: input.target, query, snapshot: input.target });
    return { mode: 'ORIGINAL_PRIVATE_PREVIEW', target: input.target, status: 200, body };
  }
  async function reviewDraft(input) {
    only(input, ['draftId','expectedSnapshot','expectedRevision']);
    const revision = expected(input), observed = await target({ offline: false }), selected = drafts.candidate(input.draftId);
    if (observed.versions.current !== revision.expectedSnapshot || observed.versions.revision !== revision.expectedRevision)
      throw fault('SOCRATA_PUBLICATION_CHANGED', 'Refresh and review the current original target.');
    const publications = clone(selected.publications);
    if (pendingDraftPublication(selected)) publications[publications.length - 1] = { ...publications.at(-1),
      state: 'REVIEWED_AFTER_INTERRUPTION', reviewedAt: now(), observed: clone(observed.versions) };
    return drafts.update(selected.id, { ...revision, publications });
  }
  async function publish(input) {
    only(input, ['draftId','expectedSnapshot','expectedRevision']);
    const revision = expected(input), selected = await savedCandidate(input.draftId);
    const observed = await target({ offline: false });
    if (observed.versions.current === selected.record.dataset.snapshot &&
        observed.versions.versions.some(item => item.snapshot === selected.record.dataset.snapshot &&
          item.csvHash === selected.record.csvHash && item.configHash === selected.record.configHash)) {
      await drafts.reconcile(observed.versions);
      return { state: 'CURRENT', draft: drafts.candidate(selected.record.id), publication: observed.versions };
    }
    if (pendingDraftPublication(selected.record)) throw fault('PUBLICATION_REVIEW_REQUIRED',
      'Reopen original status and review the retained publication before another attempt.');
    if (selected.record.expectedSnapshot !== revision.expectedSnapshot || selected.record.expectedRevision !== revision.expectedRevision ||
        observed.versions.current !== revision.expectedSnapshot || observed.versions.revision !== revision.expectedRevision)
      throw fault('SOCRATA_PUBLICATION_CHANGED', 'Review this candidate against the current original target.');
    const attempt = { id: randomUUID(), state: 'PENDING', startedAt: now(),
      targetSnapshot: selected.record.dataset.snapshot, ...revision };
    await drafts.publication(selected.record.id, attempt);
    try {
      const result = await datasetControl(datasetDirectory, 'refresh', { configPath: selected.files.configPath, ...revision });
      if (result.current !== attempt.targetSnapshot) throw fault('SOCRATA_PUBLICATION_DIFFERS', 'Reopen the original publication result.');
      await drafts.publication(selected.record.id, { ...attempt, state: 'CONFIRMED', completedAt: now(), result });
      return { state: 'PUBLISHED', draft: drafts.candidate(selected.record.id), publication: result };
    } catch (error) {
      await drafts.publication(selected.record.id, { ...attempt, state: 'NEEDS_REVIEW', failedAt: now(), error: error.code ?? 'PUBLICATION_RESPONSE_UNAVAILABLE' });
      throw error;
    }
  }
  async function actualBuyerReview(input) {
    only(input, ['snapshot','query']);
    if (!HASH.test(input.snapshot ?? '')) throw fault('SOCRATA_BUYER_SNAPSHOT', 'Select a published dataset snapshot.', 400);
    const query = queryText(input.query), selected = await target({ offline: false });
    if (!selected.versions.versions.some(version => version.snapshot === input.snapshot))
      throw fault('DATASET_SNAPSHOT_EXPIRED', 'Select a retained published version.', 410);
    const status = await releaseStatus(releaseDirectory), resource = selected.resources?.[0]?.resource;
    const seller = status.runtime?.observed?.listener;
    if (!seller || !resource) throw fault('SOCRATA_RELEASE_REQUIRED', 'Start the selected original release before preparing a customer.');
    const check = new URLSearchParams(query); check.delete('snapshot'); check.delete('cursor'); check.set('snapshot', input.snapshot);
    const page = await datasetControl(datasetDirectory, 'preview', { query: check.toString() });
    const originalQuery = new URLSearchParams(query);
    if (originalQuery.has('snapshot') || originalQuery.has('cursor'))
      throw fault('SOCRATA_BUYER_FIRST_PAGE', 'Use the reviewed first-page query; choose the snapshot separately.', 400);
    return { ...(await readDatasetBuyerOffer({ seller, resource, snapshot: input.snapshot, query })), preview: page };
  }
  async function buyerPrepare(input) {
    only(input, ['review','intentId','acceptIndex','offerSha256']);
    if (!object(input.review)) throw fault('SOCRATA_BUYER_REVIEW', 'Load the actual seller offer and query preview first.', 400);
    const query = new URLSearchParams(input.review.query); query.delete('snapshot');
    const fresh = await actualBuyerReview({ snapshot: input.review.snapshot, query: query.toString() });
    if (fresh.url !== input.review.url || fresh.offerSha256 !== input.offerSha256)
      throw fault('SELLER_OFFER_CHANGED', 'Review the current original offer before preparing this customer.');
    const prepared = prepareDatasetBuyer(fresh, input), saved = await drafts.saveBuyer(prepared,
      { intentId: input.intentId, query: query.toString(), offerSha256: input.offerSha256 });
    return { buyer: saved, prepared };
  }
  async function session(input) {
    only(input, ['buyerId','workspaceDirectory','maxPages','maxTotalAtomic','maxRows','maxPageBytes']);
    const saved = await drafts.buyer(input.buyerId), workspace = absolute(input.workspaceDirectory, 'buyer workspace');
    const sessionDirectory = join(sessionsDirectory, saved.record.id);
    const binding = { schema: 'stellar-forge.socrata-buyer-session.v1', buyerId: saved.record.id,
      buyerConfigSha256: saved.record.configSha256, workspaceDirectory: workspace,
      snapshot: saved.record.snapshot, maxPages: input.maxPages, maxTotalAtomic: input.maxTotalAtomic,
      maxRows: input.maxRows ?? 1000000, maxPageBytes: input.maxPageBytes ?? MiB };
    const bindingFile = join(sessionDirectory, 'binding.json'), acquisition = join(sessionDirectory, 'acquisition');
    if (!await absent(bindingFile) && !equal(await readJson(bindingFile), binding))
      throw fault('SOCRATA_BUYER_SESSION_CHANGED', 'Reopen this buyer session with its original workspace and limits.');
    const native = await import('../../sf88-operator-buyer-cli/dataset-session.mjs');
    if (!await absent(join(acquisition, 'session.json'))) {
      const retained = await readJson(join(acquisition, 'session.json'));
      const expectedConfig = await readJson(join(sessionDirectory, 'execution-config.json'), 262144);
      if (!equal(retained.config, expectedConfig) || retained.expectedSnapshot !== binding.snapshot ||
          !equal(retained.limits, { maxPages: binding.maxPages, maxTotalAtomic: binding.maxTotalAtomic,
            maxRows: binding.maxRows, maxPageBytes: binding.maxPageBytes }))
        throw fault('SOCRATA_BUYER_SESSION_CHANGED', 'The original acquisition differs from its retained limits or configuration.');
      await immutable(bindingFile, json(binding));
      return { id: saved.record.id, binding, report: await native.inspectDatasetSession(acquisition) };
    }
    const { workspaceConfiguration } = await import('../../sf88-operator-buyer-cli/queue.mjs');
    const configured = await workspaceConfiguration(workspace, { configuration: JSON.parse(saved.configText) });
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    await immutable(join(sessionDirectory, 'execution-config.json'), json(configured.configuration));
    await immutable(bindingFile, json(binding));
    if (!await absent(acquisition)) {
      // Only our retained pre-execution initialization may have created these
      // empty directories. Original page/session artifacts are always retained.
      for (const item of await readdir(acquisition, { withFileTypes: true })) {
        if (!item.isDirectory() || !['pages','evidence'].includes(item.name) ||
            (await readdir(join(acquisition, item.name))).length)
          throw fault('SOCRATA_SESSION_INITIALIZATION_REVIEW', 'Preserve this original acquisition and recover its retained artifacts.');
      }
      await rm(acquisition, { recursive: true });
    }
    const report = await native.createDatasetSession({ directory: acquisition,
      configPath: join(sessionDirectory, 'execution-config.json'), maxPages: input.maxPages,
      maxTotalAtomic: input.maxTotalAtomic, maxRows: binding.maxRows, maxPageBytes: binding.maxPageBytes,
      expectedSnapshot: saved.record.snapshot });
    return { id: saved.record.id, binding, report };
  }
  async function sessionAction(action, input) {
    only(input, ['id']);
    if (!UUID.test(input.id ?? '')) throw fault('SOCRATA_BUYER_SESSION', 'Select the original buyer session.', 400);
    const root = join(sessionsDirectory, input.id), binding = await readJson(join(root, 'binding.json'));
    if (binding.buyerId !== input.id) throw fault('SOCRATA_BUYER_SESSION_CHANGED', 'The original session identity differs.');
    const acquisition = join(root, 'acquisition'), native = await import('../../sf88-operator-buyer-cli/dataset-session.mjs');
    if (action === 'publisher.buyer.run') return native.runDatasetSession(acquisition, {
      workspace: binding.workspaceDirectory, emitPageSummaries: false });
    if (action === 'publisher.buyer.recover') return native.recoverDatasetSession(acquisition);
    if (action === 'publisher.buyer.account') return native.accountDatasetSession(acquisition, { workspace: binding.workspaceDirectory, finalize: true });
    if (action === 'publisher.buyer.export') {
      const manifest = join(root, 'acquisition-manifest.json'), delivery = join(root, 'delivery');
      const report = await native.inspectDatasetSession(acquisition);
      if (await absent(manifest)) await native.exportDatasetManifest(acquisition, manifest);
      else {
        const retained = await readJson(manifest, 16 * MiB);
        if (retained.status !== 'COMPLETE' || retained.sessionId !== report.sessionId ||
            retained.configurationSha256 !== report.configurationSha256 || retained.snapshot !== report.snapshot ||
            !equal(retained.pageFiles, report.pages.map(page => page.responsePath)))
          throw fault('SOCRATA_ACQUISITION_EXPORT_CHANGED', 'The retained export differs from its original completed acquisition.');
      }
      const exported = await native.deliverDatasetSession(acquisition, delivery);
      return { id: input.id, manifest, delivery, exported, report };
    }
    throw fault('SOCRATA_PUBLISHER_ACTION', 'Choose an original buyer continuation.', 400);
  }
  async function dispatch(action, input = {}) {
    switch (action) {
      case 'publisher.status': {
        only(input, []); const observed = await target();
        if (observed.versions) await drafts.reconcile(observed.versions);
        return observed;
      }
      case 'publisher.prepare': return prepare(input);
      case 'publisher.preview': return preview(input);
      case 'publisher.reviewDraft': return reviewDraft(input);
      case 'publisher.publish': return publish(input);
      case 'publisher.activateSnapshot':
        only(input, ['snapshot','expectedSnapshot','expectedRevision']);
        await target({ offline: false });
        return datasetControl(datasetDirectory, 'activate', { snapshot: input.snapshot, ...expected(input) });
      case 'publisher.collect':
        only(input, []); await target({ offline: false }); return datasetControl(datasetDirectory, 'collect', {});
      case 'publisher.release.stage': {
        only(input, ['draftId','id','label','runtime']);
        const selected = await savedCandidate(input.draftId);
        const packageDirectory = join(packagesDirectory, selected.record.socrata.packageKey);
        const runtime = input.runtime ?? { port: 0 };
        only(runtime, ['port','facilitator','allowLocalFacilitator']);
        let prior;
        try { prior = await inspectRelease(releaseDirectory, input.id); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (prior) {
          const prepared = await prepareDatasetRelease(packageDirectory);
          const selectedRuntime = { port: runtime.port ?? 8423,
            ...(runtime.facilitator === undefined ? {} : { facilitator: new URL(runtime.facilitator.trim()).href.replace(/\/$/, '') }),
            ...(runtime.allowLocalFacilitator === undefined ? {} : { allowLocalFacilitator: runtime.allowLocalFacilitator }) };
          if (!equal(prior.dataset, prepared.dataset) || prior.label !== (input.label ?? input.id).trim() ||
              !equal(prior.runtime, selectedRuntime))
            throw fault('SOCRATA_RELEASE_ID_USED', 'This release ID belongs to different retained source or runtime settings.');
          return prior;
        }
        return stageRelease(releaseDirectory, { id: input.id, label: input.label,
          datasetPackage: packageDirectory, runtime });
      }
      case 'publisher.release.inspect':
        only(input, ['id']); return inspectRelease(releaseDirectory, input.id);
      case 'publisher.release.activate':
        only(input, ['id','expectedGeneration']); return activateRelease(releaseDirectory, input.id, { expectedGeneration: generation(input.expectedGeneration) });
      case 'publisher.release.rollback':
        only(input, ['expectedGeneration']); return rollbackRelease(releaseDirectory, { expectedGeneration: generation(input.expectedGeneration) });
      case 'publisher.release.start':
        only(input, ['expectedGeneration']);
        generation(input.expectedGeneration);
        if (ownedRelease) { const status = await releaseStatus(releaseDirectory); return { state: status.runtime.state, status }; }
        ownedRelease = await runActiveRelease(releaseDirectory, { expectedGeneration: generation(input.expectedGeneration), handleSignals: false });
        const started = ownedRelease;
        void started.completion.finally(() => { if (ownedRelease === started) ownedRelease = null; }).catch(() => {});
        return { state: 'RUNNING', status: await releaseStatus(releaseDirectory) };
      case 'publisher.release.stop': {
        only(input, []);
        if (!ownedRelease) return { state: 'NO_OWNED_PROCESS', status: await releaseStatus(releaseDirectory) };
        const session = ownedRelease; ownedRelease = null;
        await session.close(); return { state: 'STOPPED', status: await releaseStatus(releaseDirectory) };
      }
      case 'publisher.buyer.review': return actualBuyerReview(input);
      case 'publisher.buyer.prepare': return buyerPrepare(input);
      case 'publisher.buyer.session': return session(input);
      case 'publisher.buyer.run':
      case 'publisher.buyer.recover':
      case 'publisher.buyer.account':
      case 'publisher.buyer.export': return sessionAction(action, input);
      default: throw fault('SOCRATA_PUBLISHER_ACTION', 'Unknown publisher action.', 400);
    }
  }
  function act(action, payload = {}) {
    if (closed || closePromise) return Promise.reject(fault('SOCRATA_PUBLISHER_CLOSED', 'Reopen the publisher.'));
    const operation = tail.catch(() => {}).then(async () => {
      if (closed) throw fault('SOCRATA_PUBLISHER_CLOSED', 'Reopen the publisher.');
      running = { action, startedAt: now() };
      try { const result = await dispatch(action, payload); running = null; return { result, state: await state() }; }
      finally { running = null; }
    });
    tail = operation; return operation;
  }
  async function readExport(kind, id) {
    if (!UUID.test(id ?? '')) throw fault('SOCRATA_EXPORT_ID', 'Choose a retained export.', 400);
    if (kind === 'draft-csv') return { bytes: await drafts.csv(id), filename: 'dataset.csv', contentType: 'text/csv; charset=utf-8' };
    if (kind === 'draft-review') return { bytes: json(await drafts.export(id)), filename: 'dataset-review.json', contentType: 'application/json' };
    if (kind === 'buyer-config') return { bytes: Buffer.from((await drafts.buyer(id)).configText),
      filename: 'buyer-request.json', contentType: 'application/json' };
    if (kind === 'session-manifest') return { bytes: await bytes(join(sessionsDirectory, id, 'acquisition-manifest.json'), 16 * MiB),
      filename: 'acquisition-manifest.json', contentType: 'application/json' };
    const delivered = { 'session-csv': ['dataset.csv','text/csv; charset=utf-8'],
      'session-jsonl': ['dataset.jsonl','application/x-ndjson'], 'session-review': ['review.html','text/html; charset=utf-8'] }[kind];
    if (delivered) {
      const manifest = await readJson(join(sessionsDirectory, id, 'delivery', 'manifest.json'), 16 * MiB);
      const binding = await readJson(join(sessionsDirectory, id, 'binding.json'));
      const expectedOutput = manifest.outputs?.[delivered[0]];
      const content = await bytes(join(sessionsDirectory, id, 'delivery', delivered[0]), 128 * MiB);
      if (manifest.schema !== 'stellar-forge.buyer-delivery-manifest.v1' ||
          manifest.dataset?.snapshot !== binding.snapshot || expectedOutput?.bytes !== content.length ||
          expectedOutput?.sha256 !== sha(content))
        throw fault('SOCRATA_DELIVERY_CHANGED', 'Reopen the original completed data room before downloading this output.');
      return { bytes: content, filename: delivered[0], contentType: delivered[1] };
    }
    throw fault('SOCRATA_EXPORT_KIND', 'Choose a retained dataset, review or buyer export.', 400);
  }
  const close = () => closePromise ??= (async () => {
    await tail.catch(() => {}); closed = true;
    try { if (ownedRelease) { const owned = ownedRelease; ownedRelease = null; await owned.close(); } }
    finally { await drafts.close(); }
  })();
  return { directory, datasetDirectory, releaseDirectory, state, act, readExport, close };
}
const USAGE = [
  'Socrata publisher',
  '  node publisher.mjs --dir ABSOLUTE_DIRECTORY status',
  '  node publisher.mjs --dir ABSOLUTE_DIRECTORY ACTION --input JSON_FILE',
  '',
  'Actions use the original publisher, release and buyer engines. See PUBLISHING.md.',
  'Starting a release keeps this process alive; Ctrl+C drains its original seller.'
].join('\n');
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  if (args[0] !== '--dir' || !args[1] || !args[2] ||
      args.length !== 3 && !(args.length === 5 && args[3] === '--input'))
    throw new TypeError(USAGE);
  const publisher = await openSocrataPublisher({ directory: resolve(args[1]) });
  let retained = false;
  try {
    const action = args[2], payload = args[3] ? await readJson(resolve(args[4]), 65536) : {};
    const result = action === 'status' ? await publisher.state() : await publisher.act(action, payload);
    console.log(JSON.stringify(result, null, 2));
    if (action === 'publisher.release.start') {
      retained = true;
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
        publisher.close().then(() => { process.exitCode = 0; }, error => { console.error(error.message); process.exitCode = 1; });
      });
    }
    return result;
  } finally { if (!retained) await publisher.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(error.code ? error.code + ': ' : ''); process.stderr.write(error.message + '\n'); process.exitCode = 1; });
