// MIT. One migration project joins native acquisition, review and merchant releases.
import { join } from 'node:path';
import { mkdir, lstat, readdir, readFile } from 'node:fs/promises';
import { inspectOpenApi } from '../workspace/model.mjs';
import { openMigrationProjects, canonical, sha256 } from './project-store.mjs';
import { openMigrationReleases } from './release-operations.mjs';
import { openAcquisitions } from './acquisition.mjs';
import { openMigrationHandovers } from './handover.mjs';

const clean = value => JSON.parse(JSON.stringify(value));
const conflict = message => Object.assign(new Error(message), { status: 409 });
const familyNames = new Set(['assets', 'blockchains', 'stablecoins']);
const checkedId = value => { if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value ?? '')) throw new TypeError('Use a stable lowercase identifier.'); return value; };
function changed(project, input) {
  if (project.revision !== input.expectedRevision) throw conflict('This project changed. Reload the current edition before applying this action.');
  if (typeof input.actor !== 'string' || !input.actor.trim()) throw new TypeError('Enter the operator responsible for this change.');
  checkedId(input.requestId); return clean(project.state);
}
function inventory(value) {
  if (!value || value.schema !== 'stellar-forge.blockworks-inventory.v1' || !Array.isArray(value.requests) || value.requests.length > 500)
    throw new TypeError('Import a migration inventory with schema stellar-forge.blockworks-inventory.v1 and up to 500 requests.');
  const ids = new Set();
  for (const row of value.requests) {
    checkedId(row.id);
    if (ids.has(row.id)) throw new TypeError('Inventory request IDs must be unique.'); ids.add(row.id);
    if (!familyNames.has(row.family) || typeof row.feature !== 'string' || !row.feature.trim() || row.method !== 'GET' || typeof row.path !== 'string' || !row.path.startsWith('/'))
      throw new TypeError('Each inventory request needs its application feature, one of the three selected families, and the actual GET path.');
  }
  return value;
}

export async function openMigrationApplication({ parent, origin, parentRuntime, transport, python, buyerTransport, receiverOptions = {} } = {}) {
  const projects = await openMigrationProjects({ parent });
  const releases = await openMigrationReleases({ projects, origin, parentRuntime });
  const jobs = new Map(), receivers = new Map(), receivedWorkspaces = new Map(); let closing = false;
  const handovers = await openMigrationHandovers({ projects, releases, acquisition, python });
  async function acquirer(projectId, sourceRef) {
    const source = await projects.readSource(projectId, sourceRef);
    if (source.metadata.kind !== 'openapi') throw new TypeError('Acquisition requires the retained provider OpenAPI source.');
    return openAcquisitions({ directory: join(projects.projectDirectory(projectId), 'acquisitions'),
      source: { file: source.file, url: source.metadata.provenance.url, sha256: source.metadata.sha256 },
      ...(transport ? { transport } : {}), ...(python ? { python } : {}),
      ...(buyerTransport ? { buyerTransport } : process.env.HTTPS_PROXY ? {
        buyerTransport: { mode: 'explicit-connect', origin: 'https://api.blockworks.com', proxyEnv: 'HTTPS_PROXY' }
      } : {}) });
  }
  async function acquisition(projectId, runId) {
    const project = await projects.get(projectId);
    const entry = project.state.acquisitions.find(row => row.id === runId);
    if (!entry) throw new TypeError('Choose an acquisition retained in this project.');
    const service = await acquirer(projectId, entry.sourceRef);
    return { project, entry, service, manifest: await service.get(runId) };
  }
  async function snapshot(id) {
    const project = await projects.get(id); const acquisitions = [];
    for (const row of project.state.acquisitions) {
      try { const service = await acquirer(id, row.sourceRef); acquisitions.push({ ...row, manifest: await service.get(row.id), running: jobs.has(id + '/' + row.id) }); }
      catch (error) { acquisitions.push({ ...row, problem: error.message }); }
    }
    return { project, acquisitions, packages: await releases.packages(), releases: await releases.status(id),
      handovers: await handovers.list(id), receiver: receiverView(id) };
  }
  async function commit(project, input, action, state) {
    return projects.commit({ id: project.id, expectedRevision: input.expectedRevision, actor: input.actor,
      requestId: input.requestId, action, state: clean(state) });
  }
  async function addSource(input) {
    const project = await projects.get(input.projectId); const state = changed(project, input);
    let description = null;
    if (input.kind === 'openapi' || input.kind === 'legacy-openapi') {
      if (Buffer.byteLength(input.content ?? '') > 4 * 1024 * 1024) throw new TypeError('OpenAPI sources are limited to the original workspace’s 4 MiB.');
      description = inspectOpenApi(input.content);
    }
    if (input.kind === 'inventory') inventory(JSON.parse(input.content));
    const retained = await projects.retainSource(project.id, { kind: input.kind, name: input.name,
      content: input.content, provenance: { ...(input.provenance ?? {}),
        ...(input.kind === 'legacy-response' ? { kind: input.provenance?.kind ?? 'file', name: input.name,
          importedAt: new Date().toISOString(), importedBy: input.actor } : {}) } });
    if (!state.sources.some(row => row.ref === retained.ref)) state.sources.push(retained);
    if (input.kind === 'openapi') state.currentSource = retained.ref;
    if (input.kind === 'inventory' && !state.inventories.includes(retained.ref)) state.inventories.push(retained.ref);
    const saved = await commit(project, input, 'Retain ' + input.kind + ' source', state);
    return { project: saved, retained, description };
  }
  async function createAcquisition(input) {
    const project = await projects.get(input.projectId); const state = changed(project, input);
    checkedId(input.id);
    const sourceRef = input.sourceRef ?? state.currentSource;
    const existing = state.acquisitions.find(row => row.id === input.id);
    if (existing) throw conflict('That acquisition exists. Reopen its captured request or create a new edition with a new ID.');
    const service = await acquirer(project.id, sourceRef);
    const review = { projectId: project.id, projectRevision: project.revision, operator: input.actor,
      reason: String(input.reason ?? 'Selected provider request'), sourceRef, request: clean(input.request) };
    const manifest = await service.create({ id: input.id, request: input.request, review,
      ...(input.credentialEnv ? { credentialEnv: input.credentialEnv } : {}) });
    state.acquisitions.push({ id: input.id, sourceRef, family: input.family ?? null, feature: input.feature ?? '',
      role: input.role ?? 'candidate', requestHash: manifest.requestHash });
    return { project: await commit(project, input, 'Prepare provider acquisition', state), manifest };
  }
  async function startAcquisition({ projectId, id }) {
    if (closing) throw new Error('The migration workspace is stopping.');
    const selected = await acquisition(projectId, id); const key = projectId + '/' + id;
    if (jobs.has(key)) return { started: false, running: true, manifest: await selected.service.get(id) };
    const controller = new AbortController();
    const job = { controller, promise: null };
    jobs.set(key, job);
    job.promise = selected.service.run(id, { signal: controller.signal }).catch(error => ({ error: error.message }))
      .finally(() => { if (jobs.get(key) === job) jobs.delete(key); });
    return { started: true, running: true, manifest: await selected.service.get(id) };
  }
  async function stopAcquisition({ projectId, id }) {
    const job = jobs.get(projectId + '/' + id);
    if (job) { job.controller.abort(); await job.promise; }
    return { manifest: (await acquisition(projectId, id)).manifest, running: false };
  }
  async function importCapture(input) {
    const selected = await acquisition(input.projectId, input.id);
    if (jobs.has(input.projectId + '/' + input.id)) throw conflict('Wait for the current request or pause it before importing its retained response.');
    return selected.service.importResponse(input.id, { url: input.url, status: input.status,
      headers: input.headers ?? {}, body: Buffer.from(input.body), capturedAt: input.capturedAt,
      provenance: input.provenance ?? {} });
  }
  async function sourceSide(projectId, selector) {
    if (selector?.type === 'acquisition') {
      const selected = await acquisition(projectId, selector.id); const captures = [];
      for (const capture of selected.manifest.captures) {
        const read = await selected.service.readCapture(selector.id, capture.id);
        captures.push(read);
      }
      return { manifest: selected.manifest, result: await selected.service.readRows(selector.id), captures };
    }
    if (selector?.type === 'source') {
      const source = await projects.readSource(projectId, selector.ref);
      const { legacyCaptureSource } = await import('./customer.mjs');
      return legacyCaptureSource({ body: source.body, metadata: { ...source.metadata.provenance, ...source.metadata }, selection: selector.selection ?? source.metadata.provenance?.selection });
    }
    throw new TypeError('Choose an actual retained acquisition or imported response for each side.');
  }
  async function mappingSources(projectId, binding) {
    const contract = await projects.readJson(projectId, binding.contractRef);
    return { contract: { sourceRef: contract.ref, sha256: contract.metadata.sha256, document: contract.value, metadata: contract.metadata },
      ...(binding.catalog ? { catalog: await sourceSide(projectId, binding.catalog) } : {}),
      baseline: await sourceSide(projectId, binding.baseline), candidate: await sourceSide(projectId, binding.candidate) };
  }
  async function saveMapping(input) {
    const project = await projects.get(input.projectId); const state = changed(project, input);
    checkedId(input.mapping?.id);
    if (!familyNames.has(input.family)) throw new TypeError('Choose assets, blockchains or stablecoins.');
    await mappingSources(project.id, input.binding);
    state.mappings[input.mapping.id] = { family: input.family, mapping: clean(input.mapping), binding: clean(input.binding) };
    delete state.mappingReviews[input.mapping.id]; delete state.comparisons[input.mapping.id];
    return { project: await commit(project, input, 'Save semantic mapping', state) };
  }
  async function reviewSemanticMapping(input) {
    const project = await projects.get(input.projectId); const state = changed(project, input);
    const selected = state.mappings[input.id]; if (!selected) throw new TypeError('Save this mapping before reviewing it.');
    const sources = await mappingSources(project.id, selected.binding);
    const { reviewMapping } = await import('./mapping.mjs');
    const review = reviewMapping({ mapping: selected.mapping, sources });
    const retained = await projects.retainSource(project.id, { kind: 'review', name: input.id + '-mapping-review.json',
      content: JSON.stringify({ mapping: selected.mapping, binding: selected.binding, review }), provenance: { operator: input.actor } });
    state.mappingReviews[input.id] = { ref: retained.ref, reviewId: review.reviewId, ready: review.ready };
    delete state.comparisons[input.id];
    return { project: await commit(project, input, 'Review semantic mapping', state), review };
  }
  async function compare(input) {
    const project = await projects.get(input.projectId); const state = changed(project, input);
    const selected = state.mappings[input.id]; const saved = state.mappingReviews[input.id];
    if (!selected || !saved) throw new TypeError('Save and review this mapping before comparing its results.');
    const sources = await mappingSources(project.id, selected.binding);
    const { compareMappedResults } = await import('./mapping.mjs');
    const comparison = compareMappedResults({ mapping: selected.mapping, sources, reviewId: input.reviewId });
    if (saved.reviewId !== input.reviewId) throw conflict('The selected mapping review changed. Reload it.');
    const retained = await projects.retainSource(project.id, { kind: 'comparison', name: input.id + '-comparison.json',
      content: JSON.stringify(comparison), provenance: { operator: input.actor } });
    state.comparisons[input.id] = { ref: retained.ref, comparisonId: comparison.comparisonId, reviewId: comparison.reviewId, status: comparison.status };
    return { project: await commit(project, input, 'Compare selected customer results', state), comparison };
  }
  async function createSourceReview(input) {
    const project = await projects.get(input.projectId); const state = changed(project, input);
    const result = await releases.sourceReview({ projectId: project.id, baselineName: input.baselineName,
      sourceRef: input.sourceRef ?? state.currentSource, decisions: input.decisions ?? {} });
    const retained = await projects.retainSource(project.id, { kind: 'review', name: 'merchant-source-review.json',
      content: JSON.stringify(result), provenance: { operator: input.actor } });
    state.merchant.baseline = input.baselineName;
    state.merchant.sourceReview = { ref: retained.ref, sourceRef: result.sourceRef, reviewId: result.report.reviewId, ready: result.report.ready };
    state.merchant.package = null;
    return { project: await commit(project, input, 'Review merchant source update', state), ...result };
  }
  async function exportMerchant(input) {
    const project = await projects.get(input.projectId); const state = changed(project, input);
    const review = state.merchant.sourceReview;
    if (!review || review.reviewId !== input.reviewId || review.sourceRef !== state.currentSource)
      throw conflict('Review the current provider source before exporting this merchant package.');
    const result = await releases.saveReviewedPackage({ projectId: project.id, sourceReviewRef: review.ref, reviewId: input.reviewId, name: input.name });
    state.merchant.package = { name: result.name, sourceReviewId: review.reviewId, sourceRef: review.sourceRef,
      mappingPin: sha256(canonical({ mappings: state.mappings, reviews: state.mappingReviews, comparisons: state.comparisons })) };
    return { project: await commit(project, input, 'Export reviewed merchant package', state), result };
  }

  function receiverDirectory(projectId) { return join(projects.projectDirectory(projectId), 'receiving'); }
  function receiverView(projectId) {
    const current = receivers.get(projectId);
    return { directory: receiverDirectory(projectId), open: Boolean(current), url: current?.url ?? null };
  }
  async function receiverConfiguration(projectId) {
    await projects.get(projectId);
    const configsDirectory = receiverOptions.configsDirectory ?? join(projects.projectDirectory(projectId), 'receiving-configs');
    try { await mkdir(configsDirectory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await lstat(configsDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077)))
      throw new TypeError('Use a private original receiving configuration directory.');
    return { ...receiverOptions, directory: receiverDirectory(projectId), configsDirectory };
  }
  async function openReceiver({ projectId }) {
    if (closing) throw new Error('The migration workspace is stopping.');
    if (receivers.has(projectId)) return receiverView(projectId);
    const configuration = await receiverConfiguration(projectId);
    const { startRunbookWorkspace } = await import('../../buyer-runbook/workspace.mjs');
    const session = await startRunbookWorkspace({ directory: configuration.directory,
      configsDirectory: configuration.configsDirectory, operatorSettings: configuration.operatorSettings,
      paidFileClaimEnvs: configuration.paidFileClaimEnvs, port: 0 });
    receivers.set(projectId, session);
    return receiverView(projectId);
  }
  async function closeReceiver({ projectId }) {
    await projects.get(projectId); const session = receivers.get(projectId);
    if (session) { await session.close(); if (receivers.get(projectId) === session) receivers.delete(projectId); }
    return receiverView(projectId);
  }
  async function retainReceivedResponse(input) {
    const project = await projects.get(input.projectId), state = changed(project, input);
    const { openCustomerReceiver } = await import('./customer.mjs');
    const receiver = await openCustomerReceiver(await receiverConfiguration(project.id));
    const native = await receiver.readSource(input.runId, input.operationId, input.selection, {});
    if (!Array.isArray(native.captures) || native.captures.length !== 1 || !Buffer.isBuffer(native.captures[0].body))
      throw new TypeError('Select the original operation with one verified saved response.');
    const capture = native.captures[0], name = input.name || input.runId + '-' + input.operationId + '-response.json';
    const retained = await projects.retainSource(project.id, { kind: 'legacy-response', name,
      content: capture.body, provenance: { ...capture.metadata, kind: 'file', name,
        importedAt: new Date().toISOString(), importedBy: input.actor, selection: clean(input.selection),
        nativeManifest: clean(native.manifest), nativeCoverage: clean(native.result.coverage ?? null) } });
    if (!state.sources.some(row => row.ref === retained.ref)) state.sources.push(retained);
    return { project: await commit(project, input, 'Retain verified receiving application result', state), retained,
      manifest: native.manifest, coverage: native.result.coverage, complete: native.result.complete };
  }
  async function createHandover(input) {
    const project = await projects.get(input.projectId), state = changed(project, input);
    const result = await handovers.create(input), m = result.manifest;
    if (!state.handovers.some(row => row.digest === m.digest)) state.handovers.push({ name: m.id,
      createdAt: m.createdAt, receiver: m.receiver, note: m.note, digest: m.digest, sourceRevision: m.projectRevision,
      archiveSha256: m.archive.sha256, bytes: m.archive.bytes });
    return { ...result, project: await commit(project, input, 'Prepare receiving-team handover', state) };
  }
  async function listReceivedWorkspaces() {
    const root = join(projects.merchantParent, 'received-migrations'); let names;
    try { names = await readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const rows = [];
    for (const entry of names.filter(entry => entry.isDirectory() && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(entry.name))) {
      const receipt = JSON.parse(await readFile(join(root, entry.name, 'received-handover.json'), 'utf8'));
      if (receipt.schema !== 'stellar-forge.blockworks-migration-handover.v1') throw new TypeError('Received workspace identity changed.');
      rows.push({ name: entry.name, ...receipt, open: receivedWorkspaces.has(entry.name) });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function openReceivedWorkspace({ name }) {
    if (closing) throw new Error('The migration workspace is stopping.');
    checkedId(name);
    const found = (await listReceivedWorkspaces()).find(row => row.name === name);
    if (!found) throw new TypeError('Choose a complete received migration workspace.');
    let session = receivedWorkspaces.get(name);
    if (!session) {
      const { startWorkspace } = await import('../workspace/server.mjs');
      session = await startWorkspace({ parent: join(projects.merchantParent, 'received-migrations', name), port: 0, noSignals: true });
      receivedWorkspaces.set(name, session);
    }
    const url = new URL(session.url); url.pathname = '/migrations/'; url.searchParams.set('project', found.projectId);
    return { name, url: url.href, projectId: found.projectId, handoverDigest: found.digest };
  }
  async function importHandover({ name, content, expectedSha256 }) {
    if (typeof content !== 'string') throw new TypeError('Select the original compressed migration handover.');
    const body = Buffer.from(content, 'base64');
    if (body.toString('base64') !== content) throw new TypeError('The handover upload is not complete base64 data.');
    const restored = await handovers.restore({ body, name, expectedSha256 });
    return { ...restored, open: await openReceivedWorkspace({ name }) };
  }

  async function close() {
    closing = true;
    const current = [...jobs.values()]; for (const job of current) job.controller.abort();
    await Promise.allSettled(current.map(job => job.promise));
    const ends = await Promise.allSettled([...receivers.values(), ...receivedWorkspaces.values()].map(session => session.close()));
    await releases.close();
    const errors = ends.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'An owned receiving workspace did not finish stopping.');
    receivers.clear(); receivedWorkspaces.clear();
  }
  return { projects, releases, handovers, snapshot, openReceiver, closeReceiver, receiverView, retainReceivedResponse,
    createHandover, importHandover, listReceivedWorkspaces, openReceivedWorkspace, acquisition, acquirer, mappingSources, addSource, createAcquisition, startAcquisition, stopAcquisition,
    importCapture, saveMapping, reviewSemanticMapping, compare, createSourceReview, exportMerchant, close };
}
