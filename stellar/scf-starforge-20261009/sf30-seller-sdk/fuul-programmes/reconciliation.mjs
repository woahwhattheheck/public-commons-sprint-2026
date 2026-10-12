// MIT. Source-linked Fuul programme, event, allocation and claim reconciliation.
import {FuulError,need,clone,canonical,sha256,text,object,list,atPointer,pointerPart,parseFuulJSON,parseFuulCSV,decimalUnits,formatUnits,integerText,fuulNetwork,stellarAddress,safeInteger,iso} from './lossless-json.mjs';
import {decodeFuulStellarEvents,decodeFuulStellarTransaction} from './stellar.mjs';

const I128_MAX=(1n<<127n)-1n;
const own=(value,key)=>value!==null&&typeof value==='object'&&Object.hasOwn(value,key);
const scalar=value=>typeof value==='string'?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):null;
const field=(value,...keys)=>{for(const key of keys)if(own(value,key)&&value[key]!==null&&value[key]!==undefined)return value[key];return null;};
const stringField=(value,...keys)=>scalar(field(value,...keys));
function optionalPointer(value,name){
 if(value===undefined||value===null)return null;
 need(typeof value==='string'&&(value===''||value.startsWith('/'))&&!/~(?:[^01]|$)/.test(value),'INVALID_MAPPING',name+' must be an original JSON pointer.');
 return value;
}
function token(value,name,maximum=128){
 text(value,name,maximum);need(!/[\u0000-\u001f\u007f]/.test(value),'INVALID_ARGUMENT',name+' contains a control character.');return value;
}
function nonnegative(value,name,maximum=I128_MAX){return integerText(value,name,{maximum});}
function compatibleJSON(value){
 if(typeof value==='number'){need(Number.isFinite(value),'INVALID_ARGUMENT','JSON numbers must be finite.');return value;}
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(Array.isArray(value))return value.map(compatibleJSON);
 object(value,'JSON value');return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,compatibleJSON(item)]));
}
export function normalizeFuulProgramme(definition){
 object(definition,'Fuul programme');const network=fuulNetwork(definition.network);
 const projectId=token(definition.projectId,'Original project ID',128);
 if(definition.chainIdentifier!==undefined)need(safeInteger(definition.chainIdentifier,'Chain identifier')===network.chainIdentifier,'NETWORK_MISMATCH','The programme chain identifier differs from its selected Stellar network.');
 const contracts=(definition.contracts??[]).map(item=>{object(item,'Programme contract');need(['factory','manager','project'].includes(item.role),'INVALID_CONTRACT_ROLE','Select an original Fuul contract role.');return {address:stellarAddress(item.address,'Contract address',{kind:'contract'}),role:item.role};});
 need(new Set(contracts.map(item=>item.address)).size===contracts.length,'DUPLICATE_CONTRACT','Select each original contract once.');
 const currencies=(definition.currencies??[]).map(item=>{
   object(item,'Programme currency');const id=token(item.id,'Currency ID',128),chainIdentifier=safeInteger(item.chainIdentifier??network.chainIdentifier,'Currency chain identifier');
   need(chainIdentifier===network.chainIdentifier,'NETWORK_MISMATCH','A programme currency belongs to another Stellar network.');
   return {id,address:stellarAddress(item.address,'Currency contract',{kind:'contract'}),chainIdentifier,decimals:safeInteger(item.decimals??7,'Currency precision',{minimum:0,maximum:38}),label:text(item.label??id,'Currency label',256)};
 });
 need(new Set(currencies.map(item=>item.id)).size===currencies.length,'DUPLICATE_CURRENCY','Currency IDs must be unique.');
 need(new Set(currencies.map(item=>item.address+'\u0000'+item.chainIdentifier)).size===currencies.length,'DUPLICATE_CURRENCY','Select each original currency and network once.');
 const currencyIds=new Set(currencies.map(item=>item.id));
 const mappings=(definition.mappings??[]).map(item=>{
   object(item,'Event mapping');const id=token(item.id,'Mapping ID',128),provider=token(item.provider??'activity','Mapping provider',64),kind=token(item.kind??'activity','Mapping kind',128);
   const result={id,name:text(item.name??id,'Mapping label',256),provider,kind,event:text(item.event??item.name,'Original Fuul event name',256),identityPointer:optionalPointer(item.identityPointer,'Identity pointer'),userPointer:optionalPointer(item.userPointer,'User pointer'),timestampPointer:optionalPointer(item.timestampPointer,'Timestamp pointer'),view:item.view??'original',sourceNamespace:token(item.sourceNamespace??id,'Original source namespace',256),args:compatibleJSON(clone(item.args??{})),fields:[]};
   need(['original','projection'].includes(result.view),'INVALID_MAPPING','Select the original JSON or decoded native projection as the mapping view.');
   need(result.userPointer!==null,'INVALID_MAPPING','Select the exact original user pointer.');
   object(result.args,'Static event arguments');
   for(const selected of item.fields??[]){
     object(selected,'Mapped argument');const target=optionalPointer(selected.target,'Argument target'),source=optionalPointer(selected.source,'Original value pointer');
     need(target!==null&&target!==''&&source!==null,'INVALID_MAPPING','Argument fields require target and source JSON pointers.');
     need(!['/__proto__','/prototype','/constructor'].some(prefix=>target===prefix||target.startsWith(prefix+'/')),'INVALID_MAPPING','The argument path cannot modify object prototypes.');
     const format=selected.format??'json';need(['json','string','integer','decimal','boolean','timestamp'].includes(format),'INVALID_MAPPING','Select a supported explicit source conversion.');
     result.fields.push({target,source,required:selected.required!==false,format});
   }
   for(const key of ['value','revenue'])if(item[key]!==undefined&&item[key]!==null){
     object(item[key],key+' mapping');need(currencyIds.has(item[key].currencyId),'INVALID_MAPPING','Select an existing original programme currency.');
     const amountPointer=optionalPointer(item[key].amountPointer,key+' amount pointer');need(amountPointer!==null,'INVALID_MAPPING','Select an original amount pointer.');
     const units=item[key].units??'base';need(['base','decimal'].includes(units),'INVALID_MAPPING','Select integer base units or an original decimal amount.');
     result[key]={amountPointer,currencyId:item[key].currencyId,units};
   }
   return result;
 });
 need(new Set(mappings.map(item=>item.id)).size===mappings.length,'DUPLICATE_MAPPING','Each mapping requires a unique ID.');
 const providerSourceIds=[...new Set((definition.providerSourceIds??definition.programmeSourceIds??[]).map(value=>token(value,'Original provider source ID',256)))];
 const rules=clone(definition.rules??{});object(rules,'Programme rules');
 let period=null;
 if(definition.period!==undefined&&definition.period!==null){
   object(definition.period,'Programme period');need((definition.period.timeZone??'UTC')==='UTC','INVALID_PERIOD','Use an explicit UTC programme period.');
   period={from:iso(definition.period.from,'Period start'),to:iso(definition.period.to,'Period end'),timeZone:'UTC'};
   need(Date.parse(period.from)<Date.parse(period.to),'INVALID_PERIOD','The period end must follow its inclusive start.');
 }
 const programmeSelection={};
 if(definition.selection!==undefined&&definition.selection!==null){
   object(definition.selection,'Programme selection');
   for(const key of Object.keys(definition.selection))need(['incentiveIds','incentiveSlugs','triggerRefs','audienceIds','tierIds'].includes(key),'INVALID_SELECTION','Select original incentive, trigger, audience or tier identities.');
   for(const [key,value] of Object.entries(definition.selection))programmeSelection[key]=[...new Set(list(value,key).map(item=>token(item,key,256)))];
 }
 return {name:text(definition.name,'Programme name',256),projectId,network:network.network,chainIdentifier:network.chainIdentifier,contracts,currencies,mappings,providerSourceIds,rules,...(period?{period}:{}),...(Object.keys(programmeSelection).length?{selection:programmeSelection}:{})};
}
function selection(programme){
 object(programme,'Saved programme');const definition=normalizeFuulProgramme(programme.definition??programme);
 return {definition,identity:{id:programme.id??null,version:programme.version??null,sha256:programme.sha256??sha256(definition),projectId:definition.projectId,network:definition.network}};
}
function safePointer(value,path){try{return atPointer(value,path);}catch(error){if(error.code==='RECORDS_PATH_MISSING')return undefined;throw error;}}
function numericSubset(numeric,path){
 const result={};for(const [key,value] of Object.entries(numeric??{}))if(key===path||key.startsWith(path+'/'))result[key.slice(path.length)]=value;return result;
}
function requestQuery(request){
 const result={};
 if(request?.path){try{for(const [key,value] of new URL(request.path,'https://selected.invalid').searchParams)result[key]=value;}catch{}}
 if(request?.query&&typeof request.query==='object')Object.assign(result,clone(request.query));
 if(request?.filters&&typeof request.filters==='object')Object.assign(result,clone(request.filters));
 return result;
}
function hashValue(value){
 if(typeof value!=='string')return null;
 if(/^(?:0x)?[0-9a-fA-F]{64}$/.test(value))return value.replace(/^0x/,'').toLowerCase();
 return null;
}
function proofValue(value){
 if(typeof value==='string'){
  const hex=value.replace(/^0x/,'');if(/^[0-9a-fA-F]{64}$/.test(hex))return hex.toLowerCase();
  try{const bytes=Buffer.from(value,'base64');if(bytes.length===32&&bytes.toString('base64').replace(/=+$/,'')===value.replace(/=+$/,''))return bytes.toString('hex');}catch{}
 }
 if(value?.encoding==='base64'&&typeof value.bytes==='string'){const bytes=Buffer.from(value.bytes,'base64');if(bytes.length===32)return bytes.toString('hex');}
 return null;
}
function kindEntity(kind){
 return {'pipeline':'pipeline','event-status':'broad-event-status','payouts':'allocation','movements':'movement','pending-payouts':'payout','rewards-payouts':'payout','claim-checks':'claim-check','claim-totals':'claim-total','claim-history':'claim-history','claim.close':'claim-preparation','claim.prepare':'claim-preparation','event.send':'event-result','event.batch':'batch-result'}[kind]??'configuration';
}
function defaultRecordsPath(provider,kind){
 if(provider==='stellar')return kind==='events'?'/result/events':kind==='ledger-entries'?'/result/entries':'/result';
 return {'payouts':'/results','movements':'/results','claim-checks':'/claim_checks','claim-history':'/results','pending-payouts':'/results','rewards-payouts':'/results','currencies':'/results'}[kind]??'';
}
function statusText(value){return typeof value==='string'?value:typeof value==='boolean'?String(value):null;}
function projectionOf(original,{provider,kind,entity,query,projectId,network,sourceScope,parent={},recordPath,numericLexemes,request,httpStatus}){
 const row=original!==null&&typeof original==='object'&&!Array.isArray(original)?original:{};
 const userObject=row.user&&typeof row.user==='object'?row.user:{};
 const projection={
  entity,recordPath,projectId:stringField(row,'project_id','projectId')??parent.projectId??projectId??null,
  network,sourceScope,request:clone(request??{}),query:clone(query),httpStatus,
  eventId:stringField(row,'event_id')??parent.eventId??null,dedupId:stringField(row,'dedup_id')??parent.dedupId??null,
  eventName:stringField(row,'event_name')??parent.eventName??null,
  userIdentifier:stringField(row,'user_identifier')??stringField(userObject,'identifier')??scalar(query.user_identifier)??parent.userIdentifier??null,
  userIdentifierType:stringField(row,'user_identifier_type','identifier_type')??stringField(userObject,'identifier_type')??scalar(query.user_identifier_type??query.identifier_type)??parent.userIdentifierType??null,
  referrerIdentifier:stringField(row,'referrer_identifier'),endUserIdentifier:stringField(row,'enduser_address','end_user_identifier'),
  payoutId:stringField(row,'payout_id'),conversionId:stringField(row,'conversion_id'),
  currency:stringField(row,'currency_address','currency'),chainIdentifier:stringField(row,'currency_chain_id','chain_id','chain_identifier'),
  currencyDecimals:field(row,'currency_decimals','decimals'),amount:stringField(row,'total_amount','amount'),
  assetType:stringField(row,'type','reward_type')??scalar(query.type),status:statusText(field(row,'status','payout_status')),statusDetails:clone(field(row,'status_details','payout_status_details')),
  transactionHash:hashValue(field(row,'hash','transaction_hash','transactionHash','txHash')),
  proof:proofValue(row.proof),reason:clone(field(row,'reason')),calculatedAt:stringField(row,'calculated_at'),
  originalId:stringField(row,'id'),viewQuery:Object.fromEntries(Object.entries(query).filter(([key])=>!['page','page_size','cursor'].includes(key))),numericLexemes:numericSubset(numericLexemes,recordPath)
 };
 if(projection.currencyDecimals!==null){const n=Number(projection.currencyDecimals);projection.currencyDecimals=Number.isSafeInteger(n)&&n>=0&&n<=255?n:null;}
 if(entity==='event'){projection.eventId=stringField(row,'id','event_id');projection.eventName=stringField(row,'name','event_name')??parent.eventName;}
 if(entity==='payout'&&projection.payoutId===null)projection.payoutId=stringField(row,'id');
 if(entity==='claim-preparation'){
   projection.userIdentifier=stringField(row,'to')??projection.userIdentifier;
   projection.projectAddress=stringField(row,'project_address');
   projection.tokenId=stringField(row,'token_id');projection.deadline=stringField(row,'deadline','deadline_seconds');
   projection.currencyType=clone(row.currency_type??null);
   projection.claimId=stringField(row,'id');projection.signers=clone(row.signers??null);
   projection.signatureFormat=row.signers!==undefined?'soroban-authorization-entry-xdr-base64':row.signatures!==undefined?'original-provider-signatures':null;
   projection.authorizationEntries=row.signers!==undefined&&Array.isArray(row.signatures)?clone(row.signatures):null;
 }
 if(entity==='claim-check'){projection.claimId=stringField(row,'id');projection.deadline=stringField(row,'deadline_seconds');}
 if(entity==='claim-history')projection.status='claimed';
 if(entity==='claim-total'&&projection.reason===null&&query.reason!==undefined)projection.reason=query.reason;
 const interval={from:query.from??query.from_date??null,to:query.to??query.to_date??null,type:query.type??null};
 let identity;
 if(entity==='pipeline')identity={eventId:query.event_id??null,dedupId:query.dedup_id??null,eventName:query.event_name??null};
 else if(entity==='event'&&projection.eventId)identity={id:projection.eventId};
 else if(entity==='claim-history')identity={hash:projection.transactionHash,currency:projection.currency,chain:projection.chainIdentifier,user:projection.userIdentifier};
 else if(entity==='claim-total')identity={currency:projection.currency,chain:projection.chainIdentifier,user:projection.userIdentifier,status:projection.status,reason:query.reason??projection.reason};
 else if(projection.claimId)identity={id:projection.claimId};
 else if(projection.payoutId)identity={payoutId:projection.payoutId,currency:projection.currency,chain:projection.chainIdentifier,user:projection.userIdentifier,isReferrer:row.is_referrer??null};
 else if(entity==='allocation')identity={conversionId:projection.conversionId,currency:projection.currency,chain:projection.chainIdentifier,user:projection.userIdentifier,isReferrer:row.is_referrer??null,groupBy:query.group_by??null,interval};
 else if(projection.originalId)identity={id:projection.originalId};
 else identity={path:recordPath,bodySha256:sha256(original),query};
 projection.entityKey=sha256({provider,sourceScope,network,projectId:projection.projectId,entity,identity});
 projection.sourceIdentity={provider,network,sourceScope,entity,identity};
 return projection;
}
/** Original JSON numeric tokens remain exact strings; complete native bytes remain at sourceId. */
export async function normalizeFuulRecords(context){
 object(context,'Original source context');const provider=context.provider??'fuul',kind=context.kind??'document';
 need(['fuul','stellar','activity','document'].includes(provider),'INVALID_PROVIDER','Select an original supported source provider.');
 if(provider==='document')return [];
 const sourceId=token(context.sourceId,'Original source ID',256),captureId=context.captureId??null,sourceScope=context.sourceScope??sourceId;
 const observedAt=iso(context.observedAt??new Date().toISOString(),'Original source observation');
 const network=fuulNetwork(context.network).network;
 const body=Buffer.isBuffer(context.rawBody)?context.rawBody:context.rawBody!==undefined?Buffer.from(context.rawBody):Buffer.from(JSON.stringify(context.records??[]));
 const httpStatus=context.status??context.response?.status??null;
 need(context.response?.bodyComplete!==false,'INCOMPLETE_SOURCE','The original response must complete before projection.');
 need(context.format===undefined||context.format===null||context.format==='json'||(provider==='activity'&&context.format==='csv'),'INVALID_SOURCE_FORMAT','CSV is supported for original activity sources; native provider bodies remain JSON.');
 const parsed=provider==='activity'&&context.format==='csv'?parseFuulCSV(body):body.length?parseFuulJSON(body):{value:null,numericLexemes:{},bodySha256:sha256(body)};
 const root=parsed.value,query=requestQuery(context.request),request=clone(context.request??{});
 let selectedPath=context.recordsPath===null?'':context.recordsPath===undefined?defaultRecordsPath(provider,kind):context.recordsPath;
 if(selectedPath!==''&&safePointer(root,selectedPath)===undefined){
   // The complete native list can itself be the root array. An explicit pointer still fails precisely.
   if(context.recordsPath===undefined&&Array.isArray(root))selectedPath='';
   else if(context.recordsPath===undefined&&provider==='fuul'&&root&&typeof root==='object'){
     const candidate=['results','items','data','projects'].find(key=>Array.isArray(root[key]));
     if(candidate)selectedPath='/'+candidate;else selectedPath='';
   }
 }
 const selected=selectedPath===''?root:atPointer(root,selectedPath),items=Array.isArray(selected)?selected:[selected];
 const rows=[];
 function add(original,entity,path,parent={}){
   const projection=projectionOf(original,{provider,kind,entity,query,projectId:context.projectId,network,sourceScope,parent,recordPath:path,numericLexemes:parsed.numericLexemes,request,httpStatus});
   const row={id:sha256({sourceId,path,entity,original}),provider,kind,sourceId,captureId,sourceScope,observedAt,network,original:clone(original),projection};
   rows.push(row);return row;
 }
 if(provider==='fuul'&&kind==='pipeline'){
   const pipeline=add(root,'pipeline','');
   const event=root?.event;
   const created=httpStatus===404?false:(root?.created===true||(event!==null&&typeof event==='object'&&!Array.isArray(event)));
   pipeline.projection.created=created;pipeline.projection.notFound=httpStatus===404;
   pipeline.projection.nativeEvent=clone(event??null);pipeline.projection.eventNumericLexemes=numericSubset(parsed.numericLexemes,'/event');
   pipeline.projection.eventId=stringField(event,'id','event_id')??scalar(query.event_id);
   pipeline.projection.dedupId=stringField(event,'dedup_id')??scalar(query.dedup_id);
   pipeline.projection.eventName=stringField(event,'name','event_name')??scalar(query.event_name);
   pipeline.projection.userIdentifier=stringField(event?.user,'identifier')??stringField(event,'user_identifier');
   const parent={projectId:pipeline.projection.projectId,eventId:pipeline.projection.eventId,dedupId:pipeline.projection.dedupId,eventName:pipeline.projection.eventName,userIdentifier:pipeline.projection.userIdentifier,userIdentifierType:stringField(event?.user,'identifier_type')};
   if(event!==undefined&&event!==null)add(event,'event','/event',parent);
   for(const [key,entity] of [['trigger_executions','trigger-execution'],['attributions','attribution'],['payouts','payout'],['movements','movement']]){
     if(Array.isArray(root?.[key]))root[key].forEach((value,index)=>add(value,entity,'/'+key+'/'+index,parent));
   }
   return rows;
 }
 if(provider==='fuul'&&kind==='claim-totals'&&selectedPath===''){
   for(const key of ['claimed','unclaimed'])if(Array.isArray(root?.[key]))root[key].forEach((value,index)=>{
     const row=add(value,'claim-total','/'+key+'/'+index);row.projection.totalGroup=key;
   });
   if(!rows.length)add(root,'claim-total','');
   return rows;
 }
 let decoded=null,runtime=null,transactionView=null;
 const nativeMethod=request.body?.method??request.rpc?.method;
 if(provider==='stellar'&&(kind==='transaction'||nativeMethod==='getTransaction')){
  const result=await decodeFuulStellarTransaction({rawBody:body,request,network,runtime:context.runtime});transactionView=result.projection;runtime=result.runtime;
 }
 if(provider==='stellar'&&kind==='events'){
   const result=await decodeFuulStellarEvents({rawBody:body,request,connection:context.connection??{},network,runtime:context.runtime,contracts:context.contracts??context.connection?.contracts,signal:context.signal});
   decoded=new Map(result.nativeView.events.map(event=>[event.id,event]));runtime=result.runtime;
 }
 for(let index=0;index<items.length;index++){
   const original=items[index],path=Array.isArray(selected)?selectedPath+'/'+index:selectedPath;
   const entity=provider==='activity'?'activity':provider==='stellar'?(kind==='events'?'native-event':'native-'+kind):kindEntity(kind);
   const row=add(original,entity,path);
   if(provider==='activity'){
     row.projection.originalId=stringField(original,'id','event_id');
     row.projection.activityId=row.projection.originalId;
   }
   if(transactionView){Object.assign(row.projection,transactionView,{entity:'native-transaction'});row.runtime=clone(runtime);}
   if(provider==='stellar'&&kind==='events'){
     const native=decoded.get(original?.id)??null;
     Object.assign(row.projection,{native,contractAddress:original?.contractId??native?.contractId??null,eventId:original?.id??null,transactionHash:hashValue(original?.txHash??native?.hash),ledger:scalar(original?.ledger??native?.ledger),successful:original?.inSuccessfulContractCall===true,nativeEventName:native?.parsed?.name??null});
     const originalParams=request.body?.params??request.rpc?.params??{};
     const nativeSelection=request.nativeSelection??(originalParams.startLedger!==undefined||originalParams.endLedger!==undefined?{startLedger:originalParams.startLedger??null,endLedger:originalParams.endLedger??null,contractIds:originalParams.filters?.flatMap(filter=>filter.contractIds??[])??[]}:null);
     row.projection.nativeSelection=clone(nativeSelection);
     let withinSelection=true;
     if(nativeSelection){
       const start=nativeSelection.startLedger===undefined||nativeSelection.startLedger===null?null:safeInteger(nativeSelection.startLedger,'Original selected start ledger',{minimum:1,maximum:0xffffffff});
       const end=nativeSelection.endLedger===undefined||nativeSelection.endLedger===null?null:safeInteger(nativeSelection.endLedger,'Original selected end ledger',{minimum:1,maximum:0xffffffff});
       need(start===null||end===null||end>start,'INVALID_NATIVE_SELECTION','The original selected ledger interval is empty.');
       const ledger=safeInteger(row.projection.ledger,'Original event ledger',{minimum:1,maximum:0xffffffff});
       const ids=nativeSelection.contractIds??[];list(ids,'Original selected contract IDs');ids.forEach(value=>stellarAddress(value,'Original selected contract',{kind:'contract'}));
       withinSelection=(start===null||ledger>=start)&&(end===null||ledger<end)&&(!ids.length||ids.includes(row.projection.contractAddress));
     }
     row.projection.selected=withinSelection;
     row.projection.sourceIdentity={provider,network,contract:row.projection.contractAddress,eventId:row.projection.eventId};
     row.projection.entityKey=sha256(row.projection.sourceIdentity);
     row.runtime=clone(runtime);
     if(native?.parsed?.name&&String(native.parsed.name).toLowerCase()==='claimed'){
       const data=native.parsed.data??{};
       Object.assign(row.projection,{entity:'native-claim',projectAddress:stringField(data,'project_address'),userIdentifier:stringField(data,'to'),currency:stringField(data,'currency'),amount:scalar(data.amount),currencyType:clone(data.currency_type??null),reason:clone(data.reason??null),proof:proofValue(data.proof),tokenId:scalar(data.token_id)});
     }
   }
 }
 return rows;
}
function writePointer(target,path,value){
 const parts=path.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'));
 let current=target;
 for(let i=0;i<parts.length;i++){
   const key=parts[i];need(!['__proto__','constructor','prototype'].includes(key),'INVALID_MAPPING','The mapped argument cannot modify an object prototype.');
   if(i===parts.length-1){current[key]=clone(value);return;}
   if(!Object.hasOwn(current,key))current[key]={};
   need(current[key]!==null&&typeof current[key]==='object'&&!Array.isArray(current[key]),'MAPPING_COLLISION','The argument mapping would overwrite an existing scalar or array.');
   current=current[key];
 }
}
function mappedValue(value,format,name){
 if(format==='json')return clone(value);
 if(format==='string')return text(scalar(value),name,8192);
 if(format==='integer')return nonnegative(value,name);
 if(format==='decimal'){need(typeof value==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value),'INVALID_AMOUNT',name+' requires exact nonnegative decimal text.');return value;}
 if(format==='boolean'){need(typeof value==='boolean','INVALID_MAPPING',name+' requires an original boolean.');return value;}
 if(format==='timestamp'){
   if(typeof value==='string'&&/^\d{4}-/.test(value))return Date.parse(iso(value,name));
   return safeInteger(value,name,{minimum:0});
 }
 throw new FuulError('INVALID_MAPPING','Select an explicit source conversion.');
}
export function prepareFuulEvent({programme,record,mappingId,dedupId}){
 const selected=selection(programme),definition=selected.definition;
 object(record,'Original selected record');const mapping=definition.mappings.find(item=>item.id===mappingId);
 need(mapping,'MAPPING_NOT_FOUND','Select an original saved programme mapping.');
 need(record.provider===mapping.provider&&record.kind===mapping.kind,'MAPPING_SOURCE_MISMATCH','The selected original record does not match this mapping.');
 need(fuulNetwork(record.network).network===definition.network,'NETWORK_MISMATCH','The original record and selected programme belong to different Stellar networks.');
 need(record.projection?.selected!==false,'SOURCE_OUTSIDE_CAPTURE_WINDOW','The original event is outside its retained capture selection.');
 if(record.provider==='stellar'&&record.kind==='events')need(record.projection?.successful===true,'UNSUCCESSFUL_NATIVE_EVENT','The original Fuul event must belong to a successful native contract call.');
 const view=mapping.view==='projection'?record.projection:record.original;
 const user=stellarAddress(atPointer(view,mapping.userPointer),'Mapped original Stellar account',{kind:'account'});
 let nativeIdentity;
 if(mapping.identityPointer!==null){const value=atPointer(view,mapping.identityPointer);nativeIdentity={provider:record.provider,network:record.network,namespace:mapping.sourceNamespace,id:token(scalar(value),'Original action identity',2048)};}
 else{
   nativeIdentity=record.projection?.sourceIdentity;
   need(nativeIdentity&&record.provider==='stellar'&&record.projection?.eventId,'SOURCE_IDENTITY_REQUIRED','Select an original identity pointer for this activity mapping.');
 }
 const eventKey=sha256({schema:'stellar-forge.fuul-event-identity.v1',projectId:definition.projectId,network:definition.network,source:nativeIdentity,eventName:mapping.event});
 const dedup=dedupId===undefined?'fuul-'+eventKey:text(dedupId,'Original selected dedup_id',200);
 need(new Set(mapping.fields.map(item=>item.target)).size===mapping.fields.length,'MAPPING_COLLISION','Each explicit argument target must be selected once.');
 const args=clone(mapping.args);
 for(const field of mapping.fields){
   const value=safePointer(view,field.source);
   if(value===undefined){need(!field.required,'MAPPED_VALUE_MISSING','An original required field is missing.',{mappingId,path:field.source});continue;}
   writePointer(args,field.target,mappedValue(value,field.format,field.source));
 }
 for(const key of ['value','revenue'])if(mapping[key]){
   const spec=mapping[key],currency=definition.currencies.find(item=>item.id===spec.currencyId),value=atPointer(view,spec.amountPointer);
   const amount=spec.units==='decimal'?decimalUnits(value,currency.decimals,key+' amount'):BigInt(nonnegative(value,key+' amount'));
   need(amount>=0n&&amount<=I128_MAX,'INVALID_AMOUNT','The mapped original amount exceeds the native Stellar i128 range.');
   args[key]={amount:amount.toString(),currency:{identifier:currency.address,identifier_type:'stellar_contract',chain_identifier:currency.chainIdentifier}};
 }
 const body={name:mapping.event,dedup_id:dedup,user:{identifier:user,identifier_type:'stellar_address'},args};
 if(mapping.timestampPointer!==null)body.timestamp=mappedValue(atPointer(view,mapping.timestampPointer),'timestamp','Original event timestamp');
 const originalScope=programmeRowScope(record,definition);need(originalScope.included,'SOURCE_OUTSIDE_PROGRAMME','The original record is outside the saved programme selection.',{reason:originalScope.reason});
 if(definition.period&&body.timestamp!==undefined)need(body.timestamp>=Date.parse(definition.period.from)&&body.timestamp<Date.parse(definition.period.to),'SOURCE_OUTSIDE_PROGRAMME_PERIOD','The original mapped activity is outside the saved programme period.');
 const bodySha256=sha256(Buffer.from(canonical(body)+'\n'));
 return {schema:'stellar-forge.fuul-prepared-event.v1',eventKey,sourceRecordId:record.id,sourceIdentity:clone(nativeIdentity),programmeId:selected.identity.id,programmeVersion:selected.identity.version,projectId:definition.projectId,network:definition.network,mappingId,body,bodySha256,correlation:{projectId:definition.projectId,dedupId:dedup,eventName:mapping.event,userIdentifier:user,sourceIdentity:clone(nativeIdentity)}};
}
function eventSelection(event){
 const native=event.native??{},body=event.body??native.body??event.request?.body??null,correlation=event.correlation??native.correlation??{};
 return {body,projectId:event.projectId??correlation.projectId??native.projectId??null,dedupId:correlation.dedupId??body?.dedup_id??null,eventName:correlation.eventName??body?.name??null,userIdentifier:correlation.userIdentifier??body?.user?.identifier??null,eventId:event.providerEventId??event.nativeEventId??correlation.eventId??event.pipeline?.eventId??null};
}
function bodyComparison(expected,actual,numeric){
 if(!expected||!actual||typeof actual!=='object')return null;
 const parsed=parseFuulJSON(Buffer.from(JSON.stringify(expected))),original=parsed.value;
 let complete=true;
 for(const key of ['name','dedup_id','user','args','timestamp']){
   if(!Object.hasOwn(expected,key))continue;
   const actualKey=key==='name'&&!own(actual,'name')&&own(actual,'event_name')?'event_name':key;
   if(!own(actual,actualKey)){complete=false;continue;}
   if(canonical(original[key])!==canonical(actual[actualKey]))return false;
   const expectedNumbers=numericSubset(parsed.numericLexemes,'/'+key),actualNumbers=numericSubset(numeric,'/'+actualKey);
   if(canonical(expectedNumbers)!==canonical(actualNumbers))return false;
 }
 return complete?true:null;
}
/** Only exact retained pipeline lookups can resolve an uncertain event dispatch. */
export function matchFuulPipeline({event,records}){
 object(event,'Original event');list(records,'Pipeline records');
 const selected=eventSelection(event),matches=[],conflicts=[];
 for(const record of records){
   const p=record.projection??{};
   if(record.provider!=='fuul'||record.kind!=='pipeline'||p.entity!=='pipeline')continue;
   if(!selected.projectId||p.projectId!==selected.projectId)continue;
   const query=p.query??requestQuery(p.request),byId=selected.eventId&&query.event_id===selected.eventId&&!query.dedup_id&&!query.event_name;
   const byPair=selected.dedupId&&selected.eventName&&query.dedup_id===selected.dedupId&&query.event_name===selected.eventName&&!query.event_id;
   if(!byId&&!byPair)continue;
   const original=p.nativeEvent??record.original?.event;
   const returnedProject=stringField(original,'project_id','projectId');
   const returnedId=stringField(original,'id','event_id'),returnedDedup=stringField(original,'dedup_id'),returnedName=stringField(original,'name','event_name');
   if((returnedProject&&returnedProject!==selected.projectId)||(byId&&returnedId&&returnedId!==selected.eventId)||(returnedDedup&&selected.dedupId&&returnedDedup!==selected.dedupId)||(returnedName&&selected.eventName&&returnedName!==selected.eventName)){
     conflicts.push(record);continue;
   }
   const created=p.httpStatus===404?false:(p.httpStatus>=200&&p.httpStatus<300&&p.created===true);
   const bodyMatches=created?bodyComparison(selected.body,original,p.eventNumericLexemes??{}):null;
   matches.push({record,created,bodyMatches,eventId:returnedId??selected.eventId});
 }
 matches.sort((a,b)=>String(a.record.observedAt).localeCompare(String(b.record.observedAt))||a.record.id.localeCompare(b.record.id));
 conflicts.sort((a,b)=>String(a.observedAt).localeCompare(String(b.observedAt))||a.id.localeCompare(b.id));
 const latest=matches.at(-1),latestConflict=conflicts.at(-1);
 if(latestConflict&&(!latest||String(latestConflict.observedAt)>=String(latest.record.observedAt)))return {matched:false,created:false,bodyMatches:false,status:'IDENTITY_CONFLICT',eventId:selected.eventId,sourceIds:[...new Set([...matches.map(item=>item.record.sourceId),...conflicts.map(item=>item.sourceId)])],recordIds:matches.map(item=>item.record.id),conflictRecordIds:conflicts.map(item=>item.id)};
 if(!latest)return {matched:false,created:false,bodyMatches:null,status:conflicts.length?'IDENTITY_CONFLICT':'UNOBSERVED',eventId:selected.eventId,sourceIds:[],recordIds:[],conflictRecordIds:conflicts.map(item=>item.id)};
 return {matched:true,created:latest.created,bodyMatches:latest.bodyMatches,status:latest.bodyMatches===false?'BODY_CONFLICT':latest.created?'CREATED':latest.record.projection.httpStatus===404?'NOT_FOUND':'UNKNOWN',eventId:latest.eventId,sourceIds:[...new Set(matches.map(item=>item.record.sourceId))],recordIds:matches.map(item=>item.record.id),conflictRecordIds:conflicts.map(item=>item.id)};
}

function compareTime(a,b){return String(a.observedAt??a.createdAt??'').localeCompare(String(b.observedAt??b.createdAt??''))||String(a.id).localeCompare(String(b.id));}
function unique(values){return [...new Set(values.filter(value=>value!==null&&value!==undefined))];}
function exception(code,message,records=[],details={}){
 const recordIds=unique(records.map(row=>row.id)),sourceIds=unique(records.map(row=>row.sourceId));
 return {id:sha256({code,recordIds,details}),code,message,recordIds,sourceIds,details};
}
function retainedDecision(row){
 return {id:row.id,programmeId:row.programmeId,programmeVersion:row.programmeVersion,recordId:row.recordId,sourceId:row.sourceId,action:row.action,link:clone(row.link??null),actor:row.actor,reason:row.reason,supersedes:row.supersedes??null,createdAt:row.createdAt};
}
function rowTime(row){
 const value=row.original??{},entity=row.projection?.entity;
 if(entity==='claim-total'||entity==='allocation')return null;
 if(entity==='native-event'||entity==='native-claim')return value.ledgerClosedAt??row.projection?.native?.closedAt??null;
 if(entity==='movement')return value.date??value.created_at??null;
 if(entity==='claim-history')return value.claimed_at??null;
 if(entity==='event')return value.timestamp??value.created_at??null;
 if(entity==='payout'||entity==='trigger-execution'||entity==='attribution')return value.created_at??value.date??null;
 return null;
}
function epoch(value){
 if(value===null||value===undefined)return null;
 if(typeof value==='number'&&Number.isSafeInteger(value))return value;
 if(typeof value==='string'&&/^\d{13}$/.test(value))return Number(value);
 if(typeof value==='string'&&/^\d{4}-/.test(value)){const time=Date.parse(value);return Number.isFinite(time)?time:null;}
 return null;
}
function programmeRowScope(row,definition){
 const projection=row.projection??{},selection=definition.selection??{};
 if(projection.selected===false)return {included:false,reason:'outside-native-capture-selection'};
 if(row.network&&fuulNetwork(row.network).network!==definition.network)return {included:false,reason:'different-network'};
 if(projection.projectId&&projection.projectId!==definition.projectId)return {included:false,reason:'different-project'};
 if(projection.chainIdentifier&&/^\d+$/.test(String(projection.chainIdentifier))&&Number(projection.chainIdentifier)!==definition.chainIdentifier)return {included:false,reason:'different-native-chain'};
 const original=row.original??{};
 if(row.provider==='stellar'&&projection.contractAddress&&definition.contracts.length&&!definition.contracts.some(item=>item.address===projection.contractAddress))return {included:false,reason:'unselected-contract'};
 if(projection.projectAddress&&definition.contracts.some(item=>item.role==='project')&&!definition.contracts.some(item=>item.role==='project'&&item.address===projection.projectAddress))return {included:false,reason:'unselected-project-contract'};
 const fields=[
  ['incentiveIds',projection.conversionId??stringField(original,'conversion_id','incentive_id')],
  ['incentiveSlugs',stringField(original,'conversion_slug','incentive_slug','slug')],
  ['triggerRefs',stringField(original,'trigger_ref','ref')],
  ['audienceIds',stringField(original,'audience_id')],
  ['tierIds',stringField(original,'tier_id')]
 ];
 const unknown=[];
 for(const [key,value] of fields)if(selection[key]?.length){
   if(value!==null&&value!==undefined&&!selection[key].includes(value))return {included:false,reason:'unselected-'+key};
   if(value===null||value===undefined)unknown.push(key);
 }
 const time=epoch(rowTime(row));let period='unassigned';
 if(definition.period&&time!==null){
   if(time<Date.parse(definition.period.from)||time>=Date.parse(definition.period.to))return {included:false,reason:'outside-period',period:'outside'};
   period='within';
 }else if(!definition.period)period='all';
 return {included:true,period,unresolvedSelection:unknown};
}
function references(rows){return {recordIds:unique(rows.map(item=>item.id)),sourceIds:unique(rows.map(item=>item.sourceId))};}
function currentGroups(rows){
 const groups=new Map();
 for(const row of rows){const key=row.projection?.entityKey??row.id;let list=groups.get(key);if(!list){list=[];groups.set(key,list);}list.push(row);}
 return [...groups.values()].map(history=>{history.sort(compareTime);return {current:history.at(-1),history};});
}
function monetaryRow(group,definition,kind){
 const row=group.current,p=row.projection,source=row.original??{};
 const chain=scalar(p.chainIdentifier)??String(definition.chainIdentifier),asset=definition.currencies.find(item=>item.address===p.currency&&String(item.chainIdentifier)===chain);
 const amount=p.amount,decimals=p.currencyDecimals??asset?.decimals??null;
 let displayAmount=null,amountError=null;
 if(amount!==null){try{const units=BigInt(nonnegative(amount,'Original retained amount',null));if(decimals!==null)displayAmount=formatUnits(units,decimals);}catch(error){amountError=error.message;}}
 return {id:p.entityKey,kind,projectId:p.projectId??definition.projectId,network:definition.network,
  sourceScope:row.sourceScope,viewQuery:clone(p.viewQuery??{}),viewKey:['allocation','claim-total'].includes(p.entity)?sha256({sourceScope:row.sourceScope,kind:p.entity,query:p.viewQuery??{}}):null,assetType:p.assetType??null,userIdentifier:p.userIdentifier,userIdentifierType:p.userIdentifierType,referrerIdentifier:p.referrerIdentifier,endUserIdentifier:p.endUserIdentifier,
  eventId:p.eventId,dedupId:p.dedupId,eventName:p.eventName,payoutId:p.payoutId,conversionId:p.conversionId,
  currency:p.currency,chainIdentifier:chain,currencyDecimals:decimals,currencyLabel:asset?.label??stringField(source,'currency_name'),amount,displayAmount,amountError,
  status:p.status,statusDetails:clone(p.statusDetails),reason:clone(p.reason),proof:p.proof,transactionHash:p.transactionHash,
  claimId:p.claimId??null,deadline:p.deadline??null,tokenId:p.tokenId??null,currencyType:clone(p.currencyType??null),projectAddress:p.projectAddress??null,
  signatureFormat:p.signatureFormat??null,calculatedAt:p.calculatedAt,observedAt:row.observedAt,period:p.selectedPeriod??'unassigned',unresolvedSelection:clone(p.unresolvedSelection??[]),
  originalIdentity:clone(p.sourceIdentity),operatorLinks:clone(p.operatorLinks??[]),
  history:group.history.map(item=>({recordId:item.id,sourceId:item.sourceId,observedAt:item.observedAt,status:item.projection.status,amount:item.projection.amount,proof:item.projection.proof})),
  ...references(group.history)};
}
function nativeClaimRow(group,definition){
 const row=monetaryRow(group,definition,'native-claim'),p=group.current.projection;
 return {...row,eventId:p.eventId,contractAddress:p.contractAddress,ledger:p.ledger,nativeEventName:p.nativeEventName,successful:p.successful};
}
function totalsByCurrency(rows,{periodOnly=false}={}){
 const totals=new Map();
 for(const row of rows){
   if(periodOnly&&row.period!=='within')continue;
   if(row.amount===null||row.amount===undefined||row.amountError||row.unresolvedSelection?.length)continue;
   let amount;try{amount=BigInt(nonnegative(row.amount,'Original amount',null));}catch{continue;}
   const key=canonical({projectId:row.projectId,network:row.network,currency:row.currency,chainIdentifier:row.chainIdentifier,decimals:row.currencyDecimals,status:row.status,kind:row.kind,reason:row.reason??null,sourceScope:row.sourceScope,viewKey:row.viewKey??null});
   let current=totals.get(key);
   if(!current){current={projectId:row.projectId,network:row.network,currency:row.currency,chainIdentifier:row.chainIdentifier,currencyDecimals:row.currencyDecimals,kind:row.kind,status:row.status,reason:clone(row.reason??null),sourceScope:row.sourceScope,viewKey:row.viewKey??null,viewQuery:row.viewKey?clone(row.viewQuery):null,amount:0n,rows:0};totals.set(key,current);}
   current.amount+=amount;current.rows++;
 }
 return [...totals.values()].map(item=>({...item,amount:item.amount.toString(),displayAmount:item.currencyDecimals===null?null:formatUnits(item.amount,item.currencyDecimals)})).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
}
function linkApplied(p,decision){
 const permitted=['eventId','dedupId','eventName','payoutId','transactionHash'];
 const link=object(decision.link,'Explicit original source link');for(const key of Object.keys(link))need(permitted.includes(key),'INVALID_DECISION','Select a supported explicit source correlation.');
 const retained={decisionId:decision.id,actor:decision.actor,reason:decision.reason,link:clone(link)};
 p.operatorLinks??=[];p.operatorLinks.push(retained);
}
function linked(row,key){
 const ownValue=row[key];if(ownValue!==null&&ownValue!==undefined)return ownValue;
 for(const item of row.operatorLinks??[])if(item.link?.[key]!==undefined)return item.link[key];
 return null;
}
function allocationMatchesEvent(row,event){
 const selected=eventSelection(event);
 if(row.projectId!==selected.projectId)return false;
 const eventId=linked(row,'eventId'),dedup=linked(row,'dedupId'),name=linked(row,'eventName');
 if(selected.eventId&&eventId===selected.eventId)return true;
 return Boolean(selected.dedupId&&dedup===selected.dedupId&&(!name||name===selected.eventName));
}
function scopedPipeline(row){
 const p=row.projection,original=row.original??{};
 return {id:p.entityKey,projectId:p.projectId,network:row.network,eventId:p.eventId,dedupId:p.dedupId,eventName:p.eventName,userIdentifier:p.userIdentifier,created:p.created===true,httpStatus:p.httpStatus,observedAt:row.observedAt,query:clone(p.query),
  triggerExecutions:Array.isArray(original.trigger_executions)?original.trigger_executions.map(item=>({id:stringField(item,'id','trigger_id'),status:field(item,'status'),statusDetails:clone(field(item,'status_details')),ref:stringField(item,'trigger_ref','ref')})):[],
  attributions:Array.isArray(original.attributions)?original.attributions.length:0,payouts:Array.isArray(original.payouts)?original.payouts.length:0,movements:Array.isArray(original.movements)?original.movements.length:0,
  recordIds:[row.id],sourceIds:[row.sourceId]};
}
/** Reconcile retained provider observations. No formula replaces original allocation or claim amounts. */
export function reconcileFuulProgramme({programme,records,events=[],actions=[],decisions=[],asOf}){
 const selected=selection(programme),definition=selected.definition;
 list(records,'Original source records');list(events,'Original events');list(actions,'Original actions');list(decisions,'Original decisions');
 const cut=iso(asOf??new Date().toISOString(),'Reconciliation time'),cutTime=Date.parse(cut),allRecords=new Map();
 for(const row of records){object(row,'Original record');need(typeof row.id==='string'&&!allRecords.has(row.id),'DUPLICATE_RECORD','Select each retained original record once.');allRecords.set(row.id,row);}
 const originalDecisions=decisions.map(row=>{
  object(row,'Decision');need(['exclude','include','link'].includes(row.action),'INVALID_DECISION','Select exclusion, inclusion or an explicit link.');
  need(row.programmeId===selected.identity.id,'DECISION_PROGRAMME_MISMATCH','An original decision belongs to another programme.');
  if(row.programmeVersion!==undefined&&row.programmeVersion!==null)need(Number(row.programmeVersion)===Number(selected.identity.version),'DECISION_VERSION_MISMATCH','An original decision belongs to another programme version.');
  const original=allRecords.get(row.recordId);need(original&&original.sourceId===row.sourceId,'DECISION_SOURCE_MISMATCH','The decision must identify a selected original record and source.');
  token(row.id,'Decision ID',256);text(row.actor,'Decision actor',256);text(row.reason,'Decision reason',4096);iso(row.createdAt,'Decision time');
  return clone(row);
 }).sort(compareTime);
 const decisionIds=new Map(originalDecisions.map(row=>[row.id,row]));
 for(const row of originalDecisions)if(row.supersedes){const prior=decisionIds.get(row.supersedes);need(prior&&prior.recordId===row.recordId&&Date.parse(prior.createdAt)<=Date.parse(row.createdAt),'INVALID_DECISION_LINEAGE','A superseded decision must identify the same original record.');}
 const superseded=new Set(originalDecisions.filter(row=>Date.parse(row.createdAt)<=cutTime).map(row=>row.supersedes).filter(Boolean));
 const liveDecisions=originalDecisions.filter(row=>Date.parse(row.createdAt)<=cutTime&&!superseded.has(row.id));
 const perRecord=new Map();for(const decision of liveDecisions){let group=perRecord.get(decision.recordId);if(!group){group=[];perRecord.set(decision.recordId,group);}group.push(decision);}
 const included=[],excluded=[],exceptions=[];
 for(const original of records){
  if(Date.parse(original.observedAt)>cutTime){excluded.push({recordId:original.id,sourceId:original.sourceId,reason:'observed-after-edition'});continue;}
  const decisions=perRecord.get(original.id)??[],lastInclusion=decisions.filter(row=>row.action!=='link').at(-1);
  if(lastInclusion?.action==='exclude'){excluded.push({recordId:original.id,sourceId:original.sourceId,reason:'operator-exclusion',decisionId:lastInclusion.id});continue;}
  const scope=programmeRowScope(original,definition);
  if(!scope.included){excluded.push({recordId:original.id,sourceId:original.sourceId,reason:scope.reason});continue;}
  const row=clone(original);row.projection??={};row.projection.selectedPeriod=scope.period;row.projection.unresolvedSelection=scope.unresolvedSelection;
  for(const decision of decisions.filter(item=>item.action==='link'))linkApplied(row.projection,decision);
  included.push(row);
 }
 const allGroups=currentGroups(included),byEntity=entity=>allGroups.filter(group=>group.current.projection.entity===entity);
 const pipelineGroups=byEntity('pipeline'),pipelines=pipelineGroups.map(group=>({...scopedPipeline(group.current),...references(group.history),history:group.history.map(row=>({recordId:row.id,sourceId:row.sourceId,observedAt:row.observedAt,httpStatus:row.projection.httpStatus,created:row.projection.created}))}));
 const detailedPayouts=byEntity('payout').map(group=>monetaryRow(group,definition,'payout')),aggregateAllocations=byEntity('allocation').map(group=>monetaryRow(group,definition,'allocation-aggregate'));
 const allocations=[...detailedPayouts,...aggregateAllocations];
 const movements=byEntity('movement').map(group=>monetaryRow(group,definition,'movement'));
 const claimChecks=byEntity('claim-check').map(group=>monetaryRow(group,definition,'claim-check'));
 const claimTotals=byEntity('claim-total').map(group=>monetaryRow(group,definition,'claim-total'));
 const claimHistory=byEntity('claim-history').map(group=>monetaryRow(group,definition,'claim-history'));
 const preparations=byEntity('claim-preparation').map(group=>monetaryRow(group,definition,'claim-preparation'));
 const nativeClaims=byEntity('native-claim').map(group=>nativeClaimRow(group,definition));
 const claims=[...claimChecks,...claimTotals,...claimHistory,...preparations,...nativeClaims];
 for(const claim of [...claimChecks,...preparations]){
   const deadline=claim.deadline!==null&&/^\d+$/.test(String(claim.deadline))?BigInt(claim.deadline):null;
   claim.deadlineExpired=deadline===null?null:deadline<=BigInt(Math.floor(cutTime/1000));
   claim.claimableAtAsOf=claim.kind==='claim-preparation'||claim.status==='unclaimed'||claim.status==='closed'?(claim.deadlineExpired===null?null:!claim.deadlineExpired):false;
 }
 for(const row of [...allocations,...movements,...claims]){
   if(row.amountError)exceptions.push({id:sha256({code:'ORIGINAL_AMOUNT_FORMAT',id:row.id}),code:'ORIGINAL_AMOUNT_FORMAT',message:row.amountError,recordIds:row.recordIds,sourceIds:row.sourceIds,details:{entityId:row.id,amount:row.amount}});
   if(row.amount!==null&&row.currency===null&&row.assetType!=='point')exceptions.push({id:sha256({code:'UNRESOLVED_CURRENCY',id:row.id}),code:'UNRESOLVED_CURRENCY',message:'The original monetary row does not identify a currency.',recordIds:row.recordIds,sourceIds:row.sourceIds,details:{entityId:row.id}});
   if(row.unresolvedSelection?.length)exceptions.push({id:sha256({code:'SELECTION_NOT_OBSERVED',id:row.id}),code:'SELECTION_NOT_OBSERVED',message:'The original row does not expose every selected programme dimension.',recordIds:row.recordIds,sourceIds:row.sourceIds,details:{entityId:row.id,selection:row.unresolvedSelection}});
 }
 const eventRows=[];
 for(const event of events){
   const identity=eventSelection(event);if(identity.projectId!==definition.projectId)continue;
   const originRecord=allRecords.get(event.sourceRecordId??event.native?.sourceRecordId);
   const eventTime=epoch(identity.body?.timestamp)??(originRecord?epoch(rowTime(originRecord)):null);
   let eventPeriod=definition.period?'unassigned':'all';
   if(definition.period&&eventTime!==null){if(eventTime<Date.parse(definition.period.from)||eventTime>=Date.parse(definition.period.to))continue;eventPeriod='within';}
   const match=matchFuulPipeline({event,records:included});
   const correlatedAllocations=allocations.filter(row=>allocationMatchesEvent(row,{...event,providerEventId:match.eventId??identity.eventId}));
   const correlatedMovements=movements.filter(row=>allocationMatchesEvent(row,{...event,providerEventId:match.eventId??identity.eventId}));
   const matchingPipelines=pipelines.filter(row=>row.recordIds.some(id=>match.recordIds.includes(id)));
   const nativeStatuses=unique(matchingPipelines.flatMap(row=>row.triggerExecutions.map(item=>scalar(item.status))));
   let stage='PREPARED';
   if(['ACCEPTED','DUPLICATE','OBSERVED'].includes(event.status))stage='INGESTION_OBSERVED';
   if(match.matched&&match.created)stage='PIPELINE_OBSERVED';
   if(correlatedAllocations.length)stage='ALLOCATION_OBSERVED';
   if(correlatedMovements.length)stage='MOVEMENT_OBSERVED';
   if(match.bodyMatches===false||match.status==='IDENTITY_CONFLICT')stage='CORRELATION_CONFLICT';
   const row={id:event.id??event.eventKey??sha256(identity),eventKey:event.eventKey??event.native?.eventKey??null,programmeId:event.programmeId??selected.identity.id,programmeVersion:event.programmeVersion??event.native?.programmeVersion??null,
    projectId:identity.projectId,network:definition.network,eventName:identity.eventName,dedupId:identity.dedupId,userIdentifier:identity.userIdentifier,eventId:match.eventId??identity.eventId,
    deliveryStatus:event.status??'READY',stage,period:eventPeriod,pipeline:match,triggerStatuses:nativeStatuses,allocationIds:correlatedAllocations.map(item=>item.id),movementIds:correlatedMovements.map(item=>item.id),
    recordIds:unique([event.sourceRecordId??event.native?.sourceRecordId,...match.recordIds]),sourceIds:unique([event.sourceId,...match.sourceIds,...correlatedAllocations.flatMap(item=>item.sourceIds),...correlatedMovements.flatMap(item=>item.sourceIds)]),
    originalBodySha256:event.bodySha256??event.native?.bodySha256??null,conflicts:clone(event.conflicts??[])};
   eventRows.push(row);
   if(match.bodyMatches===false||match.conflictRecordIds?.length)exceptions.push({id:sha256({code:'EVENT_PIPELINE_CONFLICT',id:row.id}),code:'EVENT_PIPELINE_CONFLICT',message:'An original pipeline conflicts with the retained event identity or body.',recordIds:unique([...match.recordIds,...(match.conflictRecordIds??[])]),sourceIds:match.sourceIds,details:{eventId:row.id,match}});
   if(event.status==='UNCERTAIN'&&!match.created)exceptions.push({id:sha256({code:'EVENT_OUTCOME_UNCERTAIN',id:row.id}),code:'EVENT_OUTCOME_UNCERTAIN',message:'The original event dispatch requires a later exact pipeline observation or an explicit original operation decision.',recordIds:row.recordIds,sourceIds:row.sourceIds,details:{eventId:row.id,pipelineStatus:match.status}});
 }
 // Correlate native claims by exact original identity and amount, keeping API history and chain rows distinct.
 for(const claim of [...preparations,...claimChecks,...claimHistory]){
   const candidates=nativeClaims.filter(native=>{
     if(native.successful!==true||claim.network!==native.network||claim.currency!==native.currency||claim.userIdentifier!==native.userIdentifier)return false;
     if(claim.amount!==native.amount)return false;
     if(claim.projectAddress&&native.projectAddress!==claim.projectAddress)return false;
     if(claim.proof)return native.proof===claim.proof;
     if(claim.transactionHash)return native.transactionHash===claim.transactionHash;
     return false;
   });
   claim.nativeClaimIds=candidates.map(item=>item.id);
   claim.nativeSettlement=candidates.length===1?'MATCHED':candidates.length>1?'AMBIGUOUS':'UNOBSERVED';
   if(candidates.length>1)exceptions.push({id:sha256({code:'AMBIGUOUS_NATIVE_CLAIM',id:claim.id}),code:'AMBIGUOUS_NATIVE_CLAIM',message:'More than one original native claim matches this retained claim identity.',recordIds:unique([...claim.recordIds,...candidates.flatMap(item=>item.recordIds)]),sourceIds:unique([...claim.sourceIds,...candidates.flatMap(item=>item.sourceIds)]),details:{claimId:claim.id,nativeClaimIds:claim.nativeClaimIds}});
 }
 for(const group of [...byEntity('native-event'),...byEntity('native-claim')]){
   const values=new Set(group.history.map(row=>sha256(row.original)));
   if(values.size>1)exceptions.push(exception('NATIVE_EVENT_BODY_CONFLICT','The same original native event identity has different retained bodies.',group.history,{entityKey:group.current.projection.entityKey}));
 }
 const actionRows=actions.filter(row=>(row.projectId??row.identity?.projectId??definition.projectId)===definition.projectId).map(row=>({
   id:row.id,operation:row.operation,status:row.status??'READY',effect:row.effect??null,projectId:definition.projectId,programmeVersion:row.programmeVersion??null,
   parentActionId:row.parentActionId??null,prerequisiteIds:clone(row.prerequisiteIds??[]),sourceIds:clone(row.sourceIds??[]),bodySha256:row.bodySha256??row.request?.bodySha256??null,
   originalIdentity:clone(row.identity??null)
 }));
 const totals={
   allocationsDetailed:totalsByCurrency(detailedPayouts),allocationAggregateViews:totalsByCurrency(aggregateAllocations),movements:totalsByCurrency(movements),
   claimChecks:totalsByCurrency(claimChecks),claimTotalViews:totalsByCurrency(claimTotals),claimHistory:totalsByCurrency(claimHistory),nativeClaims:totalsByCurrency(nativeClaims),
   ...(definition.period?{periodAllocations:totalsByCurrency(detailedPayouts,{periodOnly:true}),periodMovements:totalsByCurrency(movements,{periodOnly:true}),periodNativeClaims:totalsByCurrency(nativeClaims,{periodOnly:true})}:{})
 };
 const sourceIds=unique(included.map(row=>row.sourceId)),runtimeIds=unique(included.map(row=>row.runtime?.id));
 return {schema:'stellar-forge.fuul-reconciliation.v1',programme:selected.identity,asOf:cut,
  summary:{events:eventRows.length,pipelines:pipelines.length,allocations:allocations.length,movements:movements.length,claims:claims.length,exceptions:exceptions.length,
   eventsCreated:eventRows.filter(row=>row.pipeline.created).length,eventsUncertain:eventRows.filter(row=>row.deliveryStatus==='UNCERTAIN').length,
   matchedNativeClaims:claims.filter(row=>row.nativeSettlement==='MATCHED').length,sourceCount:sourceIds.length,totals},
  events:eventRows,pipelines,allocations,movements,claims,actions:actionRows,exceptions,
  coverage:{sourceIds,recordIds:included.map(row=>row.id),runtimeIds,observedFrom:included.length?included.map(row=>row.observedAt).sort()[0]:null,observedThrough:included.length?included.map(row=>row.observedAt).sort().at(-1):null,
    period:clone(definition.period??null),selection:clone(definition.selection??{}),providerSourceIds:clone(definition.providerSourceIds),decisions:liveDecisions.map(retainedDecision),excluded,
    cumulativeViews:unique([...aggregateAllocations,...claimTotals,...claimChecks].map(row=>row.kind)),
    rules:clone(definition.rules),amountSemantics:'Original integer amounts stay separated by currency, chain, provider view and state. Cumulative claim and allocation views retain their original calculation scope.',
    intervalSemantics:definition.period?'Inclusive from; exclusive to. Rows without original period timestamps remain explicitly unassigned.':'Every selected original observation is retained through asOf.'}
 };
}
function comparisonKey(section,row){
 if(section==='events')return canonical({projectId:row.projectId,eventKey:row.eventKey,dedupId:row.dedupId,eventName:row.eventName});
 if(section==='pipelines')return canonical({projectId:row.projectId,eventId:row.eventId,dedupId:row.dedupId,eventName:row.eventName});
 return canonical({kind:row.kind,projectId:row.projectId,network:row.network,payoutId:row.payoutId??null,claimId:row.claimId??null,
  transactionHash:row.transactionHash??null,eventId:row.eventId??null,currency:row.currency??null,chainIdentifier:row.chainIdentifier??null,userIdentifier:row.userIdentifier??null,
  conversionId:row.conversionId??null,proof:row.proof??null,originalIdentity:row.originalIdentity??null});
}
export function compareFuulReconciliations(left,right){
 object(left,'Original baseline edition');object(right,'Original following edition');
 need(left.schema==='stellar-forge.fuul-reconciliation.v1'&&right.schema===left.schema,'INVALID_EDITION','Select original Fuul reconciliation data.');
 need(left.programme.projectId===right.programme.projectId&&left.programme.network===right.programme.network,'EDITION_SCOPE_MISMATCH','Compare editions of the same original project and network.');
 const sections={},all=['events','pipelines','allocations','movements','claims'];
 for(const name of all){
   const a=new Map((left[name]??[]).map(row=>[comparisonKey(name,row),row])),b=new Map((right[name]??[]).map(row=>[comparisonKey(name,row),row]));
   const added=[],removed=[],changed=[];
   for(const [key,row] of b)if(!a.has(key))added.push(row);else{
     const before=a.get(key),fields={};for(const field of ['status','deliveryStatus','stage','amount','proof','transactionHash','nativeSettlement','created','httpStatus','triggerStatuses']){
       if(canonical(before[field]??null)!==canonical(row[field]??null))fields[field]={before:clone(before[field]??null),after:clone(row[field]??null)};
     }
     if(Object.keys(fields).length)changed.push({key,beforeId:before.id,afterId:row.id,fields,sourceIds:unique([...(before.sourceIds??[]),...(row.sourceIds??[])])});
   }
   for(const [key,row] of a)if(!b.has(key))removed.push(row);
   sections[name]={added,removed,changed};
 }
 return {schema:'stellar-forge.fuul-reconciliation-comparison.v1',projectId:left.programme.projectId,network:left.programme.network,
  baseline:{programme:clone(left.programme),asOf:left.asOf,period:clone(left.coverage?.period??null)},following:{programme:clone(right.programme),asOf:right.asOf,period:clone(right.coverage?.period??null)},
  sections,summary:Object.fromEntries(Object.entries(sections).map(([key,value])=>[key,{added:value.added.length,removed:value.removed.length,changed:value.changed.length}]))};
}
function escaped(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function csv(value){
 let text=typeof value==='string'?value:value===null||value===undefined?'':JSON.stringify(value);
 if(/^[=+@\t\r]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
function reportData(edition,projectId,userIdentifier){
 need(edition.schema==='stellar-forge.fuul-reconciliation.v1','INVALID_EDITION','Select original Fuul reconciliation data.');
 const project=projectId??edition.programme.projectId;need(project===edition.programme.projectId,'REPORT_SCOPE_MISMATCH','The selected report project differs from its edition.');
 if(userIdentifier!==undefined&&userIdentifier!==null)text(userIdentifier,'Original report user',512);
 const belongs=row=>row.projectId===project&&(!userIdentifier||row.userIdentifier===userIdentifier);
 const data={schema:'stellar-forge.fuul-programme-report.v1',programme:clone(edition.programme),asOf:edition.asOf,period:clone(edition.coverage?.period??null),selection:clone(edition.coverage?.selection??{}),
  events:(edition.events??[]).filter(belongs).map(clone),pipelines:(edition.pipelines??[]).filter(belongs).map(clone),allocations:(edition.allocations??[]).filter(belongs).map(clone),
  movements:(edition.movements??[]).filter(belongs).map(clone),claims:(edition.claims??[]).filter(belongs).map(clone)};
 const visibleRecordIds=new Set(['events','pipelines','allocations','movements','claims'].flatMap(key=>data[key].flatMap(row=>row.recordIds??[])));
 data.exceptions=(edition.exceptions??[]).filter(row=>!userIdentifier||(row.recordIds??[]).some(id=>visibleRecordIds.has(id))).map(clone);
 const sourceIds=unique(['events','pipelines','allocations','movements','claims','exceptions'].flatMap(key=>data[key].flatMap(row=>row.sourceIds??[])));
 data.scope={projectId:project,userIdentifier:userIdentifier??null,sourceIds};
 data.summary={events:data.events.length,pipelines:data.pipelines.length,allocations:data.allocations.length,movements:data.movements.length,claims:data.claims.length,exceptions:data.exceptions.length,
  totals:{allocations:totalsByCurrency(data.allocations),movements:totalsByCurrency(data.movements),claims:totalsByCurrency(data.claims)}};
 return data;
}
/** Report members contain the selected customer views; whole source remains in workspace delivery. */
export function buildFuulReport({edition,programme,format='html',projectId,userIdentifier}){
 const data=reportData(edition,projectId,userIdentifier),label=programme?.definition?.name??programme?.name??'Fuul programme';
 if(format==='json')return {filename:'programme-reconciliation.json',contentType:'application/json; charset=utf-8',body:JSON.stringify(data,null,2)+'\n',scope:data.scope};
 const sections=['events','pipelines','allocations','movements','claims','exceptions'];
 const columns=['section','id','projectId','userIdentifier','eventName','dedupId','eventId','payoutId','claimId','currency','chainIdentifier','amount','currencyDecimals','displayAmount','status','deliveryStatus','stage','transactionHash','nativeSettlement','period','sourceIds','recordIds'];
 if(format==='csv'){
   const rows=[columns.map(csv).join(',')];for(const section of sections)for(const item of data[section])rows.push(columns.map(key=>csv(key==='section'?section:item[key])).join(','));
   return {filename:'programme-reconciliation.csv',contentType:'text/csv; charset=utf-8',body:rows.join('\r\n')+'\r\n',scope:data.scope};
 }
 need(format==='html','INVALID_REPORT_FORMAT','Select HTML, JSON or CSV.');
 const table=(items,fields)=>'<table><thead><tr>'+fields.map(field=>'<th>'+escaped(field)+'</th>').join('')+'</tr></thead><tbody>'+items.map(row=>'<tr>'+fields.map(field=>'<td>'+escaped(typeof row[field]==='object'&&row[field]!==null?JSON.stringify(row[field]):row[field])+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const body='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escaped(label)+'</title><style>body{font:14px system-ui,sans-serif;color:#181818;background:#fff;margin:36px;line-height:1.5}h1{font-size:26px}h2{font-size:19px;margin-top:32px}p,dl{max-width:1000px}table{border-collapse:collapse;width:100%;font-size:12px;margin:16px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f1f1f1}code{font-family:ui-monospace,monospace}.meta{color:#555}@media print{body{margin:12mm}thead{display:table-header-group}tr{break-inside:avoid}}</style><body><h1>'+escaped(label)+'</h1><p class="meta">Original project '+escaped(data.programme.projectId)+' · '+escaped(data.programme.network)+' · edition '+escaped(data.asOf)+'</p><p>Programme version '+escaped(data.programme.version)+'; source selection '+escaped(data.programme.sha256)+'. '+(data.period?'Period '+escaped(data.period.from)+' through '+escaped(data.period.to)+' (exclusive). ':'')+(data.scope.userIdentifier?'User '+escaped(data.scope.userIdentifier)+'.':'Project report.')+'</p><p>Amounts retain their original integer units and selected currency precision. Allocation totals, movements, claim snapshots, and native settlements remain separately identified.</p>'+
  sections.map(section=>'<h2>'+escaped(section)+'</h2>'+table(data[section],section==='events'?['eventName','dedupId','userIdentifier','deliveryStatus','stage','eventId','sourceIds']:section==='pipelines'?['eventName','dedupId','created','httpStatus','triggerExecutions','payouts','movements','sourceIds']:section==='exceptions'?['code','message','details','sourceIds']:['kind','userIdentifier','currency','amount','displayAmount','status','transactionHash','nativeSettlement','period','sourceIds'])).join('')+
  '<h2>Original source references</h2><p>'+data.scope.sourceIds.map(escaped).join('<br>')+'</p></body></html>';
 return {filename:'programme-reconciliation.html',contentType:'text/html; charset=utf-8',body,scope:data.scope};
}
