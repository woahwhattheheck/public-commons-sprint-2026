// MIT. Original DuckDB preparation, data reader and seller lifecycle in one workspace.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readDuckdbSourceFile, describeDuckdbSource } from '../config.mjs';
import { openDuckdbSourceFile } from '../source.mjs';
import { compileDuckdbMerchantPlan, DUCKDB_MERCHANT_PLAN_SCHEMA } from '../merchant-plan.mjs';
import { prepareDuckdbSeller, verifyPreparedDuckdbSeller, readDuckdbMerchantPlan } from '../prepare.mjs';
import { startDuckdbSeller } from '../merchant.mjs';
import { startSellerOperations } from '../../operations/server.mjs';
import { validateAvailabilityDirectory } from '../../availability/store.mjs';
import { openWorkspaceStore, WorkspaceError, sha256, json, operationId, revisionNumber, encodePlan } from './store.mjs';
import { createWorkspaceAuthoring } from './authoring.mjs';

export { WorkspaceError };
export const ARTIFACTS = Object.freeze({
  'plan.json': 'application/json', 'service.json': 'application/json', 'review.json': 'application/json',
  'openapi.json': 'application/json', 'client/seller-openapi.json': 'application/json',
  'client/seller-client.mjs': 'text/javascript', 'client/seller-client.d.mts': 'text/plain',
  'client/package.json': 'application/json', 'client/README.md': 'text/markdown',
});
const initialPlan = () => ({ schema: DUCKDB_MERCHANT_PLAN_SCHEMA, publicOrigin: '', paymentOptions: [], routes: [] });
const publicDescription = declaration => {
  const description = describeDuckdbSource(declaration);
  for (const query of Object.values(description.queries)) for (const parameter of Object.values(query.parameters)) {
    parameter.optional = Object.hasOwn(parameter, 'default');
    delete parameter.default;
  }
  return { ...description, datasetBytes: String(declaration.snapshot.files.reduce((sum, file) => sum + BigInt(file.size), 0n)) };
};
export function publicIssue(error) {
  if (error instanceof WorkspaceError) return { status: error.status, error: error.code, message: error.message };
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code))
    return { status: error.name === 'QueryInputError' ? 422 : 503, error: error.code,
      message: error.code.replaceAll('_', ' ').toLowerCase(), ...(error.field ? { field: error.field } : {}) };
  return { status: 503, error: 'DUCKDB_WORKSPACE_UNAVAILABLE', message: 'The native workspace could not complete this operation.' };
}
const sameSource = (declaration, expected) => {
  if (declaration.sourceSha256 !== expected) throw new WorkspaceError('SOURCE_CHANGED', 409,
    'The approved data source changed. Refresh its description and save a reviewed draft against the current source.');
};
function compiledPlan(declaration, plan) {
  try { return compileDuckdbMerchantPlan(declaration.queries, plan); }
  catch (error) {
    const detail = typeof error.message === 'string' && error.message.length < 500 ? error.message : 'Check the merchant plan.';
    throw new WorkspaceError('MERCHANT_PLAN_INVALID', 422, detail);
  }
}
async function writeOnce(filename, bytes) {
  let handle;
  try {
    handle = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes); await handle.sync();
  } finally { await handle?.close(); }
}
async function readArtifactFile(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw new WorkspaceError('PACKAGE_ARTIFACT_INVALID', 409);
    const bytes = Buffer.alloc(Number(stat.size) + 1); let total = 0;
    while (total < bytes.length) {
      const next = await handle.read(bytes, total, bytes.length - total, null);
      if (!next.bytesRead) break;
      total += next.bytesRead;
    }
    if (total !== stat.size) throw new WorkspaceError('PACKAGE_ARTIFACT_CHANGED', 409);
    return bytes.subarray(0, total);
  } finally { await handle.close(); }
}

export async function createDuckdbWorkspace({ directory, sourceFile, planFile,
  python = 'python3', environment = process.env, sellerPort = 0, operationsPort = 0,
  nativeFactory = null, navigationOrigin = null, maxInFlight = 64, drainGraceMs = 60000, availabilityDirectory } = {}) {
  if (!sourceFile || !directory) throw new WorkspaceError('SOURCE_AND_WORKSPACE_REQUIRED');
  if (availabilityDirectory !== undefined) validateAvailabilityDirectory(availabilityDirectory);
  for (const port of [sellerPort, operationsPort]) if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new WorkspaceError('INVALID_LISTENER_PORT');
  let originalSource;
  try { originalSource = await readDuckdbSourceFile(sourceFile); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const store = await openWorkspaceStore({ directory, sourceFile: originalSource?.path ?? resolve(sourceFile) });
  let active = null, closing = false, tail = Promise.resolve(), closePromise;
  try {
    if (!originalSource && !store.latest()) throw new WorkspaceError('APPROVED_SOURCE_NOT_FOUND', 404);
    if (originalSource) store.sourceDescription(publicDescription(originalSource));
    if (!store.latest() && planFile) store.saveDraft({ expectedRevision: 0, operationId: 'initial-' + randomUUID(),
      sourceSha256: originalSource.sourceSha256, plan: await readDuckdbMerchantPlan(planFile) });
  } catch (error) { store.close(); throw error; }
  const currentSource = () => readDuckdbSourceFile(store.sourceFile);
  const author = createWorkspaceAuthoring({ sourceFile: store.sourceFile, python, environment });
  const packagePath = id => resolve(store.directory, 'packages', operationId(id));
  const mutate = fn => {
    if (closing) return Promise.reject(new WorkspaceError('WORKSPACE_CLOSING', 503));
    const task = tail.then(fn); tail = task.catch(() => {}); return task;
  };
  function draftFor(revision) {
    const value = store.getDraft(revisionNumber(revision));
    if (!value) throw new WorkspaceError('DRAFT_NOT_FOUND', 404);
    return value;
  }
  function packageFor(id) {
    const value = store.getPackage(id);
    if (!value) throw new WorkspaceError('PACKAGE_NOT_FOUND', 404);
    return value;
  }
  async function review(revision) {
    const draft = draftFor(revision), declaration = await currentSource();
    if (store.latest()?.revision !== revision) throw new WorkspaceError('DRAFT_REVISION_CHANGED', 409,
      'Reopen the current draft before preparing a package.');
    sameSource(declaration, draft.sourceSha256);
    const authored = await author.compile(draft.authoring, draft.sourceSha256);
    const compiled = compiledPlan(authored.declaration, draft.plan);
    const reviewId = sha256(json({ revision, sourceSha256: authored.declaration.sourceSha256,
      authoring: draft.authoring, review: compiled.review }));
    return { revision, sourceSha256: authored.declaration.sourceSha256, originalSourceSha256: declaration.sourceSha256,
      reviewId, review: compiled.review, authored: authored.authored,
      datasetBytes: publicDescription(declaration).datasetBytes,
      datasetFiles: new Set(declaration.snapshot.files.map(file => file.path)).size };
  }
  async function inspectedPackage(id) {
    const item = packageFor(id);
    let prepared;
    try { prepared = await verifyPreparedDuckdbSeller({ directory: packagePath(id) }); }
    catch (error) {
      if (error.code === 'ENOENT') throw new WorkspaceError('PACKAGE_INCOMPLETE', 409,
        'Preparation was interrupted before the package completed. Prepare a new package from the saved draft.');
      throw error;
    }
    const manifestBytes = await readArtifactFile(resolve(packagePath(id), 'manifest.json'), 262144);
    const draft = draftFor(item.revision);
    if (sha256(json(await readDuckdbMerchantPlan(resolve(packagePath(id), 'plan.json')))) !== draft.planSha256 ||
        prepared.manifest.originalSource.sourceSha256 !== item.sourceSha256)
      throw new WorkspaceError('PACKAGE_DRAFT_MISMATCH', 409);
    const summary = { publicOrigin: prepared.manifest.publicOrigin, routes: prepared.manifest.routes,
      nativePreflight: prepared.manifest.nativePreflight, datasetBytes: prepared.manifest.datasetBytes,
      packageSha256: sha256(manifestBytes), review: prepared.review,
      artifacts: prepared.manifest.files.filter(file => Object.hasOwn(ARTIFACTS, file.path)) };
    return { item: store.completePackage(id, summary), prepared, summary };
  }
  const runtime = () => ({ ...store.runtime(), ...(active ? {
    url: active.session.seller.url, docs: active.session.seller.url + '/_seller/docs',
    ready: active.session.seller.url + '/_seller/ready', operations: active.operations.url,
    mode: active.session.seller.mode, engineVersion: active.session.source.inspect().engineVersion,
    source: active.session.source.status(),
    ...(active.session.seller.availability ? { availability: active.session.seller.availability.snapshot(),
      availabilityUrl: active.operations.availabilityUrl, availabilityControlUrl: active.operations.availabilityControlUrl } : {}),
  } : {}) });
  async function stopActive(expectedInstanceId) {
    const saved = store.runtime();
    if (typeof expectedInstanceId !== 'string' || expectedInstanceId !== saved.instanceId)
      throw new WorkspaceError('MERCHANT_INSTANCE_CHANGED', 409, 'The merchant instance changed. Refresh its status before stopping.');
    if (!active) return runtime();
    const owned = active;
    store.setRuntime({ ...saved, state: 'STOPPING' });
    try {
      await owned.session.close();
    } finally {
      try { await owned.operations.close(); }
      finally {
        active = null;
        store.setRuntime({ ...saved, state: 'STOPPED', endedAt: new Date().toISOString() });
      }
    }
    return runtime();
  }
  return {
    directory: store.directory,
    state() { return mutate(async () => {
      let source, sourceError = null, authoringError = null;
      const draft = store.latest();
      try {
        source = { ...publicDescription(await currentSource()), available: true };
        const previous = store.sourceDescription();
        if (!previous || previous.sourceSha256 !== source.sourceSha256) store.sourceDescription(source);
      } catch (error) {
        source = { ...store.sourceDescription(), available: false };
        sourceError = publicIssue(error).error;
      }
      if (source.available && draft?.authoring.length) {
        try {
          const authored = await author.compile(draft.authoring, draft.sourceSha256);
          source.queries = publicDescription(authored.declaration).queries;
        } catch (error) { authoringError = publicIssue(error).error; }
      }
      return { schema: 'stellar-forge.duckdb-workspace.v1', workspaceId: store.workspaceId, source, sourceError, authoringError,
        draft, initialPlan: draft ? null : initialPlan(), drafts: store.drafts(), packages: store.packages(),
        sourceChanged: Boolean(draft && draft.sourceSha256 !== source.sourceSha256), runtime: runtime() };
    }); },
    draft(revision) { return draftFor(revision); },
    runtime,
    catalog: input => mutate(() => author.catalog(input)),
    authorReview: input => mutate(() => author.review(input)),
    reopenAuthor: input => mutate(() => author.reopen(input)),
    save(input) { return mutate(async () => {
      const declaration = await currentSource(); sameSource(declaration, input.sourceSha256);
      encodePlan(input.plan);
      return store.saveDraft({ ...input, sourceSha256: declaration.sourceSha256 });
    }); },
    review: input => mutate(() => review(input.revision)),
    preview(input, { signal } = {}) { return mutate(async () => {
      const declaration = await currentSource(); sameSource(declaration, input.sourceSha256);
      const authored = await author.compile(input.authoring ?? [], input.sourceSha256);
      return author.withSource(authored, async (sourceFile, exact) => {
        const opened = await openDuckdbSourceFile(sourceFile, { python, environment });
        try {
          if (opened.source.describe().sourceSha256 !== exact.sourceSha256) throw new WorkspaceError('SOURCE_CHANGED', 409);
          return { operatorPreview: true, sourceSha256: input.sourceSha256,
            result: await opened.source.query(input.query, input.input ?? {}, { signal }) };
        } finally { await opened.source.close(); }
      });
    }); },
    prepare(input) { return mutate(async () => {
      const existing = store.getPackage(operationId(input.operationId));
      if (existing) {
        if (existing.revision !== input.revision || existing.reviewId !== input.reviewId)
          throw new WorkspaceError('OPERATION_CONTENT_CONFLICT', 409);
        return (await inspectedPackage(existing.id)).item;
      }
      const reviewed = await review(input.revision);
      if (input.reviewId !== reviewed.reviewId) throw new WorkspaceError('REVIEW_CHANGED', 409,
        'Review the saved merchant plan before preparing this package.');
      const draft = draftFor(input.revision), id = operationId(input.operationId);
      store.beginPackage({ id, revision: input.revision, reviewId: input.reviewId, sourceSha256: reviewed.sourceSha256 });
      try {
        const plan = resolve(store.directory, 'inputs', id + '.json');
        await writeOnce(plan, json(draft.plan));
        const authored = await author.compile(draft.authoring, draft.sourceSha256);
        if (authored.declaration.sourceSha256 !== reviewed.sourceSha256) throw new WorkspaceError('REVIEW_CHANGED', 409);
        await author.withSource(authored, sourceFile => prepareDuckdbSeller({ sourceFile, planFile: plan,
          directory: packagePath(id), python, environment }));
        return (await inspectedPackage(id)).item;
      } catch (error) {
        store.failPackage(id, publicIssue(error).error); throw error;
      }
    }); },
    inspect(input) { return mutate(async () => (await inspectedPackage(input.packageId)).item); },
    async artifact({ packageId, name }) {
      if (!Object.hasOwn(ARTIFACTS, name)) throw new WorkspaceError('PACKAGE_ARTIFACT_NOT_FOUND', 404);
      const item = packageFor(packageId), selected = item.summary?.artifacts?.find(file => file.path === name);
      if (!selected || item.state !== 'READY') throw new WorkspaceError('INSPECT_PACKAGE_FIRST', 409);
      const bytes = await readArtifactFile(resolve(packagePath(packageId), name), 16777216);
      if (String(bytes.length) !== selected.bytes || sha256(bytes) !== selected.sha256)
        throw new WorkspaceError('PACKAGE_ARTIFACT_CHANGED', 409);
      return { bytes, type: ARTIFACTS[name] };
    },
    start(input) { return mutate(async () => {
      const item = packageFor(input.packageId);
      if (active) {
        if (active.packageId === item.id && active.packageSha256 === input.packageSha256) return runtime();
        throw new WorkspaceError('MERCHANT_ALREADY_RUNNING', 409, 'Stop the current merchant before starting a different package.');
      }
      const checked = await inspectedPackage(item.id);
      if (input.packageSha256 !== checked.summary.packageSha256) throw new WorkspaceError('PACKAGE_REVIEW_CHANGED', 409,
        'Inspect this retained package before starting its merchant.');
      const saved = { instanceId: 'merchant-' + randomUUID(), packageId: item.id,
        revision: item.revision, state: 'STARTING', packageSha256: checked.summary.packageSha256,
        startedAt: new Date().toISOString(), endedAt: null };
      store.setRuntime(saved);
      let session, operations;
      try {
        const bundle = checked.prepared;
        session = await startDuckdbSeller({ sourceFile: bundle.source, configFile: bundle.config,
          expectedSourceSha256: bundle.sourceSha256, expectedSourceConfig: bundle.sourceConfig,
          expectedServiceConfig: bundle.service, python, environment, nativeFactory,
          port: sellerPort, operationsPort: null, maxInFlight, drainGraceMs, availabilityDirectory });
        operations = await startSellerOperations(session.seller, { port: operationsPort, navigationOrigin });
        active = { session, operations, packageId: item.id, packageSha256: checked.summary.packageSha256 };
        store.setRuntime({ ...saved, state: 'RUNNING' });
        return runtime();
      } catch (error) {
        await session?.close().catch(() => {}); await operations?.close().catch(() => {}); active = null;
        store.setRuntime({ ...saved, state: 'FAILED', endedAt: new Date().toISOString(), error: publicIssue(error).error });
        throw error;
      }
    }); },
    stop(input) { return mutate(() => stopActive(input.instanceId)); },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = tail.then(async () => {
        try { if (active) await stopActive(store.runtime().instanceId); }
        finally { store.close(); }
      });
      return closePromise;
    },
  };
}
