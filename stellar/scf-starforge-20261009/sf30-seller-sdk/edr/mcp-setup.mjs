// MIT. Configure the original merchant host to borrow saved EDR operators.
import { mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { CONFIG_SCHEMA, readMerchantConfig, line, writePrivate } from '../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { readEdrConfiguration, readHostFile, privateDirectory, canonical, failure } from './mcp-client.mjs';
import { initReleaseStore, readReleaseState } from '../../sf82-seller-pilot/releases.mjs';

async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
export async function initializeEdrMerchant({ directory, connection, name = 'Starforge EDR coverage queries' }) {
  if (typeof directory !== 'string' || !directory || typeof connection !== 'string' || !connection)
    throw failure('CONFIG_INVALID', 'Supply the merchant directory and original EDR connection file.');
  const root = resolve(directory), edrWorkspaceConnection = resolve(connection);
  name = line(name, 'Merchant name');
  const selected = await readEdrConfiguration(edrWorkspaceConnection);
  const configuration = join(root, 'merchant-mcp.json');
  const expected = { schema: CONFIG_SCHEMA, name, releaseStore: './releases', exportsDirectory: './customer-exports',
    sources: {}, edrWorkspaceConnection };
  if (await exists(configuration)) {
    const current = JSON.parse((await readHostFile(configuration, 1024 * 1024, { privateFile: true })).toString('utf8'));
    if (canonical(current) !== canonical(expected)) throw failure('CONFIG_CHANGED', 'This merchant directory retains a different original configuration.');
    await readMerchantConfig(configuration);
    return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', reused: true, workspaces: Object.keys(selected.workspaces) };
  }
  await mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await privateDirectory(root);
  const requestPath = join(root, 'edr-setup-request.json'), request = { schema: 'stellar-forge.edr-merchant-setup.v1',
    directory: root, connection: edrWorkspaceConnection, name };
  if (await exists(requestPath)) {
    const prior = JSON.parse((await readHostFile(requestPath, 16384, { privateFile: true })).toString('utf8'));
    if (canonical(prior) !== canonical(request)) throw failure('CONFIG_CHANGED', 'Continue the exact original EDR setup request.');
  } else await writePrivate(requestPath, request);
  if (await exists(join(root, 'releases'))) await readReleaseState(join(root, 'releases'));
  else await initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await privateDirectory(join(root, 'customer-exports'));
  await writePrivate(configuration, expected); await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', reused: false,
    workspaces: Object.entries(selected.workspaces).map(([workspace, value]) => ({ workspace, label: value.label })),
    hostOwnership: 'ORIGINAL_EDR_WORKSPACE' };
}
