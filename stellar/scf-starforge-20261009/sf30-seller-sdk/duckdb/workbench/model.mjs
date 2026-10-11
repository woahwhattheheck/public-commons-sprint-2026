// MIT. Durable operator workflow over the original DuckDB authoring/preparation/seller.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, readdir } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { inspectDuckdbCatalog, assertDuckdbCatalogCurrent } from './catalog.mjs';
import { compileDuckdbQueryPlan, duckdbColumnParameter } from './author.mjs';
import { prepareWorkbenchSource } from './bootstrap.mjs';
import { openDuckdbSourceFile } from '../source.mjs';
import { startDuckdbSeller } from '../merchant.mjs';
import { compileDuckdbMerchantPlan, prepareDuckdbSeller, verifyPreparedDuckdbSeller } from '../prepare.mjs';

const FORMAT = 'stellar-forge.duckdb-workbench.v1';
const MAX_STATE = 1048576;
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fault = (code, status = 422) => Object.assign(new Error(code), { code, status });
const namePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const packageName = name => {
  if (typeof name !== 'string' || !namePattern.test(name)) throw fault('PACKAGE_NAME_INVALID');
  return name;
};

async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(issue => { if (issue.code !== 'EEXIST') throw issue; });
  const stat = await lstat(path), canonical = await realpath(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || canonical !== resolve(path) || (stat.mode & 0o077))
    throw fault('PRIVATE_WORKSPACE_REQUIRED');
  return canonical;
}
async function privateRead(path, maximum = MAX_STATE) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.size > maximum)
      throw fault('WORKSPACE_FILE_INVALID');
    const bytes = await file.readFile();
    if (bytes.length > maximum) throw fault('WORKSPACE_FILE_TOO_LARGE');
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes };
  } finally { await file.close(); }
}
async function createPrivate(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(typeof value === 'string' ? value : json(value)); await handle.sync(); }
  finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
function draftShape(draft) {
  if (!object(draft) || !object(draft.merchant) || !Array.isArray(draft.queries) || draft.queries.length > 32 ||
      draft.queries.some(query => !object(query) || !object(query.author) || !object(query.route)) ||
      Buffer.byteLength(json(draft)) > 900000) throw fault('WORKSPACE_DRAFT_INVALID');
  return structuredClone(draft);
}
function initialDraft() {
  return { merchant: { publicOrigin: '', paymentOptions: [{ scheme: 'exact', network: 'stellar:testnet',
    asset: '', payTo: '', amount: '', maxTimeoutSeconds: 60 }] }, queries: [] };
}

export async function openDuckdbWorkbench({ workspace, sourceFile, dataDirectory, database, parquetFiles,
  python = 'python3', environment = process.env, nativeFactory = null } = {}) {
  const root = await privateDirectory(resolve(workspace), true);
  const lease = await acquireStateLease(root);
  const statePath = join(root, 'draft.json'), packagesRoot = join(root, 'packages');
  const recordsRoot = join(root, 'authoring');
  let tail = Promise.resolve(), closed = false, closing, running = null, previewBusy = false;
  const profiles = new Map();
  const previews = new Set(), activeWork = new Set();
  const tracked = action => {
    const promise = Promise.resolve().then(action);
    activeWork.add(promise);
    promise.then(() => activeWork.delete(promise), () => activeWork.delete(promise));
    return promise;
  };
  const alive = () => { if (closed) throw fault('WORKBENCH_CLOSED', 503); lease.assertHeld(); };
  const exclusive = task => {
    alive();
    const promise = tail.then(() => { lease.assertHeld(); return task(); });
    tail = promise.catch(() => {});
    return promise;
  };
  let originalSource, sourceLabel;
  async function load() {
    const { value, bytes } = await privateRead(statePath);
    if (value.schema !== FORMAT || value.sourceFile !== originalSource) throw fault('WORKSPACE_SOURCE_MISMATCH');
    return { revision: hash(bytes), draft: draftShape(value.draft), savedAt: value.savedAt };
  }
  async function sourceProfile(query) {
    const id = query.author.relationId;
    if (!profiles.has(id)) {
      const result = await inspectDuckdbCatalog({ sourceFile: originalSource, python, environment,
        cursor: query.catalogCursor ?? undefined });
      for (const relation of result.catalog.relations) {
        profiles.set(relation.id, result.profile);
      }
    }
    const profile = profiles.get(id);
    if (!profile) throw fault('SOURCE_RELATION_RESELECT_REQUIRED');
    await assertDuckdbCatalogCurrent(profile);
    return profile;
  }
  async function compileQuery(entry) {
    const profile = await sourceProfile(entry);
    return { profile, authored: compileDuckdbQueryPlan({ profile, plan: entry.author }) };
  }
  async function compileDraft(draft) {
    draftShape(draft);
    if (!draft.queries.length) throw fault('ADD_A_QUERY_FIRST');
    const queries = Object.create(null), routes = [], reviews = [], seen = new Set();
    let profile, sourceConfig;
    for (const entry of draft.queries) {
      const current = await compileQuery(entry), authored = current.authored;
      profile ??= current.profile;
      if (profile.sourceSha256 !== current.profile.sourceSha256) throw fault('CATALOG_SOURCE_CHANGED');
      if (seen.has(authored.queryName.toLowerCase())) throw fault('QUERY_NAMES_MUST_BE_UNIQUE');
      seen.add(authored.queryName.toLowerCase()); queries[authored.queryName] = authored.query;
      sourceConfig ??= authored.sourceConfig;
      const descriptions = { ...authored.parameterDescriptions, ...(entry.route.parameterDescriptions ?? {}) };
      routes.push({ ...entry.route, query: authored.queryName,
        example: entry.route.example ?? authored.example, parameterDescriptions: descriptions });
      reviews.push(authored.review);
    }
    sourceConfig = { ...sourceConfig, queries };
    const plan = { schema: 'stellar-forge.duckdb-merchant-plan.v1', ...draft.merchant, routes };
    const merchant = compileDuckdbMerchantPlan(queries, plan);
    return { profile, sourceConfig, plan, merchant, reviews };
  }
  async function withAuthoredSource(profile, sourceConfig, action) {
    await assertDuckdbCatalogCurrent(profile);
    const path = join(profile.sourceDirectory, '.stellar-forge-query-' + randomBytes(12).toString('hex') + '.json');
    await createPrivate(path, sourceConfig);
    try {
      const result = await action(path);
      await assertDuckdbCatalogCurrent(profile);
      return result;
    } finally { await unlink(path); }
  }
  async function packages() {
    const entries = await readdir(packagesRoot, { withFileTypes: true }), result = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !namePattern.test(entry.name)) continue;
      try {
        const { value } = await privateRead(join(packagesRoot, entry.name, 'manifest.json'));
        if (value.schema !== 'stellar-forge.duckdb-merchant-package.v1') continue;
        result.push({ name: entry.name, createdAt: value.createdAt, datasetBytes: value.datasetBytes,
          routes: value.routes, state: running?.name === entry.name ? 'RUNNING' : 'SAVED' });
      } catch (issue) {
        result.push({ name: entry.name, state: issue.code === 'ENOENT' ? 'INCOMPLETE' : 'UNREADABLE' });
      }
    }
    return result.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? '') || left.name.localeCompare(right.name));
  }
  function runtime() {
    if (!running) return { state: 'STOPPED' };
    return { state: 'RUNNING', package: running.name, url: running.session.seller.url,
      docs: running.session.seller.url + '/_seller/docs', ready: running.session.seller.url + '/_seller/ready',
      operations: running.session.operations?.url ?? null, mode: running.session.seller.mode,
      source: running.session.source.status() };
  }
  async function state() {
    lease.assertHeld();
    return { ...await load(), source: sourceLabel, workspace: root, packages: await packages(), runtime: runtime(),
      nativeEnabled: nativeFactory !== null };
  }
  async function catalog({ cursor, signal } = {}) {
    alive();
    const result = await inspectDuckdbCatalog({ sourceFile: originalSource, python, environment, cursor, signal });
    if (!cursor) profiles.clear();
    for (const relation of result.catalog.relations) {
      profiles.set(relation.id, result.profile);
    }
    return { ...result.catalog, cursor: cursor ?? null, relations: result.catalog.relations.map(relation => ({
      ...relation, columns: relation.columns.map(column => ({ ...column, parameter: duckdbColumnParameter(column) })),
    })) };
  }
  async function save(draft, revision) {
    draftShape(draft);
    return exclusive(async () => {
      if ((await load()).revision !== revision) throw fault('DRAFT_REVISION_CHANGED', 409);
      const temp = join(root, '.draft-' + randomBytes(12).toString('hex'));
      try {
        await createPrivate(temp, { schema: FORMAT, sourceFile: originalSource, savedAt: new Date().toISOString(), draft });
        await rename(temp, statePath); await syncDirectory(root);
      } finally { await unlink(temp).catch(issue => { if (issue.code !== 'ENOENT') throw issue; }); }
      return state();
    });
  }
  async function review(draft) {
    alive(); const compiled = await compileDraft(draft);
    return { review: compiled.merchant.review, data: compiled.reviews, plan: compiled.plan,
      openapi: compiled.merchant.openapi, source: compiled.sourceConfig };
  }
  async function preview(entry, input = {}, { signal } = {}) {
    alive();
    if (previewBusy) throw fault('PREVIEW_ALREADY_RUNNING', 409);
    previewBusy = true;
    const controller = new AbortController(), abort = () => controller.abort();
    previews.add(controller); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const { profile, authored } = await compileQuery(entry);
      return await withAuthoredSource(profile, authored.sourceConfig, async source => {
        const opened = await openDuckdbSourceFile(source, { python, environment });
        try { return await opened.source.query(authored.queryName, input, { signal: controller.signal }); }
        finally { await opened.source.close(); }
      });
    } finally { previewBusy = false; previews.delete(controller); signal?.removeEventListener('abort', abort); }
  }
  async function prepare(name, revision) {
    packageName(name);
    return exclusive(async () => {
      const saved = await load();
      if (saved.revision !== revision) throw fault('DRAFT_REVISION_CHANGED', 409);
      const compiled = await compileDraft(saved.draft), planFile = join(root, '.plan-' + randomBytes(12).toString('hex') + '.json');
      await createPrivate(planFile, compiled.plan);
      let prepared;
      try {
        prepared = await withAuthoredSource(compiled.profile, compiled.sourceConfig, sourceFile =>
          prepareDuckdbSeller({ sourceFile, planFile, directory: join(packagesRoot, name), python, environment }));
      } finally { await unlink(planFile); }
      await createPrivate(join(recordsRoot, name + '.json'), { schema: 'stellar-forge.duckdb-workbench-authoring.v1',
        sourceFile: originalSource, sourceSha256: compiled.profile.sourceSha256, draftRevision: saved.revision,
        draft: saved.draft, createdAt: new Date().toISOString(), package: name });
      await syncDirectory(recordsRoot);
      return { prepared, ...await state() };
    });
  }
  async function inspectPackage(name) {
    alive(); packageName(name);
    const checked = await verifyPreparedDuckdbSeller({ directory: join(packagesRoot, name) });
    return { name, review: checked.review, manifest: { createdAt: checked.manifest.createdAt,
      datasetBytes: checked.manifest.datasetBytes, nativePreflight: checked.manifest.nativePreflight,
      routes: checked.manifest.routes }, sourceSha256: checked.sourceSha256 };
  }
  async function start(name, { port = 0, operationsPort = 0 } = {}) {
    packageName(name);
    return exclusive(async () => {
      if (running) throw fault('STOP_CURRENT_SELLER_FIRST', 409);
      for (const value of [port, operationsPort])
        if (!Number.isInteger(value) || value < 0 || value > 65535) throw fault('PORT_INVALID');
      const checked = await verifyPreparedDuckdbSeller({ directory: join(packagesRoot, name) });
      const session = await startDuckdbSeller({ sourceFile: checked.source, configFile: checked.config, python,
        environment, port, operationsPort, nativeFactory, expectedSourceSha256: checked.sourceSha256,
        expectedSourceConfig: checked.sourceConfig, expectedServiceConfig: checked.service });
      running = { name, session };
      return state();
    });
  }
  async function stop() {
    return exclusive(async () => {
      if (running) { const session = running.session; await session.close(); running = null; }
      return state();
    });
  }
  async function exportedFile(name, file) {
    alive(); packageName(name);
    const allowed = new Set(['plan.json', 'openapi.json', 'review.json', 'client/seller-client.mjs',
      'client/seller-client.d.mts', 'client/seller-openapi.json', 'client/README.md', 'client/package.json']);
    if (!allowed.has(file)) throw fault('EXPORT_FILE_NOT_AVAILABLE', 404);
    // Metadata downloads read only the requested generated artifact. Inspect
    // and Start retain the original full package and dataset verification.
    const directory = await privateDirectory(join(packagesRoot, name));
    if (file.startsWith('client/')) await privateDirectory(join(directory, 'client'));
    const { value: manifest } = await privateRead(join(directory, 'manifest.json'), 262144);
    if (manifest.schema !== 'stellar-forge.duckdb-merchant-package.v1' || !Array.isArray(manifest.files) ||
        manifest.files.length > 64) throw fault('DUCKDB_PACKAGE_MANIFEST_INVALID');
    const entries = manifest.files.filter(entry => entry?.path === file);
    const entry = entries[0];
    if (entries.length !== 1 || entry.kind !== 'generated' ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        typeof entry.bytes !== 'string' || !/^(0|[1-9][0-9]*)$/.test(entry.bytes))
      throw fault('DUCKDB_PACKAGE_MANIFEST_INVALID');
    const path = join(directory, file), handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16777216 || String(stat.size) !== entry.bytes)
        throw fault('EXPORT_FILE_INVALID');
      const bytes = await handle.readFile();
      if (String(bytes.length) !== entry.bytes || hash(bytes) !== entry.sha256)
        throw fault('DUCKDB_PACKAGE_ARTIFACT_CHANGED');
      return { bytes, name: basename(file) };
    } finally { await handle.close(); }
  }
  async function close() {
    if (closing) return closing;
    closed = true;
    for (const controller of previews) controller.abort();
    closing = (async () => {
      await tail;
      await Promise.allSettled([...activeWork]);
      try { await running?.session.close(); running = null; }
      finally { await lease.close(); }
    })();
    return closing;
  }
  try {
    await privateDirectory(packagesRoot, true); await privateDirectory(recordsRoot, true);
    let saved;
    try { saved = (await privateRead(statePath)).value; }
    catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    if (saved && !sourceFile && !dataDirectory) sourceFile = saved.sourceFile;
    const selected = await prepareWorkbenchSource({ sourceFile, dataDirectory, database, parquetFiles, workspace: root });
    originalSource = selected.sourceFile; sourceLabel = basename(originalSource);
    if (!saved) await createPrivate(statePath, { schema: FORMAT, sourceFile: originalSource,
      savedAt: new Date().toISOString(), draft: initialDraft() });
    await load();
  } catch (issue) { await lease.close(); throw issue; }
  return { state: () => { alive(); return state(); }, catalog: options => tracked(() => catalog(options)), save,
    review: draft => tracked(() => review(draft)), preview: (...args) => tracked(() => preview(...args)),
    prepare, inspectPackage, start, stop, exportedFile, close };
}
