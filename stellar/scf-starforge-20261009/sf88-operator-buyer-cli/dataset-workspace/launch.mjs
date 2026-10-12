// MIT. Original dataset customer's optional structured CLI announcement.
import { isAbsolute, resolve } from 'node:path';

export const DATASET_WORKSPACE_LAUNCH_SCHEMA = 'stellar-forge.sf88.dataset-workspace-launch.v1';
function path(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0'))
    throw new TypeError('Select an absolute original dataset workspace path');
  return resolve(value);
}
export function datasetWorkspaceSelection({ stateDirectory, profilePath = null, operatorSettings = null, analysis = null }) {
  return { stateDirectory: path(stateDirectory), profilePath: profilePath === null ? null : path(profilePath),
    operatorSettings: operatorSettings === null ? null : path(operatorSettings),
    analysis: analysis === null ? null : { python: analysis.python === 'python3' ? 'python3' : path(analysis.python),
      checkout: path(analysis.checkout), directory: path(analysis.directory) } };
}
export function datasetWorkspaceUrl(value, port = 0) {
  try {
    const url = new URL(value);
    if (typeof value !== 'string' || value.length > 4096 || url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' || !url.port || url.username || url.password ||
        url.pathname !== '/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash) ||
        port && Number(url.port) !== port) return null;
    return url.href;
  } catch { return null; }
}
export function datasetWorkspaceLaunch(settings, url, pid = process.pid) {
  const selected = datasetWorkspaceSelection(settings), privateUrl = datasetWorkspaceUrl(url);
  if (!privateUrl || !Number.isSafeInteger(pid) || pid < 1)
    throw new TypeError('The original dataset listener is not ready');
  return { schema: DATASET_WORKSPACE_LAUNCH_SCHEMA, state: 'LISTENING', ...selected, pid, url: privateUrl };
}
export function matchDatasetWorkspaceLaunch(value, expected, port = 0) {
  if (!value || value.schema !== DATASET_WORKSPACE_LAUNCH_SCHEMA || value.state !== 'LISTENING' ||
      !Number.isSafeInteger(value.pid) || value.pid < 1 ||
      ['stateDirectory', 'profilePath', 'operatorSettings'].some(key => value[key] !== expected[key])) return null;
  if (expected.analysis === null) { if (value.analysis !== null) return null; }
  else if (!value.analysis || ['python', 'checkout', 'directory'].some(key => value.analysis[key] !== expected.analysis[key])) return null;
  return datasetWorkspaceUrl(value.url, port);
}

