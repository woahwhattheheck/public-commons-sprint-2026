// MIT. Host-only setup joins the existing Snowflake seller store and merchant host.
import { mkdir, lstat, realpath, mkdtemp, rename, rm, open } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { canonical, boundedFile } from '../../../sf46-release/release-core.mjs';
import { readReleaseState, initReleaseStore } from '../../../sf82-seller-pilot/releases.mjs';
import { CONFIG_SCHEMA, readMerchantConfig } from '../../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { line, writePrivate, privateSupportDirectory } from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { readSnowflakeWorkspaceConfiguration } from './runtime.mjs';
import { alias, fail } from './files.mjs';

/** Existing native workspaces remain the sole owners of capture and merchant terms. */
export async function initializeSnowflakeWorkspaceMerchant({
  directory, connection, workspace, name = 'Starforge Snowflake operator',
} = {}) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
      typeof connection !== 'string' || !connection || connection.includes('\0'))
    throw fail('CONFIGURATION_INVALID', 'Select a new private merchant directory and the original connection file.');
  const root = resolve(directory), snowflakeWorkspaceConnection = resolve(connection);
  name = line(name, 'Merchant name');
  const selected = await readSnowflakeWorkspaceConfiguration(snowflakeWorkspaceConnection);
  const names = Object.keys(selected.workspaces);
  workspace ??= names.length === 1 ? names[0] : undefined;
  alias(workspace);
  const primary = selected.workspaces[workspace];
  if (!primary) throw fail('CONFIGURATION_INVALID', 'Choose the original workspace whose seller store the common merchant controls.');
  if (Object.values(selected.workspaces).some(item => item.directory === root))
    throw fail('CONFIGURATION_INVALID', 'The merchant host needs its own configuration directory.');
  const releaseStore = join(primary.directory, 'release-store'), configuration = join(root, 'merchant-mcp.json');
  const raw = { schema: CONFIG_SCHEMA, name, releaseStore, exportsDirectory: './customer-exports',
    sources: {}, snowflakeWorkspaceConnection };
  const result = async reused => {
    await readMerchantConfig(configuration);
    return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', reused,
      snowflakeWorkspacesConfigured: true, primarySellerWorkspace: workspace, releaseStore,
      workspaces: Object.entries(selected.workspaces).map(([workspace, value]) =>
        ({ workspace, label: value.label, workspaceId: value.workspaceId })),
      ownership: 'ORIGINAL_SNOWFLAKE_WORKSPACE' };
  };
  let exists = true;
  try { await lstat(root); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
  if (exists) {
    await privateSupportDirectory(root);
    if (await realpath(root) !== root) throw fail('CONFIGURATION_INVALID', 'Use the original canonical merchant directory.');
    const prior = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      await boundedFile(root, 'merchant-mcp.json', 1048576)));
    if (canonical(prior) !== canonical(raw)) throw fail('CONFIGURATION_CHANGED', 'This directory already belongs to a different original merchant configuration.');
    return result(true);
  }
  const parent = dirname(root);
  if (await realpath(parent) !== parent) throw fail('CONFIGURATION_INVALID', 'Use an existing canonical parent directory.');
  try { await readReleaseState(releaseStore); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await initReleaseStore(releaseStore); }
    catch (created) { if (created.code !== 'EEXIST') throw created; await readReleaseState(releaseStore); }
  }
  const temporary = await mkdtemp(join(parent, '.snowflake-merchant-'));
  try {
    await mkdir(join(temporary, 'customer-exports'), { mode: 0o700 });
    await writePrivate(join(temporary, 'merchant-mcp.json'), raw);
    await readMerchantConfig(join(temporary, 'merchant-mcp.json'));
    await rename(temporary, root);
    const handle = await open(parent, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    return result(false);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
