// MIT. Original OpenSearch source and seller compiler joined to retained operator work.
import { readFile, mkdir, readdir, lstat, realpath, chmod, open, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, relative, basename, sep } from 'node:path';
import { readOpenSearchSourceFile, createOpenSearchQuerySource } from '../source.mjs';
import { validateOpenSearchSource, compileOpenSearchQueries, bindOpenSearchParameters } from '../declaration.mjs';
import { compileOpenSearchMerchantPlan, prepareOpenSearchSeller } from '../prepare.mjs';
import { OpenSearchRelevanceWorkspace } from '../relevance/workspace.mjs';
import { OpenSearchDeploymentWorkspace } from './deployment.mjs';
import { openWorkspaceStore, WorkspaceError, clone, digest, identifier, compareEditions, editionCsv } from './store.mjs';

const DEFAULT_PLAN = { schema: 'stellar-forge.opensearch-merchant-plan.v1',
  publicOrigin: 'https://search.example.com',
  payment: { scheme: 'exact', network: 'stellar:testnet', amount: '', asset: '', payTo: '' }, routes: [] };
function profile(config) {
  const { queries, ...connection } = config;
  return connection;
}
function nativeError(error, config, env) {
  let message = String(error?.message ?? 'The operation failed.');
  const authentication = config.auth ?? {};
  for (const key of [authentication.userEnv, authentication.passwordEnv, authentication.tokenEnv]) {
    const value = key && env[key];
    if (typeof value === 'string' && value.length) message = message.split(value).join('[credential]');
  }
  message = message.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[credential]@');
  const declared = error?.code ?? (/^[A-Z][A-Z0-9_]{2,95}$/.test(String(error?.message ?? '')) ? error.message : null);
  const code = /^[A-Z][A-Z0-9_]{2,95}$/.test(declared ?? '') ? declared : 'OPENSEARCH_WORKSPACE_OPERATION_FAILED';
  return { code, message: message.slice(0, 1600),
    ...(Number.isInteger(error?.status) ? { status: error.status } : {}) };
}
async function writeOriginal(path, value) {
  const raw = JSON.stringify(value, null, 2) + '\n';
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await readFile(path, 'utf8') !== raw) throw new WorkspaceError('WORKSPACE_SOURCE_EDITION_CHANGED', 'The retained source edition changed.', 409);
    }
  } finally { await unlink(temporary).catch(() => {}); }
}
async function packageFiles(directory) {
  const root = await realpath(directory), files = [];
  async function visit(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, item.name);
      if (item.isSymbolicLink()) throw new WorkspaceError('WORKSPACE_PACKAGE_SYMLINK');
      if (item.isDirectory()) await visit(absolute);
      else if (item.isFile()) {
        const bytes = await readFile(absolute);
        if (bytes.length > 16 * 1024 * 1024) throw new WorkspaceError('WORKSPACE_PACKAGE_FILE_TOO_LARGE');
        files.push({ name: relative(root, absolute).split(sep).join('/'), bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  await visit(root);
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

export async function createOpenSearchWorkspace({ sourceFile, planFile, directory, env = process.env,
  sourceFactory = createOpenSearchQuerySource, prepareSeller = prepareOpenSearchSeller, relevanceOptions } = {}) {
  const source = await readOpenSearchSourceFile(sourceFile);
  const config = validateOpenSearchSource(source.config);
  const templatePlan = planFile ? JSON.parse(await readFile(resolve(planFile), 'utf8')) : DEFAULT_PLAN;
  const store = await openWorkspaceStore(directory, digest(profile(config)));
  try {
    for (const name of ['sources', 'packages']) {
      const path = join(store.directory, name);
      await mkdir(path, { recursive: true, mode: 0o700 });
      if (!(await lstat(path)).isDirectory() || (await lstat(path)).isSymbolicLink()) throw new WorkspaceError('WORKSPACE_CHILD_DIRECTORY_INVALID');
      await chmod(path, 0o700);
    }
    return new OpenSearchWorkspace({ source, config, templatePlan, store, env, sourceFactory, prepareSeller, relevanceOptions });
  } catch (error) { store.close(); throw error; }
}

class OpenSearchWorkspace {
  constructor(options) {
    Object.assign(this, options); this.active = new Map(); this.nativeBusy = false; this.closed = false;
    this.relevance = new OpenSearchRelevanceWorkspace(this, options.relevanceOptions);
    this.deployment = new OpenSearchDeploymentWorkspace(this);
  }
  state() {
    return { ...this.store.state(), source: { name: basename(this.source.path ?? 'source.json'),
      schema: this.config.schema, connection: profile(this.config),
      queries: clone(this.config.queries) }, templatePlan: clone(this.templatePlan), nativeBusy: this.nativeBusy, relevance: this.relevance.state(), deployment: this.deployment.summary() };
  }
  failure(error) { return nativeError(error, this.config, this.env); }
  draft(id, revision) { return this.store.draft(id, revision); }
  operation(id) { return this.store.operation(id); }
  history(id) { return this.store.history(id); }
  edition(id) { return this.store.edition(id, true); }
  package(id) { return this.store.package(id); }
  save(request) {
    if (this.closed) throw new WorkspaceError('WORKSPACE_CLOSING', 'Workspace is closing.', 503);
    return this.store.saveDraft(request);
  }
  configFor(draft) {
    return validateOpenSearchSource({ ...clone(profile(this.config)), queries: { [draft.queryName]: clone(draft.query) } });
  }
  validate(id, revision) {
    const draft = this.store.draft(id, revision);
    try {
      const config = this.configFor(draft);
      bindOpenSearchParameters(compileOpenSearchQueries(config.queries)[draft.queryName], clone(draft.input));
      const compiled = compileOpenSearchMerchantPlan(config.queries, draft.plan);
      return { draftId: id, revision: draft.revision, source: config,
        merchant: compiled, sourceSha256: digest(config), planSha256: digest(draft.plan) };
    } catch (error) {
      const failure = nativeError(error, this.config, this.env);
      throw new WorkspaceError(failure.code, failure.message, failure.status ?? 422);
    }
  }
  async filesFor(draft) {
    const config = this.configFor(draft), stem = draft.id + '-r' + draft.revision;
    const sourceFile = join(this.store.directory, 'sources', stem + '-source.json');
    const planFile = join(this.store.directory, 'sources', stem + '-plan.json');
    await writeOriginal(sourceFile, config);
    await writeOriginal(planFile, draft.plan);
    return { sourceFile, planFile, config };
  }
  async run(kind, request) {
    if (this.closed) throw new WorkspaceError('WORKSPACE_CLOSING', 'Workspace is closing.', 503);
    if (!['inspect', 'capture', 'prepare'].includes(kind)) throw new WorkspaceError('WORKSPACE_OPERATION_INVALID');
    const previous = (() => { try { return this.store.operation(request.requestId); } catch (e) { if (e.code !== 'WORKSPACE_OPERATION_NOT_FOUND') throw e; return null; } })();
    if (!previous && kind !== 'prepare' && this.nativeBusy)
      throw new WorkspaceError('WORKSPACE_NATIVE_BUSY', 'Another native source operation is running. Its original request is retained.', 409);
    const reserved = this.store.begin(kind, request);
    if (reserved.existing) return reserved.operation;
    const draft = reserved.operation.draft;
    if (kind !== 'prepare') this.nativeBusy = true;
    const task = (async () => {
      let native, result, failure, cleanup;
      const config = this.configFor(draft);
      try {
        if (kind === 'prepare') {
          const files = await this.filesFor(draft);
          compileOpenSearchMerchantPlan(config.queries, draft.plan);
          const packageId = digest('package:' + request.requestId).slice(0, 32);
          const directory = join(this.store.directory, 'packages', packageId);
          const prepared = await this.prepareSeller({ sourceFile: files.sourceFile, planFile: files.planFile, directory });
          const manifest = await packageFiles(directory);
          return this.store.registerPackage(request.requestId, { directory, sourceSha256: digest(config),
            planSha256: digest(draft.plan), files: manifest,
            handoff: clone(prepared), sourceQuery: { name: draft.queryName, fields: draft.query.fields, parameters: draft.query.parameters },
            launchNote: 'Use the original OpenSearch seller launcher with this directory and the same source credential environment.' });
        }
        native = await this.sourceFactory(config, { env: this.env });
        if (kind === 'inspect') result = { draftId: draft.id, revision: draft.revision,
          description: await native.describe(), inspection: await native.inspect(), status: await native.status(),
          sourceSha256: digest(config) };
        else result = await native.query(draft.queryName, clone(draft.input));
      } catch (error) { failure = nativeError(error, config, this.env); }
      finally {
        if (native) { try { await native.close(); } catch (error) { cleanup = nativeError(error, config, this.env); } }
      }
      if (failure) return this.store.finish(request.requestId, null, { ...failure, ...(cleanup ? { cleanup } : {}) });
      if (kind === 'capture') return this.store.capture(request.requestId, result, cleanup ? { cleanup } : {});
      return this.store.finish(request.requestId, { ...result, ...(cleanup ? { cleanup } : {}) });
    })().catch(error => this.store.finish(request.requestId, null, nativeError(error, this.config, this.env)))
      .finally(() => { if (kind !== 'prepare') this.nativeBusy = false; this.active.delete(request.requestId); });
    this.active.set(request.requestId, task);
    return task;
  }
  compare(before, after) { return compareEditions(this.edition(before), this.edition(after)); }
  downloadEdition(id, format) {
    const edition = this.edition(id);
    if (format === 'result.json') return { type: 'application/json; charset=utf-8', filename: 'opensearch-' + id + '-result.json', body: this.store.resultText(id) };
    if (format === 'edition.json') return { type: 'application/json; charset=utf-8', filename: 'opensearch-' + id + '-edition.json', body: JSON.stringify(edition, null, 2) + '\n' };
    if (format === 'results.csv') return { type: 'text/csv; charset=utf-8', filename: 'opensearch-' + id + '.csv', body: editionCsv(edition) };
    throw new WorkspaceError('WORKSPACE_EXPORT_FORMAT_INVALID');
  }
  async downloadPackage(id, name) {
    const record = this.store.package(id);
    const item = record.files.find(file => file.name === name);
    if (!item) throw new WorkspaceError('WORKSPACE_PACKAGE_FILE_NOT_FOUND', 'Package file not found.', 404);
    const root = await realpath(record.directory), path = resolve(root, name);
    if (!path.startsWith(root + sep)) throw new WorkspaceError('WORKSPACE_PACKAGE_FILE_INVALID');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new WorkspaceError('WORKSPACE_PACKAGE_FILE_INVALID');
    const raw = await readFile(path);
    if (raw.length !== item.bytes || digest(raw) !== item.sha256)
      throw new WorkspaceError('WORKSPACE_PACKAGE_FILE_CHANGED', 'The retained package file no longer matches its manifest.', 409);
    return { type: name.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream',
      filename: basename(name), body: raw };
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([...this.active.values()]);
    try { await this.deployment.close(); } finally { this.store.close(); }
  }
}
