import {invariant,sha256,canonicalJSON,parseSourceJSON} from './source-json.mjs';
import {validateSchema} from './schema.mjs';
import {NATIVE_ACTIONS,actionContract,resolveReference} from './catalogue.mjs';
import {authenticationSelection,credentialBinding,assertExactNativeNumbers} from './provider-auth.mjs';
export {NATIVE_ACTIONS} from './catalogue.mjs';
export {executeProvider} from './transport.mjs';
export {projectResource,reconcileVersions} from './resources.mjs';
export {verifyWebhook} from './webhooks.mjs';
export {validateOperation} from './validation.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value && typeof value==='object'&&!Array.isArray(value);
const scalar=value=>typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);
function baseURL(config) {
 invariant(['escala','sdp','horizon'].includes(config?.provider),'PROVIDER_UNSUPPORTED');
 invariant(['production','sandbox'].includes(config.environment),'PROVIDER_ENVIRONMENT_REQUIRED');
 invariant(typeof config.baseUrl==='string'&&config.baseUrl.length,'PROVIDER_BASE_URL_REQUIRED');
 const url=new URL(config.baseUrl),loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 invariant(url.protocol==='https:'||url.protocol==='http:'&&loopback,'PROVIDER_HTTPS_REQUIRED');
 invariant(!url.username&&!url.password&&!url.hash&&!url.search,'PROVIDER_BASE_URL_INVALID');
 url.pathname=url.pathname.replace(/\/+$/,'')||'/';
 if(config.provider==='escala')invariant(config.environment==='sandbox','ESCALA_PUBLISHED_MOCK_SANDBOX_ONLY');
 return url;
}
export function describeConnection(config) {
 const base=baseURL(config),baseUrl=base.href.replace(/\/$/,'');
 const descriptor={provider:config.provider,environment:config.environment,baseUrl,
   organizationId:config.organizationId??null,identityId:config.identityId??null,
   accountNumber:config.accountNumber??null,
   tenantId:config.tenantId??null,tenantName:config.tenantName??null,
   distributionWalletId:config.distributionWalletId??null,
   executionSemantics:config.provider==='escala'?'published-mock':'configured-provider',
   apiMode:config.provider==='escala'?'mock':'live',
   network:config.networkPassphrase??null,networkPassphrase:config.networkPassphrase??null,
   actorLabel:config.actorId??null,
   credentialBinding:config.provider==='horizon'?null:credentialBinding(config)};
 if(config.provider==='horizon')invariant(typeof descriptor.network==='string'&&descriptor.network.length,'HORIZON_NETWORK_REQUIRED');
 // These public labels bind an operator-selected source; they do not assert the
 // provider authenticated a particular principal.
 descriptor.sourceScope=sha256(Buffer.from(canonicalJSON({...descriptor,actorLabel:null,
   credentialBinding:descriptor.credentialBinding})));
 descriptor.providerScope=descriptor.sourceScope;
 return descriptor;
}
function valueAt(value,pointer){
 invariant(typeof pointer==='string'&&(pointer===''||pointer.startsWith('/')),'ORIGINAL_JSON_POINTER_REQUIRED');
 for(const key of pointer===''?[]:pointer.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'))){
  if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return undefined;
  value=value[key];
 }
 return value;
}
function requestInput(original,contract) {
 invariant(plain(original),'OPERATION_INPUT_REQUIRED');
 invariant(Object.keys(original).every(k=>['params','query','headers','body','file'].includes(k)),'OPERATION_INPUT_UNKNOWN_FIELD');
 assertExactNativeNumbers(parseSourceJSON(Buffer.from(JSON.stringify(original))));
 const input=clone(original);
 input.params??={};input.query??={};input.headers??={};
 invariant(plain(input.params)&&plain(input.query)&&plain(input.headers),'OPERATION_PARAMETER_OBJECT');
 const {entry,operation,spec}=contract;
 if(entry.pagination==='sdp-page'){
  for(const key of ['page','page_limit'])if(input.query[key]!==undefined)invariant(Number.isSafeInteger(input.query[key])&&input.query[key]>=1&&(key!=='page_limit'||input.query[key]<=100),'SDP_PAGE_PARAMETER_INVALID',{key});
 }
 if(entry.provider==='sdp')for(const [name,value]of Object.entries(entry.paginationOptions?.defaults??{})){
  input.query[name]??=clone(value);
 }
 if(entry.pagination==='horizon'){
  input.query.limit??=100;input.query.order??='asc';input.query.include_failed??=true;
  if(operation.parameters.some(p=>p.name==='join'))input.query.join??='transactions';
 }
 const securityHeaders=new Set(Object.values(spec.components?.securitySchemes??{}).map(raw=>resolveReference(spec,raw))
  .filter(scheme=>scheme.type==='apiKey'&&scheme.in==='header').map(scheme=>scheme.name.toLowerCase()));
 securityHeaders.add('authorization');securityHeaders.add('cookie');
 securityHeaders.add('request-signature');securityHeaders.add('request-timestamp');
 const protectedHeader=name=>securityHeaders.has(name.toLowerCase())||/^(accept|content-type|host|content-length|connection|transfer-encoding|proxy-.*)$/i.test(name);
 for(const name of Object.keys(input.headers))invariant(!protectedHeader(name),
  'PRIVATE_OR_TRANSPORT_HEADER_NOT_INPUT',{name});
 for(const [kind,location]of [['params','path'],['query','query'],['headers','header']]){
  const selected=input[kind],parameters=operation.parameters.filter(p=>p.in===location&&
   !(location==='header'&&protectedHeader(p.name)));
  for(const name of Object.keys(selected))invariant(parameters.some(p=>p.name===name),'OPERATION_PARAMETER_UNKNOWN',{kind,name});
  for(const parameter of parameters){
   const present=Object.hasOwn(selected,parameter.name);
   invariant(present||!parameter.required,'OPERATION_PARAMETER_REQUIRED',{kind,name:parameter.name});
   if(present)validateSchema(selected[parameter.name],parameter.schema,spec,kind+'.'+parameter.name);
  }
 }

 if(entry.fileUpload){
  invariant(plain(input.file)&&typeof input.file.filename==='string'&&/^[^\\/\r\n\0"]+\.csv$/.test(input.file.filename),'ORIGINAL_CSV_FILE_REQUIRED');
  invariant(typeof input.file.bodyBase64==='string','ORIGINAL_FILE_BYTES_REQUIRED');
  const raw=Buffer.from(input.file.bodyBase64,'base64');
  invariant(raw.toString('base64')===input.file.bodyBase64&&raw.length===input.file.bytes&&sha256(raw)===input.file.sha256,'ORIGINAL_FILE_IDENTITY_CHANGED');
  invariant(raw.length<=500*10000,'SDP_ORIGINAL_CSV_LIMIT');
 }else invariant(input.file===undefined,'FILE_UNSUPPORTED_FOR_OPERATION');
 invariant(input.body!==undefined||entry.fileUpload||!operation.requestBody?.required,'OPERATION_BODY_REQUIRED');
 if(input.body!==undefined){
  const content=operation.requestBody?.content;
  const schema=(content?.['application/json']??content?.['*/*'])?.schema;
  invariant(schema!==undefined,'OPERATION_JSON_BODY_UNSUPPORTED');
  validateSchema(input.body,schema,spec,'body');
 }
 return input;
}
function appendQuery(url,query,parameters) {
 for(const [key,value]of Object.entries(query)){
  if(value===null||value===undefined)continue;
  const parameter=parameters.find(p=>p.in==='query'&&p.name===key);
  if(Array.isArray(value)){
   invariant(value.every(scalar),'QUERY_ARRAY_SCALARS_REQUIRED');
   if(parameter?.explode===false)url.searchParams.set(key,value.join(','));
   else for(const item of value)url.searchParams.append(key,String(item));
  }else {invariant(scalar(value),'QUERY_SCALAR_REQUIRED',{key});url.searchParams.set(key,String(value));}
 }
}
function readbackFor(entry,input) {
 const selected=entry.readback;if(!selected)return null;
 const params={},query={};
 for(const [target,bindings] of [[params,selected.params],[query,selected.query]])
  for(const [name,pointer] of Object.entries(bindings??{})){
   const value=valueAt(input,pointer);if(value===undefined||value===null)return null;target[name]=value;
  }
 const resourceId=selected.resourceIdPointer?valueAt(input,selected.resourceIdPointer):null;
 const match=selected.match?{pointer:selected.match.pointer,value:valueAt(input,selected.match.inputPointer)}:null;
 const target=actionContract(selected.action).operation,headers={};
 for(const [name,value]of Object.entries(input.headers??{}))
  if(target.parameters.some(p=>p.in==='header'&&p.name===name))headers[name]=value;
 const sourceWalletId=entry.provider==='sdp'?input.headers?.['X-Wallet-Id']??null:null;
 return {action:selected.action,input:{params,query,...(Object.keys(headers).length?{headers}:{})},
  resourceKind:selected.resourceKind,resourceId:resourceId??null,match,sourceWalletId};
}
export function buildRequest(config,action,original={}) {
 const descriptor=describeConnection(config),contract=actionContract(action),{entry,operation}=contract;
 invariant(entry.provider===descriptor.provider,'ACTION_PROVIDER_MISMATCH');
 const originalInput=clone(original);
 if(descriptor.provider==='sdp'){
  originalInput.headers??={};
  if(descriptor.distributionWalletId!==null){
   invariant(originalInput.headers['X-Wallet-Id']===undefined||originalInput.headers['X-Wallet-Id']===descriptor.distributionWalletId,'SDP_CONFIGURED_WALLET_CHANGED');
   if(operation.parameters.some(p=>p.in==='header'&&p.name==='X-Wallet-Id'))originalInput.headers['X-Wallet-Id']=descriptor.distributionWalletId;
  }
 }
 const input=requestInput(originalInput,contract),headers={Accept:entry.responseFormat==='csv'?'text/csv':'application/json'};
 if(descriptor.provider==='sdp'&&descriptor.tenantName!==null){
  invariant(typeof descriptor.tenantName==='string'&&descriptor.tenantName.length&&!/[\r\n\0]/.test(descriptor.tenantName),'SDP_TENANT_NAME_INVALID');
  headers['SDP-Tenant-Name']=descriptor.tenantName;
 }
 for(const [name,value]of Object.entries(input.headers)){
  invariant(typeof value==='string'&&!/[\r\n\0]/.test(value),'OPERATION_HEADER_STRING_REQUIRED',{name});
  invariant(!Object.keys(headers).some(key=>key.toLowerCase()===name.toLowerCase()),'OPERATION_HEADER_DUPLICATE',{name});
  headers[name]=value;
 }
 if(descriptor.provider==='escala'&&descriptor.tenantId!==null){
  invariant(typeof descriptor.tenantId==='string'&&descriptor.tenantId.length&&!/[\r\n\0]/.test(descriptor.tenantId),'ESCALA_TENANT_ID_INVALID');
  headers['X-Tenant-ID']=descriptor.tenantId;
 }
 if(entry.sandboxOnly)invariant(descriptor.environment==='sandbox','SANDBOX_ONLY_ACTION');
 let path=entry.path.replace(/\{([^}]+)\}/g,(_,key)=>{
  const selected=input.params[key];invariant(typeof selected==='string'||Number.isSafeInteger(selected),'UNSAFE_PROVIDER_PATH_ID',{key});
  const value=String(selected);invariant(value.length&&value!=='.'&&value!=='..'&&!/[\0\/\\]/.test(value),'UNSAFE_PROVIDER_PATH_ID',{key});
  return encodeURIComponent(value);
 });
 const base=baseURL(config),url=new URL(base.href);url.pathname=base.pathname.replace(/\/$/,'')+path;
 appendQuery(url,input.query,operation.parameters);

 let body=null;
 if(input.file){
  invariant(input.body===undefined,'FILE_OPERATION_JSON_BODY_UNSUPPORTED');
  const raw=Buffer.from(input.file.bodyBase64,'base64');
  let boundary='amero-'+sha256(Buffer.from(canonicalJSON({file:input.file.sha256,action,params:input.params}))).slice(0,48);
  while(raw.includes(Buffer.from(boundary)))boundary+='x';
  body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+input.file.filename+'"\r\nContent-Type: text/csv\r\n\r\n'),raw,Buffer.from('\r\n--'+boundary+'--\r\n')]);
  invariant(body.length<=500*10000,'SDP_ORIGINAL_MULTIPART_LIMIT');
  headers['Content-Type']='multipart/form-data; boundary='+boundary;
 }else if(input.body!==undefined){
  body=Buffer.from(canonicalJSON(input.body));headers['Content-Type']='application/json';
 }
 const authentication=entry.provider==='horizon'?null:authenticationSelection(config,action);
 const request={schema:'amero.prepared-provider-request.v1',action,provider:descriptor.provider,
  environment:descriptor.environment,baseUrl:descriptor.baseUrl,url:url.href,path,method:entry.method,headers,
  mutation:entry.mutation,resourceKind:entry.resourceKind,authentication,dispatchable:entry.dispatchable!==false,
  executionSemantics:descriptor.executionSemantics,downloadable:entry.responseFormat!=='json',
  resourceId:input.params.id??input.params.code??null,
  input,context:descriptor,bodyBase64:body?.toString('base64')??null,bodyBytes:body?.length??0,
  bodySha256:body?sha256(body):null,responseFormat:entry.responseFormat,
  allowEmptyResponse:entry.responseFormat!=='json'||entry.method==='DELETE',
  readback:readbackFor(entry,input),source:entry.source,preparedAt:new Date().toISOString()};
 request.requestSha256=sha256(Buffer.from(canonicalJSON(request)));
 return request;
}
function safeContinuation(request,href,cursor) {
 invariant(typeof href==='string'&&href.length,'NATIVE_NEXT_LINK_REQUIRED');
 const current=new URL(request.url),next=new URL(href,current);
 invariant(next.origin===current.origin&&next.pathname===current.pathname&&!next.username&&!next.password&&!next.hash,'NATIVE_CURSOR_SCOPE_CHANGED');
 const strip=url=>{const out=new URL(url);out.searchParams.delete(cursor);out.searchParams.sort();return out.href;};
 invariant(strip(next)===strip(current),'NATIVE_CURSOR_FILTER_CHANGED');
 invariant(next.searchParams.getAll(cursor).length===1,'NATIVE_CURSOR_REQUIRED');
 return next;
}
export function nextPageRequest({request,exchange}) {
 invariant(exchange.classification?.outcome==='accepted'&&exchange.response?.complete,'COMPLETE_ACCEPTED_PAGE_REQUIRED');
 const entry=actionContract(request.action).entry,value=exchange.parsed?.value;
 if(!entry.pagination)return{done:true};
 const input=clone(request.input),query=input.query??={};
 if(entry.provider==='sdp'){
  invariant(entry.pagination==='sdp-page'&&plain(value)&&Array.isArray(value.data)&&plain(value.pagination),'SDP_PAGE_SCHEMA');
  const {pages,total,next}=value.pagination;
  invariant(Number.isSafeInteger(pages)&&pages>=0&&Number.isSafeInteger(total)&&total>=0&&
    Number.isSafeInteger(query.page)&&query.page>=1&&Number.isSafeInteger(query.page_limit)&&query.page_limit>=1,'SDP_PAGE_COUNTS');
  invariant(value.data.length<=query.page_limit,'SDP_PAGE_LIMIT');
  if(next===undefined||next===null||next===''){
   invariant(total===0&&pages===0&&value.data.length===0||query.page>=pages,'SDP_TERMINAL_PAGE_MISSING');
   return {done:true};
  }
  invariant(query.page<pages&&value.data.length>0,'SDP_CURSOR_COUNT_MISMATCH');
  const url=safeContinuation(request,next,'page'),page=url.searchParams.get('page');
  invariant(/^\d+$/.test(page)&&Number(page)===query.page+1,'SDP_CURSOR_STALLED');
  query.page=Number(page);
 }else if(entry.pagination==='horizon'){
  invariant(Array.isArray(value?._embedded?.records),'HORIZON_PAGE_SCHEMA');
  const rows=value._embedded.records;if(!rows.length)return{done:true};
  const url=safeContinuation(request,value._links?.next?.href,'cursor'),cursor=url.searchParams.get('cursor'),last=rows.at(-1).paging_token;
  invariant(typeof cursor==='string'&&/^\d+$/.test(cursor)&&cursor===last&&cursor!==query.cursor,'HORIZON_CURSOR_MISMATCH');
  if(query.cursor&&/^\d+$/.test(query.cursor))invariant(query.order==='desc'?BigInt(cursor)<BigInt(query.cursor):BigInt(cursor)>BigInt(query.cursor),'HORIZON_CURSOR_DIRECTION');
  query.cursor=cursor;
 }else invariant(false,'NATIVE_PAGINATION_UNSUPPORTED');
 return{done:false,action:request.action,input};
}
export function initialReadPlan(config) {
 const descriptor=describeConnection(config),tasks=[],missingBindings=[];
 const add=(action,input={},required=true)=>tasks.push({id:action,action,input,required});
 if(descriptor.provider==='sdp'||descriptor.provider==='escala'){
  const reads=config.initialReads??[];
  invariant(Array.isArray(reads),'ORIGINAL_INITIAL_READS_INVALID');
  if(!reads.length)missingBindings.push('Select exact original provider read actions and their tenant, wallet, and resource filters.');
  for(const [index,read]of reads.entries()){
   const entry=actionContract(read.action).entry;
   invariant(entry.provider===descriptor.provider&&!entry.mutation,'ORIGINAL_PROVIDER_READ_REQUIRED');
   buildRequest(config,read.action,read.input??{});
   add(read.action,read.input??{});tasks.at(-1).id=read.action+':'+index;
  }
 }else if(descriptor.provider==='horizon'){
  add('horizon.network.get');
  const ids=config.accountIds??(config.accountId?[config.accountId]:[]);
  invariant(Array.isArray(ids),'HORIZON_ACCOUNT_IDS_INVALID');
  if(!ids.length)missingBindings.push('accountId or accountIds for account-scoped history');
  for(const id of ids){
   for(const [action,input]of [['horizon.account.get',{params:{accountId:id}}],
      ['horizon.payments.account',{params:{accountId:id}}],['horizon.transactions.account',{params:{accountId:id}}]]){
     add(action,input);tasks.at(-1).id=action+':'+id;
   }
  }
 }
 return{tasks,missingBindings};
}
