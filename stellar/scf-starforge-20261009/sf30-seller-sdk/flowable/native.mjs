// MIT. Native Flowable 8 HTTP, original byte capture and selected-operation readback.
// The engine owns deployment, task actions and process migration. This module never replays writes.
import {createHash,randomUUID} from 'node:crypto';

export const FLOWABLE_CONNECTION_SCHEMA='stellar-forge.flowable-connection.v1';
export const FLOWABLE_NATIVE_SCHEMA='stellar-forge.flowable-native-request.v1';
export const FLOWABLE_NATIVE_VERSION='8.0.0';
export const FLOWABLE_NATIVE_COMMIT='0779d68e5a3385b74d8acb8bc37901ff54513249';
const SHA=/^[a-f0-9]{64}$/;
const own=(value,key)=>Object.hasOwn(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const hash=value=>createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
function fail(code,message,extra={}){return Object.assign(new Error(message),{code,...extra});}
function object(value,label){if(!plain(value))throw fail('FLOWABLE_INPUT_INVALID',label+' must be a JSON object.');return value;}
function keys(value,allowed,label){object(value,label);for(const key of Object.keys(value))if(!allowed.includes(key))throw fail('FLOWABLE_INPUT_INVALID',label+' contains unsupported field '+key+'.');}
function text(value,label,maximum=8192,empty=false){if(typeof value!=='string'||(!empty&&!value.length)||value.length>maximum||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))throw fail('FLOWABLE_INPUT_INVALID',label+' must be text within its declared bound.');return value;}
function nativeId(value,label='Native ID'){text(value,label,2048);if(value==='.'||value==='..'||/[/\\\r\n]/u.test(value))throw fail('FLOWABLE_INPUT_INVALID',label+' must be one native path component.');return value;}
function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(plain(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 throw fail('FLOWABLE_INPUT_INVALID','Value must be JSON serializable.');
}
const objectHash=value=>hash(canonical(value));
function jsonObject(value,label){let parsed;try{parsed=JSON.parse(value);}catch{throw fail('FLOWABLE_INPUT_INVALID',label+' must contain complete JSON.');}return object(parsed,label);}
function exactBase64(value,label){
 if(typeof value!=='string'||!value.length||value.length>358*1024*1024)throw fail('FLOWABLE_INPUT_INVALID',label+' must be a complete Base64 byte value within 256 MiB.');
 const bytes=Buffer.from(value,'base64');
 if(bytes.toString('base64')!==value||bytes.length>256*1024*1024)throw fail('FLOWABLE_INPUT_INVALID',label+' must be canonical complete Base64.');
 return bytes;
}
function bodyObject(value){
 if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>64*1024*1024)throw fail('FLOWABLE_INPUT_INVALID','bodyText must retain a complete original JSON body within 64 MiB.');
 return jsonObject(value,'bodyText');
}
function sinkReference(value,label){if(!plain(value)||!SHA.test(value.sha256||'')||!Number.isSafeInteger(value.bytes)||value.bytes<0||typeof value.mediaType!=='string')throw fail('FLOWABLE_SINK_INVALID',label+' must identify complete immutable bytes.');return value;}
function captureOptions(value={}){
 if(!plain(value))throw fail('FLOWABLE_INPUT_INVALID','Capture options must be an object.');
 const retainBodies=value.retainBodies??!(typeof value.onExchange==='function'&&typeof value.onDefinition==='function');
 if(typeof retainBodies!=='boolean')throw fail('FLOWABLE_INPUT_INVALID','retainBodies must be a boolean.');
 return {...value,retainBodies};
}
function queryObject(value={}){
 object(value,'Native query');const result={};
 for(const [key,entry]of Object.entries(value)){text(key,'Query key',256);if(entry===undefined||entry===null)continue;if(!['string','number','boolean'].includes(typeof entry)||typeof entry==='number'&&!Number.isFinite(entry))throw fail('FLOWABLE_INPUT_INVALID','Native query values must be scalars.');result[key]=String(entry);}
 return result;
}
export function normalizeFlowableConnection(value){
 keys(value,['schema','id','label','baseUrl','usernameEnv','passwordEnv'],'connection');
 if(value.schema!==undefined&&value.schema!==FLOWABLE_CONNECTION_SCHEMA)throw fail('FLOWABLE_INPUT_INVALID','Unsupported Flowable connection schema.');
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.id||''))throw fail('FLOWABLE_INPUT_INVALID','Connection ID must be a named host handle.');
 for(const name of ['usernameEnv','passwordEnv'])if(!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(value[name]||''))throw fail('FLOWABLE_INPUT_INVALID',name+' must name the selected credential environment variable.');
 let url;try{url=new URL(text(value.baseUrl,'baseUrl'));}catch{throw fail('FLOWABLE_INPUT_INVALID','baseUrl must be an absolute original HTTP REST base.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw fail('FLOWABLE_INPUT_INVALID','baseUrl must have no embedded credentials, query or fragment.');
 url.pathname=url.pathname.replace(/\/+$/u,'')+'/';
 return Object.freeze({schema:FLOWABLE_CONNECTION_SCHEMA,id:value.id,label:value.label===undefined?value.id:text(value.label,'label',512),baseUrl:url.href,usernameEnv:value.usernameEnv,passwordEnv:value.passwordEnv});
}
export const flowableConnectionSha256=value=>objectHash(normalizeFlowableConnection(value));
function requestCore(spec){return{connectionId:spec.connectionId,connectionSha256:spec.connectionSha256,method:spec.method,path:spec.path,query:spec.query??{},contentType:spec.contentType??null,bodyBytes:spec.bodyBytes??0,bodySha256:spec.bodySha256??null};}
function finishPlan(connection,fields){
 const plan={schema:FLOWABLE_NATIVE_SCHEMA,engineVersion:FLOWABLE_NATIVE_VERSION,connectionId:connection.id,connectionSha256:flowableConnectionSha256(connection),...fields};
 plan.requestSha256=objectHash(requestCore(plan));return plan;
}
export function planFlowableRequest(connectionInput,input){
 const connection=normalizeFlowableConnection(connectionInput);object(input,'selection');
 const action=input.action;let method='POST',path,query={},contentType='application/json',bytes,readback={},source=null,mutation=true;
 if(action==='deploy'){
  keys(input,['action','deploymentName','deploymentKey','tenantId','resource'],'deployment selection');
  keys(input.resource,['filename','contentType','contentBase64'],'deployment resource');
  const filename=nativeId(input.resource.filename,'Deployment filename');
  if(!/(\.bpmn20\.xml|\.bpmn)$/.test(filename)&&!/(\.bar|\.zip)$/i.test(filename))throw fail('FLOWABLE_INPUT_INVALID','Native deployment accepts one .bpmn20.xml, .bpmn, .bar or .zip file.');
  const original=exactBase64(input.resource.contentBase64,'Deployment source');
  const fileType=input.resource.contentType??(/\.bpmn(?:20\.xml)?$/i.test(filename)?'application/xml':'application/zip');
  text(fileType,'Deployment content type',256);if(/[\r\n"]/u.test(filename)||/[\r\n]/u.test(fileType))throw fail('FLOWABLE_INPUT_INVALID','Multipart filename and content type must not contain header separators.');
  for(const key of ['deploymentName','deploymentKey','tenantId'])if(own(input,key))query[key]=text(input[key],key,2048,true);
  source={filename,contentType:fileType,bytes:original.length,sha256:hash(original)};
  const boundary='FlowableNative'+objectHash({source,query}).slice(0,48);
  if(original.includes(Buffer.from('\r\n--'+boundary)))throw fail('FLOWABLE_INPUT_INVALID','Selected bytes collide with the exact multipart boundary.');
  const quoted=filename.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  bytes=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+quoted+'"\r\nContent-Type: '+fileType+'\r\n\r\n'),original,Buffer.from('\r\n--'+boundary+'--\r\n')]);
  contentType='multipart/form-data; boundary='+boundary;path='/repository/deployments';
  readback={deploymentName:input.deploymentName||filename.split('.')[0],...(own(input,'tenantId')?{tenantId:input.tenantId}:{withoutTenantId:true}),...(input.deploymentKey?{deploymentKey:input.deploymentKey}:{}),source};
 }else{
  keys(input,['action','bodyText','taskId','processInstanceId','processDefinitionId'],'native selection');
  const body=bodyObject(input.bodyText);bytes=Buffer.from(input.bodyText,'utf8');
  if(action==='start'){
   if(own(input,'taskId')||own(input,'processInstanceId')||own(input,'processDefinitionId'))throw fail('FLOWABLE_INPUT_INVALID','Start selectors belong inside the unchanged native bodyText.');
   const selectors=['processDefinitionId','processDefinitionKey','message'].filter(k=>body[k]!==null&&body[k]!==undefined);
   if(selectors.length!==1)throw fail('FLOWABLE_INPUT_INVALID','Native start requires exactly one processDefinitionId, processDefinitionKey or message.');
   for(const key of selectors)nativeId(body[key],key);
   if(own(body,'tenantId')&&selectors[0]==='processDefinitionId')throw fail('FLOWABLE_INPUT_INVALID','Native tenantId can only accompany processDefinitionKey or message.');
   if(body.businessKey!==undefined&&body.businessKey!==null)text(body.businessKey,'businessKey',8192,true);
   path='/runtime/process-instances';readback={selector:selectors[0],selectorValue:body[selectors[0]],businessKey:body.businessKey??null,tenantId:body.tenantId??null};
  }else if(['claim','complete','delegate','resolve'].includes(action)){
   if(own(input,'processInstanceId')||own(input,'processDefinitionId'))throw fail('FLOWABLE_INPUT_INVALID','Task selection requires only taskId and original bodyText.');
   const taskId=nativeId(input.taskId,'taskId');if(body.action!==action)throw fail('FLOWABLE_INPUT_INVALID','bodyText.action must match the selected original task action.');
   if(action==='claim'&&own(body,'assignee')&&body.assignee!==null)text(body.assignee,'assignee',2048);
   if(action==='delegate')text(body.assignee,'assignee',2048);
   path='/runtime/tasks/'+encodeURIComponent(taskId);readback={taskId,assignee:body.assignee??null};
  }else if(['validateMigration','migrate','migrateDefinition','batchMigrateDefinition'].includes(action)){
   if(own(input,'taskId'))throw fail('FLOWABLE_INPUT_INVALID','Migration selection must identify its original process or definition.');
   const single=action==='validateMigration'||action==='migrate';
   if(single&&own(input,'processDefinitionId')||!single&&own(input,'processInstanceId'))throw fail('FLOWABLE_INPUT_INVALID','Migration must select only its actual native scope.');
   const selected=nativeId(single?input.processInstanceId:input.processDefinitionId,single?'processInstanceId':'processDefinitionId');
   if(body.toProcessDefinitionId!==undefined&&body.toProcessDefinitionId!==null)nativeId(body.toProcessDefinitionId,'toProcessDefinitionId');
   else{
    text(body.toProcessDefinitionKey,'toProcessDefinitionKey',2048);
    if(!Number.isSafeInteger(body.toProcessDefinitionVersion)||body.toProcessDefinitionVersion<1)throw fail('FLOWABLE_INPUT_INVALID','Native migration requires a target definition ID or target key and positive version.');
   }
   if(body.activityMappings!==undefined&&!Array.isArray(body.activityMappings))throw fail('FLOWABLE_INPUT_INVALID','Native activityMappings must be an array.');
   path=single?'/runtime/process-instances/'+encodeURIComponent(selected)+'/'+(action==='validateMigration'?'validate-migration':'migrate'):'/repository/process-definitions/'+encodeURIComponent(selected)+'/'+(action==='batchMigrateDefinition'?'batch-migrate':'migrate');
   mutation=action!=='validateMigration';readback={...(single?{processInstanceId:selected}:{processDefinitionId:selected}),toProcessDefinitionId:body.toProcessDefinitionId??null,toProcessDefinitionKey:body.toProcessDefinitionKey??null,toProcessDefinitionVersion:body.toProcessDefinitionVersion??null,toProcessDefinitionTenantId:body.toProcessDefinitionTenantId??null};
  }else throw fail('FLOWABLE_INPUT_INVALID','Unsupported selected native action.');
 }
 return finishPlan(connection,{action,mutation,method,path,query,contentType,bodyBytes:bytes.length,bodySha256:hash(bytes),bodyBase64:bytes.toString('base64'),readback,...(source?{source}:{})});
}
function validatePlan(connection,plan){
 object(plan,'Native request plan');if(plan.schema!==FLOWABLE_NATIVE_SCHEMA||plan.engineVersion!==FLOWABLE_NATIVE_VERSION||plan.connectionId!==connection.id||plan.connectionSha256!==flowableConnectionSha256(connection))throw fail('FLOWABLE_PLAN_CHANGED','The saved native plan belongs to a different connection or engine contract.');
 const bytes=Buffer.from(plan.bodyBase64??'','base64');
 if(bytes.toString('base64')!==plan.bodyBase64||bytes.length!==plan.bodyBytes||hash(bytes)!==plan.bodySha256||objectHash(requestCore(plan))!==plan.requestSha256)throw fail('FLOWABLE_PLAN_CHANGED','The saved native request bytes changed.');
 const paths={deploy:'/repository/deployments',start:'/runtime/process-instances'};
 if(['claim','complete','delegate','resolve'].includes(plan.action))paths[plan.action]='/runtime/tasks/'+encodeURIComponent(nativeId(plan.readback?.taskId,'taskId'));
 if(['validateMigration','migrate'].includes(plan.action))paths[plan.action]='/runtime/process-instances/'+encodeURIComponent(nativeId(plan.readback?.processInstanceId,'processInstanceId'))+'/'+(plan.action==='migrate'?'migrate':'validate-migration');
 if(['migrateDefinition','batchMigrateDefinition'].includes(plan.action))paths[plan.action]='/repository/process-definitions/'+encodeURIComponent(nativeId(plan.readback?.processDefinitionId,'processDefinitionId'))+'/'+(plan.action==='migrateDefinition'?'migrate':'batch-migrate');
 if(!paths[plan.action]||plan.path!==paths[plan.action]||plan.method!=='POST'||plan.mutation!==(plan.action!=='validateMigration'))throw fail('FLOWABLE_PLAN_CHANGED','The native request method, action or route changed.');
 if(plan.action!=='deploy'){
  const selection={action:plan.action,bodyText:bytes.toString('utf8'),...(['claim','complete','delegate','resolve'].includes(plan.action)?{taskId:plan.readback.taskId}:['validateMigration','migrate'].includes(plan.action)?{processInstanceId:plan.readback.processInstanceId}:['migrateDefinition','batchMigrateDefinition'].includes(plan.action)?{processDefinitionId:plan.readback.processDefinitionId}:{})};
  if(canonical(planFlowableRequest(connection,selection))!==canonical(plan))throw fail('FLOWABLE_PLAN_CHANGED','The native readback selection differs from the complete saved request.');
 }
 return plan;
}
const RESPONSE_HEADERS=['content-type','content-length','etag','last-modified','location','date','retry-after','x-request-id','x-correlation-id'];
export function createFlowableTransport(connectionInput,options={}){
 const connection=normalizeFlowableConnection(connectionInput),connectionSha256=flowableConnectionSha256(connection);
 const environment=options.environment??process.env,username=environment[connection.usernameEnv],password=environment[connection.passwordEnv];
 if(typeof username!=='string'||!username.length||username.includes(':')||typeof password!=='string'||!password.length)throw fail('FLOWABLE_AUTH_UNAVAILABLE','The selected original Basic-auth environment references are unavailable or the username contains a colon.');
 const authorization='Basic '+Buffer.from(username+':'+password,'utf8').toString('base64'),fetcher=options.fetch??globalThis.fetch;
 if(typeof fetcher!=='function')throw fail('FLOWABLE_TRANSPORT_UNAVAILABLE','The original HTTP fetch transport is unavailable.');
 const timeoutMs=options.timeoutMs??120000,maxResponseBytes=options.maxResponseBytes??64*1024*1024;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000||!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>1024*1024*1024)throw fail('FLOWABLE_INPUT_INVALID','Configure a positive timeout up to one hour and a response byte bound up to 1 GiB.');
 function endpoint(path,query){
  text(path,'Native request path',16384);
  let url;
  if(/^https?:\/\//u.test(path)){url=new URL(path);const base=new URL(connection.baseUrl);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||url.username||url.password||url.hash)throw fail('FLOWABLE_SOURCE_URL_CHANGED','Native source URL escapes the selected original REST base.');}
  else{if(!path.startsWith('/')||path.startsWith('//')||/[?#\\]/u.test(path)||path.split('/').some(p=>p==='..'||p==='.')||/%(?:2e|5c)/i.test(path))throw fail('FLOWABLE_INPUT_INVALID','Native request path must remain inside the selected REST base.');url=new URL(connection.baseUrl);url.pathname+=path.slice(1);}
  for(const [key,value]of Object.entries(queryObject(query)))url.searchParams.set(key,value);
  return url;
 }
 async function request(spec,operationSignal){
  const signals=[options.signal,operationSignal].filter(Boolean);if(signals.some(s=>s.aborted))throw fail('FLOWABLE_ABORTED','Operation was cancelled before native dispatch.',{outcomeUnknown:false});
  const url=endpoint(spec.path,spec.query),body=spec.bodyBase64===undefined?undefined:Buffer.from(spec.bodyBase64,'base64');
  const requestRecord={method:spec.method,path:spec.path,query:spec.query??{},contentType:spec.contentType??null,bodyBytes:body?.length??0,bodySha256:body?hash(body):null};
  const requestSha256=spec.requestSha256??objectHash({connectionId:connection.id,connectionSha256,...requestRecord});
  requestRecord.requestSha256=requestSha256;
  const startedAt=now(),exchangeId=randomUUID(),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(fail('FLOWABLE_TIMEOUT','Native Flowable request timed out.')),timeoutMs);timer.unref?.();
  const signal=AbortSignal.any([...signals,controller.signal]);let response=null,dispatched=false,chunks=[],received=0;
  const retainedHeaders=()=>{const headers={};if(response)for(const name of RESPONSE_HEADERS){const value=response.headers.get(name);if(value!==null)headers[name]=value;}return headers;};
  const exchange=(bytes,complete)=>{
   let bodyText=null,parsed=null;try{bodyText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{}
   if(bodyText!==null&&complete){try{parsed=JSON.parse(bodyText);}catch{}}
   return{schema:'stellar-forge.flowable-http-exchange.v1',id:exchangeId,connectionId:connection.id,connectionSha256,requestSha256,mutation:Boolean(spec.mutation),request:requestRecord,startedAt,completedAt:now(),status:response?.status??null,statusText:response?.statusText??null,ok:complete&&response?.ok===true,complete,headers:retainedHeaders(),bodyBytes:bytes.length,bodySha256:hash(bytes),bodyBase64:bytes.toString('base64'),bodyText,json:parsed};
  };
  try{
   const headers={Accept:'application/json',Authorization:authorization};if(spec.contentType)headers['Content-Type']=spec.contentType;
   dispatched=true;response=await fetcher(url,{method:spec.method,headers,body,redirect:'manual',signal});
   const reader=response.body?.getReader();if(reader){try{for(;;){const part=await reader.read();if(part.done)break;const chunk=Buffer.from(part.value);if(received+chunk.length>maxResponseBytes){const remaining=Math.max(0,maxResponseBytes-received);if(remaining){chunks.push(chunk.subarray(0,remaining));received+=remaining;}await reader.cancel();throw fail('FLOWABLE_RESPONSE_TOO_LARGE','Original response exceeds the explicitly configured byte bound.');}chunks.push(chunk);received+=chunk.length;}}finally{reader.releaseLock();}}
   return exchange(Buffer.concat(chunks,received),true);
  }catch(error){
   const retained=exchange(Buffer.concat(chunks,received),false);
   const code=typeof error?.code==='string'?error.code:signal.aborted?(controller.signal.aborted?'FLOWABLE_TIMEOUT':'FLOWABLE_ABORTED'):'FLOWABLE_TRANSPORT_FAILED';
   throw fail(code,error?.message||'Native Flowable request failed.',{outcomeUnknown:Boolean(dispatched&&spec.mutation),dispatched,request:requestRecord,exchange:retained,cause:error});
  }finally{clearTimeout(timer);}
 }
 return Object.freeze({connection,connectionSha256,request,execute:(plan,executeOptions={})=>request(validatePlan(connection,plan),executeOptions.signal)});
}
async function retainExchange(full,callbacks){
 let bodyRef;try{if(typeof callbacks.onExchange==='function')bodyRef=await callbacks.onExchange(full);}catch(error){throw fail('FLOWABLE_EXCHANGE_SAVE_FAILED','The original response was received but its durable sink failed.',{outcomeUnknown:full.mutation===true,exchange:full,cause:error});}
 if(callbacks.retainBodies)return full;
 sinkReference(bodyRef,'bodyRef');const{bodyBase64,bodyText,json,...metadata}=full;return{...metadata,bodyRef};
}
async function retainDefinition(full,callbacks){
 const definitionRef=typeof callbacks.onDefinition==='function'?await callbacks.onDefinition(full):undefined;
 if(callbacks.retainBodies)return full;
 sinkReference(definitionRef,'definitionRef');const{contentBase64,...metadata}=full;return{...metadata,definitionRef};
}
export async function executeFlowableRequest(transport,plan,input={}){
 const callbacks=captureOptions(input);let full;
 try{full=await transport.execute(plan,callbacks);}catch(error){if(error.exchange){try{error.exchange=await retainExchange(error.exchange,callbacks);}catch(saveError){error.persistenceError={code:saveError.code,message:saveError.message};}}throw error;}
 return retainExchange(full,callbacks);
}

const COLLECTIONS=Object.freeze({
 deployments:{path:'/repository/deployments',sort:'id'},
 definitions:{path:'/repository/process-definitions',sort:'id'},
 processes:{path:'/runtime/process-instances',sort:'id'},
 tasks:{path:'/runtime/tasks',sort:'id'},
 historicProcesses:{path:'/history/historic-process-instances',sort:'processInstanceId'},
 historicTasks:{path:'/history/historic-task-instances',sort:'taskInstanceId'},
 activities:{path:'/runtime/activity-instances',sort:'activityInstanceId'},
 historicActivities:{path:'/history/historic-activity-instances',sort:'activityInstanceId'},
 historicVariables:{path:'/history/historic-variable-instances'}
});
function metadataExchange(value){return{requestSha256:value.requestSha256,request:value.request,status:value.status,ok:value.ok,complete:value.complete,bodyBytes:value.bodyBytes,bodySha256:value.bodySha256,...(value.bodyRef?{bodyRef:value.bodyRef}:{})};}
async function readNative(transport,path,query,callbacks,options={}){
 let full;
 try{full=await transport.request({method:'GET',path,query:queryObject(query),mutation:false},callbacks.signal);}
 catch(error){if(error.exchange){try{error.exchange=await retainExchange(error.exchange,callbacks);}catch(saveError){error.persistenceError={code:saveError.code,message:saveError.message};}}throw error;}
 const exchange=await retainExchange(full,callbacks);
 if(!full.ok&&!(options.allowMissing&&full.status===404))throw fail('FLOWABLE_NATIVE_READ_REJECTED','The original Flowable read returned HTTP '+full.status+'.',{status:full.status,exchange});
 return{full,exchange,json:full.json,found:full.ok};
}
function uniqueRecords(records,label){
 const seen=new Set();
 for(const item of records){object(item,label+' record');if(typeof item.id!=='string'||!item.id)throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED',label+' record lacks its original ID.');if(seen.has(item.id))throw fail('FLOWABLE_INVENTORY_CHANGED',label+' repeated an ID while pages were being read.');seen.add(item.id);}
}
async function readCollection(transport,name,query,callbacks){
 const declaration=COLLECTIONS[name];if(!declaration)throw fail('FLOWABLE_INPUT_INVALID','Unsupported original collection.');
 const pageSize=callbacks.pageSize??100;if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>10000)throw fail('FLOWABLE_INPUT_INVALID','Native pageSize must be from 1 to 10000.');
 const items=[],pages=[],exchanges=[],variableEvidence=[];let start=0,total=null;
 for(;;){
  const selected={...query,...(declaration.sort?{sort:declaration.sort,order:'asc'}:{}),start,size:pageSize};
  const response=await readNative(transport,declaration.path,selected,callbacks);
  const page=response.json;
  if(!plain(page)||!Array.isArray(page.data)||!Number.isSafeInteger(page.start)||!Number.isSafeInteger(page.size)||!Number.isSafeInteger(page.total)||page.start!==start||page.total<0||page.size!==page.data.length||page.data.length>pageSize)throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The original '+name+' page does not match its DataResponse contract.',{exchange:response.exchange});
  if(total===null)total=page.total;
  else if(total!==page.total)throw fail('FLOWABLE_INVENTORY_CHANGED','The original '+name+' collection changed its total during capture.',{capturedItems:items.length,previousTotal:total,currentTotal:page.total,exchange:response.exchange});
  items.push(...page.data);if(name==='historicVariables'){try{variableEvidence.push(...losslessJson(response.full.bodyText).data);}catch{throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The complete native variable page is not valid lossless JSON.');}}exchanges.push(response.exchange);pages.push({start:page.start,size:page.size,total:page.total,sort:page.sort??null,order:page.order??null,...metadataExchange(response.exchange)});
  if(items.length>total)throw fail('FLOWABLE_INVENTORY_CHANGED','The original '+name+' pages exceed their reported total.');
  start+=page.data.length;
  if(start===total)break;
  if(!page.data.length)throw fail('FLOWABLE_INVENTORY_INCOMPLETE','The original '+name+' collection stopped before its complete reported total.',{capturedItems:items.length,total});
 }
 uniqueRecords(items,name);return{items,pages,total,complete:true,atomicSnapshot:false,exchanges,...(name==='historicVariables'?{variableEvidence}:{})};
}
async function readDeploymentResources(transport,deployment,definitions,callbacks){
 const deploymentId=nativeId(deployment.id,'deploymentId'),listing=await readNative(transport,'/repository/deployments/'+encodeURIComponent(deploymentId)+'/resources',{},callbacks),resources=[],exchanges=[listing.exchange];
 if(!Array.isArray(listing.json))throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The original deployment resource endpoint must return its complete array.',{exchange:listing.exchange});
 const seen=new Set();
 for(const item of listing.json){
  object(item,'Deployment resource');const filename=item.id??item.name;
  text(filename,'Native resource name',16384);if(seen.has(filename))throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The deployment resource list repeats an original name.');seen.add(filename);
  text(item.dataUrl,'Native resource dataUrl',16384);
  const response=await readNative(transport,item.dataUrl,{},callbacks,{binary:true});exchanges.push(response.exchange);
  const bytes=Buffer.from(response.full.bodyBase64,'base64');
  const nativeLinks=new Set([filename,item.url].filter(value=>typeof value==='string'&&value.length));
  const related=definitions.filter(definition=>definition.deploymentId===deploymentId&&
   (nativeLinks.has(definition.resource)||nativeLinks.has(definition.diagramResource)));
  const resource={schema:'stellar-forge.flowable-source-resource.v1',kind:'deployment-resource',deploymentId,...(related.length===1?{definitionId:related[0].id}:{}),definitionIds:related.map(v=>v.id),filename,contentType:response.full.headers['content-type']??item.mediaType??item.contentType??'application/octet-stream',bytes:bytes.length,sha256:hash(bytes),contentBase64:bytes.toString('base64'),native:item,exchange:metadataExchange(response.exchange)};
  resources.push(await retainDefinition(resource,callbacks));
 }
 return{resources,exchanges};
}
export async function captureFlowablePortfolio(transport,input={}){
 const callbacks=captureOptions(input),startedAt=now(),collections={},exchanges=[],resources=[];
 for(const name of ['deployments','definitions','processes','tasks','historicProcesses','historicTasks','historicActivities','historicVariables']){
  const collection=await readCollection(transport,name,{},callbacks);collections[name]=collection;exchanges.push(...collection.exchanges);
 }
 for(const deployment of collections.deployments.items){const found=await readDeploymentResources(transport,deployment,collections.definitions.items,callbacks);resources.push(...found.resources);exchanges.push(...found.exchanges);}
 return{schema:'stellar-forge.flowable-native-portfolio.v1',connectionId:transport.connection.id,connectionSha256:transport.connectionSha256,startedAt,completedAt:now(),collections,resources,exchanges,atomicSnapshot:false};
}
function responseFor(plan,response){
 if(!response)return null;
 if(!plain(response)||response.connectionId!==plan.connectionId||response.connectionSha256!==plan.connectionSha256||response.requestSha256!==plan.requestSha256||response.request?.method!==plan.method||response.request?.path!==plan.path||response.request?.bodySha256!==plan.bodySha256)throw fail('FLOWABLE_RESPONSE_CHANGED','The supplied receipt does not belong to this exact original request.');
 if(response.bodyBase64!==undefined){const bytes=Buffer.from(response.bodyBase64,'base64');if(bytes.toString('base64')!==response.bodyBase64||bytes.length!==response.bodyBytes||hash(bytes)!==response.bodySha256)throw fail('FLOWABLE_RESPONSE_CHANGED','The supplied original response bytes changed.');if(response.complete){let parsed=null;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}catch{}if(canonical(parsed)!==canonical(response.json??null))throw fail('FLOWABLE_RESPONSE_CHANGED','The response JSON differs from its complete original bytes.');}}
 return response;
}
function appendUnique(target,records){const seen=new Set(target.map(v=>v.id));for(const record of records){if(!seen.has(record.id)){target.push(record);seen.add(record.id);}}}
export async function readFlowableRequestState(transport,plan,input={}){
 validatePlan(transport.connection,plan);const callbacks=captureOptions(input),response=responseFor(plan,callbacks.response),state={schema:'stellar-forge.flowable-native-state.v1',connectionId:transport.connection.id,connectionSha256:transport.connectionSha256,action:plan.action,observedAt:now(),definitions:[],deployments:[],processes:[],historicProcesses:[],tasks:[],historicTasks:[],activities:[],historicActivities:[],historicVariables:[],variableEvidence:[],resources:[],exchanges:[]};
 const exactSeen=new Set(),collectionSeen=new Set();
 async function exact(name,path,id){
  if(!id)return null;nativeId(id,'Selected native ID');const key=name+':'+id;
  if(exactSeen.has(key))return state[name].find(v=>v.id===id)??null;exactSeen.add(key);
  const result=await readNative(transport,path+'/'+encodeURIComponent(id),{},callbacks,{allowMissing:true});state.exchanges.push(result.exchange);
  if(!result.found)return null;object(result.json,'Selected '+name);if(result.json.id!==id)throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The original selected resource returned a different native ID.',{exchange:result.exchange});
  appendUnique(state[name],[result.json]);return result.json;
 }
 async function collection(name,query){
  const key=name+':'+canonical(query);if(collectionSeen.has(key))return;collectionSeen.add(key);
  const result=await readCollection(transport,name,query,callbacks);appendUnique(state[name],result.items);if(name==='historicVariables')appendUnique(state.variableEvidence,result.variableEvidence);state.exchanges.push(...result.exchanges);
 }
 async function process(id){
  if(!id)return;
  await exact('processes','/runtime/process-instances',id);
  await exact('historicProcesses','/history/historic-process-instances',id);
  await collection('tasks',{processInstanceId:id});
  await collection('historicTasks',{processInstanceId:id});
  await collection('activities',{processInstanceId:id,finished:false});
  await collection('historicActivities',{processInstanceId:id});
  await collection('historicVariables',{processInstanceId:id});
 }
 const returnedId=response?.complete&&plain(response.json)&&typeof response.json.id==='string'?response.json.id:null;
 if(plan.action==='deploy'){
  const q={name:plan.readback.deploymentName,...(plan.readback.withoutTenantId?{withoutTenantId:true}:{tenantId:plan.readback.tenantId})};
  await collection('deployments',q);
  if(returnedId)await exact('deployments','/repository/deployments',returnedId);
  if(plan.readback.deploymentKey!==undefined)state.deployments=state.deployments.filter(v=>v.id===returnedId||v.key===plan.readback.deploymentKey);
  for(const deployment of state.deployments)await collection('definitions',{deploymentId:deployment.id});
 }else if(plan.action==='start'){
  const q={};if(plan.readback.businessKey!==null)q.businessKey=plan.readback.businessKey;
  if(plan.readback.selector==='processDefinitionId')q.processDefinitionId=plan.readback.selectorValue;
  else if(plan.readback.selector==='processDefinitionKey')q.processDefinitionKey=plan.readback.selectorValue;
  if(plan.readback.tenantId!==null)q.tenantId=plan.readback.tenantId;
  // A message start without businessKey has no unique native query. Its returned ID is authoritative.
  if(Object.keys(q).length){await collection('processes',q);await collection('historicProcesses',q);}
  if(returnedId)await process(returnedId);
  for(const id of new Set([...state.processes,...state.historicProcesses].map(v=>v.id)))await process(id);
  if(plan.readback.selector==='processDefinitionId')await exact('definitions','/repository/process-definitions',plan.readback.selectorValue);
  else if(plan.readback.selector==='processDefinitionKey')await collection('definitions',{key:plan.readback.selectorValue,...(plan.readback.tenantId!==null?{tenantId:plan.readback.tenantId}:{})});
 }else if(['claim','complete','delegate','resolve'].includes(plan.action)){
  const task=await exact('tasks','/runtime/tasks',plan.readback.taskId);
  const historic=await exact('historicTasks','/history/historic-task-instances',plan.readback.taskId);
  for(const id of new Set([task?.processInstanceId,historic?.processInstanceId].filter(Boolean)))await process(id);
 }else{
  if(plan.readback.processInstanceId)await process(plan.readback.processInstanceId);
  else if(plan.readback.processDefinitionId){await exact('definitions','/repository/process-definitions',plan.readback.processDefinitionId);await collection('processes',{processDefinitionId:plan.readback.processDefinitionId});for(const item of [...state.processes])await process(item.id);}
  if(plan.readback.toProcessDefinitionId)await exact('definitions','/repository/process-definitions',plan.readback.toProcessDefinitionId);
  else await collection('definitions',{key:plan.readback.toProcessDefinitionKey,version:plan.readback.toProcessDefinitionVersion,...(plan.readback.toProcessDefinitionTenantId!==null?{tenantId:plan.readback.toProcessDefinitionTenantId}:{})});
 }
 for(const item of [...state.processes,...state.historicProcesses,...state.tasks,...state.historicTasks])if(item.processDefinitionId)await exact('definitions','/repository/process-definitions',item.processDefinitionId);
 for(const definition of state.definitions)if(definition.deploymentId)await exact('deployments','/repository/deployments',definition.deploymentId);
 for(const deployment of state.deployments){const found=await readDeploymentResources(transport,deployment,state.definitions,callbacks);state.resources.push(...found.resources);state.exchanges.push(...found.exchanges);}
 for(const name of Object.keys(state))if(Array.isArray(state[name])&&!['resources','exchanges'].includes(name))state[name].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 return state;
}

// Lossless comparison is for readback evidence only. Native request bytes are never rewritten.
function losslessJson(source){
 let i=0;
 const space=()=>{while(/\s/u.test(source[i]??'')&&i<source.length)i++;};
 function parse(){
  space();const ch=source[i];
  if(ch==='"'){const start=i++;let escaped=false;for(;i<source.length;i++){const c=source[i];if(!escaped&&c==='"'){i++;return JSON.parse(source.slice(start,i));}if(!escaped&&c==='\\')escaped=true;else escaped=false;}throw new Error('Unterminated string');}
  if(ch==='['){i++;const result=[];space();if(source[i]===']'){i++;return result;}for(;;){result.push(parse());space();if(source[i]===']'){i++;return result;}if(source[i++]!==',')throw new Error('Array separator');}}
  if(ch==='{'){i++;const result=Object.create(null);space();if(source[i]==='}'){i++;return result;}for(;;){const key=parse();if(typeof key!=='string'||own(result,key))throw new Error('Object key');space();if(source[i++]!==':')throw new Error('Object separator');result[key]=parse();space();if(source[i]==='}'){i++;return result;}if(source[i++]!==',')throw new Error('Object separator');}}
  for(const [literal,value]of [['true',true],['false',false],['null',null]])if(source.startsWith(literal,i)){i+=literal.length;return value;}
  const number=source.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
  if(number){i+=number.length;const [mantissa,exponent='0']=number.toLowerCase().split('e'),negative=mantissa[0]==='-',unsigned=negative?mantissa.slice(1):mantissa,parts=unsigned.split('.');let coefficient=(parts[0]+(parts[1]??'')).replace(/^0+/u,''),power=BigInt(exponent)-BigInt(parts[1]?.length??0);if(!coefficient)return{number:'0',exponent:'0'};const zeros=coefficient.match(/0+$/u)?.[0].length??0;if(zeros){coefficient=coefficient.slice(0,-zeros);power+=BigInt(zeros);}return{number:(negative?'-':'')+coefficient,exponent:String(power)};}
  throw new Error('JSON token');
 }
 const result=parse();space();if(i!==source.length)throw new Error('Trailing JSON');return result;
}
function fullStateValues(state){
 const result=[];
 for(const exchange of state?.exchanges??[]){
  if(exchange.complete&&exchange.ok&&typeof exchange.bodyText==='string'){try{const value=losslessJson(exchange.bodyText);if(Array.isArray(value?.data))result.push(...value.data);else if(Array.isArray(value))result.push(...value);else if(plain(value))result.push(value);}catch{}}
 }
 return result;
}
function startVariablesCorrespond(plan,state,processInstanceId){
 let body;try{body=losslessJson(Buffer.from(plan.bodyBase64,'base64').toString('utf8'));}catch{return false;}
 if(body.transientVariables?.length||body.startFormVariables?.length)return false;
 if(!Array.isArray(body.variables)||!body.variables.length)return true;
 const selected=record=>record.processInstanceId===processInstanceId;
 const exact=[...(state.variableEvidence??[]),...fullStateValues(state)].filter(selected),fallback=(state.historicVariables??[]).filter(selected);
 return body.variables.every(variable=>{
  if(!['boolean','string','integer','short','long','double','date'].includes(variable.type))return false;
  const key=variable.name,scope=variable.scope??'global',candidates=exact.filter(v=>v.variable?.name===key||v.name===key);
  if(candidates.some(v=>{const found=v.variable??v;return (found.scope??'global')===scope&&found.type===variable.type&&canonical(found.value)===canonical(variable.value);})){return true;}
  // Safe primitive values can also be checked in original metadata when bodies were sunk.
  const original=JSON.parse(Buffer.from(plan.bodyBase64,'base64').toString('utf8')).variables.find(v=>v.name===key);
  if(typeof original.value==='number'&&!Number.isSafeInteger(original.value)||plain(original.value)||Array.isArray(original.value))return false;
  return fallback.some(v=>{const found=v.variable??v;return found.name===key&&found.type===original.type&&canonical(found.value)===canonical(original.value);});
 });
}
function stateRecords(state,name){return Array.isArray(state?.[name])?state[name]:[];}
function unionNativeIds(...lists){return[...new Set(lists.flat().map(v=>v?.id).filter(v=>typeof v==='string'))].sort();}
function targetDefinitions(plan,state){return stateRecords(state,'definitions').filter(v=>plan.readback.toProcessDefinitionId?v.id===plan.readback.toProcessDefinitionId:v.key===plan.readback.toProcessDefinitionKey&&v.version===plan.readback.toProcessDefinitionVersion&&(plan.readback.toProcessDefinitionTenantId===null||v.tenantId===plan.readback.toProcessDefinitionTenantId));}
function migrationCorrespondence(plan,before,after,selectedIds){
 const targets=targetDefinitions(plan,after);if(targets.length!==1)return{matches:false,reason:'Target definition readback is absent or ambiguous.',targetDefinitionIds:targets.map(v=>v.id)};
 const target=targets[0],body=JSON.parse(Buffer.from(plan.bodyBase64,'base64').toString('utf8'));
 const unsupported=['enableActivityMappings','preUpgradeJavaDelegate','preUpgradeJavaDelegateExpression','preUpgradeScript','postUpgradeJavaDelegate','postUpgradeJavaDelegateExpression','postUpgradeScript','processInstanceVariables','localVariables'].filter(key=>own(body,key));
 const mappings=body.activityMappings??[];
 if(unsupported.length||mappings.some(v=>!plain(v)||typeof v.fromActivityId!=='string'||typeof v.toActivityId!=='string'||Object.keys(v).some(key=>!['fromActivityId','toActivityId'].includes(key))))return{matches:false,reason:'Native migration contains additional mappings, variables, delegates or scripts; the saved native validation and receipt remain authoritative.',targetDefinitionIds:[target.id]};
 const wanted=new Map(mappings.map(v=>[v.fromActivityId,v.toActivityId]));
 for(const id of selectedIds){
  const current=stateRecords(after,'processes').find(v=>v.id===id);
  if(!current||current.processDefinitionId!==target.id)return{matches:false,reason:'A selected live process has not been observed on the exact target definition.',targetDefinitionIds:[target.id]};
  const original=stateRecords(before,'activities').filter(v=>v.processInstanceId===id&&v.endTime==null),active=stateRecords(after,'activities').filter(v=>v.processInstanceId===id&&v.endTime==null);
  const expected=original.map(v=>wanted.get(v.activityId)??v.activityId).sort(),actual=active.map(v=>v.activityId).sort();
  if(canonical(expected)!==canonical(actual))return{matches:false,reason:'Selected active activity IDs differ from the explicit native activity mapping.',targetDefinitionIds:[target.id],processInstanceId:id,expectedActivityIds:expected,actualActivityIds:actual};
  for(const task of stateRecords(before,'tasks').filter(v=>v.processInstanceId===id)){
   const key=wanted.get(task.taskDefinitionKey)??task.taskDefinitionKey;
   const candidates=stateRecords(after,'tasks').filter(v=>v.processInstanceId===id&&v.taskDefinitionKey===key);
   if(candidates.length!==1||['assignee','owner','name','dueDate','priority','category','formKey'].some(field=>canonical(candidates[0][field]??null)!==canonical(task[field]??null)))return{matches:false,reason:'A selected task or preserved native task property differs after migration.',targetDefinitionIds:[target.id],processInstanceId:id,taskId:task.id};
  }
 }
 return{matches:selectedIds.length>0,targetDefinitionIds:[target.id],processInstanceIds:selectedIds,activityMappings:mappings};
}
export function reconcileFlowableRequest(plan,before,after,response){
 response=responseFor(plan,response);
 for(const value of [before,after])if(!plain(value)||value.connectionId!==plan.connectionId||value.connectionSha256!==plan.connectionSha256||value.action!==plan.action)throw fail('FLOWABLE_STATE_CHANGED','Readback belongs to a different original request selection.');
 const acknowledged=Boolean(response?.complete&&response.ok),evidence={requestSha256:plan.requestSha256,nativeAcknowledged:acknowledged,nativeStatus:response?.status??null,responseBodySha256:response?.bodySha256??null,beforeProcessIds:unionNativeIds(stateRecords(before,'processes'),stateRecords(before,'historicProcesses')),afterProcessIds:unionNativeIds(stateRecords(after,'processes'),stateRecords(after,'historicProcesses'))};
 const result=(state,summary,extra={})=>({state,summary,evidence:{...evidence,...extra}});
 if(response?.complete&&!response.ok&&response.status>=400&&response.status<500)return result('REJECTED','The original Flowable operation returned a native rejection; its complete response is retained.');
 if(plan.action==='validateMigration'){
  if(acknowledged&&Array.isArray(response.json?.validationMessages))return response.json.validationMessages.length?result('REJECTED','Original native migration validation returned messages.',{validationMessages:response.json.validationMessages}):result('CONFIRMED','Original native migration validation completed with no messages.',{validationMessages:[]});
  return result('UNKNOWN','The complete original migration validation result is not available.');
 }
 if(plan.action==='deploy'){
  const oldIds=new Set(stateRecords(before,'deployments').map(v=>v.id)),returnedId=acknowledged?response.json?.id:null;
  const candidates=stateRecords(after,'deployments').filter(v=>returnedId?v.id===returnedId:!oldIds.has(v.id));
  const sourceMatches=candidates.filter(v=>stateRecords(after,'resources').some(r=>r.deploymentId===v.id&&r.filename===plan.source.filename&&r.bytes===plan.source.bytes&&r.sha256===plan.source.sha256));
  if(returnedId&&candidates.length===1&&(sourceMatches.length===1||/\.(bar|zip)$/iu.test(plan.source.filename)))return result('CONFIRMED','The exact returned native deployment and its original resource readback are retained.',{deploymentIds:[returnedId],confirmation:'NATIVE_DEPLOYMENT_RECEIPT_AND_READBACK',exactSingleSource:sourceMatches.length===1});
  if(!acknowledged&&sourceMatches.length===1)return result('CONFIRMED','One new native deployment contains the complete exact submitted BPMN bytes.',{deploymentIds:[sourceMatches[0].id],confirmation:'NEW_NATIVE_DEPLOYMENT_WITH_EXACT_SOURCE'});
  return result(acknowledged?'ACCEPTED':'UNKNOWN',acknowledged?'The original deployment receipt is retained; a matching complete selected deployment readback is pending.':'No unique new native deployment has been identified without repeating the write.',{candidateDeploymentIds:candidates.map(v=>v.id)});
 }
 if(plan.action==='start'){
  const oldIds=new Set(evidence.beforeProcessIds),records=[...stateRecords(after,'processes'),...stateRecords(after,'historicProcesses')],byId=new Map(records.map(v=>[v.id,v]));
  const returnedId=acknowledged?response.json?.id:null;
  const matching=[...byId.values()].filter(v=>(plan.readback.businessKey===null||v.businessKey===plan.readback.businessKey)&&(plan.readback.selector!=='processDefinitionId'||v.processDefinitionId===plan.readback.selectorValue)&&(plan.readback.selector!=='processDefinitionKey'||v.processDefinitionKey===plan.readback.selectorValue||stateRecords(after,'definitions').some(d=>d.id===v.processDefinitionId&&d.key===plan.readback.selectorValue))&&(plan.readback.tenantId===null||v.tenantId===plan.readback.tenantId));
  if(returnedId&&matching.some(v=>v.id===returnedId))return result('CONFIRMED','The original start receipt identifies the exact native process and its current or historic record.',{processInstanceIds:[returnedId],confirmation:'NATIVE_START_RECEIPT_AND_READBACK'});
  const fresh=matching.filter(v=>!oldIds.has(v.id));
  if(!acknowledged&&plan.readback.businessKey!==null&&fresh.length===1&&startVariablesCorrespond(plan,after,fresh[0].id))return result('CONFIRMED','One new native process matches the reviewed business key, definition and retained initial variables.',{processInstanceIds:[fresh[0].id],confirmation:'NEW_NATIVE_PROCESS_WITH_REVIEWED_BUSINESS_KEY'});
  return result(acknowledged?'ACCEPTED':'UNKNOWN',acknowledged?'The native start receipt is retained; its selected process readback is pending.':'The original start outcome remains unresolved; no second start was sent.',{candidateProcessInstanceIds:fresh.map(v=>v.id)});
 }
 if(['claim','complete','delegate','resolve'].includes(plan.action)){
  const id=plan.readback.taskId,current=stateRecords(after,'tasks').find(v=>v.id===id),historic=stateRecords(after,'historicTasks').find(v=>v.id===id),prior=stateRecords(before,'tasks').find(v=>v.id===id);let matches=false;
  if(plan.action==='complete')matches=Boolean(prior&&!current&&historic?.endTime&&[null,undefined,'completed'].includes(historic.deleteReason)&&historic.processInstanceId===prior.processInstanceId);
  else if(plan.action==='claim')matches=Boolean(current&&(current.assignee??null)===plan.readback.assignee);
  else if(plan.action==='delegate')matches=Boolean(current&&current.assignee===plan.readback.assignee&&String(current.delegationState).toLowerCase()==='pending'&&current.owner===(prior?.owner??prior?.assignee??null));
  else matches=Boolean(current&&String(current.delegationState).toLowerCase()==='resolved'&&prior?.owner&&current.assignee===prior.owner);
  if(matches)return result('CONFIRMED',plan.action==='complete'?'The original task completion is present in native task history.':'The selected task has the exact native assignment/delegation state.',{taskIds:[id],processInstanceIds:[current?.processInstanceId??historic?.processInstanceId].filter(Boolean),confirmation:acknowledged?'NATIVE_TASK_RECEIPT_AND_READBACK':'CURRENT_NATIVE_TASK_STATE_MATCH',historicEndTime:historic?.endTime??null});
  return result(acknowledged?'ACCEPTED':'UNKNOWN',acknowledged?'The original task action was acknowledged; its expected selected readback is pending.':'The task outcome remains unresolved without repeating the original action.',{taskIds:[id]});
 }
 const selected=plan.readback.processInstanceId?[plan.readback.processInstanceId]:stateRecords(before,'processes').filter(v=>v.processDefinitionId===plan.readback.processDefinitionId).map(v=>v.id);
 const correspondence=migrationCorrespondence(plan,before,after,selected);
 if(correspondence.matches)return result('CONFIRMED','All selected native processes, active activities and preserved tasks match the exact migration target.',{...correspondence,confirmation:acknowledged?'NATIVE_MIGRATION_RECEIPT_AND_READBACK':'CURRENT_NATIVE_MIGRATION_STATE_MATCH'});
 return result(acknowledged?'ACCEPTED':'UNKNOWN',acknowledged?'The original native migration was acknowledged; complete selected target correspondence remains pending.':'Native migration outcome remains unresolved without repeating its dispatch.',correspondence);
}
