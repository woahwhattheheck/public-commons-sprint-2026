// MIT. Original STAC delivery custody and durable GeoNetwork operator work.
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { Readable } from 'node:stream';
import { readdir, lstat, realpath, open, unlink } from 'node:fs/promises';
import { resolve, join, dirname, basename, isAbsolute, relative as filesystemRelative, sep } from 'node:path';
import { privateDirectory as originalPrivateDirectory, readBytes, readJson, writeBytes, writeJson, exists, matchingWriteTemporaries, syncDirectory }
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { withPrivateLock } from '../../routescan/quota.mjs';
import { StacDelivery } from '../customer.mjs';
import { StacFile } from '../merchant.mjs';
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
function contains(parent, child) {
  const path = filesystemRelative(parent, child);
  return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}
async function canonicalLocation(path) {
  path = resolve(path);
  let ancestor = path;
  while (!await exists(ancestor)) {
    const parent = dirname(ancestor);
    requireValue(parent !== ancestor, 'CATALOGUE_PARENT_NOT_FOUND');
    ancestor = parent;
  }
  const info = await lstat(ancestor);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && await realpath(ancestor) === ancestor,
    'CATALOGUE_CANONICAL_DIRECTORY_REQUIRED');
  return path;
}
async function privateDirectory(path, options = {}) {
  path = await canonicalLocation(path);
  await originalPrivateDirectory(path, options);
  requireValue(await realpath(path) === path, 'CATALOGUE_DIRECTORY_PARENT_CHANGED');
  return path;
}
async function checkParent(path) {
  const parent = dirname(resolve(path));
  requireValue(await realpath(parent) === parent, 'CATALOGUE_FILE_PARENT_CHANGED');
}
/** Hash unknown retained files in fixed-size chunks; never allocate a raster-sized Buffer. */
async function fingerprint(path, expected = null, { signal } = {}) {
  path = resolve(path); await checkParent(path);
  const named = await lstat(path);
  requireValue(named.isFile() && !named.isSymbolicLink(), 'CATALOGUE_REGULAR_FILE_REQUIRED');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat();
    requireValue(before.isFile() && before.ino === named.ino && before.dev === named.dev &&
      Number.isSafeInteger(before.size) && before.size <= 2147483648, 'CATALOGUE_FILE_SIZE_OR_IDENTITY_CHANGED');
    if (expected) requireValue(before.size === expected.bytes, 'CATALOGUE_RETAINED_FILE_CHANGED');
    const digest = createHash('sha256'), chunk = Buffer.allocUnsafe(1048576);
    let size = 0;
    while (true) {
      requireValue(!signal?.aborted, 'CATALOGUE_FILE_READ_ABORTED');
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, size);
      if (!bytesRead) break;
      size += bytesRead;
      requireValue(size <= before.size, 'CATALOGUE_FILE_CHANGED_DURING_READ');
      digest.update(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat(), current = await lstat(path);
    await checkParent(path);
    requireValue(size === before.size && after.size === before.size &&
      after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs &&
      current.isFile() && current.dev === before.dev && current.ino === before.ino,
      'CATALOGUE_FILE_CHANGED_DURING_READ');
    const record = { bytes: size, sha256: digest.digest('hex') };
    if (expected) requireValue(record.sha256 === expected.sha256, 'CATALOGUE_RETAINED_FILE_CHANGED');
    return record;
  } finally { await handle.close(); }
}
async function retained(path, bytes) {
  bytes = Buffer.from(bytes);
  await privateDirectory(dirname(path)); await checkParent(path);
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
async function retainedFile(source, destination, record, { signal } = {}) {
  await checkParent(source);
  await privateDirectory(dirname(destination)); await checkParent(destination);
  const at = path => new StacFile(dirname(path), { path: basename(path), bytes: record.bytes,
    sha256: record.sha256, mime: 'application/octet-stream' });
  if (await exists(destination)) await at(destination).verify({ signal });
  else {
    try { await at(source).saveAs(destination, { signal }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await at(destination).verify({ signal });
    }
  }
  return { bytes: record.bytes, sha256: record.sha256 };
}
async function filesUnder(directory, prefix = '') {
  await checkParent(join(directory, 'member'));
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
const deliveryIdentity = manifest => Object.fromEntries(['schema', 'bundleSha256', 'selectionSha256',
  'editionId', 'editionDigest', 'snapshot', 'nativeBindingSha256'].map(key => [key, manifest[key] ?? null]));
async function matchingInventory(directory, files, extra = []) {
  const expected = new Map(files.map(file => [relative(file.path), file]));
  requireValue(expected.size === files.length, 'CATALOGUE_HANDOVER_PATH_REPEATED');
  const actual = await filesUnder(directory);
  requireValue(canonicalJson(actual.sort()) === canonicalJson([...expected.keys(), ...extra].sort()),
    'CATALOGUE_HANDOVER_INCOMPLETE');
  for (const file of files) await fingerprint(join(directory, file.path), file);
}
async function cleanOwnJsonTemporaries(directory, expectedBytes) {
  // These are only complete private writeBytes leftovers matching this operation's exact JSON.
  for (const name of await matchingWriteTemporaries(directory, expectedBytes))
    await unlink(join(directory, name));
}
/**
 * Recover only original saveAs leftovers in this prepared operation's output.
 * A .download-UUID can be a partial file, so its bounded bytes must equal an
 * exact prefix of a verified final target in the SAME directory. Unknown files
 * stay in place and the caller's complete inventory check still rejects them.
 * Both callers hold the workspace flock and have verified the preparation ID.
 */
async function cleanOwnDownloadTemporaries(directory, files, { signal } = {}) {
  const sameFile = (left, right) => left.isFile() && right.isFile() &&
    left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mode === right.mode && left.uid === right.uid && left.gid === right.gid &&
    left.nlink === right.nlink && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
  const parents = new Map(), published = new Set();
  for (const record of files) {
    const path = join(directory, relative(record.path)), parent = dirname(path);
    published.add(path);
    const named = await lstat(path, { bigint: true });
    await fingerprint(path, record, { signal });
    const verified = await lstat(path, { bigint: true });
    requireValue(sameFile(named, verified), 'CATALOGUE_FILE_CHANGED_DURING_READ');
    const targets = parents.get(parent) ?? [];
    targets.push({ path, stat: verified, record }); parents.set(parent, targets);
  }
  const options = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const left = Buffer.allocUnsafe(65536), right = Buffer.allocUnsafe(65536);
  async function readBlock(handle, buffer, length, position) {
    let total = 0;
    while (total < length) {
      requireValue(!signal?.aborted, 'CATALOGUE_FILE_READ_ABORTED');
      const { bytesRead } = await handle.read(buffer, total, length - total, position + total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    return total;
  }
  for (const [parent, targets] of parents) {
    await checkParent(join(parent, 'member'));
    const parentStat = await lstat(parent, { bigint: true });
    requireValue(parentStat.isDirectory() && !parentStat.isSymbolicLink(),
      'CATALOGUE_FILE_PARENT_CHANGED');
    let removed = false;
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!/^\.download-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.name))
        continue;
      const path = join(parent, entry.name);
      if (published.has(path) || !entry.isFile()) continue;
      let temporary;
      try {
        const named = await lstat(path, { bigint: true });
        if (!named.isFile() || named.isSymbolicLink() || named.size > 2147483648n ||
            process.platform !== 'win32' && ((named.mode & 0o777n) !== 0o600n ||
              process.getuid && named.uid !== BigInt(process.getuid()))) continue;
        temporary = await open(path, options);
        const before = await temporary.stat({ bigint: true });
        if (!sameFile(named, before)) continue;
        for (const target of targets) {
          if (before.size > target.stat.size) continue;
          const final = await open(target.path, options);
          try {
            const finalBefore = await final.stat({ bigint: true });
            requireValue(sameFile(finalBefore, target.stat), 'CATALOGUE_FILE_CHANGED_DURING_READ');
            let position = 0, matches = true;
            const size = Number(before.size);
            while (position < size) {
              const length = Math.min(left.length, size - position);
              const a = await readBlock(temporary, left, length, position);
              const b = await readBlock(final, right, length, position);
              if (a !== length || b !== length || !left.subarray(0, length).equals(right.subarray(0, length))) {
                matches = false; break;
              }
              position += length;
            }
            if (!matches) continue;
            requireValue(!signal?.aborted, 'CATALOGUE_FILE_READ_ABORTED');
            const tail = await temporary.read(left, 0, 1, size);
            const after = await temporary.stat({ bigint: true });
            const current = await lstat(path, { bigint: true });
            const finalAfter = await final.stat({ bigint: true });
            const finalCurrent = await lstat(target.path, { bigint: true });
            const currentParent = await lstat(parent, { bigint: true });
            await checkParent(path);
            if (tail.bytesRead !== 0 || !sameFile(before, after) || !sameFile(before, current))
              break;
            requireValue(sameFile(finalBefore, finalAfter) && sameFile(finalBefore, finalCurrent) &&
              currentParent.isDirectory() && currentParent.dev === parentStat.dev &&
              currentParent.ino === parentStat.ino, 'CATALOGUE_FILE_CHANGED_DURING_READ');
            await unlink(path); removed = true;
            if (before.dev === finalBefore.dev && before.ino === finalBefore.ino) {
              // saveAs may have published its no-replace link just before death.
              // Removing that second name legitimately updates the target inode.
              await fingerprint(target.path, target.record, { signal });
              const updated = await final.stat({ bigint: true });
              requireValue(updated.dev === finalBefore.dev && updated.ino === finalBefore.ino &&
                updated.size === finalBefore.size && updated.mode === finalBefore.mode &&
                updated.uid === finalBefore.uid && updated.gid === finalBefore.gid &&
                updated.mtimeNs === finalBefore.mtimeNs && updated.nlink === finalBefore.nlink - 1n &&
                sameFile(updated, await lstat(target.path, { bigint: true })),
                'CATALOGUE_FILE_CHANGED_DURING_READ');
              for (const row of targets)
                if (row.stat.dev === updated.dev && row.stat.ino === updated.ino) row.stat = updated;
            }
            break;
          } finally { await final.close(); }
        }
      } catch (error) {
        if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error;
      } finally { if (temporary) await temporary.close(); }
    }
    if (removed) await syncDirectory(parent);
  }
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
  title = 'Catalogue receiving', signal } = {}) {
  directory = await privateDirectory(resolve(directory), { create });
  for (const name of ['locks', 'sources', 'operations', 'archives'])
    await privateDirectory(join(directory, name), { create });
  const statePath = join(directory, 'state.json');
  const stacIdentity = stacWorkspace ? (await stacWorkspace.getState()).id : null;
  await withPrivateLock(join(directory, 'locks'), 'workspace.lock', async () => {
    if (await exists(join(directory, 'receiving-prepared.json')))
      requireValue(await exists(join(directory, 'receiving.json')), 'CATALOGUE_RECEIVING_NOT_PUBLISHED');
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
  });
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
    await checkParent(join(directory, relative(entry.path)));
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
        if (state.connection && hash(normalized) === hash(state.connection))
          return { connection: copy(normalized), connectionRevision: state.connectionRevision };
        if (expectedRevision !== undefined)
          requireValue(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 &&
            state.revision === expectedRevision + 1, 'CATALOGUE_REVISION_CHANGED');
        const installation = value => value ? {
          baseUrl: value.baseUrl, portal: value.portal, language: value.language
        } : null;
        const hasNativeHistory = state.harvester || Object.values(state.operations).some(value =>
          ['HARVEST', 'RECORD_ACTION'].includes(value.kind) &&
          Object.values(value.steps ?? {}).some(step => step.mutation));
        if (hasNativeHistory)
          requireValue(hash(installation(normalized)) === hash(installation(state.connection)),
            'CATALOGUE_INSTALLATION_ALREADY_BOUND',
            'This workspace continues its saved installation. Authentication references, version and limits can be reviewed and updated.');
        state.connection = normalized; state.connectionRevision++;
        state.capabilities = null;
        return { connection: copy(normalized), connectionRevision: state.connectionRevision };
      });
  }
  async function receive({ deliveryDirectory, collectionIds, sourceUrls = {}, sourceTitle, operationId } = {}) {
    deliveryDirectory = resolve(deliveryDirectory);
    const delivery = await StacDelivery.open(await privateDirectory(deliveryDirectory, { create: false }), { signal });
    const deliveryIdentity = Object.fromEntries(['schema', 'bundleSha256', 'selectionSha256', 'editionId',
      'editionDigest', 'snapshot', 'nativeBindingSha256'].map(key => [key, delivery.manifest[key] ?? null]));
    return operation({ operationId, kind: 'RECEIVE_SOURCE',
      input: { deliveryDirectory, deliveryIdentity, collectionIds, sourceUrls, sourceTitle: sourceTitle ?? null } }, async context => {
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
    await checkParent(path);
    const bytes = await readBytes(path, STATE_LIMIT);
    requireValue(hash(JSON.parse(bytes.toString('utf8'))) === sha256, 'CATALOGUE_SOURCE_CHANGED');
    return { bytes, filename: sha256 + '.collections.json', mime: 'application/json' };
  }
  async function getSavedFile(path) {
    path = relative(path);
    requireValue(['sources/', 'operations/', 'archives/'].some(prefix => path.startsWith(prefix)),
      'CATALOGUE_SAVED_FILE_INVALID');
    const full = join(directory, path), metadata = await fingerprint(full, null, { signal });
    const file = new StacFile(directory, { path, ...metadata, mime: 'application/octet-stream' });
    return { stream: Readable.from(file.chunks({ signal })), bytes: metadata.bytes, filename: basename(path),
      mime: path.endsWith('.zip') ? 'application/zip' : path.endsWith('.xml') ? 'application/xml' : 'application/json' };
  }
  async function exportHandover({ outputDirectory, operationId } = {}) {
    outputDirectory = await canonicalLocation(resolve(outputDirectory));
    requireValue(!contains(directory, outputDirectory) && !contains(outputDirectory, directory),
      'CATALOGUE_SEPARATE_HANDOVER_REQUIRED');
    const result = await operation({ operationId, kind: 'EXPORT_HANDOVER', input: { outputDirectory } }, async context => {
      const manifestPath = join(outputDirectory, MANIFEST), markerPath = join(outputDirectory, 'catalogue-export-prepared.json');
      if (await exists(manifestPath)) {
        const opened = await openCatalogueHandover(outputDirectory, { signal });
        requireValue(opened.manifest.operationId === operationId && opened.manifest.workspaceId === context.state.id,
          'CATALOGUE_HANDOVER_OPERATION_CHANGED');
        return { directory: outputDirectory, manifest: opened.manifest };
      }
      await privateDirectory(outputDirectory);
      let snapshot = context.op.steps.snapshot?.result;
      if (!snapshot) {
        requireValue((await readdir(outputDirectory)).length === 0, 'CATALOGUE_NEW_HANDOVER_DIRECTORY_REQUIRED');
        const state = copy(context.state); delete state.operations[operationId];
        const files = [], excludedTemporaryPaths = [];
        for (const name of ['sources', 'operations', 'archives']) {
          for (const path of await filesUnder(join(directory, name))) {
            const originalPath = name + '/' + path;
            if (originalPath.startsWith('operations/' + hash(operationId) + '/')) continue;
            if (/^\.write-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(basename(path))) {
              excludedTemporaryPaths.push(originalPath); continue;
            }
            files.push({ path: originalPath, ...await fingerprint(join(directory, originalPath), null, { signal }) });
          }
        }
        const deliveries = new Map();
        for (const entry of state.sources) {
          const source = (await sourceFor(state, entry.sourceSha256)).source;
          const identitySha256 = hash(source.sourceIdentity);
          if (deliveries.has(identitySha256)) continue;
          const actual = await StacDelivery.open(await privateDirectory(entry.deliveryDirectory, { create: false }), { signal });
          requireValue(canonicalJson(deliveryIdentity(actual.manifest)) === canonicalJson(source.sourceIdentity),
            'CATALOGUE_SOURCE_DELIVERY_CHANGED');
          const manifestFile = await fingerprint(join(actual.directory, 'manifest.json'), null, { signal });
          const members = Object.entries(actual.manifest.files).map(([path, file]) =>
            ({ path, bytes: file.bytes, sha256: file.sha256 }));
          deliveries.set(identitySha256, { identitySha256, sourceIdentity: copy(source.sourceIdentity),
            originalDirectory: actual.directory, path: 'deliveries/' + identitySha256,
            files: [...members, { path: 'manifest.json', ...manifestFile }] });
        }
        snapshot = { state, files, deliveries: [...deliveries.values()], excludedTemporaryPaths };
        context.op.steps.snapshot = { name: 'snapshot', mutation: false, status: 'COMPLETE',
          result: snapshot, completedAt: stamp() };
        await context.checkpoint();
      }
      const marker = { schema: 'starforge.stac-geonetwork-export-prepared.v1', operationId,
        workspaceId: snapshot.state.id, snapshotSha256: hash(snapshot) };
      const markerBytes = Buffer.from(canonicalJson(marker) + '\n');
      await cleanOwnJsonTemporaries(outputDirectory, [markerBytes]);
      const existing = await readdir(outputDirectory);
      requireValue(!existing.length || await exists(markerPath), 'CATALOGUE_NEW_HANDOVER_DIRECTORY_REQUIRED');
      await retained(markerPath, markerBytes);
      const packagedState = copy(snapshot.state);
      for (const entry of packagedState.sources) {
        const record = snapshot.deliveries.find(item => item.identitySha256 === hash(entry.sourceIdentity));
        requireValue(record, 'CATALOGUE_SNAPSHOT_DELIVERY_MISSING'); entry.deliveryDirectory = record.path;
      }
      const files = [{ path: 'catalogue-export-prepared.json', bytes: markerBytes.length, sha256: hash(markerBytes) }];
      for (const record of snapshot.deliveries) {
        for (const file of record.files) {
          const path = record.path + '/' + relative(file.path);
          await retainedFile(join(record.originalDirectory, file.path), join(outputDirectory, path), file, { signal });
          files.push({ path, bytes: file.bytes, sha256: file.sha256 });
        }
        const received = await StacDelivery.open(join(outputDirectory, record.path), { signal });
        requireValue(canonicalJson(deliveryIdentity(received.manifest)) === canonicalJson(record.sourceIdentity),
          'CATALOGUE_HANDOVER_DELIVERY_CHANGED');
      }
      for (const file of snapshot.files) {
        await retainedFile(join(directory, file.path), join(outputDirectory, file.path), file, { signal });
        files.push(copy(file));
      }
      const stateBytes = Buffer.from(canonicalJson(packagedState) + '\n');
      await cleanOwnJsonTemporaries(outputDirectory, [markerBytes, stateBytes]);
      await retained(join(outputDirectory, 'state.json'), stateBytes);
      files.push({ path: 'state.json', bytes: stateBytes.length, sha256: hash(stateBytes) });
      files.sort((a, b) => a.path.localeCompare(b.path));
      const manifest = { schema: HANDOVER_SCHEMA, operationId, workspaceId: snapshot.state.id,
        workspaceRevision: snapshot.state.revision, createdAt: context.op.startedAt, files,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        sourceDeliveries: snapshot.deliveries.map(({ identitySha256, sourceIdentity, path }) =>
          ({ identitySha256, sourceIdentity: copy(sourceIdentity), path })) };
      manifest.sha256 = hash(manifest);
      const manifestBytes = Buffer.from(canonicalJson(manifest) + '\n');
      await cleanOwnJsonTemporaries(outputDirectory, [markerBytes, stateBytes, manifestBytes]);
      await cleanOwnDownloadTemporaries(outputDirectory, files.filter(file =>
        !['state.json', 'catalogue-export-prepared.json'].includes(file.path)), { signal });
      await matchingInventory(outputDirectory, files);
      await retained(manifestPath, manifestBytes);
      const opened = await openCatalogueHandover(outputDirectory, { signal });
      return { directory: outputDirectory, manifest: opened.manifest };
    });
    const reopened = await openCatalogueHandover(result.directory, { signal });
    requireValue(reopened.manifest.sha256 === result.manifest.sha256, 'CATALOGUE_HANDOVER_CHANGED');
    return result;
  }
  return Object.freeze({ directory, operation, configure, receive, review,
    getState: async () => copy(await read()), getSource, sourceDocument, getSavedFile, exportHandover,
    async close() { closed = true; await queue; } });
}

export async function openCatalogueHandover(directory, { signal } = {}) {
  directory = await privateDirectory(resolve(directory), { create: false });
  const manifest = await readJson(join(directory, MANIFEST), STATE_LIMIT);
  requireValue(manifest?.schema === HANDOVER_SCHEMA && Array.isArray(manifest.files) &&
    Array.isArray(manifest.sourceDeliveries), 'CATALOGUE_HANDOVER_INVALID');
  const core = { ...manifest }; delete core.sha256;
  requireValue(hash(core) === manifest.sha256, 'CATALOGUE_HANDOVER_CHANGED');
  const names = new Set();
  for (const file of manifest.files) {
    const path = relative(file.path);
    requireValue((['state.json', 'catalogue-export-prepared.json'].includes(path) ||
      ['sources/', 'operations/', 'archives/', 'deliveries/'].some(prefix => path.startsWith(prefix))) &&
      path !== MANIFEST && !names.has(path) && Number.isSafeInteger(file.bytes) &&
      file.bytes >= 0 && /^[a-f0-9]{64}$/.test(file.sha256), 'CATALOGUE_HANDOVER_FILE_INVALID');
    names.add(path);
    await fingerprint(join(directory, path), file, { signal });
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
    const delivery = await StacDelivery.open(join(directory, deliveryPath), { signal });
    requireValue(canonicalJson(deliveryIdentity(delivery.manifest)) === canonicalJson(source.sourceIdentity),
      'CATALOGUE_HANDOVER_DELIVERY_CHANGED');
  }
  return { directory, manifest, state };
}

/** Import into a new private directory. Existing catalogue mutations stay in their original operation ledger. */
export async function receiveCatalogueHandover({ sourceDirectory, directory, operationId, signal } = {}) {
  identifier(operationId, 'receiving operation ID');
  const opened = await openCatalogueHandover(sourceDirectory, { signal });
  directory = await canonicalLocation(resolve(directory));
  requireValue(!contains(opened.directory, directory) && !contains(directory, opened.directory),
    'CATALOGUE_SEPARATE_RECEIVING_REQUIRED');
  await privateDirectory(directory);
  await privateDirectory(join(directory, 'locks'));
  const received = await withPrivateLock(join(directory, 'locks'), 'workspace.lock', async () => {
    const receiptPath = join(directory, 'receiving.json');
    if (await exists(receiptPath)) {
      const receipt = await readJson(receiptPath, STATE_LIMIT);
      requireValue(receipt.operationId === operationId && receipt.sourceSha256 === opened.manifest.sha256,
        'CATALOGUE_RECEIVING_OPERATION_CHANGED');
      const state = validateState(await readJson(join(directory, 'state.json'), STATE_LIMIT));
      requireValue(state.id === receipt.workspaceId && (state.imports ?? []).some(value =>
        value.operationId === operationId && value.sourceSha256 === receipt.sourceSha256),
        'CATALOGUE_RECEIVING_STATE_CHANGED');
      for (const file of opened.manifest.files)
        if (file.path !== 'state.json') await fingerprint(join(directory, file.path), file, { signal });
      return receipt;
    }
    const markerPath = join(directory, 'receiving-prepared.json');
    let marker = { schema: 'starforge.stac-geonetwork-receiving-prepared.v1',
      operationId, sourceSha256: opened.manifest.sha256, receivedAt: stamp() };
    const entries = (await readdir(directory)).filter(name => name !== 'locks');
    if (entries.length) {
      requireValue(await exists(markerPath), 'CATALOGUE_NEW_RECEIVING_DIRECTORY_REQUIRED');
      const original = await readJson(markerPath);
      requireValue(original.schema === marker.schema && original.operationId === operationId &&
        original.sourceSha256 === marker.sourceSha256 && typeof original.receivedAt === 'string',
        'CATALOGUE_RECEIVING_OPERATION_CHANGED');
      marker = original;
    } else await writeJson(markerPath, marker, { exclusive: true });
    const markerBytes = Buffer.from(canonicalJson(marker) + '\n');
    for (const file of opened.manifest.files) {
      if (file.path === 'state.json') continue;
      await retainedFile(join(opened.directory, relative(file.path)), join(directory, file.path), file, { signal });
    }
    const state = copy(opened.state);
    for (const entry of state.sources) entry.deliveryDirectory = join(directory, relative(entry.deliveryDirectory));
    const receipt = { schema: 'starforge.stac-geonetwork-receiving.v1', operationId,
      sourceSha256: opened.manifest.sha256, workspaceId: state.id,
      sourceRevision: state.revision, receivedAt: marker.receivedAt };
    state.revision++; state.updatedAt = receipt.receivedAt; state.stacWorkspaceId = null;
    state.imports = [...(state.imports ?? []), receipt];
    const stateBytes = Buffer.from(canonicalJson(state) + '\n'), receiptBytes = Buffer.from(canonicalJson(receipt) + '\n');
    await cleanOwnJsonTemporaries(directory, [markerBytes, stateBytes, receiptBytes]);
    await retained(join(directory, 'state.json'), stateBytes);
    const expected = [
      ...opened.manifest.files.filter(file => file.path !== 'state.json'),
      { path: 'state.json', bytes: stateBytes.length, sha256: hash(stateBytes) },
      { path: 'receiving-prepared.json', ...await fingerprint(markerPath, null, { signal }) }
    ];
    for (const name of ['sources', 'operations', 'archives']) await privateDirectory(join(directory, name));
    // The same flock prevents an ordinary workspace opener from using the partially copied state.
    await cleanOwnDownloadTemporaries(directory,
      opened.manifest.files.filter(file => file.path !== 'state.json'), { signal });
    const actualFiles = (await filesUnder(directory)).filter(path => !path.startsWith('locks/'));
    requireValue(canonicalJson(actualFiles.sort()) === canonicalJson(expected.map(file => file.path).sort()),
      'CATALOGUE_RECEIVING_INCOMPLETE');
    for (const file of expected) await fingerprint(join(directory, file.path), file, { signal });
    for (const entry of state.sources) {
      const original = validateSource(await readJson(join(directory, relative(entry.path)), STATE_LIMIT));
      const delivery = await StacDelivery.open(entry.deliveryDirectory, { signal });
      requireValue(canonicalJson(deliveryIdentity(delivery.manifest)) === canonicalJson(original.sourceIdentity),
        'CATALOGUE_RECEIVING_DELIVERY_CHANGED');
    }
    await retained(receiptPath, receiptBytes);
    return receipt;
  });
  const workspace = await openCatalogueWorkspace({ directory, create: false, signal });
  return { workspace, receipt: received };
}
