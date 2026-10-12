// MIT. Original project and operator selection for the GDELT workspace.
import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readPrivateJson } from '../routescan/quota.mjs';
import { readGdeltProject } from './project.mjs';
import { need, digest } from './model.mjs';

export const GDELT_WORKSPACE_BINDING = 'stellar-forge.gdelt-workspace-binding.v1';
export const GDELT_WORKSPACE_STARTUP = 'stellar-forge.gdelt-workspace-startup.v1';

async function originalDirectory(value) {
  need(typeof value === 'string' && value.length > 0, 'Select the original private GDELT project.');
  const directory = resolve(value), info = await lstat(directory);
  need(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 &&
    await realpath(directory) === directory, 'Use the canonical private project directory.', 'GDELT_PROJECT_DIRECTORY_CHANGED');
  return directory;
}
function facilitatorSelection(value, allowLocalFacilitator) {
  if (value === undefined || value === null || value === '') return null;
  let url;
  try { url = new URL(value); } catch { need(false, 'Select the configured facilitator URL.'); }
  need(!url.username && !url.password && !url.search && !url.hash &&
    (url.protocol === 'https:' || allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1'),
    'Use HTTPS for the facilitator, or explicitly allow its original local HTTP service.');
  return url.href;
}
export async function readGdeltWorkspaceLaunch({ directory, buyerConfig, facilitator,
  allowLocalFacilitator = false, merchantPort = 0, expectedBindingSha256 } = {}) {
  directory = await originalDirectory(directory);
  need(typeof allowLocalFacilitator === 'boolean', 'Select the local facilitator option explicitly.');
  need(Number.isInteger(merchantPort) && merchantPort >= 0 && merchantPort <= 65535,
    'Use an available merchant port.');
  const project = await readGdeltProject(directory);
  let buyerSettings = null, selectedBuyer = null;
  if (buyerConfig) {
    const path = resolve(buyerConfig);
    need(await realpath(path) === path, 'Use the original canonical buyer configuration path.');
    buyerSettings = await readPrivateJson(path, 65536);
    need(buyerSettings && typeof buyerSettings === 'object' && !Array.isArray(buyerSettings),
      'Select the original SF88 buyer configuration.');
    selectedBuyer = { path, settingsSha256: digest(buyerSettings) };
  }
  const original = { schema: GDELT_WORKSPACE_BINDING, directory, projectId: project.id,
    createdAt: project.createdAt, buyerConfig: selectedBuyer,
    facilitator: facilitatorSelection(facilitator, allowLocalFacilitator),
    allowLocalFacilitator, merchantPort };
  const binding = { ...original, sha256: digest(original) };
  if (expectedBindingSha256 !== undefined)
    need(/^[a-f0-9]{64}$/.test(expectedBindingSha256) && binding.sha256 === expectedBindingSha256,
      'Review the original project and buyer configuration before starting it.', 'GDELT_WORKSPACE_BINDING_CHANGED', 409);
  return { binding, buyerSettings };
}
export async function inspectGdeltWorkspaceBinding(options) {
  return (await readGdeltWorkspaceLaunch(options)).binding;
}
