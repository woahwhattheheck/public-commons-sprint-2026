// MIT. The existing Applications runner reads the original customer's private startup record.
import { join } from 'node:path';
import { readBytes, parseJson, absolute, object } from '../node/store.mjs';
import { canonicalDirectory, requireValue } from './state.mjs';

export const JOB_WORKSPACE_LAUNCH_SCHEMA = 'stellar-forge.sf88.job-workspace-launch.v1';
const DESTINATIONS = Object.freeze({
  request: 'intakeUrl', checkout: 'checkoutUrl', jobs: 'url', library: 'libraryUrl', collections: 'collectionsUrl',
});
export const JOB_WORKSPACE_APPLICATIONS = Object.freeze({
  schema: 'stellar-forge.sf88.job-workspace-applications.v1',
  launchSchema: JOB_WORKSPACE_LAUNCH_SCHEMA,
  landings: Object.freeze(Object.keys(DESTINATIONS)),
  approvalModes: Object.freeze(['browser', 'terminal']),
});
export const jobWorkspaceLaunchPath = directory => join(absolute(directory), 'job-workspace-launch.json');

export function jobWorkspaceEntryUrl(value, landing = 'request') {
  requireValue(typeof landing === 'string' && Object.hasOwn(DESTINATIONS, landing),
    'JOB_WORKSPACE_LANDING_INVALID');
  const selected = value?.[DESTINATIONS[landing]];
  requireValue(typeof selected === 'string' && selected.length > 0, 'JOB_WORKSPACE_LANDING_UNAVAILABLE');
  return selected;
}

export async function readJobWorkspaceLaunch({
  directory, runtimeDirectory, operatorWorkspace, operatorProfile, pid, approvalMode, landing,
} = {}) {
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
  requireValue(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    !url.username && !url.password && !url.search && url.pathname === '/jobs/' &&
    /^#[a-f0-9]{64}$/.test(url.hash) && value.url === url.href &&
    value.checkoutUrl === url.origin + '/jobs/checkout/' + url.hash &&
    value.libraryUrl === url.origin + '/' + url.hash &&
    value.collectionsUrl === url.origin + '/collections' + url.hash &&
    (value.intakeUrl === undefined || value.intakeUrl === url.origin + '/jobs/request/' + url.hash) &&
    (value.resolutionUrl === undefined || value.resolutionUrl === url.origin + '/jobs/resolutions/' + url.hash),
    'JOB_WORKSPACE_LAUNCH_URL_INVALID');
  // Earlier launch records remain readable without invented interface defaults.
  // A managed launch that selected the new interface must match all three fields.
  const hasInterface = ['approvalMode', 'landing', 'entryUrl'].some(name => Object.hasOwn(value, name));
  if (hasInterface) {
    requireValue(JOB_WORKSPACE_APPLICATIONS.approvalModes.includes(value.approvalMode) &&
      JOB_WORKSPACE_APPLICATIONS.landings.includes(value.landing) &&
      value.entryUrl === jobWorkspaceEntryUrl(value, value.landing), 'JOB_WORKSPACE_LAUNCH_INTERFACE_CHANGED', 409);
  }
  if (approvalMode !== undefined) requireValue(
    JOB_WORKSPACE_APPLICATIONS.approvalModes.includes(approvalMode) && value.approvalMode === approvalMode,
    'JOB_WORKSPACE_LAUNCH_APPROVAL_CHANGED', 409);
  if (landing !== undefined) requireValue(
    JOB_WORKSPACE_APPLICATIONS.landings.includes(landing) && value.landing === landing,
    'JOB_WORKSPACE_LAUNCH_LANDING_CHANGED', 409);
  return value;
}
