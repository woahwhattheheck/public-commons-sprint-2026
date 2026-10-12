// MIT. Exact-request adapter journal; the original HTTP model remains the only writer.
import {mkdir,lstat,open,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {writePrivate} from './host-files.mjs';
import {apiPassPrivateDirectory,readApiPassPrivateFile} from './api-pass-connection.mjs';
import {API_PASS_ID,apiPassNeed,apiPassChecked,apiPassHash,apiPassFingerprint,apiPassPlain,apiPassFailure,apiPassArguments} from './api-pass-protocol.mjs';
const REQUEST='stellar-forge.sf101.api-pass-mcp-operation.v1',STATE='stellar-forge.sf101.api-pass-mcp-operation-state.v1',RESPONSE='stellar-forge.sf101.api-pass-mcp-operation-response.v1';
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const now=()=>new Date().toISOString();
const readJson=async(path,max=4*1024*1024)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readApiPassPrivateFile(path,max)));
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function syncDirectory(path){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}
async function atomic(directory,name,value){
 const temporary=join(directory,'.'+name+'.next');await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
 await writePrivate(temporary,json(value));await rename(temporary,join(directory,name));await syncDirectory(directory);
}
const problem=error=>({code:/^[A-Z][A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'API_PASS_OPERATION_FAILED',status:Number.isInteger(error?.status)?error.status:null,outcomeUnknown:error?.outcomeUnknown===true});
export function apiPassOperationId(kind,wire){return kind==='decide'?'approval-'+apiPassFingerprint(wire):apiPassChecked(wire.operationId,API_PASS_ID,'original operation ID');}
export class ApiPassOperationJournal{
 #definition;#alias;#tail=Promise.resolve();
 constructor(alias,definition){this.#alias=alias;this.#definition=definition;}
 async #locked(work){
  const promise=this.#tail.catch(()=>{}).then(async()=>{
   const root=await apiPassPrivateDirectory(this.#definition.operationDirectory);let lease;
   try{lease=await acquireStateLease(root);}catch(error){throw apiPassFailure(error.message==='FLEET_STATE_ALREADY_OWNED'?'API_PASS_OPERATION_BUSY':'API_PASS_OPERATION_LEASE_UNAVAILABLE','Another adapter currently owns this workspace’s exact-request journal.');}
   try{return await work(root,lease);}finally{await lease.close();}
  });this.#tail=promise;return promise;
 }
 async #record(directory,id){
  const request=await readJson(join(directory,'request.json')),fingerprint=request.requestSha256,{requestSha256,...content}=request;
  apiPassNeed(request.schema===REQUEST&&request.workspace===this.#alias&&request.workspaceId===this.#definition.workspaceId&&request.id===id&&apiPassFingerprint(content)===fingerprint&&apiPassHash(request.bodyJson)===request.bodySha256&&apiPassPlain(request.body)&&JSON.stringify(request.body)===request.bodyJson,'The saved original HTTP operation changed.','API_PASS_OPERATION_CHANGED');
  const normalized=apiPassArguments(request.kind,request.wire);
  apiPassNeed(apiPassFingerprint(normalized)===apiPassFingerprint(request.wire)&&apiPassOperationId(request.kind,request.wire)===id,'The saved original operation fields changed.','API_PASS_OPERATION_CHANGED');
  return request;
 }
 async #state(directory,request){
  if(!await exists(join(directory,'state.json')))return {schema:STATE,requestSha256:request.requestSha256,phase:'PREPARED',createdAt:request.preparedAt,updatedAt:request.preparedAt,attempts:[],error:null};
  const state=await readJson(join(directory,'state.json'));
  apiPassNeed(state.schema===STATE&&state.requestSha256===request.requestSha256&&Array.isArray(state.attempts)&&state.attempts.length<=1000&&['PREPARED','DISPATCHING','ATTENTION','REJECTED','COMPLETE'].includes(state.phase),'The original operation journal state changed.','API_PASS_OPERATION_CHANGED');return state;
 }
 async #response(directory,request){
  if(!await exists(join(directory,'response.json')))return null;
  const result=await readJson(join(directory,'response.json')),copy={...result};delete copy.sha256;
  apiPassNeed(result.schema===RESPONSE&&result.requestSha256===request.requestSha256&&apiPassFingerprint(copy)===result.sha256&&apiPassPlain(result.native)&&apiPassPlain(result.native.result)&&Number.isSafeInteger(result.native.revision),'The retained original response changed.','API_PASS_OPERATION_RESPONSE_CHANGED');
  return result;
 }
 #public(request,state,response){return {id:request.id,kind:request.kind,requestSha256:request.requestSha256,bodySha256:request.bodySha256,workspaceId:request.workspaceId,phase:response?'COMPLETE':state.phase,preparedAt:request.preparedAt,updatedAt:response?.receivedAt??state.updatedAt,
  originalArguments:request.wire,attempts:state.attempts,error:response?null:state.error,result:response?.native??null};}
 async read(id){
  apiPassChecked(id,API_PASS_ID,'retained operation ID');
  return this.#locked(async root=>{
   const directory=join(root,apiPassHash(id));if(!await exists(directory))return {found:false,id,workspaceId:this.#definition.workspaceId};
   await apiPassPrivateDirectory(directory);const request=await this.#record(directory,id),state=await this.#state(directory,request),response=await this.#response(directory,request);
   return {found:true,...this.#public(request,state,response)};
  });
 }
 async run(kind,wire,resolve,send){
  const id=apiPassOperationId(kind,wire);
  return this.#locked(async(root,lease)=>{
   const directory=join(root,apiPassHash(id));
   try{await mkdir(directory,{mode:0o700});await syncDirectory(root);}catch(error){if(error.code!=='EEXIST')throw error;}
   await apiPassPrivateDirectory(directory);let request;
   if(await exists(join(directory,'request.json'))){
    request=await this.#record(directory,id);
    apiPassNeed(request.kind===kind&&apiPassFingerprint(request.wire)===apiPassFingerprint(wire),'This operation ID already belongs to different original arguments. Continue the saved request or prepare a separately reviewed action.','API_PASS_OPERATION_ID_REUSED');
   }else{
    const plan=await resolve(),bodyJson=JSON.stringify(plan.body);
    apiPassNeed(apiPassPlain(plan.body)&&typeof plan.route==='string'&&plan.route.startsWith('/api/')&&Buffer.byteLength(bodyJson)<=Math.ceil(1048576/3)*4+131072,'The original resolved HTTP request is invalid.','API_PASS_OPERATION_REQUEST_INVALID');
    const content={schema:REQUEST,id,workspace:this.#alias,workspaceId:this.#definition.workspaceId,kind,wire,route:plan.route,body:plan.body,bodyJson,bodySha256:apiPassHash(bodyJson),binding:plan.binding??null,preparedAt:now()};
    request={...content,requestSha256:apiPassFingerprint(content)};
    lease.assertHeld();await atomic(directory,'request.json',request);
   }
   let state=await this.#state(directory,request),response=await this.#response(directory,request);
   if(response)return {...response.native,operation:{id,requestSha256:request.requestSha256,phase:'COMPLETE',replayed:true}};
   apiPassNeed(state.phase!=='COMPLETE','A completed original operation has lost its saved response. Preserve this journal and reopen its original workspace record.','API_PASS_OPERATION_RESPONSE_MISSING');
   apiPassNeed(state.attempts.length<1000,'This retained operation has reached its dispatch-history limit.','API_PASS_OPERATION_ATTEMPT_LIMIT');
   const attempt={number:state.attempts.length+1,startedAt:now(),finishedAt:null,error:null};
   state={...state,phase:'DISPATCHING',updatedAt:attempt.startedAt,error:null,attempts:[...state.attempts,attempt]};
   lease.assertHeld();await atomic(directory,'state.json',state);
   try{
    const native=await send(request);
    const content={schema:RESPONSE,requestSha256:request.requestSha256,receivedAt:now(),native};response={...content,sha256:apiPassFingerprint(content)};
    lease.assertHeld();await atomic(directory,'response.json',response);
    const complete={...state,phase:'COMPLETE',updatedAt:response.receivedAt,error:null,attempts:state.attempts.map((item,index)=>index===state.attempts.length-1?{...item,finishedAt:response.receivedAt}:item)};
    lease.assertHeld();await atomic(directory,'state.json',complete);
    return {...native,operation:{id,requestSha256:request.requestSha256,phase:'COMPLETE',replayed:false}};
   }catch(error){
    // A named response survives a failed later state write. It remains complete;
    // the next read/run authenticates it before dispatching anything.
    if(response)throw apiPassFailure('API_PASS_OPERATION_SAVE_UNCERTAIN','The original response was received; reopen this exact operation journal.',{outcomeUnknown:true,operationId:id,requestSha256:request.requestSha256});
    const recorded=problem(error),finishedAt=now(),next={...state,phase:recorded.outcomeUnknown?'ATTENTION':'REJECTED',updatedAt:finishedAt,error:recorded,
     attempts:state.attempts.map((item,index)=>index===state.attempts.length-1?{...item,finishedAt,error:recorded}:item)};
    try{lease.assertHeld();await atomic(directory,'state.json',next);}catch{error.journalWriteUncertain=true;}
    error.operationId=id;error.requestSha256=request.requestSha256;throw error;
   }
  });
 }
 async close(){await this.#tail.catch(()=>{});}
}
