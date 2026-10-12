// MIT. Private original workspace connection record for installed clients.
import { resolve, dirname, basename } from 'node:path';
import { privateDirectory, readPrivateJson, atomicJson, withPrivateLock } from '../routescan/quota.mjs';
import { digest } from './source.mjs';
import { need } from './model.mjs';

export async function retainFredWorkspaceConnection(path, startup) {
  need(typeof path === 'string' && path.length > 0, 'Choose a private connection file.');
  need(startup?.schema === 'stellar-forge.fred-workspace-startup.v1' && startup.state === 'LISTENING' &&
    startup.binding?.schema === 'stellar-forge.fred-workspace-binding.v1' && typeof startup.url === 'string',
    'Retain the complete original running workspace record.');
  const { sha256, ...binding } = startup.binding;
  need(sha256 === digest(binding), 'The original workspace binding changed.');
  const url = new URL(startup.url);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && !url.username && !url.password &&
    url.pathname === '/' && !url.search && /^#[a-f0-9]{64}$/.test(url.hash),
    'Retain the unchanged original workspace session URL.');
  const destination = resolve(path), directory = await privateDirectory(dirname(destination)), name = basename(destination);
  await withPrivateLock(directory, name + '.lock', async () => {
    let previous;
    try { previous = await readPrivateJson(destination, 65536); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    need(!previous || previous.schema === startup.schema && previous.binding?.projectId === startup.binding.projectId,
      'This connection file belongs to another original project.', 'FRED_CONNECTION_PROJECT_CHANGED', 409);
    await atomicJson(directory, name, startup);
  });
  return { path: destination, projectId: binding.projectId, bindingSha256: sha256, instanceId: startup.instanceId };
}
