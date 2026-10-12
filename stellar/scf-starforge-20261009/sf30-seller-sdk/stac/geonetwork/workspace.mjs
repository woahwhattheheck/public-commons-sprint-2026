// MIT. Original STAC delivery custody and durable GeoNetwork operator work.
import { randomUUID } from 'node:crypto';
import { readdir, lstat } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, exists }
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { withPrivateLock } from '../../routescan/quota.mjs';
import { StacDelivery } from '../customer.mjs';
import { canonicalJson } from '../provider.mjs';
import { CATALOGUE_SCHEMA, copy, hash, requireValue, identifier, isObject,
  buildCollectionSource, validateSource, normalizeConnection, normalizePlan, validatePlan } from './model.mjs';

const stamp = () => new Date().toISOString();
const STATE_LIMIT = 128 * 1024 * 1024;
const HANDOVER_SCHEMA = 'starforge.stac-geonetwork-handover.v1';
const MANIFEST = 'catalogue-handover.json';
const cleanError = error => ({
  code: /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'CATALOGUE_OPERATION_FAILED',
  message: String(error?.message ?? error).slice(0, 2000),
  status: Number.isInteger(error?.status) ? error.status : null,
  uncertain: error?.uncertain === true, at: stamp()
});
function relative(value) {
  requireValue(typeof value === 'string' && value.length && value.length <= 2048 &&
    !value.includes('\\') && !value.includes('\0') && !isAbsolute(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'), 'CATALOGUE_RELATIVE_PATH_INVALID');
  return value;
}
async function retained(path, bytes) {
  await privateDirectory(dirname(path));
  if (await exists(path)) {
    const actual = await readBytes(path, bytes.length);
    requireValue(hash(actual) === hash(bytes) && actual.length === bytes.length, 'CATALOGUE_RETAINED_FILE_CHANGED');
  } else {
    try { await writeBytes(path, bytes, { exclusive: true }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const actual = await readBytes(path, bytes.length);
      requireValue(actual.length === bytes.length && hash(actual) === hash(bytes), 'CATALOGUE_RETAINED_FILE_CHANGED');
    }
  }
  return { bytes: bytes.length, sha256: hash(bytes) };
}
async function filesUnder(directory, prefix = '') {
  const out = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    relative(name);
    requireValue(!entry.isSymbolicLink(), 'CATALOGUE_HANDOVER_SYMLINK');
    if (entry.isDirectory()) out.push(...await filesUnder(join(directory, entry.name), name));
    else { requireValue(entry.isFile(), 'CATALOGUE_HANDOVER_FILE_REQUIRED'); out.push(name); }
  }
  return out;
}
function validateState(state) {
  requireValue(state?.schema === CATALOGUE_SCHEMA && typeof state.id === 'string' &&
    Number.isSafeInteger(state.revision) && state.revision >= 0 &&
    Array.isArray(state.sources) && Array.isArray(state.plans) && isObject(state.operations) &&
    Array.isArray(state.everOwnedUuids) && Array.isArray(state.archives), 'CATALOGUE_WORKSPACE_INVALID');
  identifier(state.id);
  for (const item of state.sources) {
    requireValue(typeof item.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sourceSha256),
      'CATALOGUE_WORKSPACE_SOURCE_INVALID');
    relative(item.path);
  }
  return state;
}

/** The original received edition remains the only source of collection metadata. */
export async function openCatalogueWorkspace({ directory, stacWorkspace = null, create = true,
  title = 'Catalogue receiving' } = {}) {
  directory = await privateDirectory(resolve(directory), { create });
  for (const name of ['locks', 'sources', 'operations', 'archives'])
    await privateDirectory(join(directory, name), { create });
  const statePath = join(directory, 'state.json');
  const stacIdentity = stacWorkspace ? (await stacWorkspace.getState()).id : null;
  if (!await exists(statePath)) {
    requireValue(create, 'CATALOGUE_WORKSPACE_NOT_FOUND');
    const initial = { schema: CATALOGUE_SCHEMA, id: 'catalogue-' + randomUUID().replaceAll('-', '').slice(0, 24),
      revision: 0, title, stacWorkspaceId: stacIdentity, createdAt: stamp(), updatedAt: stamp(),
      connection: null, connectionRevision: 0, capabilities: null, sources: [], plans: [],
      harvester: null, lastVerifiedSourceSha256: null, everOwnedUuids: [], records: [],
      operations: {}, archives: [], imports: [] };
    try { await writeJson(statePath, initial, { exclusive: true }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  let queue = Promise.resolve(), closed = false;
  const read = async () => validateState(await readJson(statePath, STATE_LIMIT));
  const opening = await read();
  requireValue(!stacIdentity || !opening.stacWorkspaceId || opening.stacWorkspaceId === stacIdentity,
    'CATALOGUE_ORIGINAL_STAC_WORKSPACE_CHANGED');
  async function save(state) {
    validateState(state); state.revision++; state.updatedAt = stamp();
    await writeJson(statePath, state); return state;
  }
  function exclusive(work) {
    const next = queue.then(async () => {
      requireValue(!closed, 'CATALOGUE_WORKSPACE_CLOSED');
      return withPrivateLock(join(directory, 'locks'), 'workspace.lock', async () => work(await read()));
    });
    queue = next.catch(() => {}); return next;
  }
  async function sourceFor(state, sha256) {
    const entry = state.sources.find(value => value.sourceSha256 === sha256);
    requireValue(entry, 'CATALOGUE_SOURCE_NOT_FOUND');
    const source = validateSource(await readJson(join(directory, relative(entry.path)), STATE_LIMIT));
    requireValue(source.sha256 === sha256, 'CATALOGUE_SOURCE_CHANGED');
    return { entry, source };
  }
  function currentPlan(state, sha256) {
    const plan = state.plans.find(value => value.sha256 === sha256);
    requireValue(plan, 'CATALOGUE_PLAN_NOT_FOUND'); return validatePlan(plan);
  }
  /** Persist dispatch BEFORE a native mutation and reuse its original step after interruption. */
  async function operation({ operationId, kind, input }, work) {
    identifier(operationId, 'operation ID'); identifier(kind, 'operation kind');
    requireValue(isObject(input), 'CATALOGUE_OPERATION_INPUT_REQUIRED');
    const inputSha256 = hash(input);
    return exclusive(async state => {
      let op = state.operations[operationId];
      if (op) {
        requireValue(op.kind === kind && op.inputSha256 === inputSha256, 'CATALOGUE_OPERATION_INPUT_CHANGED');
        if (op.status === 'COMPLETE') return copy(op.result);
      } else {
        op = state.operations[operationId] = { id: operationId, kind, input: copy(input), inputSha256,
          status: 'PREPARED', startedAt: stamp(), updatedAt: stamp(), steps: {}, result: null, error: null };
        await save(state);
      }
      const operationDirectory = join(directory, 'operations', hash(operationId));
      await privateDirectory(operationDirectory);
      let pendingResult = false;
      const context = {
        state, op, directory: operationDirectory, workspaceDirectory: directory,
        async checkpoint(patch = {}) {
          Object.assign(op, copy(patch), { updatedAt: stamp() }); await save(state);
        },
        async retain(name, value, { binary = false } = {}) {
          name = relative(name);
          const bytes = binary ? Buffer.from(value) : Buffer.from(canonicalJson(value) + '\n');
          const record = await retained(join(operationDirectory, name), bytes);
          return { path: 'operations/' + hash(operationId) + '/' + name, ...record };
        },
        async source(sha256) { return sourceFor(state, sha256); },
        async pending(status, result) {
          requireValue(['RUNNING', 'RECONCILE', 'PARTIAL'].includes(status), 'CATALOGUE_PENDING_STATUS_INVALID');
          pendingResult = true; await context.checkpoint({ status, result: copy(result) }); return result;
        },
        plan(sha256) { return currentPlan(state, sha256); },
        async step(name, invoke, { mutation = false, reconcile = null } = {}) {
          identifier(name, 'operation step');
          let step = op.steps[name];
          if (step?.status === 'COMPLETE') return copy(step.result);
          if (step && mutation && ['DISPATCHING', 'UNKNOWN', 'ACCEPTED'].includes(step.status)) {
            requireValue(typeof reconcile === 'function', 'CATALOGUE_RECONCILIATION_REQUIRED');
            const result = await reconcile(copy(step));
            if (!result || result.resolved !== true) {
              step.status = 'UNKNOWN'; step.lastReconciledAt = stamp();
              step.reconciliation = copy(result ?? { resolved: false });
              await context.checkpoint({ status: 'RECONCILE' });
              throw Object.assign(new Error('Reopen this original native operation and reconcile its saved result.'),
                { code: 'CATALOGUE_NATIVE_OUTCOME_PENDING', uncertain: true });
            }
            step.status = 'COMPLETE'; step.result = copy(result.value); step.completedAt = stamp();
            await context.checkpoint(); return copy(step.result);
          }
          step = op.steps[name] = { name, mutation, status: mutation ? 'DISPATCHING' : 'READING',
            startedAt: stamp(), result: null, error: null };
          await context.checkpoint({ status: 'RUNNING', error: null });
          try {
            const result = await invoke();
            step.status = 'COMPLETE'; step.result = copy(result); step.completedAt = stamp();
            await context.checkpoint(); return copy(step.result);
          } catch (error) {
            step.status = mutation && error?.uncertain !== false ? 'UNKNOWN' : 'FAILED';
            step.error = cleanError(error); step.failedAt = stamp();
            await context.checkpoint({ status: step.status === 'UNKNOWN' ? 'RECONCILE' : 'FAILED', error: step.error });
            throw error;
          }
        }
      };
      try {
        const result = await work(context);
        if (!pendingResult) await context.checkpoint({ status: 'COMPLETE', result: copy(result), completedAt: stamp(), error: null });
        return copy(result);
      } catch (error) {
        await context.checkpoint({ status: error?.uncertain === true || op.status === 'RECONCILE' ? 'RECONCILE' : 'FAILED',
          error: cleanError(error) });
        throw error;
      }
    });
  }
  async function configure({ connection, expectedRevision, operationId } = {}) {
    const normalized = normalizeConnection(connection);
    return operation({ operationId, kind: 'CONFIGURE', input: { connection: normalized, expectedRevision: expectedRevision ?? null } },
      async context => {
        const state = context.state;
        if (expectedRevision !== undefined) requireValue(state.revision === expectedRevision + 1 ||
          context.op.steps.saved?.status === 'COMPLETE', 'CATALOGUE_REVISION_CHANGED');
        const pending = Object.values(state.operations).filter(value =>
          value.id !== operationId && ['RUNNING', 'RECONCILE'].includes(value.status));
        requireValue(!pending.length, 'CATALOGUE_ORIGINAL_OPERATION_ACTIVE');
        if (state.harvester) requireValue(hash(normalized) === hash(state.connection), 'CATALOGUE_INSTALLATION_ALREADY_BOUND',
          'This workspace retains an existing native harvester. Use its saved installation for continued work.');
        state.connection = normalized; state.connectionRevision++;
        state.capabilities = null;
        return { connection: copy(normalized), connectionRevision: state.connectionRevision };
      });
  }
  async function receive({ deliveryDirectory, collectionIds, sourceUrls = {}, sourceTitle, operationId } = {}) {
    deliveryDirectory = resolve(deliveryDirectory);
    return operation({ operationId, kind: 'RECEIVE_SOURCE',
      input: { deliveryDirectory, collectionIds, sourceUrls, sourceTitle: sourceTitle ?? null } }, async context => {
      const delivery = await StacDelivery.open(deliveryDirectory);
      const source = buildCollectionSource({ delivery, collectionIds, sourceUrls,
        title: sourceTitle ?? context.state.title });
      const path = 'sources/' + source.sha256 + '.json';
      await retained(join(directory, path), Buffer.from(canonicalJson(source) + '\n'));
      await retained(join(directory, 'sources', source.documentSha256 + '.collections.json'),
        Buffer.from(canonicalJson(source.document) + '\n'));
      let entry = context.state.sources.find(item => item.sourceSha256 === source.sha256);
      if (!entry) {
        entry = { sourceSha256: source.sha256, sourceId: source.id, documentSha256: source.documentSha256,
          title: source.title, collectionIds: copy(source.collectionIds), sourceIdentity: copy(source.sourceIdentity),
          path, deliveryDirectory, receivedAt: stamp(), issues: copy(source.issues) };
        context.state.sources.push(entry);
      } else requireValue(hash(entry.sourceIdentity) === hash(source.sourceIdentity), 'CATALOGUE_SOURCE_IDENTITY_CHANGED');
      return { source: copy(entry), collectionCount: source.collections.length, issues: copy(source.issues) };
    });
  }
  async function review({ sourceSha256, plan: input, operationId } = {}) {
    return operation({ operationId, kind: 'REVIEW_PLAN', input: { sourceSha256, plan: input } }, async context => {
      const { source } = await context.source(sourceSha256);
      const previous = context.state.lastVerifiedSourceSha256 ?
        (await context.source(context.state.lastVerifiedSourceSha256)).source : null;
      const plan = normalizePlan(input, { workspaceId: context.state.id, source, previousSource: previous });
      if (!context.state.plans.some(value => value.sha256 === plan.sha256))
        context.state.plans.push(plan);
      return copy(plan);
    });
  }
  async function getSource(sha256) {
    const { source } = await sourceFor(await read(), sha256); return copy(source);
  }
  async function sourceDocument(sha256) {
    const state = await read();
    requireValue(state.sources.some(value => value.documentSha256 === sha256), 'CATALOGUE_SOURCE_NOT_FOUND');
    const path = join(directory, 'sources', sha256 + '.collections.json');
    const bytes = await readBytes(path, STATE_LIMIT);
    requireValue(hash(JSON.parse(bytes.toString('utf8'))) === sha256, 'CATALOGUE_SOURCE_CHANGED');
    return { bytes, filename: sha256 + '.collections.json', mime: 'application/json' };
  }
  async function getSavedFile(path) {
    path = relative(path);
    requireValue(['sources/', 'operations/', 'archives/'].some(prefix => path.startsWith(prefix)),
      'CATALOGUE_SAVED_FILE_INVALID');
    const bytes = await readBytes(join(directory, path), 2147483647);
    return { bytes, filename: path.split('/').at(-1), mime: path.endsWith('.zip') ?
      'application/zip' : path.endsWith('.xml') ? 'application/xml' : 'application/json' };
  }
  async function exportHandover({ outputDirectory, operationId } = {}) {
    outputDirectory = resolve(outputDirectory);
    requireValue(outputDirectory !== directory && !outputDirectory.startsWith(directory + '/'),
      'CATALOGUE_SEPARATE_HANDOVER_REQUIRED');
    return operation({ operationId, kind: 'EXPORT_HANDOVER', input: { outputDirectory } }, async context => {
      const manifestPath = join(outputDirectory, MANIFEST);
      if (await exists(manifestPath)) {
        const opened = await openCatalogueHandover(outputDirectory);
        requireValue(opened.manifest.operationId === operationId && opened.manifest.workspaceId === context.state.id,
          'CATALOGUE_HANDOVER_OPERATION_CHANGED');
        return { directory: outputDirectory, manifest: opened.manifest };
      }
      await privateDirectory(outputDirectory);
      let snapshot = context.op.steps.snapshot?.result;
      if (!snapshot) {
        snapshot = copy(context.state);
        // The current export's result will contain this manifest; omit only its in-flight self reference.
        delete snapshot.operations[operationId];
        context.op.steps.snapshot = { name: 'snapshot', mutation: false, status: 'COMPLETE',
          result: snapshot, completedAt: stamp() };
        await context.checkpoint();
      }
      const packagedState = copy(snapshot), copied = new Map();
      for (const entry of packagedState.sources) {
        const source = (await sourceFor(snapshot, entry.sourceSha256)).source;
        const key = hash(source.sourceIdentity);
        const destination = 'deliveries/' + key;
        if (!copied.has(key)) {
          const actual = await StacDelivery.open(entry.deliveryDirectory);
          requireValue(['bundleSha256', 'selectionSha256', 'editionDigest', 'nativeBindingSha256'].every(field =>
            actual.manifest[field] === source.sourceIdentity[field]), 'CATALOGUE_SOURCE_DELIVERY_CHANGED');
          await actual.copyTo(join(outputDirectory, destination));
          copied.set(key, { path: destination, sourceIdentity: copy(source.sourceIdentity) });
        }
        entry.deliveryDirectory = destination;
      }
      for (const name of ['sources', 'operations', 'archives']) {
        for (const path of await filesUnder(join(directory, name))) {
          const originalPath = name + '/' + path;
          // This export's own retained state is already represented by the stable snapshot.
          if (originalPath.startsWith('operations/' + hash(operationId) + '/')) continue;
          const bytes = await readBytes(join(directory, originalPath), 2147483647);
          await retained(join(outputDirectory, originalPath), bytes);
        }
      }
      packagedState.imports = [...(packagedState.imports ?? [])];
      await retained(join(outputDirectory, 'state.json'), Buffer.from(canonicalJson(packagedState) + '\n'));
      const files = [];
      for (const path of await filesUnder(outputDirectory)) {
        requireValue(path !== MANIFEST, 'CATALOGUE_HANDOVER_MANIFEST_ALREADY_PRESENT');
        const bytes = await readBytes(join(outputDirectory, path), 2147483647);
        files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
      }
      const manifest = { schema: HANDOVER_SCHEMA, operationId, workspaceId: snapshot.id,
        workspaceRevision: snapshot.revision, createdAt: context.op.startedAt,
        files, bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        sourceDeliveries: [...copied].map(([identitySha256, record]) => ({ identitySha256, ...record })) };
      manifest.sha256 = hash(manifest);
      await retained(manifestPath, Buffer.from(canonicalJson(manifest) + '\n'));
      const opened = await openCatalogueHandover(outputDirectory);
      return { directory: outputDirectory, manifest: opened.manifest };
    });
  }
  return Object.freeze({ directory, operation, configure, receive, review,
    getState: async () => copy(await read()), getSource, sourceDocument, getSavedFile, exportHandover,
    async close() { closed = true; await queue; } });
}

export async function openCatalogueHandover(directory) {
  directory = await privateDirectory(resolve(directory), { create: false });
  const manifest = await readJson(join(directory, MANIFEST), STATE_LIMIT);
  requireValue(manifest?.schema === HANDOVER_SCHEMA && Array.isArray(manifest.files) &&
    Array.isArray(manifest.sourceDeliveries), 'CATALOGUE_HANDOVER_INVALID');
  const core = { ...manifest }; delete core.sha256;
  requireValue(hash(core) === manifest.sha256, 'CATALOGUE_HANDOVER_CHANGED');
  const names = new Set();
  for (const file of manifest.files) {
    const path = relative(file.path);
    requireValue(path !== MANIFEST && !names.has(path) && Number.isSafeInteger(file.bytes) &&
      file.bytes >= 0 && /^[a-f0-9]{64}$/.test(file.sha256), 'CATALOGUE_HANDOVER_FILE_INVALID');
    names.add(path);
    const bytes = await readBytes(join(directory, path), file.bytes);
    requireValue(bytes.length === file.bytes && hash(bytes) === file.sha256, 'CATALOGUE_HANDOVER_FILE_CHANGED');
  }
  requireValue(names.has('state.json') &&
    canonicalJson((await filesUnder(directory)).sort()) === canonicalJson([...names, MANIFEST].sort()),
    'CATALOGUE_HANDOVER_INCOMPLETE');
  const state = validateState(await readJson(join(directory, 'state.json'), STATE_LIMIT));
  requireValue(state.id === manifest.workspaceId && state.revision === manifest.workspaceRevision,
    'CATALOGUE_HANDOVER_WORKSPACE_CHANGED');
  for (const entry of state.sources) {
    const source = validateSource(await readJson(join(directory, relative(entry.path)), STATE_LIMIT));
    requireValue(source.sha256 === entry.sourceSha256, 'CATALOGUE_HANDOVER_SOURCE_CHANGED');
    const deliveryPath = relative(entry.deliveryDirectory);
    requireValue(manifest.sourceDeliveries.some(item =>
      item.path === deliveryPath && item.identitySha256 === hash(source.sourceIdentity) &&
      canonicalJson(item.sourceIdentity) === canonicalJson(source.sourceIdentity)),
      'CATALOGUE_HANDOVER_DELIVERY_MISSING');
    const delivery = await StacDelivery.open(join(directory, deliveryPath));
    requireValue(['bundleSha256', 'selectionSha256', 'editionDigest', 'nativeBindingSha256'].every(field =>
      delivery.manifest[field] === source.sourceIdentity[field]), 'CATALOGUE_HANDOVER_DELIVERY_CHANGED');
  }
  return { directory, manifest, state };
}

/** Import into a new private directory. Existing catalogue mutations stay in their original operation ledger. */
export async function receiveCatalogueHandover({ sourceDirectory, directory, operationId } = {}) {
  identifier(operationId, 'receiving operation ID');
  const opened = await openCatalogueHandover(sourceDirectory);
  directory = resolve(directory);
  requireValue(directory !== opened.directory && !directory.startsWith(opened.directory + '/'),
    'CATALOGUE_SEPARATE_RECEIVING_REQUIRED');
  await privateDirectory(directory);
  const receiptPath = join(directory, 'receiving.json');
  if (await exists(receiptPath)) {
    const receipt = await readJson(receiptPath, STATE_LIMIT);
    requireValue(receipt.operationId === operationId && receipt.sourceSha256 === opened.manifest.sha256,
      'CATALOGUE_RECEIVING_OPERATION_CHANGED');
    const workspace = await openCatalogueWorkspace({ directory, create: false });
    return { workspace, receipt };
  }
  const entries = await readdir(directory);
  const markerPath = join(directory, 'receiving-prepared.json');
  let marker = { schema: 'starforge.stac-geonetwork-receiving-prepared.v1',
    operationId, sourceSha256: opened.manifest.sha256, receivedAt: stamp() };
  if (entries.length) {
    requireValue(await exists(markerPath), 'CATALOGUE_NEW_RECEIVING_DIRECTORY_REQUIRED');
    const original = await readJson(markerPath);
    requireValue(original.schema === marker.schema && original.operationId === operationId &&
      original.sourceSha256 === marker.sourceSha256 && typeof original.receivedAt === 'string', 'CATALOGUE_RECEIVING_OPERATION_CHANGED');
    marker = original;
  } else await writeJson(markerPath, marker, { exclusive: true });
  for (const file of opened.manifest.files) {
    if (file.path === 'state.json') continue;
    await retained(join(directory, relative(file.path)),
      await readBytes(join(opened.directory, file.path), file.bytes));
  }
  const state = copy(opened.state);
  for (const entry of state.sources) entry.deliveryDirectory = join(directory, relative(entry.deliveryDirectory));
  const receipt = { schema: 'starforge.stac-geonetwork-receiving.v1', operationId,
    sourceSha256: opened.manifest.sha256, workspaceId: state.id,
    sourceRevision: state.revision, receivedAt: marker.receivedAt };
  if (await exists(join(directory, 'state.json'))) {
    const actual = await readJson(join(directory, 'state.json'), STATE_LIMIT);
    requireValue(actual.id === state.id && (actual.imports ?? []).some(value =>
      value.operationId === operationId && value.sourceSha256 === receipt.sourceSha256),
      'CATALOGUE_RECEIVING_STATE_CHANGED');
  } else {
    state.revision++; state.updatedAt = receipt.receivedAt; state.stacWorkspaceId = null;
    state.imports.push(receipt);
    await writeJson(join(directory, 'state.json'), state, { exclusive: true });
  }
  for (const name of ['locks', 'sources', 'operations', 'archives']) await privateDirectory(join(directory, name));
  await retained(receiptPath, Buffer.from(canonicalJson(receipt) + '\n'));
  const workspace = await openCatalogueWorkspace({ directory, create: false });
  return { workspace, receipt };
}
