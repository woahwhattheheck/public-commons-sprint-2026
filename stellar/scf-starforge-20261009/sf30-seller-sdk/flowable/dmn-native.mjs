// MIT. Original Flowable 8 DMN REST requests, complete source and native history.
// Auth, HTTP ownership, bounded response collection and retained exchanges use native.mjs.
import {createHash} from 'node:crypto';
import {normalizeFlowableConnection,flowableConnectionSha256,createFlowableTransport,executeFlowableRequest,FLOWABLE_NATIVE_VERSION,FLOWABLE_NATIVE_COMMIT} from './native.mjs';

export const FLOWABLE_DMN_NATIVE_SCHEMA='stellar-forge.flowable-dmn-native-request.v1';
export const FLOWABLE_DMN_COLLECTIONS=Object.freeze(['deployments','definitions','historicExecutions']);
export const FLOWABLE_DMN_SOURCE_KIND='dmn-definition-resource';
export const FLOWABLE_DMN_AUDIT_KIND='dmn-execution-audit';
export const FLOWABLE_DMN_MODES=Object.freeze(['auto','decision','decisionService']);
export {FLOWABLE_NATIVE_VERSION,FLOWABLE_NATIVE_COMMIT,normalizeFlowableConnection};
const SHA=/^[a-f0-9]{64}$/;
const own=(value,key)=>Object.hasOwn(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const hash=value=>createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
function fail(code,message,extra={}){return Object.assign(new Error(message),{code,...extra});}
function object(value,label){if(!plain(value))throw fail('FLOWABLE_INPUT_INVALID',label+' must be a JSON object.');return value;}
function keys(value,allowed,label){object(value,label);for(const key of Object.keys(value))if(!allowed.includes(key))throw fail('FLOWABLE_INPUT_INVALID',label+' contains unsupported field '+key+'.');}
function text(value,label,maximum=8192,empty=false){if(typeof value!=='string'||(!empty&&!value.length)||value.length>maximum||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))throw fail('FLOWABLE_INPUT_INVALID',label+' must be complete text within its declared bound.');return value;}
function nativeId(value,label='Native ID'){text(value,label,2048);if(value==='.'||value==='..'||/[/\\\r\n]/u.test(value))throw fail('FLOWABLE_INPUT_INVALID',label+' must be one native path component.');return value;}
function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(plain(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 throw fail('FLOWABLE_INPUT_INVALID','Value must be JSON serializable.');
}
const objectHash=value=>hash(canonical(value));
function exactBase64(value,label,maximum=256*1024*1024){
 if(typeof value!=='string'||!value.length||value.length>Math.ceil(maximum/3)*4)throw fail('FLOWABLE_INPUT_INVALID',label+' must contain complete Base64 bytes within its declared limit.');
 const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value||bytes.length>maximum)throw fail('FLOWABLE_INPUT_INVALID',label+' must be canonical complete Base64.');return bytes;
}
function bodyObject(value){
 if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>64*1024*1024)throw fail('FLOWABLE_INPUT_INVALID','bodyText must contain complete original JSON within 64 MiB.');
 let parsed;try{parsed=JSON.parse(value);}catch{throw fail('FLOWABLE_INPUT_INVALID','bodyText must be valid complete JSON.');}return object(parsed,'bodyText');
}
function captureOptions(value={}){
 object(value,'Capture options');const retainBodies=value.retainBodies??!(typeof value.onExchange==='function'&&typeof value.onDefinition==='function');
 if(typeof retainBodies!=='boolean')throw fail('FLOWABLE_INPUT_INVALID','retainBodies must be a boolean.');
 return {...value,retainBodies};
}
function sinkReference(value){
 if(!plain(value)||!SHA.test(value.sha256||'')||!Number.isSafeInteger(value.bytes)||value.bytes<0||typeof value.mediaType!=='string')throw fail('FLOWABLE_SINK_INVALID','definitionRef must identify the complete immutable source JSON bytes.');
 return value;
}
function queryObject(value={}){
 object(value,'Native query');const result={};
 for(const [key,entry] of Object.entries(value)){text(key,'Query key',256);if(entry===undefined||entry===null)continue;if(!['string','number','boolean'].includes(typeof entry)||typeof entry==='number'&&!Number.isFinite(entry))throw fail('FLOWABLE_INPUT_INVALID','Native query values must be scalars.');result[key]=String(entry);}
 return result;
}
function requestCore(spec){return{connectionId:spec.connectionId,connectionSha256:spec.connectionSha256,method:spec.method,path:spec.path,query:spec.query??{},contentType:spec.contentType??null,bodyBytes:spec.bodyBytes??0,bodySha256:spec.bodySha256??null};}
const isDmnResource=name=>['dmn','dmn.xml','dmn11','.dmn11.xml'].some(suffix=>name.endsWith(suffix));
function multipart(source,query,original){
 const boundary='FlowableDmnNative'+objectHash({source,query}).slice(0,48);
 const prefix=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+source.filename+'"\r\nContent-Type: '+source.contentType+'\r\n\r\n','utf8');
 const suffix=Buffer.from('\r\n--'+boundary+'--\r\n','utf8');
 if(original.includes(Buffer.from('\r\n--'+boundary)))throw fail('FLOWABLE_INPUT_INVALID','Selected source collides with its exact multipart boundary.');
 return{contentType:'multipart/form-data; boundary='+boundary,bytes:Buffer.concat([prefix,original,suffix]),prefix,suffix};
}
function finishPlan(connection,fields){
 const plan={schema:FLOWABLE_DMN_NATIVE_SCHEMA,engineVersion:FLOWABLE_NATIVE_VERSION,connectionId:connection.id,connectionSha256:flowableConnectionSha256(connection),...fields};
 plan.requestSha256=objectHash(requestCore(plan));return plan;
}
export function planFlowableDmnRequest(connectionInput,input){
 const connection=normalizeFlowableConnection(connectionInput);object(input,'DMN selection');
 let path,query={},bytes,contentType='application/json',readback,source;
 if(input.action==='deploy'){
  keys(input,['action','tenantId','resource'],'DMN deployment selection');
  keys(input.resource,['filename','contentType','contentBase64'],'DMN deployment resource');
  const filename=nativeId(input.resource.filename,'DMN filename');
  if(!isDmnResource(filename))throw fail('FLOWABLE_INPUT_INVALID','The original Flowable DMN upload accepts a resource ending dmn, dmn.xml, dmn11 or .dmn11.xml; ZIP/BAR is not implemented by this native controller.');
  if(/["\\\r\n]/u.test(filename))throw fail('FLOWABLE_INPUT_INVALID','The original multipart filename contains a header separator.');
  const original=exactBase64(input.resource.contentBase64,'DMN source');
  const fileType=input.resource.contentType??'application/xml';text(fileType,'DMN content type',256);if(/[\r\n]/u.test(fileType))throw fail('FLOWABLE_INPUT_INVALID','Content type contains a header separator.');
  if(own(input,'tenantId'))query.tenantId=text(input.tenantId,'tenantId',2048,true);
  source={filename,contentType:fileType,bytes:original.length,sha256:hash(original)};
  const body=multipart(source,query,original);bytes=body.bytes;contentType=body.contentType;
  path='/dmn-repository/deployments';readback={deploymentName:filename,tenantId:own(input,'tenantId')?input.tenantId:null,source};
 }else if(input.action==='evaluate'){
  keys(input,['action','mode','singleResult','bodyText'],'DMN evaluation selection');
  const mode=input.mode??'auto',singleResult=input.singleResult??false;
  if(!FLOWABLE_DMN_MODES.includes(mode)||typeof singleResult!=='boolean')throw fail('FLOWABLE_INPUT_INVALID','Choose original mode auto, decision or decisionService and a boolean singleResult.');
  const body=bodyObject(input.bodyText);
  keys(body,['decisionKey','tenantId','parentDeploymentId','inputVariables','disableHistory'],'Native decision request');
  nativeId(body.decisionKey,'decisionKey');
  for(const name of ['tenantId','parentDeploymentId'])if(body[name]!==undefined&&body[name]!==null)text(body[name],name,2048,true);
  if(body.disableHistory!==undefined&&typeof body.disableHistory!=='boolean')throw fail('FLOWABLE_INPUT_INVALID','disableHistory must be the original boolean setting.');
  if(body.inputVariables!==undefined&&body.inputVariables!==null){
   if(!Array.isArray(body.inputVariables))throw fail('FLOWABLE_INPUT_INVALID','Native inputVariables must be an array.');
   const names=new Set();
   for(const variable of body.inputVariables){
    keys(variable,['name','type','value','valueUrl'],'Native input variable');text(variable.name,'Variable name',8192);
    if(names.has(variable.name))throw fail('FLOWABLE_INPUT_INVALID','Native inputVariables must not silently replace a repeated name.');names.add(variable.name);
    if(variable.type!==undefined&&variable.type!==null)text(variable.type,'Native variable type',256);
    if(variable.valueUrl!==undefined&&variable.valueUrl!==null)text(variable.valueUrl,'Native variable valueUrl',16384);
   }
  }
  const routes={auto:'/dmn-rule/execute',decision:'/dmn-rule/execute-decision',decisionService:'/dmn-rule/execute-decision-service'};
  path=routes[mode]+(singleResult?'/single-result':'');bytes=Buffer.from(input.bodyText,'utf8');
  readback={mode,singleResult,decisionKey:body.decisionKey,tenantId:body.tenantId??null,parentDeploymentId:body.parentDeploymentId??null,disableHistory:body.disableHistory??false,selectionSemantics:'NATIVE_KEY_TENANT_PARENT_DEPLOYMENT'};
 }else throw fail('FLOWABLE_INPUT_INVALID','DMN action must be deploy or evaluate.');
 return finishPlan(connection,{action:input.action,mutation:true,method:'POST',path,query,contentType,bodyBytes:bytes.length,bodySha256:hash(bytes),bodyBase64:bytes.toString('base64'),readback,...(source?{source}:{})});
}
function validatePlan(connectionInput,plan){
 const connection=normalizeFlowableConnection(connectionInput);object(plan,'Saved DMN plan');
 if(plan.schema!==FLOWABLE_DMN_NATIVE_SCHEMA||plan.engineVersion!==FLOWABLE_NATIVE_VERSION||plan.connectionId!==connection.id||plan.connectionSha256!==flowableConnectionSha256(connection))throw fail('FLOWABLE_PLAN_CHANGED','The saved DMN plan belongs to a different declared native connection.');
 const bytes=exactBase64(plan.bodyBase64,'Saved DMN request',260*1024*1024);
 if(bytes.length!==plan.bodyBytes||hash(bytes)!==plan.bodySha256||objectHash(requestCore(plan))!==plan.requestSha256)throw fail('FLOWABLE_PLAN_CHANGED','The complete saved DMN request bytes changed.');
 let selection;
 if(plan.action==='deploy'){
  object(plan.source,'DMN source identity');
  const guessed=multipart(plan.source,plan.query??{},Buffer.alloc(0));
  const end=guessed.prefix.length+plan.source.bytes;
  if(!Number.isSafeInteger(plan.source.bytes)||plan.source.bytes<1||end+guessed.suffix.length!==bytes.length||!bytes.subarray(0,guessed.prefix.length).equals(guessed.prefix)||!bytes.subarray(end).equals(guessed.suffix))throw fail('FLOWABLE_PLAN_CHANGED','The original multipart source boundary changed.');
  const original=bytes.subarray(guessed.prefix.length,end);
  if(hash(original)!==plan.source.sha256)throw fail('FLOWABLE_PLAN_CHANGED','The original DMN source bytes changed.');
  selection={action:'deploy',resource:{filename:plan.source.filename,contentType:plan.source.contentType,contentBase64:original.toString('base64')},...(own(plan.query??{},'tenantId')?{tenantId:plan.query.tenantId}:{})};
 }else selection={action:'evaluate',mode:plan.readback?.mode,singleResult:plan.readback?.singleResult,bodyText:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)};
 const rebuilt=planFlowableDmnRequest(connection,selection);
 if(canonical(rebuilt)!==canonical(plan))throw fail('FLOWABLE_PLAN_CHANGED','The saved DMN method, native selection or readback identity changed.');
 return plan;
}
export function createFlowableDmnTransport(connectionInput,options={}){
 // The operator supplies the original DMN API base explicitly. There is no inferred sibling URL.
 const native=createFlowableTransport(connectionInput,options);
 return Object.freeze({...native,execute:(plan,options={})=>native.request(validatePlan(native.connection,plan),options.signal)});
}
export async function executeFlowableDmnRequest(transport,plan,callbacks={}){
 validatePlan(transport.connection,plan);
 return executeFlowableRequest(transport,plan,callbacks);
}
function metadataExchange(value){return{requestSha256:value.requestSha256,request:value.request,status:value.status,ok:value.ok,complete:value.complete,bodyBytes:value.bodyBytes,bodySha256:value.bodySha256,...(value.bodyRef?{bodyRef:value.bodyRef}:{})};}
async function retainDefinition(full,callbacks){
 const ref=typeof callbacks.onDefinition==='function'?await callbacks.onDefinition(full):undefined;
 if(callbacks.retainBodies)return full;
 sinkReference(ref);const{contentBase64,...metadata}=full;return{...metadata,definitionRef:ref};
}
async function readNative(transport,path,query,callbacks,{allowMissing=false}={}){
 let full;
 const exchange=await executeFlowableRequest({execute:(spec,options)=>transport.request(spec,options.signal)},{method:'GET',path,query:queryObject(query),mutation:false},{...callbacks,onExchange:async value=>{full=value;return typeof callbacks.onExchange==='function'?callbacks.onExchange(value):undefined;}});
 if(!full)throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The original native reader did not retain a complete exchange.');
 if(!full.ok&&!(allowMissing&&full.status===404))throw fail('FLOWABLE_NATIVE_READ_REJECTED','The original DMN read returned HTTP '+full.status+'.',{status:full.status,exchange});
 return{full,exchange,json:full.json,found:full.ok};
}
const COLLECTION_PATHS=Object.freeze({
 deployments:{path:'/dmn-repository/deployments',sort:'id'},
 definitions:{path:'/dmn-repository/decisions',sort:'id'},
 historicExecutions:{path:'/dmn-history/historic-decision-executions',sort:'startTime'}
});
function uniqueRecords(items,label){
 const seen=new Set();for(const item of items){object(item,label+' record');if(typeof item.id!=='string'||!item.id||seen.has(item.id))throw fail('FLOWABLE_INVENTORY_CHANGED','The original '+label+' pages omit or repeat a native ID.');seen.add(item.id);}
}
async function readCollection(transport,name,query,callbacks){
 const declared=COLLECTION_PATHS[name];if(!declared)throw fail('FLOWABLE_INPUT_INVALID','Unknown DMN collection.');
 const pageSize=callbacks.pageSize??100;if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>10000)throw fail('FLOWABLE_INPUT_INVALID','Native pageSize must be from 1 to 10000.');
 const items=[],pages=[],exchanges=[];let start=0,total=null;
 for(;;){
  const response=await readNative(transport,declared.path,{...query,sort:declared.sort,order:'asc',start,size:pageSize},callbacks),page=response.json;
  if(!plain(page)||!Array.isArray(page.data)||!Number.isSafeInteger(page.start)||!Number.isSafeInteger(page.size)||!Number.isSafeInteger(page.total)||page.start!==start||page.total<0||page.size!==page.data.length||page.data.length>pageSize)throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The original '+name+' page does not match its complete DataResponse.',{exchange:response.exchange});
  if(total===null)total=page.total;
  else if(total!==page.total)throw fail('FLOWABLE_INVENTORY_CHANGED','The original '+name+' changed its total during capture.',{capturedItems:items.length,previousTotal:total,currentTotal:page.total,exchange:response.exchange});
  items.push(...page.data);exchanges.push(response.exchange);pages.push({start:page.start,size:page.size,total:page.total,sort:page.sort??null,order:page.order??null,...metadataExchange(response.exchange)});
  start+=page.data.length;if(start>total)throw fail('FLOWABLE_INVENTORY_CHANGED','Native pages exceed their reported total.');
  if(start===total)break;
  if(!page.data.length)throw fail('FLOWABLE_INVENTORY_INCOMPLETE','The original '+name+' stopped before its reported total.',{capturedItems:items.length,total});
 }
 uniqueRecords(items,name);return{items,pages,total,complete:true,atomicSnapshot:false,exchanges};
}
async function readDefinitionResources(transport,definitions,callbacks,extra=[]){
 const selected=new Map();
 for(const definition of definitions){
  nativeId(definition.id,'decisionId');nativeId(definition.deploymentId,'deploymentId');text(definition.resourceName,'DMN resource name',16384);
  const key=definition.deploymentId+'\u0000'+definition.resourceName;
  if(!selected.has(key))selected.set(key,{deploymentId:definition.deploymentId,filename:definition.resourceName,definitionIds:[]});
  selected.get(key).definitionIds.push(definition.id);
 }
 for(const item of extra){nativeId(item.deploymentId,'deploymentId');text(item.filename,'DMN resource name',16384);const key=item.deploymentId+'\u0000'+item.filename;if(!selected.has(key))selected.set(key,{deploymentId:item.deploymentId,filename:item.filename,definitionIds:[]});}
 const resources=[],exchanges=[];
 for(const item of selected.values()){
  const response=await readNative(transport,'/dmn-repository/deployments/'+encodeURIComponent(item.deploymentId)+'/resourcedata/'+encodeURIComponent(item.filename),{},callbacks);
  exchanges.push(response.exchange);const bytes=Buffer.from(response.full.bodyBase64,'base64');
  const resource={schema:'stellar-forge.flowable-source-resource.v1',kind:FLOWABLE_DMN_SOURCE_KIND,...item,...(item.definitionIds.length===1?{definitionId:item.definitionIds[0]}:{}),contentType:response.full.headers['content-type']??'application/xml',bytes:bytes.length,sha256:hash(bytes),contentBase64:bytes.toString('base64'),exchange:metadataExchange(response.exchange)};
  resources.push(await retainDefinition(resource,callbacks));
 }
 return{resources,exchanges};
}
async function readAuditResources(transport,executions,callbacks){
 const resources=[],exchanges=[];
 for(const item of executions){
  const executionId=nativeId(item.id,'historicDecisionExecutionId');
  const response=await readNative(transport,'/dmn-history/historic-decision-executions/'+encodeURIComponent(executionId)+'/auditdata',{},callbacks);
  exchanges.push(response.exchange);const bytes=Buffer.from(response.full.bodyBase64,'base64');
  const resource={schema:'stellar-forge.flowable-source-resource.v1',kind:FLOWABLE_DMN_AUDIT_KIND,executionId,...(item.decisionDefinitionId?{definitionId:item.decisionDefinitionId}:{}),...(item.deploymentId?{deploymentId:item.deploymentId}:{}),filename:executionId+'.audit.json',contentType:response.full.headers['content-type']??'application/json',bytes:bytes.length,sha256:hash(bytes),contentBase64:bytes.toString('base64'),exchange:metadataExchange(response.exchange)};
  resources.push(await retainDefinition(resource,callbacks));
 }
 return{resources,exchanges};
}
export async function captureFlowableDmnPortfolio(transport,input={}){
 const callbacks=captureOptions(input),startedAt=now(),collections={},exchanges=[],resources=[];
 for(const name of FLOWABLE_DMN_COLLECTIONS){const captured=await readCollection(transport,name,{},callbacks);collections[name]=captured;exchanges.push(...captured.exchanges);}
 const originals=await readDefinitionResources(transport,collections.definitions.items,callbacks);resources.push(...originals.resources);exchanges.push(...originals.exchanges);
 const audits=await readAuditResources(transport,collections.historicExecutions.items,callbacks);resources.push(...audits.resources);exchanges.push(...audits.exchanges);
 return{schema:'stellar-forge.flowable-dmn-native-portfolio.v1',connectionId:transport.connection.id,connectionSha256:transport.connectionSha256,startedAt,completedAt:now(),collections,resources,exchanges,atomicSnapshot:false,sourceCoverage:'ALL_NATIVE_DEFINITION_RESOURCE_REFERENCES',auditCoverage:'ALL_CAPTURED_NATIVE_EXECUTIONS'};
}
function responseFor(plan,response){
 if(!response)return null;
 if(!plain(response)||response.connectionId!==plan.connectionId||response.connectionSha256!==plan.connectionSha256||response.requestSha256!==plan.requestSha256||response.request?.method!==plan.method||response.request?.path!==plan.path||response.request?.bodySha256!==plan.bodySha256)throw fail('FLOWABLE_RESPONSE_CHANGED','The retained response does not belong to this exact original DMN request.');
 if(response.bodyBase64!==undefined){
  const bytes=Buffer.from(response.bodyBase64,'base64');if(bytes.toString('base64')!==response.bodyBase64||bytes.length!==response.bodyBytes||hash(bytes)!==response.bodySha256)throw fail('FLOWABLE_RESPONSE_CHANGED','Retained original DMN response bytes changed.');
  if(response.complete){let parsed=null;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}catch{}if(canonical(parsed)!==canonical(response.json??null))throw fail('FLOWABLE_RESPONSE_CHANGED','Retained response JSON differs from its exact original bytes.');}
 }
 return response;
}
function appendUnique(target,items){const seen=new Set(target.map(v=>v.id));for(const item of items)if(!seen.has(item.id)){target.push(item);seen.add(item.id);}}
export async function readFlowableDmnRequestState(transport,plan,input={}){
 validatePlan(transport.connection,plan);const callbacks=captureOptions(input),response=responseFor(plan,callbacks.response);
 const state={schema:'stellar-forge.flowable-dmn-native-state.v1',connectionId:transport.connection.id,connectionSha256:transport.connectionSha256,action:plan.action,observedAt:now(),definitions:[],deployments:[],historicExecutions:[],resources:[],exchanges:[]};
 const readIds=new Set(),readQueries=new Set();
 async function exact(name,id){
  if(!id)return null;nativeId(id,'Selected native ID');const key=name+':'+id;if(readIds.has(key))return state[name].find(v=>v.id===id)??null;readIds.add(key);
  const result=await readNative(transport,COLLECTION_PATHS[name].path+'/'+encodeURIComponent(id),{},callbacks,{allowMissing:true});state.exchanges.push(result.exchange);
  if(!result.found)return null;object(result.json,'Selected native '+name);if(result.json.id!==id)throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','Selected native resource returned a different original ID.',{exchange:result.exchange});
  appendUnique(state[name],[result.json]);return result.json;
 }
 async function collection(name,query){
  const key=name+':'+canonical(query);if(readQueries.has(key))return;readQueries.add(key);
  const result=await readCollection(transport,name,query,callbacks);appendUnique(state[name],result.items);state.exchanges.push(...result.exchanges);
 }
 const returnedId=plan.action==='deploy'&&response?.complete&&plain(response.json)&&typeof response.json.id==='string'?response.json.id:null;
 if(plan.action==='deploy'){
  await collection('deployments',{name:plan.readback.deploymentName,...(plan.readback.tenantId===null?{withoutTenantId:true}:{tenantId:plan.readback.tenantId})});
  if(returnedId)await exact('deployments',returnedId);
  for(const item of state.deployments)await collection('definitions',{deploymentId:item.id});
 }else{
  const scope={...(plan.readback.tenantId!==null?{tenantId:plan.readback.tenantId}:{}),...(plan.readback.parentDeploymentId?{parentDeploymentId:plan.readback.parentDeploymentId}:{})};
  await collection('definitions',{key:plan.readback.decisionKey,...scope});
  await collection('historicExecutions',{decisionKey:plan.readback.decisionKey,...(plan.readback.tenantId!==null?{tenantId:plan.readback.tenantId}:{})});
  // Audit records remain complete evidence. They never expand the selected source preflight
  // with unrelated historic definition editions or tenant scopes.
  state.historyDefinitionIds=[...new Set(state.historicExecutions.map(item=>item.decisionDefinitionId).filter(Boolean))];
 }
 for(const item of state.definitions)if(item.deploymentId)await exact('deployments',item.deploymentId);
 const extra=plan.action==='deploy'?state.deployments.filter(v=>v.id===returnedId||v.name===plan.source.filename).map(v=>({deploymentId:v.id,filename:plan.source.filename})):[];
 const originals=await readDefinitionResources(transport,state.definitions,callbacks,extra);state.resources.push(...originals.resources);state.exchanges.push(...originals.exchanges);
 const audits=await readAuditResources(transport,state.historicExecutions,callbacks);state.resources.push(...audits.resources);state.exchanges.push(...audits.exchanges);
 for(const name of FLOWABLE_DMN_COLLECTIONS)state[name].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 return state;
}
function stateFor(plan,state,label){
 if(!plain(state)||state.schema!=='stellar-forge.flowable-dmn-native-state.v1'||state.connectionId!==plan.connectionId||state.connectionSha256!==plan.connectionSha256||state.action!==plan.action)throw fail('FLOWABLE_STATE_CHANGED',label+' is not the selected original DMN state.');
 for(const name of [...FLOWABLE_DMN_COLLECTIONS,'resources','exchanges'])if(!Array.isArray(state[name]))throw fail('FLOWABLE_STATE_CHANGED',label+' lacks the complete native '+name+' array.');
 return state;
}
export function reconcileFlowableDmnRequest(plan,beforeInput,afterInput,responseInput){
 object(plan,'Saved DMN plan');
 const before=stateFor(plan,beforeInput,'Before'),after=stateFor(plan,afterInput,'After'),response=responseFor(plan,responseInput);
 const nativeAcknowledged=Boolean(response?.complete&&response.ok&&response.status===201);
 const evidence={nativeAcknowledged,requestSha256:plan.requestSha256,response:response?{id:response.id,status:response.status,complete:response.complete,bodySha256:response.bodySha256,bodyBytes:response.bodyBytes}:null};
 const finish=(state,summary,details={})=>({schema:'stellar-forge.flowable-dmn-native-reconciliation.v1',state,summary,evidence:{...evidence,...details}});
 if(response?.complete&&[400,401,403,404,409,415,422].includes(response.status))return finish('REJECTED','The original DMN engine rejected the selected request.',{nativeError:response.json??null});
 if(plan.action==='deploy'){
  const source=plan.source,existing=new Set(before.deployments.map(v=>v.id));
  const matching=after.deployments.filter(v=>after.resources.some(r=>r.kind===FLOWABLE_DMN_SOURCE_KIND&&r.deploymentId===v.id&&r.filename===source.filename&&r.sha256===source.sha256&&r.bytes===source.bytes));
  const returnedId=nativeAcknowledged&&plain(response.json)&&typeof response.json.id==='string'?response.json.id:null;
  const selected=returnedId?matching.filter(v=>v.id===returnedId):matching.filter(v=>!existing.has(v.id));
  if(selected.length===1){
   const deployment=selected[0],definitionIds=after.definitions.filter(v=>v.deploymentId===deployment.id).map(v=>v.id);
   return finish('CONFIRMED','The original native deployment contains the complete selected DMN source.',{confirmation:nativeAcknowledged?'NATIVE_RECEIPT_AND_SOURCE_MATCH':'CURRENT_NEW_NATIVE_SOURCE_MATCH',deploymentId:deployment.id,definitionIds,sourceSha256:source.sha256,requestAttribution:nativeAcknowledged?'ORIGINAL_RESPONSE':'CURRENT_STATE_ONLY'});
  }
  if(nativeAcknowledged)return finish('ACCEPTED','The engine returned the original deployment receipt; exact source readback remains unresolved.',{returnedDeploymentId:returnedId,matchingDeploymentIds:matching.map(v=>v.id)});
  return finish('UNKNOWN','No unique new native deployment with the complete selected source can resolve the original request.',{matchingDeploymentIds:selected.map(v=>v.id),replayAllowed:false});
 }
 if(plan.action!=='evaluate')throw fail('FLOWABLE_INPUT_INVALID','Unknown DMN reconciliation action.');
 const previous=new Set(before.historicExecutions.map(v=>v.id));
 const candidates=after.historicExecutions.filter(v=>!previous.has(v.id)&&v.decisionKey===plan.readback.decisionKey&&(plan.readback.tenantId===null||v.tenantId===plan.readback.tenantId));
 const observed={selectionSemantics:'NATIVE_KEY_TENANT_PARENT_DEPLOYMENT',historyAssociation:'CANDIDATES_NOT_REQUEST_IDS',historyCandidateIds:candidates.map(v=>v.id),historyCandidateDefinitionIds:[...new Set(candidates.map(v=>v.decisionDefinitionId).filter(Boolean))],disableHistory:plan.readback.disableHistory};
 if(nativeAcknowledged){
  if(!plain(response.json)||!Array.isArray(response.json.resultVariables))return finish('ACCEPTED','The engine acknowledged evaluation; its complete result does not match the pinned response shape.',observed);
  return finish('CONFIRMED','The original DMN evaluation response is retained with its complete typed results.',{...observed,confirmation:'ORIGINAL_NATIVE_EVALUATION_RESPONSE',result:response.json,resultBodySha256:response.bodySha256});
 }
 return finish('UNKNOWN','The original evaluation response is unavailable; observed native history alone does not establish the identity of this request.',{...observed,replayAllowed:false});
}
