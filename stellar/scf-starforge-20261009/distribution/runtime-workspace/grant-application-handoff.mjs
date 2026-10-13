// MIT. Applications HTTP presentation over the complete native Grant handoff.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { makePrivate, privateDirectory, operationId, readJSON, need, plain } from './storage.mjs';
import {
  GRANT_HANDOFF_MAX_BYTES, GRANT_HANDOFF_OPERATION_SCHEMA,
  inspectGrantHandoff, exportGrantHandoff, prepareGrantHandoff, receiveGrantHandoff,
  saveGrantHandoffApplication, grantHandoffStatus, grantHandoffCases, grantHandoffDownload,
} from '../../../../products/grant-operations/handoff.mjs';

export const GRANT_HANDOFF_BROWSER_ACTIONS = Object.freeze({
  list: ['cursor'], cases: ['applicationId', 'allowStart'], inspect: ['packageText'],
  export: ['id', 'applicationId', 'caseId', 'expectedVersion', 'name', 'allowStart'],
  prepare: ['id', 'packageText', 'caseBase64', 'caseFilename', 'bindingsValue'], status: ['id'], resume: ['id'],
  receive: ['id'], save: ['id'], download: ['id'],
});
export const grantHandoffBodyLimit = action =>
  ['inspect', 'prepare'].includes(action) ? 2 * GRANT_HANDOFF_MAX_BYTES + 65536 : 65536;

async function browserRoot(model) {
  const root = join(model.directory, 'grant-application-handoffs');
  try { await makePrivate(root); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(root);
  return root;
}
async function operation(model, id) { return join(await browserRoot(model), operationId(id)); }
function summary(id, record) {
  need(record?.schema === GRANT_HANDOFF_OPERATION_SCHEMA && record.id === id, 'GRANT_HANDOFF_OPERATION_INVALID');
  return { id, direction: record.direction, phase: record.phase, createdAt: record.createdAt,
    updatedAt: record.updatedAt, name: record.package?.name ?? record.name,
    case: record.originalCase, receivingCaseId: record.imported?.result?.id ?? null,
    applicationId: record.application?.result?.applicationId ?? record.selection?.application?.id ?? null,
    workspaceDirectory: record.selection?.bindings?.settings?.workspaceDirectory ??
      record.selection?.application?.settings?.workspaceDirectory,
    lastError: record.lastError ?? null };
}
async function list(model, cursor = null) {
  if (cursor !== null && cursor !== undefined) operationId(cursor);
  const root = await browserRoot(model);
  const names = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).filter(name => {
      try { operationId(name); return true; } catch { return false; }
    }).sort().reverse().filter(name => !cursor || name < cursor);
  const entries = [];
  let last = null, visited = 0;
  for (const id of names) {
    if (entries.length === 20) break;
    last = id; visited++;
    try {
      const record = await readJSON(join(root, id, 'handoff', 'operation.json'), true);
      if (record) entries.push(summary(id, record));
    } catch (error) {
      entries.push({ id, phase: 'UNAVAILABLE', name: id,
        lastError: { code: error.code ?? 'GRANT_HANDOFF_ERROR', message: String(error.message ?? error) } });
    }
  }
  return { workspaceId: (await model.state()).workspaceId, entries, nextCursor: visited < names.length ? last : null };
}
export async function grantHandoffBrowserAction(model, action, input = {}) {
  need(Object.hasOwn(GRANT_HANDOFF_BROWSER_ACTIONS, action) && plain(input) &&
    Object.keys(input).every(key => GRANT_HANDOFF_BROWSER_ACTIONS[action].includes(key)),
  'GRANT_HANDOFF_INPUT_INVALID');
  if (action === 'list') return list(model, input.cursor);
  if (action === 'cases') return grantHandoffCases(model, input);
  if (action === 'inspect') return inspectGrantHandoff({ packageText: input.packageText });
  const path = await operation(model, input.id);
  if (action === 'export') return exportGrantHandoff(model, { operation: path,
    applicationId: input.applicationId, caseId: input.caseId, expectedVersion: input.expectedVersion,
    name: input.name, allowStart: input.allowStart === true, requestId: input.id });
  if (action === 'prepare') return prepareGrantHandoff(model, { operation: path,
    packageText: input.packageText ?? null, caseBase64: input.caseBase64 ?? null, caseFilename: input.caseFilename ?? null,
    bindingsValue: input.bindingsValue ?? null, requestId: input.id });
  if (action === 'status') return grantHandoffStatus({ operation: path });
  if (action === 'receive') return receiveGrantHandoff(model, { operation: path });
  if (action === 'save') return saveGrantHandoffApplication(model, { operation: path });
  if (action === 'download') return grantHandoffDownload({ operation: path });
  const current = await grantHandoffStatus({ operation: path });
  if (current.direction === 'EXPORT') return exportGrantHandoff(model, { operation: path });
  if (current.phase === 'PREPARED' || current.phase === 'CASE_RECEIVED')
    return receiveGrantHandoff(model, { operation: path });
  return current;
}
