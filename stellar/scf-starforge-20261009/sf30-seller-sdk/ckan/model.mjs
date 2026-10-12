// MIT. One retained CKAN project around the original publisher and merchant lifecycle.
import { basename, dirname, join, resolve } from 'node:path';
import { initReleaseStore } from '../../sf82-seller-pilot/releases.mjs';
import { mkdir, lstat, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { object, bytes, digest, identity, readJson, createFile, atomicJson, privateDirectory,
  acquireWorkspace, readPrivate, fault, stamp } from '../postgres/publisher/files.mjs';
import { catalogOrigin, captureSelection, captureCkanResource, ExactCkanNumber, readCkanCapture, requestCkan, searchCkan } from './capture.mjs';
import { createCkanWorkspaceArchive, receiveCkanWorkspaceArchive, assertCkanWorkspaceReceived } from './archive.mjs';
import { compileQueries, readCkanSourceFile } from './declaration.mjs';
import { bindCkanCapture, projectCkanValue } from './source.mjs';
import { describeCkanSemantics, projectCkanSemantics, checkCkanSemanticReview, compareCkanSemantics } from './semantics.mjs';
import { createCkanReviewedRefreshes } from './reviewed-refresh.mjs';
import { openCkanPublisher } from './publisher/model.mjs';
import { exportCkanMerchantPackage, stageCkanMerchantRelease, readCkanMerchantBuyerOffer,
  prepareCkanMerchantBuyer } from './publisher/release.mjs';

const ID = /^[a-f0-9-]{36}$/;
const id = value => { if (typeof value !== 'string' || !ID.test(value)) throw fault('CKAN_ITEM_NOT_FOUND', 'Choose an existing project item.', 404); return value; };
const text = (value, label, max = 256) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fault('CKAN_TEXT_REQUIRED', 'Enter ' + label + '.');
  return value.trim();
};
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
function captureSummary(capture) {
  const m = capture.manifest;
  return { manifestSha256: capture.manifestSha256, rowCount: m.rowCount, pageCount: m.pages.length,
    packageId: m.packageId, resourceId: m.resourceId, packageTitle: m.packageTitle, resourceTitle: m.resourceTitle,
    license: m.license, consistency: m.consistency, startedAt: m.startedAt, completedAt: m.completedAt,
    semanticSchemaSha256: m.semanticSchema?.sha256 ?? null, semanticConsistency: m.semanticConsistency ?? null };
}
// Presentation values cross a browser JSON parser; stringify structured values
// and exact numeric tokens here so the displayed source value cannot be rounded.
function sampleValue(value) {
  if (value instanceof ExactCkanNumber) return value.source;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}
const sampleRow = row => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, sampleValue(value)]));
function columnSuggestions(capture) {
  const used = new Set();
  const semanticFields = new Map(describeCkanSemantics(capture).fields.map(field => [field.sourceField, field]));
  return capture.fields.map(field => {
    let alias = field.id === '_id' ? 'record_id' : field.id.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 42);
    if (!/^[A-Za-z]/.test(alias)) alias = 'field_' + alias;
    if (['constructor', 'prototype', '__proto__'].includes(alias)) alias = 'field_' + alias;
    const base = alias; let suffix = 1;
    while (used.has(alias)) {
      const ending = '_' + suffix++;
      alias = base.slice(0, 48 - ending.length) + ending;
    }
    used.add(alias);
    const values = capture.rows.map(row => row[field.id]), nonnull = values.filter(value => value !== null && value !== undefined);
    const missing = values.filter(value => value === undefined).length, nulls = values.filter(value => value === null).length;
    const kinds = [...new Set(nonnull.map(value => typeof value))], empty = values.filter(value => value === '').length;
    let type = kinds.length === 1 ? ({ string: 'string', boolean: 'boolean', number: 'number' }[kinds[0]] ?? 'string') : 'string';
    if (type === 'number' && nonnull.every(Number.isSafeInteger)) type = 'integer';
    let encoding = kinds.length > 1 || kinds.includes('object') || nulls && empty ? 'json' : 'native';
    if (!nonnull.length) { type = 'string'; encoding = 'json'; }
    if (encoding === 'json') type = 'string';
    return { field: field.id, alias, providerType: field.type ?? null, providerInfo: field.info ?? null,
      sourceDefinition: semanticFields.get(field.id)?.sourceDefinition ?? null,
      type, encoding, nullable: encoding === 'json' ? false : nulls > 0, nulls, empty, missing,
      sample: nonnull.slice(0, 3).map(sampleValue) };
  });
}
export async function openCkanWorkbench({ directory, create = false, origin, authTokenEnv, environment = process.env } = {}) {
  directory = resolve(directory);
  if (create && await exists(join(directory, 'workbench.json'))) throw fault('CKAN_PROJECT_EXISTS');
  await privateDirectory(dirname(directory));
  await privateDirectory(directory, create);
  await assertCkanWorkspaceReceived(directory);
  const release = await acquireWorkspace(directory);
  let state, active = null, closed = false;
  const persist = () => atomicJson(directory, 'workbench.json', state);
  try {
    if (create) {
      const checked = captureSelection({ catalogOrigin: origin, packageId: 'initial', resourceId: 'initial', authTokenEnv });
      state = { schema: 'stellar-forge.ckan-workbench.v1', catalogOrigin: checked.catalogOrigin,
        ...(authTokenEnv ? { authTokenEnv } : {}), createdAt: stamp(), updatedAt: stamp(),
        editions: [], sources: [], publications: [], exports: [], buyerRequests: [], refreshes: [], operation: null };
      for (const name of ['editions', 'sources', 'publications', 'datasets', 'merchant-packages', 'buyer-requests'])
        await privateDirectory(join(directory, name), true);
      await createFile(join(directory, 'workbench.json'), bytes(state));
    } else state = await readJson(join(directory, 'workbench.json'), 16777216);
    if (state.schema !== 'stellar-forge.ckan-workbench.v1' || !Array.isArray(state.editions) ||
        !Array.isArray(state.sources) || !Array.isArray(state.publications) || !Array.isArray(state.exports))
      throw fault('CKAN_PROJECT_INVALID');
    if (state.refreshes === undefined) state.refreshes = [];
    if (!Array.isArray(state.refreshes)) throw fault('CKAN_PROJECT_INVALID');
    catalogOrigin(state.catalogOrigin);
    if (origin && catalogOrigin(origin) !== state.catalogOrigin || authTokenEnv && authTokenEnv !== state.authTokenEnv)
      throw fault('CKAN_PROJECT_BINDING_CHANGED');
    if (state.operation?.state === 'RUNNING') {
      state.operation.state = 'INTERRUPTED'; state.operation.error = 'PROCESS_INTERRUPTED';
      for (const edition of state.editions) if (edition.state === 'CAPTURING') edition.state = 'INTERRUPTED';
      for (const refresh of state.refreshes) if (refresh.state === 'PREPARING') refresh.state = 'INTERRUPTED';
      await persist();
    }
    const find = (collection, value) => {
      id(value); const item = state[collection].find(item => item.id === value);
      if (!item) throw fault('CKAN_ITEM_NOT_FOUND', 'Choose an existing project item.', 404);
      return item;
    };
    const captureFile = value => join(directory, 'editions', id(value), 'capture.json');
    const selectedCapture = value => { const entry = find('editions', value); return readCkanCapture(captureFile(value), entry.manifestSha256); };
    function launch(kind, action) {
      if (closed) throw fault('CKAN_PROJECT_CLOSED');
      if (active) throw fault('CKAN_PROJECT_BUSY', 'Wait for the current project operation to finish.', 409);
      const operation = { id: randomUUID(), kind, state: 'RUNNING', startedAt: stamp(), progress: null, result: null, error: null };
      state.operation = operation;
      const controller = new AbortController();
      const running = { operation, controller, completion: null };
      active = running;
      running.completion = (async () => {
        try {
          await persist();
          operation.result = await action(controller.signal, progress => { operation.progress = progress; });
          operation.state = 'COMPLETE';
        } catch (error) {
          operation.state = controller.signal.aborted ? 'CANCELLED' : 'FAILED';
          operation.error = { code: error.code ?? 'CKAN_OPERATION_FAILED',
            message: error.code ? error.message : 'The operation did not complete. Read the retained item before continuing.' };
        } finally {
          operation.completedAt = stamp(); state.updatedAt = stamp();
          try { await persist(); } finally { if (active === running) active = null; }
        }
        return structuredClone(operation);
      })();
      running.completion.catch(() => {});
      return { id: operation.id, completion: running.completion };
    }
    async function withPublisher(value, action, options = {}) {
      const entry = find('publications', value);
      const publisher = await openCkanPublisher({ directory: join(directory, 'publications', value), ...options });
      try { return await action(publisher, entry); } finally { await publisher.close(); }
    }
    async function edition(value) {
      const entry = find('editions', value);
      if (entry.state !== 'COMPLETE') {
        const progress = await readJson(join(directory, 'editions', value, 'progress.json'), 16777216).catch(() => null);
        return { ...entry, progress };
      }
      const capture = await selectedCapture(value);
      return { ...entry, fields: capture.fields, suggestions: columnSuggestions(capture),
        semantics: describeCkanSemantics(capture), sample: capture.rows.slice(0, 20).map(sampleRow), source: capture.manifest };
    }
    async function capture(entry, signal, progress) {
      entry.state = 'CAPTURING'; entry.error = null; await persist();
      try {
        const current = await captureCkanResource(entry.selection, join(directory, 'editions', entry.id),
          { ...entry.limits, env: environment, signal, onProgress: progress });
        Object.assign(entry, captureSummary(current), { state: 'COMPLETE' }); await persist(); return structuredClone(entry);
      } catch (error) {
        entry.state = signal.aborted ? 'INTERRUPTED' : 'FAILED'; entry.error = error.code ?? 'CKAN_CAPTURE_INTERRUPTED';
        await persist(); throw error;
      }
    }
    async function createSourceSelection(editionId, input, { sourceId = randomUUID(), refresh } = {}) {
      const capture = await selectedCapture(editionId);
      if (input.expectedCaptureSha256 !== capture.manifestSha256) throw fault('CKAN_REVIEWED_EDITION_CHANGED');
      const query = input.query ?? 'dataset', queries = compileQueries({ [query]: { projection: input.projection } });
      const semantics = projectCkanSemantics(capture, queries[query].projection);
      const semanticReview = semantics ? { sha256: semantics.sha256, definitionSha256: semantics.definitionSha256 } : null;
      const config = { schema: 'stellar-forge.ckan-source.v1', catalogOrigin: state.catalogOrigin,
        packageId: capture.manifest.packageId, resourceId: capture.manifest.resourceId,
        connection: { kind: 'capture', file: '../editions/' + editionId + '/capture.json', sha256: capture.manifestSha256 },
        queries: { [query]: { projection: input.projection, ...(semanticReview ? { semanticReview } : {}) } } };
      bindCkanCapture(capture, config, queries[query]);
      const preview = capture.rows.slice(0, 20).map(row => Object.fromEntries(Object.entries(queries[query].projection)
        .map(([alias, spec]) => [alias, projectCkanValue(row[spec.field], spec)])));
      const value = sourceId, file = join(directory, 'sources', value + '.json'), raw = bytes(config);
      try { await createFile(file, raw); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const retained = await readPrivate(file, 1048576);
        if (digest(retained) !== digest(raw)) {
          if (state.sources.some(item => item.id === value) || retained.length >= raw.length ||
              !raw.subarray(0, retained.length).equals(retained)) throw fault('CKAN_REFRESH_SOURCE_CHANGED');
          await atomicJson(join(directory, 'sources'), value + '.json', config);
        }
      }
      const entry = { id: value, title: text(input.title ?? capture.manifest.packageTitle, 'a data product title', 128),
        editionId, query, file, sha256: digest(raw), createdAt: stamp(), projection: queries[query].projection, ...(refresh ?? {}),
        ...(semanticReview ? { semanticReview, semanticIssues: semantics.issues } : {}) };
      const prior = state.sources.find(item => item.id === value);
      if (prior) {
        if (prior.sha256 !== entry.sha256 || prior.editionId !== entry.editionId ||
            prior.refreshDecisionSha256 !== entry.refreshDecisionSha256) throw fault('CKAN_REFRESH_SOURCE_CHANGED');
        return { ...structuredClone(prior), preview, semantics };
      }
      state.sources.push(entry); await persist(); return { ...entry, preview, semantics };
    }
    const reviewedRefreshes = createCkanReviewedRefreshes({ directory, state, find, selectedCapture,
      launch, persist, createSource: createSourceSelection });
    const api = {
      ...reviewedRefreshes,
      directory,
      status: () => structuredClone({ ...state, directory, active: active ? active.operation.id : null }),
      async search(input = {}) {
        const received = await searchCkan(state.catalogOrigin, { ...input, authTokenEnv: state.authTokenEnv, env: environment });
        return { page: received.page, receipt: received.receipt, datasets: received.value.results.map(pkg => ({
          id: pkg.id, name: pkg.name, title: pkg.title, notes: pkg.notes ?? '', modified: pkg.metadata_modified ?? null,
          license: { id: pkg.license_id ?? null, title: pkg.license_title ?? null, url: pkg.license_url ?? null },
          organization: pkg.organization?.title ?? pkg.organization?.name ?? null,
          resources: (pkg.resources ?? []).map(resource => ({ id: resource.id, name: resource.name ?? resource.id,
            format: resource.format ?? null, datastoreActive: resource.datastore_active ?? null, description: resource.description ?? '' })),
        })) };
      },
      async package(packageId) {
        const received = await requestCkan(state.catalogOrigin, 'package_show', { id: text(packageId, 'a package ID', 512) },
          { authTokenEnv: state.authTokenEnv, env: environment });
        return { package: received.value, receipt: received.receipt };
      },
      startCapture(input) {
        const selection = captureSelection({ ...input, catalogOrigin: state.catalogOrigin, authTokenEnv: state.authTokenEnv });
        const entry = { id: randomUUID(), state: 'CAPTURING', selection, limits: {
          maxRows: input.maxRows ?? 250000, maxBytes: input.maxBytes ?? 268435456 }, createdAt: stamp() };
        const started = launch('capture edition', (signal, progress) => { state.editions.push(entry); return capture(entry, signal, progress); });
        return { ...started, editionId: entry.id };
      },
      resumeCapture(value, limits = {}) {
        const entry = find('editions', value);
        if (entry.state === 'COMPLETE') throw fault('CKAN_EDITION_ALREADY_COMPLETE', 'This retained edition is complete; start a new capture to refresh it.');
        return launch('resume edition', (signal, progress) => { entry.limits = { ...entry.limits, ...limits }; return capture(entry, signal, progress); });
      },
      importCapture(filename, { expectedManifestSha256 } = {}) {
        return launch('receive retained edition', async () => {
          const original = await readCkanCapture(resolve(filename), expectedManifestSha256);
          if (original.manifest.catalogOrigin !== state.catalogOrigin) throw fault('CKAN_CATALOGUE_MISMATCH');
          const prior = state.editions.find(item => item.manifestSha256 === original.manifestSha256);
          if (prior) return structuredClone(prior);
          const value = randomUUID(), target = join(directory, 'editions', value);
          await privateDirectory(target, true); await privateDirectory(join(target, 'pages'), true);
          for (const [file, raw] of original.rawFiles) await createFile(join(target, file), raw);
          await createFile(join(target, 'capture.json'), original.manifestBytes);
          const entry = { id: value, state: 'COMPLETE', selection: original.manifest.selection,
            limits: { maxRows: 250000, maxBytes: 268435456 }, createdAt: stamp(), ...captureSummary(original) };
          state.editions.push(entry); await persist(); return structuredClone(entry);
        });
      },
      edition,
      async compare(beforeId, afterId, key = '_id') {
        const before = await selectedCapture(beforeId), after = await selectedCapture(afterId);
        if (before.manifest.catalogOrigin !== after.manifest.catalogOrigin || before.manifest.resourceId !== after.manifest.resourceId)
          throw fault('CKAN_COMPARE_RESOURCE_MISMATCH');
        const index = rows => {
          const map = new Map();
          for (const row of rows) {
            if (!Object.hasOwn(row, key) || row[key] === null) throw fault('CKAN_COMPARE_KEY_MISSING');
            const value = JSON.stringify(row[key]);
            if (map.has(value)) throw fault('CKAN_COMPARE_KEY_NOT_UNIQUE');
            map.set(value, row);
          }
          return map;
        };
        const left = index(before.rows), right = index(after.rows), changes = [];
        let added = 0, removed = 0, changed = 0, unchanged = 0;
        for (const [value, row] of left) {
          if (!right.has(value)) { removed++; if (changes.length < 100) changes.push({ key: row[key], kind: 'removed', before: row }); }
          else if (identity(row) !== identity(right.get(value))) { changed++; if (changes.length < 100) changes.push({ key: row[key], kind: 'changed', before: row, after: right.get(value) }); }
          else unchanged++;
        }
        for (const [value, row] of right) if (!left.has(value)) { added++; if (changes.length < 100) changes.push({ key: row[key], kind: 'added', after: row }); }
        return { before: captureSummary(before), after: captureSummary(after), key, added, removed, changed, unchanged,
          fieldsChanged: identity(before.fields) !== identity(after.fields),
          semanticChanges: compareCkanSemantics(before, after), changes, shown: changes.length };
      },
      async previewSemantics(editionId, projection) {
        const capture = await selectedCapture(editionId);
        const query = compileQueries({ dataset: { projection } }).dataset;
        return projectCkanSemantics(capture, query.projection);
      },
      saveSource(editionId, input) {
        return launch('save field selection', () => createSourceSelection(editionId, input));
      },
      async sourceSemantics(sourceId) {
        const source = find('sources', sourceId), selected = await readCkanSourceFile(source.file);
        const capture = await readCkanCapture(selected.captureFile, selected.config.connection.sha256);
        bindCkanCapture(capture, selected.config, selected.queries[source.query]);
        return checkCkanSemanticReview(capture, selected.queries[source.query]);
      },
      createPublication(sourceId, input = {}) {
        return launch('prepare dataset candidate', async (signal, progress) => {
          const source = find('sources', sourceId);
          await reviewedRefreshes.assertRefreshPublicationSource(source);
          const selected = await readCkanSourceFile(source.file), query = selected.queries[source.query];
          if (selected.hash !== source.sha256 || identity(query.projection) !== identity(source.projection) ||
              identity(query.semanticReview ?? null) !== identity(source.semanticReview ?? null)) throw fault('CKAN_REFRESH_SOURCE_CHANGED');
          const value = randomUUID(), targetDirectory = join(directory, 'datasets', value);
          const publisher = await openCkanPublisher({ directory: join(directory, 'publications', value), create: true,
            sourceFile: source.file, targetDirectory });
          const entry = { id: value, sourceId, title: source.title, targetDirectory, createdAt: stamp(), state: 'PREPARING',
            ...(source.refreshId ? { refreshId: source.refreshId, refreshDecisionSha256: source.refreshDecisionSha256,
              previousSourceId: source.previousSourceId, previousPublicationId: source.previousPublicationId } : {}) };
          state.publications.push(entry); await persist();
          try {
            const plan = await publisher.savePlan({ title: source.title, query: source.query, input: {}, sourceHash: selected.hash,
              dataset: { name: source.title, columns: Object.fromEntries(Object.entries(query.projection)
                .map(([name, spec]) => [name, { type: spec.type, nullable: spec.nullable }])),
                filters: input.filters ?? [], ranges: input.ranges ?? [], sorts: input.sorts ?? [],
                defaultLimit: input.defaultLimit ?? 50, maxLimit: input.maxLimit ?? 250 },
              extraction: { order: input.order ?? [{ column: query.columns[0], direction: 'asc' }],
                maxRows: input.maxRows ?? 250000, maxBytes: input.maxBytes ?? 67108864,
                maxRowBytes: 1048576, timeoutMs: input.timeoutMs ?? 120000 } });
            entry.planId = plan.id;
            const started = publisher.startExtraction(plan.id); entry.runId = started.id; await persist();
            const cancel = () => { try { publisher.cancel(started.id); } catch {} };
            signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
            let run;
            try { run = await started.completion; } finally { signal.removeEventListener('abort', cancel); }
            entry.state = run.state; entry.run = run; progress({ state: run.state });
            await persist();
            if (run.state !== 'READY') throw fault(run.data.error ?? 'CKAN_CANDIDATE_FAILED');
            return structuredClone(entry);
          } finally { await publisher.close(); }
        });
      },
      async publication(value, query = '') {
        return withPublisher(value, async (publisher, entry) => ({ ...entry,
          run: publisher.run(entry.runId), detail: await publisher.inspect(entry.runId, query || undefined) }));
      },
      reviewPublication(value, input) {
        return launch('review dataset candidate', () => withPublisher(value, async (publisher, entry) => {
          await reviewedRefreshes.assertRefreshPublicationSource(find('sources', entry.sourceId));
          const current = await publisher.candidate(entry.runId);
          if (current.manifest.candidateDigest !== input.expectedCandidateDigest) throw fault('CKAN_CANDIDATE_REVIEW_CHANGED');
          const run = await publisher.review(entry.runId, { reviewer: input.reviewer, note: input.note, initialize: true });
          entry.run = run; entry.state = run.state; await persist(); return structuredClone(entry);
        }));
      },
      recoverPublication(value) {
        return launch('recover retained publication', () => withPublisher(value, async (publisher, entry) => {
          const run = await publisher.recover(entry.runId);
          entry.run = run; entry.state = run.state; await persist(); return structuredClone(entry);
        }));
      },
      publishDataset(value, reviewId) {
        return launch('publish dataset version', () => withPublisher(value, async (publisher, entry) => {
          const current = publisher.run(entry.runId);
          if (current.state !== 'PUBLISHED') await reviewedRefreshes.assertRefreshPublicationSource(find('sources', entry.sourceId));
          const run = current.state === 'PUBLISHED' ? current : await publisher.publish(entry.runId, reviewId);
          entry.run = run; entry.state = run.state; await persist();
          if (run.state !== 'PUBLISHED') throw fault(run.data.error ?? 'CKAN_PUBLICATION_INCOMPLETE');
          return structuredClone(entry);
        }));
      },
      exportMerchant(value, input) {
        return launch('export merchant package', () => withPublisher(value, async (publisher, entry) => {
          const packageId = randomUUID(), output = join(directory, 'merchant-packages', packageId);
          const result = await exportCkanMerchantPackage({ publisher, runId: entry.runId, directory: output,
            expectedCandidateDigest: input.expectedCandidateDigest, payment: input.payment, origin: input.origin, path: input.path ?? '/data' });
          const exported = { id: packageId, publicationId: value, createdAt: stamp(), ...result };
          state.exports.push(exported); await persist(); return structuredClone(exported);
        }));
      },
      stageMerchant(value, input) {
        return launch('stage seller release', async () => {
          const entry = find('exports', value), root = join(directory, 'seller-releases');
          if (!await exists(root)) await initReleaseStore(root);
          const result = await stageCkanMerchantRelease(root, { packageDirectory: entry.directory,
            expectedManifestSha256: input.expectedManifestSha256, id: input.releaseId,
            label: input.label, runtime: input.runtime });
          entry.staged = { root, ...result }; await persist(); return structuredClone(entry);
        });
      },
      async buyerOffer(value, input) {
        const entry = find('exports', value);
        return readCkanMerchantBuyerOffer({ packageDirectory: entry.directory,
          expectedManifestSha256: entry.manifestSha256, seller: input.seller, query: input.query ?? '' });
      },
      prepareBuyer(value, input) {
        return launch('prepare buyer request', async () => {
          const entry = find('exports', value), requestId = randomUUID(), out = join(directory, 'buyer-requests', requestId + '.json');
          const result = await prepareCkanMerchantBuyer({ packageDirectory: entry.directory,
            expectedManifestSha256: entry.manifestSha256, seller: input.seller, query: input.query ?? '',
            intentId: input.intentId, acceptIndex: input.acceptIndex, offerSha256: input.offerSha256, out });
          const saved = { id: requestId, exportId: value, createdAt: stamp(), out, ...result };
          state.buyerRequests.push(saved); await persist(); return structuredClone(saved);
        });
      },
      async workspaceArchives() {
        const root = join(directory, 'workspace-archives');
        if (!await exists(root)) return [];
        const records = [];
        for (const item of await readdir(root, { withFileTypes: true })) {
          if (!item.isFile() || !/^[a-f0-9-]{36}\.json$/.test(item.name)) continue;
          const record = await readJson(join(root, item.name), 33554432);
          if (record.id + '.json' !== item.name || record.schema !== 'stellar-forge.ckan-workspace-archive.v1')
            throw fault('CKAN_WORKSPACE_ARCHIVE_INVALID');
          records.push(record);
        }
        return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },
      async workspaceArchive(value) {
        const selected = await readJson(join(directory, 'workspace-archives', id(value) + '.json'), 33554432);
        if (selected.id !== value || selected.schema !== 'stellar-forge.ckan-workspace-archive.v1')
          throw fault('CKAN_WORKSPACE_ARCHIVE_INVALID');
        return selected;
      },
      archiveWorkspace(input = {}) {
        const snapshot = bytes(state), value = randomUUID();
        return launch('export complete workspace', async (signal, progress) => {
          const root = join(directory, 'workspace-archives');
          await privateDirectory(root, true);
          const out = input.out ? resolve(input.out) : join(root, value + '.ckanw');
          const result = await createCkanWorkspaceArchive({ directory, out,
            workbenchBytes: snapshot, projectLeaseHeld: true, signal, onProgress: progress,
            ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
            ...(input.maxFiles === undefined ? {} : { maxFiles: input.maxFiles }) });
          const saved = { id: value, ...result };
          await createFile(join(root, value + '.json'), bytes(saved));
          return saved;
        });
      },
      receiveWorkspace(input) {
        if (typeof input.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input.name) ||
            ['.', '..', basename(directory)].includes(input.name))
          throw fault('CKAN_RECEIVE_NAME_INVALID', 'Enter a new project directory name beside this project.');
        const destination = join(dirname(directory), input.name);
        return launch('receive complete workspace', (signal, progress) =>
          receiveCkanWorkspaceArchive({ file: resolve(input.file), directory: destination,
            expectedSha256: input.expectedSha256, signal, onProgress: progress,
            ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
            ...(input.maxFiles === undefined ? {} : { maxFiles: input.maxFiles }) }));
      },
      cancel() { if (!active) throw fault('CKAN_NO_ACTIVE_OPERATION'); active.controller.abort(); return { cancelling: active.operation.id }; },
      async close() {
        if (closed) return; closed = true; active?.controller.abort();
        try { await active?.completion; } finally { await release(); }
      },
    };
    return api;
  } catch (error) { await release(); throw error; }
}

