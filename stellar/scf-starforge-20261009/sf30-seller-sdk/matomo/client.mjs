// MIT. Native Matomo MCP client; all effects remain in the original host owner.
import {openMerchantFileClient} from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {matomoWorkspaceTools,MATOMO_MUTATIONS} from '../../../../stellar-forge/mcp-merchant-operator/catalog/matomo-workspace.mjs';

const INTERNAL=Symbol('MatomoClient');
const READ_ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
function fail(code,message,details){return Object.assign(new Error(message),{code,...details});}
function freeze(value){
  if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}
  return value;
}
/** Metadata is obtained from the same source-owned 52-tool declaration as the host. */
export const MATOMO_CLIENT_TOOLS=freeze(matomoWorkspaceTools((name,description,properties,required,annotations)=>({
  name,description,inputSchema:{type:'object',additionalProperties:false,properties,required},annotations
})).map(value=>JSON.parse(JSON.stringify(value))));
const names=new Set(MATOMO_CLIENT_TOOLS.map(value=>value.name));
const mutations=new Set(Object.keys(MATOMO_MUTATIONS).map(name=>'merchant_matomo_'+name));
function jsonSnapshot(value){
  const seen=new Set();
  function visit(item,depth){
    if(depth>64)throw fail('MATOMO_CLIENT_ARGUMENTS','Use a bounded native JSON argument document.');
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'&&Number.isFinite(item))return;
    if(!Array.isArray(item)&&!plain(item))throw fail('MATOMO_CLIENT_ARGUMENTS',
      'Arguments must contain only JSON values. Preserve exact source numbers in their native typed representation.');
    if(Array.isArray(item)&&(Object.keys(item).length!==item.length||Object.keys(item).some((key,index)=>key!==String(index))))
      throw fail('MATOMO_CLIENT_ARGUMENTS','Use ordinary dense JSON arrays without extra properties.');
    if(seen.has(item))throw fail('MATOMO_CLIENT_ARGUMENTS','A native request cannot contain cyclic values.');
    seen.add(item);for(const child of Object.values(item))visit(child,depth+1);seen.delete(item);
  }
  visit(value,0);return JSON.parse(JSON.stringify(value));
}
function timeout(value,fallback){
  value??=fallback;
  if(!Number.isSafeInteger(value)||value<1||value>3600000)
    throw fail('MATOMO_CLIENT_TIMEOUT','Use an explicit timeout from 1 to 3600000 milliseconds.');
  return value;
}
function combined(signals){const values=signals.filter(Boolean);return values.length===1?values[0]:AbortSignal.any(values);}

/**
 * A client owns its outgoing requests and retained-read handles, never the remote
 * workspace itself. closeWorkspace is an explicit native command. close() aborts
 * this client's pending HTTP reads/calls, drains them, and releases known file
 * reads; an interrupted mutation must be reconciled by its original operation ID.
 */
export class MatomoClient{
  #transport;#controller;#signal;#pending=new Set();#reads=new Map();
  #closing=false;#closePromise=null;#timeout;
  constructor(key,transport,controller,signal,timeoutMs){
    if(key!==INTERNAL)throw fail('MATOMO_CLIENT_CONFIGURATION','Use connectMatomoClient to select the original MCP endpoint.');
    this.#transport=transport;this.#controller=controller;this.#signal=signal;this.#timeout=timeoutMs;
  }
  get endpoint(){return this.#transport.endpoint;}
  get pendingRequests(){return this.#pending.size;}
  get retainedReads(){return [...this.#reads].map(([readId,workspace])=>({readId,workspace}));}
  get closing(){return this.#closing;}
  async call(name,args={},options={}){
    if(this.#closing)throw fail('MATOMO_CLIENT_CLOSING','This client is closing; reconnect before new native work.');
    if(!names.has(name))throw fail('MATOMO_CLIENT_TOOL','Choose an exact original Matomo tool from MATOMO_CLIENT_TOOLS.');
    if(!plain(args)||!plain(options)||Object.keys(options).some(key=>!['signal','timeoutMs'].includes(key)))
      throw fail('MATOMO_CLIENT_ARGUMENTS','Supply one native argument object and optional signal/timeoutMs.');
    const snapshot=jsonSnapshot(args);
    const envelope=JSON.stringify({jsonrpc:'2.0',id:Number.MAX_SAFE_INTEGER,method:'tools/call',
      params:{name,arguments:snapshot}});
    if(Buffer.byteLength(envelope)>131072)
      throw fail('MATOMO_CLIENT_REQUEST_TOO_LARGE','The complete native request exceeds the Matomo host 128 KiB limit.');
    const requestSignal=combined([this.#signal,options.signal]);
    requestSignal.throwIfAborted();
    const timeoutMs=timeout(options.timeoutMs,this.#timeout);
    const pending=Promise.resolve().then(async()=>{
      try{
        const result=await this.#transport.call(name,snapshot,{requestSignal,timeoutMs});
        if(name==='merchant_matomo_artifact_read'){
          if(!READ_ID.test(result?.readId??''))
            throw fail('MATOMO_CLIENT_REPLY_INVALID','The original artifact response omitted its retained read identity.');
          if(result.nextOffset===null)this.#reads.delete(result.readId);
          else this.#reads.set(result.readId,snapshot.workspace);
        }else if(name==='merchant_matomo_artifact_release')this.#reads.delete(snapshot.readId);
        else if(name==='merchant_matomo_close'){
          for(const [id,workspace] of this.#reads)if(workspace===snapshot.workspace)this.#reads.delete(id);
        }
        return result;
      }catch(issue){
        const error=issue instanceof Error?issue:fail('MATOMO_CLIENT_REQUEST_FAILED','The original request did not return a complete response.');
        if(mutations.has(name)&&typeof snapshot.operationId==='string'){
          error.matomoOperation={tool:name,workspace:snapshot.workspace,operationId:snapshot.operationId,
            expectedRevision:snapshot.expectedRevision,workspaceInstanceId:snapshot.workspaceInstanceId,
            next:'Read merchant_matomo_operation for this exact operation before choosing native recovery.'};
        }
        throw error;
      }
    });
    this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  workspaces(options){return this.call('merchant_matomo_workspaces',{},options);}
  openWorkspace(workspace,options){return this.call('merchant_matomo_open',{workspace},options);}
  status(workspace,options){return this.call('merchant_matomo_status',{workspace},options);}
  operation(workspace,operationId,options){return this.call('merchant_matomo_operation',{workspace,operationId},options);}
  closeWorkspace(workspace,instanceId,options){return this.call('merchant_matomo_close',{workspace,instanceId},options);}
  /** Release even after cancellation, using the same original idempotent control. */
  async releaseArtifact(workspace,readId){
    if(!READ_ID.test(readId??''))throw fail('MATOMO_CLIENT_READ_ID','Use an inspected native artifact read ID.');
    const pending=Promise.resolve().then(async()=>{
      try{
        const result=await this.#transport.call('merchant_matomo_artifact_release',{workspace,readId},
          {requestSignal:null,timeoutMs:2000});
        this.#reads.delete(readId);return result;
      }catch(error){
        // A missing original owner has completed its own retained-reader drain.
        if(error?.code==='MATOMO_WORKSPACE_NOT_OPEN'){this.#reads.delete(readId);return {workspace,released:readId,ownerClosed:true};}
        this.#reads.set(readId,workspace);throw error;
      }
    });
    this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  close(){
    if(!this.#closePromise){
      this.#closing=true;this.#controller.abort();
      const pending=(async()=>{
        while(this.#pending.size)await Promise.allSettled([...this.#pending]);
        const results=await Promise.allSettled([...this.#reads].map(([id,workspace])=>this.releaseArtifact(workspace,id)));
        const failed=results.filter(value=>value.status==='rejected');
        if(failed.length)throw fail('MATOMO_CLIENT_CLOSE_INCOMPLETE',
          'Known original artifact reads remain owned. Retry close on this same client.',
          {causes:failed.map(value=>({code:value.reason?.code??'ARTIFACT_RELEASE_FAILED'}))});
      })();
      this.#closePromise=pending;
      void pending.catch(()=>{if(this.#closePromise===pending)this.#closePromise=null;});
    }
    return this.#closePromise;
  }
}
/** Reuses the maintained MCP authentication, framing, reply limit and HTTP transport. */
export async function connectMatomoClient({url,tokenEnv='MCP_ACCESS_TOKEN',environment=process.env,signal,timeoutMs=120000}={}){
  const controller=new AbortController(),selected=combined([controller.signal,signal]);
  timeoutMs=timeout(timeoutMs,120000);
  try{
    const transport=await openMerchantFileClient({url,tokenEnv,environment,signal:combined([selected,AbortSignal.timeout(timeoutMs)]),
      errorPrefix:'MATOMO_CLIENT',clientName:'starforge-matomo-client'});
    return new MatomoClient(INTERNAL,transport,controller,selected,timeoutMs);
  }catch(error){controller.abort();throw error;}
}
