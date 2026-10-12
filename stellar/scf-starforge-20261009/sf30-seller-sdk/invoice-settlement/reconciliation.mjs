// MIT. Exact invoice/order attribution, retained corrections and scoped partner reports.
import {normalizeProviderRecords,normalizeSettlementAsset} from '../settlement-audit/reconciliation.mjs';
import {normalizeNetwork} from '../settlement-audit/native-http.mjs';
import {invoiceInterface,decodeInvoiceLog,decodeInvoiceTransfers} from './events.mjs';
import {InvoiceError,need,object,text,list,clone,canonical,sha256,parseInvoiceJSON,atPointer,pointerPart,decimalUnits,formatUnits,integerText,canonicalHash,iso} from './lossless-json.mjs';
const PROGRAMME_SCHEMA='stellar-forge.invoice-programme.v1';
const RECORD_SCHEMA='stellar-forge.invoice-source-record.v1';
const RESULT_SCHEMA='stellar-forge.invoice-reconciliation.v1';
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const optional=(value)=>value===undefined||value===null||value===''?null:String(value);
const networkName=value=>typeof value==='string'&&value.startsWith('stellar:')?normalizeNetwork(value):value;
const originalTime=value=>typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const normalizeId=value=>canonicalHash(value)??optional(value);
const zero=()=>({expectedUnits:'0',collectionUnits:'0',settlementUnits:'0',refundUnits:'0',feeUnits:'0',netUnits:'0'});
function unique(values,name){list(values,name);need(new Set(values).size===values.length,'INVALID_ARGUMENT',name+' contains duplicate values.');return values;}
function exactNonnegative(value,decimals,name){const result=decimalUnits(value,decimals,name);need(result>=0n,'INVALID_AMOUNT',name+' must be nonnegative.');return result.toString();}
function amountAsset(input){
  object(input,'asset');const id=text(input.id,'asset.id',255),network=networkName(text(input.network,'asset.network',1024));
  const type=input.type;need(['fiat','stellar','evm'].includes(type),'INVALID_ASSET','Select fiat, stellar or evm asset type.');
  const code=text(input.code,'asset.code',255),decimals=input.decimals;
  need(Number.isSafeInteger(decimals)&&decimals>=0&&decimals<=255,'INVALID_ASSET','The asset decimals must be an explicit integer from 0 through 255.');
  const result={id,network,type,code,decimals};
  if(type==='stellar'){
    need(decimals===7,'INVALID_ASSET','Native Stellar payment precision is seven decimals.');
    const selected=normalizeSettlementAsset(input.issuer?{code,issuer:input.issuer}:{type:'native'});
    need(selected.type!=='native'||code==='XLM','INVALID_ASSET','The native Stellar asset code is XLM.');
    if(selected.issuer)result.issuer=selected.issuer;
  }
  if(type==='evm'){need(/^0x[0-9a-fA-F]{40}$/.test(input.contract??''),'INVALID_ASSET','Select the original EVM token contract.');result.contract=input.contract.toLowerCase();need(/^eip155:[1-9]\d*$/.test(network),'INVALID_ASSET','Use the original eip155 chain identity.');}
  return result;
}
export function normalizeInvoiceProgramme(input){
  object(input,'programme');
  const result={schema:PROGRAMME_SCHEMA,name:text(input.name,'programme.name'),merchantId:text(input.merchantId,'merchantId',1024),
    networks:unique((input.networks??[]).map(value=>networkName(text(value,'network',1024))),'networks'),
    assets:list(input.assets??[],'assets').map(amountAsset),invoices:[],rules:{
      allowSettledUnverified:input.rules?.allowSettledUnverified??false,
      requireSuccessfulChainTransaction:input.rules?.requireSuccessfulChainTransaction??true,
      minimumConfirmations:input.rules?.minimumConfirmations??0,
    }};
  unique(result.assets.map(asset=>asset.id),'asset IDs');
  const identities=result.assets.map(asset=>canonical({network:asset.network,type:asset.type,code:asset.code,issuer:asset.issuer??null,contract:asset.contract??null}));
  unique(identities,'native asset identities');
  need(typeof result.rules.allowSettledUnverified==='boolean'&&typeof result.rules.requireSuccessfulChainTransaction==='boolean','INVALID_PROGRAMME','Programme acceptance rules must be booleans.');
  need(Number.isSafeInteger(result.rules.minimumConfirmations)&&result.rules.minimumConfirmations>=0&&result.rules.minimumConfirmations<=1000000,'INVALID_PROGRAMME','Select a supported explicit confirmation count.');
  const assets=new Map(result.assets.map(asset=>[asset.id,asset]));
  result.invoices=list(input.invoices??[],'invoices').map(value=>{
    object(value,'invoice');const id=text(value.id,'invoice.id',255),asset=assets.get(value.assetId);
    need(asset,'UNKNOWN_ASSET','Select a registered original invoice asset.',{invoiceId:id,assetId:value.assetId});
    const amount=text(value.amount,'invoice.amount',2048);exactNonnegative(amount,asset.decimals,'invoice.amount');
    const invoice={id,partnerId:optional(value.partnerId),customerId:optional(value.customerId),assetId:asset.id,amount,
      dueAt:iso(value.dueAt,'invoice.dueAt',{nullable:true}),
      orderIds:unique((value.orderIds??[]).map(item=>normalizeId(text(item,'orderId',255))),'invoice.orderIds'),
      references:unique((value.references??[]).map(item=>text(item,'invoice reference',2048)),'invoice.references'),
      settlementAssetId:null,settlementAmount:null};
    if(value.settlementAssetId!==undefined&&value.settlementAssetId!==null){
      const selected=assets.get(value.settlementAssetId);need(selected,'UNKNOWN_ASSET','Select the registered settlement asset.');
      invoice.settlementAssetId=selected.id;invoice.settlementAmount=text(value.settlementAmount,'settlementAmount',2048);
      exactNonnegative(invoice.settlementAmount,selected.decimals,'settlementAmount');
    }else need(value.settlementAmount===undefined||value.settlementAmount===null,'INVALID_PROGRAMME','A settlement amount requires its explicit settlement asset.');
    return invoice;
  });
  unique(result.invoices.map(invoice=>invoice.id),'invoice IDs');return result;
}
function recordsPath(provider,kind){
  if(provider==='elementpay')return kind==='webhook'?'':'/data';
  if(provider==='evm')return '/result';
  if(provider==='horizon')return ['payments','operations','transactions'].includes(kind)?'/_embedded/records':'';
  return ['payments','disbursements','disbursementReceivers','receivers'].includes(kind)?'/data':'';
}
function sourceView(args){
  let records=args.records,numericLexemes={},bodySha256=null,path=args.recordsPath===undefined?recordsPath(args.provider,args.kind):(args.recordsPath===null?'':args.recordsPath),array=false;
  if(args.rawBody!==undefined&&args.rawBody!==null){
    const parsed=parseInvoiceJSON(args.rawBody);numericLexemes=parsed.numericLexemes;bodySha256=parsed.bodySha256;
    const value=atPointer(parsed.value,path);array=Array.isArray(value);records=value===null?[]:array?value:[value];
  }else{list(records,'records');array=records.length!==1;}
  return {records:list(records,'records'),numericLexemes,bodySha256,path,array};
}
function localLexemes(all,prefix){
  const result={};for(const [path,value] of Object.entries(all))if(path===prefix)result['']=value;else if(path.startsWith(prefix+'/'))result[path.slice(prefix.length)]=value;
  return result;
}
function sourceReferences(value){
  const result={};
  for(const key of ['order_id','invoice_id','file_id','provider_id','external_payment_id','mpesa_transaction_id','mpesa_receipt_number','creation_transaction_hash','settlement_transaction_hash','refund_transaction_hash','transaction_hash'])
    if(value?.[key]!==undefined&&value[key]!==null)result[key]=String(value[key]);
  return result;
}
function initialProjection(network,bodySha256,numericLexemes){
  return {nativeId:null,entityType:'other',status:null,event:null,invoiceId:null,orderId:null,fileId:null,providerId:null,
    transactionHashes:{creation:null,settlement:null,refund:null,transaction:null},amounts:[],from:null,to:null,
    occurredAt:null,updatedAt:null,network,references:{},numericLexemes,bodySha256,issues:[]};
}
function nativeAmount(role,amount,identity={}){return {role,amount:amount===undefined||amount===null?null:String(amount),...identity};}
function projectOrder(original,kind,p,webhook){
  object(original,'original order/event');
  const value=original.data&&typeof original.data==='object'&&!Array.isArray(original.data)?original.data:original;
  p.entityType=kind==='webhook'?'order-event':'order';p.event=webhook?.event??optional(original.event);
  p.orderId=normalizeId(value.order_id);p.invoiceId=optional(value.invoice_id);p.fileId=optional(value.file_id);p.providerId=optional(value.provider_id);
  p.nativeId=kind==='webhook'?(webhook?.id??optional(original.id)??sha256(original)):p.orderId??sha256(original);
  p.status=optional(value.status)??p.event?.replace(/^order\./,'')??null;
  if(p.status)p.status=p.status.toUpperCase();
  p.orderType=optional(value.order_type);p.from=optional(value.wallet_address);p.to=optional(value.receiver_wallet_address);
  p.occurredAt=originalTime(value.created_at??value.transaction_time);p.updatedAt=originalTime(value.updated_at);
  p.originalTimestamps={createdAt:optional(value.created_at),updatedAt:optional(value.updated_at),transactionTime:optional(value.transaction_time)};
  p.references=sourceReferences(value);
  p.transactionHashes={creation:canonicalHash(value.creation_transaction_hash),settlement:canonicalHash(value.settlement_transaction_hash),
    refund:canonicalHash(value.refund_transaction_hash),transaction:canonicalHash(value.transaction_hash)};
  if(value.amount_fiat!==undefined&&value.amount_fiat!==null)p.amounts.push(nativeAmount('fiat',value.amount_fiat,{network:'fiat',type:'fiat',code:optional(value.currency)}));
  if(value.amount_crypto!==undefined&&value.amount_crypto!==null)p.amounts.push(nativeAmount('crypto',value.amount_crypto,{network:p.network,type:'crypto',code:optional(value.token),contract:/^0x[0-9a-fA-F]{40}$/.test(value.token??'')?value.token.toLowerCase():null}));
  p.exchangeRate=value.exchange_rate===undefined||value.exchange_rate===null?null:String(value.exchange_rate);
  p.reason=optional(value.reason);
  return p;
}
function projectStellar(provider,kind,original,p){
  // The original shared projector owns native StrKey, asset, memo and amount validation.
  const view=clone(original);
  for(const field of ['ledger','sequence','history_latest_ledger','history_elder_ledger','last_modified_ledger','operation_count'])if(typeof view[field]==='string'&&/^\d+$/.test(view[field])&&Number.isSafeInteger(Number(view[field])))view[field]=Number(view[field]);
  if(view.transaction&&typeof view.transaction.ledger==='string'&&Number.isSafeInteger(Number(view.transaction.ledger)))view.transaction.ledger=Number(view.transaction.ledger);
  const prior=normalizeProviderRecords({provider,kind,records:[view],sourceId:'invoice-projection',observedAt:'2000-01-01T00:00:00.000Z',network:p.network})[0];
  const native=prior.projection;
  p.nativeId=prior.id;p.entityType=native.category;p.status=native.status??null;
  p.occurredAt=native.createdAt??native.closedAt??null;p.updatedAt=native.updatedAt??null;
  p.from=native.fromAccount??native.sourceAccount??null;p.to=native.toAccount??null;
  p.transactionHashes.transaction=canonicalHash(native.transactionHash);
  p.ledger=native.ledger??null;p.operationId=native.operationId??null;p.memo=clone(native.memo??null);
  p.successful=native.status==='SUCCESS'?true:native.status==='FAILED'?false:null;
  p.issues=clone(native.issues??[]);p.native=clone(native);
  p.references=sourceReferences(original);
  if(native.externalPaymentId)p.references.external_payment_id=native.externalPaymentId;
  if(native.disbursementId)p.references.disbursement_id=native.disbursementId;
  if(native.receiverId)p.references.receiver_id=native.receiverId;
  if(native.receiverWalletId)p.references.receiver_wallet_id=native.receiverWalletId;
  p.disbursementId=native.disbursementId??null;p.receiverId=native.receiverId??null;
  if(native.amount!==undefined&&native.amount!==null&&native.asset){
    const asset=native.asset;p.amounts.push(nativeAmount(native.category==='clawback'?'refund':'payment',native.amount,
      {network:p.network,type:'stellar',code:asset.type==='native'?'XLM':asset.code,issuer:asset.issuer??null,decimals:7}));
  }
  return p;
}
export async function normalizeInvoiceRecords(args){
  const {provider,kind,sourceId,captureId=null,sourceScope=sourceId,rawBody,webhook,runtime}=args;
  need(['elementpay','evm','horizon','sdp'].includes(provider),'INVALID_PROVIDER','Select an original supported invoice source provider.');
  text(kind,'kind',255);text(sourceId,'sourceId',255);text(sourceScope,'sourceScope',1024);
  const observedAt=iso(args.observedAt,'observedAt'),network=networkName(text(args.network,'network',1024));
  const source=sourceView(args);let decoder=null;
  if(provider==='evm'&&['logs','receipt'].includes(kind)&&source.records.length)decoder=await invoiceInterface(runtime??{});
  const result=[];
  for(let index=0;index<source.records.length;index++){
    const original=clone(source.records[index]),prefix=source.path+(source.array?'/'+index:'');
    const lexemes=localLexemes(source.numericLexemes,prefix),p=initialProjection(network,source.bodySha256,lexemes);
    if(provider==='elementpay')projectOrder(original,kind,p,webhook);
    else if(provider==='horizon'||provider==='sdp')projectStellar(provider,kind,original,p);
    else if(kind==='logs'){
      const chainId=network.startsWith('eip155:')?network.slice(7):null,decoded=await decodeInvoiceLog(original,{runtime,network,chainId,decoder});
      p.entityType='listener-event';Object.assign(p,decoded);p.nativeId=decoded.known?decoded.transactionHash+':'+decoded.logIndex:sha256(original);
      p.from=decoded.requester??null;p.orderId=decoded.orderId??null;p.status=decoded.removed?'REMOVED':decoded.event==='OrderSettled'?'SETTLED':decoded.event==='OrderRefunded'?'REFUNDED':'PENDING';
      p.transactionHashes.transaction=decoded.transactionHash??null;
      if(decoded.event==='OrderCreated')p.transactionHashes.creation=decoded.transactionHash;
      if(decoded.event==='OrderSettled')p.transactionHashes.settlement=decoded.transactionHash;
      if(decoded.event==='OrderRefunded')p.transactionHashes.refund=decoded.transactionHash;
      p.references={order_id:decoded.orderId,transaction_hash:decoded.transactionHash,provider_id:decoded.providerId??null};
      const identity={network,type:'evm',contract:decoded.token?.toLowerCase()??null,code:null};
      if(decoded.amount!==undefined)p.amounts.push(nativeAmount(decoded.event==='OrderRefunded'?'refund':'gross',null,{...identity,units:decoded.amount}));
      if(decoded.netAmount!==undefined)p.amounts.push(nativeAmount('net',null,{...identity,units:decoded.netAmount}));
      if(decoded.feeAmount!==undefined)p.amounts.push(nativeAmount('fee',null,{...identity,units:decoded.feeAmount}));
      p.runtime=decoder?.runtime?{id:decoder.runtime.id,manifestSha256:decoder.runtime.manifestSha256,version:decoder.runtime.version??'6.13.5'}:null;
    }else if(kind==='chain'||kind==='head'){
      const value=integerText(original,'original '+kind,{hex:true});p.nativeId=kind;p.entityType=kind==='chain'?'network':'head';
      if(kind==='chain'){p.chainId=value;need(network==='eip155:'+value,'NETWORK_MISMATCH','The original chain observation differs from its selected network.');}
      else p.blockNumber=value;
    }else if(kind==='code'||kind==='storage'||kind==='call'){
      need(typeof original==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(original),'INVALID_NATIVE_SOURCE','The original RPC value must contain complete native data bytes.');
      if(kind==='storage')need(original.length===66,'INVALID_NATIVE_SOURCE','The original storage observation must be a complete 32-byte word.');
      p.entityType=kind==='code'?'contract-code':kind==='call'?'contract-call':'storage';p.nativeId=sha256(original);p.value=original;p.valueBytes=(original.length-2)/2;
      const selected=args.request?.filters;
      if(selected){p.contract=optional(selected.address);p.storagePosition=kind==='storage'?integerText(selected.position,'position',{hex:true}):null;p.blockNumber=integerText(selected.blockNumber,'blockNumber');if(kind==='call')p.callData=optional(selected.data);}
      p.nativeId=selected?sha256({kind,contract:p.contract?.toLowerCase()??null,blockNumber:p.blockNumber,
        position:p.storagePosition??null,callData:p.callData?.toLowerCase()??null}):sha256({sourceId,index,kind,original});
    }else{
      object(original,'original RPC record');p.entityType=kind;
      p.nativeId=canonicalHash(original.transactionHash??original.hash)??sha256(original);
      p.transactionHashes.transaction=canonicalHash(original.transactionHash??(kind==='transaction'?original.hash:null));
      p.blockHash=canonicalHash(original.blockHash??(kind==='block'?original.hash:null));
      if(original.blockNumber!==null&&original.blockNumber!==undefined)p.blockNumber=integerText(original.blockNumber,'blockNumber',{hex:true});
      if(kind==='block'&&original.number!==null&&original.number!==undefined)p.blockNumber=integerText(original.number,'blockNumber',{hex:true});
      p.from=optional(original.from);p.to=optional(original.to);
      if(kind==='receipt'&&original.status!==null&&original.status!==undefined){const status=integerText(original.status,'receipt status',{hex:true});need(['0','1'].includes(status),'INVALID_NATIVE_RECEIPT','The native receipt status is unsupported.');p.successful=status==='1';p.status=p.successful?'SUCCESS':'FAILED';}
      p.contract=optional(original.contractAddress);
      if(kind==='receipt'){
        const decoded=await decodeInvoiceTransfers(original,{runtime,network,chainId:network.startsWith('eip155:')?network.slice(7):null,decoder});
        p.transfers=decoded.transfers;p.runtime=decoded.runtime;
      }
    }
    p.originalSha256=sha256(original);
    const id=sha256({provider,kind,sourceId,index,originalSha256:p.originalSha256});
    const record={schema:RECORD_SCHEMA,id,provider,kind,sourceId,captureId,sourceScope,observedAt,network,original,projection:p,
      recordRef:{id,sourceId,captureId,index,originalSha256:p.originalSha256,bodySha256:source.bodySha256}};
    record.sha256=sha256(record);result.push(record);
  }
  return result;
}
function issue(code,message,recordIds=[],details={},severity='attention'){return {code,severity,message,recordIds:[...new Set(recordIds)],details};}
function recordCheck(row){
  object(row,'normalized source record');need(row.schema===RECORD_SCHEMA,'INVALID_RECORD','Select an original normalized invoice record.');
  const retained={...row};delete retained.sha256;
  need(sha256(retained)===row.sha256&&sha256(row.original)===row.projection?.originalSha256,'SOURCE_RECORD_CHANGED','The normalized record differs from its retained original source.',{recordId:row.id});
  need(sha256({provider:row.provider,kind:row.kind,sourceId:row.sourceId,index:row.recordRef.index,originalSha256:row.projection.originalSha256})===row.id,'SOURCE_RECORD_CHANGED','The source occurrence ID differs from its original record.');
  return row;
}
function decisionList(values,records,invoices){
  const result=[],known=new Map();const recordIds=new Set(records.map(row=>row.id));
  for(const value of list(values??[],'decisions')){
    object(value,'decision');const row={id:text(value.id,'decision.id',255),action:value.action,recordId:text(value.recordId,'recordId',255),
      invoiceId:optional(value.invoiceId),orderId:value.orderId?normalizeId(value.orderId):null,role:optional(value.role),
      reason:text(value.reason,'decision.reason',16384),actor:text(value.actor,'decision.actor',1024),createdAt:iso(value.createdAt,'decision.createdAt'),supersedes:optional(value.supersedes)};
    need(!known.has(row.id),'DUPLICATE_DECISION','Each original decision ID must be unique.');
    need(['link','unlink','exclude','include'].includes(row.action),'INVALID_DECISION','Select link, unlink, exclude or include.');
    need(recordIds.has(row.recordId),'UNKNOWN_RECORD','The decision refers to an unselected original source record.');
    if(row.invoiceId)need(invoices.has(row.invoiceId),'UNKNOWN_INVOICE','A decision must select a registered invoice.');
    if(row.role)need(['collection','settlement','refund','fee'].includes(row.role),'INVALID_DECISION','Select a supported financial attribution role.');
    if(row.action==='link')need(row.invoiceId||row.orderId,'INVALID_DECISION','A link must name an invoice or order.');
    if(row.supersedes){const prior=known.get(row.supersedes);need(prior&&prior.recordId===row.recordId,'INVALID_DECISION','Supersede an earlier decision for this same original record.');}
    result.push(row);known.set(row.id,row);
  }
  const superseded=new Set(result.map(row=>row.supersedes).filter(Boolean)),active=result.filter(row=>!superseded.has(row.id));
  const applied=new Map();
  for(const row of active){const key=row.recordId+':'+(['include','exclude'].includes(row.action)?'include':'link');need(!applied.has(key),'DECISION_CONFLICT','An additional decision must explicitly supersede the active decision for this source.',{recordId:row.recordId});applied.set(key,row);}
  return {all:result,applied};
}
function entityKey(row){
  const p=row.projection;
  if(row.provider==='elementpay')return canonical([row.provider,row.sourceScope,p.entityType,p.nativeId]);
  if(row.provider==='evm'&&row.kind==='logs')return canonical([row.provider,row.network,p.contract?.toLowerCase(),p.transactionHash,p.logIndex]);
  if(row.provider==='horizon')return canonical([row.provider,row.network,['payment','operation','clawback'].includes(p.entityType)?'operation':p.entityType,p.nativeId]);
  return canonical([row.provider,row.sourceScope,p.entityType,p.nativeId]);
}
function meaningfulProjection(p){
  const ignored=new Set(['numericLexemes','bodySha256','originalSha256','runtime','native','issues','sourceOccurrenceKey']);
  return Object.fromEntries(Object.entries(p).filter(([key])=>!ignored.has(key)));
}
function latestSources(rows,applied,asOf,networks){
  const groups=new Map(),excluded=[];
  for(const row of rows){
    recordCheck(row);
    if(Date.parse(row.observedAt)>Date.parse(asOf)){excluded.push({recordId:row.id,reason:'OBSERVED_AFTER_AS_OF',candidateInvoiceIds:[],candidateOrderIds:[]});continue;}
    if(networks.length&&!networks.includes(row.network)){excluded.push({recordId:row.id,reason:'NETWORK_NOT_SELECTED',candidateInvoiceIds:[],candidateOrderIds:[]});continue;}
    if(applied.get(row.id+':include')?.action==='exclude'){excluded.push({recordId:row.id,reason:'OPERATOR_EXCLUDED',candidateInvoiceIds:[],candidateOrderIds:[]});continue;}
    const key=entityKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  const entities=[];
  for(const [key,history] of groups){
    history.sort((a,b)=>cmp(a.observedAt,b.observedAt)||cmp(a.id,b.id));
    const current=history.at(-1),issues=[];
    if(current.provider==='evm'&&current.kind==='logs'){
      const blocks=new Set(history.map(row=>row.projection.blockHash));
      if(blocks.size>1||history.some(row=>row.projection.removed))issues.push(issue('SOURCE_CHANGED','The original event has changed block membership; inspect the retained canonical observations.',history.map(row=>row.id),{blockHashes:[...blocks]}));
    }
    if(current.provider==='elementpay'&&current.projection.entityType==='order'){
      const shapes=new Set(history.map(row=>sha256({amounts:row.projection.amounts,invoiceId:row.projection.invoiceId,orderType:row.projection.orderType})));
      if(shapes.size>1)issues.push(issue('SOURCE_CHANGED','The original order amount or invoice attribution changed between native observations.',history.map(row=>row.id)));
    }
    const simultaneous=history.filter(row=>row.observedAt===current.observedAt);
    if(new Set(simultaneous.map(row=>sha256(meaningfulProjection(row.projection)))).size>1)issues.push(issue('CONFLICTING_OBSERVATION','Two original observations at the same time disagree.',simultaneous.map(row=>row.id)));
    const links=history.map(row=>applied.get(row.id+':link')).filter(Boolean).sort((a,b)=>cmp(a.createdAt,b.createdAt)||cmp(a.id,b.id));
    if(links.length&&!applied.has(current.id+':link'))applied.set(current.id+':link',links.at(-1));
    entities.push({key,current,history,recordIds:history.map(row=>row.id),issues});
  }
  return {entities,excluded};
}
function resolveAsset(amount,assets){
  if(amount.assetId){const asset=assets.find(item=>item.id===amount.assetId);return asset?{asset}:null;}
  const candidates=assets.filter(asset=>{
    if(amount.type==='fiat')return asset.type==='fiat'&&asset.code===amount.code;
    if(asset.network!==amount.network)return false;
    if(amount.contract)return asset.type==='evm'&&asset.contract===amount.contract.toLowerCase();
    if(amount.type==='stellar')return asset.type==='stellar'&&asset.code===amount.code&&(asset.issuer??null)===(amount.issuer??null);
    return amount.code&&asset.code===amount.code;
  });
  return candidates.length===1?{asset:candidates[0]}:{candidates:candidates.map(asset=>asset.id)};
}
function financialAmount(amount,assets,recordId){
  const selected=resolveAsset(amount,assets);
  if(!selected?.asset)return {error:issue('ASSET_NOT_SELECTED','Select the exact source asset, network and precision in the programme.',[recordId],{sourceAsset:amount,candidates:selected?.candidates??[]})};
  const asset=selected.asset;
  try{
    const units=amount.units!==undefined&&amount.units!==null?BigInt(integerText(amount.units,'native amount units')):decimalUnits(amount.amount,asset.decimals);
    need(units>=0n,'INVALID_AMOUNT','The native amount must be nonnegative.');
    return {role:amount.role,assetId:asset.id,units:units.toString(),amount:formatUnits(units,asset.decimals),recordIds:[recordId],native:amount};
  }catch(error){return {error:issue(error.code??'INVALID_AMOUNT',error.message,[recordId],{sourceAmount:amount})};}
}
function txHashes(p){return Object.values(p.transactionHashes??{}).filter(Boolean);}
function uniqueRows(rows){return [...new Map(rows.map(row=>[row.id,row])).values()];}
function observedOrderStatus(entities,rules){
  const candidates=entities.filter(entity=>entity.current.provider==='elementpay').map(entity=>entity.current);
  candidates.sort((a,b)=>cmp(a.projection.updatedAt??a.observedAt,b.projection.updatedAt??b.observedAt)||cmp(a.observedAt,b.observedAt)||cmp(a.id,b.id));
  const selected=candidates.at(-1),statuses=new Set(candidates.filter(row=>(row.projection.updatedAt??row.observedAt)===(selected?.projection.updatedAt??selected?.observedAt)).map(row=>row.projection.status));
  if(statuses.size>1)return {status:'STATUS_MISMATCH',issues:[issue('STATUS_MISMATCH','Concurrent original order observations disagree on the order status.',candidates.map(row=>row.id),{statuses:[...statuses]})]};
  const value=selected?.projection.status;
  if(value==='SETTLED')return {status:'SETTLED',selected};
  if(value==='SETTLED_UNVERIFIED')return {status:rules.allowSettledUnverified?'SETTLED':'SETTLED_UNVERIFIED',selected};
  if(['FAILED','CANCELED','CANCELLED'].includes(value))return {status:'FAILED',selected};
  if(value==='REFUNDED')return {status:'REFUNDED',selected};
  const events=entities.map(entity=>entity.current.projection).filter(p=>p.entityType==='listener-event'&&!p.removed);
  if(events.some(p=>p.event==='OrderRefunded'))return {status:'REFUNDED',selected};
  if(events.some(p=>p.event==='OrderSettled'))return {status:'SETTLED',selected};
  return {status:'PENDING',selected};
}
function isAttention(issues){return issues.some(item=>item.severity==='attention');}
export function reconcileInvoices({programme,records,decisions=[],asOf=new Date().toISOString()}){
  object(programme,'programme version');text(programme.id,'programme.id',255);need(Number.isSafeInteger(programme.version)&&programme.version>=1,'INVALID_PROGRAMME','Select a saved programme version.');
  need(typeof programme.sha256==='string'&&/^[0-9a-f]{64}$/.test(programme.sha256),'INVALID_PROGRAMME','Retain the original programme version digest.');
  const definition=normalizeInvoiceProgramme(programme.definition),when=iso(asOf,'asOf'),rows=list(records,'records');
  unique(rows.map(row=>row.id),'source record IDs');
  const registered=new Map(definition.invoices.map(invoice=>[invoice.id,invoice])),choices=decisionList(decisions,rows,registered);
  const {entities,excluded}=latestSources(rows,choices.applied,when,definition.networks),orders=new Map(),unassigned=[...excluded],globalIssues=[];
  function order(id){if(!orders.has(id))orders.set(id,{id,entities:[],invoiceCandidates:new Set(),issues:[],decisions:[]});return orders.get(id);}
  for(const entity of entities){
    const row=entity.current,p=row.projection,link=choices.applied.get(row.id+':link');
    if(link?.action==='unlink'){unassigned.push({recordId:row.id,reason:'OPERATOR_UNLINKED',candidateInvoiceIds:[],candidateOrderIds:[]});continue;}
    const id=link?.orderId??p.orderId;
    if(id){const selected=order(id);selected.entities.push(entity);selected.issues.push(...entity.issues);if(link)selected.decisions.push(link);
      if(link?.invoiceId)selected.invoiceCandidates.add(link.invoiceId);else if(p.invoiceId)selected.invoiceCandidates.add(p.invoiceId);}
  }
  const transactionOrders=new Map();
  for(const selected of orders.values())for(const entity of selected.entities)for(const hash of txHashes(entity.current.projection)){
    const key=entity.current.network+':'+hash;if(!transactionOrders.has(key))transactionOrders.set(key,new Set());transactionOrders.get(key).add(selected.id);
  }
  for(const entity of entities){
    const row=entity.current,p=row.projection;if(p.orderId||choices.applied.get(row.id+':link')?.orderId)continue;
    const link=choices.applied.get(row.id+':link');if(link?.action==='unlink')continue;
    const candidates=new Set(txHashes(p).flatMap(hash=>[...(transactionOrders.get(row.network+':'+hash)??[])]));
    if(candidates.size===1){const selected=order([...candidates][0]);selected.entities.push(entity);selected.issues.push(...entity.issues);if(link){selected.decisions.push(link);if(link.invoiceId)selected.invoiceCandidates.add(link.invoiceId);}}
    else if(link?.invoiceId){
      const selected=order('assigned:'+link.invoiceId+':'+row.id);selected.entities.push(entity);selected.invoiceCandidates.add(link.invoiceId);selected.decisions.push(link);selected.issues.push(...entity.issues);
    }else if(!['network','head','block','contract-code','contract-call','storage','account','asset','participant','organization'].includes(p.entityType)){
      unassigned.push({recordId:row.id,reason:candidates.size?'AMBIGUOUS_TRANSACTION_REFERENCE':'NO_EXACT_ORDER_REFERENCE',candidateInvoiceIds:[],candidateOrderIds:[...candidates]});
      if(candidates.size>1)globalIssues.push({...issue('DUPLICATE_REFERENCE','The same original transaction reference belongs to multiple orders.',[row.id],{orderIds:[...candidates]}),entityId:p.nativeId});
    }
  }
  const activeRows=entities.map(entity=>entity.current),headByNetwork=new Map(),headRecords=new Map(),blocks=new Map();
  for(const row of [...activeRows].sort((a,b)=>cmp(a.observedAt,b.observedAt)||cmp(a.id,b.id))){
    if(row.projection.entityType==='head'&&row.projection.blockNumber!==undefined){headByNetwork.set(row.network,BigInt(row.projection.blockNumber));headRecords.set(row.network,row);}
    if(row.projection.entityType==='block'&&row.projection.blockNumber!==undefined)blocks.set(row.network+':'+row.projection.blockNumber,row);
  }
  const receipts=new Map();
  for(const row of [...activeRows].sort((a,b)=>cmp(a.observedAt,b.observedAt)||cmp(a.id,b.id)))if(row.kind==='receipt'&&row.provider==='evm'&&row.projection.transactionHashes.transaction)receipts.set(row.network+':'+row.projection.transactionHashes.transaction,row);
  const creationByScope=new Map(),legacyEvidence=new Map(),transferClaims=new Map();
  const nativeOrderScope=row=>canonical([row.network,row.projection.contract?.toLowerCase(),row.projection.orderId]);
  for(const row of activeRows)if(row.provider==='evm'&&row.kind==='logs'&&row.projection.event==='OrderCreated'&&!row.projection.removed){
    const key=nativeOrderScope(row);if(!creationByScope.has(key))creationByScope.set(key,[]);creationByScope.get(key).push(row);
  }
  for(const row of activeRows)if(row.provider==='evm'&&row.kind==='logs'&&row.projection.eventProfile==='elementflow-v1'&&!row.projection.removed){
    const p=row.projection,creations=creationByScope.get(nativeOrderScope(row))??[],receipt=receipts.get(row.network+':'+p.transactionHashes.transaction);
    const evidence={creations,created:creations.length===1?creations[0]:null,receipt,candidates:[]};
    const created=evidence.created?.projection;
    if(created&&receipt&&[0,1].includes(created.orderType)&&!(p.event==='OrderRefunded'&&created.orderType===0)){
      evidence.candidates=(receipt.projection.transfers??[]).filter(transfer=>!transfer.removed&&
        transfer.token.toLowerCase()===created.token.toLowerCase()&&transfer.from.toLowerCase()===p.contract.toLowerCase()&&
        transfer.units===created.amount&&(p.event==='OrderRefunded'||created.orderType===0?transfer.to.toLowerCase()===created.requester.toLowerCase():true));
      if(evidence.candidates.length===1){
        const transfer=evidence.candidates[0],key=canonical([row.network,transfer.transactionHash,transfer.logIndex]);
        evidence.transferKey=key;transferClaims.set(key,(transferClaims.get(key)??0)+1);
      }
    }
    legacyEvidence.set(row.id,evidence);
  }
  const resultOrders=[];
  for(const selected of orders.values()){
    const all=uniqueRows(selected.entities.flatMap(entity=>entity.history)),current=uniqueRows(selected.entities.map(entity=>entity.current));
    const ids=all.map(row=>row.id),references=current.flatMap(row=>Object.values(row.projection.references??{})).filter(Boolean);
    const originalOrderNetworks=[...new Set(current.filter(row=>row.projection.orderId===selected.id).map(row=>row.network))];
    const originalContracts=[...new Set(current.filter(row=>row.provider==='evm'&&row.kind==='logs').map(row=>row.projection.contract?.toLowerCase()).filter(Boolean))];
    if(originalOrderNetworks.length>1||originalContracts.length>1)selected.issues.push(issue('ORDER_SCOPE_CONFLICT','The same original order identifier occurs in multiple chain or contract scopes; select its intended native sources explicitly.',ids,{networks:originalOrderNetworks,contracts:originalContracts}));
    for(const invoice of definition.invoices)if(invoice.orderIds.includes(selected.id)||invoice.references.some(ref=>references.includes(ref)))selected.invoiceCandidates.add(invoice.id);
    if(selected.invoiceCandidates.size>1)selected.issues.push(issue('DUPLICATE_REFERENCE','This order has conflicting original or approved invoice references.',ids,{invoiceIds:[...selected.invoiceCandidates]}));
    const invoiceId=selected.invoiceCandidates.size===1?[...selected.invoiceCandidates][0]:null;
    const statusInfo=observedOrderStatus(selected.entities,definition.rules);selected.issues.push(...(statusInfo.issues??[]));
    const creations=current.filter(row=>row.provider==='evm'&&row.kind==='logs'&&row.projection.event==='OrderCreated'&&!row.projection.removed);
    const types=[...new Set(creations.map(row=>row.projection.orderType))];
    const createdOrderType=types.length===1?(types[0]===0?'onramp':types[0]===1?'offramp':null):null;
    if(types.length>1||types.some(value=>![0,1].includes(value)))selected.issues.push(issue('ORDER_TYPE_CONFLICT','The original order creation observations have conflicting or unsupported native order types.',creations.map(row=>row.id),{orderTypes:types}));
    if(statusInfo.selected?.projection.orderType&&createdOrderType&&statusInfo.selected.projection.orderType!==createdOrderType)selected.issues.push(issue('ORDER_TYPE_CONFLICT','The original API order and creation event disagree on the order type.',[statusInfo.selected.id,...creations.map(row=>row.id)]));
    const status=statusInfo.status,amounts=[],amountKeys=new Map();
    function addAmount(value,key,{corroborate=false}={}){
      if(value.error){selected.issues.push(value.error);return;}
      if(amountKeys.has(key)){
        const prior=amountKeys.get(key);
        if(prior.units!==value.units||prior.assetId!==value.assetId)selected.issues.push(issue('AMOUNT_MISMATCH','Original observations of the same money movement disagree.',[...prior.recordIds,...value.recordIds],{before:prior,after:value}));
        else prior.recordIds=[...new Set([...prior.recordIds,...value.recordIds])];
        if(!corroborate)selected.issues.push(issue('DUPLICATE_REFERENCE','More than one original event claims the same order movement.',[...prior.recordIds,...value.recordIds]));
        return;
      }
      const row={role:value.role,assetId:value.assetId,units:value.units,amount:value.amount,recordIds:value.recordIds,...(value.sourceTransfers?{sourceTransfers:clone(value.sourceTransfers)}:{})};amounts.push(row);amountKeys.set(key,row);
    }
    // Mutable API pages and webhook retries describe an order; they do not add money each time.
    const orderView=statusInfo.selected;
    if(orderView){
      for(const native of orderView.projection.amounts){
        const explicit=choices.applied.get(orderView.id+':link')?.role;
        const matched=resolveAsset(native,definition.assets)?.asset,invoiceAsset=registered.get(invoiceId)?.assetId;
        const isInvoiceAsset=invoiceAsset?matched?.id===invoiceAsset:native.role==='fiat';
        const role=explicit??(isInvoiceAsset?'collection':native.role==='fiat'?'reportedFiat':'orderedCrypto');
        const value=financialAmount({...native,role},definition.assets,orderView.id);
        if(isInvoiceAsset&&!['SETTLED','REFUNDED'].includes(status)&&!explicit)value.role='ordered';
        if(isInvoiceAsset&&status==='REFUNDED'&&!explicit)value.role='reportedRefund';
        addAmount(value,'order:'+role+':'+(value.assetId??native.code),{corroborate:true});
      }
    }
    const nativePayments=current.filter(row=>['horizon','sdp'].includes(row.provider)&&['payment','clawback'].includes(row.projection.entityType));
    const horizonByHash=new Map();
    for(const row of nativePayments.filter(row=>row.provider==='horizon')){const hash=row.projection.transactionHashes.transaction;if(hash){if(!horizonByHash.has(hash))horizonByHash.set(hash,[]);horizonByHash.get(hash).push(row);}}
    for(const row of current){
      const p=row.projection,explicit=choices.applied.get(row.id+':link')?.role;
      if(row.provider==='evm'&&row.kind==='logs'){
        if(p.removed){selected.issues.push(issue('SOURCE_CHANGED','A selected original event is marked removed.',[row.id]));continue;}
        const receipt=receipts.get(row.network+':'+p.transactionHashes.transaction);
        let accepted=true;
        const canonicalBlock=blocks.get(row.network+':'+p.blockNumber);
        if(canonicalBlock){if(!ids.includes(canonicalBlock.id))ids.push(canonicalBlock.id);if(canonicalBlock.projection.blockHash!==p.blockHash){selected.issues.push(issue('SOURCE_CHANGED','The original selected block now has a different hash.',[row.id,canonicalBlock.id]));accepted=false;}}
        if(receipt){if(receipt.projection.blockHash!==p.blockHash){selected.issues.push(issue('SOURCE_CHANGED','The original event and receipt disagree on their block.',[row.id,receipt.id]));accepted=false;}
          if(receipt.projection.successful===false){selected.issues.push(issue('STATUS_MISMATCH','The original receipt reports a failed event transaction.',[row.id,receipt.id]));accepted=false;}}
        if(definition.rules.requireSuccessfulChainTransaction&&['OrderSettled','OrderRefunded'].includes(p.event)&&receipt?.projection.successful!==true){selected.issues.push(issue('TRANSACTION_STATUS_MISSING','Select an original successful transaction receipt for this event.',[row.id,...(receipt?[receipt.id]:[])],{transactionHash:p.transactionHashes.transaction,network:row.network}));accepted=false;}
        const head=headByNetwork.get(row.network);
        if(definition.rules.minimumConfirmations>0){
          const headSource=headRecords.get(row.network);if(headSource&&!ids.includes(headSource.id))ids.push(headSource.id);
          if(head===undefined||p.blockNumber===undefined||head-BigInt(p.blockNumber)+1n<BigInt(definition.rules.minimumConfirmations)){
            selected.issues.push(issue('CONFIRMATIONS_PENDING','The original selected head has not established the programme confirmation count.',[row.id],{required:definition.rules.minimumConfirmations,head:head?.toString()??null,blockNumber:p.blockNumber}));accepted=false;
          }
        }
        if(p.eventProfile==='elementflow-v1'){
          const evidence=legacyEvidence.get(row.id);
          if(!evidence?.created)selected.issues.push(issue('LEGACY_ORDER_CREATION_REQUIRED','Select the unique original order creation to match this legacy lifecycle event to an actual token transfer.',[row.id],{creationCandidates:evidence?.creations.map(item=>item.id)??[]}));
          else if(!evidence.receipt)selected.issues.push(issue('LEGACY_RECEIPT_REQUIRED','Read the original receipt to recover the legacy event token movement.',[row.id,evidence.created.id]));
          else if(evidence.candidates.length!==1||transferClaims.get(evidence.transferKey)!==1)
            selected.issues.push(issue('LEGACY_TRANSFER_AMBIGUOUS','The original legacy event does not have one uniquely attributable ERC-20 transfer in its retained receipt.',[row.id,evidence.created.id,evidence.receipt.id],{transferCandidates:evidence.candidates.map(item=>({logIndex:item.logIndex,token:item.token,from:item.from,to:item.to,units:item.units})),sharedClaims:transferClaims.get(evidence.transferKey)??0}));
          else{
            const transfer=evidence.candidates[0],role=explicit??(p.event==='OrderRefunded'?'refund':'settlement');
            const value=financialAmount({role:accepted?role:'unverified:'+role,units:transfer.units,network:row.network,type:'evm',contract:transfer.token.toLowerCase()},definition.assets,row.id);
            if(!value.error){
              value.recordIds=[row.id,evidence.created.id,evidence.receipt.id];
              value.sourceTransfers=[{recordId:evidence.receipt.id,originalIndex:transfer.originalIndex,originalSha256:transfer.originalSha256,logIndex:transfer.logIndex,transactionHash:transfer.transactionHash}];
              for(const recordId of value.recordIds)if(!ids.includes(recordId))ids.push(recordId);
            }
            addAmount(value,'event:'+p.event+':'+(accepted?role:'unverified:'+role),{corroborate:false});
          }
        }
        for(const native of p.amounts){
          let role=explicit??(native.role==='net'?'settlement':native.role==='gross'?(p.orderType===1?'escrow':'requested'):native.role);
          if(native.role==='refund'&&!explicit&&p.eventProfile!=='elementflow-v1'){
            if(createdOrderType==='onramp')role='reservationReleased';
            else if(createdOrderType!=='offramp'){role='undetermined:refund';selected.issues.push(issue('ORDER_CREATION_REQUIRED','Select the original order creation before treating a rich refund event as a token movement; an on-ramp refund only releases its reservation.',[row.id]));}
          }
          if(!accepted&&['settlement','refund','fee'].includes(role))role='unverified:'+role;
          addAmount(financialAmount({...native,role},definition.assets,row.id),'event:'+p.event+':'+role,{corroborate:false});
        }
      }else if(['horizon','sdp'].includes(row.provider)&&['payment','clawback'].includes(p.entityType)){
        let role=explicit??(p.entityType==='clawback'?'refund':'settlement'),hash=p.transactionHashes.transaction,movement=p.operationId;
        const matches=hash?(horizonByHash.get(hash)??[]):[];
        if(row.provider==='sdp'&&!movement&&matches.length===1)movement=matches[0].projection.operationId;
        if(row.provider==='sdp'&&!movement&&matches.length>1){selected.issues.push(issue('AMBIGUOUS_TRANSACTION','The original payout transaction contains multiple payment operations; choose its exact operation or approved record role.',[row.id,...matches.map(item=>item.id)]));continue;}
        if(p.status!=='SUCCESS')role='unverified:'+role;
        for(const native of p.amounts)addAmount(financialAmount({...native,role},definition.assets,row.id),
          'payment:'+row.network+':'+(hash??row.sourceScope)+':'+(movement??p.nativeId)+':'+role,{corroborate:true});
      }
    }
    for(const asset of definition.assets){
      const gross=amounts.filter(item=>item.assetId===asset.id&&['escrow','requested'].includes(item.role));
      const net=amounts.filter(item=>item.assetId===asset.id&&item.role==='settlement'&&item.recordIds.some(id=>current.find(row=>row.id===id)?.projection.event==='OrderSettled'));
      const fees=amounts.filter(item=>item.assetId===asset.id&&item.role==='fee');
      if(gross.length&&net.length){
        const sum=items=>items.reduce((total,item)=>total+BigInt(item.units),0n);
        if(sum(gross)!==sum(net)+sum(fees))selected.issues.push(issue('AMOUNT_MISMATCH','The original settled net and fee do not add to the original order amount.',[...gross,...net,...fees].flatMap(item=>item.recordIds),{assetId:asset.id,grossUnits:sum(gross).toString(),netUnits:sum(net).toString(),feeUnits:sum(fees).toString()}));
      }
    }
    const nativeIds=[...new Set(current.map(row=>row.projection.nativeId))],hashes={creation:[],settlement:[],refund:[],transaction:[]};
    for(const key of Object.keys(hashes))hashes[key]=[...new Set(current.map(row=>row.projection.transactionHashes?.[key]).filter(Boolean))];
    const out={id:selected.id,kind:selected.id.startsWith('assigned:')?'approved-attribution':'native-order',invoiceId,status:isAttention(selected.issues)?'ATTENTION':status,reportedStatus:status,
      orderType:orderView?.projection.orderType??createdOrderType,recordIds:ids,nativeIds,transactionHashes:hashes,amounts,
      issues:selected.issues,decisionIds:selected.decisions.map(value=>value.id)};
    resultOrders.push(out);
  }
  const invoiceDefinitions=new Map(definition.invoices.map(invoice=>[invoice.id,invoice]));
  for(const order of resultOrders)if(order.invoiceId&&!invoiceDefinitions.has(order.invoiceId))invoiceDefinitions.set(order.invoiceId,
    {id:order.invoiceId,partnerId:null,customerId:null,assetId:null,amount:null,dueAt:null,unregistered:true});
  const invoices=[];
  for(const invoice of invoiceDefinitions.values()){
    const selected=resultOrders.filter(order=>order.invoiceId===invoice.id),issues=selected.flatMap(order=>order.issues),recordIds=[...new Set(selected.flatMap(order=>order.recordIds))];
    const asset=definition.assets.find(asset=>asset.id===invoice.assetId),expected=asset?decimalUnits(invoice.amount,asset.decimals).toString():null;
    const balances=new Map();
    if(asset)balances.set(asset.id,{assetId:asset.id,...zero(),expectedUnits:expected});
    for(const order of selected)for(const amount of order.amounts){
      if(!['collection','settlement','refund','fee'].includes(amount.role))continue;
      if(!balances.has(amount.assetId))balances.set(amount.assetId,{assetId:amount.assetId,...zero()});
      const balance=balances.get(amount.assetId),field=amount.role+'Units';balance[field]=(BigInt(balance[field])+BigInt(amount.units)).toString();
    }
    for(const balance of balances.values())balance.netUnits=(BigInt(balance.collectionUnits)-BigInt(balance.refundUnits)).toString();
    if(invoice.unregistered)issues.push(issue('UNREGISTERED_INVOICE','Register the original invoice amount and currency before evaluating its balance.',recordIds));
    const current=asset?balances.get(asset.id):null;
    if(current&&selected.some(order=>order.reportedStatus==='SETTLED')&&BigInt(current.collectionUnits)!==BigInt(expected))
      issues.push(issue('AMOUNT_MISMATCH','The exact collected invoice amount differs from its registered amount.',recordIds,{expectedUnits:expected,observedUnits:current.collectionUnits,assetId:asset.id}));
    if(invoice.settlementAssetId){
      const target=definition.assets.find(asset=>asset.id===invoice.settlementAssetId),wanted=decimalUnits(invoice.settlementAmount,target.decimals);
      const balance=balances.get(target.id)??{assetId:target.id,...zero()};if(!balances.has(target.id))balances.set(target.id,balance);
      if(selected.some(order=>order.reportedStatus==='SETTLED')&&BigInt(balance.settlementUnits)!==wanted)issues.push(issue('SETTLEMENT_MISMATCH','The original native settlement differs from its selected expected amount.',recordIds,{assetId:target.id,expectedUnits:wanted.toString(),observedUnits:balance.settlementUnits}));
    }
    let status='PENDING';
    if(invoice.unregistered)status='UNREGISTERED_INVOICE';
    else if(isAttention(issues))status='ATTENTION';
    else if(selected.length&&selected.every(order=>order.reportedStatus==='REFUNDED'))status='REFUNDED';
    else if(selected.some(order=>order.reportedStatus==='FAILED'))status='FAILED';
    else if(selected.length&&selected.every(order=>order.reportedStatus==='SETTLED')&&current&&BigInt(current.collectionUnits)===BigInt(expected))status='MATCHED';
    else if(selected.some(order=>order.reportedStatus==='SETTLED_UNVERIFIED'))status='SETTLED_UNVERIFIED';
    if(status==='PENDING'&&invoice.dueAt&&invoice.dueAt<when)issues.push(issue('OVERDUE','The original invoice remains unsettled after its selected due date.',recordIds,{},'info'));
    invoices.push({id:invoice.id,partnerId:invoice.partnerId,customerId:invoice.customerId,assetId:invoice.assetId,amount:invoice.amount,
      expectedUnits:expected,dueAt:invoice.dueAt,status,orderIds:selected.map(order=>order.id),recordIds,balances:[...balances.values()],issues});
  }
  for(const order of resultOrders)if(!order.invoiceId)for(const recordId of order.recordIds)if(!unassigned.some(row=>row.recordId===recordId))
    unassigned.push({recordId,reason:'NO_EXACT_INVOICE_REFERENCE',candidateInvoiceIds:[],candidateOrderIds:[order.id]});
  const totals=new Map();
  for(const invoice of invoices)for(const balance of invoice.balances){
    const asset=definition.assets.find(asset=>asset.id===balance.assetId);
    if(!totals.has(asset.id))totals.set(asset.id,{assetId:asset.id,network:asset.network,code:asset.code,decimals:asset.decimals,...zero()});
    const selected=totals.get(asset.id);for(const field of Object.keys(zero()))selected[field]=(BigInt(selected[field])+BigInt(balance[field])).toString();
  }
  const conflicts=[...globalIssues,...invoices.flatMap(invoice=>invoice.issues.filter(item=>item.severity==='attention').map(item=>({...item,entityId:invoice.id}))),
    ...resultOrders.filter(order=>!order.invoiceId).flatMap(order=>order.issues.map(item=>({...item,entityId:order.id})))];
  const byStatus={};for(const invoice of invoices)byStatus[invoice.status]=(byStatus[invoice.status]??0)+1;
  const result={schema:RESULT_SCHEMA,programme:{id:programme.id,version:programme.version,sha256:programme.sha256},asOf:when,
    invoices:invoices.sort((a,b)=>cmp(a.id,b.id)),orders:resultOrders.sort((a,b)=>cmp(a.id,b.id)),unassigned,conflicts,
    totals:[...totals.values()].sort((a,b)=>cmp(a.assetId,b.assetId)),decisions:choices.all,
    sourceRecords:rows.map(row=>({id:row.id,provider:row.provider,kind:row.kind,sourceId:row.sourceId,captureId:row.captureId,
      sourceScope:row.sourceScope,observedAt:row.observedAt,network:row.network,originalSha256:row.projection.originalSha256,sha256:row.sha256})),
    summary:{invoices:invoices.length,orders:resultOrders.length,records:rows.length,unassigned:unassigned.length,conflicts:conflicts.length,
      matched:byStatus.MATCHED??0,pending:byStatus.PENDING??0,failed:byStatus.FAILED??0,refunded:byStatus.REFUNDED??0,
      attention:(byStatus.ATTENTION??0)+(byStatus.UNREGISTERED_INVOICE??0),byStatus}};
  result.sha256=sha256(result);return result;
}
function verifyResult(result){
  object(result,'reconciliation');need(result.schema===RESULT_SCHEMA,'INVALID_RECONCILIATION','Select an original plain invoice reconciliation.');
  const body={...result};delete body.sha256;need(result.sha256===sha256(body),'RECONCILIATION_CHANGED','The original reconciliation result differs from its retained digest.');return result;
}
export function compareInvoiceReconciliations({left,right}){
  verifyResult(left);verifyResult(right);
  need(left.programme.id===right.programme.id,'PROGRAMME_MISMATCH','Compare editions of the same original programme.');
  const result={schema:'stellar-forge.invoice-reconciliation-comparison.v1',leftSha256:left.sha256,rightSha256:right.sha256,
    programmeChanged:left.programme.sha256!==right.programme.sha256,totalsBefore:clone(left.totals),totalsAfter:clone(right.totals)};
  for(const [field,plural] of [['invoices','Invoices'],['orders','Orders']]){
    const before=new Map(left[field].map(row=>[row.id,row])),after=new Map(right[field].map(row=>[row.id,row]));
    result['added'+plural]=right[field].filter(row=>!before.has(row.id)).map(clone);
    result['removed'+plural]=left[field].filter(row=>!after.has(row.id)).map(clone);
    result['changed'+plural]=right[field].filter(row=>before.has(row.id)&&canonical(before.get(row.id))!==canonical(row)).map(row=>({id:row.id,before:clone(before.get(row.id)),after:clone(row)}));
  }
  result.sha256=sha256(result);return result;
}
function html(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function csv(value){let result=String(value??'');if(/^[=+@\t\r]/.test(result)||(/^-/.test(result)&&!/^-\d+(?:\.\d+)?$/.test(result)))result="'"+result;return '"'+result.replace(/"/g,'""')+'"';}
export function buildInvoiceReport({programme,reconciliation,format='json',partnerId=null}){
  verifyResult(reconciliation);need(programme?.id===reconciliation.programme.id&&programme?.version===reconciliation.programme.version&&programme?.sha256===reconciliation.programme.sha256,'PROGRAMME_MISMATCH','Use the original programme version selected by this reconciliation.');
  need(['json','csv','html'].includes(format),'INVALID_REPORT_FORMAT','Select json, csv or html.');
  const invoices=reconciliation.invoices.filter(row=>partnerId===null||row.partnerId===partnerId),invoiceIds=invoices.map(row=>row.id);
  if(partnerId!==null)text(partnerId,'partnerId',1024);
  const orders=reconciliation.orders.filter(row=>partnerId===null||invoiceIds.includes(row.invoiceId)),orderIds=orders.map(row=>row.id);
  const recordIds=[...new Set([...invoices.flatMap(row=>row.recordIds),...orders.flatMap(row=>row.recordIds)])];
  const sourceRecords=reconciliation.sourceRecords.filter(row=>partnerId===null||recordIds.includes(row.id)),sourceIds=[...new Set(sourceRecords.map(row=>row.sourceId))];
  const selectedRecords=new Set(sourceRecords.map(row=>row.id)),totals=new Map();
  const definition=normalizeInvoiceProgramme(programme.definition);
  for(const invoice of invoices)for(const balance of invoice.balances){
    const asset=definition.assets.find(asset=>asset.id===balance.assetId);if(!totals.has(asset.id))totals.set(asset.id,{assetId:asset.id,network:asset.network,code:asset.code,decimals:asset.decimals,...zero()});
    const total=totals.get(asset.id);for(const field of Object.keys(zero()))total[field]=(BigInt(total[field])+BigInt(balance[field])).toString();
  }
  const byStatus={};for(const row of invoices)byStatus[row.status]=(byStatus[row.status]??0)+1;
  const data={schema:'stellar-forge.invoice-partner-report.v1',programme:clone(reconciliation.programme),asOf:reconciliation.asOf,
    sourceReconciliationSha256:reconciliation.sha256,partnerId,invoices:clone(invoices),orders:clone(orders),totals:[...totals.values()],
    decisions:reconciliation.decisions.filter(row=>partnerId===null||selectedRecords.has(row.recordId)).map(clone),
    conflicts:reconciliation.conflicts.filter(row=>partnerId===null||invoiceIds.includes(row.entityId)||orderIds.includes(row.entityId)).map(clone),
    unassigned:partnerId===null?clone(reconciliation.unassigned):[],sourceRecords:clone(sourceRecords),
    summary:{invoices:invoices.length,orders:orders.length,records:sourceRecords.length,byStatus}};
  const scope={partnerId,invoiceIds,orderIds,recordIds:sourceRecords.map(row=>row.id),sourceIds};
  let body,contentType;
  if(format==='json'){body=Buffer.from(JSON.stringify(data,null,2)+'\n');contentType='application/json; charset=utf-8';}
  else if(format==='csv'){
    const rows=[['invoice_id','partner_id','customer_id','status','asset_id','expected_units','collection_units','settlement_units','refund_units','fee_units','net_units','order_ids','source_record_ids','issue_codes']];
    for(const invoice of invoices)for(const balance of invoice.balances.length?invoice.balances:[{assetId:'',...zero()}])rows.push([invoice.id,invoice.partnerId,invoice.customerId,invoice.status,balance.assetId,balance.expectedUnits,balance.collectionUnits,balance.settlementUnits,balance.refundUnits,balance.feeUnits,balance.netUnits,invoice.orderIds.join('|'),invoice.recordIds.join('|'),invoice.issues.map(row=>row.code).join('|')]);
    body=Buffer.from(rows.map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n');contentType='text/csv; charset=utf-8';
  }else{
    const rows=invoices.map(invoice=>'<tr><td>'+html(invoice.id)+'</td><td>'+html(invoice.partnerId)+'</td><td>'+html(invoice.status)+'</td><td>'+html(invoice.amount)+'</td><td>'+html(invoice.assetId)+'</td><td>'+html(invoice.orderIds.join(', '))+'</td><td>'+html(invoice.issues.map(row=>row.code).join(', '))+'</td></tr>').join('');
    body=Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice settlement report</title><style>body{font:14px system-ui,sans-serif;color:#161616;background:#fff;margin:32px;max-width:1400px}h1{font-size:24px;font-weight:600}p{line-height:1.5}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;vertical-align:top;border:1px solid #bbb}th{background:#f1f1f1}code{overflow-wrap:anywhere}a{color:inherit}</style><h1>Invoice settlement report</h1><p>Programme '+html(definition.name)+' · Version '+programme.version+' · '+html(data.asOf)+'</p><p>'+invoices.length+' invoices · '+orders.length+' orders · '+sourceRecords.length+' retained source records</p><table><thead><tr><th>Invoice</th><th>Partner</th><th>Status</th><th>Expected amount</th><th>Asset</th><th>Orders</th><th>Review items</th></tr></thead><tbody>'+rows+'</tbody></table><p>Original reconciliation <code>'+html(reconciliation.sha256)+'</code></p><p>Source IDs: <code>'+html(sourceIds.join(', '))+'</code></p></html>\n');contentType='text/html; charset=utf-8';
  }
  return {schema:'stellar-forge.invoice-report-file.v1',format,contentType,filename:'invoice-settlement-report.'+format,body,bytes:body.length,sha256:sha256(body),scope,data};
}
