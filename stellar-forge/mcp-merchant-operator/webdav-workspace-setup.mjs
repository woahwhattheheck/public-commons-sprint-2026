// MIT. Reuse the original WebDAV host initializer and maintained host registration.
import { resolve } from 'node:path';
import { initializeWebDavWorkspaceMerchant, readMerchantConfig } from './config.mjs';
import { readWebDavWorkspaceConfiguration } from './webdav-tools.mjs';
import { createMerchantMcpClientConfiguration } from './client-config.mjs';
export { initializeWebDavWorkspaceMerchant, readWebDavWorkspaceConfiguration };
export async function prepareWebDavMerchantHost({
  directory, connection, name = 'Starforge WebDAV operator', hostName = 'starforge-webdav',
  nodePath, entryPath, existingConfiguration
} = {}) {
  if (typeof directory !== 'string' || !directory || typeof connection !== 'string' || !connection)
    throw Object.assign(new Error('Choose a new private merchant directory and the original connection file.'), { code: 'CONFIGURATION_ERROR' });
  const host = createMerchantMcpClientConfiguration({ configPath: resolve(directory, 'merchant-mcp.json'),
    name: hostName, nodePath, entryPath, existingConfiguration });
  const initialized = await initializeWebDavWorkspaceMerchant({
    directory: resolve(directory), connection: resolve(connection), name
  });
  await readMerchantConfig(initialized.configuration);
  return { ...initialized, hostConfiguration: host };
}
