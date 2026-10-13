// MIT. Borrow the installed Source Monitoring HTTP owner; preserve native inputs and outputs.
import {MonitoringClient} from './client.mjs';
import {RetainedFileReads} from '../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {validateMonitoringArguments} from './catalog.mjs';
import {MonitoringAgentFiles,readSourceMonitoringConfiguration,snapshot,need,plain,MAX_INPUT,MAX_OBJECT,MAX_ARCHIVE,hash} from './agent-files.mjs';
export {readSourceMonitoringConfiguration,validateSourceMonitoringConfiguration} from './agent-files.mjs';
export const AGENT_RESULT_SCHEMA='stellar-forge.source-monitoring-agent-result.v1';
const INLINE=32768;
const selection=file=>({kind:'retained',sha256:file.sha256,bytes:file.bytes});
const scopedKey=scope=>JSON.stringify([scope.workspace,scope.expectedWorkspace,scope.expectedBindingSha256]);
export class MerchantSourceMonitoring{
 #configuration;#files;#reads=new RetainedFileReads({errorPrefix:'MONITORING_AGENT',maxImmutableFileBytes:MAX_ARCHIVE});
 #pending=new Set();#closing=false;#closePromise;
 constructor(config){
  need(config?.sourceMonitoring,'CONFIGURATION','Configure the original Source Monitoring connection first.');
  this.#configuration=structuredClone(config.sourceMonitoring);this.#files=new MonitoringAgentFiles(this.#configuration.storageDirectory);
 }
 get summary(){
  const c=this.#configuration;
  return {configured:true,closing:this.#closing,
   workspaces:Object.entries(c.workspaces).map(([workspace,v])=>({workspace,label:v.label,expectedWorkspace:v.expectedWorkspace,expectedBindingSha256:v.expectedBindingSha256,connection:'ORIGINAL_PRIVATE_FILE'})),
   files:Object.entries(c.files).map(([alias,v])=>({alias,name:v.name,media:v.media,sourceUrl:v.sourceUrl,bytes:v.bytes,sha256:v.sha256})),
   ...this.#reads.summary};
 }
 #configured(scope){
  const value=this.#configuration.workspaces[scope.workspace];
  need(value&&scope.expectedWorkspace===value.expectedWorkspace&&scope.expectedBindingSha256===value.expectedBindingSha256,'BRANCH_CHANGED','Select the configured original physical workspace and source binding.');
  return value;
 }
 #selectedFile(alias,bytes,sha256,maximum){
  const file=this.#configuration.files[alias];
  need(file&&file.bytes===bytes&&file.sha256===sha256&&bytes<=maximum,'FILE_CHANGED','Select the complete host-declared original file and its exact identity.');
  return file;
 }
 async #metadata(scope,value){
  return selection(await this.#files.retain(scope,Buffer.from(JSON.stringify(value),'utf8')));
 }
 async #request(scope,operation,input,selectedInput=null){
  // Complete intent before dispatch; native request IDs remain inside the exact input.
  // This deterministic file is evidence of preparation, never evidence of a commit.
  return this.#metadata(scope,{schema:'stellar-forge.source-monitoring-agent-request.v1',
   scope,operation,input:selection(input),selectedInput,
   nativeIdentity:'Original native request identity remains in the exact input bytes; no agent request ID is minted.'});
 }
 async #reply(scope,operation,reply,input=null,extra={}){
  const retained=await this.#files.retain(scope,reply.raw);
  need(retained.sha256===reply.sha256,'RESPONSE_CHANGED','The complete original response differs from the client identity.');
  const metadata=await this.#metadata(scope,{schema:'stellar-forge.source-monitoring-agent-http.v1',
   scope,operation,request:extra.request??null,status:reply.status,headers:{...reply.headers},body:selection(retained)});
  return {schema:AGENT_RESULT_SCHEMA,status:'NATIVE_RESPONSE',scope,operation,...extra,
   input:input?selection(input):null,
   response:{status:reply.status,headers:{...reply.headers},metadata,bytes:retained.bytes,sha256:retained.sha256,selection:selection(retained),
    inline:reply.raw.length<=INLINE,rawJson:reply.raw.length<=INLINE?reply.raw.toString('utf8'):null,
    instruction:reply.raw.length<=INLINE?'Complete original JSON text.':'Read every chunk of response.selection for the complete original JSON; no rows or fields were removed.'}};
 }
 async #failure(scope,operation,error,input=null,extra={},dispatched=false){
  const detail=error?.detail??{},raw=typeof detail.responseBase64==='string'?Buffer.from(detail.responseBase64,'base64'):null;
  const mutating=['command','upload','receive_archive'].includes(extra.agentAction);
  const uncertain=dispatched&&mutating?(typeof detail.uncertain==='boolean'?detail.uncertain:true):false;
  let response=null;
  if(raw){
   need(hash(raw)===detail.responseSha256,'RESPONSE_CHANGED','The original native error bytes changed.');
   const saved=await this.#files.retain(scope,raw);
   const metadata=await this.#metadata(scope,{schema:'stellar-forge.source-monitoring-agent-http.v1',
    scope,operation,request:extra.request??null,status:detail.status??null,headers:detail.responseHeaders??{},body:selection(saved)});
   response={status:detail.status??null,headers:detail.responseHeaders??{},metadata,...selection(saved),rawJson:raw.length<=INLINE?raw.toString('utf8'):null};
  }
  const safe={...detail};delete safe.responseBase64;
  const summary=Object.fromEntries(['status','method','path','transportCode','responseComplete','responseSha256'].filter(k=>Object.hasOwn(detail,k)).map(k=>[k,detail[k]]));
  const evidence=Buffer.from(JSON.stringify({code:error.code??'MONITORING_AGENT_ERROR',message:error.message,dispatched,uncertain,request:extra.request??null,detail:safe,response}), 'utf8');
  const retained=await this.#files.retain(scope,evidence);
  return {schema:AGENT_RESULT_SCHEMA,status:'NATIVE_ERROR',scope,operation,...extra,input:input?selection(input):null,
   error:{code:error.code??'MONITORING_AGENT_ERROR',message:error.message,dispatched,uncertain,detail:summary,evidence:selection(retained)},response,
   instruction:dispatched?(mutating?'Read the complete original error and recover the same retained native request. Do not mint another UUID or automatically retry a native write.':'Read the complete retained original error. This read-only operation did not submit a native business command.'):'The original native request was not invoked. Correct the reported input or configuration before submitting it.'};
 }
 async #run(name,args){
  if(name==='merchant_monitoring_workspaces')return this.summary;
  const scope=args.scope,configured=this.#configured(scope),action=name.slice('merchant_monitoring_'.length),key=scopedKey(scope);
  if(action==='file_release'){await this.#reads.release(key,args.readId);return {released:true,readId:args.readId,scope};}
  if(action==='file_read'&&args.selection.kind==='retained'){
   const file=args.selection;
   return this.#reads.read({scope:key,key:JSON.stringify(args.selection),kind:'SOURCE_MONITORING',directory:this.#configuration.storageDirectory,
    expectedSha256:args.expectedSha256??file.sha256,readId:args.readId,offset:args.offset??0,limit:args.limit??65536,load:()=>this.#files.reader(scope,file)});
  }
  const client=new MonitoringClient(configured);
  let input=null,operation=action,extra={agentAction:action},dispatched=false;
  try{
   if(action==='inspect'){dispatched=true;return {schema:AGENT_RESULT_SCHEMA,status:'CONNECTED',scope,identity:await client.inspect()};}
   if(action==='read'){operation=args.operation;dispatched=true;return await this.#reply(scope,operation,await client.get(operation,args.parameters??{}),null,extra);}
   if(action==='command'){
    operation=args.operation;
    if(args.inputFile){
     const declared=this.#selectedFile(args.inputFile.alias,args.inputFile.bytes,args.inputFile.sha256,MAX_INPUT);
     input=await this.#files.selected(scope,declared,MAX_INPUT);
     extra={agentAction:action,selectedInput:{alias:args.inputFile.alias,bytes:declared.bytes,sha256:declared.sha256,name:declared.name,media:declared.media}};
    }else input=await this.#files.retain(scope,Buffer.from(args.jsonText,'utf8'));
    const raw=await this.#files.bytes(scope,input,MAX_INPUT);
    let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{need(false,'INPUT','The original command must contain complete UTF-8 JSON.');}
    need(plain(parsed),'INPUT','The original command must be a complete JSON object.');
    extra.request=await this.#request(scope,operation,input,extra.selectedInput??null);
    dispatched=true;
    return await this.#reply(scope,operation,await client.post(operation,raw),input,extra);
   }
   if(action==='upload'||action==='receive_archive'){
    const declared=this.#selectedFile(args.fileAlias,args.bytes,args.sha256,action==='upload'?MAX_OBJECT:MAX_ARCHIVE);
    input=await this.#files.selected(scope,declared,action==='upload'?MAX_OBJECT:MAX_ARCHIVE);
    const actual={name:args.name??declared.name,media:args.media??declared.media,sourceUrl:args.sourceUrl??declared.sourceUrl};
    extra={agentAction:action,selectedInput:{alias:args.fileAlias,bytes:declared.bytes,sha256:declared.sha256,...actual}};
    extra.request=await this.#request(scope,operation,input,extra.selectedInput);
    dispatched=true;
    const reply=action==='upload'?await client.upload(input.path,actual):await client.receiveArchive(input.path);
    // A deduplicated native object may retain its first name/media. The selected
    // original file metadata above remains separately available to the caller.
    return await this.#reply(scope,operation,reply,input,extra);
   }
   if(action==='download'){
    dispatched=true;
    const file=await this.#files.acquire(scope,client,args.selection);
    return {schema:AGENT_RESULT_SCHEMA,status:'FILE_RETAINED',scope,originalSelection:args.selection,file:{selection:selection(file),bytes:file.bytes,sha256:file.sha256}};
   }
   if(action==='file_read'){
    const selected=args.selection;
    return await this.#reads.read({scope:key,key:JSON.stringify(selected),kind:'SOURCE_MONITORING',directory:this.#configuration.storageDirectory,
     expectedSha256:args.expectedSha256??selected.sha256??(['object','source'].includes(selected.kind)?selected.id:undefined),
     readId:args.readId,offset:args.offset??0,limit:args.limit??65536,
     load:async()=>{dispatched=true;const file=await this.#files.acquire(scope,client,selected);return this.#files.reader(scope,file);}});
   }
   need(false,'TOOL','Choose an advertised Source Monitoring operation.');
  }catch(error){
   return this.#failure(scope,operation,error,input,extra,dispatched);
  }finally{await client.close();}
 }
 call(name,args={}){
  need(!this.#closing,'CLOSING','This borrowed agent provider is closing.');
  const frozen=snapshot(args);validateMonitoringArguments(name,frozen);
  const promise=Promise.resolve().then(()=>this.#run(name,frozen));
  this.#pending.add(promise);promise.then(()=>this.#pending.delete(promise),()=>this.#pending.delete(promise));return promise;
 }
 close(){
  this.#closing=true;
  return this.#closePromise??=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();})().catch(error=>{this.#closePromise=null;throw error;});
 }
}
