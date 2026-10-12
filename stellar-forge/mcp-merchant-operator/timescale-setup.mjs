// MIT. Host-only binding of existing Timescale projects to the original merchant publisher.
import { lstat, realpath, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { exact, failure, fileBytes, identifier, line, plain, writePrivate } from './host-files.mjs';

export const TIMESCALE_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.timescale-workspace-connection.v1';

export async function readTimescaleWorkspaceConfiguration(path, { publishers } = {}) {
  path = resolve(path);
  const observed = await lstat(path);
  if (!observed.isFile() || observed.isSymbolicLink() || await realpath(path) !== path ||
      observed.size > 1048576 || process.platform !== 'win32' &&
      ((observed.mode & 0o077) || process.getuid && observed.uid !== process.getuid()))
    throw failure('CONFIGURATION_ERROR', 'Use an owned private Timescale connection JSON file up to one MiB.');
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(path, 1048576)));
  exact(raw, ['schema','workspaces'], ['schema','workspaces']);
  if (raw.schema !== TIMESCALE_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare one to 32 original Timescale workspace aliases.');
  const workspaces = Object.create(null), used = new Set();
  for (const [workspace, input] of Object.entries(raw.workspaces)) {
    identifier(workspace, 'Timescale workspace alias');
    exact(input, ['label','publisher'], ['publisher']);
    const publisher = identifier(input.publisher, 'Publisher alias'), original = publishers?.workspaces?.[publisher];
    if (!original || original.kind !== 'timescale' || used.has(publisher))
      throw failure('CONFIGURATION_ERROR', 'Bind each Timescale workspace to one distinct publisher alias of kind timescale.');
    used.add(publisher);
    workspaces[workspace] = { label: line(input.label ?? workspace, 'Timescale workspace label'),
      publisher, workspaceId: original.workspaceId, directory: original.directory };
  }
  return { workspaces };
}

export async function initializeTimescaleWorkspaceMerchant({ directory, publishers, connection, releaseStore,
  name = 'Starforge Timescale merchant' }) {
  if (!publishers || !connection || !directory)
    throw failure('CONFIGURATION_ERROR', 'Supply the original publisher connection, Timescale connection and new merchant directory.');
  const {readPublisherConfiguration,readMerchantConfig,CONFIG_SCHEMA}=await import('./config.mjs');
  const root=resolve(directory),publisherConnection=resolve(publishers),timescaleWorkspaceConnection=resolve(connection);
  name=line(name,'Merchant name');
  const selectedPublishers=await readPublisherConfiguration(publisherConnection);
  const selected=await readTimescaleWorkspaceConfiguration(timescaleWorkspaceConnection,{publishers:selectedPublishers});
  for(const value of Object.values(selected.workspaces))
    if(root===value.directory||root.startsWith(value.directory+'/'))
      throw failure('CONFIGURATION_ERROR','Create the merchant host and its export directory beside the original Timescale project.');
  const {readReleaseState,initReleaseStore}=await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
  const selectedStore=releaseStore===undefined?join(root,'releases'):resolve(releaseStore);
  if(releaseStore!==undefined)await readReleaseState(selectedStore);
  await mkdir(root,{mode:0o700});
  if(releaseStore===undefined)await initReleaseStore(selectedStore);
  await mkdir(join(root,'customer-exports'),{mode:0o700});
  const configuration=join(root,'merchant-mcp.json');
  await writePrivate(configuration,{schema:CONFIG_SCHEMA,name,releaseStore:selectedStore,exportsDirectory:'./customer-exports',
    sources:{},publisherConnection,timescaleWorkspaceConnection});
  await readMerchantConfig(configuration);
  return{schema:CONFIG_SCHEMA,state:'INITIALIZED',configuration,workspaces:Object.entries(selected.workspaces).map(([workspace,value])=>
    ({workspace,label:value.label,publisher:value.publisher,workspaceId:value.workspaceId}))};
}
