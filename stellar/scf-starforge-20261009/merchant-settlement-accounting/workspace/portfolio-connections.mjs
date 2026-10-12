// MIT. Portfolio aliases borrow the original accounting workspaces and maintenance admissions.
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openAccountingWorkspace} from './store.mjs';
import {AccountantWorkspace} from './accountant-workspace.mjs';
import {RunbookWorkspace,runbookCanonical} from './runbooks-workspace.mjs';
import {openAccountingMaintenance} from './recovery-controller.mjs';
import {accountingWorkspaceBinding,inspectAccountingWorkspaceBinding} from './binding.mjs';

export const PORTFOLIO_BINDING_SCHEMA='stellar-forge.accounting-portfolio-binding.v1';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status,applied:false});};
const alias=value=>{need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value),'PORTFOLIO_CONFIG_ALIAS','Use a declared accounting workspace alias.');return value;};
const digest=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>digest(Buffer.from(runbookCanonical(value)));
const hostPath=(value,base)=>{need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\u0000-\u001f\u007f]/.test(value),'PORTFOLIO_CONFIG_PATH','Use an original host path from the accounting configuration.');return resolve(base,value);};
function recoveryConfig(value,base){
  if(value===undefined)return undefined;
  need(plain(value)&&typeof value.stateRoot==='string'&&typeof value.backupRoot==='string','PORTFOLIO_RECOVERY_CONFIG','Declare the original maintenance state and backup roots together.');
  const passEnv=value.passEnv??'STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE';
  need(/^[A-Z][A-Z0-9_]{4,63}$/.test(passEnv)&&[undefined,true,false].includes(value.startPaused),'PORTFOLIO_RECOVERY_CONFIG','Use the original passphrase environment name and pause setting.');
  return {stateRoot:hostPath(value.stateRoot,base),backupRoot:hostPath(value.backupRoot,base),passEnv,startPaused:value.startPaused??false};
}
async function configBytes(path){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{const stat=await handle.stat();need(stat.isFile()&&stat.size>0&&stat.size<=4_000_000,'PORTFOLIO_CONFIG_FILE','Use the complete existing host configuration within 4 MB.');
    need(await realpath(path)===path,'PORTFOLIO_CONFIG_PATH','Choose the original configuration without symlink ancestors.');
    const bytes=await handle.readFile();need(bytes.length<=4_000_000,'PORTFOLIO_CONFIG_FILE','The host configuration exceeds 4 MB.');return bytes;
  }finally{await handle.close();}
}
/** Read-only review. The original workspace writer rechecks every binding inside its lease. */
export async function inspectPortfolioConfiguration(configPath,coordinatorAlias){
  configPath=resolve(configPath);alias(coordinatorAlias);const bytes=await configBytes(configPath),base=dirname(configPath);
  let config;try{config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{need(false,'PORTFOLIO_CONFIG_JSON','Use the existing JSON host configuration.');}
  const workspaces=config?.accounting?.workspaces;
  need(plain(workspaces)&&Object.keys(workspaces).length>0&&Object.keys(workspaces).length<=16,'PORTFOLIO_CONFIG_WORKSPACES','Declare one to 16 original accounting.workspaces.');
  const normalized=new Map(),directories=new Set();
  for(const [name,value] of Object.entries(workspaces)){
    alias(name);need(plain(value),'PORTFOLIO_CONFIG_WORKSPACE','Describe each original accounting workspace.');
    need(value.sourceMode===undefined||['merchant','buyer'].includes(value.sourceMode),'PORTFOLIO_CONFIG_SOURCE_MODE','Choose the original merchant or buyer accounting source mode.');
    const directory=hostPath(value.directory,base),clients=value.portfolioClients??{};
    need(!directories.has(directory),'PORTFOLIO_CONFIG_DUPLICATE','Declare each original accounting workspace directory once.');directories.add(directory);
    need(plain(clients)&&Object.keys(clients).length<=15,'PORTFOLIO_CONFIG_CLIENTS','Declare up to 15 client aliases for a portfolio coordinator.');
    for(const [client,target] of Object.entries(clients)){alias(client);alias(target);}
    need(new Set(Object.values(clients)).size===Object.values(clients).length,'PORTFOLIO_CONFIG_DUPLICATE','Each portfolio client alias must select a different original accounting workspace.');
    if(Object.keys(clients).length)need(value.sourceMode!=='buyer','ACCOUNTING_MERCHANT_SOURCE_REQUIRED','Portfolio coordinators and selected clients require original merchant accounting workspaces with client Runbooks.',409);
    normalized.set(name,{directory,clients,value,recovery:recoveryConfig(value.recovery,base)});
  }
  const visited=new Set(),active=new Set();
  const visit=name=>{
    need(normalized.has(name),'PORTFOLIO_CONFIG_CLIENT','Select existing accounting workspace aliases.');
    need(!active.has(name),'PORTFOLIO_CONFIG_CYCLE','Portfolio client aliases must not return to their coordinator.');
    if(visited.has(name))return;active.add(name);
    for(const target of Object.values(normalized.get(name).clients)){
      visit(target);need(normalized.get(target).value.sourceMode!=='buyer','ACCOUNTING_MERCHANT_SOURCE_REQUIRED','Portfolio coordinators and selected clients require original merchant accounting workspaces with client Runbooks.',409);
    }
    active.delete(name);visited.add(name);
  };
  for(const name of normalized.keys())visit(name);
  need(normalized.has(coordinatorAlias),'PORTFOLIO_CONFIG_COORDINATOR','Choose the original coordinator from accounting.workspaces.');
  const selected=normalized.get(coordinatorAlias);
  const inspect=async(name,clientAlias)=>{
    const row=normalized.get(name);
    need(row.value.sourceMode!=='buyer','ACCOUNTING_MERCHANT_SOURCE_REQUIRED','Portfolio coordinators and selected clients require original merchant accounting workspaces with client Runbooks.',409);
    const binding=await inspectAccountingWorkspaceBinding(row.directory);
    need(binding.sources.sourceMode!=='buyer','ACCOUNTING_MERCHANT_SOURCE_REQUIRED','Portfolio coordinators and selected clients require original merchant accounting workspaces with client Runbooks.',409);
    for(const field of ['outboxDir','proofDir','termsFile','recoveredDir','buyerSourceFile']){
      if(row.value[field]!==undefined)need(hostPath(row.value[field],base)===binding.sources[field],'PORTFOLIO_CONFIG_SOURCE_CHANGED','The configured source differs from the original accounting workspace.',409);
    }
    return {alias:clientAlias,workspaceAlias:name,...binding,...(row.recovery?{recovery:row.recovery}:{})};
  };
  const coordinator=await inspect(coordinatorAlias,coordinatorAlias),clients=[];
  for(const [clientAlias,target] of Object.entries(selected.clients).sort(([a],[b])=>a.localeCompare(b)))clients.push(await inspect(target,clientAlias));
  need(new Set([coordinator.workspaceId,...clients.map(row=>row.workspaceId)]).size===clients.length+1,'PORTFOLIO_CONFIG_DUPLICATE','Select distinct coordinator and client workspace identities.');
  const value={schema:PORTFOLIO_BINDING_SCHEMA,configPath,configSha256:digest(bytes),coordinatorAlias,coordinator,clients};
  return {...value,sha256:hash(value)};
}
/** One owned pool for a native host. Injected MCP clients use their existing owner instead. */
export async function openPortfolioClientPool({configPath,coordinatorAlias,expectedPortfolioSha256,coordinatorWorkspace}){
  const binding=await inspectPortfolioConfiguration(configPath,coordinatorAlias);
  if(expectedPortfolioSha256!==undefined)need(binding.sha256===expectedPortfolioSha256,'PORTFOLIO_CONFIG_CHANGED','The configured portfolio differs from the reviewed original workspaces.',409);
  if(coordinatorWorkspace){
    const actual=accountingWorkspaceBinding(coordinatorWorkspace.directory,coordinatorWorkspace.state);
    need(actual.sources.sourceMode!=='buyer','ACCOUNTING_MERCHANT_SOURCE_REQUIRED','Portfolio coordinators and selected clients require original merchant accounting workspaces with client Runbooks.',409);
    need(actual.workspaceId===binding.coordinator.workspaceId&&actual.sourcesSha256===binding.coordinator.sourcesSha256,'PORTFOLIO_COORDINATOR_CHANGED','The current writer is not the reviewed portfolio coordinator.',409);
  }
  const entries=new Map(binding.clients.map(row=>[row.alias,row])),records=new Map(),calls=new Set();let closing=false,closingPromise=null;
  const original=async(selected)=>{
    let maintenance;
    const openRuntime=async()=>{
      const workspace=await openAccountingWorkspace({directory:selected.directory,...selected.sources,
        expectedWorkspaceId:selected.workspaceId,expectedSourcesSha256:selected.sourcesSha256});
      const accountant=new AccountantWorkspace(workspace),runbooks=new RunbookWorkspace(workspace,accountant);
      return {workspace,accountant,runbooks};
    };
    const closeRuntime=async({workspace})=>workspace.close();
    maintenance=await openAccountingMaintenance({directory:selected.directory,...selected.recovery,openRuntime,closeRuntime});
    return {maintenance,selected};
  };
  const record=clientAlias=>{
    alias(clientAlias);const selected=entries.get(clientAlias);
    need(selected,'PORTFOLIO_CLIENT_NOT_CONFIGURED','Choose a client alias from the original portfolio configuration.',404);
    if(!records.has(clientAlias)){
      const promise=original(selected);records.set(clientAlias,promise);
      promise.catch(()=>{if(records.get(clientAlias)===promise)records.delete(clientAlias);});
    }
    return records.get(clientAlias);
  };
  const withClient=(clientAlias,work)=>{
    need(!closing,'PORTFOLIO_HOST_CLOSING','The original portfolio host is closing.',503);
    need(typeof work==='function','PORTFOLIO_HOST','Use an admitted original client callback.');
    const call=(async()=>{
      const owned=await record(clientAlias),admission=owned.maintenance.enter();
      try{
        const actual=accountingWorkspaceBinding(admission.workspace.directory,admission.workspace.state);
        need(actual.sources.sourceMode!=='buyer','ACCOUNTING_MERCHANT_SOURCE_REQUIRED','Portfolio coordinators and selected clients require original merchant accounting workspaces with client Runbooks.',409);
        need(actual.workspaceId===owned.selected.workspaceId&&actual.sourcesSha256===owned.selected.sourcesSha256,'PORTFOLIO_CLIENT_CHANGED','The original admitted client binding changed.',409);
        return await work(admission);
      }finally{admission.release();}
    })();
    calls.add(call);call.then(()=>calls.delete(call),()=>calls.delete(call));return call;
  };
  const close=()=>{
    if(closingPromise)return closingPromise;
    closing=true;
    const task=(async()=>{
      await Promise.allSettled([...calls]);const errors=[];
      for(const [name,promise] of [...records]){
        try{const owned=await promise;await owned.maintenance.close();if(records.get(name)===promise)records.delete(name);}
        catch(error){errors.push(error);}
      }
      if(errors.length)throw Object.assign(new AggregateError(errors,'Original portfolio client owners did not all close cleanly.'),{code:'PORTFOLIO_CLIENT_CLOSE_FAILED'});
    })();
    closingPromise=task;task.catch(()=>{if(closingPromise===task)closingPromise=null;});return task;
  };
  return {binding:structuredClone(binding),clientAliases:[...entries.keys()],withClient,close,
    get summary(){return {closing,acceptedCalls:calls.size,owned:[...records.keys()]};}};
}
