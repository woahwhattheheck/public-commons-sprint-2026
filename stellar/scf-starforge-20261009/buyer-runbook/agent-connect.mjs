// MIT. Commission a borrowed Buyer connection from the original running launch.
import {mkdir,lstat,readdir,rename,unlink,open} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {acquireStateLease} from '../merchant-fleet-gateway/state-lease.mjs';
import {writePrivate} from '../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {BUYER_AGENT_CONFIGURATION,plain,need,fail} from './agent-contract.mjs';
import {BuyerWorkspaceConnection,hostPath,privateDirectory,readPrivate,readBuyerAgentConfiguration,parse,hash,encode} from './agent-connection.mjs';

export const BUYER_AGENT_CONNECTION_SETUP='stellar-forge.buyer-runbook.agent-connection-setup.v1';
const LIMIT=2*1024*1024;
const KEYS=['connectionFile','workspace','launchFile','storageDirectory','label','operatorDirectory','operatorHandle',
 'researchFile','researchBuyer','checkoutFile','merchant','claimEnv','expectedConnectionSha256'];
function alias(value){
 need(typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),
  'INVALID_PARAMS','Use a lowercase original workspace or operator alias.');return value;
}
function label(value){
 need(typeof value==='string'&&value.length>=1&&value.length<=160&&!/[\x00-\x1f\x7f]/.test(value),
  'INVALID_PARAMS','Use a single-line connection label of 1–160 characters.');return value;
}
const overlaps=(a,b)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
async function info(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDirectory(path){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function directory(path){
 await privateDirectory(dirname(path));
 try{await mkdir(path,{mode:0o700});await syncDirectory(dirname(path));}
 catch(error){if(error.code!=='EEXIST')throw error;}
 return privateDirectory(path);
}
async function document(path){
 try{const body=await readPrivate(path,LIMIT);return {value:parse(body,'BUYER_AGENT_CONNECTION_DOCUMENT_INVALID'),sha256:hash(body),bytes:body.length};}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function unchanged(before,after){
 return before===null?after===null:after!==null&&before.sha256===after.sha256;
}
function interrupted(signal){
 need(!signal?.aborted,'BUYER_AGENT_CONNECT_INTERRUPTED','Reopen this same connection with its current original launch.');
}
async function lock(file){
 const root=join(dirname(file),'.buyer-connect-'+hash(file).slice(0,24));
 await directory(root);
 try{return await acquireStateLease(root);}
 catch(error){
  if(error.message==='FLEET_STATE_ALREADY_OWNED')throw fail('BUYER_AGENT_CONNECTION_BUSY',
   'The same connection is being commissioned by another local process.');
  throw fail('BUYER_AGENT_CONNECTION_LEASE_FAILED','Use the original local file-lock runtime for this connection.',{cause:error});
 }
}
async function stage(file,before,value,validate,temporaryFiles){
 if(before&&isDeepStrictEqual(before.value,value))return {file,before,changed:false,normalized:await validate(file)};
 const temporary=join(dirname(file),'.'+basename(file)+'.connect-'+randomUUID()+'.tmp');
 temporaryFiles.add(temporary);await writePrivate(temporary,encode(value));
 const normalized=await validate(temporary),saved=await document(temporary);
 need(saved&&isDeepStrictEqual(saved.value,value),'BUYER_AGENT_CONNECTION_WRITE_CHANGED','Read the complete selected connection again.');
 return {file,before,temporary,changed:true,normalized,sha256:saved.sha256};
}
async function publish(staged,temporaryFiles){
 need(unchanged(staged.before,await document(staged.file)),'BUYER_AGENT_CONNECTION_DOCUMENT_CHANGED',
  'The original configuration changed during setup. Reopen its current complete document.');
 if(!staged.changed)return {state:'REOPENED',sha256:staged.before.sha256,bytes:staged.before.bytes};
 // One original flock owns the complete preimage check and atomic publication.
 // Renaming the private stage leaves no second hard link after interruption.
 await rename(staged.temporary,staged.file);
 temporaryFiles.delete(staged.temporary);await syncDirectory(dirname(staged.file));
 const saved=await document(staged.file);
 need(saved?.sha256===staged.sha256,'BUYER_AGENT_CONNECTION_WRITE_CHANGED','Read the complete selected connection again.');
 return {state:staged.before?'UPDATED':'CREATED',sha256:saved.sha256,bytes:saved.bytes};
}
function requireBinding(definition,{directory,launchFile,storageDirectory}){
 need(definition.directory===directory&&definition.launchFile===launchFile&&definition.storageDirectory===storageDirectory,
  'BUYER_AGENT_CONNECTION_SELECTION_CHANGED',
  'This alias already selects a different Buyer workspace or storage. Preserve its original selection.');
}
async function addResearchConnection(options,connectionFile,workspace,temporaryFiles){
 if(options.researchFile===undefined)return null;
 const file=hostPath(options.researchFile),before=await document(file);
 const {HOST_SCHEMA,readCommerceConfiguration,selectedMerchant}=await import('../sf88-operator-buyer-cli/research-dossiers/customer-commerce/configuration.mjs');
 const normalized=before?await readCommerceConfiguration(file):{schema:HOST_SCHEMA,buyers:{},merchants:{}};
 need(unchanged(before,await document(file)),'BUYER_AGENT_CONNECTION_DOCUMENT_CHANGED','Reopen the current original Research host declaration.');
 const raw=before?structuredClone(before.value):{schema:HOST_SCHEMA,merchants:{},buyers:{}};
 const buyer=alias(options.researchBuyer??workspace),selected=normalized.buyers[buyer];
 if(selected)need(selected.agentFile===connectionFile&&selected.workspace===workspace,
  'BUYER_AGENT_RESEARCH_BUYER_CHANGED','The selected Research alias already belongs to another original Buyer connection.');
 else raw.buyers={...(raw.buyers??{}),[buyer]:{label:options.label??workspace,agentFile:connectionFile,workspace}};
 let merchant=null;
 if(options.checkoutFile!==undefined){
  const id=alias(options.merchant),checkoutFile=hostPath(options.checkoutFile),original=normalized.merchants[id];
  if(original){
   need(original.checkoutFile===checkoutFile&&(options.claimEnv===undefined||original.claimEnv===options.claimEnv),
    'BUYER_AGENT_RESEARCH_MERCHANT_CHANGED','The selected Research alias already belongs to another original checkout.');
  }else raw.merchants={...(raw.merchants??{}),[id]:{checkoutFile,...(options.claimEnv===undefined?{}:{claimEnv:options.claimEnv})}};
  merchant=id;
 }
 const staged=await stage(file,before,raw,readCommerceConfiguration,temporaryFiles);
 let merchantView=null;
 if(merchant){const selected=await selectedMerchant(staged.normalized,merchant);
  merchantView={id:merchant,checkoutFile:selected.view.checkoutFile,checkoutSha256:selected.view.checkoutSha256,
   claimEnv:selected.view.claimEnv,claimAvailable:selected.view.claimAvailable};}
 return {...staged,buyer,merchant:merchantView};
}

/**
 * Create or reopen an agent connection to an already running native Buyer.
 * Paths and environment selectors are host inputs; signing keys remain with
 * the original application. Optional Research declarations reuse that same
 * connection and a compiled, already initialized SF101 checkout.
 */
export async function connectBuyerRunbookAgent(options,{signal}={}){
 need(plain(options)&&Object.keys(options).every(key=>KEYS.includes(key))&&
  ['connectionFile','workspace','launchFile','storageDirectory'].every(key=>Object.hasOwn(options,key)),
  'INVALID_PARAMS','Select the connection file, workspace alias, actual launch file and private receiving directory.');
 const connectionFile=hostPath(options.connectionFile),workspace=alias(options.workspace),
  launchFile=hostPath(options.launchFile),storageDirectory=hostPath(options.storageDirectory);
 if(options.label!==undefined)label(options.label);
 if(options.expectedConnectionSha256!==undefined)need(/^[a-f0-9]{64}$/.test(options.expectedConnectionSha256),
  'INVALID_PARAMS','Supply the complete prior connection SHA256 for a deliberate source update.');
 need(options.operatorHandle===undefined||options.operatorDirectory!==undefined,'INVALID_PARAMS','Select the original operator directory for its handle.');
 const operatorHandle=alias(options.operatorHandle??'original');
 need(options.researchBuyer===undefined||options.researchFile!==undefined,'INVALID_PARAMS','Select a Research host file for its Buyer alias.');
 need((options.checkoutFile===undefined)===(options.merchant===undefined)&&
  (options.checkoutFile===undefined||options.researchFile!==undefined)&&
  (options.claimEnv===undefined||options.checkoutFile!==undefined),'INVALID_PARAMS',
  'Select the original checkout and merchant alias together with their Research host file.');
 if(options.claimEnv!==undefined)need(/^[A-Z][A-Z0-9_]{1,64}$/.test(options.claimEnv),'INVALID_PARAMS','Use the original claim environment variable name.');
 const researchFile=options.researchFile===undefined?null:hostPath(options.researchFile);
 const files=[connectionFile,...(researchFile?[researchFile]:[])];
 need(new Set([...files,launchFile]).size===files.length+1,'INVALID_PARAMS','Keep configuration documents separate from the original launch record.');
 for(const file of files)await privateDirectory(dirname(file));
 interrupted(signal);
 const launch=parse(await readPrivate(launchFile,262144),'BUYER_AGENT_LAUNCH_INVALID');
 const nativeDirectory=hostPath(launch.directory);
 need(nativeDirectory===launch.directory,'BUYER_AGENT_LAUNCH_INVALID','Read the canonical original Buyer launch.');
 await privateDirectory(nativeDirectory);
 need(!overlaps(storageDirectory,nativeDirectory)&&files.every(file=>!overlaps(file,nativeDirectory)&&!overlaps(file,storageDirectory)),
  'BUYER_AGENT_CONNECTION_PATH_OVERLAP','Keep agent configuration and retained files separate from the native Buyer workspace.');
 const connection=new BuyerWorkspaceConnection({directory:nativeDirectory,launchFile,
  expectedSelectionSha256:launch.selectionSha256});
 const leases=[],temporaryFiles=new Set();let primary;
 try{
  // Original connection verifies the file, complete selection, actual listener
  // instance and source before and after its read. Only GET /api/launch is used.
  const opened=await connection.json('/api/launch',{signal});
  let operator=null;
  if(options.operatorDirectory!==undefined){
   const operatorDirectory=hostPath(options.operatorDirectory);await privateDirectory(operatorDirectory);
   const {openWorkspace}=await import('../sf88-operator-buyer-cli/workspace.mjs');
   const original=await openWorkspace(['--dir',operatorDirectory]);
   operator={handle:operatorHandle,directory:operatorDirectory,configurationFile:original.configPath,
    network:original.manifest.network,payer:original.manifest.payer};
   need(!overlaps(storageDirectory,operatorDirectory)&&files.every(file=>!overlaps(file,operatorDirectory)),
    'BUYER_AGENT_CONNECTION_PATH_OVERLAP','Keep connection files outside the original accounting operator workspace.');
  }
  // All setup writers acquire the same original flock owners in one path order.
  for(const file of [...files].sort()){interrupted(signal);leases.push(await lock(file));}
  const before=await document(connectionFile),old=before?await readBuyerAgentConfiguration(connectionFile):null;
  need(unchanged(before,await document(connectionFile)),'BUYER_AGENT_CONNECTION_DOCUMENT_CHANGED','Reopen the current complete Buyer connection.');
  const existing=old?.workspaces[workspace];
  const sourceChanged=Boolean(existing&&existing.expectedSelectionSha256!==opened.connection.selectionSha256);
  if(existing){
   requireBinding(existing,{directory:nativeDirectory,launchFile,storageDirectory,selectionSha256:opened.connection.selectionSha256});
   if(sourceChanged)need(options.expectedConnectionSha256===before.sha256,'BUYER_AGENT_CONNECTION_SOURCE_REVIEW_REQUIRED',
    'Select the current complete configuration SHA256 to adopt this original application source update.');
   if(options.label!==undefined)need(existing.label===options.label,'BUYER_AGENT_CONNECTION_LABEL_CHANGED',
    'Use the retained label when reopening this original connection.');
  }
  for(const [name,definition]of Object.entries(old?.workspaces??{})){
   need(!overlaps(storageDirectory,definition.directory)&&(name===workspace||!overlaps(storageDirectory,definition.storageDirectory)),
    'BUYER_AGENT_CONNECTION_PATH_OVERLAP','Keep every original native workspace and agent store separate.');
   need(files.every(file=>!overlaps(file,definition.directory)&&!overlaps(file,definition.storageDirectory)),
    'BUYER_AGENT_CONNECTION_PATH_OVERLAP','Keep configuration documents outside every native workspace and retained store.');
  }
  await directory(storageDirectory);
  if(!existing)need((await readdir(storageDirectory)).length===0,'BUYER_AGENT_CONNECTION_STORAGE_IN_USE',
   'Preserve the existing retained store with its original connection; select an empty private directory for this new alias.');
  const raw=before?structuredClone(before.value):{schema:BUYER_AGENT_CONFIGURATION,workspaces:{}};
  const row=existing?structuredClone(raw.workspaces[workspace]):{label:options.label??workspace,directory:nativeDirectory,
   launchFile,expectedSelectionSha256:opened.connection.selectionSha256,storageDirectory,files:{},operators:{}};
  if(sourceChanged)row.expectedSelectionSha256=opened.connection.selectionSha256;
  if(operator){
   const bound=existing?.operators[operator.handle];
   need(bound===undefined||bound===operator.directory,'BUYER_AGENT_CONNECTION_OPERATOR_CHANGED',
    'The selected handle already belongs to another original accounting operator.');
   row.operators={...(row.operators??{}),[operator.handle]:operator.directory};
  }
  raw.workspaces={...raw.workspaces,[workspace]:row};
  if(options.expectedConnectionSha256!==undefined&&(!before||!isDeepStrictEqual(before.value,raw)))
   need(before?.sha256===options.expectedConnectionSha256,'BUYER_AGENT_CONNECTION_DOCUMENT_CHANGED',
    'Select the current complete connection before changing its declared source or aliases.');
  const candidate=await stage(connectionFile,before,raw,readBuyerAgentConfiguration,temporaryFiles);
  const research=await addResearchConnection(options,connectionFile,workspace,temporaryFiles);
  const verified=await connection.json('/api/launch',{signal});
  need(verified.connection.launchSha256===opened.connection.launchSha256,'BUYER_AGENT_INSTANCE_CHANGED',
   'The original Buyer restarted during setup. Reopen its current retained launch.');
  interrupted(signal);for(const lease of leases)lease.assertHeld();
  const written=await publish(candidate,temporaryFiles);
  const current=await readBuyerAgentConfiguration(connectionFile);
  need(isDeepStrictEqual(current,candidate.normalized),'BUYER_AGENT_CONNECTION_WRITE_CHANGED','Reopen the selected complete connection.');
  let researchResult=null;
  if(research){
   const {selectedBuyer}=await import('../sf88-operator-buyer-cli/research-dossiers/customer-commerce/configuration.mjs');
   const buyer=await selectedBuyer(research.normalized,research.buyer);
   need(buyer.definition.directory===nativeDirectory&&buyer.definition.expectedSelectionSha256===opened.connection.selectionSha256,
    'BUYER_AGENT_RESEARCH_BUYER_CHANGED','Select this same original Buyer in the Research host.');
   for(const lease of leases)lease.assertHeld();
   const saved=await publish(research,temporaryFiles);
   researchResult={file:research.file,...saved,buyer:research.buyer,workspace,merchant:research.merchant};
  }
  const final=await connection.json('/api/launch',{signal});
  need(final.connection.launchSha256===opened.connection.launchSha256,'BUYER_AGENT_INSTANCE_CHANGED',
   'The original Buyer restarted during setup. Reopen its current retained launch.');
  return {schema:BUYER_AGENT_CONNECTION_SETUP,connectionFile,...written,workspace,
   directory:nativeDirectory,launchFile,storageDirectory,selectionSha256:final.connection.selectionSha256,
   instanceId:final.connection.instanceId,url:final.connection.url,approvalMode:final.connection.approvalMode,
   approvalAvailable:final.connection.approvalAvailable,operator,research:researchResult};
 }catch(error){primary=error;throw error;}
 finally{
  const errors=[];
  for(const file of temporaryFiles)try{await unlink(file);}catch(error){if(error.code!=='ENOENT')errors.push(error);}
  for(const resource of [connection,...leases.reverse()])try{await resource.close();}catch(error){errors.push(error);}
  if(errors.length){if(primary)primary.connectionCloseErrors=errors;
   else throw fail('BUYER_AGENT_CONNECTION_CLOSE_INCOMPLETE','Reopen the retained connection to complete its local setup.',{causes:errors});}
 }
}
