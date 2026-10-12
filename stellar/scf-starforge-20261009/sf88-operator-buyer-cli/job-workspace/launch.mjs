// MIT. The existing Applications runner reads the original customer's private startup record.
import { join } from 'node:path';
import { readBytes, parseJson, absolute, object } from '../node/store.mjs';
import { canonicalDirectory, requireValue } from './state.mjs';

export const JOB_WORKSPACE_LAUNCH_SCHEMA = 'stellar-forge.sf88.job-workspace-launch.v1';
export const jobWorkspaceLaunchPath = directory => join(absolute(directory), 'job-workspace-launch.json');

export async function readJobWorkspaceLaunch({ directory, runtimeDirectory, operatorWorkspace, operatorProfile, pid } = {}) {
  directory = await canonicalDirectory(directory, { privateState: true });
  const value = parseJson(await readBytes(jobWorkspaceLaunchPath(directory)));
  requireValue(object(value) && value.schema === JOB_WORKSPACE_LAUNCH_SCHEMA &&
    value.state === 'LISTENING' && value.directory === directory &&
    value.runtimeDirectory === absolute(runtimeDirectory) &&
    Number.isSafeInteger(value.pid) && value.pid > 0 &&
    (pid === undefined || value.pid === pid) && /^[a-f0-9-]{36}$/.test(value.instanceId ?? ''),
    'JOB_WORKSPACE_LAUNCH_BINDING_CHANGED', 409);
  requireValue(!(operatorWorkspace !== undefined && operatorProfile !== undefined),
    'JOB_WORKSPACE_LAUNCH_OPERATOR_CONFLICT');
  if (operatorWorkspace !== undefined) requireValue(value.operatorSelection?.kind === 'workspace' &&
    value.operatorSelection.directory === absolute(operatorWorkspace), 'JOB_WORKSPACE_LAUNCH_OPERATOR_CHANGED', 409);
  if (operatorProfile !== undefined) requireValue(value.operatorSelection?.kind === 'profile' &&
    value.operatorSelection.path === absolute(operatorProfile), 'JOB_WORKSPACE_LAUNCH_OPERATOR_CHANGED', 409);
  requireValue(value.operatorSelection === null ||
    value.operatorSelection.runtimeDirectory === value.runtimeDirectory, 'JOB_WORKSPACE_LAUNCH_BINDING_CHANGED', 409);
  let url;
  try { url = new URL(value.url); } catch { requireValue(false, 'JOB_WORKSPACE_LAUNCH_URL_INVALID'); }
  requireValue(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port &&
    !url.username && !url.password && !url.search && url.pathname === '/jobs/' &&
    /^#[a-f0-9]{64}$/.test(url.hash) && value.url === url.href &&
    value.checkoutUrl === url.origin + '/jobs/checkout/' + url.hash &&
    value.libraryUrl === url.origin + '/' + url.hash &&
    value.collectionsUrl === url.origin + '/collections' + url.hash &&
    (value.intakeUrl === undefined || value.intakeUrl === url.origin + '/jobs/request/' + url.hash),
    'JOB_WORKSPACE_LAUNCH_URL_INVALID');
  return value;
}
