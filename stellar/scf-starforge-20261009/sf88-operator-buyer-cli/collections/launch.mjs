// MIT. Original collection listener identity for installed Applications.
import { isAbsolute, resolve } from 'node:path';

export const COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA = 'stellar-forge.sf88.collections-workspace-launch.v1';

function privatePath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value === '/' ||
      resolve(value) !== value || value.includes('\0'))
    throw new TypeError('Select an absolute original collection workspace path');
  return value;
}
export function collectionsWorkspaceSelection({ directory, queueRoot, approvalMode = 'BROWSER' }) {
  if (!['BROWSER', 'TERMINAL'].includes(approvalMode))
    throw new TypeError('Select the original browser or terminal approval mode');
  return { directory: privatePath(directory), queueRoot: privatePath(queueRoot), approvalMode };
}
export function collectionsWorkspaceUrl(value, selectedPort = 0) {
  try {
    if (typeof value !== 'string' || value.length > 4096 ||
        !Number.isInteger(selectedPort) || selectedPort < 0 || selectedPort > 65535) return null;
    const url = new URL(value), actualPort = Number(url.port || 80);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        actualPort < 1 || actualPort > 65535 || url.username || url.password ||
        url.pathname !== '/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash) ||
        selectedPort !== 0 && selectedPort !== actualPort) return null;
    return url.href;
  } catch { return null; }
}
export function collectionsWorkspaceLaunch(settings, url, pid = process.pid) {
  const selection = collectionsWorkspaceSelection(settings);
  const address = collectionsWorkspaceUrl(url);
  if (!address || !Number.isSafeInteger(pid) || pid < 1)
    throw new TypeError('The original collection listener is not ready');
  return { schema: COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA, state: 'LISTENING',
    ...selection, pid, url: address };
}
export function matchCollectionsWorkspaceLaunch(value, expected, port = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schema !== COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA || value.state !== 'LISTENING' ||
      !Number.isSafeInteger(value.pid) || value.pid < 1 ||
      ['directory', 'queueRoot', 'approvalMode'].some(key => value[key] !== expected[key]))
    return null;
  return collectionsWorkspaceUrl(value.url, port);
}
