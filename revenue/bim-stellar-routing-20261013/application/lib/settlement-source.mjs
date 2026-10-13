import {createHash} from 'node:crypto';
import {inspectPacket} from './workspace.mjs';
import {bytes,clone,hash,identity,decode64,need} from './value.mjs';
import {parseSourceJSON} from './source-json.mjs';
import {createSettlementAnalytics} from './settlement-analytics.mjs';
import {assetIdentity,amount} from './settlement-exact.mjs';
const BODY_LIMIT=128*1024*1024;
const escapePointer=s=>String(s).replace(/~/g,'~0').replace(/\//g,'~1');
const utf8=new TextDecoder('utf-8',{fatal:true});
function pointer(root,value){
 need(typeof value==='string'&&(!value||value.startsWith('/')),'SOURCE_POINTER_REQUIRED');let at=root;
 for(const component of value?value.slice(1).split('/'):[]){need(!/~(?:[^01]|$)/u.test(component),'SOURCE_POINTER_ESCAPE');const key=component.replace(/~1/g,'/').replace(/~0/g,'~');need(at!==null&&typeof at==='object'&&Object.hasOwn(at,key),'SOURCE_POINTER_MISSING',{pointer:value});at=at[key];}
 return at;
}
function timestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)||!Number.isFinite(Date.parse(value)))return null;
 return new Date(value).toISOString();
}
function unique(map,id,value){need(!map.has(id),'DUPLICATE_ORIGINAL_INVENTORY',{id});map.set(id,value);}
function socketAsset(token){
 if(!token||typeof token!=='object'||!/^(?:0|[1-9]\d*)$/u.test(String(token.chainId))||!/^(?:0|[1-9]\d*)$/u.test(String(token.decimals)))return null;
 const decimals=Number(token.decimals);if(!Number.isInteger(decimals)||decimals>38)return null;
 if(String(token.chainId)==='1110002'){
  const match=typeof token.address==='string'&&/^([^:]+):(G[A-Z2-7]{55})$/u.exec(token.address);
  if(!match)return null;
  return assetIdentity({chain:'stellar',network:'Public Global Stellar Network ; September 2015',kind:'ISSUED',code:match[1],issuer:match[2],decimals});
 }
 if(String(token.chainId)==='8453'&&typeof token.address==='string'&&/^0x[0-9a-fA-F]{40}$/u.test(token.address))return assetIdentity({chain:'evm',network:'8453',kind:'TOKEN',address:token.address.toLowerCase(),decimals});
 return null;
}
function socketAmount(value){
 const asset=socketAsset(value?.token);
 if(!asset||typeof value?.amount!=='string'||!/^(?:0|[1-9]\d*)$/u.test(value.amount))return null;
 return amount({asset,atomic:value.amount},{nonnegative:true});
}
/**
 * Complete original backend receiving. A provider reader receives frozen original
 * records and exact-byte files; every emitted fact is checked against this inventory.
 * No caller-supplied normalized projection is accepted.
 */
export function createOriginalSettlementAdapter({readers=[]}={}){
 need(Array.isArray(readers)&&readers.every(r=>r&&typeof r.id==='string'&&typeof r.project==='function'),'SOURCE_READERS_REQUIRED');
 need(new Set(readers.map(r=>r.id)).size===readers.length,'DUPLICATE_SOURCE_READER');
 function receive(original){
  inspectPacket(original);
  const body=original.body,w=body.workspace,retained=new Map(),recordMaps={};
  function add(id,kind,path,raw,value,extra={}){
   const data=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
   const descriptor={id,kind,path,bytes:data.length,sha256:hash(data),...extra};
   unique(retained,id,{descriptor,data,value});return descriptor;
  }
  add('original-workspace','WORKSPACE_PACKET','original-workspace.json',bytes(original),original);
  for(const name of ['requests','exchanges','sessions']){
   recordMaps[name]=new Map();
   body[name].forEach((row,i)=>{const key='record:'+name+':'+row.id;add(key,name.toUpperCase(),'/body/'+name+'/'+i,bytes(row),row);recordMaps[name].set(row.id,{row,key,index:i});});
  }
  for(const name of ['queries','plans','submissions','operations','walletEvents','sessionEvents','notes','retirements']){
   recordMaps[name]=new Map();
   w[name].forEach((row,i)=>{const key='record:'+name+':'+row.id;add(key,name.toUpperCase(),'/body/workspace/'+name+'/'+i,bytes(row),row);recordMaps[name].set(row.id,{row,key,index:i});});
  }
  for(const row of body.objects)add(row.descriptor.id,'ORIGINAL_FILE',row.descriptor.name,decode64(row.contentBase64),undefined,{mediaType:row.descriptor.type});
  for(const row of body.application)add('application:'+row.path,'APPLICATION_SOURCE',row.path,decode64(row.contentBase64),undefined);
  function ref(id,path=''){const item=retained.get(id);need(item,'ORIGINAL_SOURCE_NOT_FOUND',{id});return {id,pointer:path,sha256:item.descriptor.sha256};}
  function decoded(id){const item=retained.get(id);need(item,'ORIGINAL_SOURCE_NOT_FOUND',{id});if(item.value!==undefined)return item.value;return parseSourceJSON(item.data,{maxBytes:BODY_LIMIT}).value;}
  function read(refValue){
   const item=retained.get(refValue.id);need(item&&item.descriptor.sha256===refValue.sha256,'ORIGINAL_SOURCE_CHANGED');
   if(refValue.pointer)return clone(pointer(decoded(refValue.id),refValue.pointer));
   try{return utf8.decode(item.data);}catch{return {descriptor:clone(item.descriptor),contentBase64:item.data.toString('base64')};}
  }
  function recordRef(name,row,path=''){need(recordMaps[name]?.has(row.id),'ORIGINAL_RECORD_NOT_FOUND');return ref(recordMaps[name].get(row.id).key,path);}
  function exchangeRefs(row){
   return (row.exchangeIds??[]).flatMap(id=>{const e=recordMaps.exchanges.get(id);need(e,'ORIGINAL_EXCHANGE_NOT_FOUND');return [ref(e.key),...(e.row.response?.bodyFileId?[ref(e.row.response.bodyFileId)]:[])];});
  }
  const p={schema:'bim.settlement-source-projection.v1',
   source:{schema:original.schema,workspaceId:w.workspace.id,revision:w.workspace.revision,sha256:original.sha256,applicationSha256:w.applicationSha256,registrySha256:w.registrySha256,sourceReaderIds:['original-backend-v1',...readers.map(r=>r.id)]},
   quotes:[],selections:[],executions:[],vaultActivities:[],positions:[],movements:[],balances:[],fallbacks:[],lifecycle:[],coverage:[],exceptions:[],inventory:[]};
  const exception=(kind,recordId,message,sourceRefs)=>p.exceptions.push({id:kind+':'+recordId,kind,recordId,message,sourceRefs});
  const accountOf=row=>row.configuration?.wallet?.address??null;
  const lifecycle=(id,provider,providerIdentity,accountId,state,observedAt,sourceRefs,detail={})=>p.lifecycle.push({id,provider,providerIdentity,accountId,state,sourceConfirmed:false,destinationConfirmed:false,cashPaidOut:false,refundConfirmed:false,economicAt:null,observedAt:timestamp(observedAt),sourceRefs,...detail});
  const handled=new Set();
  for(const row of w.queries){
   const v=row.value,refs=[recordRef('queries',row),...exchangeRefs(row)],account=accountOf(row);
   if(row.actionId==='socket.quote'&&v?.schema==='bim.socket.exchange.v1'){
    handled.add(row.id);
    const source=v.original?.result,originalQuotes=Array.isArray(source?.routes)?source.routes:[];
    for(let i=0;i<originalQuotes.length;i++){
     const route=originalQuotes[i],input=socketAmount(source.input),output=socketAmount(route.output),quoteId=row.id+':'+i;
     p.quotes.push({id:quoteId,protocol:route.routeDetails?.name??'socket',accountId:account,providerQuoteId:route.quoteId,mode:'EXACT_INPUT',input,output,
      minimumOutput:output&&typeof route.output.minAmountOut==='string'?amount({asset:output.asset,atomic:route.output.minAmountOut},{nonnegative:true}):null,
      expiresAt:route.expiresAt??null,quoteResultId:row.id,sourceRefs:[recordRef('queries',row,'/value/original/result/routes/'+i),...exchangeRefs(row)]});
     if(!input||!output)exception('QUOTE_ASSET_IDENTITY_UNRESOLVED',quoteId,'The original quote is retained; a complete chain-specific asset identity and exact precision are required before monetary comparison.',refs);
    }
   }else if(row.actionId==='socket.status'&&v?.schema==='bim.socket.exchange.v1'){
    handled.add(row.id);const q=v.projection??{};
    lifecycle(row.id,'socket',q.quoteId??null,account,q.providerStatus??'UNKNOWN',row.createdAt,refs,
     {providerReportsDelivery:q.providerReportsDelivery===true,providerReportsRefund:q.providerReportsRefund===true,originalSource:q.source??null,originalDestination:q.destination??null,originalRefund:q.refund??null,findings:q.findings??[]});
    if(q.providerReportsDelivery||q.providerReportsRefund)exception('PROVIDER_OUTCOME_REQUIRES_LEDGER',row.id,'Socket delivery/refund status remains a provider observation until the distinct original destination/refund ledger evidence is received.',refs);
   }else if(row.actionId==='moneygram.status.get'&&v?.schema==='bim.moneygram.status-receipt.v1'){
    handled.add(row.id);const q=v.projection??{};
    lifecycle(row.id,'moneygram',q.transactionId??null,q.walletAddress??account,q.phase??'UNKNOWN',row.createdAt,refs,
     {providerStatus:q.providerStatus??null,providerReportsDelivery:q.providerReportsDelivered===true,cashPaidOut:q.cashCollected===true,environment:q.environment??null,flow:q.flow??null,findings:q.findings??[],providerCashStatusOnly:true});
   }else if(row.actionId==='moneygram.webhook.verify'&&v?.schema==='bim.moneygram.webhook-verification.v1'){
    handled.add(row.id);lifecycle(row.id,'moneygram',v.mgiTransactionId??null,account,'SIGNED_NOTIFICATION',row.createdAt,refs,
     {verification:v.verification,transaction:v.transaction,requiresStatusRead:true,timestampSemantics:v.timestampSemantics});
   }
  }
  for(const row of w.plans)if(row.actionId==='socket.quote.activate'){
   handled.add(row.id);const selection=row.selection??{},matches=p.quotes.filter(q=>q.quoteResultId===selection.quoteResultId&&q.providerQuoteId===selection.quoteId);
   p.selections.push({id:row.id,protocol:matches.length===1?matches[0].protocol:'socket',accountId:accountOf(row),selectedAt:timestamp(row.createdAt),quoteId:matches.length===1?matches[0].id:null,outcome:row.status,sourceRefs:[recordRef('plans',row),...exchangeRefs(row)]});
  }
  for(const row of w.submissions)lifecycle(row.id,'wallet',row.submission.transactionHash,accountOf(row),'CLIENT_REPORTED_SUBMISSION',row.createdAt,[recordRef('submissions',row)],{planId:row.planId});
  for(const row of w.walletEvents)lifecycle(row.id,'wallet',row.operation.hash??row.operation.unsignedHash,row.operation.address,row.operation.state,row.createdAt,[recordRef('walletEvents',row)],{classification:row.operation.classification,terminalConflict:row.operation.terminalConflict===true,clientObservation:true});
  for(const row of w.sessionEvents){const s=recordMaps.sessions.get(row.sessionId)?.row;
   lifecycle(row.id,'moneygram',row.event.transactionId??row.event.mgiTransactionId??null,s?.public?.walletAddress??null,row.event.phase??row.event.event??'CLIENT_WIDGET_OBSERVATION',row.createdAt,[recordRef('sessionEvents',row)],{classification:row.classification,sessionId:row.sessionId});
  }
  for(const row of w.operations)if(row.actionId==='socket.quote.activate'||row.actionId==='moneygram.session.create'){
   handled.add(row.id);lifecycle(row.id,row.actionId.split('.')[0],row.value.selection?.quoteId??row.value.session?.id??row.id,accountOf(row),row.actionId==='socket.quote.activate'?'PROVIDER_ACTIVATION':'PRIVATE_WIDGET_SESSION',row.createdAt,[recordRef('operations',row),...exchangeRefs(row)]);
  }
  for(const row of body.requests)if(row.status!=='COMPLETE')exception('ORIGINAL_REQUEST_'+row.status,row.id,'The original request remains '+row.status+'; it does not establish a confirmed economic result.',[ref(recordMaps.requests.get(row.id).key)]);
  for(const row of body.exchanges)if(row.status!=='COMPLETE'||row.response?.private)exception(row.response?.private?'PRIVATE_SOURCE_WITHHELD':'ORIGINAL_EXCHANGE_INCOMPLETE',row.id,row.response?.private?'The original private source body remains with its server owner. Its retained metadata is available; private capabilities are excluded from this portable copy.':'The original provider response is incomplete and remains visible without a completed economic projection.',[ref(recordMaps.exchanges.get(row.id).key)]);
  const context=Object.freeze({packet:original,workspace:w,recordMaps,ref,recordRef,exchangeRefs,read,decoded,accountOf,timestamp,exception,handled});
  for(const reader of readers)reader.project(context,p);
  for(const row of [...w.queries,...w.plans,...w.operations])if(!handled.has(row.id))exception('SOURCE_RETAINED_WITHOUT_ECONOMIC_PROFILE',row.id,'This original '+row.actionId+' result is retained in full. Its provider-specific accounting projection is not present in this selected source-reader edition.',[recordRef(w.queries.includes(row)?'queries':w.plans.includes(row)?'plans':'operations',row),...exchangeRefs(row)]);
  for(const name of ['quotes','selections','executions','vaultActivities','positions','movements','balances','fallbacks','lifecycle','coverage']){
   const seen=new Set();for(const row of p[name]){
    need(typeof row.id==='string'&&!seen.has(row.id),'DUPLICATE_PROJECTED_ID',{name,id:row.id});seen.add(row.id);
    need(Array.isArray(row.sourceRefs)&&row.sourceRefs.length,'ORIGINAL_REFERENCES_REQUIRED',{name,id:row.id});
    for(const r of row.sourceRefs){const originalItem=retained.get(r.id);need(originalItem&&r.sha256===originalItem.descriptor.sha256,'SOURCE_REFERENCE_CHANGED');if(r.pointer)pointer(decoded(r.id),r.pointer);}
   }
  }
  p.inventory=[...retained.values()].map(x=>clone(x.descriptor));
  return {projection:p,read};
 }
 return Object.freeze({receive,projectSource:original=>receive(original).projection});
}
export function createOriginalSettlementAnalytics(options={}){
 const adapter=createOriginalSettlementAdapter(options);
 const analytics=createSettlementAnalytics({sha256Utf8:text=>createHash('sha256').update(text,'utf8').digest('hex'),projectSource:adapter.projectSource});
 return Object.freeze({...analytics,source:(original,ref)=>adapter.receive(original).read(ref),projectSource:adapter.projectSource});
}
