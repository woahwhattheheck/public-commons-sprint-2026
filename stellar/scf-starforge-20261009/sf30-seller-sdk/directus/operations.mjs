// MIT. Directus native operations share the original retained workspace journal.
import {captureDirectusSource,createDirectusDraft,saveDirectusDraft,compareDirectusDraft,promoteDirectusDraft,readDirectusItem} from './native.mjs';
import {canonical,hash,object,fault,MAX_SOURCE_BYTES} from './source.mjs';

const METHODS={
  capture:{run:captureDirectusSource,keys:['collection','query','name','pageSize']},
  'draft-create':{run:createDirectusDraft,keys:['collection','item','key','name']},
  'draft-save':{run:saveDirectusDraft,keys:['versionId','patch','patchJson','patchRevision']},
  'draft-compare':{run:compareDirectusDraft,keys:['versionId']},
  'draft-promote':{run:promoteDirectusDraft,keys:['versionId','mainHash','fields','expectedVersionSha256']},
  'item-read':{run:readDirectusItem,keys:['collection','item','fields']}
};
export const DIRECTUS_NATIVE_ACTIONS=Object.freeze(Object.keys(METHODS));
const ID=/^[A-Za-z0-9_.:-]{8,128}$/;
export function directusOperationInput(action,input){
  const method=Object.hasOwn(METHODS,action)?METHODS[action]:null;
  if(!method||!object(input))throw fault('DIRECTUS_NATIVE_ACTION','Choose a Directus capture, draft, compare, promotion or item read.');
  if(!ID.test(input.operationId??'')||typeof input.actor!=='string'||!input.actor.trim()||input.actor.length>256)
    throw fault('DIRECTUS_NATIVE_REQUEST','Retain an operation ID and the operator making this change.');
  const allowed=['operationId','actor','timeoutMs',...method.keys];
  if(Object.keys(input).some(key=>!allowed.includes(key)))
    throw fault('DIRECTUS_NATIVE_INPUT','Use the named inputs for this Directus operation.');
  return structuredClone(input);
}
export function directusCaptureImportId(operationId){return 'capture-import-'+hash(operationId).slice(0,48);}
export async function performDirectusOperation({workspace,connection,action,input,fetchImpl}={}){
  input=directusOperationInput(action,input);
  if(!object(connection)||typeof connection.baseUrl!=='string'||!connection.baseUrl)
    throw fault('DIRECTUS_CONNECTION','Configure the original Directus API connection.');
  const {actor,...args}=input,history=workspace.nativeHistory(input.operationId);
  const native=await METHODS[action].run({...args,baseUrl:connection.baseUrl,token:connection.token,
    history,onEvent:event=>workspace.recordNativeEvent(event,{actor}),...(fetchImpl?{fetchImpl}:{})});
  if(action!=='capture')return {action,operationId:input.operationId,native};
  const raw=Buffer.isBuffer(native.bytes)?native.bytes:Buffer.from(native.bytes);
  if(raw.length>MAX_SOURCE_BYTES)throw fault('DIRECTUS_SOURCE_SIZE','The complete source exceeds the retained capture limit.',413);
  const importId=directusCaptureImportId(input.operationId),sha256=hash(raw);
  let previous;
  try{previous=workspace.operation(importId);}catch(error){if(error.code!=='DIRECTUS_OPERATION_MISSING')throw error;}
  let retained;
  if(previous){
    if(previous.input.action!=='import-source'||previous.input.sourceBase64?.sha256!==sha256||
        previous.input.sourceBase64?.bytes!==raw.length||
        canonical(previous.input.nativeOperationIds)!==canonical([input.operationId]))
      throw fault('DIRECTUS_CAPTURE_IMPORT_CHANGED','The original capture import belongs to different native bytes.',409);
    retained={...previous.result,replayed:true};
  }else retained=await workspace.dispatch('import-source',{actor,operationId:importId,
    expectedRevision:workspace.revision(),nativeOperationIds:[input.operationId],sourceBase64:raw.toString('base64')});
  return {action,operationId:input.operationId,source:retained.source,import:retained,
    capture:{bytes:raw.length,sha256},native_history:workspace.nativeHistory(input.operationId).length};
}
/** Active HTTP calls are borrowed by the local operator; restart continues the same
 * persisted operation history through performDirectusOperation. */
export class DirectusOperations{
  constructor(){this.jobs=new Map();this.closed=false;}
  get active(){return [...this.jobs.values()].filter(job=>job.state==='running').length;}
  describe(workspace,operationId){
    const job=this.jobs.get(workspace.state().id+'\n'+operationId);
    if(job&&job.workspaceId===workspace.state().id)return {operationId,state:job.state,action:job.action,
      ...(job.result?{result:job.result}:{}),...(job.error?{error:job.error}:{})};
    const history=workspace.nativeHistory(operationId),last=history.at(-1);
    if(!last)throw fault('DIRECTUS_OPERATION_MISSING','This original native operation has no retained events.',404);
    const capture=history[0].action==='capture';
    let imported=false;
    if(capture)try{workspace.operation(directusCaptureImportId(operationId));imported=true;}catch(error){if(error.code!=='DIRECTUS_OPERATION_MISSING')throw error;}
    return {operationId,action:last.action,state:last.phase==='complete'&&(!capture||imported)?'complete':'resumable',
      last_phase:last.phase,event_count:history.length,result:last.result};
  }
  start({workspace,connection,action,input,fetchImpl}){
    if(this.closed)throw fault('DIRECTUS_OPERATOR_CLOSING','The operator is closing.',409);
    input=directusOperationInput(action,input);
    const workspaceId=workspace.state().id,identity=hash(canonical({workspaceId,baseUrl:connection.baseUrl,action,input}));
    const key=workspaceId+'\n'+input.operationId,previous=this.jobs.get(key);
    if(previous){
      if(previous.identity!==identity)throw fault('DIRECTUS_NATIVE_REQUEST_CHANGED','This original operation has different inputs.',409);
      if(previous.state!=='failed')return this.describe(workspace,input.operationId);
    }
    const job={identity,workspaceId,action,state:'running'};this.jobs.set(key,job);
    job.pending=performDirectusOperation({workspace,connection:{...connection},action,input,fetchImpl}).then(
      result=>{job.state='complete';job.result=result;},
      error=>{job.state='failed';job.error={code:error.code??'DIRECTUS_NATIVE_FAILURE',message:error.message};});
    return this.describe(workspace,input.operationId);
  }
  async close(){this.closed=true;await Promise.allSettled([...this.jobs.values()].map(job=>job.pending));}
}
