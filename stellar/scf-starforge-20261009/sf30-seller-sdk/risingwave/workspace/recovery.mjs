// MIT. Private, versioned browser workspaces alongside the original operating state.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory, readJson, atomicJson, bytes, digest, fault } from '../../postgres/publisher/files.mjs';
import { validateBrowserState, MAX_BROWSER_STATE_BYTES } from './public/recovery.mjs';
const SCHEMA = 'stellar-forge.risingwave-browser-workspace.v1';
const identifier = value => {
  if (typeof value !== 'string' || !/^browser-[a-z0-9-]{1,90}$/.test(value))
    throw fault('BROWSER_WORKSPACE_ID_INVALID');
  return value;
};
const copy = record => ({id: record.id, version: record.version, createdAt: record.createdAt, updatedAt: record.updatedAt,
  baseRevision: record.state.baseRevision, dirty: record.state.dirty || record.state.reportDirty,
  pendingOperations: record.state.journal.filter(entry => entry.state !== 'RETURNED').length,
  stateSha256: record.stateSha256});
export async function openBrowserWorkspaces(root, workspaceIdentity) {
  const directory = join(root, 'browser-workspaces');
  await privateDirectory(directory, true);
  async function read(selected) {
    const record = await readJson(join(directory, identifier(selected) + '.json'), MAX_BROWSER_STATE_BYTES * 2 + 16384);
    if (record.schema !== SCHEMA || record.id !== selected || !Number.isSafeInteger(record.version) || record.version < 1 ||
        record.stateSha256 !== digest(bytes(record.state)))
      throw fault('BROWSER_WORKSPACE_CHANGED');
    validateBrowserState(record.state, workspaceIdentity);
    return record;
  }
  async function list() {
    const names = (await readdir(directory)).filter(name => /^browser-[a-z0-9-]{1,90}\.json$/.test(name));
    const items = [];
    for (const name of names) items.push(copy(await read(name.slice(0, -5))));
    items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {workspaceIdentity, total: items.length, items};
  }
  // The original workbench mutation queue serializes this compare-and-save.
  async function save(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(name => !['id','expectedVersion','writeId','state'].includes(name)) ||
        !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 ||
        !/^draft-[a-z0-9-]{1,90}$/.test(input.writeId ?? ''))
      throw fault('BROWSER_WORKSPACE_INPUT_INVALID');
    identifier(input.id);
    const state = validateBrowserState(input.state, workspaceIdentity), stateSha256 = digest(bytes(state));
    const retained = await read(input.id).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (retained?.writeId === input.writeId) {
      if (retained.stateSha256 !== stateSha256) throw fault('BROWSER_WRITE_CHANGED', 'Continue this draft write with its original contents.', 409);
      return copy(retained);
    }
    if ((retained?.version ?? 0) !== input.expectedVersion)
      throw fault('BROWSER_VERSION_CHANGED', 'Another tab saved this browser workspace. Keep these edits as a new browser workspace or open the saved version.', 409);
    const now = new Date().toISOString(), record = {schema: SCHEMA, id: input.id,
      version: (retained?.version ?? 0) + 1, createdAt: retained?.createdAt ?? now, updatedAt: now,
      writeId: input.writeId, stateSha256, state};
    await atomicJson(directory, input.id + '.json', record);
    return copy(record);
  }
  return {read, list, save};
}
