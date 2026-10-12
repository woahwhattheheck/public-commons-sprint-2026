// MIT. Customer statements over one existing merchant MCP connection.
import {createHash} from 'node:crypto';
import {openMerchantFileClient} from './retained-download.mjs';
import {createAccountingMaintenanceClient} from './accounting-maintenance-client.mjs';

const PREFIX='merchant_accounting_customer_',UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const SELECTION=['customerId','runId','usageId','replacesId','from','until'];
const PROFILE=['reference','name','email','address','note'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const json=value=>JSON.stringify(value,null,2)+'\n';
const digest=value=>createHash('sha256').update(json(value)).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code:'ACCOUNTING_STATEMENT_CLIENT_'+code});
function need(ok,message,code='ARGUMENTS'){if(!ok)throw fail(code,message);}
function exact(value,fields){need(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),'Use only declared original operation fields.');}
function id(value,pattern,name){need(typeof value==='string'&&pattern.test(value),'Supply the exact '+name+'.');return value;}
function revision(value){need(Number.isSafeInteger(value)&&value>=1,'Use the current original workspace revision.');return value;}
function text(value,maximum,name,empty=false){
  need(typeof value==='string'&&(empty||value.trim().length>0)&&value.trim().length<=maximum&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'Use the original '+name+'.');
  return value.trim();
}
function selection(value){
  exact(value,SELECTION);const result={customerId:id(value.customerId,UUID,'customer UUID'),runId:id(value.runId,UUID,'completed run UUID'),
    usageId:value.usageId??null,replacesId:value.replacesId??null};
  for(const key of ['usageId','replacesId'])if(result[key]!==null)id(result[key],UUID,key+' UUID');
  if(value.from!==undefined||value.until!==undefined){
    for(const key of ['from','until'])need(typeof value[key]==='string'&&value[key].length<=80&&Number.isFinite(Date.parse(value[key])),'Use both original explicit period timestamps.');
    result.from=value.from;result.until=value.until;
  }
  return result;
}
function nativeProfile(value){
  const profile={reference:text(value.reference,80,'customer reference'),name:text(value.name,200,'customer name'),
    email:text(value.email??'',320,'customer email',true),address:text(value.address??'',2000,'customer address',true),note:text(value.note??'',2000,'customer note',true)};
  id(profile.reference,/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/,'customer reference');
  need(!profile.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email),'Use the original customer email.');
  return profile;
}
function statement(value,selectedId){
  need(plain(value)&&UUID.test(value.id??'')&&(!selectedId||value.id===selectedId)&&
    SHA.test(value.previewSha256??'')&&SHA.test(value.intentSha256??'')&&
    ['RETAINED','SUPERSEDED','WITHDRAWN'].includes(value.status)&&plain(value.files),
    'The result does not identify an original retained statement.','REPLY');
  return value;
}
export function accountingStatementPreview(preview){
  need(plain(preview)&&plain(preview.draft)&&plain(preview.intent)&&SHA.test(preview.previewSha256??'')&&digest(preview.draft)===preview.previewSha256,
    'Retain the complete exact native preview document.','PREVIEW');
  const intent=selection(preview.intent);revision(preview.revision);
  need(JSON.stringify(intent)===JSON.stringify(preview.intent)&&preview.draft.customer?.id===intent.customerId&&preview.draft.source?.runId===intent.runId,
    'The reviewed customer, original run or normalized selection changed.','PREVIEW_BINDING');
  return preview;
}
export function accountingStatementRetentionArguments(preview,{requestId,actor}={}){
  accountingStatementPreview(preview);
  return {...structuredClone(preview.intent),revision:preview.revision,actor:text(actor,1000,'operator'),
    requestId:id(requestId,/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/,'stable retention request ID'),previewSha256:preview.previewSha256};
}
/** Validate wire arguments; source compilation and bookkeeping remain in the native engine. */
export function accountingStatementArguments(kind,value){
  const fields={save:['revision','actor',...PROFILE,'id','expectedVersion'],
    assign:['revision','actor','customerId','orders','reassign','reason'],
    usage_import:['revision','actor','source','expectedSha256','name'],
    withdraw:['revision','actor','statementId','reason']}[kind];
  need(fields,'Choose save, assign, usage_import or withdraw; retention requires its complete preview.');
  exact(value,fields);
  const result={revision:revision(value.revision),actor:text(value.actor,1000,'operator')};
  if(kind==='save'){
    Object.assign(result,nativeProfile(value));
    if(value.id!==undefined){result.id=id(value.id,UUID,'customer UUID');result.expectedVersion=revision(value.expectedVersion);}
    else need(value.expectedVersion===undefined,'Choose the original customer ID before supplying its version.');
  }else if(kind==='assign'){
    result.customerId=id(value.customerId,UUID,'customer UUID');
    need(Array.isArray(value.orders)&&value.orders.length>0&&value.orders.length<=2000,'Use between one and 2,000 original order assignments.');
    const seen=new Set();
    result.orders=value.orders.map(row=>{
      exact(row,['orderRef','label']);const orderRef=id(row.orderRef,/^[A-Za-z0-9._:-]{1,80}$/,'original order reference');
      need(!seen.has(orderRef),'List each original order once.');seen.add(orderRef);
      return {orderRef,label:text(row.label??'',300,'order description',true)};
    });
    if(value.reassign!==undefined){need(typeof value.reassign==='boolean','Use the original reassignment choice.');result.reassign=value.reassign;}
    result.reason=text(value.reason??'',2000,'assignment reason',true);
  }else if(kind==='usage_import'){
    result.source=id(value.source,/^[a-z0-9][a-z0-9_-]{0,63}$/,'host-declared usage alias');
    result.expectedSha256=id(value.expectedSha256,SHA,'reviewed usage source SHA256');
    if(value.name!==undefined)result.name=text(value.name,200,'usage import name');
  }else{
    result.statementId=id(value.statementId,UUID,'statement UUID');result.reason=text(value.reason,2000,'withdrawal reason');
  }
  return result;
}
function retentionIdentity(args){
  const intent=selection(Object.fromEntries(SELECTION.filter(key=>args[key]!==undefined).map(key=>[key,args[key]])));
  return digest({intent,previewSha256:args.previewSha256,actor:args.actor});
}

/** Supply the original MCP call; all files use the existing retained-file consumer. */
export function createAccountingStatementClient({workspace,call}={}){
  id(workspace,/^[a-z0-9][a-z0-9_-]{0,63}$/,'configured workspace alias');need(typeof call==='function','Provide the original structured MCP call.');
  const maintenance=createAccountingMaintenanceClient({workspace,call}),pending=new Set();
  let closed=false,transitioning=false,closePromise;
  function accepting(){need(!closed&&!transitioning,'This caller is draining or closed.','CLOSED');}
  async function tracked(work){
    accepting();const promise=Promise.resolve().then(work);pending.add(promise);
    try{return await promise;}finally{pending.delete(promise);}
  }
  function invoke(name,args={},options){
    need(plain(args)&&!Object.hasOwn(args,'workspace'),'Use this selected workspace alias.');
    return tracked(async()=>{
      const result=await call(name,{...structuredClone(args),workspace},options);
      need(plain(result),'The original merchant returned no structured result.','REPLY');return result;
    });
  }
  async function transition(work,permanent=false){
    accepting();transitioning=true;
    try{await Promise.allSettled([...pending]);return await work();}
    finally{transitioning=false;if(permanent)closed=true;}
  }
  async function all(fetchPage,kind){
    const items=[];let offset=0,observedRevision,total;
    for(;;){
      const result=await fetchPage(offset),page=result.page??result;
      need(page.kind===kind&&Array.isArray(page.items)&&page.offset===offset&&Number.isSafeInteger(page.total)&&page.total>=0&&page.items.length<=200,
        'The original '+kind+' page is inconsistent.','PAGE');
      observedRevision??=result.revision;total??=page.total;revision(observedRevision);
      need(result.revision===observedRevision&&page.total===total,'The original workspace changed between pages. Read the current inventory again.','OBSERVATION_CHANGED');
      items.push(...page.items);
      if(page.nextOffset===null){need(items.length===total,'The original inventory ended before its retained count.','PAGE');return {items,revision:observedRevision};}
      need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset&&page.nextOffset<total,'The original inventory page did not advance.','PAGE');offset=page.nextOffset;
    }
  }
  async function previewBytes(descriptor,options){
    need(plain(descriptor)&&descriptor.kind==='customer-statement-preview'&&descriptor.file==='preview.json'&&SHA.test(descriptor.sha256??'')&&
      Number.isSafeInteger(descriptor.bytes)&&descriptor.bytes>0&&descriptor.bytes<=128_000_000,'The native preview has no exact complete-file descriptor.','PREVIEW');
    const {sha256,bytes,...selectors}=descriptor,parts=[];let length=0;
    for await(const chunk of client.fileChunks(selectors,{expectedSha256:sha256,signal:options?.requestSignal})){
      length+=chunk.bytes.length;need(length<=bytes,'The complete preview exceeded its recorded byte count.','PREVIEW');parts.push(chunk.bytes);
    }
    need(length===bytes,'The complete preview ended before its recorded byte count.','PREVIEW');
    return Buffer.concat(parts,length);
  }
  const client={
    workspace,
    open:options=>invoke('merchant_accounting_open',{},options),
    status:(args,options)=>invoke(PREFIX+'status',args,options),
    sources:options=>invoke('merchant_accounting_sources',{},options),
    bindings:(args,options)=>invoke(PREFIX+'bindings',args,options),
    order:(args,options)=>invoke(PREFIX+'order',args,options),
    statements:(args,options)=>invoke(PREFIX+'statements',args,options),
    lookup:(requestId,options)=>invoke(PREFIX+'statement_lookup',{requestId:id(requestId,/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/,'retained request ID')},options),
    allCustomers:options=>all(offset=>client.status({view:'customers',offset,limit:200},options),'customers'),
    allUsage:options=>all(offset=>client.status({view:'usage',offset,limit:200},options),'usage'),
    allBindings:(args={},options)=>all(offset=>client.bindings({...args,offset,limit:200},options),'bindings'),
    allStatements:(args={},options)=>all(offset=>client.statements({...args,offset,limit:200},options),'statements'),
    async saveCustomer(value,options){
      const args=accountingStatementArguments('save',value),result=await invoke(PREFIX+'save',args,options);
      need(UUID.test(result.customer?.id??'')&&(!args.id||result.customer.id===args.id)&&PROFILE.every(key=>result.customer[key]===args[key]),
        'The saved customer differs from the requested original profile.','REQUEST_BINDING');return result;
    },
    assign:(value,options)=>invoke(PREFIX+'assign',accountingStatementArguments('assign',value),options),
    async usageSource(source,options){
      const result=await invoke(PREFIX+'usage_source',{source:id(source,/^[a-z0-9][a-z0-9_-]{0,63}$/,'usage source alias')},options);
      need(result.source===source&&SHA.test(result.sha256??'')&&Number.isSafeInteger(result.bytes)&&result.bytes>0,'The original usage source has no exact identity.','REPLY');return result;
    },
    async importUsage(value,options){
      const args=accountingStatementArguments('usage_import',value),result=await invoke(PREFIX+'usage_import',args,options);
      need(result.import?.sha256===args.expectedSha256&&UUID.test(result.import.id??''),'The imported original usage source changed.','REQUEST_BINDING');return result;
    },
    previewSummary:(args,options)=>invoke(PREFIX+'statement_preview',args,options),
    async preview(args,options){
      const summary=await client.previewSummary(selection(args),options),bytes=await previewBytes(summary.previewFile,options);
      let preview;try{preview=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('PREVIEW','The complete native preview file is invalid UTF-8 JSON.');}
      accountingStatementPreview(preview);
      need(preview.previewSha256===summary.previewSha256&&preview.revision===summary.revision&&JSON.stringify(preview.intent)===JSON.stringify(summary.intent),
        'The preview summary and original complete file changed between reads.','OBSERVATION_CHANGED');
      return preview;
    },
    async retain(preview,identity,options){
      const args=accountingStatementRetentionArguments(preview,identity),result=await invoke(PREFIX+'statement_retain',args,options);
      const row=statement(result.statement);
      need(row.requestId===args.requestId&&row.previewSha256===args.previewSha256&&row.intentSha256===retentionIdentity(args),
        'The retained statement belongs to a different original request.','REQUEST_BINDING');return result;
    },
    async detail(args,options){
      id(args?.statementId,UUID,'original statement UUID');const result=await invoke(PREFIX+'statement',args,options);
      statement(result.statement,args.statementId);return result;
    },
    async withdraw(value,options){
      const args=accountingStatementArguments('withdraw',value),result=await invoke(PREFIX+'statement_withdraw',args,options);
      need(statement(result.statement,args.statementId).status==='WITHDRAWN','The original statement was not withdrawn.','REPLY');return result;
    },
    async reconcileRetention(preview,identity,options){
      const args=accountingStatementRetentionArguments(preview,identity),result=await client.lookup(args.requestId,options);
      if(!result.found)return result;
      const row=statement(result.statement);
      need(row.requestId===args.requestId&&row.previewSha256===args.previewSha256&&row.intentSha256===retentionIdentity(args),
        'The original request ID belongs to different statement content.','REQUEST_BINDING');return result;
    },
    async reconcileCustomer(value,options){
      const args=accountingStatementArguments('save',value),result=await client.allCustomers(options);
      const customer=result.items.find(row=>args.id?row.id===args.id:row.reference===args.reference);
      const found=Boolean(customer&&PROFILE.every(key=>customer[key]===args[key]));
      return {found,customer:customer??null,revision:result.revision,match:'CURRENT_ORIGINAL_PROFILE'};
    },
    async reconcileAssignments(value,options){
      const args=accountingStatementArguments('assign',value),result=await client.allBindings({customerId:args.customerId},options);
      const bindings=new Map(result.items.map(row=>[row.orderRef,row]));
      return {found:args.orders.every(order=>bindings.get(order.orderRef)?.label===order.label),customerId:args.customerId,
        matchedOrders:args.orders.filter(order=>bindings.get(order.orderRef)?.label===order.label).length,requestedOrders:args.orders.length,revision:result.revision};
    },
    async reconcileUsage(value,options){
      const args=accountingStatementArguments('usage_import',value),result=await client.allUsage(options),original=result.items.find(row=>row.sha256===args.expectedSha256);
      return {found:Boolean(original),import:original??null,revision:result.revision};
    },
    async reconcileWithdrawal(value,options){
      const args=accountingStatementArguments('withdraw',value),result=await client.detail({statementId:args.statementId},options);
      if(result.statement.status!=='WITHDRAWN')return {found:false,...result};
      const history=await all(offset=>client.detail({statementId:args.statementId,view:'history',offset,limit:200},options),'history');
      need(history.revision===result.revision,'The original statement changed while reading withdrawal history.','OBSERVATION_CHANGED');
      const withdrawal=history.items.at(-1);
      need(withdrawal?.action==='withdrawn'&&withdrawal.actor===args.actor&&withdrawal.reason===args.reason,
        'The original statement has a different retained withdrawal.','REQUEST_BINDING');
      return {found:true,...result,withdrawal};
    },
    registerFileRead:readId=>maintenance.registerFileRead(readId),
    releaseFile:(readId,options)=>maintenance.releaseFile(readId,options),
    drainFileReads:()=>transition(()=>maintenance.drainFileReads()),
    async *fileChunks(selection,options){
      accepting();const iterator=maintenance.fileChunks(selection,options);
      try{for(;;){accepting();const item=await iterator.next();if(item.done)return;yield item.value;}}
      finally{await iterator.return?.();}
    },
    disconnect(){
      if(!closePromise)closePromise=transition(()=>maintenance.drainFileReads(),true);
      return closePromise;
    },
    closeWorkspace(options){
      if(!closePromise)closePromise=transition(()=>maintenance.closeWorkspace(options),true);
      return closePromise;
    }
  };
  return Object.freeze(client);
}
export async function connectAccountingStatementClient({workspace,...options}={}){
  const connection=await openMerchantFileClient({...options,errorPrefix:'ACCOUNTING_STATEMENT',clientName:'starforge-accounting-statements'});
  return Object.freeze({...createAccountingStatementClient({workspace,call:connection.call}),endpoint:connection.endpoint});
}
