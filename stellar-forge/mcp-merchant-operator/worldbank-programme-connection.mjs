// MIT. Host-owned aliases for the existing private Analysis owner.
import { dirname, resolve } from 'node:path';
import { readWorkflowSeriesPrivateFile } from './workflow-series-connection.mjs';
import { WORLDBANK_ALIAS, WORLDBANK_NAME, WORLDBANK_ID, plain, worldBankNeed as need } from './worldbank-programme-contracts.mjs';
export const WORLDBANK_CONNECTION_SCHEMA = 'stellar-forge.worldbank-programme-connection.v1';
export async function readWorldBankProgrammeConfiguration(path) {
  path = resolve(path);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readWorkflowSeriesPrivateFile(path)));
  need(plain(value) && value.schema === WORLDBANK_CONNECTION_SCHEMA &&
    Object.keys(value).every(key => ['schema', 'workspaces'].includes(key)) && plain(value.workspaces) &&
    Object.keys(value.workspaces).length > 0 && Object.keys(value.workspaces).length <= 100,
    'Declare the original private Analysis workspace connections.');
  const workspaces = Object.create(null);
  for (const [alias, entry] of Object.entries(value.workspaces)) {
    need(WORLDBANK_ALIAS.test(alias) && plain(entry) &&
      Object.keys(entry).every(key => ['label', 'workspaceId', 'launchFile', 'programmes'].includes(key)) &&
      typeof entry.label === 'string' && entry.label.trim() && entry.label.length <= 160 &&
      typeof entry.workspaceId === 'string' && WORLDBANK_ID.test(entry.workspaceId) &&
      typeof entry.launchFile === 'string' && entry.launchFile.length > 0 && entry.launchFile.length <= 4000 &&
      !/[\x00-\x1f]/.test(entry.launchFile) && Array.isArray(entry.programmes) && entry.programmes.length > 0 &&
      entry.programmes.length <= 1000 && new Set(entry.programmes).size === entry.programmes.length &&
      entry.programmes.every(name => typeof name === 'string' && WORLDBANK_NAME.test(name) && name !== 'sources'),
      'Declare each readable label, exact native workspace ID, private launch file and allowed programme names.');
    workspaces[alias] = { label: entry.label, workspaceId: entry.workspaceId,
      launchFile: resolve(dirname(path), entry.launchFile), programmes: [...entry.programmes] };
  }
  return { schema: WORLDBANK_CONNECTION_SCHEMA, workspaces };
}
