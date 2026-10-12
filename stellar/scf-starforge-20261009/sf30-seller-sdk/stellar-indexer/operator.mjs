// MIT. One original Stellar Indexer and Soroban operator host.
import {promises as fs} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {openStellarIndexerWorkspace} from './engine.mjs';
import {openSorobanEventsWorkspace} from '../soroban-events/engine.mjs';
import {openSorobanEventWatches} from '../soroban-events/watch.mjs';

export class StellarIndexerOperatorError extends Error {
  constructor(code,message,details={}){super(message);this.name='StellarIndexerOperatorError';this.code=code;this.details=details;}
}
export function need(value,code,message){if(!value)throw new StellarIndexerOperatorError(code,message);}
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function exactInteger(value,label,minimum=0,maximum=Number.MAX_SAFE_INTEGER){
  need(Number.isSafeInteger(value)&&value>=minimum&&value<=maximum,'INVALID_ARGUMENT',label+' must be an integer from '+minimum+' through '+maximum+'.');
  return value;
}
export async function readPrivateJSON(file,{maximumBytes=2*1024*1024}={}){
  const path=resolve(file),handle=await fs.open(path,'r');
  try{
    const stat=await handle.stat();
    need(stat.isFile()&&stat.size>0&&stat.size<=maximumBytes,'INVALID_ARGUMENT','Select a complete JSON file within '+maximumBytes+' bytes.');
    let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await handle.readFile()));}
    catch{throw new StellarIndexerOperatorError('INVALID_JSON','The selected file must contain complete UTF-8 JSON.');}
    return value;
  }finally{await handle.close();}
}
const aliasPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function alias(value,label){need(typeof value==='string'&&aliasPattern.test(value),'INVALID_ARGUMENT','Use a simple '+label+'.');return value;}
function privateConnections(raw,environment){
  need(plain(raw),'INVALID_ARGUMENT','Private Indexer connections must be an alias-to-connection JSON object.');
  const result=Object.create(null);
  for(const [name,input]of Object.entries(raw)){
    alias(name,'connection alias');need(plain(input),'INVALID_ARGUMENT','Each Indexer connection must be a JSON object.');
    need(Object.keys(input).every(key=>['consumerToken','consumerTokenEnv','apiUrl','network'].includes(key)),
      'INVALID_ARGUMENT','Use the original consumerToken, consumerTokenEnv, apiUrl and network connection fields.');
    need(['stellar:pubnet','stellar:testnet'].includes(input.network),'INVALID_ARGUMENT','Select stellar:pubnet or stellar:testnet for each Indexer connection.');
    need(!(input.consumerToken!==undefined&&input.consumerTokenEnv!==undefined),'INVALID_ARGUMENT','Select one private token source per Indexer connection.');
    let consumerToken=input.consumerToken;
    if(input.consumerTokenEnv!==undefined){
      need(typeof input.consumerTokenEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.consumerTokenEnv),
        'INVALID_ARGUMENT','Select an existing environment variable for the Indexer token.');
      consumerToken=environment[input.consumerTokenEnv];
    }
    need(typeof consumerToken==='string'&&consumerToken.length>0&&!/[\r\n]/.test(consumerToken),
      'CONNECTION_REQUIRED','The selected Indexer token source is unavailable.');
    result[name]={consumerToken,network:input.network,...(input.apiUrl===undefined?{}:{apiUrl:input.apiUrl})};
  }
  return result;
}
function rpcConnections(raw,environment){
  need(plain(raw),'INVALID_ARGUMENT','Named event connections must be a JSON object.');
  const result=Object.create(null);
  for(const [name,value]of Object.entries(raw)){
    alias(name,'event connection alias');need(plain(value),'INVALID_ARGUMENT','Each event connection must be a JSON object.');
    const {headerEnv,...input}=value;
    need(headerEnv===undefined||plain(headerEnv),'INVALID_ARGUMENT','RPC headerEnv must map header names to environment variables.');
    const headers={...(input.headers??{})};
    for(const [name,variable]of Object.entries(headerEnv??{})){
      need(typeof variable==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)&&
        !Object.keys(headers).some(key=>key.toLowerCase()===name.toLowerCase()),
        'INVALID_ARGUMENT','Select one private environment source for each RPC header.');
      const secret=environment[variable];
      need(typeof secret==='string'&&secret.length>0&&!/[\r\n]/.test(secret),'CONNECTION_REQUIRED','A configured RPC header is unavailable.');
      headers[name]=secret;
    }
    result[name]={...input,headers};
  }
  return result;
}
async function publications(raw,base){
  need(plain(raw),'INVALID_ARGUMENT','Publication destinations must be an alias-to-configuration JSON object.');
  const result=Object.create(null);
  for(const [name,input]of Object.entries(raw)){
    alias(name,'publication alias');need(plain(input)&&typeof input.directory==='string'&&input.directory.length>0,
      'INVALID_ARGUMENT','Each publication destination must select its private directory.');
    need(Object.keys(input).every(key=>['directory','feedId','sourceId','label','description'].includes(key)),
      'INVALID_ARGUMENT','Use the original native publication configuration fields.');
    result[name]={...input,directory:resolve(base,input.directory)};
  }
  return result;
}
export function publicOperatorError(error){
  return {code:typeof error?.code==='string'?error.code:'OPERATOR_ERROR',
    message:typeof error?.message==='string'?error.message:'The original workspace operation failed.',
    ...(plain(error?.details)?{details:error.details}:{})};
}
export async function openStellarIndexerOperator(options={}){
  const environment=options.environment??process.env;
  need(typeof options.directory==='string'&&options.directory.length>0,'INVALID_ARGUMENT','Select a private operator workspace directory.');
  const directory=resolve(options.directory),indexerDirectory=join(directory,'indexer');
  need(options.installationDirectory===undefined||(typeof options.installationDirectory==='string'&&options.installationDirectory.length>0),
    'INVALID_ARGUMENT','Select the existing SDK installation project directory.');
  const installationDirectory=options.installationDirectory===undefined?undefined:resolve(options.installationDirectory);
  const eventDirectory=resolve(options.eventDirectory??join(directory,'events'));
  need(eventDirectory!==indexerDirectory,'INVALID_ARGUMENT','Indexer and event workspaces need separate original directories.');
  const connectionInput=options.connections??(options.connectionsFile?await readPrivateJSON(options.connectionsFile):{});
  const connections=privateConnections(connectionInput,environment);
  const eventInput=options.eventConnections??(options.eventConnectionsFile?await readPrivateJSON(options.eventConnectionsFile):{});
  const eventConnections=rpcConnections(eventInput,environment);
  const defaultEventInput=options.eventConnection??(options.eventConnectionFile?await readPrivateJSON(options.eventConnectionFile):undefined);
  const eventConnection=defaultEventInput===undefined?undefined:rpcConnections({default:defaultEventInput},environment).default;
  need(eventConnection===undefined||!Object.hasOwn(eventConnections,'default'),'INVALID_ARGUMENT','Configure the default event connection once.');
  const publicationInput=options.eventPublications??(options.eventPublicationsFile?await readPrivateJSON(options.eventPublicationsFile):{});
  const eventPublications=await publications(publicationInput,options.eventPublicationsFile?dirname(resolve(options.eventPublicationsFile)):directory);
  let events,watches,workspace,closed=false,closing;
  const captureTasks=new Map(),captureOutcomes=new Map();
  const watchAbort=new AbortController();
  let watchTask=null,watchRunner={status:'STOPPED',startedAt:null,lastError:null};
  try{
    events=options.eventWorkspace??await openSorobanEventsWorkspace({directory:eventDirectory,
      ...(eventConnection===undefined?{}:{connection:eventConnection}),connections:eventConnections});
    watches=options.eventWatches??await openSorobanEventWatches({workspace:events});
    workspace=options.workspace??await openStellarIndexerWorkspace({directory:indexerDirectory,connections,eventWorkspace:events,eventWatches:watches,
      ...(installationDirectory===undefined?{}:{installationDirectory})});
    if(options.expectedWorkspaceId!==undefined){
      const current=await workspace.describe();
      need(current.workspaceId===options.expectedWorkspaceId,'WORKSPACE_ID_MISMATCH','The selected directory contains a different original Indexer workspace.');
    }
  }catch(error){
    if(workspace&&!options.workspace)await workspace.close().catch(()=>{});
    if(watches&&!options.eventWatches)await watches.close().catch(()=>{});
    if(events&&!options.eventWorkspace)await events.close().catch(()=>{});
    throw error;
  }
  function ensureOpen(){need(!closed&&!closing,'WORKSPACE_CLOSED','The operator is closing.');}
  function startCapture(captureId,{maxPages}={}){
    ensureOpen();
    if(captureTasks.has(captureId))return {captureId,status:'RUNNING',reused:true};
    const controller=new AbortController(),startedAt=new Date().toISOString();
    const entry={controller,startedAt,task:null};
    const task=Promise.resolve().then(()=>workspace.captureRun({captureId,signal:controller.signal,
      ...(maxPages===undefined?{}:{maxPages})})).then(result=>{
        captureOutcomes.set(captureId,{captureId,status:'RETURNED',startedAt,completedAt:new Date().toISOString(),
          editionId:result.edition?.id??null,captureStatus:result.capture?.status??null});
        return result;
      },error=>{
        captureOutcomes.set(captureId,{captureId,status:controller.signal.aborted?'INTERRUPTED':'FAILED',
          startedAt,completedAt:new Date().toISOString(),error:publicOperatorError(error)});
        return null;
      }).finally(()=>{if(captureTasks.get(captureId)===entry)captureTasks.delete(captureId);});
    entry.task=task;captureTasks.set(captureId,entry);captureOutcomes.delete(captureId);
    return {captureId,status:'RUNNING',startedAt};
  }
  function startWatchRunner(){
    ensureOpen();if(watchTask||watchAbort.signal.aborted)return watchRunner;
    watchRunner={status:'RUNNING',startedAt:new Date().toISOString(),lastError:null};
    const task=Promise.resolve().then(()=>watches.run({signal:watchAbort.signal})).then(()=>{
      watchRunner={...watchRunner,status:'STOPPED'};
    },error=>{watchRunner={...watchRunner,status:watchAbort.signal.aborted?'STOPPED':'INTERRUPTED',
      lastError:watchAbort.signal.aborted?null:publicOperatorError(error)};}).finally(()=>{if(watchTask===task)watchTask=null;});
    watchTask=task;return watchRunner;
  }
  function runners(){
    return {captures:[...captureTasks].map(([captureId,entry])=>({captureId,status:'RUNNING',startedAt:entry.startedAt})),
      returnedCaptures:[...captureOutcomes.values()],events:{...watchRunner}};
  }
  return {
    directory,indexerDirectory,eventDirectory,workspace,events,watches,eventPublications,startCapture,startWatchRunner,runners,
    async describe(){
      ensureOpen();const [indexer,eventState,watchState]=await Promise.all([workspace.describe(),events.describe(),watches.describe()]);
      return {schema:'stellar-forge.stellar-indexer.operator-state.v1',indexer,events:eventState,watches:watchState,
        runners:runners(),publicationAliases:Object.entries(eventPublications).map(([id,p])=>({id,label:p.label??id})),
        directory,indexerDirectory,eventDirectory};
    },
    publication(aliasName){
      if(aliasName===null)return null;
      alias(aliasName,'publication alias');need(Object.hasOwn(eventPublications,aliasName),'CONNECTION_REQUIRED','Select an existing host publication alias.');
      return {...eventPublications[aliasName]};
    },
    async waitForCapture(captureId){const task=captureTasks.get(captureId)?.task;return task?await task:await workspace.status({captureId});},
    close(){
      if(!closing)closing=(async()=>{
        closed=true;watchAbort.abort(new Error('The operator is stopping.'));
        for(const {controller}of captureTasks.values())controller.abort(new Error('The operator is stopping.'));
        await Promise.allSettled([...captureTasks.values()].map(entry=>entry.task));
        if(watchTask)await watchTask;
        try{if(!options.workspace)await workspace.close();}
        finally{try{if(!options.eventWatches)await watches.close();}
          finally{if(!options.eventWorkspace)await events.close();}}
      })();
      return closing;
    }
  };
}
