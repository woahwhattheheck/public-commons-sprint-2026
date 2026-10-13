// MIT. Resumable source-owned merchant registration for the original Carbon customer workspace.
import {mkdir,lstat,readdir,rename,unlink,open,link,realpath} from 'node:fs/promises';
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {initReleaseStore,readReleaseState} from '../../sf82-seller-pilot/releases.mjs';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';
import {writePrivate,privateSupportDirectory,exact,line,plain,failure} from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';

const SCHEMA='stellar-forge.carbon-customer-mcp-setup.v1';
const MARKER='carbon-customer-setup.json';
const LIMIT=1024*1024;
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const STAGE=new RegExp('^carbon-customer-release-setup-'+UUID+'$');
const fail=(code,message)=>failure('CARBON_CUSTOMER_SETUP_'+code,message);
function need(ok,code,message){if(!ok)throw fail(code,message);}
function hostPath(value,base=process.cwd()){
 need(typeof value==='string'&&value.length>0&&!/[\x00-\x1f\x7f]/.test(value),'PATH_INVALID','Supply the original private host path.');
 return isAbsolute(value)?resolve(value):resolve(base,value);
}
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
 return value;
}
const fingerprint=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const digest=value=>createHash('sha256').update(value).digest('hex');
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDirectory(path){
 await privateSupportDirectory(path);
 const info=await lstat(path);
 need(await realpath(path)===path&&(typeof process.getuid!=='function'||info.uid===process.getuid()),
  'DIRECTORY_INVALID','Use the original canonical operator-owned private directory.');
 return path;
}
async function syncDirectory(path){
 // Windows does not expose the POSIX directory-fsync contract.
 if(process.platform==='win32')return;
 const file=await open(path,constants.O_RDONLY);
 try{await file.sync();}finally{await file.close();}
}
async function makeDirectory(path){
 try{await mkdir(path,{mode:0o700});await syncDirectory(dirname(path));}
 catch(error){if(error.code!=='EEXIST')throw error;}
 return privateDirectory(path);
}
async function originalJSON(path){
 const before=await lstat(path);
 need(before.isFile()&&!before.isSymbolicLink()&&before.size<=LIMIT&&
  (process.platform==='win32'||(before.mode&0o077)===0)&&
  (typeof process.getuid!=='function'||before.uid===process.getuid()),
  'SOURCE_INVALID','Use a complete operator-owned private JSON file of at most 1 MiB.');
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const first=await file.stat();
  need(first.isFile()&&first.dev===before.dev&&first.ino===before.ino&&first.size===before.size,
   'SOURCE_CHANGED','The original private file changed while opening.');
  const bytes=await file.readFile(),after=await file.stat(),current=await lstat(path);
  need(bytes.length<=LIMIT&&bytes.length===first.size&&
   ['dev','ino','size','mtimeMs','ctimeMs'].every(key=>first[key]===after[key])&&
   current.dev===after.dev&&current.ino===after.ino&&!current.isSymbolicLink(),
   'SOURCE_CHANGED','The original private file changed while reading.');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw fail('SOURCE_INVALID','Supply a complete UTF-8 JSON object.');}
  need(plain(value),'SOURCE_INVALID','Supply a complete JSON object.');
  return {value,sha256:digest(bytes)};
 }finally{await file.close();}
}
/** Publish a fully synced own stage without replacing a completed original file. */
async function writeOnce(root,name,value){
 const target=join(root,name),stage=join(root,'.'+name+'.next');
 if(await exists(target)){
  need(fingerprint((await originalJSON(target)).value)===fingerprint(value),
   'CHANGED','The completed original '+name+' contains different setup intent.');
  return;
 }
 if(await exists(stage)){
  need(fingerprint((await originalJSON(stage)).value)===fingerprint(value),
   'CHANGED','The retained setup stage belongs to different original inputs.');
 }else await writePrivate(stage,value);
 try{await link(stage,target);}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  need(fingerprint((await originalJSON(target)).value)===fingerprint(value),
   'CHANGED','Another completed original setup exists; it was preserved.');
 }
 await syncDirectory(root);
 await unlink(stage);
 await syncDirectory(root);
}
async function originalStore(root,target){
 if(await exists(target)){await privateDirectory(target);await readReleaseState(target);return;}
 for(const item of await readdir(root,{withFileTypes:true})){
  if(!item.isDirectory()||!STAGE.test(item.name))continue;
  const stage=join(root,item.name);await privateDirectory(stage);
  let state;try{state=await readReleaseState(stage);}catch{continue;}
  need(state.generation===0&&state.active===null&&state.previous===null&&
   Array.isArray(state.history)&&state.history.length===0&&
   (await readdir(join(stage,'releases'))).length===0,'STORE_CHANGED',
   'An unpublished original setup store contains release activity. Keep it and select its intended original store.');
  await rename(stage,target);await syncDirectory(root);return;
 }
 const stage=join(root,'carbon-customer-release-setup-'+randomUUID());
 await initReleaseStore(stage);await readReleaseState(stage);
 await rename(stage,target);await syncDirectory(root);
}
function existingSelection(raw,root,connection,store,name){
 need(raw.schema==='stellar-forge.merchant-mcp.v1'&&
  hostPath(raw.carbonCustomerConnection,root)===connection&&hostPath(raw.releaseStore,root)===store&&
  raw.name===name,'CHANGED','The existing complete merchant configuration belongs to another original connection, name or release store.');
 need(typeof raw.exportsDirectory==='string','CHANGED','The existing original merchant export directory is missing.');
}
/**
 * Register this product in the existing host. Never opens the Carbon customer application,
 * creates a replacement source workspace, or rewrites a completed host config.
 */
export async function initializeCarbonCustomerMerchant(options={}){
 exact(options,['directory','connection','name','releaseStore'],['directory','connection']);
 const root=hostPath(options.directory),connection=hostPath(options.connection);
 const originalConnection=await originalJSON(connection);
 const {readCarbonCustomerConfiguration}=await import('./configuration.mjs');
 const selected=await readCarbonCustomerConfiguration(connection);
 need(selected&&plain(selected.workspaces)&&Object.keys(selected.workspaces).length>0,
  'CONNECTION_INVALID','Declare the original Carbon customer workspace aliases.');
 need((await originalJSON(connection)).sha256===originalConnection.sha256,
  'SOURCE_CHANGED','The original connection changed during validation.');
 await privateDirectory(dirname(root));await makeDirectory(root);
 let lease;
 try{lease=await acquireStateLease(root);}
 catch{throw fail('BUSY','Another process owns this exact original merchant setup.');}
 try{
  const configuration=join(root,'merchant-mcp.json'),marker=join(root,MARKER);
  const saved=await exists(configuration)?await originalJSON(configuration):null;
  const oldIntent=await exists(marker)?(await originalJSON(marker)).value:null;
  const name=line(options.name??saved?.value.name??oldIntent?.name??'Starforge Carbon customer statements','Merchant name');
  const selectedStore=options.releaseStore!==undefined?hostPath(options.releaseStore):
   saved?hostPath(saved.value.releaseStore,root):oldIntent?hostPath(oldIntent.releaseStore):join(root,'releases');
  const intent={schema:SCHEMA,connection,connectionSha256:originalConnection.sha256,releaseStore:selectedStore,name};
  if(saved)existingSelection(saved.value,root,connection,selectedStore,name);
  if(oldIntent)need(fingerprint(oldIntent)===fingerprint(intent),'CHANGED',
   'This setup directory is bound to a different original connection source, name or release store.');
  else{
   if(!saved){
    const allowed=new Set(['lease.lock','.'+MARKER+'.next']);
    need((await readdir(root)).every(entry=>allowed.has(entry)),'DIRECTORY_IN_USE',
     'Select this initializer’s original directory or a new private merchant directory.');
   }
   lease.assertHeld();await writeOnce(root,MARKER,intent);
  }
  // An explicit or existing host store must already exist. Only this setup's
  // original default store may be initialized or resumed.
  const ownStore=selectedStore===join(root,'releases')&&options.releaseStore===undefined&&!saved;
  if(ownStore)await originalStore(root,selectedStore);
  else{await privateDirectory(selectedStore);await readReleaseState(selectedStore);}
  const exportsDirectory=saved?hostPath(saved.value.exportsDirectory,root):join(root,'customer-exports');
  if(saved)await privateDirectory(exportsDirectory);else await makeDirectory(exportsDirectory);
  lease.assertHeld();
  need((await originalJSON(connection)).sha256===originalConnection.sha256,
   'SOURCE_CHANGED','The original connection changed before setup publication.');
  if(saved){
   need((await originalJSON(configuration)).sha256===saved.sha256,'CHANGED',
    'The existing whole merchant configuration changed during setup; it was preserved.');
  }else await writeOnce(root,'merchant-mcp.json',{
   schema:'stellar-forge.merchant-mcp.v1',name,releaseStore:selectedStore,
   exportsDirectory:'./customer-exports',sources:{},carbonCustomerConnection:connection
  });
  const {readMerchantConfig}=await import('../../../../stellar-forge/mcp-merchant-operator/config.mjs');
  const current=await readMerchantConfig(configuration);
  need(current.carbonCustomerWorkspaces&&plain(current.carbonCustomerWorkspaces.workspaces),'HOST_SOURCE_REQUIRED',
   'Select the complete installed Carbon customer source contribution with its original connection reader.');
  return {schema:'stellar-forge.merchant-mcp.v1',configuration,state:saved?'REOPENED':'INITIALIZED',
   carbonCustomerWorkspacesConfigured:true,connectionSha256:originalConnection.sha256,
   workspaces:Object.entries(selected.workspaces).map(([workspace,item])=>({workspace,label:item.label??workspace})),
   ownership:'ORIGINAL_CARBON_CUSTOMER_WORKSPACE',authoring:'OPENED_BY_ORIGINAL_CARBON_CUSTOMER_TOOLS'};
 }finally{await lease.close();}
}
