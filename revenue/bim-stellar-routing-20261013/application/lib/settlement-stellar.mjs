import {Buffer} from 'node:buffer';
import {identity,need} from './value.mjs';
import {assetIdentity,assetKey,amount} from './settlement-exact.mjs';
import {quoteRows,sourceMatches} from './exchange-domain.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const signed=v=>{const s=typeof v==='bigint'?v.toString():typeof v==='string'?v:null;need(s!==null&&/^-?(0|[1-9]\d*)$/u.test(s)&&s!=='-0','EXACT_LEDGER_AMOUNT');return s;};
function whenSeconds(value){if(typeof value!=='string'||!/^(0|[1-9]\d*)$/u.test(value))return null;const ms=BigInt(value)*1000n;return ms<=8640000000000000n?new Date(Number(ms)).toISOString():null;}
function refsUnion(...groups){return [...new Map(groups.flat().map(x=>[JSON.stringify(x),x])).values()];}
export const STELLAR_SETTLEMENT_SOURCE={
 schema:'bim.stellar-settlement-source.v1',sdk:'@stellar/stellar-sdk',version:'16.0.1',
 applicationSource:'1836ed358fa751263ce56cc2ca47842942b0f553',
 ledgerXdr:{repository:'stellar/stellar-xdr',path:'Stellar-ledger.x',blob:'47726e3fa5a414a0e1337a9d138c684fc1a4ae43'},
 transactionXdr:{repository:'stellar/stellar-xdr',path:'Stellar-transaction.x',blob:'11cacd7454155a3ceec7f3894bfedd87dc9eaf14'},
 tokenEvents:{repository:'stellar/stellar-protocol',path:'ecosystem/sep-0041.md',blob:'d051a3818b8eab9fc7627b92148b03bef23ea1ec'},
 eventSource:'https://developers.stellar.org/docs/tokens/token-interface',
 unifiedEvents:{url:'https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md',repository:'stellar/stellar-protocol',path:'core/cap-0067.md',blob:'01fb34b226a7dceb0e426c3939076c43b0d90812'}
};
export function createStellarSettlementReader({sdk}){
 need(sdk?.xdr?.TransactionMeta&&sdk?.TransactionBuilder&&sdk?.StrKey&&sdk?.Asset&&sdk?.scValToNative,'ORIGINAL_STELLAR_SDK_REQUIRED');
 return Object.freeze({id:'bim-stellar-settlement-v1',project(ctx,p){
  const w=ctx.workspace,metadata=new Map(),proofs=[],executions=new Map(),movements=new Map(),quoteIndex=new Map(),queryRows=ctx.recordMaps.queries;
  const network=row=>row.configuration?.network?.passphrase;
  function topicValue(value){
   if(value.switch().name!=='scvAddress')return sdk.scValToNative(value);
   const address=value.address(),type=address.switch().name;
   if(type==='scAddressTypeAccount')return sdk.StrKey.encodeEd25519PublicKey(address.accountId().ed25519());
   if(type==='scAddressTypeContract')return sdk.StrKey.encodeContract(address.contractId());
   // Unified classic events can name liquidity pools or claimable balances.
   // They remain exact original counterpart identities, never invented wallets.
   return {schema:'bim.stellar-event-counterpart.v1',type,xdr:Buffer.from(value.toXDR()).toString('base64')};
  }
  const walletAddress=x=>typeof x==='string'&&/^[GC][A-Z2-7]{55}$/u.test(x)?x:null;
  const exactTopics=x=>typeof x==='bigint'?x.toString():Array.isArray(x)?x.map(exactTopics):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,exactTopics(v)])):x;
  function putAsset(passphrase,contract,asset,refs,sourceId){
   need(typeof passphrase==='string'&&typeof contract==='string','ASSET_NETWORK_REQUIRED');
   const key=passphrase+'\n'+contract,entry=metadata.get(key)??{values:new Map(),refs:[],sources:[]};
   entry.values.set(assetKey(asset),assetIdentity(asset));entry.refs=refsUnion(entry.refs,refs);entry.sources.push(sourceId);metadata.set(key,entry);
  }
  function classicAsset(asset,passphrase,refs,sourceId){
   const projected=assetIdentity(asset.isNative()?{chain:'stellar',network:passphrase,kind:'NATIVE',nativeId:'XLM',decimals:7}:{chain:'stellar',network:passphrase,kind:'ISSUED',code:asset.getCode(),issuer:asset.getIssuer(),decimals:7});
   putAsset(passphrase,asset.contractId(passphrase),projected,refs,sourceId);return projected;
  }
  function resolve(passphrase,contract){
   const entry=metadata.get(passphrase+'\n'+contract);if(!entry)return null;
   // A verified Stellar Asset Contract presentation can refine the same
   // contract's TOKEN presentation; incompatible precision remains a conflict.
   const values=[...entry.values.values()],precisions=new Set(values.map(a=>a.decimals));
   if(precisions.size!==1)return null;const classic=values.filter(a=>a.kind!=='TOKEN');
   return classic.length===1?classic[0]:classic.length===0&&values.length===1?values[0]:null;
  }
  function amountAt(passphrase,contract,atomic){const asset=resolve(passphrase,contract);return asset&&typeof atomic==='string'?amount({asset,atomic},{nonnegative:true}):null;}
  function eventRows(meta){
   const version=meta.switch();
   if(version===3){const soroban=meta.value().sorobanMeta();return{version,events:(soroban?.events()??[]).map((event,index)=>({event,operationIndex:0,index,phase:'OPERATION'}))};}
   if(version===4){const v=meta.value();return{version,events:[...v.operations().flatMap((op,operationIndex)=>op.events().map((event,index)=>({event,operationIndex,index,phase:'OPERATION'}))),...v.events().map((x,index)=>({event:x.event(),operationIndex:null,index,phase:'TRANSACTION',stage:x.stage().name}))]};}
   return{version,events:[]};
  }
  for(const row of w.queries){
   const v=row.value,refs=[ctx.recordRef('queries',row),...ctx.exchangeRefs(row)],passphrase=network(row);
   if(row.actionId==='exchange.asset'&&v?.schema==='bim.asset-observation.v1'){
    ctx.handled.add(row.id);
    try{
     need(v.networkPassphrase===passphrase&&typeof v.contractId==='string'&&/^C[A-Z2-7]{55}$/u.test(v.contractId),'ASSET_ORIGINAL_NETWORK');
     const decimals=Number(signed(typeof v.decimals==='number'?String(v.decimals):v.decimals));need(Number.isInteger(decimals)&&decimals>=0&&decimals<=38,'ASSET_PRECISION');
     putAsset(passphrase,v.contractId,{chain:'stellar',network:passphrase,kind:'TOKEN',address:v.contractId,decimals},refs,row.id);
    }catch(error){ctx.exception('ASSET_METADATA_REVIEW',row.id,error.message,refs);}
   }
   if(!['exchange.confirm','soroswap.confirm','defindex.confirm'].includes(row.actionId))continue;
   ctx.handled.add(row.id);
   const plan=ctx.recordMaps.plans.get(v.planId)?.row,submission=ctx.recordMaps.submissions.get(v.submissionId)?.row;
   if(!['CONFIRMED','FAILED'].includes(v.status)){
    p.lifecycle.push({id:'confirmation:'+row.id,provider:v.provider??plan?.value?.provider??null,providerIdentity:v.transactionHash??null,accountId:ctx.accountOf(row),state:v.status??'UNKNOWN',sourceConfirmed:false,destinationConfirmed:false,cashPaidOut:false,refundConfirmed:false,economicAt:null,observedAt:ctx.timestamp(row.createdAt),sourceRefs:refs});continue;
   }
   try{
    need(plan&&submission&&submission.planId===plan.id&&submission.submission.transactionHash.toLowerCase()===v.transactionHash.toLowerCase(),'ORIGINAL_CONFIRMATION_PLAN');
    need(network(plan)===passphrase&&network(submission)===passphrase,'ORIGINAL_CONFIRMATION_NETWORK');
    const raw=v.horizon??v.rpc,env=raw.envelope_xdr??raw.envelopeXdr,resultXdr=raw.result_xdr??raw.resultXdr,metaXdr=raw.result_meta_xdr??raw.resultMetaXdr;
    need(typeof env==='string'&&typeof resultXdr==='string','COMPLETE_ORIGINAL_LEDGER_PROOF');
    const tx=sdk.TransactionBuilder.fromXDR(env,passphrase),inner=tx.innerTransaction??tx,txHash=Buffer.from(tx.hash()).toString('hex'),innerHash=Buffer.from(inner.hash()).toString('hex'),expected=v.transactionHash.toLowerCase();
    need([txHash,innerHash].includes(expected)&&innerHash===plan.unsignedPayload.transactionHash&&inner.source===plan.unsignedPayload.source,'CONFIRMED_ORIGINAL_BODY');
    const result=sdk.xdr.TransactionResult.fromXDR(resultXdr,'base64'),code=result.result().switch().name,success=['txSuccess','txFeeBumpInnerSuccess'].includes(code);
    need(success===(v.status==='CONFIRMED'),'CONFIRMED_ORIGINAL_RESULT');
    const originalBodies=(row.exchangeIds??[]).map(id=>ctx.recordMaps.exchanges.get(id)?.row).filter(Boolean).filter(e=>e.status==='COMPLETE'&&e.response?.bodyFileId).map(e=>({e,value:ctx.decoded(e.response.bodyFileId)}));
    need(originalBodies.some(x=>x.value?.result?.passphrase===passphrase||x.value?.network_passphrase===passphrase),'CAPTURED_NETWORK_PROOF');
    need(originalBodies.some(x=>identity(v.horizon?x.value:x.value?.result??null)===identity(raw)),'CAPTURED_CONFIRMATION_RESPONSE');
    const economicAt=v.horizon?ctx.timestamp(v.horizon.created_at):whenSeconds(v.rpc.createdAt),authority=passphrase+'|'+(v.horizon?row.configuration.network.horizonUrl:row.configuration.network.rpcUrl);
    const boundRefs=refsUnion(refs,[ctx.recordRef('plans',plan),ctx.recordRef('submissions',submission)]);
    for(const op of inner.operations)for(const key of ['asset','sendAsset','destAsset'])if(op[key]&&typeof op[key].contractId==='function')classicAsset(op[key],passphrase,boundRefs,row.id);
    const decoded=metaXdr?eventRows(sdk.xdr.TransactionMeta.fromXDR(metaXdr,'base64')):{version:null,events:[]};
    const events=[],unparsedEvents=[];
    for(const originalEvent of decoded.events){
     try{
     const e=originalEvent.event;if(e.type().name==='diagnostic')continue;
     const contractBytes=e.contractId();if(!contractBytes)continue;
     const contract=sdk.StrKey.encodeContract(contractBytes),body=e.body().value(),topics=body.topics().map(topicValue),value=sdk.scValToNative(body.data()),name=topics[0];
     if(!['transfer','mint','burn','clawback','fee'].includes(name))continue;
     const atomic=signed(value&&typeof value==='object'&&!Array.isArray(value)?value.amount:value);
     need(name==='fee'||BigInt(atomic)>=0n,'NEGATIVE_TOKEN_TRANSFER');
     const adminShape=decoded.version===3&&['mint','clawback'].includes(name)&&topics.length>=3&&body.topics()[1].switch().name==='scvAddress'&&body.topics()[2].switch().name==='scvAddress';
     const required=name==='transfer'||adminShape?3:2;
     need(topics.length===required||topics.length===required+1,'TOKEN_EVENT_TOPICS');
     const accountTopics=adminShape?[topics[2]]:topics.slice(1,required),accountStart=adminShape?2:1;
     need(accountTopics.every((x,i)=>body.topics()[accountStart+i].switch().name==='scvAddress'),'TOKEN_EVENT_ADDRESSES');
     const accounts=accountTopics.map(walletAddress);
     if(topics.length===required+1){
      const sep=topics.at(-1);need(typeof sep==='string','SAC_ASSET_IDENTIFIER');
      const parts=sep.split(':'),asset=sep==='native'?sdk.Asset.native():parts.length===2?new sdk.Asset(parts[0],parts[1]):null;
      need(asset&&asset.contractId(passphrase)===contract,'SAC_EVENT_CONTRACT_BINDING');classicAsset(asset,passphrase,boundRefs,row.id);
     }
     if(name==='fee'){need(originalEvent.phase==='TRANSACTION','FEE_REQUIRES_TRANSACTION_EVENT');const asset=sdk.Asset.native();need(asset.contractId(passphrase)===contract,'NATIVE_FEE_CONTRACT');classicAsset(asset,passphrase,boundRefs,row.id);}
     events.push({...originalEvent,event:undefined,contract,name,atomic,from:name==='transfer'||name==='burn'||name==='clawback'||name==='fee'?accounts[0]:null,to:name==='transfer'?accounts[1]:name==='mint'?accounts[0]:null,topics:exactTopics(topics),counterparts:exactTopics(accountTopics),data:exactTopics(value),sourceRefs:boundRefs});
     }catch(error){
      unparsedEvents.push({phase:originalEvent.phase,operationIndex:originalEvent.operationIndex,index:originalEvent.index,code:error.code??error.message,xdr:Buffer.from(originalEvent.event.toXDR()).toString('base64')});
      ctx.exception('CONFIRMED_EVENT_REVIEW',row.id+':'+originalEvent.phase+':'+originalEvent.operationIndex+':'+originalEvent.index,error.message,boundRefs);
     }
    }
    proofs.push({unparsedEvents,txHash,innerHash,resultXdr,ledger:v.ledger===undefined||v.ledger===null?null:String(v.ledger),row,value:v,plan,submission,passphrase,authority,economicAt,tx,inner,result,success,events,metadataVersion:decoded.version,sourceRefs:boundRefs,confirmedIdentity:passphrase+':'+txHash});
   }catch(error){ctx.exception('LEDGER_PROJECTION_REVIEW',row.id,error.message,refs);}
  }
  for(const [key,entry]of metadata)if(!resolve(key.slice(0,key.indexOf('\n')),key.slice(key.indexOf('\n')+1)))ctx.exception('ASSET_PRECISION_CONFLICT',identity(key),'Original asset metadata has incompatible identities or precision; monetary projection requires a corrected source.',entry.refs);
  for(const row of w.queries){
   const quotes=quoteRows(row);if(!quotes.length)continue;ctx.handled.add(row.id);
   for(let i=0;i<quotes.length;i++){
    const q=quotes[i],passphrase=network(row),id=row.id+':quote:'+i,refs=[ctx.recordRef('queries',row),...ctx.exchangeRefs(row)];
    if(!sourceMatches(row,q)||q.networkPassphrase!==passphrase){ctx.exception('QUOTE_SOURCE_REVIEW',id,'Original normalized quote does not bind to its complete provider query.',refs);continue;}
    const input=amountAt(passphrase,q.tokenIn,q.amountIn),output=amountAt(passphrase,q.tokenOut,q.amountOut);
    const sourceRefs=refsUnion(refs,metadata.get(passphrase+'\n'+q.tokenIn)?.refs??[],metadata.get(passphrase+'\n'+q.tokenOut)?.refs??[]);
    const projected={id,protocol:q.provider,accountId:q.source,providerQuoteId:row.id,routeIndex:String(i),mode:q.mode==='EXACT_IN'?'EXACT_INPUT':'EXACT_OUTPUT',input,output,minimumOutput:amountAt(passphrase,q.tokenOut,q.minAmountOut),maximumInput:amountAt(passphrase,q.tokenIn,q.maxAmountIn),expiresAt:q.expiresAt,sourceRefs};
    p.quotes.push(projected);quoteIndex.set(row.id+'\n'+i,{projected,original:q});
    if(!input||!output)ctx.exception('QUOTE_ASSET_METADATA_REQUIRED',id,'Read the original token metadata with exchange.asset to retain its actual contract precision, or receive its verified Stellar Asset Contract source.',sourceRefs);
   }
  }
  for(const row of w.plans){
   const v=row.value;if(!['exchange.prepareBest','aqua.prepare','sushi.prepare','soroswap.prepare'].includes(row.actionId))continue;ctx.handled.add(row.id);
   const selected=v.selected??v.quoteReference??(v.quoteId?{quoteId:v.quoteId,routeIndex:v.selection?.routeIndex??'0'}:null),refs=[ctx.recordRef('plans',row),...ctx.exchangeRefs(row)];
   if(selected){
    const q=quoteIndex.get(selected.quoteId+'\n'+selected.routeIndex)?.projected;
    p.selections.push({id:row.id,kind:'ORIGINAL_PLAN_SELECTION',protocol:selected.provider??v.provider??q?.protocol??null,accountId:ctx.accountOf(row),selectedAt:ctx.timestamp(row.createdAt),quoteId:q?.id??null,outcome:row.status,sourceRefs:refs});
   }
   if(v.schema==='bim.route-preparation.v1'){
    const attempts=v.attempts??[],chosen=selected?attempts.findIndex(a=>a.quoteId===selected.quoteId&&String(a.routeIndex)===String(selected.routeIndex)&&a.status==='PREPARED'):-1;
    for(let i=0;i<attempts.length;i++){
     const attempt=attempts[i],id=row.id+':attempt:'+i,q=quoteIndex.get(attempt.quoteId+'\n'+attempt.routeIndex)?.projected,sourceRefs=[ctx.recordRef('plans',row,'/value/attempts/'+i),...ctx.exchangeRefs(row)];
     p.selections.push({id,kind:'ROUTE_ATTEMPT',protocol:attempt.provider,accountId:ctx.accountOf(row),selectedAt:ctx.timestamp(row.createdAt),quoteId:q?.id??null,outcome:attempt.status,sourceRefs});
     if(i===chosen||attempt.status==='PREPARED')continue;
     const unavailable=['HTTP_TIMEOUT','HTTP_RESPONSE_CAPACITY','ORIGINAL_EXCHANGE_UNRESOLVED','AQUA_RESPONSE','SOURCE_UNAVAILABLE'].includes(attempt.error?.code);
     const simulationFailed=attempt.value?.simulation?.error||attempt.value?.status==='NEEDS_REVIEW'||attempt.error?.code==='CONTRACT_SIMULATION';
     p.fallbacks.push({id:row.id+':fallback:'+i,accountId:ctx.accountOf(row),occurredAt:ctx.timestamp(row.createdAt),fromSelectionId:id,toSelectionId:chosen>i?row.id:null,reason:simulationFailed?'SIMULATION_FAILED':unavailable?'SOURCE_UNAVAILABLE':'UNCLASSIFIED_ORIGINAL_FAILURE',originalReason:clone(attempt.error??attempt.value??null),sourceRefs:refsUnion(sourceRefs,refs)});
    }
   }
  }
  // Confirmations are observations of the same original transaction. Select one
  // complete original event presentation before deriving movements, so a v3
  // result-fee observation and later v4 fee events cannot charge the same fee twice.
  const proofGroups=new Map();
  for(const proof of proofs){const rows=proofGroups.get(proof.confirmedIdentity)??[];rows.push(proof);proofGroups.set(proof.confirmedIdentity,rows);}
  function retainProofConflict(first,id,sourceRefs,observationIds,economicAt,reason){
   if(first.plan.value.kind==='defindex-plan'){
    p.vaultActivities.push({id:'vault-activity:'+id,provider:'defindex',vault:first.plan.value.vault,accountId:first.plan.value.selection?.owner??ctx.accountOf(first.plan)??first.inner.source,economicAt,observedAt:null,state:'CONFLICT',sourceStatus:'PARTIAL',sourceReasons:[reason],operation:first.plan.value.operation??first.plan.value.request?.operation??null,planId:first.plan.id,confirmedIdentity:id,transactionHash:first.txHash,ledger:null,shareChangeAtomic:null,sharePrecision:null,flows:[],unresolvedContracts:[],unparsedEvents:[],sourceRefs,observationIds,basis:'Conflicting original confirmations remain retained as vault activity; no monetary flow is selected.'});
   }else p.executions.push({id:'execution:'+id,protocol:null,accountId:first.inner.source,economicAt,observedAt:null,state:'CONFLICT',selectedQuoteId:null,confirmedIdentity:id,input:null,output:null,sourceRefs,observationIds});
  }
  const chosenProofs=[];
  for(const [id,rows]of proofGroups){
   const first=rows[0],facts=x=>({innerHash:x.innerHash,resultXdr:x.resultXdr,success:x.success});
   const times=new Set(rows.map(x=>x.economicAt).filter(Boolean)),ledgers=new Set(rows.map(x=>x.ledger).filter(x=>x!==null));
   const conflict=rows.some(x=>identity(facts(x))!==identity(facts(first)))||times.size>1||ledgers.size>1;
   const allRefs=refsUnion(...rows.map(x=>x.sourceRefs)),observationIds=rows.map(x=>x.row.id);
   if(conflict){
    ctx.exception('EXECUTION_OBSERVATION_CONFLICT',id,'Original confirmations of the same transaction disagree on result, body, ledger or economic time.',allRefs);
    retainProofConflict(first,id,allRefs,observationIds,times.size===1?[...times][0]:null,'ORIGINAL_CONFIRMATION_CONFLICT');continue;
   }
   rows.sort((a,b)=>(b.metadataVersion??-1)-(a.metadataVersion??-1)||a.unparsedEvents.length-b.unparsedEvents.length||b.events.length-a.events.length||a.row.id.localeCompare(b.row.id));
   const chosen=rows[0],eventIdentity=x=>identity(x.events.map(({sourceRefs,event,...e})=>e)),sameVersion=rows.filter(x=>x.metadataVersion===chosen.metadataVersion);
   if(sameVersion.some(x=>eventIdentity(x)!==eventIdentity(chosen))){
    ctx.exception('CONFIRMED_EVENT_OBSERVATION_CONFLICT',id,'Complete confirmations disagree on original events in the same metadata version.',allRefs);
    retainProofConflict(first,id,allRefs,observationIds,chosen.economicAt,'ORIGINAL_EVENT_PRESENTATION_CONFLICT');continue;
   }
   const planSelections=rows.map(x=>x.plan.value.selected??x.plan.value.quoteReference??(x.plan.value.quoteId?{quoteId:x.plan.value.quoteId,routeIndex:x.plan.value.selection?.routeIndex??'0'}:null));
   const selectedKeys=new Set(planSelections.map(x=>x?x.quoteId+'\\n'+x.routeIndex:null));
   chosen.selectionAmbiguous=selectedKeys.size!==1;
   if(chosen.selectionAmbiguous)ctx.exception('EXECUTION_SELECTION_REVIEW',id,'The same actual transaction appears under different original selected quotes; monetary movements remain retained and quote quality requires review.',allRefs);
   chosen.sourceRefs=allRefs;chosen.observationIds=observationIds;chosen.economicAt=times.size?[...times][0]:null;chosen.ledger=ledgers.size?[...ledgers][0]:null;
   chosenProofs.push(chosen);
  }
  for(const row of w.plans)if(String(row.actionId).startsWith('defindex.')&&row.value?.kind==='defindex-plan'){
   ctx.handled.add(row.id);p.lifecycle.push({id:'vault-plan:'+row.id,provider:'defindex',providerIdentity:row.value.vault,accountId:ctx.accountOf(row),state:row.status,sourceConfirmed:false,destinationConfirmed:false,cashPaidOut:false,refundConfirmed:false,economicAt:null,observedAt:ctx.timestamp(row.createdAt),operation:row.value.operation??row.value.request?.operation??null,sourceRefs:[ctx.recordRef('plans',row),...ctx.exchangeRefs(row)]});
  }
  const observedAccountSet=new Set([w.config.wallet?.address,...w.queries.map(ctx.accountOf),...w.plans.map(ctx.accountOf),...proofs.map(x=>x.inner.source)].filter(Boolean));
  const conflictedMovements=new Set();
  function addMovement(row){
   if(conflictedMovements.has(row.confirmedIdentity))return;
   const prior=movements.get(row.confirmedIdentity);
   if(prior){const {sourceRefs:a,observationIds:b,...x}=prior,{sourceRefs:c,observationIds:d,...y}=row;
    if(identity(x)!==identity(y)){ctx.exception('MOVEMENT_OBSERVATION_CONFLICT',row.confirmedIdentity,'Repeated confirmation contains conflicting original movement details.',refsUnion(a,c));movements.delete(row.confirmedIdentity);conflictedMovements.add(row.confirmedIdentity);return;}
    prior.sourceRefs=refsUnion(a,c);prior.observationIds=[...new Set([...b,...d])];
   }else movements.set(row.confirmedIdentity,row);
  }
  for(const proof of chosenProofs){
   proof.sourceRefs=refsUnion(proof.sourceRefs,...proof.events.map(e=>metadata.get(proof.passphrase+'\n'+e.contract)?.refs??[]));
   const {row,value:v,plan,passphrase,sourceRefs,economicAt,authority,confirmedIdentity}=proof,selected=plan.value.selected??plan.value.quoteReference??(plan.value.quoteId?{quoteId:plan.value.quoteId,routeIndex:plan.value.selection?.routeIndex??'0'}:null),q=selected&&!proof.selectionAmbiguous?quoteIndex.get(selected.quoteId+'\n'+selected.routeIndex):null;
   const account=q?.original.source??plan.value.selection?.owner??ctx.accountOf(plan)??proof.inner.source,net=new Map(),shareNet=new Map(),unknown=new Set(),vault=plan.value.kind==='defindex-plan'?plan.value.vault:null,hasFees=proof.events.some(e=>e.phase==='TRANSACTION'&&e.name==='fee');
   for(const event of proof.events){
    if(event.phase==='OPERATION'&&!proof.success)continue;
    if(vault===event.contract&&event.phase==='OPERATION'){let delta=0n;if(event.from===account)delta-=BigInt(event.atomic);if(event.to===account)delta+=BigInt(event.atomic);shareNet.set(vault,(shareNet.get(vault)??0n)+delta);}
    const asset=resolve(passphrase,event.contract),eventKey=confirmedIdentity+':'+event.phase+':'+(event.operationIndex??'tx')+':'+event.index;
    if(!asset){if(event.contract!==vault)unknown.add(event.contract);continue;}
    for(const accountId of new Set([event.from,event.to].filter(x=>x&&observedAccountSet.has(x)))){
     let signedAmount=0n;
     if(event.from===accountId)signedAmount-=BigInt(event.atomic);
     if(event.to===accountId)signedAmount+=BigInt(event.atomic);
     const role=event.name==='fee'?(BigInt(event.atomic)<0n?'NETWORK_FEE_REFUND':'NETWORK_FEE'):event.name.toUpperCase();
     addMovement({id:'movement:'+eventKey+':'+accountId,accountId,economicAt,observedAt:null,role,state:'CONFIRMED',confirmedIdentity:eventKey+':'+accountId,amount:amount({asset,atomic:signedAmount.toString()}),from:event.from,to:event.to,counterparts:event.counterparts,eventData:event.data,eventPosition:{phase:event.phase,operationIndex:event.operationIndex,index:event.index,stage:event.stage??null},authority,sourceRefs,observationIds:proof.observationIds});
     if(accountId===account&&event.phase==='OPERATION'){net.set(event.contract,(net.get(event.contract)??0n)+signedAmount);}
    }
   }
   if(!hasFees){
    const payer=proof.tx.innerTransaction?proof.tx.feeSource:proof.inner.source,charged=proof.result.feeCharged().toString();
    if(typeof payer==='string'&&observedAccountSet.has(payer)){
     const asset=assetIdentity({chain:'stellar',network:passphrase,kind:'NATIVE',nativeId:'XLM',decimals:7});
     addMovement({id:'movement:'+confirmedIdentity+':result-fee',accountId:payer,economicAt,observedAt:null,role:'NETWORK_FEE_AS_REPORTED',state:'CONFIRMED',confirmedIdentity:confirmedIdentity+':result-fee',amount:amount({asset,atomic:(-BigInt(charged)).toString()}),authority,sourceRefs,observationIds:proof.observationIds});
    }
   }
   if(vault){
    const flows=[...net].filter(([contract,value])=>contract!==vault&&value!==0n).map(([contract,value])=>({contract,direction:value>0n?'INFLOW':'OUTFLOW',amount:amount({asset:resolve(passphrase,contract),atomic:value.toString()})}));
    const sourceReasons=[...(proof.metadataVersion===null||proof.metadataVersion<3?['ORIGINAL_TOKEN_EVENTS_UNAVAILABLE']:[]),...(proof.unparsedEvents.length?['ORIGINAL_TOKEN_EVENT_REVIEW']:[]),...(unknown.size?['ORIGINAL_TOKEN_PRECISION_UNAVAILABLE']:[])],sourceStatus=sourceReasons.length?'PARTIAL':'OBSERVED';
    if(sourceReasons.includes('ORIGINAL_TOKEN_EVENTS_UNAVAILABLE'))ctx.exception('VAULT_EVENT_SOURCE_REQUIRED',row.id,'The original confirmation does not retain a complete v3/v4 token-event presentation; vault share and asset flows require that original source.',sourceRefs);
    p.vaultActivities.push({id:'vault-activity:'+confirmedIdentity,provider:'defindex',vault,accountId:account,economicAt,observedAt:null,state:proof.success?'CONFIRMED_SUCCESS':'CONFIRMED_FAILURE',sourceStatus,sourceReasons,operation:plan.value.operation??plan.value.request?.operation??null,planId:plan.id,confirmedIdentity,transactionHash:proof.txHash,ledger:proof.ledger,shareChangeAtomic:shareNet.has(vault)?shareNet.get(vault).toString():null,sharePrecision:null,flows,unresolvedContracts:[...unknown],unparsedEvents:proof.unparsedEvents,sourceRefs,observationIds:proof.observationIds,basis:'Original confirmed wallet token events and raw vault share change. Exact asset flows remain separate; share precision and cross-asset valuation are not inferred.'});
    for(const contract of unknown)ctx.exception('CONFIRMED_TOKEN_METADATA_REQUIRED',row.id+':'+contract,'Original confirmed vault movement is retained, but exact underlying token precision is unavailable.',sourceRefs);
    continue;
   }
   const candidate={id:'execution:'+confirmedIdentity,protocol:selected?.provider??plan.value.provider??q?.original.provider??null,accountId:account,economicAt,observedAt:null,state:proof.success?'CONFIRMED_SUCCESS':'CONFIRMED_FAILURE',selectedQuoteId:q?.projected.id??null,confirmedIdentity,input:null,output:null,planId:plan.id,transactionHash:proof.txHash,ledger:proof.ledger,metadataVersion:proof.metadataVersion,unparsedEvents:proof.unparsedEvents,sourceRefs,observationIds:proof.observationIds};
   if(proof.success&&q&&proof.unparsedEvents.length===0&&proof.metadataVersion>=3&&!unknown.has(q.original.tokenIn)&&!unknown.has(q.original.tokenOut)){
    const input=-(net.get(q.original.tokenIn)??0n),output=net.get(q.original.tokenOut)??0n;
    if(input>0n&&output>0n){candidate.input=amountAt(passphrase,q.original.tokenIn,input.toString());candidate.output=amountAt(passphrase,q.original.tokenOut,output.toString());candidate.amountBasis='Original confirmed token events, net funding-account input and output; transaction-level fees are separate.';}
   }
   for(const contract of unknown)ctx.exception('CONFIRMED_TOKEN_METADATA_REQUIRED',row.id+':'+contract,'Original confirmed token movement is retained, but exact token precision is unavailable.',sourceRefs);
   const prior=executions.get(confirmedIdentity);
   if(prior){const {sourceRefs:a,observationIds:b,...x}=prior,{sourceRefs:c,observationIds:d,...y}=candidate;
    if(identity(x)!==identity(y)){prior.state='CONFLICT';prior.input=null;prior.output=null;ctx.exception('EXECUTION_OBSERVATION_CONFLICT',confirmedIdentity,'Repeated original confirmations disagree; all source observations remain retained.',refsUnion(a,c));}
    prior.sourceRefs=refsUnion(a,c);prior.observationIds=[...new Set([...b,...d])];
   }else executions.set(confirmedIdentity,candidate);
  }
  p.executions.push(...executions.values());p.movements.push(...movements.values());
  for(const row of w.queries)if(row.actionId==='exchange.asset'&&row.value?.schema==='bim.asset-observation.v1'){
   const v=row.value,asset=resolve(network(row),v.contractId);if(!asset)continue;
   const sourceRefs=refsUnion([ctx.recordRef('queries',row),...ctx.exchangeRefs(row)],metadata.get(network(row)+'\n'+v.contractId)?.refs??[]);
   p.balances.push({id:row.id,role:'OBSERVATION',accountId:v.account,amount:amount({asset,atomic:signed(typeof v.balance==='number'?String(v.balance):v.balance)},{nonnegative:true}),rangeFrom:null,rangeThrough:null,economicAt:null,observedAt:ctx.timestamp(row.createdAt),authority:network(row)+'|'+row.configuration.network.rpcUrl,sourceRefs});
   p.coverage.push({id:'coverage:'+row.id,accountId:v.account,asset,status:'UNSPECIFIED',rangeFrom:null,rangeThrough:null,authority:network(row)+'|'+row.configuration.network.rpcUrl,message:'This retained balance simulation is an observation. It does not establish the report range opening/closing or a complete account transfer-history cursor.',sourceRefs});
  }
  for(const row of w.queries)if(row.actionId==='defindex.position'&&row.value?.kind==='defindex-position'){
   ctx.handled.add(row.id);const v=row.value,sourceRefs=[ctx.recordRef('queries',row),...ctx.exchangeRefs(row)],underlying=[],reasons=[];
   try{
    if(v.status!=='OBSERVED')reasons.push('ORIGINAL_POSITION_NEEDS_REVIEW');
    if(v.shares!==undefined)signed(v.shares);
    if(!Array.isArray(v.assets)||!Array.isArray(v.underlyingAmounts)||v.assets.length!==v.underlyingAmounts.length)reasons.push('ORIGINAL_ORDERED_UNDERLYING_INCOMPLETE');
    else for(let i=0;i<v.assets.length;i++){
     const contract=v.assets[i].address,atomic=signed(v.underlyingAmounts[i]),value=amountAt(network(row),contract,atomic);
     for(const ref of metadata.get(network(row)+'\n'+contract)?.refs??[])if(!sourceRefs.some(x=>identity(x)===identity(ref)))sourceRefs.push(ref);
     underlying.push({index:i,contract,atomic,amount:value});if(!value)reasons.push('ASSET_METADATA_REQUIRED:'+contract);
    }
   }catch(error){reasons.push(error.code??error.message);}
   p.positions.push({id:row.id,provider:'defindex',vault:v.vault,accountId:v.owner,status:reasons.length?'NEEDS_REVIEW':'OBSERVED',economicAt:null,observedAt:ctx.timestamp(row.createdAt),sharesAtomic:v.shares??null,sharePrecision:null,underlying,basis:v.basis??'Original retained sequential RPC simulations; no atomic ledger snapshot is established.',reasons,sourceRefs});
   if(reasons.length)ctx.exception('VAULT_POSITION_REVIEW',row.id,'Retained vault position needs source review: '+reasons.join(', '),sourceRefs);
  }
 }});
}
