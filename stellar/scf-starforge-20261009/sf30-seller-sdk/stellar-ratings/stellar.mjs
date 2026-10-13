// MIT. Original Stellar SDK 17.2.1 performs address, XDR and RPC decoding.
import {loadRatingsStellar} from './runtime.mjs';
import {RatingsError,need,clone,canonical,sha256,text,object,list,parseRatingsJSON,ratingsNetwork,stellarAddress,safeInteger,jsonNative,formatUnits,integerText} from './lossless-json.mjs';

const TYPE={type:'object',additionalProperties:false},STRING={type:'string',minLength:1};
const LEDGER={type:'integer',minimum:1,maximum:4294967295};
const ACCOUNT={type:'string',pattern:'^G[A-Z2-7]{55}$'},CONTRACT={type:'string',pattern:'^C[A-Z2-7]{55}$'};
const ASSET_FIELDS={assetType:{type:'string',enum:['native','credit','contract']},assetCode:STRING,assetIssuer:ACCOUNT,contractId:CONTRACT};
const MAXIMUM_BODY=128*1024*1024;
export const RATINGS_STELLAR_CATALOG=[
 {kind:'network',label:'Original Stellar network',filtersSchema:{...TYPE,properties:{}},recordsPath:'/result'},
 {kind:'health',label:'Original retained ledger range',filtersSchema:{...TYPE,properties:{}},recordsPath:'/result'},
 {kind:'latest-ledger',label:'Latest original ledger',filtersSchema:{...TYPE,properties:{}},recordsPath:'/result'},
 {kind:'transaction',label:'Original transaction and result XDR',filtersSchema:{...TYPE,properties:{hash:{type:'string',pattern:'^[0-9a-fA-F]{64}$'}},required:['hash']},recordsPath:'/result'},
 {kind:'ledger-entries',label:'Original ledger entry XDR',filtersSchema:{...TYPE,properties:{keys:{type:'array',minItems:1,maxItems:200,items:STRING}},required:['keys']},recordsPath:'/result/entries'},
 {kind:'contract-instance',label:'Installed original contract instance',filtersSchema:{...TYPE,properties:{contractId:CONTRACT},required:['contractId']},recordsPath:'/result/entries'},
 {kind:'asset-contract',label:'Derived asset contract and executable',filtersSchema:{...TYPE,properties:ASSET_FIELDS},recordsPath:'/result/entries'},
 {kind:'contract-metadata',label:'Original read-only token metadata',filtersSchema:{...TYPE,properties:{...ASSET_FIELDS,simulationAccount:ACCOUNT},required:['contractId']},recordsPath:'/result'},
 {kind:'contract-balance',label:'Original read-only contract token balance',filtersSchema:{...TYPE,properties:{...ASSET_FIELDS,account:{type:'string',pattern:'^[GC][A-Z2-7]{55}$'},decimals:{type:'integer',minimum:0,maximum:255},simulationAccount:ACCOUNT},required:['contractId','account']},recordsPath:'/result'},
 {kind:'events',label:'Original selected asset and contract events',filtersSchema:{...TYPE,properties:{
  contractIds:{type:'array',minItems:1,maxItems:5,items:CONTRACT},startLedger:LEDGER,endLedger:LEDGER,
  assets:{type:'array',maxItems:5,items:{type:'object'}},from:{type:'string',format:'date-time'},to:{type:'string',format:'date-time'}
 },required:['contractIds','startLedger']},recordsPath:'/result/events',pagination:'original-cursor',maximumPageSize:10000}
];
function runtimeOptions(connection){return connection.runtime??{installationDirectory:connection.installationDirectory,runtimeDirectory:connection.runtimeDirectory,expectedManifestSha256:connection.expectedManifestSha256};}
function headerMap(input={}){
 object(input,'Private RPC headers');const result={};
 for(const [name,value] of Object.entries(input)){need(/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name)&&typeof value==='string'&&!/[\r\n]/.test(value),'INVALID_CONNECTION','A private RPC header is malformed.');result[name]=value;}
 return result;
}
export function describeRatingsStellarSource(connection){
 object(connection,'Stellar connection');const network=ratingsNetwork(connection.network);
 let url;try{url=new URL(connection.rpcUrl??(network.network==='stellar:testnet'?'https://soroban-testnet.stellar.org':undefined));}catch{throw new RatingsError('INVALID_CONNECTION','Select an original Stellar RPC URL.');}
 need((url.protocol==='https:'||url.protocol==='http:'&&connection.allowHttp===true)&&!url.username&&!url.password&&!url.hash,'INVALID_CONNECTION','Use the selected RPC transport without embedded username/password.');
 const contracts=(connection.contracts??[]).map(item=>typeof item==='string'?{address:stellarAddress(item,'Contract',{kind:'contract'})}:{...clone(object(item,'Contract selection')),address:stellarAddress(item.address??item.contractId,'Contract',{kind:'contract'})});
 need(new Set(contracts.map(item=>item.address)).size===contracts.length,'INVALID_CONNECTION','Each selected contract must have one original identity.');
 const scope={provider:'stellar',network:network.network,origin:url.origin,accountScope:connection.accountScope??null,contracts};
 return {...scope,id:sha256(scope),sourceScope:sha256(scope),authType:Object.keys(connection.headers??{}).length?'host-headers':'public',sdkVersion:'17.2.1'};
}
function configured(connection){
 const descriptor=describeRatingsStellarSource(connection);
 return {descriptor,network:ratingsNetwork(descriptor.network),url:new URL(connection.rpcUrl??'https://soroban-testnet.stellar.org'),headers:headerMap(connection.headers),timeout:safeInteger(connection.timeoutMs??30000,'RPC timeout',{minimum:1,maximum:300000}),maximumBytes:safeInteger(connection.maximumResponseBytes??MAXIMUM_BODY,'RPC byte limit',{minimum:1024,maximum:MAXIMUM_BODY}),runtime:runtimeOptions(connection)};
}
function asAsset(stellar,definition,network){
 const value=object(definition,'Original asset selection'),assetType=value.assetType??(value.assetIssuer?'credit':value.assetCode==='XLM'?'native':value.contractId?'contract':null);
 if(assetType==='contract'){
  const contractId=stellarAddress(value.contractId,'Token contract',{kind:'contract'});
  return {...clone(value),assetType,contractId,assetKey:network.network+'/contract:'+contractId,assetCode:value.assetCode??null,assetIssuer:null,decimals:value.decimals===undefined||value.decimals===null?null:safeInteger(value.decimals,'Token decimals',{minimum:0,maximum:255})};
 }
 need(assetType==='native'||assetType==='credit','INVALID_ASSET','Select the original native or issued Stellar asset.');
 let native;
 if(assetType==='native'){need(value.assetCode===undefined||value.assetCode===null||value.assetCode==='XLM','INVALID_ASSET','The native Stellar asset is XLM.');native=stellar.Asset.native();}
 else native=new stellar.Asset(text(value.assetCode,'Asset code',12),stellarAddress(value.assetIssuer,'Asset issuer',{kind:'account'}));
 const contractId=native.contractId(network.passphrase);
 if(value.contractId??value.sacContractId)need((value.contractId??value.sacContractId)===contractId,'ASSET_CONTRACT_MISMATCH','The selected SAC does not derive from the original network and asset.');
 const assetCode=assetType==='native'?'XLM':value.assetCode,assetIssuer=assetType==='native'?null:value.assetIssuer;
 return {...clone(value),assetType,assetCode,assetIssuer,decimals:7,contractId,assetKey:network.network+'/'+(assetType==='native'?'XLM':assetCode+':'+assetIssuer)};
}
function distinctAssetContracts(assets){
 const contracts=new Map();
 for(const asset of assets){const prior=contracts.get(asset.contractId);need(!prior,'DUPLICATE_ASSET_CONTRACT','A Stellar asset and its derived SAC must be one registry asset.',{contractId:asset.contractId,assetIds:[prior?.id??null,asset.id??null],assetKeys:[prior?.assetKey??null,asset.assetKey]});contracts.set(asset.contractId,asset);}
 return assets;
}
export async function prepareRatingsAssets({registry,runtime={}}){
 const original=registry?.definition??registry;object(original,'Asset registry');const network=ratingsNetwork(original.network),loaded=await loadRatingsStellar(runtime??{});
 const assets=distinctAssetContracts((original.assets??[]).map(item=>asAsset(loaded.stellar,{...item,contractId:item.contractId??item.sacContractId},network)));
 return {network:network.network,assets,runtime:clone(loaded.runtime)};
}
export async function prepareRatingsAccounts({addresses,registry,runtime={}}){
 const original=registry?.definition??registry;object(original,'Asset registry');const network=ratingsNetwork(original.network);
 const loaded=await loadRatingsStellar(runtime??{}),stellar=loaded.stellar;
 need(stellar.StrKey&&stellar.MuxedAccount&&stellar.Asset&&stellar.Contract,'NATIVE_SDK_MISMATCH','The retained original Stellar SDK is incomplete.');
 list(addresses,'Wallet addresses');need(addresses.length>0&&addresses.length<=10000,'INVALID_ACCOUNTS','Select one to 10000 original wallet addresses.');
 const enabledContracts=new Set((original.contractAccounts??[]).map(item=>typeof item==='string'?item:item.account??item.address).filter(Boolean)),inputs=[],accounts=[];
 for(const row of addresses){
  const selected=typeof row==='string'?{input:row}:object(row,'Wallet address'),input=text(selected.input??selected.address??selected.account,'Wallet address',128);
  let account,type,muxedId=null;
  if(stellar.StrKey.isValidEd25519PublicKey(input)){account=input;type='G';}
  else if(stellar.StrKey.isValidMed25519PublicKey(input)){
   const muxed=stellar.MuxedAccount.fromAddress(input,'0');account=muxed.baseAccount().accountId();muxedId=muxed.id();type='M';
  }else if(stellar.StrKey.isValidContract(input)){
   account=input;type='C';need(enabledContracts.has(account)||selected.enabled===true||selected.contractEnabled===true,'CONTRACT_ACCOUNT_NOT_ENABLED','Contract wallet balances require explicit selection.',{account});
  }else throw new RatingsError('INVALID_STELLAR_ADDRESS','The original Stellar SDK rejected this account or muxed address.',{input});
  inputs.push({input,type,account,muxedId,enabled:true});
  if(!accounts.some(item=>item.account===account))accounts.push({account,type:type==='C'?'C':'G',inputs:[input],muxedIds:muxedId?[muxedId]:[]});
  else{const existing=accounts.find(item=>item.account===account);if(!existing.inputs.includes(input))existing.inputs.push(input);if(muxedId&&!existing.muxedIds.includes(muxedId))existing.muxedIds.push(muxedId);}
 }
 const assets=distinctAssetContracts((original.assets??[]).map(item=>asAsset(stellar,{...item,contractId:item.contractId??item.sacContractId},network)));
 return {schema:'stellar-forge.ratings-wallet-accounts.v1',network:network.network,inputs,accounts,assets,runtime:clone(loaded.runtime)};
}
function signalScope(signal,timeout){
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}
 const timer=setTimeout(()=>controller.abort(new RatingsError('RPC_TIMEOUT','The original RPC exceeded its selected deadline.')),timeout);
 return {signal:controller.signal,close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
}
function publicHeaders(value){return Object.fromEntries([...value.entries()].filter(([name])=>!/^(set-cookie|authorization|proxy-authorization)$/i.test(name)));}
function publicError(error){return error instanceof RatingsError?{code:error.code,message:error.message,details:jsonNative(error.details)}:{code:'NATIVE_RPC_ERROR',message:'The original Stellar SDK could not complete this read.'};}
function rows(value,kind){
 if(!value||typeof value!=='object'||value.error)return [];
 const result=value.result;if(result===undefined)return [];
 if(kind==='events')return Array.isArray(result.events)?result.events:[];
 if(['ledger-entries','contract-instance','asset-contract','account-entry'].includes(kind))return Array.isArray(result.entries)?result.entries:[];
 return [result];
}
function wireKind(method){return {getNetwork:'network',getHealth:'health',getLatestLedger:'latest-ledger',getLedgerEntries:'ledger-entries',getEvents:'events',getTransaction:'transaction',simulateTransaction:'simulation'}[method]??method;}
async function session(connection,{signal}={}){
 const selected=configured(connection),loaded=await loadRatingsStellar(selected.runtime);
 const server=new loaded.stellar.rpc.Server(selected.url.href,{allowHttp:connection.allowHttp===true,headers:selected.headers,timeout:selected.timeout});
 need(server.httpClient?.defaults,'NATIVE_SDK_MISMATCH','The selected original RPC client lacks its native HTTP adapter.');
 const exchanges=[];let context=null;
 server.httpClient.defaults.adapter=async config=>{
  const body=typeof config.data==='string'?Buffer.from(config.data):Buffer.from(JSON.stringify(config.data));
  let rpc;try{rpc=JSON.parse(body.toString('utf8'));}catch{throw new RatingsError('INVALID_NATIVE_REQUEST','The original SDK produced an invalid RPC request.');}
  const kind=context?.kind??wireKind(rpc.method),observedAt=new Date().toISOString();
  const exchange={kind,request:{method:'POST',origin:selected.descriptor.origin,transport:'selected-rpc',body:rpc,bodyText:body.toString('utf8'),bodySha256:sha256(body),...(context?.selection?{nativeSelection:clone(context.selection)}:{})},response:null,runtime:clone(loaded.runtime)};
  const deadline=signalScope(signal,Math.min(selected.timeout,Number(config.timeout)||selected.timeout));
  try{
   const response=await fetch(selected.url,{method:'POST',headers:{...selected.headers,...(config.headers??{}),'content-type':'application/json'},body,redirect:'manual',signal:deadline.signal});
   const parts=[];let bytes=0,complete=true,error=null;
   try{if(response.body)for await(const part of response.body){const chunk=Buffer.from(part),remaining=selected.maximumBytes-bytes;if(chunk.length>remaining){if(remaining>0){parts.push(chunk.subarray(0,remaining));bytes+=remaining;}complete=false;error={code:'RPC_RESPONSE_TOO_LARGE',message:'The original response exceeded its selected byte limit.'};break;}parts.push(chunk);bytes+=chunk.length;}}
   catch{complete=false;error={code:deadline.signal.aborted?'INTERRUPTED':'RPC_RESPONSE_INTERRUPTED',message:'The original RPC body ended before completion.'};}
   exchange.response={status:response.status,statusText:response.statusText,headers:publicHeaders(response.headers),body:Buffer.concat(parts,bytes),bodyComplete:complete,observedAt,finishedAt:new Date().toISOString()};
   if(error)exchange.error=error;
   else if(response.status<200||response.status>=300)exchange.error={code:response.status===429?'RPC_RATE_LIMITED':'RPC_HTTP_ERROR',message:'The original RPC returned HTTP '+response.status+'.'};
  }catch{exchange.response={status:0,headers:{},body:Buffer.alloc(0),bodyComplete:false,observedAt,finishedAt:new Date().toISOString()};exchange.error={code:deadline.signal.aborted?'INTERRUPTED':'RPC_TRANSPORT_ERROR',message:'The original RPC did not return a complete response.'};}
  finally{deadline.close();}
  exchanges.push(exchange);if(exchange.error)throw new RatingsError(exchange.error.code,exchange.error.message);
  let parsed;
  try{parsed=JSON.parse(exchange.response.body.toString('utf8'));exchange.records=rows(parseRatingsJSON(exchange.response.body).value,kind);}
  catch{exchange.error={code:'INVALID_RPC_JSON',message:'The original RPC body is not valid JSON.'};throw new RatingsError(exchange.error.code,exchange.error.message);}
  exchange.recordsPath=RATINGS_STELLAR_CATALOG.find(item=>item.kind===kind)?.recordsPath??'/result';
  if(parsed.error)exchange.error={code:'RPC_ERROR',message:'The original JSON-RPC response contains an error.',details:{rpcCode:parsed.error.code??null}};
  return {data:parsed,headers:exchange.response.headers,config,status:exchange.response.status,statusText:exchange.response.statusText??''};
 };
 async function selectedCall(kind,selection,fn){const previous=context;context={kind,selection};try{return await fn();}finally{context=previous;}}
 return {...loaded,selected,server,exchanges,selectedCall};
}
function filtersFor(request){
 const entry=RATINGS_STELLAR_CATALOG.find(item=>item.kind===request.kind);need(entry,'UNKNOWN_READ_KIND','Select an original Stellar read kind.');
 const filters=clone(request.filters??{});object(filters,'Native Stellar filters');
 for(const key of Object.keys(filters))need(Object.hasOwn(entry.filtersSchema.properties,key),'INVALID_FILTER','This native read does not accept the selected filter.',{kind:request.kind,key});
 for(const key of entry.filtersSchema.required??[])need(filters[key]!==undefined&&filters[key]!==null,'MISSING_FILTER','The native read requires '+key+'.');
 return {filters,entry};
}
export function ratingsCursorPosition(cursor){
 if(typeof cursor!=='string'||!/^\d{1,32}-\d{1,20}$/.test(cursor))return null;
 const [toidText,eventText]=cursor.split('-'),toid=BigInt(toidText),event=BigInt(eventText);if(toid>0xffffffffffffffffn||event>0xffffffffn)return null;
 return {ledger:Number(toid>>32n),terminal:(toid&0xffffffffn)===0xffffffffn&&event===0xffffffffn};
}
function eventContinuation(request,filters,response){
 const raw=parseRatingsJSON(response.body).value,result=raw.result;
 need(typeof result?.cursor==='string'&&result.cursor,'INVALID_NATIVE_CURSOR','The original event response did not return a cursor.');
 const position=ratingsCursorPosition(result.cursor),end=filters.endLedger??null;
 const overrun=end!==null&&(result.events??[]).some(item=>Number(item.ledger)>=end);
 const done=end!==null&&(overrun||position&&(position.ledger>=end||position.ledger===end-1&&position.terminal));
 return {done:Boolean(done),next:done?null:{kind:'events',filters:clone(filters),pageSize:request.pageSize??100,cursor:result.cursor},cursor:result.cursor,scannedCursorLedger:position?.ledger??null,scannedLedgerComplete:position?.terminal??false,selectedEndLedger:end,waiting:!done&&result.cursor===request.cursor};
}
function contractEntryValue(entry){
 const value=entry.val;
 need(value&&value.type==='contractData','INVALID_CONTRACT_INSTANCE','The original contract footprint did not return contract data.');
 const contractData=value.contractData;
 need(contractData?.val?.type==='scvContractInstance','INVALID_CONTRACT_INSTANCE','The original contract data is not a contract instance.');
 return contractData.val.instance;
}
async function inspectContract(native,selection,{kind='contract-instance'}={}){
 const contractId=stellarAddress(selection.contractId,'Token contract',{kind:'contract'}),key=new native.stellar.Contract(contractId).getFootprint();
 const result=await native.selectedCall(kind,{...selection,contractId},()=>native.server.getLedgerEntries(key));
 need(result.entries.length===1,'CONTRACT_NOT_INSTALLED','The selected contract instance is absent from the current native ledger.',{contractId});
 const instance=contractEntryValue(result.entries[0]),executable=instance.executable;
 const actualType=executable.type,stellarAsset=actualType==='contractExecutableStellarAsset';
 if(selection.assetType==='native'||selection.assetType==='credit')need(stellarAsset,'ASSET_EXECUTABLE_MISMATCH','The derived asset contract does not have the original Stellar asset executable.',{contractId,executable:actualType});
 const original=native.exchanges.at(-1);
 return {contractId,executable:actualType,stellarAsset,ledger:result.latestLedger??null,sourceBodySha256:sha256(original.response.body)};
}
function simulationValue(stellar,result){
 need(!stellar.rpc.Api.isSimulationError(result),'CONTRACT_READ_FAILED','The original read-only contract simulation returned an error.',{error:result?.error??null});
 need(stellar.rpc.Api.isSimulationSuccess(result)&&result.result?.retval,'CONTRACT_READ_FAILED','The original simulation did not return a token value.');
 return stellar.scValToNative(result.result.retval);
}
async function readOnlyCall(native,{contractId,method,args,simulationAccount,selection,kind}){
 const accountId=stellarAddress(simulationAccount,'Read-only simulation source',{kind:'account'});
 const account=await native.selectedCall('account-entry',{account:accountId,purpose:'read-only-simulation'},()=>native.server.getAccount(accountId));
 const transaction=new native.stellar.TransactionBuilder(account,{fee:'100',networkPassphrase:native.selected.network.passphrase})
  .addOperation(new native.stellar.Contract(contractId).call(method,...args)).setTimeout(300).build();
 const result=await native.selectedCall(kind,{...selection,contractId,method,simulationAccount:accountId,readOnly:true,transactionXdr:transaction.toXdr()},()=>native.server.simulateTransaction(transaction));
 return {value:simulationValue(native.stellar,result),result};
}
function simulationAddress(connection,filters,asset){
 const selected=filters.simulationAccount??connection.simulationAccount??(asset.assetType==='credit'?asset.assetIssuer:null);
 need(selected,'SIMULATION_ACCOUNT_REQUIRED','Select an existing public account for the original read-only contract simulation.',{contractId:asset.contractId});
 return stellarAddress(selected,'Simulation source',{kind:'account'});
}
async function tokenRead(native,connection,filters,kind){
 const contractId=stellarAddress(filters.contractId,'Token contract',{kind:'contract'});
 const asset=asAsset(native.stellar,{...filters,assetType:filters.assetType??(filters.assetIssuer?'credit':'contract')},native.selected.network);
 const proof=await inspectContract(native,asset);
 const selected={...asset,contractId,verifiedAsset:proof.stellarAsset&&(asset.assetType==='native'||asset.assetType==='credit'),contractProof:proof};
 const account=kind==='contract-balance'?stellarAddress(filters.account,'Selected token holder'):null;
 if(kind==='contract-balance'&&selected.verifiedAsset&&native.stellar.StrKey.isValidContract(account)){
  const originalAsset=asset.assetType==='native'?native.stellar.Asset.native():new native.stellar.Asset(asset.assetCode,asset.assetIssuer);
  const result=await native.selectedCall('contract-balance',{...selected,account,balanceMethod:'getSACBalance'},()=>native.server.getSACBalance(account,originalAsset,native.selected.network.passphrase));
  if(!result.balanceEntry)return {asset:selected,account,entryPresent:false,latestLedger:result.latestLedger};
  const amount=integerText(result.balanceEntry.amount,'Original SAC balance',{maximum:(1n<<127n)-1n});
  return {asset:selected,account,entryPresent:true,amountUnits:amount,amount:formatUnits(amount,7),decimals:7,...jsonNative(result)};
 }
 const simulationAccount=simulationAddress(connection,filters,asset),metadata={};
 if(asset.decimals===null||asset.assetType==='contract'||kind==='contract-metadata'){
  for(const method of kind==='contract-metadata'?['decimals','name','symbol']:['decimals']){
   const result=await readOnlyCall(native,{contractId,method,args:[],simulationAccount,selection:selected,kind:'contract-metadata'});
   metadata[method]=jsonNative(result.value);
  }
  if(metadata.decimals!==undefined)selected.decimals=safeInteger(metadata.decimals,'Original token decimals',{minimum:0,maximum:255});
  if(asset.decimals!==null&&metadata.decimals!==undefined)need(selected.decimals===asset.decimals,'TOKEN_DECIMALS_CHANGED','Original token precision differs from the selected registry.');
 }
 if(kind==='contract-metadata')return {asset:selected,metadata};
 const result=await readOnlyCall(native,{contractId,method:'balance',args:[new native.stellar.Address(account).toScVal()],simulationAccount,selection:{...selected,account,balanceMethod:'simulate-balance'},kind:'contract-balance'});
 const amount=integerText(typeof result.value==='bigint'?result.value.toString():result.value,'Original token balance',{maximum:(1n<<127n)-1n});
 return {asset:selected,account,entryPresent:true,amountUnits:amount,amount:formatUnits(amount,selected.decimals),decimals:selected.decimals};
}
export function openRatingsStellarSource(connection){
 const selected=configured(connection);
 return {descriptor:selected.descriptor,catalog:clone(RATINGS_STELLAR_CATALOG),describe(){return {descriptor:clone(selected.descriptor),catalog:clone(RATINGS_STELLAR_CATALOG)};},async read(request){
  object(request,'Original Stellar request');const {filters,entry}=filtersFor(request);
  const native=await session(connection,{signal:request.signal});let value=null,error=null,continuation={done:true,next:null};
  try{
   const network=await native.server.getNetwork();need(network.passphrase===selected.network.passphrase,'NETWORK_MISMATCH','The original RPC belongs to a different Stellar network.');
   if(request.kind==='network')value=network;
   else if(request.kind==='health')value=await native.server.getHealth();
   else if(request.kind==='latest-ledger')value=await native.server.getLatestLedger();
   else if(request.kind==='transaction'){
    need(/^[0-9a-fA-F]{64}$/.test(filters.hash),'INVALID_FILTER','Select the original transaction hash.');value=await native.server.getTransaction(filters.hash);
   }else if(request.kind==='ledger-entries'){
    list(filters.keys,'Original ledger keys');need(filters.keys.length>=1&&filters.keys.length<=200,'INVALID_FILTER','Select one to 200 original ledger keys.');
    value=await native.server.getLedgerEntries(...filters.keys.map(item=>native.stellar.xdr.LedgerKey.fromXdr(text(item,'Ledger key XDR',65536),'base64')));
   }else if(request.kind==='contract-instance')value=await inspectContract(native,{contractId:filters.contractId});
   else if(request.kind==='asset-contract'){
    const asset=asAsset(native.stellar,filters,selected.network);value={asset,proof:await inspectContract(native,asset,{kind:'asset-contract'})};
   }else if(request.kind==='contract-balance'||request.kind==='contract-metadata')value=await tokenRead(native,connection,filters,request.kind);
   else if(request.kind==='events'){
    const contractIds=list(filters.contractIds,'Original contract filters').map(item=>stellarAddress(item,'Event contract',{kind:'contract'}));
    need(contractIds.length>=1&&contractIds.length<=5&&new Set(contractIds).size===contractIds.length,'INVALID_FILTER','Select one to five distinct original contract addresses.');
    filters.startLedger=safeInteger(filters.startLedger,'Start ledger',{minimum:1,maximum:0xffffffff});
    if(filters.endLedger!==undefined&&filters.endLedger!==null){filters.endLedger=safeInteger(filters.endLedger,'Exclusive end ledger',{minimum:1,maximum:0xffffffff});need(filters.endLedger>filters.startLedger,'INVALID_RANGE','The selected event range must increase.');}
    const health=await native.server.getHealth(),position=request.cursor?ratingsCursorPosition(request.cursor):null;
    if(request.cursor)need(position,'INVALID_NATIVE_CURSOR','Use an unchanged native event cursor.');
    const required=position?position.ledger+(position.terminal?1:0):filters.startLedger;
    need(required>=safeInteger(health.oldestLedger,'Original RPC oldest ledger',{minimum:1,maximum:0xffffffff}),'RETENTION_GAP','The original next required ledger is outside this RPC retention.',{requiredLedger:required,oldestLedger:Number(health.oldestLedger),cursor:request.cursor??null});
    const assets=[];
    for(const item of filters.assets??[]){
     const asset=asAsset(native.stellar,item,selected.network);need(contractIds.includes(asset.contractId),'ASSET_CONTRACT_MISMATCH','The selected asset is outside this original event filter.');
     const proof=await inspectContract(native,asset);
     if(asset.assetType==='contract'){
      const simulationAccount=simulationAddress(connection,{},asset),observed=await readOnlyCall(native,{contractId:asset.contractId,method:'decimals',args:[],simulationAccount,selection:{...asset,contractProof:proof},kind:'contract-metadata'});
      const precision=safeInteger(jsonNative(observed.value),'Original token decimals',{minimum:0,maximum:255});
      if(asset.decimals!==null)need(asset.decimals===precision,'TOKEN_DECIMALS_CHANGED','The original token precision differs from the registry.');
      asset.decimals=precision;
     }
     assets.push({...asset,verifiedAsset:proof.stellarAsset&&(asset.assetType==='native'||asset.assetType==='credit'),contractProof:proof});
    }
    const query={filters:[{type:'contract',contractIds}],limit:safeInteger(request.pageSize??100,'Original event page size',{minimum:1,maximum:10000})};
    if(request.cursor)query.cursor=text(request.cursor,'Original cursor',256);else{query.startLedger=filters.startLedger;if(filters.endLedger!==undefined&&filters.endLedger!==null)query.endLedger=filters.endLedger;}
    value=await native.selectedCall('events',{startLedger:filters.startLedger,endLedger:filters.endLedger??null,from:filters.from??null,to:filters.to??null,contractIds,assets},()=>native.server.getEvents(query));
    continuation=eventContinuation(request,filters,native.exchanges.at(-1).response);
   }
  }catch(cause){error=publicError(cause);}
  const index=native.exchanges.findLastIndex(item=>item.kind===request.kind),main=index>=0?native.exchanges[index]:{kind:request.kind,request:{method:'POST',origin:selected.descriptor.origin,kind:request.kind,filters:clone(filters)},response:{status:0,headers:{},body:Buffer.alloc(0),bodyComplete:false,observedAt:new Date().toISOString()},records:[],recordsPath:entry.recordsPath,runtime:clone(native.runtime)};
  if(error)continuation={done:false,next:{kind:request.kind,filters:clone(filters),pageSize:request.pageSize??100,...(request.cursor!==undefined?{cursor:clone(request.cursor)}:{})}};
  return {...main,kind:request.kind,descriptor:clone(selected.descriptor),nativeView:jsonNative(value),runtime:clone(native.runtime),records:main.records??[],recordsPath:entry.recordsPath,continuation,exchanges:native.exchanges.filter((_,i)=>i!==index),...(error?{error}:{})};
 }};
}
function fromScVal(stellar,value){return stellar.scValToNative(stellar.xdr.ScVal.fromXdr(text(value,'Original ScVal XDR',1024*1024),'base64'));}
function nativeMap(value){
 if(value instanceof Map){const result={};for(const [key,item] of value)if(typeof key==='string')result[key]=item;return result;}
 return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
}
function originalEventAmount(stellar,event){
 const value=fromScVal(stellar,event.value),map=nativeMap(value),amount=typeof value==='bigint'?value:map?.amount;
 need(typeof amount==='bigint','UNKNOWN_TOKEN_EVENT','The original event does not expose an i128 amount.');
 return {amount:amount.toString(),toMuxedId:map?.to_muxed_id===undefined?null:integerText(typeof map.to_muxed_id==='bigint'?map.to_muxed_id.toString():map.to_muxed_id,'Original muxed ID',{maximum:(1n<<64n)-1n}),value};
}
function tokenProjection(stellar,event,selection,network){
 const topics=(event.topic??[]).map(value=>fromScVal(stellar,value)),symbol=topics[0],contractId=event.contractId??null;
 const assetDefinition=(selection.assets??[]).find(item=>item.contractId===contractId),asset=assetDefinition?asAsset(stellar,assetDefinition,network):null;
 const ledger=safeInteger(event.ledger,'Original event ledger',{minimum:1,maximum:0xffffffff}),occurredAt=event.ledgerClosedAt??null;
 const selected=!(selection.startLedger!==undefined&&selection.startLedger!==null&&ledger<Number(selection.startLedger)||selection.endLedger!==undefined&&selection.endLedger!==null&&ledger>=Number(selection.endLedger)||selection.from&&occurredAt&&Date.parse(occurredAt)<Date.parse(selection.from)||selection.to&&occurredAt&&Date.parse(occurredAt)>=Date.parse(selection.to));
 const originalId=text(event.id,'Original event ID',128),nativeToid=/^\d+-\d+$/.test(originalId)?BigInt(originalId.split('-')[0]).toString():null;
 const base={entity:'token-event',eventId:originalId,contractId,ledger,occurredAt,transactionHash:event.txHash??event.transactionHash??null,operationId:nativeToid,successful:event.inSuccessfulContractCall===true&&event.type==='contract',selected,topics:jsonNative(topics),flows:[],assetKey:asset?.assetKey??null,assetId:asset?.id??null,verifiedAsset:assetDefinition?.verifiedAsset===true&&assetDefinition?.contractProof?.stellarAsset===true,contractProof:clone(assetDefinition?.contractProof??null)};
 if(!asset||asset.decimals===null||!['transfer','mint','burn','clawback'].includes(symbol))return {...base,unsupported:!asset?'UNMAPPED_CONTRACT':asset.decimals===null?'TOKEN_DECIMALS_REQUIRED':'UNRECOGNIZED_EVENT',value:jsonNative(fromScVal(stellar,event.value))};
 try{
  const amount=originalEventAmount(stellar,event);need(BigInt(amount.amount)>=0n,'UNKNOWN_TOKEN_EVENT','A transfer event amount must be nonnegative.');
  let from=null,to=null;
  if(symbol==='transfer'){from=stellarAddress(topics[1],'Original transfer sender');to=stellarAddress(topics[2],'Original transfer receiver');}
  else if(symbol==='mint')to=stellarAddress(topics[1],'Original mint receiver');
  else from=stellarAddress(topics[1],'Original burn/clawback source');
  return {...base,eventType:symbol,value:jsonNative(amount.value),toMuxedId:amount.toMuxedId,flows:[{assetKey:asset.assetKey,assetType:asset.assetType,assetCode:asset.assetCode,assetIssuer:asset.assetIssuer,contractId,decimals:asset.decimals,amountUnits:amount.amount,amount:formatUnits(amount.amount,asset.decimals),from,to,kind:symbol,leg:'token-event'}]};
 }catch(cause){return {...base,unsupported:cause.code??'UNRECOGNIZED_TOKEN_EVENT',value:jsonNative(fromScVal(stellar,event.value))};}
}
function rawSimulationValue(stellar,result){
 need(!result.error,'CONTRACT_READ_FAILED','The original read-only simulation contains an error.');
 const item=result.results?.[0];need(item?.xdr,'CONTRACT_READ_FAILED','The original simulation does not contain a result value.');
 return fromScVal(stellar,item.xdr);
}
/** Re-project unchanged source bytes through the retained original XDR classes; no network reads. */
export async function decodeRatingsStellarSource({kind,body,rawBody,request={},runtime={},network,contracts=[]}){
 const bytes=Buffer.isBuffer(body??rawBody)?body??rawBody:Buffer.from(body??rawBody);
 const parsed=parseRatingsJSON(bytes).value,loaded=await loadRatingsStellar(runtime??{}),stellar=loaded.stellar,selectedNetwork=ratingsNetwork(network),selection=request.nativeSelection??{},out=[];
 if(parsed.error||parsed.result===undefined)return {records:[],runtime:clone(loaded.runtime)};
 const result=parsed.result;
 if(kind==='events'){
  need(Array.isArray(result.events),'INVALID_NATIVE_SOURCE','The retained original response is not an event page.');
  const eventSelection={...selection,assets:selection.assets??contracts};
  for(const event of result.events)out.push({original:clone(event),projection:tokenProjection(stellar,event,eventSelection,selectedNetwork)});
 }else if(kind==='contract-balance'){
  const asset=asAsset(stellar,selection,selectedNetwork),account=stellarAddress(selection.account,'Original token holder');
  const base={account,assetKey:asset.assetKey,assetType:asset.assetType,assetCode:asset.assetCode,assetIssuer:asset.assetIssuer,contractId:asset.contractId,decimals:asset.decimals,view:asset.assetType==='contract'?'contract':'sac',verifiedAsset:selection.verifiedAsset===true&&selection.contractProof?.stellarAsset===true,contractProof:clone(selection.contractProof??null),ledger:result.latestLedger??null,asOf:request.observedAt??null,balanceMethod:selection.balanceMethod??'simulate-balance'};
  let value,extra={};
  if(selection.balanceMethod==='getSACBalance'){
   need(base.verifiedAsset&&stellar.StrKey.isValidContract(account)&&Array.isArray(result.entries),'INVALID_SAC_SOURCE','Retained SAC balances must bind the original asset, contract holder and ledger-entry response.');
   if(result.entries.length===0){out.push({original:clone(result),projection:{...base,entity:'holding-observation',entryPresent:false,complete:false,status:'ENTRY_ABSENT',amountUnits:null,amount:null}});return {records:out,runtime:clone(loaded.runtime)};}
   need(result.entries.length===1,'INVALID_SAC_SOURCE','One original SAC balance key must return at most one ledger entry.');
   const original=result.entries[0],key=stellar.xdr.LedgerKey.fromXdr(text(original.key,'Original balance key XDR',1024*1024),'base64');
   need(key.type==='contractData','INVALID_SAC_SOURCE','The original SAC balance key is not contract data.');
   const keyData=key.value,keyContract=stellar.Address.fromScAddress(keyData.contract).toString(),keyParts=stellar.scValToNative(keyData.key);
   need(keyContract===asset.contractId&&Array.isArray(keyParts)&&keyParts[0]==='Balance'&&keyParts[1]===account,'SAC_BALANCE_SCOPE_MISMATCH','The retained balance entry belongs to a different asset or holder.');
   const entry=stellar.xdr.LedgerEntryData.fromXdr(text(original.xdr,'Original balance entry XDR',1024*1024),'base64');
   need(entry.type==='contractData','INVALID_SAC_SOURCE','The original balance is not a contract-data entry.');
   const balance=nativeMap(stellar.scValToNative(entry.value.val));need(balance&&typeof balance.amount==='bigint','INVALID_SAC_SOURCE','The original SAC balance map has no exact amount.');
   value=balance.amount;extra={entryPresent:true,authorized:balance.authorized,clawback:balance.clawback,lastModifiedLedgerSeq:original.lastModifiedLedgerSeq??null,liveUntilLedgerSeq:original.liveUntilLedgerSeq??null};
  }else value=rawSimulationValue(stellar,result);
  const amount=integerText(typeof value==='bigint'?value.toString():value,'Original token balance',{maximum:(1n<<127n)-1n});
  need(asset.decimals!==null,'TOKEN_DECIMALS_REQUIRED','The retained original token read needs its observed precision.');
  out.push({original:clone(result),projection:{...base,...extra,entity:'holding',entryPresent:true,amountUnits:amount,amount:formatUnits(amount,asset.decimals),complete:true}});
 }else if(kind==='contract-metadata'){
  const value=rawSimulationValue(stellar,result);out.push({original:clone(result),projection:{entity:'token-metadata',contractId:selection.contractId??null,method:selection.method??null,value:jsonNative(value),ledger:result.latestLedger??null,assetKey:selection.assetKey??null,contractProof:clone(selection.contractProof??null)}});
 }else if(['asset-contract','contract-instance'].includes(kind)){
  for(const original of result.entries??[]){
   const decoded=stellar.xdr.LedgerEntryData.fromXdr(text(original.xdr,'Original ledger entry XDR',1024*1024),'base64'),instance=contractEntryValue({val:decoded});
   const asset=selection.assetType?asAsset(stellar,selection,selectedNetwork):null,stellarAsset=instance.executable.type==='contractExecutableStellarAsset';
   out.push({original:clone(original),projection:{entity:'contract-instance',contractId:selection.contractId??asset?.contractId??null,assetKey:asset?.assetKey??null,assetType:asset?.assetType??null,executable:instance.executable.type,verifiedAsset:Boolean(asset&&asset.assetType!=='contract'&&stellarAsset),ledger:result.latestLedger??null,sourceBodySha256:sha256(bytes)}});
  }
 }else{
  const values=rows(parsed,kind);for(const original of values)out.push({original:clone(original),projection:{entity:kind==='network'?'network':kind==='health'?'retention':kind==='latest-ledger'?'ledger':'native-record',nativeKind:kind,ledger:original?.sequence??original?.latestLedger??original?.ledger??null,passphrase:kind==='network'?original.passphrase??null:undefined}});
 }
 return {records:out,runtime:clone(loaded.runtime)};
}

/** Decode the original removed claimable-balance entry from retained transaction metadata. */
export async function decodeRatingsClaimableBalanceRemoval({row,network,runtime={}}){
 object(row,'Original claimable-balance operation');
 const balanceId=text(row.balance_id,'Original claimable balance ID',80).toLowerCase();
 need(/^[0-9a-f]{72}$/.test(balanceId),'INVALID_CLAIMABLE_BALANCE','Retain the original complete claimable balance ID.');
 const xdr=row.transaction?.result_meta_xdr??row.result_meta_xdr;
 need(typeof xdr==='string'&&xdr.length,'TRANSACTION_META_REQUIRED','The original joined transaction metadata is required for the removed claimable balance.',{balanceId,transactionHash:row.transaction_hash??row.transaction?.hash??null});
 const loaded=await loadRatingsStellar(runtime??{}),stellar=loaded.stellar;
 const meta=stellar.xdr.TransactionMeta.fromXdr(xdr,'base64');
 const operations=meta.type==='operations'?meta.value:meta.value?.operations;
 need(Array.isArray(operations),'INVALID_TRANSACTION_META','The original transaction metadata has no operation changes.');
 let current=null,removed=null,operationIndex=null;
 for(let index=0;index<operations.length;index++)for(const change of operations[index].changes??[]){
  if(change.type==='ledgerEntryRemoved'){
   const key=change.value;
   if(key.type==='claimableBalance'&&key.value.balanceId.toXdr('hex').toLowerCase()===balanceId){removed=current;operationIndex=index;}
  }else if(['ledgerEntryState','ledgerEntryCreated','ledgerEntryUpdated','ledgerEntryRestored'].includes(change.type)){
   const data=change.value.data;
   if(data.type==='claimableBalance'&&data.value.balanceId.toXdr('hex').toLowerCase()===balanceId)current=data.value;
  }
 }
 need(removed,'CLAIMABLE_BALANCE_META_MISSING','The original metadata does not bind a prior balance entry to this removal.',{balanceId});
 const original=stellar.Asset.fromOperation(removed.asset),asset=asAsset(stellar,{assetType:original.isNative()?'native':'credit',assetCode:original.getCode(),assetIssuer:original.isNative()?null:original.getIssuer()},ratingsNetwork(network));
 const amountUnits=integerText(removed.amount.toString(),'Original removed balance amount',{maximum:(1n<<63n)-1n});
 return {runtime:clone(loaded.runtime),balanceId,operationIndex,metadataSha256:sha256(Buffer.from(xdr,'base64')),asset,amountUnits,amount:formatUnits(amountUnits,7)};
}
