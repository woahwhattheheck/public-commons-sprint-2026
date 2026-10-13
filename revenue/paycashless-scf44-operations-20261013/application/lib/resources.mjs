// MIT. Projections retain full source bodies and exact original number tokens.
import {invariant,sha256,canonicalJSON} from './source-json.mjs';
import {actionContract} from './catalogue.mjs';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function exactTime(v){
 if(typeof v!=='string'||v.length>200)return null;
 const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,100}))?(Z|([+-])(\d\d):(\d\d))$/.exec(v);
 if(!m)return null;
 const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 if(mo<1||mo>12||d<1||d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1]||h>23||mi>59||s>59||
   m[9]&&(Number(m[10])>23||Number(m[11])>59))return null;
 const ms=Date.parse(v.slice(0,19)+m[8]);if(!Number.isFinite(ms))return null;
 return {seconds:BigInt(ms/1000),fraction:m[7]??''};
}
function compareTime(a,b){
 if(a.seconds!==b.seconds)return a.seconds>b.seconds?1:-1;
 const n=Math.max(a.fraction.length,b.fraction.length),x=a.fraction.padEnd(n,'0'),y=b.fraction.padEnd(n,'0');
 return x===y?0:x>y?1:-1;
}
const validTime=v=>exactTime(v)!==null;
function tokensBelow(tokens,pointer){
 const output={};for(const [path,value] of Object.entries(tokens??{}))
  if(path===pointer||path.startsWith(pointer+'/'))output[path.slice(pointer.length)]=value;
 return output;
}
function get(value,pointer){
 for(const key of pointer===''?[]:pointer.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'))){
  invariant(value!==null&&typeof value==='object'&&Object.hasOwn(value,key),'ORIGINAL_RESPONSE_SELECTION_MISSING',{pointer});value=value[key];
 }
 return value;
}
function nativeID(kind,value,request,context){
 if(kind==='paycashless-event')return context.eventId;
 if(kind==='paycashless-account-request')return value.accountRequestCode;
 if(kind==='paycashless-bank-account')return value.bank?.id&&value.accountNumber?JSON.stringify([value.bank.id,value.accountNumber]):null;
 if(kind==='paycashless-operation-result')return request.requestSha256;
 if(kind==='horizon-network')return 'network';
 if(kind==='horizon-transaction')return value.hash??value.id;
 if(kind==='horizon-account')return value.account_id??value.id;
 if(kind==='horizon-ledger')return String(value.sequence??value.id??'');
 return value.id;
}
function related(kind,value,context){
 const reads=[],add=(action,params={},query)=>reads.push({action,input:{params,...(query?{query}:{})}});
 if(kind==='paycashless-invoice'&&value.id){
  add('paycashless.invoice.get',{id:value.id});add('paycashless.invoice-payments.list',{id:value.id});
  for(const id of value.taxRateIds??[])if(typeof id==='string')add('paycashless.tax-rate.get',{id});
 }else if(kind==='paycashless-invoice-payment'){
  if(value.invoiceId)add('paycashless.invoice.get',{id:value.invoiceId});
  if(value.intentId)add('paycashless.payment.get',{id:value.intentId});
 }else if(kind==='paycashless-payment'&&value.id)add('paycashless.payment.get',{id:value.id});
 else if(kind==='paycashless-payout'&&value.id)add('paycashless.payout.get',{id:value.id});
 else if(kind==='paycashless-account-request'){
  if(value.accountRequestCode)add('paycashless.account-request.get',{code:value.accountRequestCode});
  if(value.account?.id)add('paycashless.dedicated-account.get',{id:value.account.id});
 }else if(kind==='paycashless-dedicated-account'&&value.id)add('paycashless.dedicated-account.get',{id:value.id});
 else if(kind==='paycashless-operation-result'){
  if(context.action==='paycashless.invoice.create'&&value.id)add('paycashless.invoice.get',{id:value.id});
  if(context.action==='paycashless.tax-rate.create'&&value.id)add('paycashless.tax-rate.get',{id:value.id});
  if(['paycashless.payment.create','paycashless.payment.checkout'].includes(context.action)&&value.id)add('paycashless.payment.get',{id:value.id});
  if(context.action==='paycashless.payout.create'&&value.id)add('paycashless.payout.get',{id:value.id});
 }else if(kind==='horizon-account'&&value.account_id)add('horizon.transactions.account',{accountId:value.account_id});
 else if(kind==='horizon-operation'&&value.transaction_hash)add('horizon.transaction.get',{transactionHash:value.transaction_hash});
 return reads;
}
export function projectResource({exchange,event,provider,environment,sourceReference={}}){
 const request=exchange?.request;provider??=request?.provider;environment??=request?.environment;
 invariant(['paycashless','horizon'].includes(provider)&&['production','sandbox'].includes(environment),'PROJECTION_SCOPE_REQUIRED');
 const context={...(request?.context??{}),provider,environment,sourceId:sourceReference.sourceId??null,
  connectionAlias:sourceReference.connectionAlias??null,providerScope:sourceReference.sourceScope??request?.context?.sourceScope??null,
  sourceScope:sourceReference.sourceScope??request?.context?.sourceScope??null,
  networkPassphrase:sourceReference.networkPassphrase??request?.context?.networkPassphrase??sourceReference.network??null,
  sourceReference,observedAt:sourceReference.observedAt??exchange?.finishedAt??null};
 let records,kind,numberTokens;
 if(event){
  invariant(provider==='paycashless'&&event.verified===true,'VERIFIED_ORIGINAL_EVENT_REQUIRED');
  if(event.projectable===false||!event.eventId)return [];
  invariant(plain(event.value)&&typeof event.value.event==='string'&&plain(event.value.data),'PAYCASHLESS_EVENT_ENVELOPE_REQUIRED');
  kind='paycashless-event';records=[{value:event.value,pointer:''}];numberTokens=event.numberTokens??{};
  Object.assign(context,{eventId:event.eventId,eventType:event.eventType,eventTypeAuthenticated:false,verifiedData:event.verifiedData===true,
    authenticatedFields:event.authenticatedFields??[],transactionId:event.transactionId,readOnly:false});
 }else{
  invariant(exchange?.classification?.outcome==='accepted'&&exchange.response?.complete,'COMPLETE_ACCEPTED_SOURCE_REQUIRED');
  const contract=actionContract(request.action),value=exchange.parsed?.value;
  kind=contract.entry.resourceKind;numberTokens=exchange.parsed?.numberTokens??{};
  if(contract.entry.responseFormat!=='json'||value===undefined||value===null)return [];
  if(provider==='paycashless'){
   const projection=contract.entry.projection;if(!projection)return [];
   const pointer=projection.pointer??'',selected=get(value,pointer);
   if(projection.many){invariant(Array.isArray(selected),'ORIGINAL_RESPONSE_ROWS_REQUIRED');records=selected.map((value,i)=>({value,pointer:pointer+'/'+i}));}
   else records=[{value:selected,pointer}];
  }else if(exchange.transport?.eventStream===true){
   invariant(provider==='horizon'&&contract.entry.id==='horizon.payments.account','ORIGINAL_HORIZON_STREAM_REQUIRED');
   records=[{value,pointer:''}];
  }else if(contract.entry.pagination==='horizon'){
   invariant(Array.isArray(value?._embedded?.records),'HORIZON_PAGE_SCHEMA');
   records=value._embedded.records.map((value,i)=>({value,pointer:'/_embedded/records/'+i}));
  }else records=[{value,pointer:''}];
  Object.assign(context,{action:request.action,readOnly:!request.mutation,requestInput:request.input});
 }
 const output=[];
 for(const record of records){
  invariant(plain(record.value),'PROVIDER_RESOURCE_OBJECT_REQUIRED');
  const value=record.value,localContext={...context};
  if(provider==='paycashless'){
   const observed=kind==='paycashless-event'?value.data.liveMode:value.liveMode;
   invariant(observed===undefined||observed===null||typeof observed==='boolean','PAYCASHLESS_LIVE_MODE_INVALID');
   invariant(observed==null||observed===(environment==='production'),'PAYCASHLESS_SOURCE_ENVIRONMENT_MISMATCH');
  }
  if(kind==='horizon-network')invariant(typeof value.network_passphrase==='string'&&value.network_passphrase===context.networkPassphrase,'HORIZON_NETWORK_MISMATCH');
  const id=nativeID(kind,value,request,localContext);
  invariant(typeof id==='string'&&id.length,'PROVIDER_RESOURCE_ID_REQUIRED',{kind,pointer:record.pointer});
  const tokens=tokensBelow(numberTokens,record.pointer),contentSha256=sha256(Buffer.from(canonicalJSON({value,numberTokens:tokens})));
  const updated=provider==='paycashless'&&kind!=='paycashless-event'?value.updatedAt:value.updated_at;
  output.push({id,kind,provider,environment,value,numberTokens:tokens,pointer:record.pointer,context:localContext,
   contentSha256,versionSha256:contentSha256,sourceUpdatedAt:validTime(updated)?updated:null,
   sourceUpdateTimeInvalid:updated!==undefined&&updated!==null&&!validTime(updated),observedAt:context.observedAt,
   eventId:context.eventId??null,eventSequence:null,partial:kind==='paycashless-operation-result',relatedReads:related(kind,value,localContext)});
  if(kind==='horizon-operation'&&plain(value.transaction)&&value.transaction.hash){
   const tx=value.transaction,txTokens=tokensBelow(numberTokens,record.pointer+'/transaction'),hash=sha256(Buffer.from(canonicalJSON({value:tx,numberTokens:txTokens})));
   output.push({id:tx.hash,kind:'horizon-transaction',provider,environment,value:tx,numberTokens:txTokens,pointer:record.pointer+'/transaction',
    context:localContext,contentSha256:hash,versionSha256:hash,sourceUpdatedAt:null,observedAt:context.observedAt,eventId:null,eventSequence:null,partial:false,relatedReads:[]});
  }
 }
 return output;
}
export function reconcileVersions(existing,incoming) {
 invariant(existing.kind===incoming.kind&&String(existing.id)===String(incoming.id)&&
  existing.environment===incoming.environment,'RESOURCE_IDENTITY_MISMATCH');
 const oldScope=existing.context?.providerScope??existing.sourceScope,newScope=incoming.context?.providerScope??incoming.sourceScope;
 invariant(!oldScope||!newScope||oldScope===newScope,'RESOURCE_PROVIDER_SCOPE_MISMATCH');
 if(existing.contentSha256===incoming.contentSha256)return{decision:'replace',reason:'Same original business content; retain the latest observation and source.'};
 if(existing.partial&&!incoming.partial)return{decision:'replace',reason:'Complete original resource succeeds a partial operation response.'};
 if(!existing.partial&&incoming.partial)return{decision:'keep',reason:'Partial operation response does not replace a complete resource.'};
 const a=existing.eventSequence,b=incoming.eventSequence;
 if(a!==null&&a!==undefined&&b!==null&&b!==undefined&&/^\d+$/.test(String(a))&&/^\d+$/.test(String(b))&&
  existing.context?.developerId===incoming.context?.developerId){
  if(BigInt(b)>BigInt(a))return{decision:'replace',reason:'Later original event sequence for this resource.'};
  if(BigInt(b)<BigInt(a))return{decision:'keep',reason:'Earlier original event sequence retained in history.'};
  return{decision:'conflict',reason:'Same original event sequence has different business content.'};
 }
 const oldTime=exactTime(existing.sourceUpdatedAt),newTime=exactTime(incoming.sourceUpdatedAt);
 if(existing.sourceUpdateTimeInvalid||incoming.sourceUpdateTimeInvalid||
   existing.sourceUpdatedAt!=null&&!oldTime||incoming.sourceUpdatedAt!=null&&!newTime)
  return{decision:'conflict',reason:'An original supplied resource update timestamp is invalid; no temporal order is inferred.'};
 if(oldTime&&newTime){
  const order=compareTime(newTime,oldTime);
  if(order>0)return{decision:'replace',reason:'Later native resource update timestamp.'};
  if(order<0)return{decision:'keep',reason:'Earlier native resource update retained in history.'};
  return{decision:'conflict',reason:'Same native update timestamp has different original content.'};
 }
 if(['horizon-transaction','horizon-operation','horizon-ledger','paycashless-event'].includes(incoming.kind))
  return{decision:'conflict',reason:'An immutable native record has conflicting original observations.'};
 const observedOld=exactTime(existing.observedAt),observedNew=exactTime(incoming.observedAt);
 if(incoming.context?.readOnly&&observedOld&&observedNew&&compareTime(observedNew,observedOld)>0)
  return{decision:'replace',reason:'Later complete native read of an untimed mutable resource.'};
 return{decision:'conflict',reason:'Original observations do not establish a later native version.'};
}
