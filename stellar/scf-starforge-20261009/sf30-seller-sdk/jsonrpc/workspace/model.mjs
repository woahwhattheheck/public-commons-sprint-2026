// MIT. Saved RPC merchant authoring over original SF30/SF61/SF88 implementations.
import { mkdir, lstat, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { prepareProduct, credentialReferences, METHODS, LIMITS, NETWORKS, plain } from '../config.mjs';
import { exampleRequest, admitRequest } from '../stellar.mjs';
import { createStellarRpcApplication } from '../application.mjs';
import { preparePackage, prepareBuyerReview, startRpcCommand } from '../cli.mjs';
import { openRpcWorkspaceStore, WorkspaceError, sha256, json, operationId, revisionNumber } from './store.mjs';

export { WorkspaceError };
const TEXT_LIMIT = 131072;
const sourceName = hash => hash + '.json';
const codeOf = cause => typeof cause?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(cause.code)
  ? cause.code : 'RPC_WORKSPACE_OPERATION_FAILED';
export function publicIssue(cause) {
  return { status: cause instanceof WorkspaceError ? cause.status : 422, code: codeOf(cause),
    message: cause instanceof WorkspaceError ? cause.message : 'Review the saved public plan and configured local runtime.' };
}
function decodePlan(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > TEXT_LIMIT)
    throw new WorkspaceError('PLAN_TEXT_TOO_LARGE');
  let plan;
  try { plan = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new WorkspaceError('PLAN_JSON_REQUIRED'); }
  if (!plain(plan)) throw new WorkspaceError('PLAN_OBJECT_REQUIRED');
  return plan;
}
async function privateFile(path, limit = 4194304) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
    throw new WorkspaceError('RETAINED_FILE_INVALID');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new WorkspaceError('RETAINED_FILE_TOO_LARGE');
  return bytes;
}
async function putExact(path, bytes) {
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (cause) {
    if (cause.code !== 'EEXIST') throw cause;
    if (!(await privateFile(path)).equals(Buffer.from(bytes)))
      throw new WorkspaceError('RETAINED_FILE_CONTENT_CHANGED', 409);
  }
}
async function listFiles(directory, prefix = '') {
  const files = [];
  for (const row of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? prefix + '/' + row.name : row.name;
    if (row.isDirectory()) files.push(...await listFiles(directory, name));
    else if (row.isFile()) {
      const bytes = await privateFile(join(directory, name));
      files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
    } else throw new WorkspaceError('PREPARED_PACKAGE_FILE_INVALID');
    if (files.length > 100) throw new WorkspaceError('PREPARED_PACKAGE_TOO_LARGE');
  }
  return files;
}
function compiledReview(draft) {
  let prepared;
  try { prepared = prepareProduct(draft.plan); }
  catch (cause) {
    return { valid: false, revision: draft.revision, planSha256: draft.planSha256,
      error: { code: 'RPC_PLAN_INCOMPLETE', message: String(cause.message).slice(0,1000) } };
  }
  const reviewId = sha256(json({ revision: draft.revision, sourceSha256: draft.sourceSha256,
    planSha256: draft.planSha256, service: prepared.service, spec: prepared.spec }));
  return { valid: true, revision: draft.revision, planSha256: draft.planSha256,
    sourceSha256: draft.sourceSha256, reviewId, dataNetwork: prepared.plan.dataNetwork,
    payment: prepared.plan.payment, limits: prepared.plan.limits,
    requiredEnvironment: credentialReferences(prepared.plan),
    routes: prepared.imported.offers.map((row, index) => ({
      method: prepared.plan.operations[index].method, httpMethod: row.method, path: row.path,
      url: row.seller.resource.url, accepts: row.seller.accepts,
      request: prepared.spec.paths[row.path].post.requestBody,
      example: exampleRequest(prepared.plan.operations[index].method),
    })),
    crossNetwork: prepared.plan.dataNetwork !== prepared.plan.payment.network,
  };
}
function changes(before, after, prefix = '') {
  if (isDeepStrictEqual(before, after)) return [];
  if (plain(before) && plain(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort().flatMap(key => changes(before[key], after[key], prefix ? prefix + '.' + key : key));
  return [{ field: prefix, before: before ?? null, after: after ?? null }];
}

/** Host options and environment are fixed at launch; browser drafts contain public declarations. */
export async function createRpcWorkspace({ directory, create = false, planFile,
  env = process.env, runtimeOptions = null, allowLoopbackUpstream = false } = {}) {
  if (typeof directory !== 'string' || !directory || resolve(directory) === '/')
    throw new WorkspaceError('PRIVATE_WORKSPACE_DIRECTORY_REQUIRED');
  const root = resolve(directory);
  const existed = await lstat(join(root, 'workspace.sqlite')).then(() => true, cause => {
    if (cause.code === 'ENOENT') return false; throw cause;
  });
  if (!existed && !create) throw new WorkspaceError('WORKSPACE_CREATE_REQUIRED', 404);
  let initial;
  if (!existed) {
    const bytes = planFile ? await privateFile(resolve(planFile), TEXT_LIMIT) :
      await readFile(new URL('../example-plan.json', import.meta.url));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    initial = { bytes, plan: decodePlan(text), hash: sha256(bytes) };
  }
  const store = await openRpcWorkspaceStore(root);
  let merchant = null, queue = Promise.resolve(), queued = 0, closing = false, closePromise;
  try {
    for (const name of ['actions', 'availability', 'history']) {
      const path = join(root, name);
      await mkdir(path, { recursive: true, mode: 0o700 });
      if (await realpath(path) !== path || !(await lstat(path)).isDirectory())
        throw new WorkspaceError('PRIVATE_WORKSPACE_DIRECTORY_REQUIRED');
    }
    if (store.latest() && planFile !== undefined && existed)
      throw new WorkspaceError('USE_IMPORT_FOR_EXISTING_WORKSPACE', 409);
    if (!store.latest()) {
      if (!initial) {
        const bytes = await privateFile(join(root, 'source-plan.json'), TEXT_LIMIT).catch(async cause => {
          if (cause.code !== 'ENOENT') throw cause;
          if (!create) throw new WorkspaceError('WORKSPACE_INITIAL_PLAN_MISSING');
          return planFile ? privateFile(resolve(planFile), TEXT_LIMIT) : readFile(new URL('../example-plan.json', import.meta.url));
        });
        initial = { bytes, plan: decodePlan(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), hash: sha256(bytes) };
      }
      await putExact(join(root, 'source-plan.json'), initial.bytes);
      await putExact(join(root, 'inputs', sourceName(initial.hash)), initial.bytes);
      store.saveDraft({ expectedRevision: 0, operationId: 'initial-' + randomUUID(),
        sourceSha256: initial.hash, plan: initial.plan });
    }
  } catch (cause) { store.close(); throw cause; }

  function enqueue(fn) {
    if (closing) return Promise.reject(new WorkspaceError('WORKSPACE_CLOSING', 503));
    if (queued >= 8) return Promise.reject(new WorkspaceError('WORKSPACE_BUSY', 429));
    queued++;
    const task = queue.then(fn);
    queue = task.catch(() => {}).finally(() => { queued--; });
    return task;
  }
  function draft(revision) {
    revisionNumber(revision);
    const value = store.getDraft(revision);
    if (!value) throw new WorkspaceError('REVISION_NOT_FOUND', 404);
    return value;
  }
  function selected(input) {
    const saved = draft(input.revision), review = compiledReview(saved);
    if (!review.valid) throw new WorkspaceError('RPC_PLAN_INCOMPLETE', 422, review.error.message);
    if (typeof input.reviewId !== 'string' || input.reviewId !== review.reviewId)
      throw new WorkspaceError('RPC_REVIEW_CHANGED', 409, 'Review this saved version before continuing.');
    return { saved, review };
  }
  async function retainedPackage(packageId) {
    const record = store.getPackage(packageId);
    if (!record || record.state !== 'READY') throw new WorkspaceError('PREPARED_PACKAGE_NOT_READY', 409);
    const folder = join(root, 'packages', record.id), expected = record.summary.files;
    const actual = await listFiles(folder);
    if (!isDeepStrictEqual(actual, expected)) throw new WorkspaceError('PREPARED_PACKAGE_CHANGED', 409);
    return { record, folder };
  }
  function runtime() {
    const saved = store.runtime();
    return { ...saved, launchMode: runtimeOptions?.facilitator ? 'NATIVE' : runtimeOptions?.['challenge-only'] ? 'CHALLENGE' : 'OFFLINE',
      ...(merchant ? { seller: merchant.url, docs: merchant.url + '/_seller/docs',
        operations: merchant.operations.url, availability: merchant.operations.availabilityControlUrl,
        snapshot: merchant.application.snapshot() } : {}) };
  }
  async function action(input, kind, request, fn) {
    const started = store.beginAction({ id: input.operationId, kind, revision: input.revision, request });
    if (started.existing) return started.action;
    try { return store.finishAction(input.operationId, await fn()); }
    catch (cause) { store.finishAction(input.operationId, null, codeOf(cause)); throw cause; }
  }
  const model = {
    directory: root, draft, runtime,
    state() {
      const latest = store.latest();
      return { workspaceId: store.workspaceId, directory: root, latest, drafts: store.drafts(),
        packages: store.packages(), actions: store.actions(), runtime: runtime(),
        review: compiledReview(latest), methods: METHODS, limits: LIMITS, networks: Object.keys(NETWORKS),
        runtimeConfigured: runtimeOptions !== null, closing, queued };
    },
    review({ revision }) { return compiledReview(draft(revision)); },
    compare({ before, after }) {
      const first = draft(before), second = draft(after);
      const oldMethods = new Map((Array.isArray(first.plan.operations) ? first.plan.operations : []).filter(plain).map(row => [row.method, row]));
      const newMethods = new Map((Array.isArray(second.plan.operations) ? second.plan.operations : []).filter(plain).map(row => [row.method, row]));
      return { before: compiledReview(first), after: compiledReview(second),
        changes: changes(first.plan, second.plan),
        products: [...new Set([...oldMethods.keys(), ...newMethods.keys()])].map(method => ({ method,
          state: !oldMethods.has(method) ? 'ADDED' : !newMethods.has(method) ? 'REMOVED' :
            isDeepStrictEqual(oldMethods.get(method), newMethods.get(method)) && isDeepStrictEqual(first.plan.payment,second.plan.payment) ? 'UNCHANGED' : 'CHANGED',
          before: oldMethods.get(method) ?? null, after: newMethods.get(method) ?? null })),
      };
    },
    save(input) {
      return enqueue(() => {
        const plan = decodePlan(json(input.plan)), source = draft(input.sourceRevision ?? input.expectedRevision);
        return store.saveDraft({ ...input, plan, sourceSha256: source.sourceSha256 });
      });
    },
    importPlan(input) {
      return enqueue(async () => {
        const plan = decodePlan(input.text), hash = sha256(input.text);
        await putExact(join(root, 'inputs', sourceName(hash)), input.text);
        return store.saveDraft({ ...input, plan, sourceSha256: hash });
      });
    },
    prepare(input) {
      return enqueue(async () => {
        const { saved, review } = selected(input), id = operationId(input.operationId);
        const started = store.beginPackage({ id, revision: saved.revision, reviewId: review.reviewId,
          sourceSha256: saved.sourceSha256 });
        if (started.existing) {
          if (started.package.state === 'READY') await retainedPackage(id);
          return started.package;
        }
        try {
          const prepared = await preparePackage(saved.plan, join(root, 'packages', id));
          return store.completePackage(id, { ...prepared, planSha256: saved.planSha256,
            files: await listFiles(prepared.folder), review });
        } catch (cause) { store.failPackage(id, codeOf(cause)); throw cause; }
      });
    },
    diagnose(input) {
      return enqueue(async () => {
        const { saved, review } = selected(input);
        return action(input, 'diagnose', { reviewId: review.reviewId }, async () => {
          const app = createStellarRpcApplication(saved.plan, { env, allowLoopbackUpstream });
          try { return { ...(await app.diagnose()), reviewId: review.reviewId, planSha256: saved.planSha256 }; }
          finally { await app.close(); }
        });
      });
    },
    buyer(input) {
      return enqueue(async () => {
        const { saved, review } = selected(input), { record, folder } = await retainedPackage(input.packageId);
        if (record.revision !== saved.revision) throw new WorkspaceError('PACKAGE_REVISION_MISMATCH', 409);
        const bodyText = input.bodyText, body = decodePlan(bodyText), method = input.method;
        if (!saved.plan.operations.some(row => row.method === method) ||
            admitRequest(method, { method: 'POST', body, url: new URL(saved.plan.publicOrigin + '/stellar/' + method), query: {} }, review.limits) !== true)
          throw new WorkspaceError('RPC_REQUEST_INVALID', 422, 'Use the selected method’s exact parameters.');
        return action(input, 'buyer', { reviewId: review.reviewId, packageId: record.id,
          method, intentId: input.intentId, bodyText }, async () => {
          const path = join(root, 'actions', operationId(input.operationId));
          await mkdir(path, { mode: 0o700 });
          await putExact(join(path, 'request.json'), bodyText);
          const result = await prepareBuyerReview({ package: folder, method,
            'body-file': join(path, 'request.json'), 'intent-id': input.intentId, out: join(path, 'buyer-review.json') });
          return { ...result, files: await listFiles(path) };
        });
      });
    },
    start(input) {
      return enqueue(async () => {
        if (!runtimeOptions) throw new WorkspaceError('RUNTIME_NOT_CONFIGURED', 409,
          'Reopen with --challenge-only or the merchant’s selected --facilitator.');
        const { saved, review } = selected(input), { record, folder } = await retainedPackage(input.packageId);
        if (record.revision !== saved.revision) throw new WorkspaceError('PACKAGE_REVISION_MISMATCH', 409);
        const prior = store.action(input.operationId);
        if (merchant && (!prior || prior.result?.instanceId !== store.runtime().instanceId))
          throw new WorkspaceError('MERCHANT_ALREADY_RUNNING', 409, 'Drain the current merchant before starting another version.');
        return action(input, 'start', { reviewId: review.reviewId, packageId: record.id }, async () => {
          const instanceId = randomUUID(), startedAt = new Date().toISOString();
          store.setRuntime({ state: 'STARTING', instanceId, packageId: record.id, revision: record.revision, startedAt });
          try {
            const options = { ...runtimeOptions,
              'availability-dir': join(root, 'availability'), 'history-dir': join(root, 'history'),
              ...(runtimeOptions.facilitator ? { state: join(root, 'outbox') } : {}),
              ...(allowLoopbackUpstream ? { 'allow-loopback-upstream': true } : {}) };
            // Original CLI owns native factory/outbox, preflight, listeners, signals and drain.
            const packagePlan = JSON.parse((await privateFile(join(folder, 'plan.json'), TEXT_LIMIT)).toString('utf8'));
            merchant = await startRpcCommand(packagePlan, options, { env,
              stdout: { write() {} }, stderr: { write() {} } });
            return store.setRuntime({ state: 'RUNNING', instanceId, packageId: record.id,
              revision: record.revision, startedAt, mode: merchant.mode });
          } catch (cause) {
            store.setRuntime({ state: 'FAILED', instanceId, packageId: record.id, revision: record.revision,
              startedAt, endedAt: new Date().toISOString(), error: codeOf(cause) });
            throw cause;
          }
        });
      });
    },
    stop({ instanceId }) {
      return enqueue(async () => {
        const current = store.runtime();
        if (typeof instanceId !== 'string' || current.instanceId !== instanceId)
          throw new WorkspaceError('MERCHANT_INSTANCE_CHANGED', 409);
        if (!merchant) return runtime();
        store.setRuntime({ ...current, state: 'STOPPING' });
        try { await merchant.close(); merchant = null;
          store.setRuntime({ ...current, state: 'STOPPED', endedAt: new Date().toISOString() }); }
        catch (cause) { store.setRuntime({ ...current, state: 'FAILED', endedAt: new Date().toISOString(), error: codeOf(cause) }); throw cause; }
        return runtime();
      });
    },
    action(id) {
      const value = store.action(id);
      if (!value) throw new WorkspaceError('ACTION_NOT_FOUND', 404);
      return value;
    },
    actions(options) { return store.actions(options); },
    async artifact({ kind, id, name }) {
      if (kind === 'plan' || kind === 'source' || kind === 'review') {
        const saved = draft(Number(id));
        if (kind === 'source') {
          const bytes = await privateFile(join(root,'inputs',sourceName(saved.sourceSha256)),TEXT_LIMIT);
          if (sha256(bytes) !== saved.sourceSha256) throw new WorkspaceError('RETAINED_FILE_CONTENT_CHANGED', 409);
          return { bytes, name:'source-plan.json' };
        }
        return { bytes: Buffer.from(json(kind === 'plan' ? saved.plan : compiledReview(saved))), name: kind + '-r' + saved.revision + '.json' };
      }
      if (kind === 'action') return { bytes: Buffer.from(json(model.action(id))), name: 'rpc-action-' + id + '.json' };
      let folder, files;
      if (kind === 'package') {
        const retained = await retainedPackage(id); folder = retained.folder; files = retained.record.summary.files;
      } else if (kind === 'buyer') {
        const record = model.action(id);
        if (record.kind !== 'buyer' || record.state !== 'COMPLETE') throw new WorkspaceError('BUYER_REVIEW_NOT_READY', 409);
        folder = join(root, 'actions', record.id); files = record.result.files;
      } else throw new WorkspaceError('ARTIFACT_NOT_FOUND', 404);
      const retained = files.find(row => row.name === name);
      if (!retained) throw new WorkspaceError('ARTIFACT_NOT_FOUND', 404);
      const bytes = await privateFile(join(folder, retained.name));
      if (bytes.length !== retained.bytes || sha256(bytes) !== retained.sha256)
        throw new WorkspaceError('RETAINED_FILE_CONTENT_CHANGED', 409);
      return { bytes, name: retained.name.replaceAll('/', '-') };
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      return closePromise = (async () => {
        await queue;
        try {
          if (merchant) {
            const current = store.runtime();
            store.setRuntime({ ...current, state: 'STOPPING' });
            await merchant.close(); merchant = null;
            store.setRuntime({ ...current, state: 'STOPPED', endedAt: new Date().toISOString() });
          }
        } finally { store.close(); }
      })();
    },
  };
  return model;
}
