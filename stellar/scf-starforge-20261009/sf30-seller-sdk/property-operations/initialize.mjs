// MIT. Original merchant host setup for an attached Property Operations workspace.
import {mkdir,open,lstat,realpath,readFile} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {constants} from 'node:fs';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';
import {readPropertyWorkspaceConfiguration} from './provider.mjs';
import {canonical} from './propply.mjs';
const need=(v,message)=>{if(!v)throw Object.assign(new Error(message),{code:'PROPERTY_HOST_SETUP'});};
async function directory(path){try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||(s.mode&0o077)===0),'Use an original private host directory.');}
async function exactJSON(path,value){
  const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');let h;
  try{h=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){if(error.code!=='EEXIST')throw error;const old=await readFile(path);
    need(old.equals(raw),'The existing host setup differs. Preserve that original configuration.');return;}
  try{await h.writeFile(raw);await h.sync();}finally{await h.close();}
}
export async function initializePropertyWorkspaceMerchant({directory:input,connection,name='Property Operations',releaseStore}={}) {
  need(typeof input==='string'&&input&&typeof connection==='string'&&connection&&
    typeof name==='string'&&name.trim()&&name.length<=160&&!/[\x00-\x1f\x7f]/.test(name),'Supply the complete host directory, connection and name.');
  const root=resolve(input),file=resolve(connection),selected=await readPropertyWorkspaceConfiguration(file);
  await directory(root);const lease=await acquireStateLease(root);
  try{
    for(const item of Object.values(selected.workspaces)){
      const rel=relative(item.directory,root);
      need(rel!==''&&(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)),'Keep the attached host outside the native workspace.');
    }
    const expected={schema:'stellar-forge.property-host-setup.v1',directory:root,connection:file,name:name.trim(),
      releaseStore:releaseStore?resolve(releaseStore):join(root,'releases')};
    await exactJSON(join(root,'property-setup.json'),expected);
    const native=await import('../../sf82-seller-pilot/releases.mjs');
    if(releaseStore)await native.readReleaseState(expected.releaseStore);
    else await native.initReleaseStore(expected.releaseStore,{resume:true});
    await directory(join(root,'customer-exports'));
    const configuration=join(root,'merchant-mcp.json');
    await exactJSON(configuration,{schema:'stellar-forge.merchant-mcp.v1',name:expected.name,
      releaseStore:expected.releaseStore,exportsDirectory:'./customer-exports',sources:{},propertyWorkspaceConnection:file});
    lease.assertHeld();
    const {readMerchantConfig}=await import('../../../../stellar-forge/mcp-merchant-operator/config.mjs');
    const checked=await readMerchantConfig(configuration);
    need(checked.propertyWorkspaces,'The maintained host must load the source-owned Property provider.');
    return {schema:'stellar-forge.property-host-setup.v1',state:'READY',configuration,
      workspaces:Object.keys(selected.workspaces),files:Object.keys(selected.files),nativeOwnership:'BORROWED'};
  }finally{await lease.close();}
}
