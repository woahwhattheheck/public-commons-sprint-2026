// MIT. Read-only output sources from original Runtime operations and registered installer attempts.
import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { need, plain, recordId, operationId, privateDirectory, readJSON, currentRuntimeEntry } from './storage.mjs';
import { readRetainedOutputPage, openRetainedOutputDownload } from './application-output.mjs';

const INSTALL_LOG = /^install-(\d+)(?:-[a-f0-9-]{36})?\.log$/;
const fields = ['operationId', 'runtimeId', 'logFile', 'selection', 'offset', 'limit'];
function inputSelection(input, allowed = fields) {
  need(plain(input) && Object.keys(input).every(key => allowed.includes(key)), 'RUNTIME_OUTPUT_FIELDS_INVALID');
  need((input.operationId !== undefined) !== (input.runtimeId !== undefined),
    'RUNTIME_OUTPUT_SOURCE_REQUIRED', 'Choose one original operation or one registered runtime.');
  if (input.operationId !== undefined) {
    operationId(input.operationId);
    need(input.logFile === undefined, 'RUNTIME_OUTPUT_SOURCE_INVALID');
  } else {
    recordId(input.runtimeId);
    if (input.logFile !== undefined)
      need(typeof input.logFile === 'string' && INSTALL_LOG.test(input.logFile), 'RUNTIME_OUTPUT_INSTALL_LOG_INVALID');
  }
}
async function runtime(root, id) {
  const value = await currentRuntimeEntry(root, await readJSON(join(root, 'entries', recordId(id) + '.json')));
  need(value.id === id && typeof value.directory === 'string', 'RUNTIME_WORKSPACE_ENTRY_INVALID');
  await privateDirectory(value.directory);
  return value;
}
async function operation(root, id) {
  const directory = join(root, 'operations', operationId(id));
  await privateDirectory(directory);
  const request = await readJSON(join(directory, 'request.json'));
  need(plain(request) && typeof request.operation === 'string', 'RUNTIME_WORKSPACE_REQUEST_INVALID');
  return { directory, request };
}
async function observedFile(path, name) {
  try {
    const info = await lstat(path);
    need(info.isFile() && !info.isSymbolicLink() && Number.isSafeInteger(info.size), 'RUNTIME_OUTPUT_FILE_INVALID');
    return { logFile: name, available: true, bytes: info.size, modifiedAt: info.mtime.toISOString() };
  } catch (error) {
    return { logFile: name, available: false,
      state: error.code === 'ENOENT' ? 'NOT_CREATED' : 'UNAVAILABLE',
      error: { code: error.code ?? 'RUNTIME_OUTPUT_UNAVAILABLE', message: String(error.message).slice(0, 1000) } };
  }
}
// A filename identifies a retained attempt; only install-state.json supplies current phase.
function compareAttempts(a, b) {
  const left = BigInt(INSTALL_LOG.exec(a)[1]), right = BigInt(INSTALL_LOG.exec(b)[1]);
  return left === right ? b.localeCompare(a) : left > right ? -1 : 1;
}
export async function runtimeOutputSources(root, workspaceId, input = {}) {
  inputSelection(input, ['operationId', 'runtimeId', 'cursor', 'limit']);
  const limit = input.limit ?? 50;
  need(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'RUNTIME_OUTPUT_INVENTORY_LIMIT_INVALID');
  if (input.operationId !== undefined) {
    need(input.cursor === undefined, 'RUNTIME_OUTPUT_INVENTORY_CURSOR_INVALID');
    const { directory, request } = await operation(root, input.operationId);
    const candidateId = request.targetId ?? request.runtimeId;
    const related = typeof candidateId === 'string' && /^[a-f0-9]{24}$/.test(candidateId)
      ? await readJSON(join(root, 'entries', candidateId + '.json'), true) : null;
    return { schema: 'stellar-forge.runtime-output-sources.v1', workspaceId,
      operationId: input.operationId, operation: request.operation, createdAt: request.createdAt ?? null,
      relatedRuntimeId: related?.id === candidateId ? candidateId : null,
      sources: [{ sourceKind: 'operation', operationId: input.operationId,
        ...await observedFile(join(directory, 'worker.log'), 'worker.log') }], nextCursor: null };
  }
  const selected = await runtime(root, input.runtimeId);
  const state = await readJSON(join(selected.directory, 'install-state.json'), true);
  const currentLogFile = typeof state?.logFile === 'string' && INSTALL_LOG.test(state.logFile) ? state.logFile : null;
  const names = (await readdir(selected.directory)).filter(name => INSTALL_LOG.test(name)).sort(compareAttempts);
  let start = 0;
  if (input.cursor !== undefined) {
    need(typeof input.cursor === 'string' && INSTALL_LOG.test(input.cursor), 'RUNTIME_OUTPUT_INVENTORY_CURSOR_INVALID');
    const index = names.indexOf(input.cursor);
    need(index >= 0, 'RUNTIME_OUTPUT_INVENTORY_CHANGED', 'Refresh the retained attempt list; its previous last file has moved.', 409);
    start = index + 1;
  }
  const chosen = names.slice(start, start + limit), sources = [];
  for (const name of chosen) sources.push({
    sourceKind: 'npm-install', runtimeId: input.runtimeId, attempt: INSTALL_LOG.exec(name)[1],
    current: name === currentLogFile,
    phase: name === currentLogFile ? state.phase ?? null : null,
    ...await observedFile(join(selected.directory, name), name),
  });
  return { schema: 'stellar-forge.runtime-output-sources.v1', workspaceId,
    runtimeId: input.runtimeId, label: selected.label ?? input.runtimeId, currentLogFile,
    currentPhase: state?.phase ?? null, retainedAttempts: names.length, sources,
    nextCursor: start + chosen.length < names.length ? chosen.at(-1) : null };
}
async function source(root, workspaceId, input) {
  inputSelection(input);
  let identity, path, filename;
  if (input.operationId !== undefined) {
    const selected = await operation(root, input.operationId);
    identity = { workspaceId, sourceKind: 'operation', operationId: input.operationId };
    path = join(selected.directory, 'worker.log');
    filename = 'operation-' + input.operationId + '.log';
  } else {
    need(input.logFile !== undefined, 'RUNTIME_OUTPUT_INSTALL_LOG_REQUIRED',
      'Choose the exact retained npm attempt filename from the original runtime.');
    const selected = await runtime(root, input.runtimeId);
    identity = { workspaceId, sourceKind: 'npm-install', runtimeId: input.runtimeId, logFile: input.logFile };
    path = join(selected.directory, input.logFile);
    filename = 'runtime-' + input.runtimeId + '-' + input.logFile;
  }
  return { identity, path, filename, schema: 'stellar-forge.runtime-output-selection.v1',
    pageSchema: 'stellar-forge.runtime-output-page.v1', errorPrefix: 'RUNTIME_OUTPUT' };
}
export async function readRuntimeOutputPage(root, workspaceId, input = {}) {
  return readRetainedOutputPage(await source(root, workspaceId, input), input);
}
export async function openRuntimeOutputDownload(root, workspaceId, input = {}) {
  return openRetainedOutputDownload(await source(root, workspaceId, input), input);
}
