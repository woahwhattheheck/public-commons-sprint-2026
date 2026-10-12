// MIT. First-deployment desk over the maintained connection and Applications engines.
import { mkdir, readdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validatePlan, planSha, PLAN_SCHEMA } from '../product.mjs';
import { connectionForPlan, connectionSummary } from '../connection.mjs';
import { normalizeBlockscoutDeployment } from '../deployment.mjs';
import { BUNDLE_SCHEMA, reviewConnection, inspectConnectionBundle,
  prepareConnectionPackage, receiveConnectionBundle } from '../connection-setup.mjs';
import { readPackage } from '../cli.mjs';
import { plain, now, digest, canonical, json, need, absolute, privateDirectory,
  makePrivate, regular, readJSON, saveJSON, operationLease, operationId, recordId }
  from '../../../distribution/runtime-workspace/storage.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.blockscout-connection-workspace.v1';
export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const TYPES = Object.freeze({
  sources: /^[a-f0-9]{64}$/, reviews: /^[a-f0-9]{64}$/,
  packages: /^[a-f0-9]{24}$/, bindings: /^[a-f0-9]{24}$/,
  'application-reviews': /^[a-f0-9]{24}$/, applications: /^[a-f0-9]{24}$/,
  'application-revisions': /^[a-f0-9]{64}$/,
  'launch-reviews': /^[a-f0-9]{24}$/, runs: /^[a-f0-9-]{36}$/,
  operations: /^[a-f0-9-]{36}$/,
});
const directories = [...Object.keys(TYPES), 'received', 'merchant-state'];
const encode = value => json(canonical(value));
const hash = value => digest(encode(value));
const errorView = error => ({ code: error.code ?? 'CONNECTION_WORKSPACE_ERROR',
  message: String(error.message ?? error).slice(0, 1200) });
const keys = (value, allowed) => need(plain(value) && Object.keys(value).every(key => allowed.includes(key)),
  'CONNECTION_WORKSPACE_INPUT_INVALID', 'The request has unknown or invalid fields.');
const text = (value, label, maximum = 3000) => {
  need(typeof value === 'string' && value.trim() === value && value.length > 0 &&
    value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value),
  'CONNECTION_WORKSPACE_TEXT_REQUIRED', label + ' is required.');
  return value;
};
const identifier = (type, id) => {
  need(TYPES[type]?.test(id ?? ''), 'CONNECTION_WORKSPACE_RECORD_INVALID');
  return id;
};
const pathFor = (root, type, id) => join(root, type, identifier(type, id) + '.json');
async function document(path, optional = false) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(path, 8 * 1024 * 1024))); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
async function retained(root, type, id, value) {
  const path = pathFor(root, type, id), previous = await document(path, true);
  if (previous) {
    const { createdAt, ...body } = previous;
    need(hash(body) === hash({ ...value, id }), 'CONNECTION_WORKSPACE_RECORD_CHANGED',
      'The retained source identity already belongs to different content.', 409);
    return previous;
  }
  const row = { ...value, id, createdAt: now() };
  await saveJSON(path, row);
  return row;
}
async function records(root, type) {
  const names = (await readdir(join(root, type))).filter(name =>
    name.endsWith('.json') && TYPES[type].test(name.slice(0, -5)));
  return Promise.all(names.map(name => document(join(root, type, name))));
}
async function ensureDirectories(root) {
  for (const name of directories) {
    const path = join(root, name);
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await privateDirectory(path);
  }
}
export async function inspectConnectionWorkspace(directory) {
  const root = await privateDirectory(absolute(directory));
  const bytes = await regular(join(root, 'connection-workspace.json'), 16384);
  const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  need(config.schema === WORKSPACE_SCHEMA && config.directory === root &&
    typeof config.workspaceId === 'string', 'CONNECTION_WORKSPACE_CONFIG_CHANGED');
  operationId(config.workspaceId);
  return { ...config, configSha256: digest(bytes) };
}
export async function createConnectionWorkspace({ directory } = {}) {
  const root = absolute(directory);
  try { await makePrivate(root); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await privateDirectory(root);
  }
  const lease = await operationLease(join(root, 'workspace.lock'));
  try {
    const current = await document(join(root, 'connection-workspace.json'), true);
    if (!current) {
      need((await readdir(root)).every(name => name === 'workspace.lock' ||
        name.startsWith('connection-workspace.json.pending-')),
      'CONNECTION_WORKSPACE_DESTINATION_EXISTS', 'Select an empty private directory or reopen the original desk.', 409);
      await saveJSON(join(root, 'connection-workspace.json'), {
        schema: WORKSPACE_SCHEMA, workspaceId: randomUUID(), directory: root, createdAt: now(),
      });
    }
    const config = await inspectConnectionWorkspace(root);
    await ensureDirectories(root);
    return config;
  } finally { await lease.close(); }
}
function parseInput(value) {
  keys(value, ['text', 'filename']);
  text(value.filename, 'Input filename', 240);
  need(typeof value.text === 'string' && Buffer.byteLength(value.text) <= MAX_INPUT_BYTES,
    'CONNECTION_WORKSPACE_SOURCE_TOO_LARGE', 'Select a complete JSON plan or connection bundle no larger than 2 MiB.');
  let input;
  try { input = JSON.parse(value.text); }
  catch { need(false, 'CONNECTION_WORKSPACE_JSON_INVALID', 'The selected file is not complete JSON.'); }
  let plan, kind, bundle = null;
  if (input?.schema === BUNDLE_SCHEMA) {
    const checked = inspectConnectionBundle(input);
    plan = checked.plan; kind = 'bundle'; bundle = input;
  } else {
    need(input?.schema === PLAN_SCHEMA, 'CONNECTION_WORKSPACE_SOURCE_TYPE_INVALID',
      'Select the original Blockscout token plan or complete exported connection bundle.');
    plan = validatePlan(input); kind = 'plan';
  }
  return { kind, plan, bundle, filename: basename(value.filename), text: value.text,
    bytes: Buffer.byteLength(value.text), sha256: digest(value.text),
    planSha256: planSha(plan), connection: connectionSummary(plan) };
}
const sourceView = row => ({ id: row.id, kind: row.kind, filename: row.filename,
  bytes: row.bytes, sha256: row.sha256, planSha256: row.planSha256,
  plan: row.plan, connection: row.connection, createdAt: row.createdAt });
const operationView = row => ({ id: row.id, action: row.action, status: row.status,
  createdAt: row.createdAt, completedAt: row.completedAt ?? null, attempts: row.attempts,
  error: row.error ?? null, result: row.result ?? null });
function page(items, { after = '', limit = 30 } = {}) {
  need(typeof after === 'string' && Number.isInteger(limit) && limit >= 1 && limit <= 100,
    'CONNECTION_WORKSPACE_PAGE_INVALID');
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const available = sorted.filter(row => row.id > after), selected = available.slice(0, limit);
  return { items: selected, nextAfter: available.length > limit ? selected.at(-1).id : null,
    total: items.length };
}
function safeSettings(value, packageDirectory) {
  keys(value, ['stateDirectory', 'facilitator', 'environmentFile', 'port', 'operationsPort',
    'deskPort', 'drainGraceMs', 'allowLocalFacilitator', 'deploymentMode']);
  normalizeBlockscoutDeployment({ mode: value.deploymentMode ?? 'paid', facilitator: value.facilitator,
    allowLocalFacilitator: value.allowLocalFacilitator ?? false });
  absolute(value.stateDirectory);
  const result = { ...value, packageDirectory };
  for (const name of ['port', 'operationsPort', 'deskPort'])
    if (value[name] === undefined) result[name] = 0;
  return result;
}
export async function openConnectionWorkspace({ directory } = {}) {
  const config = await inspectConnectionWorkspace(directory), root = config.directory;
  await ensureDirectories(root);
  const get = async (type, id) => {
    const row = await document(pathFor(root, type, id));
    need(row.id === id, 'CONNECTION_WORKSPACE_RECORD_CHANGED', undefined, 409);
    return row;
  };
  async function reviewView(row) {
    let displayReview = row.review;
    if (row.receiveOriginalBundle) {
      const source = await get('sources', row.sourceId);
      const inspected = inspectConnectionBundle(source.bundle);
      displayReview = inspected.review ?? row.review;
    }
    return { ...row, displayReview };
  }
  async function runtime(bindingId) {
    const selected = await get('bindings', bindingId);
    const original = await readJSON(join(selected.directory, 'workspace.json'));
    need(original.workspaceId === selected.workspaceId,
      'CONNECTION_WORKSPACE_APPLICATIONS_CHANGED', 'Reopen the original Applications workspace.', 409);
    const { openRuntimeWorkspace } = await import('../../../distribution/runtime-workspace/model.mjs');
    return { selected, model: await openRuntimeWorkspace({ directory: selected.directory }) };
  }
  async function withRuntime(bindingId, fn) {
    const selected = await runtime(bindingId);
    try { return await fn(selected.model, selected.selected); }
    finally { await selected.model.close(); }
  }
  async function forApplication(applicationId, fn) {
    const selected = await get('applications', recordId(applicationId));
    return withRuntime(selected.bindingId, async model => {
      const current = (await model.applicationsState({ historyLimit: 1 })).applications.find(row => row.id === applicationId);
      const pkg = await get('packages', selected.packageId);
      need(current && current.kind === 'blockscout' && current.revision === selected.revision &&
        current.settings?.packageDirectory === pkg.directory,
        'CONNECTION_WORKSPACE_APPLICATION_CHANGED',
        'The saved merchant was changed in Applications. Review its current configuration there before continuing.', 409);
      return fn(model, selected, current);
    });
  }
  async function packageAt(id) {
    const selected = await get('packages', id);
    const value = await readPackage(selected.directory, {
      expectedPlanSha256: selected.planSha256,
      expectedManifestSha256: selected.packageManifestSha256,
    });
    return { selected, value };
  }
  async function perform(action, input, requestId, operationCreatedAt) {
    if (action === 'intake') {
      const parsed = parseInput(input);
      const id = hash({ sha256: parsed.sha256, filename: parsed.filename });
      const value = await retained(root, 'sources', id, parsed);
      return { source: sourceView(value) };
    }
    if (action === 'review') {
      keys(input, ['sourceId', 'changes']);
      const source = await get('sources', input.sourceId);
      let review;
      if (source.kind === 'bundle' && input.changes === undefined) {
        inspectConnectionBundle(source.bundle); review = source.bundle.review;
      } else {
        const changes = input.changes ?? { connection: { ...connectionForPlan(source.plan), reviewedAt: operationCreatedAt } };
        review = reviewConnection(source.plan, changes, source.planSha256);
      }
      const receiveOriginalBundle = source.kind === 'bundle' && input.changes === undefined;
      const id = hash({ sourceId: source.id, reviewSha256: review.reviewSha256, receiveOriginalBundle });
      const row = await retained(root, 'reviews', id,
        { sourceId: source.id, receiveOriginalBundle, review });
      return { review: await reviewView(row), suggestedDirectory: join(root, 'received', row.id),
        suggestedStateDirectory: join(root, 'merchant-state', review.reviewSha256.slice(0, 24)) };
    }
    if (action === 'prepare') {
      keys(input, ['reviewId', 'directory']);
      const row = await get('reviews', input.reviewId), source = await get('sources', row.sourceId);
      const target = absolute(input.directory ?? join(root, 'received', row.id));
      need(target !== root && !Object.keys(TYPES).some(type => target === join(root, type)),
        'CONNECTION_WORKSPACE_DESTINATION_INVALID');
      await privateDirectory(dirname(target));
      const result = row.receiveOriginalBundle
        ? await receiveConnectionBundle(source.bundle, target, row.review.reviewSha256)
        : await prepareConnectionPackage(row.review, target);
      const prepared = await readPackage(target, { expectedPlanSha256: row.review.planSha256 });
      const bytes = await regular(join(target, 'connection-package.json'), MAX_INPUT_BYTES);
      const bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      need(inspectConnectionBundle(bundle).reviewSha256 === row.review.reviewSha256,
        'CONNECTION_WORKSPACE_PACKAGE_CHANGED', undefined, 409);
      const id = digest(target + '\n' + row.id).slice(0, 24);
      const retainedPackage = await retained(root, 'packages', id, {
        reviewId: row.id, sourceId: row.sourceId, directory: target,
        planSha256: row.review.planSha256, packageManifestSha256: prepared.packageManifestSha256,
        connection: row.review.connection, plan: row.review.plan,
        bundle: { bytes: bytes.length, sha256: digest(bytes) },
      });
      return { status: result.status, package: retainedPackage };
    }
    if (action === 'connect') {
      keys(input, ['directory']); const directory = absolute(input.directory);
      need(directory !== root, 'CONNECTION_WORKSPACE_APPLICATIONS_DIRECTORY_REQUIRED');
      await privateDirectory(directory);
      const value = await readJSON(join(directory, 'workspace.json'));
      need(value.schema === 'stellar-forge.runtime-workspace.v1' && value.directory === directory,
        'CONNECTION_WORKSPACE_APPLICATIONS_DIRECTORY_REQUIRED',
        'Select the existing Stellar Forge runtime workspace that owns your installed runtimes.');
      operationId(value.workspaceId);
      const id = digest(directory + '\n' + value.workspaceId).slice(0, 24);
      const selected = await retained(root, 'bindings', id, { directory, workspaceId: value.workspaceId });
      return { binding: selected };
    }
    if (action === 'application-review') {
      keys(input, ['bindingId', 'runtimeId', 'packageId', 'settings', 'label']);
      const { selected: pkg } = await packageAt(input.packageId);
      text(input.label, 'Merchant label', 120);
      const settings = safeSettings(input.settings, pkg.directory);
      need(settings.stateDirectory !== pkg.directory && settings.stateDirectory !== root,
        'CONNECTION_WORKSPACE_MERCHANT_STATE_INVALID', 'Choose a separate private merchant state directory.');
      const review = await withRuntime(input.bindingId, model => model.applicationsReview({
        runtimeId: input.runtimeId, kind: 'blockscout', label: input.label, settings,
      }));
      const row = await retained(root, 'application-reviews', review.id, {
        bindingId: input.bindingId, packageId: pkg.id, original: review,
      });
      return { review: row };
    }
    if (action === 'deployment-review') {
      keys(input, ['applicationId', 'expectedRevision', 'settings']);
      need(/^[a-f0-9]{64}$/.test(input.expectedRevision ?? ''), 'CONNECTION_WORKSPACE_REVISION_REQUIRED');
      keys(input.settings, ['deploymentMode', 'facilitator', 'environmentFile', 'allowLocalFacilitator']);
      need(['paid', 'challenge-only'].includes(input.settings.deploymentMode),
        'BLOCKSCOUT_DEPLOYMENT_MODE_INVALID', 'Select the mode for this reviewed deployment.');
      return forApplication(input.applicationId, async (model, selected, current) => {
        need(current.revision === input.expectedRevision, 'CONNECTION_WORKSPACE_APPLICATION_CHANGED',
          'Reopen the current merchant revision before reviewing activation.', 409);
        const { selected: pkg } = await packageAt(selected.packageId);
        const { packageDirectory, ...originalSettings } = current.settings;
        const changes = { ...input.settings }, updated = { ...originalSettings, ...changes };
        // Null clears only optional references. Credential values never enter this request.
        for (const key of ['facilitator', 'environmentFile'])
          if (changes[key] === null) delete updated[key];
        const settings = safeSettings(updated, pkg.directory);
        need(hash(settings) !== hash(current.settings), 'CONNECTION_WORKSPACE_DEPLOYMENT_UNCHANGED',
          'The selected deployment already has these settings.');
        const review = await model.applicationsReview({ runtimeId: current.runtimeId, kind: 'blockscout',
          label: current.label, settings, applicationId: current.id, expectedRevision: current.revision,
          ...(current.homeId ? { homeId: current.homeId } : {}),
          ...(current.providerId ? { providerId: current.providerId } : {}) });
        need(hash(review.settings) !== hash(current.settings), 'CONNECTION_WORKSPACE_DEPLOYMENT_UNCHANGED',
          'The selected deployment already has these normalized settings.');
        need(review.applicationId === current.id && review.previousRevision === current.revision &&
          review.settings.packageDirectory === packageDirectory &&
          review.settings.stateDirectory === current.settings.stateDirectory,
          'CONNECTION_WORKSPACE_APPLICATION_CHANGED', undefined, 409);
        const row = await retained(root, 'application-reviews', review.id, {
          bindingId: selected.bindingId, packageId: selected.packageId, original: review,
          applicationId: current.id, previousRevision: current.revision,
          deployment: { before: { mode: current.settings.deploymentMode ?? 'paid',
            facilitator: current.settings.facilitator ?? null, environmentFile: current.settings.environmentFile ?? null,
            allowLocalFacilitator: current.settings.allowLocalFacilitator ?? false },
            after: { mode: settings.deploymentMode, facilitator: settings.facilitator ?? null,
              environmentFile: settings.environmentFile ?? null, allowLocalFacilitator: settings.allowLocalFacilitator ?? false } },
        });
        return { review: row };
      });
    }
    if (action === 'application-save') {
      keys(input, ['reviewId']);
      const selected = await get('application-reviews', input.reviewId);
      await packageAt(selected.packageId);
      // A retained review selects one original application, even if the outer response is lost.
      const raw = digest(config.workspaceId + '\napplication-save\n' + selected.id);
      const originalRequestId = raw.slice(0, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16) + '-' +
        raw.slice(16, 20) + '-' + raw.slice(20, 32);
      const result = await withRuntime(selected.bindingId,
        model => model.applicationsSave({ requestId: originalRequestId, reviewId: selected.original.id,
          ...(selected.applicationId ? { applicationId: selected.applicationId } : {}) }));
      let row;
      if (selected.applicationId) {
        need(result.applicationId === selected.applicationId, 'CONNECTION_WORKSPACE_APPLICATION_CHANGED', undefined, 409);
        const previous = await get('applications', selected.applicationId);
        need(previous.bindingId === selected.bindingId && previous.packageId === selected.packageId,
          'CONNECTION_WORKSPACE_APPLICATION_CHANGED', undefined, 409);
        if (previous.revision === result.revision) {
          need(previous.reviewId === selected.id, 'CONNECTION_WORKSPACE_APPLICATION_CHANGED', undefined, 409);
          row = previous;
        } else {
          need(previous.revision === selected.previousRevision, 'CONNECTION_WORKSPACE_APPLICATION_CHANGED',
            'Reopen the same saved deployment operation before changing the merchant again.', 409);
          await retained(root, 'application-revisions', hash({ applicationId: previous.id, revision: previous.revision }),
            { applicationId: previous.id, application: previous });
          row = { ...previous, reviewId: selected.id, revision: result.revision,
            previousRevision: previous.revision, updatedAt: operationCreatedAt };
          // The original Applications save is already durable. Keep both exact desk
          // revisions before moving its pointer; a lost write resumes that same save.
          await retained(root, 'application-revisions', hash({ applicationId: row.id, revision: row.revision }),
            { applicationId: row.id, application: row });
          await saveJSON(pathFor(root, 'applications', row.id), row, true);
        }
      } else row = await retained(root, 'applications', result.applicationId, {
        bindingId: selected.bindingId, packageId: selected.packageId, reviewId: selected.id, revision: result.revision,
      });
      return { ...result, originalRequestId, application: row,
        ...(selected.applicationId ? { revisionRecords: {
          previous: hash({ applicationId: row.id, revision: selected.previousRevision }),
          current: hash({ applicationId: row.id, revision: row.revision }),
        } } : {}) };
    }
    if (action === 'reconnect') {
      keys(input, ['applicationId']);
      return forApplication(input.applicationId, model => model.applicationsConnect({ applicationId: input.applicationId }));
    }
    if (action === 'launch-review') {
      keys(input, ['applicationId']);
      const review = await forApplication(input.applicationId, async (model, app) => {
        await packageAt(app.packageId);
        return model.applicationsStartReview({ applicationId: app.id });
      });
      const row = await retained(root, 'launch-reviews', review.id,
        { applicationId: input.applicationId, original: review });
      return { review: row };
    }
    if (action === 'launch') {
      keys(input, ['reviewId']);
      const selected = await get('launch-reviews', input.reviewId);
      const result = await forApplication(selected.applicationId, model => model.applicationsStart({
        applicationId: selected.applicationId, requestId, reviewId: selected.original.id,
      }));
      await retained(root, 'runs', requestId, { applicationId: selected.applicationId, reviewId: selected.id });
      return { ...result, applicationId: selected.applicationId, operationId: requestId };
    }
    if (action === 'recover-run' || action === 'stop') {
      keys(input, ['applicationId', 'operationId']);
      const run = await get('runs', operationId(input.operationId));
      need(run.applicationId === input.applicationId, 'CONNECTION_WORKSPACE_RUN_CHANGED', undefined, 409);
      return forApplication(input.applicationId, model => action === 'stop'
        ? model.applicationsStop(input) : model.applicationsRecover(input));
    }
    need(false, 'CONNECTION_WORKSPACE_ACTION_UNKNOWN', 'Select a supported workspace action.');
  }
  async function transact(action, input, id) {
    operationId(id);
    const inputHash = hash({ action, input });
    const lease = await operationLease(join(root, 'workspace.lock'));
    try {
      const file = pathFor(root, 'operations', id), previous = await document(file, true);
      if (previous) {
        need(previous.action === action && previous.inputHash === inputHash,
          'CONNECTION_WORKSPACE_REQUEST_CHANGED', 'This operation already contains a different request.', 409);
        if (previous.status === 'COMPLETED') return { ...previous.result, requestId: id, reopened: true };
      }
      const row = previous ?? { schema: 'stellar-forge.blockscout-connection-operation.v1',
        id, action, input, inputHash, createdAt: now(), attempts: 0 };
      const pending = { ...row, status: 'RUNNING', attempts: row.attempts + 1, error: null };
      await saveJSON(file, pending, Boolean(previous));
      try {
        const result = await perform(action, input, id, pending.createdAt);
        await saveJSON(file, { ...pending, status: 'COMPLETED', completedAt: now(), result }, true);
        return { ...result, requestId: id, reopened: false };
      } catch (error) {
        try { await saveJSON(file, { ...pending, status: 'INTERRUPTED', error: errorView(error) }, true); }
        catch { /* The original RUNNING record still identifies the exact recoverable action. */ }
        throw Object.assign(error, { requestId: id });
      }
    } finally { await lease.close(); }
  }
  const model = {
    directory: root, config,
    async state() {
      const [sources, reviews, packages, bindings, apps, operations] = await Promise.all(
        ['sources', 'reviews', 'packages', 'bindings', 'applications', 'operations'].map(type => records(root, type)));
      return { ...config, sources: sources.map(sourceView),
        reviews: reviews.map(row => ({ id: row.id, sourceId: row.sourceId, createdAt: row.createdAt,
          connection: row.review.connection, planSha256: row.review.planSha256 })),
        packages, bindings, applications: apps,
        operations: operations.map(operationView).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
        operationCount: operations.length };
    },
    async history(options = {}) { return page((await records(root, 'operations')).map(operationView), options); },
    async record(type, id) { const value = await get(type, id); return type === 'reviews' ? reviewView(value) : value; },
    async call(action, payload = {}) {
      need(typeof action === 'string', 'CONNECTION_WORKSPACE_ACTION_UNKNOWN');
      if (action === 'resume') {
        keys(payload, ['operationId']);
        const row = await get('operations', operationId(payload.operationId));
        return transact(row.action, row.input, row.id);
      }
      need(plain(payload), 'CONNECTION_WORKSPACE_INPUT_INVALID');
      const { requestId, ...input } = payload;
      return transact(action, input, requestId);
    },
    async applicationsState(bindingId) {
      const owned = (await records(root, 'applications')).filter(row => row.bindingId === bindingId);
      return withRuntime(bindingId, async (original, binding) => {
        const [runtimeState, appState] = await Promise.all([original.state(), original.applicationsState({ historyLimit: 10 })]);
        return { binding, runtimes: runtimeState.runtimes.map(row => ({
          id: row.id, label: row.label, directory: row.directory, phase: row.phase,
          sourceCommit: row.sourceCommit, packageVersion: row.packageVersion,
        })), applications: appState.applications.filter(row => owned.some(item => item.id === row.id)) };
      });
    },
    async output(applicationId, id) {
      const run = await get('runs', operationId(id));
      need(run.applicationId === applicationId, 'CONNECTION_WORKSPACE_RUN_CHANGED', undefined, 409);
      return forApplication(applicationId, original => original.applicationsOutput({ applicationId, operationId: id }));
    },
    async download(packageId) {
      const { selected } = await packageAt(packageId);
      const bytes = await regular(join(selected.directory, 'connection-package.json'), MAX_INPUT_BYTES);
      need(bytes.length === selected.bundle.bytes && digest(bytes) === selected.bundle.sha256,
        'CONNECTION_WORKSPACE_BUNDLE_CHANGED', undefined, 409);
      inspectConnectionBundle(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      return { bytes, sha256: digest(bytes), filename: 'blockscout-connection-' + selected.reviewId + '.json' };
    },
    async close() {},
  };
  return model;
}
