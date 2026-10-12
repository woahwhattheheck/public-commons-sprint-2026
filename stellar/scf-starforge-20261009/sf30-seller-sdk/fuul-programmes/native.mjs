// MIT. Original Fuul REST routes and hash-bound publisher preparation helpers.
import {promises as fs,constants} from 'node:fs';
import {dirname,resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {FuulError,need,clone,canonical,sha256,text,object,list,parseFuulJSON,fuulNetwork,stellarAddress,safeInteger,jsonNative} from './lossless-json.mjs';
import {openFuulStellarSource,describeFuulStellar,prepareFuulStellarAction,sendFuulStellarAction} from './stellar.mjs';
export {matchFuulClaimTransaction} from './stellar.mjs';
export {parseFuulJSON,parseFuulCSV} from './lossless-json.mjs';

const SOURCE_DIRECTORY=dirname(fileURLToPath(import.meta.url));
const MCP_SOURCE_SHA256='d2a4acbe0ade04c1f88f11a0cb4792e116b3c66184e5585e1b2f678a8d363e51';
const MAXIMUM_BODY=64*1024*1024;
const string={type:'string',minLength:1},uuid={type:'string',format:'uuid'},page={type:'integer',minimum:1},pageSize={type:'integer',minimum:1,maximum:100};
const arrayOfString={type:'array',items:string};
const objectSchema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const user={user_identifier:string,user_identifier_type:string};
const dates={dateRange:{type:'string',enum:['7d','30d','90d','MTD','QTD','custom','all']},dateFrom:string,dateTo:string};
const commonPaging={page,page_size:pageSize};
const read=(kind,label,path,properties={},required=[],extra={})=>({kind,label,method:'GET',path,filtersSchema:objectSchema(properties,required),recordsPath:'',...extra});
export const FUUL_READ_CATALOG=[
 read('projects','Dashboard projects','/api/v1/projects',{page,query:string},[],{authType:'dashboard-oauth',pagination:'page'}),
 read('project','Current project draft','/api/v1/projects/{projectId}',{},[],{authType:'dashboard-oauth'}),
 read('customizations','Published project customizations','/api/v1/projects/{projectId}/customizations',{},[],{authType:'dashboard-oauth'}),
 read('incentives','Draft incentives','/api/v1/projects/{projectId}/incentives',{},[],{authType:'dashboard-oauth'}),
 read('incentive','Original incentive','/api/v1/projects/{projectId}/incentives/{conversion_id}',{conversion_id:uuid},['conversion_id'],{authType:'dashboard-oauth'}),
 read('trigger','Original draft trigger','/api/v1/projects/{projectId}/triggers/{trigger_id}',{trigger_id:uuid},['trigger_id'],{authType:'dashboard-oauth'}),
 read('audiences','Project audiences','/api/v1/projects/{projectId}/audiences',{},[],{authType:'dashboard-oauth'}),
 read('tiers','Project tiers','/api/v1/projects/{projectId}/tiers',{include_payout_terms:{type:'boolean'}},[],{authType:'dashboard-oauth'}),
 read('pending-payouts','Payouts pending approval','/api/v1/projects/{projectId}/payouts/pending-approval',commonPaging,[],{authType:'dashboard-oauth',pagination:'page',recordsPath:'/results'}),
 read('rewards-payouts','Rewards payout history','/api/v1/projects/{projectId}/payouts/rewards-payouts',{...commonPaging,status:string,from_date:string,to_date:string},[],{authType:'dashboard-oauth',pagination:'page',recordsPath:'/results'}),
 read('incentive-stats','Incentive statistics','/api/v1/projects/{projectId}/incentives/{conversion_id}/stats',{conversion_id:uuid,...dates},['conversion_id'],{authType:'dashboard-oauth'}),
 read('incentive-history','Incentive history','/api/v1/projects/{projectId}/incentives/{conversion_id}/history',{conversion_id:uuid,granularity:{type:'string',enum:['daily','weekly','monthly']},...dates},['conversion_id','granularity'],{authType:'dashboard-oauth'}),
 read('incentive-breakdown','Project incentive breakdown','/api/v1/projects/{projectId}/incentives/breakdown',{...dates,sortBy:{type:'string',enum:['unique_users','volume','earnings','revenue']},sortOrder:{type:'string',enum:['asc','desc']}},[],{authType:'dashboard-oauth'}),
 read('chains','Original chain metadata','/public-api/v1/metadata/chains'),
 read('trigger-types','Original trigger schemas','/public-api/v1/metadata/trigger-types'),
 read('payout-schemas','Original payout schemas','/public-api/v1/metadata/payout-schemas'),
 read('currencies','Original currency metadata','/api/v1/currencies',{...commonPaging,price_reference:{type:'boolean'},chain_identifier:string},[],{pagination:'page',recordsPath:'/results'}),
 read('pipeline','Exact event pipeline','/api/v1/events/pipeline',{event_id:uuid,dedup_id:{type:'string',minLength:1,maxLength:200},event_name:string},[],{authType:'project-api-key',identity:'event_id OR dedup_id plus event_name'}),
 read('event-status','Broad event status','/api/v1/events/status',{...user,event_name:string},['user_identifier','user_identifier_type','event_name'],{authType:'project-api-key'}),
 read('payouts','Original user allocations','/api/v1/payouts',{user_identifier:string,identifier_type:string,project_id:uuid,group_by:string,...commonPaging,from:string,to:string,type:{type:'string',enum:['onchain-currency','point']}},['user_identifier','identifier_type'],{authType:'project-api-key',pagination:'page',recordsPath:'/results'}),
 read('movements','Original payout movements','/api/v1/payouts/movements',{user_identifier:string,identifier_type:string,project_id:uuid,...commonPaging,from_date:string,to_date:string,type:{type:'string',enum:['onchain-currency','point']}},['user_identifier','identifier_type'],{authType:'project-api-key',pagination:'page',recordsPath:'/results'}),
 read('payouts-by-referrer','Payouts by referrer','/api/v1/payouts/by-referrer',{...user,referrer_scope:{type:'string',enum:['active','all']},from_date:string,to_date:string},['user_identifier','user_identifier_type'],{authType:'project-api-key'}),
 read('terms-by-tier','Payout terms by tier','/api/v1/payouts/terms-by-tier',{tier_ids:arrayOfString},['tier_ids'],{authType:'project-api-key'}),
 read('claim-checks','Original claim checks','/api/v1/claim-checks',{...user,status:{type:'string',enum:['open','unclaimed','claimed']}},['user_identifier','user_identifier_type'],{authType:'project-api-key',recordsPath:'/claim_checks'}),
 read('claim-totals','Original claim totals by state','/api/v1/claim-checks/totals',{...user,status:{type:'string',enum:['open','closed','claimed','unclaimed']},reason:{type:'string',enum:['affiliate_payout','end_user_payout','agency_payout']}},['user_identifier','user_identifier_type'],{authType:'project-api-key'}),
 read('claim-history','Original transaction and currency claim rows','/api/v1/claim-checks/claim-history',{...user,...commonPaging},['user_identifier','user_identifier_type'],{authType:'project-api-key',pagination:'next_page',recordsPath:'/results',defaultPageSize:25,maximumPageSize:100})
];
const anyObject={type:'object',additionalProperties:true};
const action=(operation,label,properties={},required=[],extra={})=>({operation,label,inputSchema:objectSchema(properties,required),...extra});
const patchTriggerFields={name:string,description:string,event_type:string,condition_expression:string,amount_expression:string,volume_expression:string,revenue_expression:string,currency_expression:string,volume_currency_expression:string,revenue_currency_expression:string,end_user_identifier_property:string,end_user_identifier_expression:string,payable:{type:'boolean'},ref:string,contract_ids:{type:'array',minItems:1,maxItems:1,items:uuid}};
export const FUUL_ACTION_CATALOG=[
 action('event.send','Submit one original event',{body:anyObject},['body'],{authType:'project-api-key',effect:'event-ingestion'}),
 action('event.batch','Submit original event batch',{events:{type:'array',minItems:1,maxItems:100,items:anyObject}},['events'],{authType:'project-api-key',effect:'batch-ingestion-count'}),
 action('claim.close','Close selected original claim checks',{userIdentifier:string,userIdentifierType:string,claim_check_ids:{type:'array',minItems:1,maxItems:10000,items:uuid}},['userIdentifier','userIdentifierType'],{authType:'project-api-key',effect:'claim-prepared'}),
 action('claim.prepare','Prepare current claimable checks',{userIdentifier:string,userIdentifierType:string},['userIdentifier','userIdentifierType'],{authType:'project-api-key',effect:'claim-prepared'}),
 action('payout.approve','Approve selected original payouts',{payout_ids:{type:'array',items:uuid},from_date:string,to_date:string,user_address:string,affiliate_address:string},[],{authType:'dashboard-oauth',effect:'payout-status-changed'}),
 action('payout.reject','Reject selected original payouts',{payout_ids:{type:'array',items:uuid},from_date:string,to_date:string,user_address:string,affiliate_address:string},[],{authType:'dashboard-oauth',effect:'payout-status-changed'}),
 action('trigger.create','Prepare a trigger draft',{trigger:anyObject},['trigger'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('trigger.update','Update the current trigger draft',{trigger_id:uuid,...patchTriggerFields},['trigger_id'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('trigger.delete','Delete selected trigger draft',{trigger_id:uuid},['trigger_id'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('incentive.create','Create original incentive draft',{name:string,trigger_ids:{type:'array',minItems:1,items:uuid},payout_terms:{type:'array',minItems:1,items:anyObject}},['name','trigger_ids','payout_terms'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('incentive.delete','Delete original incentive draft',{conversion_id:uuid},['conversion_id'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('incentive.triggers.update','Replace incentive draft triggers',{conversion_id:uuid,trigger_ids:{type:'array',minItems:1,items:uuid},name:string},['conversion_id','trigger_ids'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('payout-term.update','Update original payout term draft',{conversion_id:uuid,payout_term_id:uuid,payout_term:anyObject},['conversion_id','payout_term_id','payout_term'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('tier.create','Create project tier',{name:string,slug:string,rank:{type:'integer',minimum:1},description:string,audience_id:uuid,requires_manual_project_approval:{type:'boolean'}},['name','slug','rank'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('tier.update','Update project tier',{tier_id:uuid,name:string,description:{type:['string','null']},rank:{type:'integer',minimum:1},audience_id:{type:['string','null'],format:'uuid'}},['tier_id'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('audience.update','Update original audience',{audience_id:uuid,name:string,conditions:{type:'array',items:anyObject},condition_match_mode:{type:'string',enum:['any','all']},contractId:uuid},['audience_id','name'],{authType:'dashboard-oauth',effect:'draft-saved'}),
 action('project.initialize','Initialize selected project chain',{chainId:string},['chainId'],{authType:'dashboard-oauth',effect:'project-chain-initialized'})
];

function identifier(value,name){text(value,name,128);need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),'INVALID_ID',name+' is not a valid provider identifier.');return value;}
function uuidValue(value,name){text(value,name,36);need(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),'INVALID_ID',name+' must be the original provider UUID.');return value;}
function publicOrigin(value){
 let url;try{url=new URL(value??'https://api.fuul.xyz');}catch{throw new FuulError('INVALID_CONNECTION','Select an absolute Fuul API URL.');}
 need(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash&&!url.search,'INVALID_CONNECTION','The Fuul API base must be an origin without credentials or query.');
 need(url.pathname==='/'||url.pathname==='/api/v1'||url.pathname==='/api/v1/','INVALID_CONNECTION','Use the Fuul API origin or its original /api/v1 base.');
 return url;
}
export function describeFuulConnection(connection){
 object(connection,'Fuul connection');if(connection.provider==='stellar')return describeFuulStellar(connection);
 need((connection.provider??'fuul')==='fuul','INVALID_PROVIDER','Select Fuul REST or native Stellar.');
 const url=publicOrigin(connection.baseUrl),network=fuulNetwork(connection.network);
 need(url.protocol==='https:'||connection.allowHttp===true,'INVALID_CONNECTION','Plain HTTP requires the selected local transport option.');
 const projectId=uuidValue(connection.projectId,'Project ID'),authType=connection.authType??'project-api-key';
 need(['project-api-key','dashboard-oauth'].includes(authType),'INVALID_CONNECTION','Select project API key or dashboard OAuth authentication.');
 const accountScope=text(connection.accountScope??projectId,'Account scope',256);
 const binding={provider:'fuul',origin:url.origin,projectId,network:network.network,chainIdentifier:network.chainIdentifier,accountScope};
 const id=sha256(binding);
 return {...binding,id,sourceScope:id,authType};
}
function privateHeaders(value={}){
 object(value,'Private headers');const result={};
 for(const [key,item] of Object.entries(value)){
  need(/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(key)&&typeof item==='string'&&!/[\r\n]/.test(item),'INVALID_CONNECTION','A private HTTP header is malformed.');
  need(!/^(authorization|host|cookie|content-length)$/i.test(key),'INVALID_CONNECTION','Use the dedicated original credential fields for authentication.');
  result[key]=item;
 }return result;
}
function cleanHeaders(source){const result={};for(const [key,value] of source.entries())if(!/^(set-cookie|authorization|proxy-authorization)$/i.test(key))result[key]=value;return result;}
const activeRefreshes=new Map();
async function readTokens(connection){
 if(connection.tokenFile){const path=resolve(text(connection.tokenFile,'Token file',4096));const handle=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();need(stat.isFile()&&stat.size<=1024*1024,'INVALID_CONNECTION','The original OAuth token file is not a small regular file.');return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}}
 return connection.tokens??{access_token:connection.bearerToken,refresh_token:connection.refreshToken,expires_at_ms:null};
}
async function writeTokens(connection,tokens){
 if(!connection.tokenFile){connection.tokens=clone(tokens);connection.bearerToken=tokens.access_token;return;}
 const target=resolve(connection.tokenFile);await fs.mkdir(dirname(target),{recursive:true,mode:0o700});
 const temporary=target+'.pending-'+randomUUID(),handle=await fs.open(temporary,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(tokens,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 await fs.rename(temporary,target);const parent=await fs.open(dirname(target),'r');try{await parent.sync();}finally{await parent.close();}
}
function timeoutSignal(signal,timeout){
 const controller=new AbortController(),cancel=()=>controller.abort(signal?.reason);
 if(signal){if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});}
 const timer=setTimeout(()=>controller.abort(),timeout);
 return {signal:controller.signal,close(){clearTimeout(timer);signal?.removeEventListener('abort',cancel);}};
}
async function readResponseBody(response,signal,maximumBytes=MAXIMUM_BODY){
 let bytes=0,bodyComplete=true,error=null;const parts=[];
 try{if(response.body)for await(const chunk of response.body){
  if(signal.aborted)throw signal.reason??new Error('Aborted');const part=Buffer.from(chunk),remaining=maximumBytes-bytes;
  if(part.length>remaining){if(remaining>0){parts.push(part.subarray(0,remaining));bytes+=remaining;}bodyComplete=false;error={code:'RESPONSE_TOO_LARGE',message:'The original response exceeds the selected source limit.'};break;}
  parts.push(part);bytes+=part.length;
 }}catch{bodyComplete=false;error={code:signal.aborted?'INTERRUPTED':'RESPONSE_INTERRUPTED',message:'The original HTTP response ended before completion.'};}
 return {body:Buffer.concat(parts,bytes),bodyComplete,error};
}
function wirePath(path){
 text(path,'Original API path',8192);
 need(path.startsWith('/')&&!path.startsWith('//')&&!/[\\#\u0000-\u0020]/.test(path),'INVALID_NATIVE_PATH','Use an original absolute API path on the selected origin.');
 const url=new URL(path,'https://selected.invalid');need(url.origin==='https://selected.invalid'&&url.pathname===path.split('?')[0]&&!/%(?:2f|5c|2e)/i.test(url.pathname),'INVALID_NATIVE_PATH','The original API path must not escape its selected endpoint.');
 return url;
}
function queryString(query={}){
 const result=new URLSearchParams();for(const [key,value] of Object.entries(query)){if(value===undefined||value===null||value==='')continue;if(Array.isArray(value))for(const part of value)result.append(key,String(part));else result.append(key,String(value));}return result.toString();
}
async function exchange(connection,prepared,{signal,bearerToken,privateExchange=false}={}){
 const descriptor=describeFuulConnection(connection),url=wirePath(prepared.path);
 const method=prepared.method??'GET';need(['GET','POST','PATCH','DELETE'].includes(method),'INVALID_NATIVE_METHOD','Select an original supported Fuul method.');
 const query=prepared.query??{};const append=queryString(query);if(append)for(const [key,value] of new URLSearchParams(append))url.searchParams.append(key,value);
 const target=new URL(url.pathname+url.search,descriptor.origin),timeout=safeInteger(connection.timeoutMs??30000,'HTTP timeout',{minimum:1,maximum:120000});
 const body=prepared.bodyBytes!==undefined?Buffer.from(prepared.bodyBytes):prepared.body===undefined?undefined:Buffer.from(JSON.stringify(prepared.body));
 if(body!==undefined){need(body.length<=MAXIMUM_BODY,'REQUEST_TOO_LARGE','The original request exceeds 64 MiB.');if(prepared.bodySha256)need(sha256(body)===prepared.bodySha256,'REQUEST_CHANGED','The sealed original request bytes changed.');}
 const request={method,path:target.pathname+target.search,origin:descriptor.origin,query:clone(query),...(body===undefined?{}:{body:prepared.body??JSON.parse(body.toString('utf8')),bodySha256:sha256(body),bodyBytes:body.length})};
 const observedAt=new Date().toISOString(),deadline=timeoutSignal(signal,timeout);let response,error=null;
 try{
   const received=await fetch(target,{method,headers:{...privateHeaders(connection.headers),accept:'application/json',...(body?{'content-type':'application/json'}:{}),...(bearerToken?{Authorization:'Bearer '+bearerToken}:{})},body,signal:deadline.signal,redirect:'manual'});
   const retained=await readResponseBody(received,deadline.signal);
   response={status:received.status,headers:cleanHeaders(received.headers),body:retained.body,bodyComplete:retained.bodyComplete,observedAt,finishedAt:new Date().toISOString()};
   error=retained.error;
   if(received.status>=300&&received.status<400)error={code:'REDIRECT_REJECTED',message:'The selected provider returned a redirect; the original response is retained.'};
 }catch{response={status:0,headers:{},body:Buffer.alloc(0),bodyComplete:false,observedAt,finishedAt:new Date().toISOString()};error={code:deadline.signal.aborted?'INTERRUPTED':'TRANSPORT_ERROR',message:'The original Fuul request did not return a complete response.'};}
 finally{deadline.close();}
 let value=null,originalValue=null;
 if(response.bodyComplete&&response.body.length){try{const parsed=parseFuulJSON(response.body);value=parsed.value;originalValue=JSON.parse(response.body.toString('utf8'));}catch{error??={code:'INVALID_SOURCE_JSON',message:'The original Fuul response is not valid JSON.'};}}
 const result={request,response,value,originalValue,descriptor,...(error?{error}:{})};
 // OAuth refresh calls use this same bounded transport, but their credential bytes never enter source records.
 if(privateExchange)delete result.request;
 return result;
}
async function refreshTokens(connection,previous,{signal}={}){
 const key=connection.tokenFile?resolve(connection.tokenFile):connection;
 if(activeRefreshes.has(key))return activeRefreshes.get(key);
 const task=(async()=>{
   const current=await readTokens(connection);
   if(current?.access_token&&current.access_token!==previous?.access_token)return current;
   if(!current?.refresh_token)return null;
   const result=await exchange(connection,{method:'POST',path:'/oauth/token',body:{grant_type:'refresh_token',refresh_token:current.refresh_token}},{signal,privateExchange:true});
   const data=result.originalValue;
   if(result.error||result.response.status!==200||typeof data?.access_token!=='string'||typeof data.refresh_token!=='string')return null;
   const expires=Number(data.expires_in);need(Number.isFinite(expires),'INVALID_OAUTH_RESPONSE','The original OAuth response omitted its expiration.');
   const tokens={access_token:data.access_token,refresh_token:data.refresh_token,expires_at_ms:Date.now()+Math.max(0,expires)*1000};
   await writeTokens(connection,tokens);return tokens;
 })();
 activeRefreshes.set(key,task);try{return await task;}finally{if(activeRefreshes.get(key)===task)activeRefreshes.delete(key);}
}
async function authorized(connection,prepared,{signal,authType}={}){
 const descriptor=describeFuulConnection(connection);
 if(authType)need(descriptor.authType===authType,'AUTHENTICATION_SCOPE_MISMATCH','This original endpoint requires '+authType+'.');
 let tokens=null,bearer;
 if(descriptor.authType==='project-api-key')bearer=connection.apiKey??connection.bearerToken;
 else{tokens=await readTokens(connection);bearer=tokens?.access_token;}
 need(typeof bearer==='string'&&bearer.length>0&&!/[\r\n]/.test(bearer),'CREDENTIAL_REQUIRED','Configure the original selected Fuul credential in the private host connection.');
 const first=await exchange(connection,prepared,{signal,bearerToken:bearer}),exchanges=[];
 if(descriptor.authType==='dashboard-oauth'&&first.response.status===401&&first.response.bodyComplete){
   let next=null;try{next=await refreshTokens(connection,tokens,{signal});}catch{}
   if(next?.access_token){exchanges.push(first);const result=await exchange(connection,prepared,{signal,bearerToken:next.access_token});return {...result,exchanges};}
 }
 return {...first,exchanges};
}
let originalCapsulePromise=null;
const moduleURLCache=new Map();
async function originalCapsule(){
 if(!originalCapsulePromise)originalCapsulePromise=(async()=>{
   const body=await fs.readFile(resolve(SOURCE_DIRECTORY,'source/mcp.json'));
   need(sha256(body)===MCP_SOURCE_SHA256,'ORIGINAL_SOURCE_CHANGED','The retained original Fuul MCP source capsule changed.');
   const capsule=JSON.parse(body.toString('utf8'));
   need(capsule.publisher?.commit==='8850cafda1f951bb46e8764e98a4f5bde1ffab0d'&&Array.isArray(capsule.files),'ORIGINAL_SOURCE_CHANGED','The original MCP source revision differs.');
   return new Map(capsule.files.map(file=>[file.path,file]));
 })();
 return originalCapsulePromise;
}
async function originalModuleURL(path,stack=[]){
 if(moduleURLCache.has(path))return moduleURLCache.get(path);
 need(!stack.includes(path),'ORIGINAL_SOURCE_CYCLE','The selected original helper import graph contains a cycle.');
 const files=await originalCapsule(),file=files.get(path);
 need(file&&typeof file.content==='string'&&Buffer.byteLength(file.content)===file.bytes&&sha256(file.content)===file.sha256,'ORIGINAL_SOURCE_CHANGED','A selected original helper file differs.',{path});
 need(typeof stripTypeScriptTypes==='function','NODE_RUNTIME_REQUIRED','Original TypeScript helper execution requires Node 22.16 or later.');
 let compiled=stripTypeScriptTypes(file.content,{mode:'transform',sourceMap:false});
 const imports=[...compiled.matchAll(/(?:^|\n)(\s*(?:import|export)\s+(?:(?:[^'";]|\n)*?\s+from\s+)?)(["'])([^"']+)\2/g)];
 for(const match of imports){
   const specifier=match[3];need(specifier.startsWith('.'),'ORIGINAL_DEPENDENCY_UNSUPPORTED','This selected original pure helper requires an external runtime.',{path,specifier});
   const dependency=posix.normalize(posix.join(posix.dirname(path),specifier)).replace(/\.js$/,'.ts');
   need(!dependency.startsWith('../')&&!dependency.startsWith('/'),'ORIGINAL_SOURCE_ESCAPE','The original helper leaves its source capsule.');
   const url=await originalModuleURL(dependency,[...stack,path]);
   compiled=compiled.replace(match[0],()=>match[0].replace(match[2]+specifier+match[2],()=>JSON.stringify(url)));
 }
 need(!/\bimport\s*\(/.test(compiled),'ORIGINAL_DYNAMIC_IMPORT_UNSUPPORTED','The selected original helper requires an undeclared dynamic import.');
 const url='data:text/javascript;base64,'+Buffer.from(compiled).toString('base64');
 moduleURLCache.set(path,url);return url;
}
async function originalModule(path){return import(await originalModuleURL(path));}
function validateSchema(value,schema,name){
 if(schema.type==='object'){object(value,name);if(schema.additionalProperties===false)for(const key of Object.keys(value))need(Object.hasOwn(schema.properties??{},key),'INVALID_ARGUMENT','The original input does not accept this field.',{name,key});for(const key of schema.required??[])need(value[key]!==undefined&&value[key]!==null,'INVALID_ARGUMENT','The original input requires '+key+'.');for(const [key,item] of Object.entries(value))if(schema.properties?.[key])validateSchema(item,schema.properties[key],name+'.'+key);return;}
 if(Array.isArray(schema.type)){if(value===null&&schema.type.includes('null'))return;return validateSchema(value,{...schema,type:schema.type.find(item=>item!=='null')},name);}
 if(schema.type==='array'){list(value,name);need((schema.minItems===undefined||value.length>=schema.minItems)&&(schema.maxItems===undefined||value.length<=schema.maxItems),'INVALID_ARGUMENT',name+' has an invalid length.');if(schema.items)for(const item of value)validateSchema(item,schema.items,name+'[]');return;}
 if(schema.type==='string'){text(value,name,schema.maxLength??8192);if(schema.format==='uuid')uuidValue(value,name);}
 if(schema.type==='integer')safeInteger(value,name,{minimum:schema.minimum??0,maximum:schema.maximum??Number.MAX_SAFE_INTEGER});
 if(schema.type==='boolean')need(typeof value==='boolean','INVALID_ARGUMENT',name+' must be boolean.');
 if(schema.enum)need(schema.enum.includes(value),'INVALID_ARGUMENT',name+' is not an original supported option.');
}
function projectPath(path,projectId,filters){
 return path.replace(/\{([^}]+)\}/g,(_,key)=>encodeURIComponent(key==='projectId'?projectId:uuidValue(filters[key],key)));
}
function nativeSelection(value,entry){
 if(value===null||value===undefined)return {records:[],recordsPath:entry.recordsPath};
 if(entry.kind==='pipeline'||entry.kind==='event-status'||entry.kind==='claim-totals')return {records:[value],recordsPath:''};
 if(Array.isArray(value))return {records:value,recordsPath:''};
 const named=entry.recordsPath?.slice(1);if(named&&Array.isArray(value[named]))return {records:value[named],recordsPath:entry.recordsPath};
 for(const key of ['results','items','data','projects'])if(Array.isArray(value[key]))return {records:value[key],recordsPath:'/'+key};
 return {records:[value],recordsPath:''};
}
function continuationFor(entry,request,filters,value,rows){
 if(!entry.pagination)return {done:true,next:null};
 let nextPage=null;const current=safeInteger(request.cursor?.page??filters.page??1,'Current page',{minimum:1});
 if(value&&Object.hasOwn(value,'next_page')){if(value.next_page!==null&&value.next_page!==false&&value.next_page!==undefined)nextPage=safeInteger(value.next_page,'Original next_page',{minimum:1});}
 else if(value&&Object.hasOwn(value,'nextPage')){if(value.nextPage!==null&&value.nextPage!==false)nextPage=safeInteger(value.nextPage,'Original nextPage',{minimum:1});}
 else if(value&&Object.hasOwn(value,'total_results')){
   const size=safeInteger(value.page_size??filters.page_size??request.pageSize??100,'Original page size',{minimum:1});
   const originalPage=safeInteger(value.page??current,'Original page',{minimum:1});need(originalPage===current,'NATIVE_PAGE_MISMATCH','The original response page differs from the selected page.');
   if(BigInt(originalPage)*BigInt(size)<BigInt(String(value.total_results)))nextPage=current+1;
 }else if(value&&Object.hasOwn(value,'total_pages')){if(current<Number(value.total_pages))nextPage=current+1;}
 else if(Array.isArray(value)||Array.isArray(value?.results)||Array.isArray(value?.data)||Array.isArray(value?.items)||Array.isArray(value?.projects)){if(rows.length)nextPage=current+1;}
 else throw new FuulError('PAGINATION_SHAPE_CHANGED','The original paged response omitted a recognizable native page shape.');
 if(nextPage!==null)need(nextPage>current,'NATIVE_PAGE_DID_NOT_ADVANCE','The original page continuation did not advance.');
 return {done:nextPage===null,next:nextPage===null?null:{kind:request.kind,filters:clone(filters),pageSize:request.pageSize??entry.defaultPageSize??100,cursor:{page:nextPage}}};
}
export function openFuulSource(connection){
 object(connection,'Native source connection');if(connection.provider==='stellar')return openFuulStellarSource(connection);
 const descriptor=describeFuulConnection(connection);
 return {descriptor,catalog:clone(FUUL_READ_CATALOG),actionCatalog:clone(FUUL_ACTION_CATALOG),describe(){return {descriptor,catalog:clone(FUUL_READ_CATALOG),actionCatalog:clone(FUUL_ACTION_CATALOG)};},async read(request){
   object(request,'Original read request');const entry=FUUL_READ_CATALOG.find(item=>item.kind===request.kind);need(entry,'UNKNOWN_READ_KIND','Select an original Fuul read.');
   const filters=clone(request.filters??{});validateSchema(filters,entry.filtersSchema,'filters');
   if(filters.project_id!==undefined)need(filters.project_id===descriptor.projectId,'PROJECT_SCOPE_MISMATCH','The selected original connection belongs to another project.');
   if(entry.kind==='pipeline'){const id=!!filters.event_id,pair=!!filters.dedup_id&&!!filters.event_name;need(id!==pair&&(!id||(!filters.dedup_id&&!filters.event_name)),'INVALID_PIPELINE_QUERY','Select event_id or the exact dedup_id and event_name pair.');}
   if(entry.kind==='payouts-by-referrer')need(Boolean(filters.from_date)===Boolean(filters.to_date),'INVALID_FILTER','The original referrer date interval requires both endpoints.');
   let path=projectPath(entry.path,descriptor.projectId,filters),query=clone(filters);
   for(const key of ['conversion_id','trigger_id'])delete query[key];
   if(['payouts','movements'].includes(entry.kind))query.project_id=descriptor.projectId;
   if(entry.pagination){
     query.page=safeInteger(request.cursor?.page??filters.page??1,'Original page',{minimum:1});
     if(Object.hasOwn(entry.filtersSchema.properties,'page_size'))query.page_size=safeInteger(request.pageSize??filters.page_size??entry.defaultPageSize??100,'Native page size',{minimum:1,maximum:entry.maximumPageSize??100});
   }
   if(entry.kind==='terms-by-tier')query.tier_ids=filters.tier_ids.join(',');
   if(['incentive-stats','incentive-history','incentive-breakdown'].includes(entry.kind)){
     const original=await originalModule('src/incentive-analytics/incentive-analytics-queries.ts');
     const builder={'incentive-stats':original.incentiveStatsPath,'incentive-history':original.incentiveHistoryPath,'incentive-breakdown':original.projectIncentivesBreakdownPath}[entry.kind];
     path=builder({...filters,project_id:descriptor.projectId});query={};
   }
   const result=await authorized(connection,{method:'GET',path,query},{signal:request.signal,authType:entry.authType});
   const {originalValue,...retained}=result;let error=result.error,selection={records:[],recordsPath:entry.recordsPath},continuation={done:false,next:{kind:request.kind,filters,pageSize:request.pageSize??100,...(request.cursor?{cursor:clone(request.cursor)}:{})}};
   const observedNotFound=entry.kind==='pipeline'&&result.response.status===404&&result.response.bodyComplete;
   if(!error&&((result.response.status>=200&&result.response.status<300)||observedNotFound)){
     selection=nativeSelection(result.value,entry);
     try{continuation=observedNotFound?{done:true,next:null}:continuationFor(entry,request,filters,result.value,selection.records);}catch(cause){error={code:cause.code??'NATIVE_PAGINATION_ERROR',message:cause.message};}
   }else if(!error)error={code:'HTTP_ERROR',message:'The original Fuul read returned HTTP '+result.response.status+'.',details:{status:result.response.status}};
   return {...retained,...selection,continuation,observedNotFound,...(error?{error}:{}),exchanges:(result.exchanges??[]).map(({originalValue,...item})=>item)};
 }};
}

function eventBody(value,descriptor){
 object(value,'Original event body');const allowed=new Set(['name','dedup_id','user','args','timestamp']);
 for(const key of Object.keys(value))need(allowed.has(key),'INVALID_EVENT','The selected event body contains an unsupported top-level field.',{key});
 text(value.name,'Event name',256);text(value.dedup_id,'Original dedup_id',200);
 object(value.user,'Event user');text(value.user.identifier,'Original user identifier',512);text(value.user.identifier_type,'Original user identifier type',64);
 need(Object.keys(value.user).every(key=>['identifier','identifier_type'].includes(key)),'INVALID_EVENT','The original event user has unsupported fields.');
 if(value.user.identifier_type==='stellar_address')stellarAddress(value.user.identifier,'Event account',{kind:'account'});
 if(value.timestamp!==undefined)safeInteger(value.timestamp,'Original timestamp',{minimum:0});
 if(value.args!==undefined){object(value.args,'Original event arguments');for(const key of ['value','revenue']){
  const monetary=value.args[key];if(monetary===undefined||monetary===null)continue;
  object(monetary,key);need(typeof monetary.amount==='string'&&/^(?:0|[1-9]\d*)$/.test(monetary.amount),'INVALID_AMOUNT','Event '+key+'.amount must be exact integer text.');
  object(monetary.currency,key+' currency');
  if(monetary.currency.identifier_type==='stellar_contract'){
   stellarAddress(monetary.currency.identifier,'Event currency',{kind:'contract'});
   need(typeof monetary.currency.chain_identifier==='number'&&monetary.currency.chain_identifier===descriptor.chainIdentifier,'NETWORK_MISMATCH','The Stellar event currency must use the exact numeric selected chain identifier.');
  }
 }}
 return clone(value);
}
function takeFields(input,fields){return Object.fromEntries(fields.filter(key=>Object.hasOwn(input,key)).map(key=>[key,clone(input[key])]));}
function businessKind(path){
 if(/\/customizations(?:\?|$)/.test(path))return 'customizations';
 if(/\/projects\/[^/]+(?:\?|$)/.test(path))return 'project';
 if(/\/incentives\/[^/]+(?:\?|$)/.test(path))return 'incentive';
 if(/\/currencies(?:\?|$)/.test(path))return 'currencies';
 if(/\/claim-checks(?:\?|$)/.test(path))return 'claim-checks';
 return 'configuration';
}
function observation(result,path){
 const {originalValue,value,exchanges,descriptor,...rest}=result;
 const kind=businessKind(path),entry=FUUL_READ_CATALOG.find(item=>item.kind===kind)??{kind,recordsPath:''};
 return {...rest,kind,records:nativeSelection(value,entry).records,recordsPath:nativeSelection(value,entry).recordsPath,descriptor};
}
function prepareError(cause,observations){
 if(cause instanceof FuulError){cause.observations=observations;return cause;}
 const error=new FuulError('ORIGINAL_PREPARATION_FAILED','The original Fuul preparation helper rejected this selection.',{reason:typeof cause?.message==='string'?cause.message.slice(0,4000):null});
 error.observations=observations;return error;
}
/** Resolve current original draft identities and prepare exact write bytes without dispatching. */
export async function prepareFuulAction({connection,operation,input,programme,signal}){
 if(connection.provider==='stellar')return prepareFuulStellarAction({connection,operation,input,programme,signal});
 const descriptor=describeFuulConnection(connection);
 need(descriptor.provider==='fuul','INVALID_PROVIDER','This preparation selects the original Fuul REST action catalog.');
 const entry=FUUL_ACTION_CATALOG.find(item=>item.operation===operation);need(entry,'UNKNOWN_ACTION','Select an original supported Fuul action.');
 const data=clone(input??{});object(data,'Original action input');
 const suppliedProject=data.project_id??data.projectId;if(suppliedProject!==undefined)need(suppliedProject===descriptor.projectId,'PROJECT_SCOPE_MISMATCH','The input refers to another original project.');
 delete data.project_id;delete data.projectId;delete data.dry_run;delete data.confirmed;
 validateSchema(data,entry.inputSchema,'input');
 need(entry.authType===descriptor.authType,'AUTHENTICATION_SCOPE_MISMATCH','This original action requires '+entry.authType+'.');
 const selectedProgramme=programme?.definition??programme;
 if(selectedProgramme){if(selectedProgramme.projectId)need(selectedProgramme.projectId===descriptor.projectId,'PROJECT_SCOPE_MISMATCH','The saved programme belongs to another Fuul project.');if(selectedProgramme.network)need(fuulNetwork(selectedProgramme.network).network===descriptor.network,'NETWORK_MISMATCH','The saved programme selects another native network.');}
 const observations=[],prerequisites=[],resolution=[],notices=[];const projectId=descriptor.projectId,base='/api/v1/projects/'+encodeURIComponent(projectId);
 let method='POST',path,body,project=null,scoped=null;
 const api={async getJson(selectedPath,options={}){
   const result=await authorized(connection,{method:'GET',path:selectedPath,query:options.query??{}},{authType:'dashboard-oauth'});
   for(const prior of result.exchanges??[])observations.push(observation(prior,selectedPath));observations.push(observation(result,selectedPath));
   if(result.error||result.response.status<200||result.response.status>=300)throw new FuulError('PREPARATION_SOURCE_FAILED','The original provider configuration could not be read.',{path:selectedPath,status:result.response.status});
   return result.originalValue;
 }};
 async function currentProject(){
   if(!project)project=await api.getJson(base);
   need(project!==null&&typeof project==='object'&&!Array.isArray(project),'INVALID_PROJECT_SOURCE','The original project response is not an object.');
   if(project.id!==undefined)need(String(project.id)===projectId,'PROJECT_SCOPE_MISMATCH','The original project response belongs to another project.');
   return project;
 }
 async function scope(){
   if(!scoped){const original=await originalModule('src/metadata-scope/enrich-responses.ts');scoped=original.enrichProjectWithMetadataScope(await currentProject(),await api.getJson(base+'/customizations'));}
   return scoped;
 }
 async function trigger(id){
   const original=await originalModule('src/metadata-scope/resolve-draft-ids.ts');
   const selected=original.resolveDraftTriggerIdFromProject(await scope(),uuidValue(id,'Original trigger ID'));resolution.push(selected);return selected;
 }
 async function conversion(id){
   const original=await originalModule('src/metadata-scope/resolve-draft-ids.ts');
   const selected=original.resolveDraftConversionIdFromProject(await scope(),uuidValue(id,'Original incentive ID'));resolution.push(selected);return selected;
 }
 async function payoutTerms(terms){
   const original=await originalModule('src/payouts/normalize-payout-term-body.ts'),result=[];
   for(let index=0;index<terms.length;index++){
     const prepared=original.preparePayoutTermBodyForWrite(object(terms[index],'Payout term'));
     notices.push({payoutTerm:index,amountRounding:clone(prepared.amountRounding),warnings:clone(prepared.warnings)});
     need(!prepared.validationErrors.length,'INVALID_PAYOUT_TERM','The original Fuul payout term validator rejected this body.',{index,validationErrors:clone(prepared.validationErrors)});
     result.push(prepared.body);
   }
   const originalChain=await originalModule('src/projects/ensure-project-chain-for-on-chain-payouts.ts');
   const chain=await originalChain.ensureProjectChainForOnChainPayouts(api,projectId,result,true);
   notices.push({projectChain:clone(chain)});
   if(chain.would_patch_initialize){
     prerequisites.push({schema:'stellar-forge.fuul-prepared-action.v1',kind:'fuul-action',operation:'project.initialize',projectId,network:descriptor.network,connection:clone(descriptor),request:{method:'PATCH',path:chain.would_patch_initialize.path,body:clone(chain.would_patch_initialize.body)},effect:'project-chain-initialized',identity:{projectId,chainId:chain.chain_id},prerequisites:[],observations:[]});
   }
   return result;
 }
 try{
   if(operation==='event.send'){path='/api/v1/events';body=eventBody(data.body,descriptor);}
   else if(operation==='event.batch'){path='/api/v1/events/batch';body=data.events.map(item=>eventBody(item,descriptor));need(new Set(body.map(item=>item.name+'\u0000'+item.dedup_id)).size===body.length,'DUPLICATE_BATCH_IDENTITY','Each original event identity may occur once in the selected batch.');}
   else if(operation==='claim.close'||operation==='claim.prepare'){
     path='/api/v1/claim-checks/'+(operation==='claim.close'?'close':'claim');
     body=takeFields(data,['userIdentifier','userIdentifierType',...(operation==='claim.close'?['claim_check_ids']:[])]);
     if(body.userIdentifierType==='stellar_address')stellarAddress(body.userIdentifier,'Claim user',{kind:'account'});
     if(body.claim_check_ids)need(new Set(body.claim_check_ids).size===body.claim_check_ids.length,'DUPLICATE_CLAIM_ID','Select each original claim check once.');
     const metadata=await authorized(connection,{method:'GET',path:'/api/v1/claim-checks',query:{user_identifier:body.userIdentifier,user_identifier_type:body.userIdentifierType,status:operation==='claim.close'?'open':'unclaimed'}},{authType:'project-api-key'});
     for(const prior of metadata.exchanges??[])observations.push(observation(prior,'/api/v1/claim-checks'));observations.push(observation(metadata,'/api/v1/claim-checks'));
     need(!metadata.error&&metadata.response.status>=200&&metadata.response.status<300,'PREPARATION_SOURCE_FAILED','The original claim metadata could not be read.',{status:metadata.response.status});
     if(operation==='claim.close'){
       const rows=metadata.originalValue?.claim_checks;
       need(Array.isArray(rows),'PREPARATION_SOURCE_CHANGED','The original claim metadata did not return claim_checks.');
       const selectedRows=new Map(rows.map(row=>[row.id,row]));
       const ids=body.claim_check_ids??rows.filter(row=>body.userIdentifierType!=='stellar_address'||row.currency_chain_id===undefined||Number(row.currency_chain_id)===descriptor.chainIdentifier).map(row=>row.id);
       need(ids.length>0,'NO_OPEN_CLAIM_CHECKS','The selected original user has no matching open checks.');
       for(const id of ids){uuidValue(id,'Claim check ID');const row=selectedRows.get(id);need(row,'CLAIM_SOURCE_MISMATCH','A selected original claim check is absent from this user and state.',{claimId:id});if(body.userIdentifierType==='stellar_address'&&row.currency_chain_id!==undefined)need(Number(row.currency_chain_id)===descriptor.chainIdentifier,'NETWORK_MISMATCH','A selected original claim check belongs to another native network.',{claimId:id});}
       const groups=[];for(let index=0;index<ids.length;index+=100)groups.push(ids.slice(index,index+100));
       body.claim_check_ids=groups.pop();
       for(const group of groups){const childBody={userIdentifier:body.userIdentifier,userIdentifierType:body.userIdentifierType,claim_check_ids:group};prerequisites.push({schema:'stellar-forge.fuul-prepared-action.v1',kind:'fuul-action',operation:'claim.close',projectId,network:descriptor.network,connection:clone(descriptor),request:{method:'POST',path,body:childBody},effect:'claim-prepared',identity:{projectId,operation:'claim.close',claimCheckIds:group},correlation:{projectId,userIdentifier:body.userIdentifier},prerequisites:[],observations:[],preview:{selectedClaimCheckIds:group}});}
       resolution.push({kind:'claim-check-selection',selectedClaimCheckIds:ids,requests:groups.length+1,maximumPerRequest:100});
     }
   }else if(operation==='payout.approve'||operation==='payout.reject'){
     method='PATCH';path=base+'/payouts/'+operation.split('.')[1];body=takeFields(data,['payout_ids','from_date','to_date','user_address','affiliate_address']);
     need(!(body.payout_ids?.length&&(body.from_date||body.to_date)),'INVALID_PAYOUT_SELECTION','Original payout IDs and date filters are mutually exclusive.');
     await currentProject();
   }else if(operation==='trigger.create'){
     path=base+'/triggers';body=clone(data.trigger);
     text(body.name,'Trigger name');text(body.description,'Trigger description');text(body.type,'Original trigger type');
     need(body.volume_expression===undefined,'INVALID_TRIGGER_CREATE','Use original amount_expression on create; volume_expression is only accepted by PATCH.');
     await currentProject();
     const original=await originalModule('src/triggers/validate-token-holder-price-reference.ts');await original.assertTokenHolderPriceReferenceValid(api,body);
   }else if(operation==='trigger.update'||operation==='trigger.delete'){
     const selected=await trigger(data.trigger_id);path=base+'/triggers/'+encodeURIComponent(selected.resolved_draft_trigger_id);
     if(operation==='trigger.delete'){method='DELETE';body=undefined;}
     else{method='PATCH';body=takeFields(data,Object.keys(patchTriggerFields));need(Object.keys(body).length,'EMPTY_PATCH','Select at least one original trigger field to update.');}
   }else if(operation==='incentive.create'){
     path=base+'/incentives';const selected=[];for(const id of data.trigger_ids)selected.push(await trigger(id));
     body={name:data.name,trigger_ids:selected.map(item=>item.resolved_draft_trigger_id),payout_terms:await payoutTerms(data.payout_terms)};
   }else if(operation==='incentive.delete'){
     const selected=await conversion(data.conversion_id);method='DELETE';path=base+'/incentives/'+encodeURIComponent(selected.resolved_draft_conversion_id);body=undefined;
   }else if(operation==='incentive.triggers.update'){
     const selected=await conversion(data.conversion_id),triggers=[];for(const id of data.trigger_ids)triggers.push(await trigger(id));
     let name=data.name;if(name===undefined){const original=await api.getJson(base+'/incentives/'+encodeURIComponent(selected.resolved_draft_conversion_id));name=original?.name;}
     text(name,'Original incentive name');method='PATCH';path=base+'/conversions/'+encodeURIComponent(selected.resolved_draft_conversion_id);
     body={name,trigger_refs:triggers.map(item=>item.ref)};
   }else if(operation==='payout-term.update'){
     const selected=await conversion(data.conversion_id);method='PATCH';path=base+'/conversions/'+encodeURIComponent(selected.resolved_draft_conversion_id)+'/payout_terms/'+encodeURIComponent(data.payout_term_id);
     body=(await payoutTerms([data.payout_term]))[0];
   }else if(operation==='tier.create'){
     await currentProject();path=base+'/tiers';body=takeFields(data,['name','slug','rank','description','audience_id','requires_manual_project_approval']);
     need(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug),'INVALID_TIER_SLUG','The original tier slug must be lowercase kebab case.');
   }else if(operation==='tier.update'){
     await currentProject();method='PATCH';path=base+'/tiers/'+encodeURIComponent(data.tier_id);body=takeFields(data,['name','description','rank','audience_id']);
     need(Object.keys(body).length,'EMPTY_PATCH','Select at least one original tier field.');
   }else if(operation==='audience.update'){
     await currentProject();method='PATCH';path=base+'/audiences/'+encodeURIComponent(data.audience_id);body=takeFields(data,['name','conditions','condition_match_mode','contractId']);
     if(body.conditions?.length)need(['any','all'].includes(body.condition_match_mode),'INVALID_AUDIENCE','The original conditions require their any/all match mode.');
   }else if(operation==='project.initialize'){
     await currentProject();method='PATCH';path=base+'/initialize';body={chainId:data.chainId};
     need(!project.contract_address,'PROJECT_ALREADY_DEPLOYED','The original project already has a deployed contract.');
     if(project.contract_chain_id!==null&&project.contract_chain_id!==undefined)need(String(project.contract_chain_id)===String(data.chainId),'PROJECT_CHAIN_MISMATCH','The original selected project has another chain.');
   }else throw new FuulError('UNKNOWN_ACTION','Select an original native Fuul action.');
   wirePath(path);
   const request={method,path,...(body===undefined?{}:{body:clone(body)})};
   return {schema:'stellar-forge.fuul-prepared-action.v1',kind:'fuul-action',operation,projectId,network:descriptor.network,connection:clone(descriptor),request,effect:entry.effect,identity:{projectId,operation,...(resolution.length?{resolution:clone(resolution)}:{})},correlation:operation==='event.send'?{projectId,dedupId:body.dedup_id,eventName:body.name,userIdentifier:body.user.identifier}:null,prerequisites,observations,preview:{requested:clone(data),resolvedDraftIds:resolution,notices,metadataScope:scoped?{triggers:clone(scoped.triggers),conversions:clone(scoped.conversions),metadata_versions:clone(scoped.metadata_versions)}:null,helperSource:{repository:'kuyen-labs/mcp_server',commit:'8850cafda1f951bb46e8764e98a4f5bde1ffab0d',capsuleSha256:MCP_SOURCE_SHA256}}};
 }catch(cause){throw prepareError(cause,observations);}
}
function routeMatches(operation,request,projectId){
 const path=wirePath(request.path);need(!path.search,'ACTION_PATH_CHANGED','Prepared mutations do not carry an unselected query.');
 const base='/api/v1/projects/'+encodeURIComponent(projectId),id='[0-9a-fA-F-]{36}';
 const routes={
  'event.send':['POST',/^\/api\/v1\/events$/],
  'event.batch':['POST',/^\/api\/v1\/events\/batch$/],
  'claim.close':['POST',/^\/api\/v1\/claim-checks\/close$/],
  'claim.prepare':['POST',/^\/api\/v1\/claim-checks\/claim$/],
  'payout.approve':['PATCH',new RegExp('^'+base+'/payouts/approve$')],
  'payout.reject':['PATCH',new RegExp('^'+base+'/payouts/reject$')],
  'trigger.create':['POST',new RegExp('^'+base+'/triggers$')],
  'trigger.update':['PATCH',new RegExp('^'+base+'/triggers/'+id+'$')],
  'trigger.delete':['DELETE',new RegExp('^'+base+'/triggers/'+id+'$')],
  'incentive.create':['POST',new RegExp('^'+base+'/incentives$')],
  'incentive.delete':['DELETE',new RegExp('^'+base+'/incentives/'+id+'$')],
  'incentive.triggers.update':['PATCH',new RegExp('^'+base+'/conversions/'+id+'$')],
  'payout-term.update':['PATCH',new RegExp('^'+base+'/conversions/'+id+'/payout_terms/'+id+'$')],
  'tier.create':['POST',new RegExp('^'+base+'/tiers$')],
  'tier.update':['PATCH',new RegExp('^'+base+'/tiers/'+id+'$')],
  'audience.update':['PATCH',new RegExp('^'+base+'/audiences/'+id+'$')],
  'project.initialize':['PATCH',new RegExp('^'+base+'/initialize$')]
 };
 const selected=routes[operation];need(selected&&request.method===selected[0]&&selected[1].test(path.pathname),'ACTION_PATH_CHANGED','The sealed action differs from its original supported operation.');
}
function retryAfter(response){
 const value=response.headers?.['retry-after'];if(value===undefined)return null;
 if(/^\d+$/.test(value))return Number(value);
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,Math.ceil((date-Date.now())/1000)):null;
}
function outcomeFor(entry,result){
 const status=result.response.status,bodyComplete=result.response.bodyComplete;
 let selected='FAILED',mutationObserved=false,pipelineRequired=false;
 if(!bodyComplete||status===0||status>=500){selected='UNCERTAIN';mutationObserved=status>=200&&status<300;pipelineRequired=entry.operation.startsWith('event.');}
 else if(entry.operation==='event.send'&&status===409){selected='DUPLICATE';pipelineRequired=true;}
 else if(status>=200&&status<300){
   mutationObserved=true;selected=entry.operation==='event.batch'?'BATCH_OBSERVED':'ACCEPTED';pipelineRequired=entry.operation.startsWith('event.');
 }
 const count=result.value?.ingested_events;
 return {status:selected,effect:entry.effect,mutationObserved,pipelineRequired,...(count!==undefined?{ingestedEvents:safeInteger(count,'Original ingested_events',{minimum:0,maximum:100})}:{}),retryAfterSeconds:retryAfter(result.response)};
}
/** Dispatch only the previously selected method/path and original retained request bytes. */
export async function sendFuulAction({connection,action:prepared,signal}){
 if(connection.provider==='stellar')return sendFuulStellarAction({connection,action:prepared,signal});
 object(prepared,'Original prepared action');const descriptor=describeFuulConnection(connection),entry=FUUL_ACTION_CATALOG.find(item=>item.operation===prepared.operation);
 need(entry,'UNKNOWN_ACTION','Select the original supported Fuul action.');
 const projectId=prepared.projectId??prepared.correlation?.projectId??prepared.native?.projectId;
 need(projectId===descriptor.projectId,'PROJECT_SCOPE_MISMATCH','The prepared action and private connection must bind the same original project.');
 if(prepared.network)need(fuulNetwork(prepared.network).network===descriptor.network,'NETWORK_MISMATCH','The original action and current private source select different networks.');
 const identity=prepared.connection?.id??prepared.connection?.descriptor?.id;
 if(identity)need(identity===descriptor.id,'CONNECTION_SCOPE_MISMATCH','The original prepared action belongs to another source account or endpoint.');
 const request={...prepared.request};object(request,'Original prepared request');routeMatches(prepared.operation,request,projectId);
 if(request.bodyBytes!==undefined&&Buffer.from(request.bodyBytes).length===0&&(request.hasBody===false||request.body===null||request.body===undefined)){delete request.bodyBytes;delete request.body;}
 if(request.bodyBytes!==undefined){
   const bytes=Buffer.from(request.bodyBytes);let parsed;
   try{parsed=JSON.parse(bytes.toString('utf8'));}catch{throw new FuulError('INVALID_REQUEST_JSON','The original prepared request bytes are not valid JSON.');}
   need(canonical(parsed)===canonical(request.body),'REQUEST_CHANGED','The prepared JSON differs from its retained original request bytes.');
   if(request.bodySha256)need(sha256(bytes)===request.bodySha256,'REQUEST_CHANGED','The original retained request digest differs.');
   request.bodyBytes=bytes;
 }
 if(prepared.operation==='event.send')eventBody(request.body,descriptor);
 if(prepared.operation==='event.batch'){list(request.body,'Original event batch');need(request.body.length>=1&&request.body.length<=100,'INVALID_BATCH','An original batch contains one to 100 events.');for(const item of request.body)eventBody(item,descriptor);}
 const result=await authorized(connection,request,{signal,authType:entry.authType});
 const {originalValue,...retained}=result;let outcome;
 try{outcome=outcomeFor(entry,result);}catch{outcome={status:'UNCERTAIN',effect:entry.effect,mutationObserved:result.response.status>=200&&result.response.status<300,pipelineRequired:prepared.operation.startsWith('event.'),retryAfterSeconds:retryAfter(result.response)};}
 const kind=prepared.operation,records=result.value===null?[]:Array.isArray(result.value)?result.value:[result.value];
 return {...retained,kind,records,recordsPath:'',outcome,continuation:{done:true,next:null},exchanges:(result.exchanges??[]).map(({originalValue,...item})=>item)};
}
