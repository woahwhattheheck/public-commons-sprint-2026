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

function optional(value,pointer){try{return get(value,pointer);}catch{return undefined;}}
function related(kind,value,context){
 const reads=[],add=(action,params={},query)=>reads.push({action,input:{params,...(query?{query}:{})}});
 const input=context.requestInput??{},params=input.params??{},body=input.body??{};
 if(kind==='escala-fund')add('escala.fund.contributions',{fundId:value.fundId??body.fundId??params.fundId});
 if(kind==='escala-proposal')add('escala.proposal.tally',{proposalId:value.proposalId??params.proposalId});
 if(kind==='escala-milestone'||kind==='escala-evidence')add('escala.milestone.attestations',{milestoneId:value.milestoneId??params.milestoneId});
 if(kind==='escala-disbursement'&&params.proposalId)add('escala.proposal.disbursements',{proposalId:params.proposalId});
 if(kind==='sdp-disbursement'&&value.id){
  add('sdp.disbursement.get',{id:value.id});add('sdp.disbursement.receivers',{id:value.id});
  add('sdp.disbursement.instructions.get',{id:value.id});
 }
 if(kind==='sdp-payment'&&value.id){
  add('sdp.payment.get',{id:value.id});
  if(value.disbursement?.id)add('sdp.disbursement.get',{id:value.disbursement.id});
  if(typeof value.stellar_transaction_id==='string'&&/^[a-fA-F0-9]{64}$/.test(value.stellar_transaction_id))
   reads.push({action:'horizon.transaction.get',input:{params:{transactionHash:value.stellar_transaction_id}},requiresConnectionProvider:'horizon'});
 }
 if(kind==='sdp-distribution-wallet'&&value.id){
  add('sdp.distribution-wallet.balance',{id:value.id});add('sdp.distribution-wallet.capabilities',{id:value.id});
 }
 if(kind==='horizon-account'&&value.account_id)add('horizon.transactions.account',{accountId:value.account_id});
 if(kind==='horizon-operation'&&value.transaction_hash)add('horizon.transaction.get',{transactionHash:value.transaction_hash});
 return reads.filter(r=>Object.values(r.input.params).every(v=>typeof v==='string'&&v.length));
}
export function projectResource({exchange,event,provider,environment,sourceReference={}}){
 const request=exchange?.request;provider??=request?.provider;environment??=request?.environment;
 invariant(['escala','sdp','horizon'].includes(provider)&&['production','sandbox'].includes(environment),'PROJECTION_SCOPE_REQUIRED');
 invariant(!event,'ORIGINAL_SIGNED_WEBHOOK_CONTRACT_NOT_SUPPLIED');
 invariant(exchange?.classification?.outcome==='accepted'&&exchange.response?.complete,'COMPLETE_ACCEPTED_SOURCE_REQUIRED');
 const contract=actionContract(request.action),root=exchange.parsed?.value;
 if(contract.entry.responseFormat!=='json'||root===undefined||root===null)return [];
 const context={...(request.context??{}),provider,environment,sourceId:sourceReference.sourceId??null,
  connectionAlias:sourceReference.connectionAlias??null,providerScope:sourceReference.sourceScope??request.context?.sourceScope??null,
  sourceScope:sourceReference.sourceScope??request.context?.sourceScope??null,
  networkPassphrase:sourceReference.networkPassphrase??request.context?.networkPassphrase??sourceReference.network??null,
  sourceReference,observedAt:sourceReference.observedAt??exchange.finishedAt??null,
  apiMode:provider==='escala'?'mock':exchange.transport?.imported?'operator-supplied':'live',
  executionSemantics:request.executionSemantics,tenantId:request.context?.tenantId??null,
  tenantBinding:'operator-configured',action:request.action,readOnly:!request.mutation,
  requestInput:request.input,params:request.input.params??{},body:request.input.body??null,
  responseIdentity:Object.fromEntries(Object.entries(plain(root)?root:{}).filter(([k,v])=>/^(?:fundId|proposalId|milestoneId|communityId|walletId|disbursementRequestId)$/.test(k)&&typeof v==='string'))};
 const numberTokens=exchange.parsed?.numberTokens??{},records=[];
 if(provider!=='horizon'){
  for(const projection of contract.entry.projections??[]){
   const selected=get(root,projection.pointer??'');
   if(projection.many){
    invariant(Array.isArray(selected),'ORIGINAL_RESPONSE_ROWS_REQUIRED');
    selected.forEach((value,index)=>records.push({value,pointer:(projection.pointer??'')+'/'+index,projection}));
   }else records.push({value:selected,pointer:projection.pointer??'',projection});
  }
 }else if(exchange.transport?.eventStream===true){
  invariant(contract.entry.id==='horizon.payments.account','ORIGINAL_HORIZON_STREAM_REQUIRED');
  records.push({value:root,pointer:''});
 }else if(contract.entry.pagination==='horizon'){
  invariant(Array.isArray(root?._embedded?.records),'HORIZON_PAGE_SCHEMA');
  root._embedded.records.forEach((value,index)=>records.push({value,pointer:'/_embedded/records/'+index}));
 }else records.push({value:root,pointer:''});
 const output=[];
 for(const record of records){
  const kind=record.projection?.kind??contract.entry.resourceKind,value=record.value;
  invariant(plain(value)||kind==='sdp-verification-types'&&Array.isArray(value),'PROVIDER_RESOURCE_OBJECT_REQUIRED');
  const tokens=tokensBelow(numberTokens,record.pointer),contentSha256=sha256(Buffer.from(canonicalJSON({value,numberTokens:tokens})));
  let id;
  if(record.projection){
   id=record.projection.id??(record.projection.idPointer?optional(value,record.projection.idPointer):undefined);
   if(record.projection.contentIdentity)id=contentSha256;
   if((id===undefined||id===null||id==='')&&record.projection.fallbackIdentity)
    id=request.resourceId??(record.projection.many?contentSha256:canonicalJSON([kind,request.input.params,request.input.query,request.input.headers]));
  }else if(kind==='horizon-network')id='network';
  else if(kind==='horizon-transaction')id=value.hash??value.id;
  else if(kind==='horizon-account')id=value.account_id??value.id;
  else if(kind==='horizon-ledger')id=String(value.sequence??value.id??'');
  else id=value.id;
  invariant(typeof id==='string'&&id.length,'PROVIDER_RESOURCE_ID_REQUIRED',{kind,pointer:record.pointer});
  if(kind==='horizon-network')invariant(value.network_passphrase===context.networkPassphrase,'HORIZON_NETWORK_MISMATCH');
  const updated=value.updated_at??value.updatedAt;
  output.push({id,kind,provider,environment,value,numberTokens:tokens,pointer:record.pointer,context,
   contentSha256,versionSha256:contentSha256,sourceUpdatedAt:validTime(updated)?updated:null,
   sourceUpdateTimeInvalid:updated!==undefined&&updated!==null&&!validTime(updated),observedAt:context.observedAt,
   eventId:null,eventSequence:null,partial:kind==='sdp-operation-result',relatedReads:related(kind,value,context)});
  if(kind==='horizon-operation'&&plain(value.transaction)&&value.transaction.hash){
   const tx=value.transaction,txTokens=tokensBelow(numberTokens,record.pointer+'/transaction'),hash=sha256(Buffer.from(canonicalJSON({value:tx,numberTokens:txTokens})));
   output.push({id:tx.hash,kind:'horizon-transaction',provider,environment,value:tx,numberTokens:txTokens,pointer:record.pointer+'/transaction',
    context,contentSha256:hash,versionSha256:hash,sourceUpdatedAt:null,observedAt:context.observedAt,eventId:null,eventSequence:null,partial:false,relatedReads:[]});
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
 if(['horizon-transaction','horizon-operation','horizon-ledger','escala-moneygram-event','escala-sdp-event'].includes(incoming.kind))
  return{decision:'conflict',reason:'An immutable native record has conflicting original observations.'};
 const observedOld=exactTime(existing.observedAt),observedNew=exactTime(incoming.observedAt);
 if(incoming.context?.readOnly&&observedOld&&observedNew&&compareTime(observedNew,observedOld)>0)
  return{decision:'replace',reason:'Later complete native read of an untimed mutable resource.'};
 return{decision:'conflict',reason:'Original observations do not establish a later native version.'};
}
