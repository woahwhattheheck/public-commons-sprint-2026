// MIT. Installed Cryptoworth client over the existing merchant MCP connection.
import {openMerchantFileClient} from './retained-download.mjs';
import {createAccountingMaintenanceClient} from './accounting-maintenance-client.mjs';
import {cwCanonical,cwHash,cwText,cwId,cwInstant} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/cryptoworth-csv.mjs';
import {CRYPTOWORTH_TOOL_PREFIX,CRYPTOWORTH_REQUEST_FIELDS,cryptoworthPreviewBinding} from './accounting-cryptoworth-contract.mjs';
const PREFIX=CRYPTOWORTH_TOOL_PREFIX,SHA=/^[a-f0-9]{64}$/,NATIVE_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),copy=value=>structuredClone(value);
const digest=value=>cwHash(cwCanonical(value));
const fail=(code,message)=>Object.assign(new Error(message),{code:'ACCOUNTING_CRYPTOWORTH_CLIENT_'+code});
function need(ok,message,code='ARGUMENTS'){if(!ok)throw fail(code,message);}
function exact(value,fields){need(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),'Use only the original declared operation fields.');}
function revision(value){need(Number.isSafeInteger(value)&&value>=1,'Use the current original workspace revision.');return value;}
function identifier(value,pattern,label){need(typeof value==='string'&&pattern.test(value),'Use the exact '+label+'.');return value;}
function sourceReferences(kind,request){
  return kind==='plan'?(request.dateEvidence??[]).map(value=>value.file):['profile','capture'].includes(kind)?[request.file]:[];
}
function sourceFile(value){
  exact(value,['source','name','sha256','bytes']);
  identifier(value.source,/^[a-z0-9][a-z0-9_-]{0,63}$/,'configured input alias');identifier(value.sha256,SHA,'reviewed input SHA256');
  need(typeof value.name==='string'&&value.name.length>0&&value.name.length<=240&&!/[\\/\r\n\0]/.test(value.name)&&!['.','..'].includes(value.name),
    'Keep the reviewed original filename.');
  need(Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=128*1024*1024,'Keep the complete original byte count.');return value;
}
export function accountingCryptoworthPreview(value){
  need(plain(value)&&Object.hasOwn(CRYPTOWORTH_REQUEST_FIELDS,value.kind)&&plain(value.request),'Retain the complete original native preview.','PREVIEW');
  identifier(value.workspaceId,SHA,'original workspace ID');identifier(value.previewSha256,SHA,'native preview SHA256');
  identifier(value.requestSha256,SHA,'native request SHA256');identifier(value.wireSha256,SHA,'complete preview wire SHA256');revision(value.workspaceRevision);
  exact(value.request,CRYPTOWORTH_REQUEST_FIELDS[value.kind]);identifier(value.request.id,NATIVE_ID,'native request ID');
  need(typeof value.request.createdAt==='string'&&Number.isFinite(Date.parse(value.request.createdAt)),'Keep the native creation timestamp.','PREVIEW');
  if(['capture','return'].includes(value.kind))identifier(value.planId,NATIVE_ID,'original receiving plan ID');
  else need(value.planId===undefined,'This reviewed operation does not select another receiving plan.','PREVIEW_BINDING');
  for(const file of sourceReferences(value.kind,value.request))sourceFile(file);
  need(digest(cryptoworthPreviewBinding(value))===value.wireSha256,'The complete reviewed request changed. Reopen its original preview.','PREVIEW_BINDING');
  const native={profile:value.profile,plan:value.plan,capture:value.comparison}[value.kind];
  if(native)need(native.id===value.request.id&&native.integrity?.sha256===value.previewSha256,
    'The native document differs from its reviewed ID or integrity.','PREVIEW_BINDING');
  return value;
}
export function accountingCryptoworthSaveArguments(preview){
  accountingCryptoworthPreview(preview);
  return {workspaceId:preview.workspaceId,...(preview.planId?{planId:preview.planId}:{}),
    request:{...copy(preview.request),revision:preview.workspaceRevision,previewSha256:preview.previewSha256}};
}
export function accountingCryptoworthRollbackArguments(value){
  exact(value,['workspaceId','planId','request']);identifier(value.workspaceId,SHA,'original workspace ID');cwId(value.planId);
  exact(value.request,['id','captureId','nativeImportId','completedAt','actor','reason','reference','revision']);
  const v=value.request;
  return {workspaceId:value.workspaceId,planId:value.planId,request:{id:cwId(v.id),captureId:cwId(v.captureId),
    nativeImportId:cwText(v.nativeImportId,'actual native import ID',240),completedAt:cwInstant(v.completedAt,'actual rollback completion'),
    actor:cwText(v.actor,'operator',1000),reason:cwText(v.reason,'rollback reason',4000),reference:cwText(v.reference,'actual rollback reference',2000),
    revision:revision(v.revision)}};
}
export function accountingCryptoworthPacketArguments(inspection,{actor,name,revision:currentRevision=inspection?.revision}={}){
  need(plain(inspection)&&inspection.schema==='stellar-forge.cryptoworth-receiving-packet.v1',
    'Retain the original complete packet inspection.','PACKET');
  identifier(inspection.workspaceId,SHA,'receiving workspace ID');identifier(inspection.sha256,SHA,'input packet SHA256');
  identifier(inspection.packetSha256,SHA,'sealed packet SHA256');identifier(inspection.planId,NATIVE_ID,'receiving plan ID');sourceFile(inspection.file);
  need(inspection.file.sha256===inspection.sha256&&inspection.file.bytes===inspection.bytes,'The original packet inspection and input reference differ.','PACKET_BINDING');
  return {workspaceId:inspection.workspaceId,file:copy(inspection.file),revision:revision(currentRevision),actor:cwText(actor,'receiving operator',1000),
    name:cwText(name??inspection.name,'packet name',240),expectedSha256:inspection.sha256,expectedPacketSha256:inspection.packetSha256};
}
function sameWorkspace(result,workspaceId){
  need(plain(result)&&result.workspaceId===workspaceId,'This endpoint now belongs to a different original workspace.','WORKSPACE_CHANGED');
}
function originalRecord(result,preview){
  sameWorkspace(result,preview.workspaceId);
  need(plain(result.record)&&result.record.id===preview.request.id&&result.record.requestSha256===preview.requestSha256&&
    result.record.previewSha256===preview.previewSha256,'The retained native ID belongs to another original request.','REQUEST_BINDING');
  if(preview.kind==='return')need(['PREPARED','COMMITTED','SUPERSEDED'].includes(result.record.status),'The original accountant return has no retained state.','REPLY');
  return result;
}
function missing(error,kind){
  const codes={profile:'CRYPTOWORTH_PROFILE_NOT_FOUND',plan:'CRYPTOWORTH_PLAN_NOT_FOUND',capture:'CRYPTOWORTH_CAPTURE_NOT_FOUND',return:'CRYPTOWORTH_RETURN_NOT_FOUND',rollback:'CRYPTOWORTH_ROLLBACK_NOT_FOUND'};
  return error?.code===codes[kind]||String(error?.code??'').endsWith('_'+codes[kind]);
}
export function createAccountingCryptoworthClient({workspace,call}={}){
  identifier(workspace,/^[a-z0-9][a-z0-9_-]{0,63}$/,'configured accounting workspace alias');
  need(typeof call==='function','Provide the existing structured merchant MCP call.');
  const maintenance=createAccountingMaintenanceClient({workspace,call}),pending=new Set();
  let closed=false,transitioning=false,closePromise;
  const accepting=()=>need(!closed&&!transitioning,'This accounting caller is draining or closed.','CLOSED');
  async function tracked(work){
    accepting();const promise=Promise.resolve().then(work);pending.add(promise);
    try{return await promise;}finally{pending.delete(promise);}
  }
  function invoke(name,args={},options){
    need(plain(args)&&!Object.hasOwn(args,'workspace'),'Use this client’s selected workspace alias.');
    return tracked(async()=>{
      const value=await call(name,{...copy(args),workspace},options);
      need(plain(value),'The original merchant returned no structured result.','REPLY');return value;
    });
  }
  async function transition(work,permanent=false){
    accepting();transitioning=true;
    try{await Promise.allSettled([...pending]);return await work();}
    finally{transitioning=false;if(permanent)closed=true;}
  }
  async function all(fetch,view,{rows=false}={}){
    const items=[];let offset=0,observedRevision,workspaceId,total;
    for(;;){
      const result=await fetch(offset),value=rows?result:result.page;
      need(plain(value)&&Array.isArray(value.items)&&value.offset===offset&&Number.isSafeInteger(rows?value.totalRows:value.total),
        'The original native page is incomplete.','PAGE');
      observedRevision??=result.revision;workspaceId??=result.workspaceId;total??=rows?value.totalRows:value.total;
      revision(observedRevision);identifier(workspaceId,SHA,'original workspace ID');
      need(result.revision===observedRevision&&result.workspaceId===workspaceId&&(rows?value.totalRows:value.total)===total,
        'The original workspace changed between pages. Reopen the current selection.','OBSERVATION_CHANGED');
      if(!rows)need(value.view===view,'The native page belongs to another view.','PAGE');
      items.push(...value.items);offset+=value.items.length;
      need(offset<=total&&(offset===total||value.items.length>0),'The original native page did not advance.','PAGE');
      if(offset===total)return {items,total,revision:observedRevision,workspaceId};
    }
  }
  const client={
    workspace,
    open:options=>invoke('merchant_accounting_open',{},options),
    status:(args={},options)=>invoke(PREFIX+'status',args,options),
    sources:options=>invoke('merchant_accounting_sources',{},options),
    source:(args,options)=>invoke(PREFIX+'source',args,options),
    template:(args,options)=>invoke(PREFIX+'template',args,options),
    profile:(profileId,options)=>invoke(PREFIX+'profile',{profileId},options),
    plan:(planId,args={},options)=>invoke(PREFIX+'plan',{...args,planId},options),
    rows:(planId,args={},options)=>invoke(PREFIX+'rows',{...args,planId},options),
    capture:(planId,captureId,options)=>invoke(PREFIX+'capture',{planId,captureId},options),
    returned:(planId,returnId,options)=>invoke(PREFIX+'return',{planId,returnId},options),
    rollbackRecord:(rollbackId,options)=>invoke(PREFIX+'rollback_record',{rollbackId},options),
    allStatus:(view,options)=>all(offset=>client.status({view,offset,limit:200},options),view),
    allPlan:(planId,view,options)=>all(offset=>client.plan(planId,{view,offset,limit:200},options),view),
    allRows:(planId,args={},options)=>all(offset=>client.rows(planId,{...args,offset,limit:200},options),'rows',{rows:true}),
    async preview(kind,request,{planId,...query}={},options){
      need(Object.hasOwn(CRYPTOWORTH_REQUEST_FIELDS,kind),'Choose profile, plan, capture or return.');
      const result=await invoke(PREFIX+kind+'_preview',{request,...(planId?{planId}:{}),...query},options);
      need(result.kind===kind,'The original preview belongs to another operation.','REPLY');return accountingCryptoworthPreview(result);
    },
    async reconcile(preview,options){
      accountingCryptoworthPreview(preview);let result;
      try{
        result=await (preview.kind==='profile'?client.profile(preview.request.id,options):
          preview.kind==='plan'?client.plan(preview.request.id,{},options):
          preview.kind==='capture'?client.capture(preview.planId,preview.request.id,options):
          client.returned(preview.planId,preview.request.id,options));
      }catch(error){if(missing(error,preview.kind))return {found:false,unresolved:false,kind:preview.kind,workspaceId:preview.workspaceId,id:preview.request.id};throw error;}
      originalRecord(result,preview);
      const unresolved=preview.kind==='return'&&result.record.status==='PREPARED';
      return {...result,kind:preview.kind,found:!unresolved,unresolved,superseded:result.record.status==='SUPERSEDED'};
    },
    async save(preview,options){
      const args=accountingCryptoworthSaveArguments(preview),known=await client.reconcile(preview,options);
      if(known.found)return {...known,recovered:true};
      const result=await invoke(PREFIX+preview.kind+'_save',args,options);originalRecord(result,preview);
      return {...result,found:preview.kind!=='return'||result.record.status!=='PREPARED',unresolved:result.record.status==='PREPARED',superseded:result.record.status==='SUPERSEDED'};
    },
    async reconcileRollback(value,options){
      const args=accountingCryptoworthRollbackArguments(value);let result;
      try{result=await client.rollbackRecord(args.request.id,options);}catch(error){if(missing(error,'rollback'))return {found:false,workspaceId:args.workspaceId,id:args.request.id};throw error;}
      sameWorkspace(result,args.workspaceId);const {revision,...request}=args.request;
      need(result.record?.id===request.id&&result.record.requestSha256===digest({planId:args.planId,request}),
        'The retained rollback native ID belongs to another completed native import unit.','REQUEST_BINDING');
      return {...result,found:true};
    },
    async rollback(value,options){
      const args=accountingCryptoworthRollbackArguments(value),known=await client.reconcileRollback(args,options);
      if(known.found)return {...known,recovered:true};
      const result=await invoke(PREFIX+'rollback',args,options);sameWorkspace(result,args.workspaceId);
      const {revision,...request}=args.request;need(result.record?.id===request.id&&result.record.requestSha256===digest({planId:args.planId,request}),
        'The original rollback result changed.','REQUEST_BINDING');return {...result,found:true};
    },
    inspectPacket:(file,options)=>invoke(PREFIX+'packet_inspect',{file},options),
    async reconcilePacket(inspection,options){
      identifier(inspection.planId,NATIVE_ID,'packet plan ID');identifier(inspection.sha256,SHA,'input packet SHA256');identifier(inspection.packetSha256,SHA,'sealed packet SHA256');
      let result;
      try{result=await client.allPlan(inspection.planId,'receivedPackets',options);}
      catch(error){if(missing(error,'plan'))return {found:false,planId:inspection.planId,workspaceId:inspection.workspaceId};throw error;}
      sameWorkspace(result,inspection.workspaceId);
      const receipt=result.items.find(row=>row.sha256===inspection.sha256);
      if(!receipt)return {found:false,planId:inspection.planId,workspaceId:result.workspaceId,revision:result.revision};
      need(receipt.packetSha256===inspection.packetSha256,'The original input receipt carries another sealed packet hash.','PACKET_BINDING');
      return {found:true,planId:inspection.planId,workspaceId:result.workspaceId,revision:result.revision,receipt};
    },
    async receivePacket(inspection,options={},callOptions){
      const args=accountingCryptoworthPacketArguments(inspection,options),known=await client.reconcilePacket(inspection,callOptions);
      if(known.found)return {...known,recovered:true};
      const result=await invoke(PREFIX+'packet_receive',args,callOptions);sameWorkspace(result,args.workspaceId);
      need(result.planId===inspection.planId&&result.sha256===args.expectedSha256&&result.packetSha256===args.expectedPacketSha256,
        'The original receiving result does not match both reviewed packet hashes.','PACKET_BINDING');return {...result,found:true};
    },
    registerFileRead:readId=>maintenance.registerFileRead(readId),
    releaseFile:(readId,options)=>maintenance.releaseFile(readId,options),
    drainFileReads:()=>transition(()=>maintenance.drainFileReads()),
    async *fileChunks(selection,options){
      accepting();need(selection?.kind==='cryptoworth','Use the original Cryptoworth retained file scope.');
      const iterator=maintenance.fileChunks(selection,options);
      try{for(;;){accepting();const item=await iterator.next();if(item.done)return;yield item.value;}}
      finally{await iterator.return?.();}
    },
    disconnect(){
      if(!closePromise)closePromise=transition(()=>maintenance.drainFileReads(),true);return closePromise;
    },
    closeWorkspace(options){
      if(!closePromise)closePromise=transition(()=>maintenance.closeWorkspace(options),true);return closePromise;
    },
  };
  return Object.freeze(client);
}
export async function connectAccountingCryptoworthClient({workspace,...options}={}){
  const connection=await openMerchantFileClient({...options,errorPrefix:'ACCOUNTING_CRYPTOWORTH',clientName:'starforge-accounting-cryptoworth'});
  return Object.freeze({...createAccountingCryptoworthClient({workspace,call:connection.call}),endpoint:connection.endpoint});
}
