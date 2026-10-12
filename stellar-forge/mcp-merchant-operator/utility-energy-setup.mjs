// MIT. Host setup for the original Utility console borrower.
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { exact, line, writePrivate, failure } from './host-files.mjs';
import { readUtilityEnergyWorkspaceConfiguration } from './utility-energy-workspace.mjs';
const SCHEMA = 'stellar-forge.merchant-mcp.v1';

/** Initializes the existing merchant host and binds only declared original console/file handles. */
export async function initializeUtilityEnergyMerchant(options = {}) {
  exact(options,['directory','connection','name','releaseStore'],['directory','connection']);
  const {directory,connection,name = 'Starforge utility operations',releaseStore} = options;
  for (const value of [directory,connection,...(releaseStore === undefined ? [] : [releaseStore])])
    if (typeof value !== 'string' || !value || value.includes('\0'))
      throw failure('CONFIGURATION_ERROR','Choose original host directory and connection references.');
  const root = resolve(directory), utilityEnergyWorkspaceConnection = resolve(connection);
  const configured = await readUtilityEnergyWorkspaceConfiguration(utilityEnergyWorkspaceConnection);
  const selectedStore = releaseStore === undefined ? join(root,'releases') : resolve(releaseStore);
  const native = await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
  if (releaseStore !== undefined) await native.readReleaseState(selectedStore);
  await mkdir(root,{mode:0o700});
  if (releaseStore === undefined) await native.initReleaseStore(selectedStore);
  await mkdir(join(root,'customer-exports'),{mode:0o700});
  const configuration = join(root,'merchant-mcp.json');
  await writePrivate(configuration,{schema:SCHEMA,name:line(name,'Merchant name'),releaseStore:selectedStore,
    exportsDirectory:'./customer-exports',sources:{},utilityEnergyWorkspaceConnection});
  await (await import('./config.mjs')).readMerchantConfig(configuration);
  return {schema:SCHEMA,configuration,state:'INITIALIZED',utilityEnergyWorkspacesConfigured:true,
    workspaces:Object.entries(configured.workspaces).map(([workspace,value]) => ({workspace,label:value.label})),
    ownership:'EXISTING_UTILITY_CONSOLE'};
}
