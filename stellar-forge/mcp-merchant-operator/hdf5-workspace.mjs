// MIT. One HDF5 source process and original dataset publisher per configured workspace.
import {dirname,resolve,join} from 'node:path';
import {lstat,mkdir,readdir} from 'node:fs/promises';
import {read,only,id,privateDirectory,exact,json,fail} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/hdf5/custody.mjs';
import {Hdf5Workbench} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/hdf5/controller.mjs';
import {HDF5_TOOL_ACTIONS} from './catalog/hdf5-workspace.mjs';

export const HDF5_CONNECTION_SCHEMA='stellar-forge.hdf5-workspace-connection.v1';
export async function readHdf5WorkspaceConfiguration(path){
  path=resolve(path);const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||process.platform!=='win32'&&(info.mode&0o077||info.uid!==process.getuid()))fail('Use a private original HDF5 connection file.','CONFIGURATION_ERROR');
  const raw=JSON.parse(await read(path,1024*1024));only(raw,['schema','workspaces']);
  if(raw.schema!==HDF5_CONNECTION_SCHEMA||!raw.workspaces||Array.isArray(raw.workspaces)||typeof raw.workspaces!=='object'||Object.keys(raw.workspaces).length>16)fail('Expected at most16 configured HDF5 workspaces.','CONFIGURATION_ERROR');
  const workspaces=Object.create(null),base=dirname(path),directories=new Set();
  for(const [key,value] of Object.entries(raw.workspaces)){
    id(key);only(value,['label','directory','python','inputRoots','buyerWorkspace']);
    if(typeof value.directory!=='string'||!value.directory||typeof value.label!=='string'||!value.label.trim()||value.label.length>160)fail('Supply an original private directory and label.','CONFIGURATION_ERROR');
    const directory=resolve(base,value.directory);await privateDirectory(directory);
    if(directories.has(directory))fail('Each HDF5 workspace has one native owner.','CONFIGURATION_ERROR');directories.add(directory);
    if(value.python!==undefined&&(typeof value.python!=='string'||!value.python||value.python.includes('\0')))fail('Select an existing Python executable.','CONFIGURATION_ERROR');
    if(value.inputRoots!==undefined&&(!Array.isArray(value.inputRoots)||value.inputRoots.length>16||value.inputRoots.some(item=>typeof item!=='string')))fail('Declare up to16 original input roots.','CONFIGURATION_ERROR');
    const inputRoots=await Promise.all((value.inputRoots??[]).map(root=>privateDirectory(resolve(base,root))));
    const buyerWorkspace=value.buyerWorkspace===undefined?undefined:await privateDirectory(resolve(base,value.buyerWorkspace));
    workspaces[key]={label:value.label,directory,python:value.python??'python3',inputRoots,...(buyerWorkspace?{buyerWorkspace}:{})};
  }
  return {schema:raw.schema,workspaces};
}
export class MerchantHdf5Workspaces {
  constructor(config){this.configuration=config.hdf5Workspaces;this.instances=new Map();this.closing=null;this.draining=false;}
  get summary(){return {workspaces:Object.entries(this.configuration.workspaces).map(([workspace,value])=>({workspace,label:value.label,opened:this.instances.has(workspace)}))};}
  async call(name,args={}){
    if(this.draining)fail('HDF5 provider is draining.','HDF5_CLOSING',409);
    if(name==='merchant_hdf5_workspaces'){only(args,[]);return this.summary;}
    const action=HDF5_TOOL_ACTIONS[name];if(!action)fail('Unknown HDF5 tool.','INVALID_PARAMS');
    const {workspace,...payload}=args,selected=this.configuration.workspaces[id(workspace)];
    if(!selected)fail('Choose a host-configured HDF5 workspace.','HDF5_WORKSPACE_NOT_FOUND',404);
    let instance=this.instances.get(workspace);
    if(!instance){instance=new Hdf5Workbench(selected);this.instances.set(workspace,instance);}
    return instance.call(action,payload);
  }
  close(){
    this.draining=true;
    if(this.closing)return this.closing;
    const pending=(async()=>{
      const outcomes=await Promise.allSettled([...this.instances.values()].map(instance=>instance.close()));
      const failures=outcomes.filter(item=>item.status==='rejected');
      if(failures.length)throw new AggregateError(failures.map(item=>item.reason),'HDF5 owned workspace shutdown is incomplete.');
    })();
    this.closing=pending;void pending.catch(()=>{if(this.closing===pending)this.closing=null;});return pending;
  }
}
export async function initializeHdf5Merchant({directory,connection,name='HDF5 array workspaces'}={}){
  const root=resolve(directory),connectionPath=resolve(connection);const selected=await readHdf5WorkspaceConfiguration(connectionPath);
  if(typeof name!=='string'||!name.trim()||name.length>240)fail('Use a printable merchant name.');
  const intent={schema:'stellar-forge.hdf5-merchant-setup.v1',directory:root,connection:connectionPath,name};
  try{await mkdir(root,{mode:0o700});}catch(error){
    if(error.code!=='EEXIST')throw error;await privateDirectory(root);
    const entries=await readdir(root);if(entries.length&&!entries.includes('hdf5-setup.json'))fail('This directory is not the original HDF5 setup.','HDF5_SETUP_CONFLICT',409);
  }
  await privateDirectory(root,{create:true});
  await exact(join(root,'hdf5-setup.json'),json(intent));
  const releases=await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
  try{await lstat(join(root,'releases','state.json'));await releases.readReleaseState(join(root,'releases'));}
  catch(error){if(error.code!=='ENOENT')throw error;await releases.initReleaseStore(join(root,'releases'));}
  await privateDirectory(join(root,'customer-exports'),{create:true});
  const {CONFIG_SCHEMA,readMerchantConfig}=await import('./config.mjs');
  const configuration=join(root,'merchant-mcp.json');
  await exact(configuration,json({schema:CONFIG_SCHEMA,name,releaseStore:'./releases',exportsDirectory:'./customer-exports',sources:{},hdf5WorkspaceConnection:connectionPath}));
  await readMerchantConfig(configuration);
  return {schema:CONFIG_SCHEMA,configuration,state:'INITIALIZED',workspaces:Object.keys(selected.workspaces)};
}
