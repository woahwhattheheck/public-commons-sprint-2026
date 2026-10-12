// MIT. Supplier-specific HTTPS intake and delivery on the original workspace journal.
import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { clone, identifier, now } from '../opensearch/workspace/store.mjs';
import { data, digest, fail, object, reviewDocument, projectOrder, text, orderId as validateOrderId } from './core.mjs';
import { parseOpenTransDocument } from './opentrans.mjs';
import { DEFAULT_SUPPLIER_ORDER_PROFILE_ID, defaultSupplierOrderProfile, supplierOrderProfileSha256 } from './profiles.mjs';
import { authorization, transportTlsFiles, SUPPLIER_HTTPS_CONFIG_SCHEMA } from './transport-config.mjs';

export const TRANSMISSION_SCHEMA='stellar-forge.supplier-order-transmission.v1';
const MAX_XML=64*1024*1024,REPLY_BUDGET=1048576;
const OUTGOING=new Set(['ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE']);
const parsed=row=>row?JSON.parse(row.record_json):null;
const hash=body=>createHash('sha256').update(body).digest('hex');
const publicFile=file=>({fileId:file.id??file.fileId,name:file.name,bytes:file.bytes,sha256:file.sha256,...(file.mimeType?{mimeType:file.mimeType}:{})});
function page(offset=0,limit=50){offset=Number(offset);limit=Number(limit);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('ORDER_TRANSPORT_PAGE_INVALID','Use a nonnegative offset and a page size from 1 to 100.');return{offset,limit};}
function requireRevision(record,value){if(!Number.isSafeInteger(value)||value<1||record.revision!==value)fail('ORDER_TRANSMISSION_CHANGED','Reopen the original transmission before changing it.',409,{transmissionId:record.id,currentRevision:record.revision});}
function errorValue(error){return{code:String(error.code??'ORDER_TRANSPORT_FAILED').slice(0,100),message:String(error.message??'The transport operation could not complete.').slice(0,4000)};}
function requestFields(value,allowed){data(value);if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('ORDER_TRANSPORT_REQUEST_INVALID','Use only the declared supplier transport request fields; endpoints and credentials belong to the native host configuration.');}
function sourceFileIds(record){
  const ids=[record.source,record.http?.response,record.resolution?.evidence,...(record.events??[]).flatMap(e=>[e.source,e.http?.response,e.evidence])].filter(Boolean);
  return ids;
}
export function validateSupplierOrderTransmission(record,{fileExists,documentExists,profileSha256}={}){
  if(record.schema!==TRANSMISSION_SCHEMA)return;
  data(record);const {sha256,...body}=record;
  if(record.profileId!==undefined||record.profileSha256!==undefined){
    if(typeof record.profileId!=='string'||!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(record.profileId)||!/^[a-f0-9]{64}$/.test(record.profileSha256??'')||record.channel?.profileSha256!==record.profileSha256)fail('ORDER_TRANSMISSION_PROFILE_DIFFERS','The retained delivery profile differs from its declared channel.',409);
  }
  const selectedProfileSha=record.profileSha256??supplierOrderProfileSha256(defaultSupplierOrderProfile());
  if(profileSha256!==undefined&&selectedProfileSha!==profileSha256)fail('ORDER_TRANSMISSION_PROFILE_DIFFERS','The retained transmission belongs to a different customer profile.',409);
  if(sha256!==digest(body)||!Number.isSafeInteger(record.revision)||record.revision<1||!Array.isArray(record.events)||record.events.length!==record.revision)
    fail('ORDER_TRANSMISSION_RECORD_CHANGED','The complete transmission history differs from its original seal.',409);
  if(!['incoming','outgoing'].includes(record.direction)||!Array.isArray(record.orderIds)||!record.channel?.sha256||!record.workspaceId)
    fail('ORDER_TRANSMISSION_RECORD_INVALID','Retain the original channel, workspace and document identity.',422);
  for(let i=0;i<record.events.length;i++){
    const event=record.events[i];
    if(event.revision!==i+1)fail('ORDER_TRANSMISSION_RECORD_CHANGED','The original transmission history is incomplete.',409);
    if(event.source&&(event.source.fileId!==record.source?.fileId||event.source.sha256!==record.source?.sha256||event.source.bytes!==record.source?.bytes))
      fail('ORDER_TRANSMISSION_SOURCE_CHANGED','Every retained source event must bind this transmission\'s same complete original bytes.',409);
  }
  for(const file of sourceFileIds(record)){
    if(!file||file.fileId!==file.sha256||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||fileExists&&!fileExists(file))
      fail('ORDER_TRANSMISSION_FILE_MISSING','A complete transmission source, response or evidence file is absent.',422,{transmissionId:record.id});
  }
  if(record.documentId&&documentExists&&!documentExists(record.documentId))fail('ORDER_TRANSMISSION_DOCUMENT_MISSING','A transmission has no complete original business document.',422);
}
async function verifiedBody(workspace,fileId,expected,maximum=MAX_XML){
  const file=await workspace.file({id:fileId});
  if(file.bytes>maximum||file.sha256!==expected.sha256||file.bytes!==expected.bytes)fail('ORDER_TRANSPORT_SOURCE_CHANGED','The selected complete original file identity differs.',409);
  const handle=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat();if(!before.isFile()||before.size!==expected.bytes)fail('ORDER_TRANSPORT_SOURCE_CHANGED','The original regular file changed.',409);
    const body=await handle.readFile(),after=await handle.stat();
    if(body.length!==expected.bytes||hash(body)!==expected.sha256||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)
      fail('ORDER_TRANSPORT_SOURCE_CHANGED','The original XML or provider receipt changed while being read.',409);
    return{file,body};
  }finally{await handle.close();}
}
function safeHeaders(response,receiptHeader){
  const allowed=new Set(['content-type','content-length','date','retry-after',...(receiptHeader?[receiptHeader]:[])]);
  const headers={};
  for(const [name,value] of Object.entries(response.headers))if(allowed.has(name)&&value!==undefined){
    const v=Array.isArray(value)?value.join(', '):String(value);headers[name]=v;
  }
  return headers;
}
// One attempt. All errors after native request creation remain delivery-unknown.
// No redirect, authentication fallback, background queue or implicit resend exists.
async function postXml(endpoint,channel,body,credentials,tls){
  let request,response,timer,complete=false,statusCode=null,headers={},pieces=[],bytes=0,observedBytes=0,failure=null;
  let settle;const outcome=new Promise(resolve=>{settle=resolve;});let settled=false;
  const finish=error=>{if(error&&!failure)failure={code:String(error.code??'ORDER_HTTPS_CONNECTION_ENDED').slice(0,100),message:'The HTTPS exchange ended before a complete negotiated receipt was retained.'};if(!settled){settled=true;settle();}};
  let requestClosed=Promise.resolve(),responseClosed=Promise.resolve();
  try{
    request=httpsRequest(endpoint,{method:'POST',agent:false,maxHeaderSize:32768,...tls,
      headers:{'Content-Type':channel.contentType,'Content-Length':String(body.length),'Authorization':credentials,'Accept':'*/*','Connection':'close'}},incoming=>{
      response=incoming;statusCode=incoming.statusCode;headers=safeHeaders(incoming,channel.acknowledgment.receiptHeader);
      responseClosed=new Promise(resolve=>incoming.once('close',resolve));
      incoming.on('data',part=>{
        observedBytes+=part.length;const room=channel.maxResponseBytes-bytes;
        if(room>0){const keep=Buffer.from(part.subarray(0,room));pieces.push(keep);bytes+=keep.length;}
        if(observedBytes>channel.maxResponseBytes){const error=Object.assign(new Error('Response exceeds declared bound.'),{code:'ORDER_HTTPS_RESPONSE_TOO_LARGE'});finish(error);incoming.destroy();request.destroy();}
      });
      incoming.once('end',()=>{complete=Boolean(incoming.complete);finish(complete?null:Object.assign(new Error('Incomplete response.'),{code:'ORDER_HTTPS_RESPONSE_INCOMPLETE'}));});
      incoming.once('aborted',()=>finish(Object.assign(new Error('Response aborted.'),{code:'ORDER_HTTPS_RESPONSE_INCOMPLETE'})));
      incoming.once('error',finish);
      incoming.once('close',()=>{if(!settled)finish(Object.assign(new Error('Response closed.'),{code:'ORDER_HTTPS_RESPONSE_INCOMPLETE'}));});
    });
    requestClosed=new Promise(resolve=>request.once('close',resolve));
    request.once('error',finish);
    request.once('close',()=>{if(!response&&!settled)finish(Object.assign(new Error('Request closed.'),{code:'ORDER_HTTPS_CONNECTION_ENDED'}));});
    timer=setTimeout(()=>{const error=Object.assign(new Error('HTTPS attempt timed out.'),{code:'ORDER_HTTPS_TIMEOUT'});finish(error);response?.destroy();request.destroy();},channel.timeoutMs);
    timer.unref?.();
    request.end(body);
    await outcome;
    if(failure){response?.destroy();request.destroy();}
    await requestClosed;await responseClosed;
  }catch(error){
    finish(error);response?.destroy();request?.destroy();await requestClosed;await responseClosed;
  }finally{if(timer)clearTimeout(timer);}
  return{http:{statusCode,complete:complete&&!failure,headers,observedBytes},body:Buffer.concat(pieces,bytes),error:failure};
}
export class SupplierOrderTransport {
  constructor(workspace,configuration){
    this.workspace=workspace;this.configuration=configuration??{schema:SUPPLIER_HTTPS_CONFIG_SCHEMA,channels:[],intake:null};this.running=new Set();
  }
  channel(id){
    const channel=this.configuration.channels.find(c=>c.id===id);
    if(!channel)fail('ORDER_TRANSPORT_CHANNEL_NOT_CONFIGURED','Select a channel declared by this native workspace host.',409);
    const selected=this.workspace.profile();
    if(channel.profileSha256!==undefined&&channel.profileSha256!==selected.profileSha256||selected.profile.id!==DEFAULT_SUPPLIER_ORDER_PROFILE_ID&&channel.profileSha256!==selected.profileSha256)fail('ORDER_TRANSPORT_PROFILE_DIFFERS','The native host must declare this selected customer profile SHA on the negotiated channel before intake or delivery.',409,{profileId:selected.profile.id,profileSha256:selected.profileSha256,channelId:channel.id});
    return channel;
  }
  channels(){this.workspace.assertOpen();return{schema:SUPPLIER_HTTPS_CONFIG_SCHEMA,configured:this.configuration.channels.length>0,profileId:this.workspace.profile().profile.id,profileSha256:this.workspace.profile().profileSha256,channels:this.configuration.channels.map(c=>clone(c.public))};}
  raw(id){
    const record=parsed(this.workspace.db.prepare('SELECT record_json FROM supplier_order_transmissions WHERE id=?').get(identifier(id,'Transmission ID')));
    if(!record)fail('ORDER_TRANSMISSION_NOT_FOUND','Original transmission not found.',404);
    validateSupplierOrderTransmission(record,{profileSha256:this.workspace.profile().profileSha256});return record;
  }
  visible(record){
    const {events,...body}=record;return{...clone(body),historyCount:events?.length??0,foreign:record.workspaceId!==this.workspace.store.id||!this.localPreparation(record)};
  }
  localPreparation(record){
    if(record.direction==='incoming')return record.workspaceId===this.workspace.store.id;
    const op=parsed(this.workspace.db.prepare('SELECT record_json FROM operations WHERE id=?').get(record.requestId));
    return Boolean(op&&op.kind==='supplier-orders-transport-prepare'&&op.result?.transmissionId===record.id&&op.request?.documentId===record.documentId);
  }
  requireLocal(record){
    if(record.workspaceId!==this.workspace.store.id||!this.localPreparation(record))fail('ORDER_TRANSMISSION_FOREIGN','This is retained sender history. Prepare a locally reviewed document in this workspace before sending.',409);
  }
  save(record,event){
    const {sha256,...old}=record;const at=now(),revision=(old.revision??0)+1;
    const next={...old,revision,updatedAt:at,events:[...(old.events??[]),{revision,at,...clone(event),state:record.state}]};
    next.sha256=digest(next);
    this.workspace.db.prepare('INSERT INTO supplier_order_transmissions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id,state=excluded.state,record_json=excluded.record_json')
      .run(next.id,next.documentId??'',next.state,JSON.stringify(next));return next;
  }
  complete(operation,record){
    return this.workspace.store.writeOperation({...operation,state:'COMPLETE',updatedAt:now(),result:{transmissionId:record.id,transmission:this.visible(record)}});
  }
  prior(kind,request){
    data(request);identifier(request.requestId,'Request ID');
    if(!this.workspace.db.prepare('SELECT id FROM operations WHERE id=?').get(request.requestId))return null;
    return this.workspace.store.transaction(()=>this.workspace.reserve('transport-'+kind,request).operation);
  }
  recover(){
    this.workspace.assertOpen();this.workspace.store.recoverInterrupted();
    const rows=this.workspace.db.prepare("SELECT record_json FROM supplier_order_transmissions WHERE state='SENDING'").all();
    for(const row of rows){
      const record=parsed(row);if(record.schema!==TRANSMISSION_SCHEMA||record.workspaceId!==this.workspace.store.id||this.running.has(record.id))continue;
      const op=parsed(this.workspace.db.prepare('SELECT record_json FROM operations WHERE id=?').get(record.lastAttempt?.requestId));
      if(!op||op.state==='RUNNING'&&op.owner?.instance!==this.workspace.store.owner.instance)continue;
      this.workspace.store.transaction(()=>{
        const current=this.raw(record.id);if(current.state!=='SENDING'||current.revision!==record.revision)return;
        const next=this.save({...current,state:'UNKNOWN',error:{code:'ORDER_HTTPS_OUTCOME_UNKNOWN',message:'The original attempt ended without a durable complete receipt. Reconcile this exact document with the provider before deciding to retry.'}},
          {action:'interrupted-send',requestId:op.id,attempt:current.attemptCount});
        this.complete(op,next);
      });
    }
  }
  get({transmissionId}){this.recover();return this.visible(this.raw(transmissionId));}
  history({transmissionId,offset=0,limit=50}={}){
    this.recover();const selected=this.raw(transmissionId),p=page(offset,limit),events=selected.events??[];
    const items=[];let bytes=256;for(const item of events.slice(p.offset,p.offset+p.limit)){const size=Buffer.byteLength(JSON.stringify(item));if(size+256>REPLY_BUDGET)fail('ORDER_TRANSPORT_REPLY_TOO_LARGE','Receive the complete workspace package for this full original event.',413);if(items.length&&bytes+size>REPLY_BUDGET)break;bytes+=size;items.push(clone(item));}
    return{transmissionId:selected.id,revision:selected.revision,items,total:events.length,...p,nextOffset:p.offset+items.length<events.length?p.offset+items.length:null};
  }
  list({direction,state,orderId,offset=0,limit=50}={}){
    this.recover();const p=page(offset,limit),where=[],args=[];
    if(direction!==undefined){if(!['incoming','outgoing'].includes(direction))fail('ORDER_TRANSPORT_DIRECTION_INVALID','Choose incoming or outgoing.');where.push("json_extract(record_json,'$.direction')=?");args.push(direction);}
    if(state!==undefined){text(state,'Transmission state',64);where.push('state=?');args.push(state);}
    if(orderId!==undefined){validateOrderId(orderId,this.workspace.profile().profile);where.push("EXISTS(SELECT 1 FROM json_each(record_json,'$.orderIds') j WHERE j.value=?)");args.push(orderId);}
    const clause=where.length?' WHERE '+where.join(' AND '):'',total=Number(this.workspace.db.prepare('SELECT count(*) n FROM supplier_order_transmissions'+clause).get(...args).n);
    const rows=this.workspace.db.prepare("SELECT json_remove(record_json,'$.events') record_json,json_array_length(record_json,'$.events') history_count FROM supplier_order_transmissions"+clause+" ORDER BY json_extract(record_json,'$.updatedAt') DESC,id LIMIT ? OFFSET ?").all(...args,p.limit,p.offset);
    const items=[];let size=256;
    for(const row of rows){
      const record=parsed(row),item={...record,historyCount:row.history_count??0,foreign:record.workspaceId!==this.workspace.store.id||!this.localPreparation(record)},bytes=Buffer.byteLength(JSON.stringify(item));
      if(bytes+256>REPLY_BUDGET)fail('ORDER_TRANSPORT_REPLY_TOO_LARGE','Receive the complete workspace package to inspect this original transmission.',413);
      if(items.length&&size+bytes>REPLY_BUDGET)break;size+=bytes;items.push(item);
    }
    return{items,total,...p,nextOffset:p.offset+items.length<total?p.offset+items.length:null};
  }
  prepare(request){requestFields(request,["requestId","documentId","expectedDocumentSha256","channelId","expectedChannelSha256","reason"]);request=clone(request);return this.workspace.owned(async()=>{
    const prior=this.prior('prepare',request);if(prior)return prior;
    const channel=this.channel(request.channelId),document=this.workspace.document({id:request.documentId});
    if(request.expectedChannelSha256!==channel.sha256||request.expectedDocumentSha256!==document.sha256)fail('ORDER_TRANSPORT_SELECTION_CHANGED','Reopen the exact document and configured channel before preparing delivery.',409);
    if(!OUTGOING.has(document.kind)||document.direction!=='outgoing'||!channel.outgoing?.endpoints[document.kind])fail('ORDER_TRANSPORT_DOCUMENT_INVALID','Select a reviewed outgoing document and its configured HTTPS endpoint.');
    const supplier=this.workspace.supplierIdentity();if(!supplier||supplier.value!==channel.supplierId)fail('ORDER_TRANSPORT_SUPPLIER_DIFFERS','This channel belongs to another original supplier.',409);
    const {file}=await verifiedBody(this.workspace,document.source.fileId,document.source);
    return this.workspace.sync('transport-prepare',request,operation=>{
      const current=this.workspace.document({id:request.documentId});
      if(current.sha256!==request.expectedDocumentSha256)fail('ORDER_TRANSPORT_SELECTION_CHANGED','The selected original document changed.',409);
      this.verifyPreparedDocument({documentId:current.id,documentSha256:current.sha256,source:current.source});
      const reason=text(request.reason,'Reason for this delivery',4000),id='edi-'+digest(['outgoing',this.workspace.store.id,channel.id,channel.sha256,current.id,file.sha256]);
      const existing=parsed(this.workspace.db.prepare('SELECT record_json FROM supplier_order_transmissions WHERE id=?').get(id));
      if(existing){this.requireLocal(existing);return{transmissionId:id,transmission:this.visible(existing)};}
      const profile=this.workspace.profile();
      const at=now(),record=this.save({schema:TRANSMISSION_SCHEMA,id,workspaceId:this.workspace.store.id,direction:'outgoing',...(profile.profile.id!==DEFAULT_SUPPLIER_ORDER_PROFILE_ID?{profileId:profile.profile.id,profileSha256:profile.profileSha256}:{}),
        channel:clone(channel.public),kind:current.kind,documentId:current.id,documentSha256:current.sha256,orderIds:clone(current.orderIds),source:publicFile(file),
        endpoint:channel.outgoing.endpoints[current.kind],state:'READY',recipientProcessing:'NOT_REPORTED',requestId:request.requestId,createdAt:at,attemptCount:0},
        {action:'prepare',requestId:request.requestId,reason});
      return{transmissionId:id,transmission:{...this.visible(record),foreign:false}};
    });
  });}
  verifyPreparedDocument(record){
    const current=this.workspace.document({id:record.documentId});this.workspace.documentProfile(current.document);
    if(current.sha256!==record.documentSha256||current.source.sha256!==record.source.sha256||current.direction!=='outgoing')fail('ORDER_TRANSPORT_SELECTION_CHANGED','The retained delivery no longer matches its original prepared document.',409);
    const draft=this.workspace.draft({draftId:current.draftId});
    if(draft.revision!==current.draftRevision)fail('ORDER_TRANSPORT_DRAFT_CHANGED','The draft advanced after delivery was prepared. Cancel this intent and prepare the intended current XML.',409);
    const orders=[];
    for(const [id,expected] of Object.entries(draft.orderRevisions)){
      const head=this.workspace.head(id),sourceHead=parsed(this.workspace.db.prepare('SELECT record_json FROM supplier_order_history WHERE order_id=? AND revision=?').get(id,expected));
      if(!sourceHead||digest(sourceHead)!==draft.orderStateSha256[id])fail('ORDER_TRANSPORT_ORDER_CHANGED','The original draft order selection no longer matches its retained history.',409,{orderId:id});
      const unchanged=digest(head)===draft.orderStateSha256[id];
      const lastId=head.selectionIds?.at(-1),last=lastId?parsed(this.workspace.db.prepare('SELECT record_json FROM supplier_order_selections WHERE id=? AND order_id=?').get(lastId,id)):null;
      const ownSelection=head.revision===expected+1&&head.selectedDocumentId===current.id&&last?.documentId===current.id&&head.documentId===sourceHead.documentId&&
        digest(head.selectionIds.slice(0,-1))===digest(sourceHead.selectionIds);
      if(!unchanged&&!ownSelection)fail('ORDER_TRANSPORT_ORDER_CHANGED','The original order branch changed after this XML was prepared. Its own current selection is allowed; unrelated revisions require review.',409,{orderId:id});
      const original=this.workspace.document({id:head.documentId}),selected=head.selectionIds.map(selectionId=>{
        const row=parsed(this.workspace.db.prepare('SELECT record_json FROM supplier_order_selections WHERE id=? AND order_id=?').get(selectionId,id));
        if(!row)fail('ORDER_TRANSPORT_SELECTION_MISSING','An original selected document is absent.',409);
        return this.workspace.document({id:row.documentId});
      });
      const projected=projectOrder(original,[...selected,current],{revision:head.revision});
      if(projected.findings?.some(item=>item.severity==='error'))fail('ORDER_TRANSPORT_REVIEW_REQUIRED','The full original order and prospective delivery have unresolved fulfilment findings.',422,{orderId:id,findings:projected.findings.filter(item=>item.severity==='error')});
      orders.push(this.workspace.order({orderId:id}));
    }
    const review=reviewDocument(current.document,{orders,roundingPolicy:draft.roundingPolicy,forOutput:true});
    if(current.review.errors||review.errors)fail('ORDER_TRANSPORT_REVIEW_REQUIRED','The current original document needs review before this transmission.',422,{findings:[...current.review.findings,...review.findings].filter(item=>item.severity==='error')});
  }
  send(request){requestFields(request,["requestId","transmissionId","expectedRevision"]);request=clone(request);return this.workspace.owned(async()=>{
    const prior=this.prior('send',request);if(prior){this.recover();return this.workspace.operation({requestId:request.requestId});}
    this.recover();const initial=this.raw(request.transmissionId);this.requireLocal(initial);requireRevision(initial,request.expectedRevision);
    if(initial.direction!=='outgoing'||initial.state!=='READY')fail('ORDER_TRANSMISSION_NOT_READY','Only an explicitly prepared delivery may be sent. Reconcile or deliberately retry its original outcome first.',409);
    const channel=this.channel(initial.channel.id);
    if(channel.sha256!==initial.channel.sha256||channel.outgoing?.endpoints[initial.kind]!==initial.endpoint)fail('ORDER_TRANSPORT_CHANNEL_CHANGED','The negotiated channel changed. Preserve this intent and prepare the intended current channel.',409);
    const credentials=authorization(channel.outgoing.auth),tls=await transportTlsFiles(channel.outgoing.tls);
    const selected=await verifiedBody(this.workspace,initial.source.fileId,initial.source);
    let operation,record,ownsAttempt=false;
    try{
      const entry=this.workspace.store.transaction(()=>{
        const reserved=this.workspace.reserve('transport-send',request);if(reserved.existing)return reserved;
        const current=this.raw(initial.id);this.requireLocal(current);requireRevision(current,request.expectedRevision);
        if(current.state!=='READY')fail('ORDER_TRANSMISSION_NOT_READY','This original delivery is no longer ready.',409);
        this.verifyPreparedDocument(current);
        const attempt=(current.attemptCount??0)+1,at=now();
        const {http:priorHttp,providerReceipt:priorReceipt,resolution:priorResolution,...attemptRecord}=current;
        record=this.save({...attemptRecord,state:'SENDING',attemptCount:attempt,lastAttempt:{number:attempt,requestId:request.requestId,startedAt:at},error:null},
          {action:'send-started',requestId:request.requestId,attempt,endpoint:current.endpoint,source:current.source});
        reserved.operation.context={transmissionId:record.id,source:record.source,channelSha256:record.channel.sha256,attempt};
        this.workspace.store.writeOperation(reserved.operation);return reserved;
      });
      if(entry.existing)return entry.operation;operation=entry.operation;this.running.add(initial.id);ownsAttempt=true;
      const reply=await postXml(record.endpoint,channel.outgoing,selected.body,credentials,tls);
      let response=null,retentionFailure=null;
      try{
        if(reply.http.statusCode!==null||reply.body.length){const saved=await this.workspace.retain([reply.body],{name:'HTTPS-'+record.id+'-'+record.attemptCount+'.response',kind:'transport-response',mimeType:reply.http.headers['content-type']??'application/octet-stream',maxBytes:channel.outgoing.maxResponseBytes});response=publicFile(saved);}
      }catch(error){retentionFailure=errorValue(error);}
      const http={...reply.http,...(response?{response}:{})},ack=channel.outgoing.acknowledgment;
      let state='UNKNOWN';
      if(reply.http.complete&&!retentionFailure){
        if(ack.acceptedStatusCodes.includes(http.statusCode)&&(!ack.exactBodySha256||response?.sha256===ack.exactBodySha256))state='ACKNOWLEDGED';
        else if(ack.rejectedStatusCodes.includes(http.statusCode))state='REJECTED';
      }
      return this.workspace.store.transaction(()=>{
        const current=this.raw(record.id);if(current.state!=='SENDING'||current.lastAttempt?.requestId!==request.requestId)fail('ORDER_TRANSMISSION_CHANGED','The original active delivery record changed.',409);
        const receipt=ack.receiptHeader?http.headers[ack.receiptHeader]??null:null;
        const next=this.save({...current,state,http,providerReceipt:receipt,recipientProcessing:'NOT_REPORTED',
          lastAttempt:{...current.lastAttempt,endedAt:now()},error:retentionFailure??reply.error??(state==='UNKNOWN'?{code:'ORDER_HTTPS_ACK_UNCONFIRMED',message:'The response does not establish the configured transport acknowledgment. Reconcile the original document with the provider.'}:null)},
          {action:'send-result',requestId:request.requestId,attempt:current.attemptCount,http,providerReceipt:receipt,error:retentionFailure??reply.error??null});
        return this.complete(operation,next);
      });
    }catch(error){
      if(operation&&record){
        try{return this.workspace.store.transaction(()=>{
          const current=this.raw(record.id);if(current.state!=='SENDING')return this.workspace.operation({requestId:request.requestId});
          const next=this.save({...current,state:'UNKNOWN',error:{code:'ORDER_HTTPS_OUTCOME_UNKNOWN',message:'The original attempted delivery has no durable complete outcome. Reconcile its exact provider receipt before deciding to retry.'}},
            {action:'send-result-unretained',requestId:request.requestId,attempt:current.attemptCount,error:errorValue(error)});
          return this.complete(operation,next);
        });}catch{}
      }
      throw error;
    }finally{if(ownsAttempt)this.running.delete(initial.id);}
  });}
  retry(request){
    requestFields(request,['requestId','transmissionId','expectedRevision','reason']);this.recover();return this.workspace.sync('transport-retry',request,()=>{
      const record=this.raw(request.transmissionId);this.requireLocal(record);requireRevision(record,request.expectedRevision);
      if(record.direction!=='outgoing'||!['REJECTED','NOT_ACCEPTED','CANCELLED'].includes(record.state))fail('ORDER_TRANSMISSION_RETRY_UNCONFIRMED','Reconcile an unknown outcome with the provider before retrying. An acknowledged delivery is not replayed.',409);
      const reason=text(request.reason,'Reason for the deliberate retry',4000),next=this.save({...record,state:'READY',error:null},{action:'retry-prepared',requestId:request.requestId,reason,priorState:record.state});
      return{transmissionId:next.id,transmission:this.visible(next)};
    });
  }
  resolve(request){requestFields(request,["requestId","transmissionId","expectedRevision","outcome","providerReference","reason","evidenceFileId","expectedEvidenceSha256"]);request=clone(request);return this.workspace.owned(async()=>{
    const prior=this.prior('resolve',request);if(prior)return prior;this.recover();
    let evidence=null;
    if(request.evidenceFileId){const file=await this.workspace.file({id:request.evidenceFileId});if(request.expectedEvidenceSha256!==file.sha256)fail('ORDER_TRANSMISSION_EVIDENCE_CHANGED','Select the complete original provider evidence SHA-256.',409);await verifiedBody(this.workspace,file.id,file);evidence=publicFile(file);}
    else if(request.expectedEvidenceSha256)fail('ORDER_TRANSMISSION_EVIDENCE_REQUIRED','Select the original evidence file with this SHA-256.');
    return this.workspace.sync('transport-resolve',request,()=>{
      const record=this.raw(request.transmissionId);this.requireLocal(record);requireRevision(record,request.expectedRevision);
      if(record.direction!=='outgoing'||record.state!=='UNKNOWN'||!['ACKNOWLEDGED','NOT_ACCEPTED'].includes(request.outcome))fail('ORDER_TRANSMISSION_RESOLUTION_INVALID','Resolve the actual unknown provider outcome as acknowledged or not accepted.',409);
      const resolution={outcome:request.outcome,providerReference:text(request.providerReference,'Actual provider reference',1000),reason:text(request.reason,'Provider readback and reason',4000),at:now(),...(evidence?{evidence}:{})};
      const next=this.save({...record,state:request.outcome,resolution,error:null,recipientProcessing:'NOT_REPORTED'},
        {action:'provider-resolution',requestId:request.requestId,...resolution});
      return{transmissionId:next.id,transmission:this.visible(next)};
    });
  });}
  cancel(request){
    requestFields(request,['requestId','transmissionId','expectedRevision','reason']);this.recover();return this.workspace.sync('transport-cancel',request,()=>{
      const record=this.raw(request.transmissionId);this.requireLocal(record);requireRevision(record,request.expectedRevision);
      if(record.direction!=='outgoing'||!['READY','REJECTED','NOT_ACCEPTED'].includes(record.state))fail('ORDER_TRANSMISSION_CANCEL_INVALID','Only an unsent or confirmed-not-accepted intent can be cancelled.',409);
      const next=this.save({...record,state:'CANCELLED'},{action:'cancel',requestId:request.requestId,reason:text(request.reason,'Cancellation reason',4000)});
      return{transmissionId:next.id,transmission:this.visible(next)};
    });
  }
  receive({channelId,file,externalMessageId=null}){file=clone(file);return this.workspace.owned(async()=>{
    const channel=this.channel(channelId),profile=this.workspace.profile();if(!channel.incoming)fail('ORDER_TRANSPORT_INTAKE_NOT_CONFIGURED','This channel has no incoming ORDER interface.',404);
    if(externalMessageId!==null)text(externalMessageId,'Original provider message identity',1000);
    const identity=externalMessageId??'sha256:'+file.sha256,id='edi-'+digest(['incoming',this.workspace.store.id,channel.id,identity]),requestId='edi-in-'+digest([this.workspace.store.id,channel.id,identity]);
    const request={requestId,channelId:channel.id,channelSha256:channel.sha256,externalMessageId,source:{sha256:file.sha256,bytes:file.bytes}};
    let record,operation;
    const begin=this.workspace.store.transaction(()=>{
      this.workspace.store.recoverInterrupted();const reserved=this.workspace.reserve('transport-receive',request);
      if(reserved.existing){
        const current=this.raw(id);
        if(current.source.sha256!==file.sha256||current.channel.sha256!==channel.sha256)fail('ORDER_TRANSPORT_MESSAGE_REUSED','This provider message identity already belongs to different original bytes or channel settings.',409);
        const resumable=reserved.operation.state==='INTERRUPTED'||reserved.operation.state==='RUNNING'&&reserved.operation.owner?.instance===this.workspace.store.owner.instance&&!this.running.has(id);
        if(!resumable)return{existing:true,operation:reserved.operation,record:current};
        if(current.state!=='RECEIVING')fail('ORDER_TRANSPORT_RECEIVE_STATE_INVALID','The retained intake operation and receipt no longer agree.',409);
        record=this.save({...current,error:null},{action:'receive-resumed',requestId});reserved.operation={...reserved.operation,state:'RUNNING',owner:this.workspace.store.owner,updatedAt:now(),error:null};this.workspace.store.writeOperation(reserved.operation);
      }else{
        record=this.save({schema:TRANSMISSION_SCHEMA,id,workspaceId:this.workspace.store.id,direction:'incoming',...(profile.profile.id!==DEFAULT_SUPPLIER_ORDER_PROFILE_ID?{profileId:profile.profile.id,profileSha256:profile.profileSha256}:{}),channel:clone(channel.public),kind:'ORDER',documentId:null,orderIds:[],source:publicFile(file),state:'RECEIVING',recipientProcessing:'NOT_REPORTED',requestId,externalMessageId,createdAt:now(),attemptCount:0},
          {action:'receive-complete-source',requestId,externalMessageId,source:publicFile(file)});
      }
      operation=reserved.operation;return{existing:false};
    });
    if(begin.existing)return{operation:begin.operation,transmission:this.visible(begin.record)};
    this.running.add(id);
    try{
      const name='ORDER-'+file.sha256+'.xml',origin={kind:'configured-https',channelId:channel.id,channelSha256:channel.sha256,externalMessageId,transmissionId:id,receivedAt:record.createdAt};
      const selected=await verifiedBody(this.workspace,file.id??file.fileId,record.source),document=await parseOpenTransDocument(selected.body,{name,provenance:origin,profile:profile.profile});
      if(document.kind!=='ORDER')fail('ORDER_TRANSPORT_INTAKE_KIND_INVALID','This negotiated endpoint receives original ORDER documents only.');
      if(document.header.supplierId!==channel.supplierId)fail('ORDER_TRANSPORT_SUPPLIER_DIFFERS','The original ORDER identifies another supplier. Its complete source is retained for review.',422);
      const source={id:digest([name,file.sha256,origin]),name,bytes:file.bytes,sha256:file.sha256,fileId:file.id??file.fileId,provenance:origin,capturedAt:record.createdAt};
      return this.workspace.store.transaction(()=>{
        if(!this.workspace.db.prepare('SELECT id FROM supplier_order_sources WHERE id=?').get(source.id))this.workspace.db.prepare('INSERT INTO supplier_order_sources VALUES(?,?,?)').run(source.id,source.sha256,JSON.stringify(source));
        const original=this.workspace.recordDocument(document,source),order=original.document.orderId;
        if(!this.workspace.db.prepare('SELECT order_id FROM supplier_order_heads WHERE order_id=?').get(order))this.workspace.select(original,[order],{requestId,reason:'Received the first complete original ORDER on '+channel.id},{initial:true});
        const current=this.raw(id),next=this.save({...current,state:'RECEIVED',documentId:original.id,orderIds:original.orderIds,recipientProcessing:original.review.errors?'REVIEW':'RETAINED',error:null},
          {action:'receive-document',requestId,documentId:original.id,review:{errors:original.review.errors,warnings:original.review.warnings}});
        return{operation:this.complete(operation,next),transmission:this.visible(next)};
      });
    }catch(error){
      const result=this.workspace.store.transaction(()=>{
        const permanent=Number.isInteger(error.status)&&error.status>=400&&error.status<500&&![408,429,499].includes(error.status);
        const current=this.raw(id),next=this.save({...current,state:permanent?'REJECTED':'RECEIVING',error:errorValue(error),recipientProcessing:permanent?'REVIEW':'NOT_REPORTED'},
          {action:permanent?'receive-rejected':'receive-interrupted',requestId,error:errorValue(error)});
        const saved=permanent?this.complete(operation,next):this.workspace.store.writeOperation({...operation,state:'INTERRUPTED',updatedAt:now(),error:errorValue(error)});
        return{operation:saved,transmission:this.visible(next)};
      });return result;
    }finally{this.running.delete(id);}
  });}
}
