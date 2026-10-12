// MIT. Native Fuul SDK 0.3.0 and Stellar SDK 17.2.1 remain the RPC parsers.
import {createHash} from 'node:crypto';
import {loadFuulStellar} from './runtime.mjs';
import {FuulError,need,clone,canonical,sha256,text,object,list,parseFuulJSON,fuulNetwork,stellarAddress,safeInteger,jsonNative} from './lossless-json.mjs';

const MAXIMUM_BODY=64*1024*1024;
const TYPE={type:'object',additionalProperties:false};
const string={type:'string',minLength:1};
const ledger={type:'integer',minimum:1,maximum:4294967295};
export const STELLAR_READ_CATALOG=[
 {kind:'network',label:'Original Stellar network',filtersSchema:{...TYPE,properties:{}},recordsPath:'/result'},
 {kind:'health',label:'RPC retained ledger range',filtersSchema:{...TYPE,properties:{}},recordsPath:'/result'},
 {kind:'latest-ledger',label:'Latest ledger',filtersSchema:{...TYPE,properties:{}},recordsPath:'/result'},
 {kind:'events',label:'Fuul contract events',filtersSchema:{...TYPE,properties:{contractIds:{type:'array',minItems:1,maxItems:5,items:string},startLedger:ledger,endLedger:ledger},required:['startLedger']},recordsPath:'/result/events',pagination:'original-cursor',maximumPageSize:10000},
 {kind:'transaction',label:'Original transaction outcome',filtersSchema:{...TYPE,properties:{hash:{type:'string',pattern:'^[0-9a-fA-F]{64}$'}},required:['hash']},recordsPath:'/result'},
 {kind:'ledger-entries',label:'Original ledger entry XDR',filtersSchema:{...TYPE,properties:{keys:{type:'array',minItems:1,maxItems:200,items:string}},required:['keys']},recordsPath:'/result/entries'}
];

function headers(value={}){
 object(value,'RPC headers');const result={};
 for(const [name,item] of Object.entries(value)){need(/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name)&&typeof item==='string'&&!/[\r\n]/.test(item),'INVALID_CONNECTION','A private RPC header is malformed.');result[name]=item;}
 return result;
}
export function describeFuulStellar(connection){
 object(connection,'Stellar connection');const network=fuulNetwork(connection.network);
 let url;try{url=new URL(connection.rpcUrl);}catch{throw new FuulError('INVALID_CONNECTION','Select an absolute RPC URL.');}
 need((url.protocol==='https:'||(url.protocol==='http:'&&connection.allowHttp===true))&&!url.username&&!url.password&&!url.hash,'INVALID_CONNECTION','The RPC URL must use the selected HTTP transport without embedded user credentials.');
 const contracts=(connection.contracts??[]).map(item=>{object(item,'Contract selection');need(['factory','manager','project'].includes(item.role),'INVALID_CONTRACT_ROLE','Select the original generated contract role.');return {address:stellarAddress(item.address,'Contract',{kind:'contract'}),role:item.role};});
 need(new Set(contracts.map(item=>item.address)).size===contracts.length,'INVALID_CONNECTION','Each selected contract must have one role.');
 const scope={provider:'stellar',origin:url.origin,network:network.network,projectId:connection.projectId??null,accountScope:connection.accountScope??null,contracts};
 const id=sha256(scope);
 return {...scope,id,sourceScope:id,chainIdentifier:network.chainIdentifier,authType:'rpc'};
}
function configured(connection){
 const descriptor=describeFuulStellar(connection);
 return {descriptor,url:new URL(connection.rpcUrl),network:fuulNetwork(connection.network),headers:headers(connection.headers),timeout:safeInteger(connection.timeoutMs??20000,'RPC timeout',{minimum:1,maximum:60000}),runtime:connection.runtime??{installationDirectory:connection.installationDirectory,runtimeDirectory:connection.runtimeDirectory,expectedManifestSha256:connection.expectedManifestSha256}};
}
function selectedFilters(request,descriptor){
 const filters=clone(request.filters??{});object(filters,'Native filters');
 const kind=request.kind,entry=STELLAR_READ_CATALOG.find(item=>item.kind===kind);need(entry,'UNKNOWN_READ_KIND','Select an original Stellar read kind.');
 const allowed=new Set(Object.keys(entry.filtersSchema.properties));for(const key of Object.keys(filters))need(allowed.has(key),'INVALID_FILTER','The original Stellar read does not accept this filter.',{kind,key});
 if(kind==='events'){
   filters.contractIds=filters.contractIds??descriptor.contracts.map(item=>item.address);
   list(filters.contractIds,'Event contracts');need(filters.contractIds.length>=1&&filters.contractIds.length<=5,'INVALID_FILTER','Fuul getEventPage selects one to five original contracts.');
   filters.contractIds=filters.contractIds.map(value=>stellarAddress(value,'Event contract',{kind:'contract'}));
   if(filters.startLedger!==undefined&&filters.startLedger!==null)filters.startLedger=safeInteger(filters.startLedger,'startLedger',{minimum:1,maximum:0xffffffff});
   if(filters.endLedger!==undefined&&filters.endLedger!==null)filters.endLedger=safeInteger(filters.endLedger,'endLedger',{minimum:1,maximum:0xffffffff});
   if(request.cursor===undefined||request.cursor===null)need(filters.startLedger!==undefined&&filters.startLedger!==null,'INVALID_FILTER','The first event page requires startLedger.');
   if(filters.endLedger!==undefined&&filters.endLedger!==null&&filters.startLedger!==undefined)need(filters.endLedger>filters.startLedger,'INVALID_FILTER','endLedger is exclusive and must exceed startLedger.');
 }
 return filters;
}
function combinedSignal(signal,timeout){
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
 if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}
 const timer=setTimeout(()=>controller.abort(new FuulError('RPC_TIMEOUT','The original RPC request exceeded its configured deadline.')),timeout);
 return {signal:controller.signal,close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
}
async function readBody(response,signal){
 const parts=[];let bytes=0,bodyComplete=true,error=null;
 try{
   if(response.body)for await(const part of response.body){
     if(signal.aborted)throw signal.reason??new Error('Aborted');
     const buffer=Buffer.from(part),remaining=MAXIMUM_BODY-bytes;
     if(buffer.length>remaining){if(remaining>0){parts.push(buffer.subarray(0,remaining));bytes+=remaining;}bodyComplete=false;error={code:'RPC_RESPONSE_TOO_LARGE',message:'The original RPC response exceeds 64 MiB.'};break;}
     parts.push(buffer);bytes+=buffer.length;
   }
 }catch{bodyComplete=false;error={code:signal.aborted?'INTERRUPTED':'RPC_RESPONSE_INTERRUPTED',message:'The original RPC response ended before completion.'};}
 return {body:Buffer.concat(parts,bytes),bodyComplete,error};
}
function publicHeaders(source){const result={};for(const [name,value] of source.entries())if(!/^(set-cookie|authorization|proxy-authorization)$/i.test(name))result[name]=value;return result;}
function requestWire(config){
 if(typeof config.data==='string')return Buffer.from(config.data);
 return Buffer.from(JSON.stringify(config.data));
}
function wireKind(method){return {getNetwork:'network',getHealth:'health',getLatestLedger:'latest-ledger',getEvents:'events',getTransaction:'transaction',getLedgerEntries:'ledger-entries'}[method]??method;}
function parseNativeBody(body){try{return JSON.parse(body.toString('utf8'));}catch{throw new FuulError('INVALID_RPC_JSON','The original RPC response is not valid JSON.');}}
function originalRows(value,kind){
 if(!value||typeof value!=='object'||value.error)return [];
 const result=value.result;
 if(kind==='events')return Array.isArray(result?.events)?result.events:[];
 if(kind==='ledger-entries')return Array.isArray(result?.entries)?result.entries:[];
 return result===undefined?[]:[result];
}
function publicFailure(error,fallback='NATIVE_RPC_ERROR'){
 if(error instanceof FuulError)return {code:error.code,message:error.message,details:jsonNative(error.details)};
 return {code:fallback,message:'The original native SDK could not complete this RPC operation.'};
}
function cursorPosition(cursor){
 if(typeof cursor!=='string'||!/^\d{1,32}-\d{1,20}$/.test(cursor))return null;
 const [toidText,eventText]=cursor.split('-'),toid=BigInt(toidText),event=BigInt(eventText);
 if(toid>0xffffffffffffffffn||event>0xffffffffn)return null;
 return {ledger:Number(toid>>32n),toid,event,terminal:(toid&0xffffffffn)===0xffffffffn&&event===0xffffffffn};
}
function eventContinuation(request,filters,raw,page){
 const cursor=page?.cursor??raw?.result?.cursor;
 need(typeof cursor==='string'&&cursor,'INVALID_NATIVE_CURSOR','The original event page did not return a cursor.');
 const upper=filters.endLedger??null;
 const overrun=upper!==null&&(raw?.result?.events??[]).some(event=>Number.isSafeInteger(Number(event.ledger))&&Number(event.ledger)>=upper);
 const position=cursorPosition(cursor),frontier=position?.ledger??null;
 const done=upper!==null&&(overrun||(position&&(frontier>=upper||(frontier===upper-1&&position.terminal))));
 const previous=request.cursor??null;
 const next=done?null:{kind:'events',filters:clone(filters),pageSize:request.pageSize??100,cursor};
 return {done:Boolean(done),next,cursor,selectedEndLedger:upper,scannedCursorLedger:frontier,scannedLedgerComplete:position?.terminal??false,waiting:!done&&cursor===previous};
}
async function eventSpecs(sdk,selection,options){
 const result=new Map();
 for(const item of selection){
   const namespace={factory:sdk.FactoryContract,manager:sdk.ManagerContract,project:sdk.ProjectContract}[item.role];
   need(namespace?.Client,'NATIVE_SDK_MISMATCH','The retained SDK does not expose the original generated contract client.');
   const client=new namespace.Client({...options,contractId:item.address});
   need(client.spec&&typeof client.spec.parseEvent==='function','NATIVE_SDK_MISMATCH','The original generated client must expose its contract specification.');
   result.set(item.address,client.spec);
 }
 return result;
}
function decodedView(page){
 return {events:page.events.map(event=>({id:event.id,contractId:event.contractId??null,hash:event.hash,ledger:event.ledger,closedAt:event.closedAt,topics:jsonNative(event.topics),value:jsonNative(event.value),parsed:jsonNative(event.parsed)})),cursor:page.cursor,latestLedger:page.latestLedger,oldestLedger:page.oldestLedger};
}
async function nativeSession(connection,{signal,retainedResponse=null,retainedRequest=null,wireOverride=null}={}){
 const selected=configured(connection),loaded=await loadFuulStellar(selected.runtime);
 const server=loaded.sdk.createFuulRpcServer(selected.url.href,{allowHttp:connection.allowHttp===true,headers:selected.headers,timeout:selected.timeout});
 const exchanges=[];
 server.httpClient.defaults.adapter=async config=>{
   let body=requestWire(config),rpc=parseNativeBody(body);
   if(wireOverride&&rpc.method===wireOverride.method){const selectedBytes=Buffer.from(wireOverride.bytes),selectedBody=parseNativeBody(selectedBytes);need(canonical(selectedBody)===canonical(rpc),'REQUEST_CHANGED','The native SDK changed the retained original JSON-RPC request.');body=selectedBytes;rpc=selectedBody;}
   const request={method:'POST',origin:selected.descriptor.origin,transport:'selected-rpc',body:rpc,bodyText:body.toString('utf8'),bodySha256:sha256(body)};
   const observedAt=new Date().toISOString();let response,transportError=null;
   if(retainedResponse!==null){
     need(rpc.method==='getEvents','INVALID_REPROJECTION','Retained native event decoding may only parse the original getEvents response.');
     if(retainedRequest?.body?.method)need(retainedRequest.body.method==='getEvents','INVALID_REPROJECTION','The retained RPC request is not an event read.');
     response={status:200,statusText:'Retained original response',headers:{'content-type':'application/json'},body:Buffer.from(retainedResponse),bodyComplete:true,observedAt};
   }else{
     const deadline=combinedSignal(signal,Math.min(selected.timeout,Number(config.timeout)||selected.timeout));
     try{
       const nativeHeaders={...selected.headers,...(config.headers??{}),'content-type':'application/json'};
       const received=await fetch(selected.url,{method:'POST',headers:nativeHeaders,body,signal:deadline.signal,redirect:'manual'});
       const collected=await readBody(received,deadline.signal);
       response={status:received.status,statusText:received.statusText,headers:publicHeaders(received.headers),body:collected.body,bodyComplete:collected.bodyComplete,observedAt,finishedAt:new Date().toISOString()};
       transportError=collected.error;
       if(received.status>=300&&received.status<400)transportError={code:'RPC_REDIRECT_REJECTED',message:'The selected RPC returned a redirect; its original response is retained.'};
     }catch{
       response={status:0,headers:{},body:Buffer.alloc(0),bodyComplete:false,observedAt,finishedAt:new Date().toISOString()};
       transportError={code:deadline.signal.aborted?'INTERRUPTED':'RPC_TRANSPORT_ERROR',message:'The original RPC transport did not return a complete response.'};
     }finally{deadline.close();}
   }
   const exchange={kind:wireKind(rpc.method),request,response,runtime:clone(loaded.runtime)};
   if(transportError)exchange.error=transportError;
   exchanges.push(exchange);
   if(transportError)throw new FuulError(transportError.code,transportError.message);
   let parsed;try{parsed=parseNativeBody(response.body);}catch(error){exchange.error=publicFailure(error);throw error;}
   exchange.records=originalRows(parseFuulJSON(response.body).value,exchange.kind);
   exchange.recordsPath=STELLAR_READ_CATALOG.find(item=>item.kind===exchange.kind)?.recordsPath??'/result';
   if(response.status<200||response.status>=300){exchange.error={code:'RPC_HTTP_ERROR',message:'The original RPC returned HTTP '+response.status+'.'};throw new FuulError('RPC_HTTP_ERROR',exchange.error.message,{status:response.status});}
   if(parsed.error)exchange.error={code:'RPC_ERROR',message:'The original JSON-RPC response contains an error.',details:{rpcCode:parsed.error.code??null}};
   return {data:parsed,headers:response.headers,config,status:response.status,statusText:response.statusText??''};
 };
 return {selected,...loaded,server,exchanges};
}
export function openFuulStellarSource(connection){
 const selected=configured(connection);
 return {descriptor:selected.descriptor,catalog:clone(STELLAR_READ_CATALOG),actionCatalog:clone(STELLAR_ACTION_CATALOG),async read(request){
   object(request,'Native Stellar request');const filters=selectedFilters(request,selected.descriptor),kind=request.kind;
   const session=await nativeSession(connection,{signal:request.signal});let result=null,error=null,view=null,continuation={done:true,next:null};
   try{
     if(kind==='network')result=await session.server.getNetwork();
     else{
       const network=await session.server.getNetwork();
       need(network.passphrase===selected.network.passphrase,'NETWORK_MISMATCH','The original RPC passphrase differs from the selected Stellar network.');
       if(kind==='health')result=await session.server.getHealth();
       else if(kind==='latest-ledger')result=await session.server.getLatestLedger();
       else if(kind==='events'){
         const health=await session.server.getHealth();
         const position=request.cursor?cursorPosition(request.cursor):null;
         const originalFrontier=request.cursor?(position?position.ledger+(position.terminal?1:0):null):filters.startLedger;
         if(originalFrontier!==null&&originalFrontier!==undefined&&health.oldestLedger!==undefined)
           need(originalFrontier>=Number(health.oldestLedger),'RETENTION_GAP','The original next cursor or ledger predates this RPC source retention.',{requiredLedger:originalFrontier,oldestLedger:Number(health.oldestLedger),cursor:request.cursor??null});
         const limit=safeInteger(request.pageSize??100,'Event page size',{minimum:1,maximum:10000});
         const query={contractIds:filters.contractIds,limit,...(request.cursor!==undefined&&request.cursor!==null?{cursor:text(request.cursor,'Original cursor',256)}:{startLedger:filters.startLedger,...(filters.endLedger!==undefined&&filters.endLedger!==null?{endLedger:filters.endLedger}:{})})};
         const specs=await eventSpecs(session.sdk,selected.descriptor.contracts,{rpcUrl:selected.url.href,networkPassphrase:selected.network.passphrase,server:session.server});
         result=await session.sdk.getEventPage(session.server,query,specs);view=decodedView(result);
         const original=session.exchanges.findLast(item=>item.kind==='events');
         continuation=eventContinuation(request,filters,parseFuulJSON(original.response.body).value,result);
       }else if(kind==='transaction'){
         need(typeof filters.hash==='string'&&/^[0-9a-fA-F]{64}$/.test(filters.hash),'INVALID_FILTER','Select an original 64-character transaction hash.');
         result=await session.server.getTransaction(filters.hash);
       }else if(kind==='ledger-entries'){
         const keys=list(filters.keys,'Ledger entry keys');need(keys.length>=1&&keys.length<=200,'INVALID_FILTER','Select one to 200 original ledger entry XDR keys.');
         const native=keys.map(value=>session.stellar.xdr.LedgerKey.fromXdr(text(value,'Ledger key XDR',65536),'base64'));
         result=await session.server.getLedgerEntries(...native);
       }
       else throw new FuulError('UNKNOWN_READ_KIND','Select an original Stellar RPC read.');
     }
     if(kind==='network')need(result.passphrase===selected.network.passphrase,'NETWORK_MISMATCH','The original RPC passphrase differs from the selected network.');
   }catch(cause){error=publicFailure(cause);}
   const mainIndex=session.exchanges.findLastIndex(item=>item.kind===kind);
   const main=mainIndex>=0?session.exchanges[mainIndex]:{request:{method:'POST',origin:selected.descriptor.origin,kind,filters:clone(filters)},response:{status:0,headers:{},body:Buffer.alloc(0),bodyComplete:false,observedAt:new Date().toISOString()},records:[],recordsPath:STELLAR_READ_CATALOG.find(item=>item.kind===kind)?.recordsPath};
   if(kind==='events')main.request={...main.request,nativeSelection:{startLedger:filters.startLedger??null,endLedger:filters.endLedger??null,contractIds:clone(filters.contractIds)}};
   if(error){continuation={done:false,next:{kind,filters:clone(filters),pageSize:request.pageSize??100,...(request.cursor!==undefined&&request.cursor!==null?{cursor:request.cursor}:{})}};}
   return {...main,descriptor:selected.descriptor,runtime:clone(session.runtime),nativeView:view??jsonNative(result),records:main.records??[],continuation,exchanges:session.exchanges.filter((_,index)=>index!==mainIndex),...(error?{error}:{})};
 }};
}
/** Parse a retained original RPC response through both original SDK parsers without an RPC fetch. */
export async function decodeFuulStellarEvents({rawBody,request={},connection={},contracts,network,runtime,signal}){
 const selectedNetwork=network??connection.network;
 const configuredConnection={...connection,provider:'stellar',network:selectedNetwork,rpcUrl:connection.rpcUrl??'https://retained.invalid',contracts:contracts??connection.contracts??[],runtime:runtime??connection.runtime};
 const body=Buffer.isBuffer(rawBody)?rawBody:Buffer.from(rawBody);
 const original=parseFuulJSON(body).value;need(Array.isArray(original?.result?.events),'INVALID_NATIVE_SOURCE','Select the original getEvents JSON-RPC response.');
 const selected=configured(configuredConnection);
 const nativeRequest=request.body??request.rpc??{};
 const filterIds=nativeRequest.params?.filters?.flatMap(filter=>filter.contractIds??[])??request.filters?.contractIds??selected.descriptor.contracts.map(item=>item.address);
 const ids=[...new Set(filterIds)];
 if(!ids.length)for(const event of original.result.events)if(typeof event.contractId==='string'&&!ids.includes(event.contractId))ids.push(event.contractId);
 need(ids.length>=1&&ids.length<=5,'INVALID_REPROJECTION','The retained native filter requires one to five contract IDs.');
 const session=await nativeSession(configuredConnection,{signal,retainedResponse:body,retainedRequest:request});
 const params=nativeRequest.params??{};
 const start=safeInteger(params.startLedger??request.filters?.startLedger??1,'Retained start ledger',{minimum:1,maximum:0xffffffff});
 const query={contractIds:ids,limit:safeInteger(params.pagination?.limit??params.limit??100,'Retained page size',{minimum:1,maximum:10000}),...(params.pagination?.cursor??params.cursor?{cursor:params.pagination?.cursor??params.cursor}:{startLedger:start,...(params.endLedger!==undefined?{endLedger:safeInteger(params.endLedger,'Retained end ledger',{minimum:2,maximum:0xffffffff})}:{})})};
 const specs=await eventSpecs(session.sdk,selected.descriptor.contracts,{rpcUrl:selected.url.href,networkPassphrase:selected.network.passphrase,server:session.server});
 const result=await session.sdk.getEventPage(session.server,query,specs);
 return {nativeView:decodedView(result),runtime:clone(session.runtime),records:original.result.events};
}
/** Native claim construction remains separate from the provider's EVM-oriented claim DTO. */
export async function prepareNativeFuulClaim({input,runtime}){
 object(input,'Original Stellar claim input');const loaded=await loadFuulStellar(runtime??{});
 const decimal=(value,name)=>{need(typeof value==='bigint'||(typeof value==='string'&&/^(?:0|[1-9]\d*)$/.test(value))||(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0),'INVALID_AMOUNT',name+' must be exact unsigned integer text or a safe integer.');return BigInt(value);};
 const native=loaded.sdk.createClaimCheck({...input,amount:decimal(input.amount,'amount'),deadline:decimal(input.deadline,'deadline'),...(input.tokenId!==undefined?{tokenId:decimal(input.tokenId,'tokenId')}:{})});
 return {schema:'stellar-forge.fuul-native-claim.v1',runtime:clone(loaded.runtime),claim:jsonNative(native)};
}


export const STELLAR_ACTION_CATALOG=[{
 operation:'stellar.claim',label:'Prepare and submit an original Stellar claim',provider:'stellar',effect:'native-claim',
 inputSchema:{...TYPE,properties:{
  check:{type:'object'},walletAddress:string,signedTransactionXdr:string,preparedTransactionXdr:string,
  maximumFeeStroops:{type:'string',pattern:'^[1-9][0-9]*$'},timeoutSeconds:{type:'integer',minimum:1,maximum:3600}
 },required:['check','walletAddress','maximumFeeStroops']}
}];
function exactUnsigned(value,name,maximum=(1n<<256n)-1n){
 need(typeof value==='bigint'||(typeof value==='string'&&/^(?:0|[1-9]\d*)$/.test(value))||(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0),'INVALID_AMOUNT',name+' must be exact unsigned integer text or a safe integer.');
 const result=BigInt(value);need(result>=0n&&result<=maximum,'INVALID_AMOUNT',name+' is outside the original native integer range.');return result;
}
function authSigner(stellar,entry){
 const credentials=entry.credentials;
 if(credentials.type==='sorobanCredentialsAddress')return stellar.Address.fromScAddress(credentials.address.address).toString();
 if(credentials.type==='sorobanCredentialsAddressV2')return stellar.Address.fromScAddress(credentials.addressV2.address).toString();
 return null;
}
function claimConfiguration(connection,programme,check,walletAddress){
 const configuredSource=configured(connection),definition=programme?.definition??programme??{};
 const supplied=[...(definition.contracts??[]),...configuredSource.descriptor.contracts],roles={};
 for(const item of supplied){if(item.role==='factory'||item.role==='manager'){if(roles[item.role])need(roles[item.role]===item.address,'CONTRACT_SCOPE_MISMATCH','The original programme and source select different '+item.role+' contracts.');roles[item.role]=stellarAddress(item.address,item.role,{kind:'contract'});}}
 need(roles.factory&&roles.manager,'NATIVE_CONTRACTS_REQUIRED','Select the original deployed Fuul Factory and Manager.');
 if(definition.projectId&&configuredSource.descriptor.projectId)need(definition.projectId===configuredSource.descriptor.projectId,'PROJECT_SCOPE_MISMATCH','The native claim source belongs to another programme.');
 const projects=supplied.filter(item=>item.role==='project');
 if(projects.length)need(projects.some(item=>item.address===check.project_address),'PROJECT_CONTRACT_MISMATCH','The voucher belongs to another selected project contract.');
 return {selected:configuredSource,contracts:roles,walletAddress:stellarAddress(walletAddress,'Original wallet',{kind:'account'}),projectId:definition.projectId??configuredSource.descriptor.projectId??check.project_address};
}
function checkedVoucher(sdk,stellar,value,manager){
 object(value,'Original signed claim check');
 const check=clone(value),proof=text(check.proof,'Original claim proof',66).replace(/^0x/,'');
 need(/^[0-9a-fA-F]{64}$/.test(proof),'INVALID_NATIVE_CLAIM','The original proof must contain exactly 32 hexadecimal bytes.');
 need(String(check.currency_type)==='0','INVALID_NATIVE_CLAIM','This original Stellar claim route selects currency_type 0.');
 const reason=String(check.reason);
 need(reason==='0'||reason==='1','INVALID_NATIVE_CLAIM','The original native claim reason must identify affiliate or end-user payout.');
 list(check.signers,'Original claim signers');list(check.signatures,'Original authorization entries');
 need(check.signers.length>0&&check.signers.length<=64&&check.signatures.length===check.signers.length,'INVALID_NATIVE_CLAIM','Each original signer must have its supplied authorization entry.');
 const entries=new Map();
 for(let i=0;i<check.signers.length;i++){
  const signer=stellarAddress(check.signers[i],'Original authorization signer',{kind:'account'});
  need(!entries.has(signer),'INVALID_NATIVE_CLAIM','Original claim signers must be unique.');
  const body=text(check.signatures[i],'Original authorization XDR',262144);
  let entry;try{entry=stellar.xdr.SorobanAuthorizationEntry.fromXdr(body,'base64');}catch{throw new FuulError('INVALID_NATIVE_CLAIM','An original authorization entry is not valid XDR.');}
  need(authSigner(stellar,entry)===signer,'AUTHORIZATION_SIGNER_MISMATCH','The original authorization entry belongs to another signer.');
  entries.set(signer,entry);
 }
 const native=sdk.createClaimCheck({project:stellarAddress(check.project_address,'Original project',{kind:'contract'}),to:stellarAddress(check.to,'Original recipient',{kind:'account'}),currency:stellarAddress(check.currency,'Original currency',{kind:'contract'}),
  currencyType:sdk.currencyType.stellarAsset,amount:exactUnsigned(check.amount,'Claim amount',(1n<<127n)-1n),
  reason:reason==='0'?sdk.claimReason.affiliatePayout:sdk.claimReason.endUserPayout,
  tokenId:exactUnsigned(check.token_id??'0','Original token ID'),deadline:exactUnsigned(check.deadline,'Original claim deadline'),
  proof:Buffer.from(proof,'hex'),signers:check.signers});
 need(native.deadline>BigInt(Math.floor(Date.now()/1000)),'CLAIM_EXPIRED','The original signed claim check has expired.');
 const expected=sdk.claimAuthorizations(manager,[native]);
 for(const item of expected){const entry=entries.get(item.address);need(entry&&entry.rootInvocation.toXdr('base64')===item.invocation,'AUTHORIZATION_SCOPE_MISMATCH','The supplied authorization is not the original selected Manager claim.');}
 return {check,native,entries};
}
function claimCall(stellar,transaction,manager,expectedArgs,walletAddress,maximumFeeStroops){
 need(transaction instanceof stellar.Transaction,'INVALID_SIGNED_TRANSACTION','Select an original v1 Stellar transaction.');
 need(transaction.source===walletAddress&&transaction.operations.length===1,'INVALID_SIGNED_TRANSACTION','The original claim must use its selected source and one contract operation.');
 const operation=transaction.operations[0];
 need(operation.type==='invokeHostFunction'&&(!operation.source||operation.source===walletAddress),'INVALID_SIGNED_TRANSACTION','The selected transaction must invoke the original Manager from its selected wallet.');
 const host=operation.func;
 need(host?.type==='hostFunctionTypeInvokeContract','INVALID_SIGNED_TRANSACTION','The original operation must be a contract invocation.');
 const call=host.invokeContract;
 need(stellar.Address.fromScAddress(call.contractAddress).toString()===manager&&String(call.functionName)==='claim','INVALID_SIGNED_TRANSACTION','The transaction invokes another contract or function.');
 need(call.args.length===expectedArgs.length&&call.args.every((value,index)=>value.toXdr('base64')===expectedArgs[index].toXdr('base64')),'CLAIM_ARGUMENTS_CHANGED','The signed transaction differs from the original claim and caller.');
 need(BigInt(transaction.fee)<=maximumFeeStroops,'FEE_LIMIT','The selected transaction exceeds the original fee ceiling.',{feeStroops:transaction.fee,maximumFeeStroops:maximumFeeStroops.toString()});
 need(transaction.timeBounds&&BigInt(transaction.timeBounds.maxTime)>BigInt(Math.floor(Date.now()/1000)),'TRANSACTION_EXPIRED','The original claim transaction must retain a finite future time bound.');
 return operation;
}
function verifyVoucherEntries(stellar,operation,entries){
 const found=new Set();
 for(const entry of operation.auth??[]){
  const signer=authSigner(stellar,entry),original=entries.get(signer);
  if(original){need(entry.toXdr('base64')===original.toXdr('base64'),'AUTHORIZATION_CHANGED','The claim transaction changed an original Fuul authorization entry.');found.add(signer);}
 }
 need(found.size===entries.size,'AUTHORIZATION_MISSING','The claim transaction must contain every original Fuul authorization entry.');
}
function claimFailure(error,observations){
 if(error instanceof FuulError){error.observations=observations;return error;}
 const failure=new FuulError(error?.code??'NATIVE_CLAIM_FAILED','The original native claim operation could not complete.',{nativeCode:error?.code??null});
 failure.observations=observations;return failure;
}
/** Original API authorization XDR is enforced before an accepted wallet signature is retained. */
export async function prepareFuulStellarAction({connection,operation,input,programme,signal}){
 need(operation==='stellar.claim','UNKNOWN_ACTION','Select the original native Stellar claim action.');object(input,'Original claim action input');
 const allowed=new Set(Object.keys(STELLAR_ACTION_CATALOG[0].inputSchema.properties));for(const key of Object.keys(input))need(allowed.has(key),'INVALID_ARGUMENT','Unknown original native claim input.',{key});
 const selection=claimConfiguration(connection,programme,input.check??{},input.walletAddress),session=await nativeSession(connection,{signal});
 try{
  const network=await session.server.getNetwork();need(network.passphrase===selection.selected.network.passphrase,'NETWORK_MISMATCH','The selected RPC returned another native network.');
  const maximum=exactUnsigned(input.maximumFeeStroops,'Original maximum fee');need(maximum>0n,'INVALID_AMOUNT','Select a positive original fee ceiling.');
  const configuredSdk=new session.sdk.FuulSdk({rpcUrl:selection.selected.url.href,networkPassphrase:selection.selected.network.passphrase,contracts:selection.contracts,publicKey:selection.walletAddress,server:session.server});
  const voucher=checkedVoucher(session.sdk,session.stellar,input.check,selection.contracts.manager);
  const claimed=await session.sdk.readContract(configuredSdk.project(voucher.native.project_address).claimed_proofs({proof:voucher.native.proof}));
  need(claimed===false,'PROOF_ALREADY_CLAIMED','The original project already contains this claim proof.');
  const fees=await session.sdk.readContract(configuredSdk.factory.get_fees_information({project:voucher.native.project_address}));
  const args={caller:selection.walletAddress,checks:[voucher.native]},expectedArgs=configuredSdk.manager.spec.funcArgsToScVals('claim',args);
  let prepared,signed=null;
  const nativeXdr=input.signedTransactionXdr??input.preparedTransactionXdr;
  if(nativeXdr){
   prepared=session.stellar.TransactionBuilder.fromXdr(text(nativeXdr,'Original transaction XDR',MAXIMUM_BODY),selection.selected.network.passphrase);
   const selectedCall=claimCall(session.stellar,prepared,selection.contracts.manager,expectedArgs,selection.walletAddress,maximum);
   verifyVoucherEntries(session.stellar,selectedCall,voucher.entries);
   if(input.signedTransactionXdr){
    need(prepared.signatures.length>0,'SIGNATURE_REQUIRED','Supply the accepted original wallet-signed transaction.');
    if(input.preparedTransactionXdr){const original=session.stellar.TransactionBuilder.fromXdr(input.preparedTransactionXdr,selection.selected.network.passphrase);need(Buffer.from(original.hash()).equals(Buffer.from(prepared.hash())),'SIGNED_TRANSACTION_CHANGED','The wallet changed the original prepared transaction body.');}
    signed=prepared;
   }
  }else{
   const assembled=await configuredSdk.manager.claim(args,{timeoutInSeconds:safeInteger(input.timeoutSeconds??300,'Claim transaction timeout',{minimum:1,maximum:3600})});
   need(assembled.simulation&&assembled.built&&!session.stellar.rpc.Api.isSimulationError(assembled.simulation),'CLAIM_SIMULATION_FAILED','The original Manager simulation did not produce a transaction.');
   const original=claimCall(session.stellar,assembled.built,selection.contracts.manager,expectedArgs,selection.walletAddress,maximum),used=new Set();
   const auth=(original.auth??[]).map(entry=>{const signer=authSigner(session.stellar,entry),provided=voucher.entries.get(signer);if(!provided)return entry;need(entry.rootInvocation.toXdr('base64')===provided.rootInvocation.toXdr('base64'),'AUTHORIZATION_SCOPE_MISMATCH','The original supplied authorization differs from the selected simulated call.');used.add(signer);return provided;});
   need(used.size===voucher.entries.size,'AUTHORIZATION_MISSING','The original simulation did not request every supplied signer.');
   prepared=session.stellar.TransactionBuilder.cloneFrom(assembled.built).clearOperations().addOperation(session.stellar.Operation.invokeHostFunction({func:original.func,auth})).build();
  }
  const enforced=await session.server.simulateTransaction(prepared,undefined,'enforce');
  need(!session.stellar.rpc.Api.isSimulationError(enforced),'CLAIM_ENFORCEMENT_FAILED','The original supplied authorizations failed enforcement simulation.');
  if(!signed)prepared=session.stellar.rpc.assembleTransaction(prepared,enforced).build();
  const checkedCall=claimCall(session.stellar,prepared,selection.contracts.manager,expectedArgs,selection.walletAddress,maximum);verifyVoucherEntries(session.stellar,checkedCall,voucher.entries);
  const preview={walletAddress:selection.walletAddress,contracts:selection.contracts,originalCheck:clone(voucher.check),claim:jsonNative(voucher.native),fees:jsonNative(fees),preparedTransactionXdr:prepared.toXdr(),transactionHash:Buffer.from(prepared.hash()).toString('hex'),feeStroops:prepared.fee,maximumFeeStroops:maximum.toString(),simulationLedger:enforced.latestLedger??null,runtime:clone(session.runtime)};
  if(!signed&&connection.signer){
   need(connection.signer.address===selection.walletAddress&&typeof connection.signer.signTransaction==='function','SIGNER_MISMATCH','Select the original wallet signer for this source account.');
   const accepted=await connection.signer.signTransaction(prepared.toXdr(),{networkPassphrase:selection.selected.network.passphrase,address:selection.walletAddress,submit:false});
   const envelope=typeof accepted==='string'?accepted:accepted?.signedTxXdr;
   need(typeof envelope==='string','SIGNATURE_REQUIRED','The selected wallet did not return its signed transaction.');
   signed=session.stellar.TransactionBuilder.fromXdr(envelope,selection.selected.network.passphrase);
   need(Buffer.from(signed.hash()).equals(Buffer.from(prepared.hash()))&&signed.signatures.length>0,'SIGNED_TRANSACTION_CHANGED','The accepted wallet signature must retain the original transaction body.');
  }
  need(signed,'SIGNATURE_REQUIRED','The original claim is prepared for the selected wallet signature.',{preview,requiredInput:'signedTransactionXdr',retainedInput:'preparedTransactionXdr'});
  claimCall(session.stellar,signed,selection.contracts.manager,expectedArgs,selection.walletAddress,maximum);
  const transactionXdr=signed.toXdr(),transactionHash=Buffer.from(signed.hash()).toString('hex');
  return {schema:'stellar-forge.fuul-prepared-action.v1',kind:'fuul-action',operation,projectId:selection.projectId,network:selection.selected.descriptor.network,connection:clone(selection.selected.descriptor),
   request:{method:'POST',path:'/',body:{jsonrpc:'2.0',id:1,method:'sendTransaction',params:{transaction:transactionXdr}}},
   identity:{projectId:selection.projectId,projectAddress:voucher.native.project_address,walletAddress:selection.walletAddress,proof:Buffer.from(voucher.native.proof).toString('hex'),transactionHash},
   correlation:{projectId:selection.projectId,projectAddress:voucher.native.project_address,proof:Buffer.from(voucher.native.proof).toString('hex'),transactionHash},
   runtime:clone(session.runtime),effect:'native-claim',prerequisites:[],observations:session.exchanges,preview:{...preview,transactionHash,signedTransactionXdr:transactionXdr}};
 }catch(error){throw claimFailure(error,session.exchanges);}
}
/** Decode a retained original transaction envelope through the selected SDK. */
export async function decodeFuulStellarTransaction({rawBody,request={},network,runtime}){
 const loaded=await loadFuulStellar(runtime??{}),selected=fuulNetwork(network),original=parseFuulJSON(rawBody).value;
 const value=original.result??{},originalHash=request.body?.params?.hash??request.rpc?.params?.hash??null;
 const requested=typeof originalHash==='string'&&/^[0-9a-fA-F]{64}$/.test(originalHash)?originalHash.toLowerCase():null;
 let transactionHash=null,envelopeVerified=false;
 if(value.envelopeXdr){
  const envelope=loaded.stellar.TransactionBuilder.fromXdr(value.envelopeXdr,selected.passphrase);
  transactionHash=Buffer.from(envelope.hash()).toString('hex');
  if(requested&&transactionHash!==String(requested).toLowerCase()&&envelope instanceof loaded.stellar.FeeBumpTransaction)transactionHash=Buffer.from(envelope.innerTransaction.hash()).toString('hex');
  need(!requested||transactionHash===String(requested).toLowerCase(),'TRANSACTION_IDENTITY_MISMATCH','The original returned envelope differs from its requested hash.');
  envelopeVerified=true;
 }
 return {runtime:clone(loaded.runtime),projection:{status:value.status??null,transactionHash,requestedTransactionHash:requested,envelopeVerified,ledger:value.ledger??null}};
}
export function matchFuulClaimTransaction({action,records}){
 const hash=action.identity?.transactionHash??action.correlation?.transactionHash??action.preview?.transactionHash;
 if(typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash))return {matched:false,status:'UNOBSERVED',transactionHash:hash??null,sourceIds:[],recordIds:[]};
 const selected=records.filter(record=>record.provider==='stellar'&&record.network===action.network&&record.projection?.entity==='native-transaction'&&record.projection.requestedTransactionHash===hash);
 selected.sort((a,b)=>String(a.observedAt).localeCompare(String(b.observedAt))||a.id.localeCompare(b.id));
 const last=selected.at(-1),p=last?.projection;
 return {matched:!!p&&p.envelopeVerified===true&&p.transactionHash===hash,status:p?.status??'UNOBSERVED',transactionHash:hash,sourceIds:selected.map(row=>row.sourceId),recordIds:selected.map(row=>row.id)};
}
export async function sendFuulStellarAction({connection,action,signal}){
 need(action.operation==='stellar.claim','UNKNOWN_ACTION','Select the original native Stellar claim.');
 const descriptor=describeFuulStellar(connection),request=action.request??{},bytes=Buffer.from(request.bodyBytes??JSON.stringify(request.body));
 need(request.method==='POST'&&request.path==='/','INVALID_NATIVE_REQUEST','The original native claim request must retain its selected RPC route.');
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new FuulError('INVALID_REQUEST_JSON','The retained native claim request is not JSON.');}
 need(canonical(value)===canonical(request.body)&&(!request.bodySha256||sha256(bytes)===request.bodySha256),'REQUEST_CHANGED','The retained native claim wire differs from its prepared request.');
 need(value.jsonrpc==='2.0'&&value.method==='sendTransaction'&&value.id===1&&typeof value.params?.transaction==='string','INVALID_NATIVE_REQUEST','The original claim must retain its exact sendTransaction request.');
 const session=await nativeSession(connection,{signal,wireOverride:{method:'sendTransaction',bytes}});
 try{
  need(!action.connection?.id||action.connection.id===descriptor.id,'CONNECTION_SCOPE_MISMATCH','The original claim selects another native source.');
  need(action.network===descriptor.network,'NETWORK_MISMATCH','The original signed claim belongs to another network.');
  if(action.runtime)need(action.runtime.id===session.runtime.id&&action.runtime.manifestSha256===session.runtime.manifestSha256,'RUNTIME_CHANGED','Select the original retained SDK runtime for this prepared claim.');
  const transaction=session.stellar.TransactionBuilder.fromXdr(value.params.transaction,session.selected.network.passphrase);
  const hash=Buffer.from(transaction.hash()).toString('hex');
  need(hash===(action.identity?.transactionHash??action.correlation?.transactionHash)&&transaction.signatures.length>0,'SIGNED_TRANSACTION_CHANGED','The retained signed claim no longer matches its original transaction hash.');
  const network=await session.server.getNetwork();need(network.passphrase===session.selected.network.passphrase,'NETWORK_MISMATCH','The original RPC returned a different network.');
  const observed=await session.server.getTransaction(hash);
  let result=observed;
  if(observed.status!=='SUCCESS'&&observed.status!=='FAILED'){
   result=await session.sdk.submitSignedTransaction(session.server,transaction,{timeoutMs:safeInteger(connection.claimTimeoutMs??60000,'Original confirmation timeout',{minimum:1,maximum:600000}),pollIntervalMs:2000,signal,networkPassphrase:session.selected.network.passphrase});
  }else{
   const decoded=await decodeFuulStellarTransaction({rawBody:session.exchanges.at(-1).response.body,request:session.exchanges.at(-1).request,network:descriptor.network,runtime:session.selected.runtime});
   need(decoded.projection.envelopeVerified&&decoded.projection.transactionHash===hash,'TRANSACTION_IDENTITY_MISMATCH','The original terminal transaction does not match this claim.');
  }
  const mainIndex=session.exchanges.findLastIndex(item=>item.kind==='transaction'),main=session.exchanges[mainIndex];
  need(main,'NATIVE_TRANSACTION_RESPONSE_MISSING','The original transaction read did not return retained source.');
  return {...main,records:main.records??[],recordsPath:'/result',runtime:clone(session.runtime),outcome:{status:result.status==='SUCCESS'?'ACCEPTED':'FAILED',effect:'native-claim',mutationObserved:result.status==='SUCCESS',transactionHash:hash,nativeStatus:result.status},continuation:{done:true,next:null},exchanges:session.exchanges.filter((_,index)=>index!==mainIndex)};
 }catch(error){
  const mainIndex=session.exchanges.findLastIndex(item=>item.kind==='transaction'||item.kind==='sendTransaction'),main=mainIndex<0?{request:{method:'POST',origin:descriptor.origin},response:{status:0,headers:{},body:Buffer.alloc(0),bodyComplete:false},records:[]}:session.exchanges[mainIndex];
  return {...main,runtime:clone(session.runtime),outcome:{status:error.code==='TRANSACTION_FAILED'?'FAILED':'UNCERTAIN',effect:'native-claim',mutationObserved:false,transactionHash:action.identity?.transactionHash??action.correlation?.transactionHash??null,nativeCode:error.code??null},...(error.code==='TRANSACTION_FAILED'&&main.kind==='transaction'&&main.response.bodyComplete?{}:{error:publicFailure(error)}),continuation:{done:true,next:null},exchanges:session.exchanges.filter((_,index)=>index!==mainIndex)};
 }
}
