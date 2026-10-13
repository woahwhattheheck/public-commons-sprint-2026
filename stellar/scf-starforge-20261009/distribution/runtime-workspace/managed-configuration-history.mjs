// MIT. Complete configuration editions in the original Runtime workspace.
import { join, dirname } from 'node:path';
import { unlink, open } from 'node:fs/promises';
import { makePrivate, privateDirectory, optionalPrivateEntries, regular, readJSON, saveJSON,
  recordId, operationId, need, digest, json, canonical, now } from './storage.mjs';
import { atomicFile } from '../../sf46-release/release-core.mjs';

const SCHEMA = 'stellar-forge.managed-configuration-edition.v1';
const hash = value => digest(json(canonical(value)));
const rootFor = (root, homeId) => join(root, 'managed-configuration-history', recordId(homeId));
const directoryFor = (root, homeId, id) => join(rootFor(root, homeId), operationId(id));
const text = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
async function ensure(directory) {
  try { await makePrivate(directory); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(directory); }
}
export function configurationSnapshot(bytes) {
  if (bytes === null) return { exists: false, bytes: 0, sha256: null, contentBase64: null, content: null };
  let content = null;
  try { content = text(bytes); } catch {}
  return { exists: true, bytes: bytes.length, sha256: digest(bytes),
    contentBase64: bytes.toString('base64'), content };
}
function validateSnapshot(value) {
  need(value && typeof value.exists === 'boolean', 'MANAGED_CONFIGURATION_SNAPSHOT_INVALID');
  if (!value.exists) {
    need(value.bytes === 0 && value.sha256 === null && value.contentBase64 === null && value.content === null,
      'MANAGED_CONFIGURATION_ABSENCE_INVALID');
    return null;
  }
  need(typeof value.contentBase64 === 'string', 'MANAGED_CONFIGURATION_BYTES_REQUIRED');
  const bytes = Buffer.from(value.contentBase64, 'base64');
  need(bytes.length <= 20000 && bytes.length === value.bytes && bytes.toString('base64') === value.contentBase64 &&
    digest(bytes) === value.sha256, 'MANAGED_CONFIGURATION_BYTES_CHANGED');
  let decoded = null;
  try { decoded = text(bytes); } catch {}
  need(decoded === value.content, 'MANAGED_CONFIGURATION_TEXT_CHANGED');
  return bytes;
}
async function readFile(path) {
  try { return await regular(path, 20000); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function requestBinding(request) {
  return { operation: request.operation, homeId: request.homeId, homeDirectory: request.homeDirectory,
    path: request.path, expectedSha256: request.expectedSha256,
    targetSha256: request.contentSha256, remove: request.remove === true,
    restoredFrom: request.restoredFrom ?? null };
}
function validateIntent(value, homeId, id) {
  need(value?.schema === SCHEMA && value.homeId === homeId && value.operationId === id &&
    typeof value.path === 'string' && typeof value.homeDirectory === 'string' &&
    value.binding?.homeId === homeId && value.binding.path === value.path &&
    value.binding.homeDirectory === value.homeDirectory, 'MANAGED_CONFIGURATION_EDITION_INVALID');
  validateSnapshot(value.before); validateSnapshot(value.after);
  need(value.binding.targetSha256 === value.after.sha256 &&
    value.binding.remove === !value.after.exists &&
    hash(value.binding) === value.requestSha256, 'MANAGED_CONFIGURATION_BINDING_CHANGED');
  return value;
}
export async function configurationEdition(root, { homeId, operationId: id }) {
  const directory = directoryFor(root, homeId, id);
  const intent = validateIntent(await readJSON(join(directory, 'intent.json')), homeId, id);
  const result = await readJSON(join(directory, 'result.json'), true);
  if (result) need(result.schema === 'stellar-forge.managed-configuration-result.v1' &&
    result.operationId === id && result.intentSha256 === hash(intent) &&
    result.sha256 === intent.after.sha256 && result.exists === intent.after.exists,
  'MANAGED_CONFIGURATION_RESULT_CHANGED');
  return { intent, intentSha256: hash(intent), result };
}
export async function configurationHistory(root, { homeId, path, operationId: id, cursor, limit = 40, selection } = {}) {
  recordId(homeId);
  const home = await readJSON(join(root, 'managed-homes', homeId + '.json'));
  need(home.id === homeId, 'MANAGED_HOME_RECORD_INVALID');
  if (id) {
    const edition = await configurationEdition(root, { homeId, operationId: id });
    need(edition.intent.homeDirectory === home.directory && (path === undefined || edition.intent.path === path),
      'MANAGED_CONFIGURATION_SOURCE_CHANGED');
    return { homeId, ...edition };
  }
  need(selection === undefined || selection === 'all', 'MANAGED_CONFIGURATION_SELECTION_INVALID');
  limit = Number(limit);
  need(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'MANAGED_CONFIGURATION_PAGE_INVALID');
  if (cursor) operationId(cursor);
  const names = (await optionalPrivateEntries(rootFor(root, homeId)))
    .filter(name => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name)).sort();
  const eligible = names.filter(name => !cursor || name > cursor);
  const entries = [];
  let nextCursor = null;
  for (let i = 0; i < eligible.length; i++) {
    const operationId = eligible[i];
    const intentPath = join(rootFor(root, homeId), operationId, 'intent.json');
    if (!await readJSON(intentPath, true)) continue;
    const { intent, intentSha256, result } = await configurationEdition(root, { homeId, operationId });
    need(intent.homeDirectory === home.directory, 'MANAGED_CONFIGURATION_SOURCE_CHANGED');
    if (path !== undefined && intent.path !== path) continue;
    entries.push({ operationId, path: intent.path, capturedAt: intent.capturedAt, intentSha256,
      before: { exists: intent.before.exists, bytes: intent.before.bytes, sha256: intent.before.sha256 },
      after: { exists: intent.after.exists, bytes: intent.after.bytes, sha256: intent.after.sha256 },
      phase: result ? 'APPLIED' : 'PREPARED', restoredFrom: intent.binding.restoredFrom,
      priorContentKnown: intent.priorContentKnown });
    if (selection !== 'all' && entries.length === limit) { nextCursor = i < eligible.length - 1 ? operationId : null; break; }
  }
  return { schema: 'stellar-forge.managed-configuration-history.v1', homeId, path: path ?? null,
    entries, nextCursor, selectionSha256: hash(entries.map(({ operationId, intentSha256 }) => ({ operationId, intentSha256 }))) };
}
export async function configurationRestore(root, request) {
  need(request.version === 'before' || request.version === 'after', 'MANAGED_CONFIGURATION_VERSION_REQUIRED');
  const { intent, intentSha256 } = await configurationEdition(root,
    { homeId: request.homeId, operationId: request.historyOperationId });
  need(intent.homeDirectory === request.homeDirectory && intent.path === request.path,
    'MANAGED_CONFIGURATION_RESTORE_SOURCE_CHANGED');
  // A crash-recovered legacy operation may only have captured its already-written
  // target. Its unknown earlier bytes cannot be selected as a restoration.
  need(request.version !== 'before' || intent.priorContentKnown,
    'MANAGED_CONFIGURATION_PRIOR_CONTENT_UNAVAILABLE');
  const snapshot = intent[request.version];
  validateSnapshot(snapshot);
  need(!snapshot.exists || snapshot.content !== null, 'MANAGED_CONFIGURATION_NATIVE_EDITOR_REQUIRED',
    'This retained original is not UTF-8 text. Export its original bytes for the native editor.');
  return { content: snapshot.content, remove: !snapshot.exists, contentSha256: snapshot.sha256,
    restoredFrom: { operationId: intent.operationId, version: request.version, intentSha256 } };
}
// Called only inside the original withHomeLock and operation/Workspace lease.
export async function writeConfigurationEdition({ root, request, operationDirectory, path }) {
  const id = operationId(operationDirectory.split('/').pop()), homeId = recordId(request.homeId);
  const binding = requestBinding(request), requestSha256 = hash(binding);
  const directory = directoryFor(root, homeId, id);
  await ensure(join(root, 'managed-configuration-history'));
  await ensure(rootFor(root, homeId)); await ensure(directory);
  let intent = await readJSON(join(directory, 'intent.json'), true);
  if (intent) {
    validateIntent(intent, homeId, id);
    need(intent.requestSha256 === requestSha256 && hash(intent.binding) === hash(binding),
      'MANAGED_CONFIGURATION_REQUEST_CHANGED');
    const completed = await readJSON(join(directory, 'result.json'), true);
    if (completed) {
      await configurationEdition(root, { homeId, operationId: id });
      return { ...completed, reopened: true };
    }
  }
  const current = await readFile(path), currentSha256 = current === null ? null : digest(current);
  const target = request.remove ? null : Buffer.from(request.content, 'utf8');
  need((target === null ? null : digest(target)) === request.contentSha256,
    'MANAGED_CONFIGURATION_TARGET_CHANGED');
  if (intent) {
    validateIntent(intent, homeId, id);
    need(intent.requestSha256 === requestSha256 && hash(intent.binding) === hash(binding),
      'MANAGED_CONFIGURATION_REQUEST_CHANGED');
  } else {
    need(currentSha256 === request.expectedSha256 || currentSha256 === request.contentSha256,
      'MANAGED_CONFIG_CHANGED', 'Open the current file before saving another edit', 409);
    intent = { schema: SCHEMA, operationId: id, homeId, homeDirectory: request.homeDirectory,
      path: request.path, binding, requestSha256, capturedAt: now(),
      priorContentKnown: currentSha256 === request.expectedSha256,
      before: configurationSnapshot(current), after: configurationSnapshot(target) };
    await saveJSON(join(directory, 'intent.json'), intent);
  }
  const previous = await readJSON(join(directory, 'result.json'), true);
  if (previous) {
    await configurationEdition(root, { homeId, operationId: id });
    // Replaying an accepted operation must never overwrite a later native edit.
    return { ...previous, reopened: true };
  }
  need(currentSha256 === intent.before.sha256 || currentSha256 === intent.after.sha256,
    'MANAGED_CONFIG_CHANGED', 'Current bytes differ from both retained editions. Review the current file.', 409);
  if (currentSha256 !== intent.after.sha256) {
    if (target === null) {
      await unlink(path);
      const parent = await open(dirname(path), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    } else await atomicFile(path, target, 0o600);
  }
  const after = await readFile(path);
  need((after === null ? null : digest(after)) === intent.after.sha256, 'MANAGED_CONFIGURATION_WRITE_CHANGED');
  const result = { schema: 'stellar-forge.managed-configuration-result.v1', operationId: id,
    intentSha256: hash(intent), homeId, path: request.path, previousSha256: intent.before.sha256,
    sha256: intent.after.sha256, exists: intent.after.exists, bytes: intent.after.bytes,
    priorContentKnown: intent.priorContentKnown, restoredFrom: binding.restoredFrom };
  await saveJSON(join(directory, 'result.json'), result);
  return result;
}
