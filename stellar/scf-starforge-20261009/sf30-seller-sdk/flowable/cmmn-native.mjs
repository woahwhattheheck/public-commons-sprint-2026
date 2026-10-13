// MIT. Original Flowable 8 adaptive-case REST requests and complete native readback.
// The original engine owns case criteria, plan-item transitions and human tasks.
// Credential references, HTTP ownership and raw exchange retention use native.mjs.
import {createHash} from 'node:crypto';
import {normalizeFlowableConnection,flowableConnectionSha256,createFlowableTransport,executeFlowableRequest,FLOWABLE_NATIVE_VERSION,FLOWABLE_NATIVE_COMMIT} from './native.mjs';

export const FLOWABLE_CMMN_NATIVE_SCHEMA='stellar-forge.flowable-cmmn-native-request.v1';
export const FLOWABLE_CMMN_COLLECTIONS=Object.freeze(['deployments','definitions','cases','planItems','tasks','variables','historicCases','historicPlanItems','historicTasks','historicVariables','milestones']);
export const FLOWABLE_CMMN_ACTION_GROUPS=Object.freeze({
 caseRelease:Object.freeze(['deploy']),
 caseInstance:Object.freeze(['startCase','updateCase','evaluateCaseCriteria','terminateCase']),
 casePlanItem:Object.freeze(['startPlanItem','triggerPlanItem','enablePlanItem','disablePlanItem']),
 caseTask:Object.freeze(['claim','unclaim','complete','delegate','resolve'])
});
export const FLOWABLE_CMMN_SOURCE_KIND='cmmn-definition-resource';
export const FLOWABLE_CMMN_VARIABLE_KIND='cmmn-variable-data';
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

const PLAN_ITEM_ACTIONS=Object.freeze({startPlanItem:'start',triggerPlanItem:'trigger',enablePlanItem:'enable',disablePlanItem:'disable'});
const TASK_ACTIONS=FLOWABLE_CMMN_ACTION_GROUPS.caseTask;
const isCaseResource=name=>/(\.cmmn\.xml|\.cmmn)$/.test(name);
const isArchive=name=>/\.(bar|zip)$/i.test(name);
function multipart(source,query,original){
 const boundary='FlowableCmmnNative'+objectHash({source,query}).slice(0,48);
 const prefix=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+source.filename+'"\r\nContent-Type: '+source.contentType+'\r\n\r\n','utf8');
 const suffix=Buffer.from('\r\n--'+boundary+'--\r\n','utf8');
 if(original.includes(Buffer.from('\r\n--'+boundary)))throw fail('FLOWABLE_INPUT_INVALID','Selected source collides with the exact original multipart boundary.');
 return{contentType:'multipart/form-data; boundary='+boundary,bytes:Buffer.concat([prefix,original,suffix]),prefix,suffix};
}
function finishPlan(connection,fields){
 const plan={schema:FLOWABLE_CMMN_NATIVE_SCHEMA,engineVersion:FLOWABLE_NATIVE_VERSION,connectionId:connection.id,connectionSha256:flowableConnectionSha256(connection),...fields};
 plan.requestSha256=objectHash(requestCore(plan));return plan;
}
function variableList(body,key){
 if(body[key]===undefined||body[key]===null)return;
 if(!Array.isArray(body[key]))throw fail('FLOWABLE_INPUT_INVALID',key+' must be the original native variable array.');
 const names=new Set();
 for(const entry of body[key]){
  keys(entry,['name','type','value','valueUrl','scope'],'Native variable');
  text(entry.name,'Variable name',8192);if(names.has(entry.name))throw fail('FLOWABLE_INPUT_INVALID',key+' repeats a native variable name.');names.add(entry.name);
  for(const field of ['type','scope'])if(entry[field]!==undefined&&entry[field]!==null)text(entry[field],'Variable '+field,256);
  if(entry.valueUrl!==undefined&&entry.valueUrl!==null)text(entry.valueUrl,'Variable valueUrl',16384);
 }
}
function optionalCase(input){
 return own(input,'caseInstanceId')?{caseInstanceId:nativeId(input.caseInstanceId,'caseInstanceId')}:{};
}
export function planFlowableCmmnRequest(connectionInput,input){
 const connection=normalizeFlowableConnection(connectionInput);object(input,'CMMN selection');
 const action=input.action;let method='POST',path,query={},bytes=Buffer.alloc(0),contentType='application/json',readback={},source;
 if(action==='deploy'){
  keys(input,['action','deploymentName','deploymentKey','tenantId','resource'],'CMMN deployment selection');
  keys(input.resource,['filename','contentType','contentBase64'],'CMMN deployment resource');
  const filename=nativeId(input.resource.filename,'CMMN filename');
  if(!isCaseResource(filename)&&!isArchive(filename))throw fail('FLOWABLE_INPUT_INVALID','The original CMMN upload accepts one .cmmn, .cmmn.xml, .bar or .zip file.');
  if(/["\\\r\n]/u.test(filename))throw fail('FLOWABLE_INPUT_INVALID','Multipart filename contains a header separator.');
  const original=exactBase64(input.resource.contentBase64,'Original CMMN source'),fileType=input.resource.contentType??(isArchive(filename)?'application/zip':'application/xml');
  text(fileType,'CMMN content type',256);if(/[\r\n]/u.test(fileType))throw fail('FLOWABLE_INPUT_INVALID','Content type contains a header separator.');
  for(const key of ['deploymentName','deploymentKey','tenantId'])if(own(input,key))query[key]=text(input[key],key,2048,true);
  source={filename,contentType:fileType,bytes:original.length,sha256:hash(original)};
  const body=multipart(source,query,original);bytes=body.bytes;contentType=body.contentType;
  path='/cmmn-repository/deployments';
  readback={deploymentName:input.deploymentName||filename.split('.')[0]||filename,tenantId:own(input,'tenantId')?input.tenantId:null,...(own(input,'deploymentKey')?{deploymentKey:input.deploymentKey}:{}),source};
 }else if(action==='terminateCase'){
  keys(input,['action','caseInstanceId'],'Case termination selection');
  const id=nativeId(input.caseInstanceId,'caseInstanceId');
  method='DELETE';path='/cmmn-runtime/case-instances/'+encodeURIComponent(id);contentType=null;readback={caseInstanceId:id};
 }else{
  const body=bodyObject(input.bodyText);bytes=Buffer.from(input.bodyText,'utf8');
  if(action==='startCase'){
   keys(input,['action','bodyText'],'Case start selection');
   keys(body,['caseDefinitionId','caseDefinitionKey','name','businessKey','variables','transientVariables','startFormVariables','outcome','tenantId','overrideDefinitionTenantId','returnVariables'],'Native case start');
   const selectors=['caseDefinitionId','caseDefinitionKey'].filter(key=>body[key]!==null&&body[key]!==undefined);
   if(selectors.length!==1)throw fail('FLOWABLE_INPUT_INVALID','Original case start requires exactly one caseDefinitionId or caseDefinitionKey.');
   nativeId(body[selectors[0]],selectors[0]);
   if(selectors[0]==='caseDefinitionId'&&body.tenantId!==undefined&&body.tenantId!==null&&body.tenantId!=='')throw fail('FLOWABLE_INPUT_INVALID','Native tenantId can accompany a caseDefinitionKey, not a caseDefinitionId.');
   for(const name of ['name','businessKey','outcome','tenantId','overrideDefinitionTenantId'])if(body[name]!==undefined&&body[name]!==null)text(body[name],name,8192,true);
   if(body.returnVariables!==undefined&&typeof body.returnVariables!=='boolean')throw fail('FLOWABLE_INPUT_INVALID','returnVariables must be the original boolean setting.');
   for(const name of ['variables','transientVariables','startFormVariables'])variableList(body,name);
   path='/cmmn-runtime/case-instances';
   readback={selector:selectors[0],selectorValue:body[selectors[0]],businessKey:body.businessKey??null,tenantId:body.tenantId??null,overrideDefinitionTenantId:body.overrideDefinitionTenantId??null,name:body.name??null};
  }else if(action==='updateCase'||action==='evaluateCaseCriteria'){
   keys(input,['action','caseInstanceId','bodyText'],'Case action selection');
   const id=nativeId(input.caseInstanceId,'caseInstanceId');
   keys(body,['action','name','businessKey'],'Native case update');
   if(action==='evaluateCaseCriteria'){
    if(body.action!=='evaluateCriteria')throw fail('FLOWABLE_INPUT_INVALID','bodyText.action must be evaluateCriteria for the selected original action.');
    if(own(body,'name')||own(body,'businessKey'))throw fail('FLOWABLE_INPUT_INVALID','The original action branch does not update name or businessKey; prepare a separate explicit updateCase.');
   }else{
    if(body.action!==undefined&&body.action!==null&&body.action!=='')throw fail('FLOWABLE_INPUT_INVALID','updateCase requires an absent or empty native action.');
    for(const key of ['name','businessKey'])if(body[key]!==undefined&&body[key]!==null)text(body[key],key,8192,true);
   }
   method='PUT';path='/cmmn-runtime/case-instances/'+encodeURIComponent(id);
   readback={caseInstanceId:id,...(action==='updateCase'?{updates:Object.fromEntries(['name','businessKey'].filter(key=>typeof body[key]==='string'&&body[key].length).map(key=>[key,body[key]]))}:{})};
  }else if(own(PLAN_ITEM_ACTIONS,action)){
   keys(input,['action','planItemInstanceId','caseInstanceId','bodyText'],'Plan-item action selection');
   keys(body,['action'],'Native plan-item action');
   if(body.action!==PLAN_ITEM_ACTIONS[action])throw fail('FLOWABLE_INPUT_INVALID','bodyText.action must match the selected original plan-item action.');
   const id=nativeId(input.planItemInstanceId,'planItemInstanceId');
   method='PUT';path='/cmmn-runtime/plan-item-instances/'+encodeURIComponent(id);
   readback={planItemInstanceId:id,...optionalCase(input),nativeAction:body.action};
  }else if(TASK_ACTIONS.includes(action)){
   keys(input,['action','taskId','caseInstanceId','bodyText'],'Case task selection');
   keys(body,['action','assignee','formDefinitionId','outcome','variables','transientVariables'],'Native task action');
   const nativeAction=action==='unclaim'?'claim':action;
   if(body.action!==nativeAction)throw fail('FLOWABLE_INPUT_INVALID','bodyText.action must match the selected original task action.');
   if(action==='unclaim'&&body.assignee!==null)throw fail('FLOWABLE_INPUT_INVALID','Native unclaim requires the explicit original claim action with assignee:null.');
   if(action==='claim'&&body.assignee!==undefined&&body.assignee!==null)text(body.assignee,'assignee',2048);
   if(action==='delegate')text(body.assignee,'assignee',2048);
   for(const key of ['formDefinitionId','outcome'])if(body[key]!==undefined&&body[key]!==null)text(body[key],key,8192,true);
   for(const key of ['variables','transientVariables'])variableList(body,key);
   const id=nativeId(input.taskId,'taskId');
   path='/cmmn-runtime/tasks/'+encodeURIComponent(id);
   readback={taskId:id,...optionalCase(input),nativeAction,assignee:body.assignee??null};
  }else throw fail('FLOWABLE_INPUT_INVALID','Unsupported original CMMN action.');
 }
 return finishPlan(connection,{action,mutation:true,method,path,query,contentType,bodyBytes:bytes.length,bodySha256:hash(bytes),bodyBase64:bytes.toString('base64'),readback,...(source?{source}:{})});
}
function validatePlan(connectionInput,plan){
 const connection=normalizeFlowableConnection(connectionInput);object(plan,'Saved CMMN plan');
 if(plan.schema!==FLOWABLE_CMMN_NATIVE_SCHEMA||plan.engineVersion!==FLOWABLE_NATIVE_VERSION||plan.connectionId!==connection.id||plan.connectionSha256!==flowableConnectionSha256(connection))throw fail('FLOWABLE_PLAN_CHANGED','The saved CMMN plan belongs to a different declared native connection.');
 const bytes=plan.bodyBase64===''?Buffer.alloc(0):exactBase64(plan.bodyBase64,'Saved CMMN request',260*1024*1024);
 if(bytes.length!==plan.bodyBytes||hash(bytes)!==plan.bodySha256||objectHash(requestCore(plan))!==plan.requestSha256)throw fail('FLOWABLE_PLAN_CHANGED','The complete saved CMMN request bytes changed.');
 let selection;
 if(plan.action==='deploy'){
  object(plan.source,'Original CMMN source identity');
  const wrapper=multipart(plan.source,plan.query??{},Buffer.alloc(0)),end=wrapper.prefix.length+plan.source.bytes;
  if(!Number.isSafeInteger(plan.source.bytes)||plan.source.bytes<1||end+wrapper.suffix.length!==bytes.length||!bytes.subarray(0,wrapper.prefix.length).equals(wrapper.prefix)||!bytes.subarray(end).equals(wrapper.suffix))throw fail('FLOWABLE_PLAN_CHANGED','The original multipart source boundary changed.');
  const original=bytes.subarray(wrapper.prefix.length,end);
  if(hash(original)!==plan.source.sha256)throw fail('FLOWABLE_PLAN_CHANGED','Original CMMN source bytes changed.');
  selection={action:'deploy',resource:{filename:plan.source.filename,contentType:plan.source.contentType,contentBase64:original.toString('base64')},...Object.fromEntries(['deploymentName','deploymentKey','tenantId'].filter(key=>own(plan.query??{},key)).map(key=>[key,plan.query[key]]))};
 }else if(plan.action==='terminateCase')selection={action:plan.action,caseInstanceId:plan.readback?.caseInstanceId};
 else{
  selection={action:plan.action,bodyText:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)};
  for(const key of ['taskId','planItemInstanceId','caseInstanceId'])if(own(plan.readback??{},key))selection[key]=plan.readback[key];
 }
 if(canonical(planFlowableCmmnRequest(connection,selection))!==canonical(plan))throw fail('FLOWABLE_PLAN_CHANGED','The saved CMMN method, native selection or complete readback identity changed.');
 return plan;
}
export function createFlowableCmmnTransport(connectionInput,options={}){
 const native=createFlowableTransport(connectionInput,options);
 return Object.freeze({...native,execute:(plan,options={})=>native.request(validatePlan(native.connection,plan),options.signal)});
}
export async function executeFlowableCmmnRequest(transport,plan,callbacks={}){
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
 if(!full.ok&&!(allowMissing&&full.status===404))throw fail('FLOWABLE_NATIVE_READ_REJECTED','The original CMMN read returned HTTP '+full.status+'.',{status:full.status,exchange});
 return{full,exchange,json:full.json,found:full.ok};
}

const COLLECTION_PATHS=Object.freeze({
 deployments:{path:'/cmmn-repository/deployments',sort:'id'},
 definitions:{path:'/cmmn-repository/case-definitions',sort:'id'},
 cases:{path:'/cmmn-runtime/case-instances',sort:'id'},
 planItems:{path:'/cmmn-runtime/plan-item-instances',sort:'createTime'},
 tasks:{path:'/cmmn-runtime/tasks',sort:'id'},
 variables:{path:'/cmmn-runtime/variable-instances',sort:'variableName'},
 historicCases:{path:'/cmmn-history/historic-case-instances',sort:'caseInstanceId'},
 historicPlanItems:{path:'/cmmn-history/historic-planitem-instances',sort:'createTime'},
 historicTasks:{path:'/cmmn-history/historic-task-instances',sort:'taskInstanceId'},
 historicVariables:{path:'/cmmn-history/historic-variable-instances',sort:'variableName'},
 milestones:{path:'/cmmn-history/historic-milestone-instances',sort:'timestamp'}
});
function uniqueRecords(items,label){
 const seen=new Set();
 for(const item of items){object(item,label+' record');if(typeof item.id!=='string'||!item.id||seen.has(item.id))throw fail('FLOWABLE_INVENTORY_CHANGED','The original '+label+' pages omit or repeat a native ID.');seen.add(item.id);}
}
async function readCollection(transport,name,query,callbacks){
 const declaration=COLLECTION_PATHS[name];if(!declaration)throw fail('FLOWABLE_INPUT_INVALID','Unknown original CMMN collection.');
 const pageSize=callbacks.pageSize??100;if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>10000)throw fail('FLOWABLE_INPUT_INVALID','Native pageSize must be from 1 to 10000.');
 const items=[],pages=[],exchanges=[],variableEvidence=[];let start=0,total=null;
 for(;;){
  const selected={...query,sort:declaration.sort,order:'asc',start,size:pageSize};
  const response=await readNative(transport,declaration.path,selected,callbacks),page=response.json;
  if(!plain(page)||!Array.isArray(page.data)||!Number.isSafeInteger(page.start)||!Number.isSafeInteger(page.size)||!Number.isSafeInteger(page.total)||page.start!==start||page.total<0||page.size!==page.data.length||page.data.length>pageSize)throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The original '+name+' page does not match its complete DataResponse.',{exchange:response.exchange});
  if(total===null)total=page.total;
  else if(total!==page.total)throw fail('FLOWABLE_INVENTORY_CHANGED','The original '+name+' changed its total during capture.',{capturedItems:items.length,previousTotal:total,currentTotal:page.total,exchange:response.exchange});
  items.push(...page.data);
  if(name==='variables'||name==='historicVariables'){
   try{variableEvidence.push(...losslessJson(response.full.bodyText).data);}
   catch{throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The complete native variable page is not valid lossless JSON.',{exchange:response.exchange});}
  }
  exchanges.push(response.exchange);pages.push({start:page.start,size:page.size,total:page.total,sort:page.sort??null,order:page.order??null,...metadataExchange(response.exchange)});
  start+=page.data.length;
  if(start>total)throw fail('FLOWABLE_INVENTORY_CHANGED','Native pages exceed the reported total.');
  if(start===total)break;
  if(!page.data.length)throw fail('FLOWABLE_INVENTORY_INCOMPLETE','The original '+name+' stopped before its reported total.',{capturedItems:items.length,total});
 }
 uniqueRecords(items,name);
 return{items,pages,total,complete:true,atomicSnapshot:false,exchanges,...(['variables','historicVariables'].includes(name)?{variableEvidence}:{})};
}
function nativeCaseId(item){
 if(!plain(item))return null;
 if(item.scopeType!==undefined&&item.scopeType!==null&&item.scopeType!=='cmmn')return null;
 if(typeof item.caseInstanceId==='string'&&item.caseInstanceId.length)return item.caseInstanceId;
 return item.scopeType==='cmmn'&&typeof item.scopeId==='string'&&item.scopeId.length?item.scopeId:null;
}
function nativeDefinitionId(item){
 if(!plain(item)||item.scopeType!==undefined&&item.scopeType!==null&&item.scopeType!=='cmmn')return null;
 if(typeof item.caseDefinitionId==='string'&&item.caseDefinitionId.length)return item.caseDefinitionId;
 return item.scopeType==='cmmn'&&typeof item.scopeDefinitionId==='string'?item.scopeDefinitionId:null;
}
async function readDeploymentResources(transport,deployment,definitions,callbacks){
 const deploymentId=nativeId(deployment.id,'deploymentId');
 const listing=await readNative(transport,'/cmmn-repository/deployments/'+encodeURIComponent(deploymentId)+'/resources',{},callbacks);
 if(!Array.isArray(listing.json))throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The original CMMN resources endpoint must return its complete array.',{exchange:listing.exchange});
 const resources=[],exchanges=[listing.exchange],seen=new Set();
 for(const item of listing.json){
  object(item,'Original deployment resource');const filename=item.id??item.name;
  text(filename,'Original resource name',16384);if(seen.has(filename))throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The original deployment repeats a resource name.');seen.add(filename);
  text(item.dataUrl,'Original resource dataUrl',16384);
  const response=await readNative(transport,item.dataUrl,{},callbacks),bytes=Buffer.from(response.full.bodyBase64,'base64');
  exchanges.push(response.exchange);
  const links=new Set([filename,item.url].filter(v=>typeof v==='string'));
  const related=definitions.filter(v=>v.deploymentId===deploymentId&&(links.has(v.resource)||links.has(v.diagramResource)));
  const resource={schema:'stellar-forge.flowable-source-resource.v1',kind:FLOWABLE_CMMN_SOURCE_KIND,deploymentId,definitionIds:related.map(v=>v.id),...(related.length===1?{definitionId:related[0].id}:{}),filename,contentType:response.full.headers['content-type']??item.mediaType??item.contentType??'application/octet-stream',bytes:bytes.length,sha256:hash(bytes),contentBase64:bytes.toString('base64'),native:item,exchange:metadataExchange(response.exchange)};
  resources.push(await retainDefinition(resource,callbacks));
 }
 return{resources,exchanges};
}
async function readVariableResources(transport,variables,historicVariables,callbacks){
 const resources=[],exchanges=[];
 for(const [history,items]of [[false,variables],[true,historicVariables]]){
  for(const item of items){
   object(item,'Native variable instance');const variable=item.variable;
   if(!plain(variable)||typeof variable.valueUrl!=='string'||!variable.valueUrl)continue;
   const variableInstanceId=nativeId(item.id,'variableInstanceId');
   // Follow the exact original URL under the already declared REST origin and base.
   const response=await readNative(transport,variable.valueUrl,{},callbacks),bytes=Buffer.from(response.full.bodyBase64,'base64');
   exchanges.push(response.exchange);
   const caseInstanceId=nativeCaseId(item);
   const resource={schema:'stellar-forge.flowable-source-resource.v1',kind:FLOWABLE_CMMN_VARIABLE_KIND,variableInstanceId,history,...(caseInstanceId?{caseInstanceId}:{}),...(typeof item.taskId==='string'?{taskId:item.taskId}:{}),...(typeof item.planItemInstanceId==='string'?{planItemInstanceId:item.planItemInstanceId}:{}),variableName:variable.name??null,variableType:variable.type??null,filename:(history?'historic-variable-':'variable-')+variableInstanceId+'.bin',contentType:response.full.headers['content-type']??'application/octet-stream',bytes:bytes.length,sha256:hash(bytes),contentBase64:bytes.toString('base64'),native:item,exchange:metadataExchange(response.exchange)};
   resources.push(await retainDefinition(resource,callbacks));
  }
 }
 return{resources,exchanges};
}
export async function captureFlowableCmmnPortfolio(transport,input={}){
 const callbacks=captureOptions(input),startedAt=now(),collections={},resources=[],exchanges=[];
 for(const name of FLOWABLE_CMMN_COLLECTIONS){const found=await readCollection(transport,name,{},callbacks);collections[name]=found;exchanges.push(...found.exchanges);}
 for(const deployment of collections.deployments.items){
  const found=await readDeploymentResources(transport,deployment,collections.definitions.items,callbacks);
  resources.push(...found.resources);exchanges.push(...found.exchanges);
 }
 const variables=await readVariableResources(transport,collections.variables.items,collections.historicVariables.items,callbacks);
 resources.push(...variables.resources);exchanges.push(...variables.exchanges);
 return{schema:'stellar-forge.flowable-cmmn-native-portfolio.v1',connectionId:transport.connection.id,connectionSha256:transport.connectionSha256,startedAt,completedAt:now(),collections,resources,exchanges,atomicSnapshot:false,sourceCoverage:'ALL_NATIVE_DEPLOYMENT_RESOURCES',variableCoverage:'ALL_CAPTURED_NATIVE_VALUE_URLS',taskScope:'ORIGINAL_SHARED_NATIVE_ENDPOINT_ROWS'};
}
function responseFor(plan,response){
 if(!response)return null;
 if(!plain(response)||response.connectionId!==plan.connectionId||response.connectionSha256!==plan.connectionSha256||response.requestSha256!==plan.requestSha256||response.request?.method!==plan.method||response.request?.path!==plan.path||response.request?.bodySha256!==plan.bodySha256||response.request?.bodyBytes!==plan.bodyBytes||canonical(response.request?.query??{})!==canonical(plan.query??{}))throw fail('FLOWABLE_RESPONSE_CHANGED','The retained response does not belong to this exact original CMMN request.');
 if(response.bodyBase64!==undefined){
  const bytes=Buffer.from(response.bodyBase64,'base64');
  if(bytes.toString('base64')!==response.bodyBase64||bytes.length!==response.bodyBytes||hash(bytes)!==response.bodySha256)throw fail('FLOWABLE_RESPONSE_CHANGED','The complete original CMMN response bytes changed.');
  if(response.complete){
   let parsed=null;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}catch{}
   if(canonical(parsed)!==canonical(response.json??null))throw fail('FLOWABLE_RESPONSE_CHANGED','Response metadata differs from its complete original JSON bytes.');
  }
 }
 return response;
}
function appendUnique(target,items){
 const seen=new Set(target.map(v=>v.id));for(const item of items)if(!seen.has(item.id)){target.push(item);seen.add(item.id);}
}
export async function readFlowableCmmnRequestState(transport,plan,input={}){
 validatePlan(transport.connection,plan);
 const callbacks=captureOptions(input),response=responseFor(plan,callbacks.response);
 const state={schema:'stellar-forge.flowable-cmmn-native-state.v1',connectionId:transport.connection.id,connectionSha256:transport.connectionSha256,action:plan.action,observedAt:now(),...Object.fromEntries(FLOWABLE_CMMN_COLLECTIONS.map(name=>[name,[]])),variableEvidence:[],resources:[],exchanges:[]};
 const readIds=new Set(),readQueries=new Set(),caseIds=new Set();
 async function exact(name,id){
  if(!id)return null;nativeId(id,'Selected native ID');
  const key=name+':'+id;if(readIds.has(key))return state[name].find(v=>v.id===id)??null;readIds.add(key);
  const result=await readNative(transport,COLLECTION_PATHS[name].path+'/'+encodeURIComponent(id),{},callbacks,{allowMissing:true});
  state.exchanges.push(result.exchange);
  if(!result.found)return null;
  object(result.json,'Selected native '+name);if(result.json.id!==id)throw fail('FLOWABLE_NATIVE_SHAPE_CHANGED','The selected native resource returned a different ID.',{exchange:result.exchange});
  appendUnique(state[name],[result.json]);return result.json;
 }
 async function collection(name,query){
  const key=name+':'+canonical(query);if(readQueries.has(key))return;readQueries.add(key);
  const result=await readCollection(transport,name,query,callbacks);
  appendUnique(state[name],result.items);
  if(result.variableEvidence)appendUnique(state.variableEvidence,result.variableEvidence);
  state.exchanges.push(...result.exchanges);
 }
 async function caseState(id){
  if(!id)return;nativeId(id,'caseInstanceId');if(caseIds.has(id))return;caseIds.add(id);
  await exact('cases',id);await exact('historicCases',id);
  for(const name of ['planItems','tasks','variables','historicPlanItems','historicTasks','historicVariables','milestones'])await collection(name,{caseInstanceId:id});
 }
 function checkedOwner(item,label){
  if(!item)return null;
  const id=nativeCaseId(item);
  if(!id)throw fail('FLOWABLE_CASE_SCOPE_CHANGED','The selected '+label+' has no original CMMN case owner.');
  if(plan.readback.caseInstanceId!==undefined&&id!==plan.readback.caseInstanceId)throw fail('FLOWABLE_CASE_SCOPE_CHANGED','The selected '+label+' belongs to another original case instance.',{expectedCaseInstanceId:plan.readback.caseInstanceId,actualCaseInstanceId:id});
  return id;
 }
 const returnedId=response?.complete&&response.ok&&plain(response.json)&&typeof response.json.id==='string'?response.json.id:null;
 if(plan.action==='deploy'){
  await collection('deployments',{name:plan.readback.deploymentName,...(plan.readback.tenantId===null?{withoutTenantId:true}:{tenantId:plan.readback.tenantId})});
  if(returnedId)await exact('deployments',returnedId);
  if(plan.readback.deploymentKey!==undefined)state.deployments=state.deployments.filter(v=>v.id===returnedId||v.key===plan.readback.deploymentKey);
  for(const item of state.deployments)await collection('definitions',{deploymentId:item.id});
 }else if(plan.action==='startCase'){
  const query={[plan.readback.selector]:plan.readback.selectorValue,...(plan.readback.businessKey!==null?{businessKey:plan.readback.businessKey}:{})};
  if(plan.readback.overrideDefinitionTenantId!==null)query.tenantId=plan.readback.overrideDefinitionTenantId;
  else if(plan.readback.tenantId!==null&&plan.readback.tenantId!=='')query.tenantId=plan.readback.tenantId;
  else if(plan.readback.selector==='caseDefinitionKey')query.withoutTenantId=true;
  await collection('cases',query);await collection('historicCases',query);
  if(returnedId)await caseState(returnedId);
  for(const id of new Set([...state.cases,...state.historicCases].map(v=>v.id)))await caseState(id);
  if(plan.readback.selector==='caseDefinitionId')await exact('definitions',plan.readback.selectorValue);
  else await collection('definitions',{key:plan.readback.selectorValue,...(plan.readback.tenantId!==null&&plan.readback.tenantId!==''?{tenantId:plan.readback.tenantId}:{withoutTenantId:true})});
 }else if(own(PLAN_ITEM_ACTIONS,plan.action)){
  const current=await exact('planItems',plan.readback.planItemInstanceId),historic=await exact('historicPlanItems',plan.readback.planItemInstanceId);
  for(const id of new Set([checkedOwner(current,'plan item'),checkedOwner(historic,'historic plan item'),plan.readback.caseInstanceId].filter(Boolean)))await caseState(id);
 }else if(TASK_ACTIONS.includes(plan.action)){
  const current=await exact('tasks',plan.readback.taskId),historic=await exact('historicTasks',plan.readback.taskId);
  for(const id of new Set([checkedOwner(current,'task'),checkedOwner(historic,'historic task'),plan.readback.caseInstanceId].filter(Boolean)))await caseState(id);
 }else await caseState(plan.readback.caseInstanceId);
 for(const item of [...state.cases,...state.historicCases,...state.planItems,...state.historicPlanItems,...state.tasks,...state.historicTasks]){
  const id=nativeDefinitionId(item);if(id)await exact('definitions',id);
 }
 for(const item of state.definitions)if(item.deploymentId)await exact('deployments',item.deploymentId);
 for(const deployment of state.deployments){
  const found=await readDeploymentResources(transport,deployment,state.definitions,callbacks);
  state.resources.push(...found.resources);state.exchanges.push(...found.exchanges);
 }
 const variables=await readVariableResources(transport,state.variables,state.historicVariables,callbacks);
 state.resources.push(...variables.resources);state.exchanges.push(...variables.exchanges);
 for(const name of [...FLOWABLE_CMMN_COLLECTIONS,'variableEvidence'])state[name].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 state.caseInstanceIds=[...caseIds].sort();
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

function stateFor(plan,state,label){
 if(!plain(state)||state.schema!=='stellar-forge.flowable-cmmn-native-state.v1'||state.connectionId!==plan.connectionId||state.connectionSha256!==plan.connectionSha256||state.action!==plan.action)throw fail('FLOWABLE_STATE_CHANGED',label+' is not this original selected CMMN state.');
 for(const name of [...FLOWABLE_CMMN_COLLECTIONS,'resources','exchanges'])if(!Array.isArray(state[name]))throw fail('FLOWABLE_STATE_CHANGED',label+' lacks the complete native '+name+' array.');
 return state;
}
function unionIds(...lists){return[...new Set(lists.flat().map(v=>v?.id).filter(v=>typeof v==='string'))].sort();}
function fullStateValues(state){
 const result=[];
 for(const exchange of state.exchanges){
  if(exchange.complete&&exchange.ok&&typeof exchange.bodyText==='string'){
   try{const value=losslessJson(exchange.bodyText);if(Array.isArray(value?.data))result.push(...value.data);else if(Array.isArray(value))result.push(...value);else if(plain(value))result.push(value);}catch{}
  }
 }
 return result;
}
function variablesCorrespond(plan,state,caseInstanceId){
 let body;try{body=losslessJson(Buffer.from(plan.bodyBase64,'base64').toString('utf8'));}catch{return false;}
 if(body.transientVariables?.length||body.startFormVariables?.length)return false;
 if(!Array.isArray(body.variables)||!body.variables.length)return true;
 const exact=[...(state.variableEvidence??[]),...fullStateValues(state)].filter(v=>nativeCaseId(v)===caseInstanceId);
 return body.variables.every(variable=>{
  // No custom native type conversion. Preserve exact typed primitive meaning.
  if(!['boolean','string','integer','short','long','double','date','bigDecimal','bigInteger'].includes(variable.type))return false;
  return exact.some(record=>{
   const found=record.variable??record;
   return found.name===variable.name&&found.type===variable.type&&(found.scope??'global')===(variable.scope??'global')&&canonical(found.value??null)===canonical(variable.value??null);
  });
 });
}
function caseMatches(plan,state,item){
 if(!item)return false;
 if(plan.readback.businessKey!==null&&item.businessKey!==plan.readback.businessKey)return false;
 const definition=state.definitions.find(v=>v.id===item.caseDefinitionId);
 if(plan.readback.selector==='caseDefinitionId'&&item.caseDefinitionId!==plan.readback.selectorValue)return false;
 if(plan.readback.selector==='caseDefinitionKey'&&definition?.key!==plan.readback.selectorValue)return false;
 const tenant=plan.readback.overrideDefinitionTenantId!==null?plan.readback.overrideDefinitionTenantId:plan.readback.tenantId;
 if(tenant!==null&&tenant!==''&&item.tenantId!==tenant)return false;
 return true;
}
function changedTime(prior,current,key){return typeof current?.[key]==='string'&&current[key]!==prior?.[key];}
export function reconcileFlowableCmmnRequest(plan,beforeInput,afterInput,responseInput){
 object(plan,'Saved CMMN plan');
 const before=stateFor(plan,beforeInput,'Before'),after=stateFor(plan,afterInput,'After'),response=responseFor(plan,responseInput);
 const acknowledged=Boolean(response?.complete&&response.ok);
 const beforeCaseIds=unionIds(before.cases,before.historicCases),afterCaseIds=unionIds(after.cases,after.historicCases);
 const evidence={requestSha256:plan.requestSha256,nativeAcknowledged:acknowledged,nativeStatus:response?.status??null,responseBodySha256:response?.bodySha256??null,responseBodyBytes:response?.bodyBytes??null,beforeCaseIds,afterCaseIds,replayAllowed:false};
 const finish=(state,summary,details={})=>({schema:'stellar-forge.flowable-cmmn-native-reconciliation.v1',state,summary,evidence:{...evidence,...details}});
 const pending=(summary,details={})=>finish(acknowledged?'ACCEPTED':'UNKNOWN',summary,details);
 if(response?.complete&&!response.ok&&response.status>=400&&response.status<500)return finish('REJECTED','The original CMMN engine rejected the selected request; its complete response is retained.',{nativeError:response.json??null});
 if(plan.action==='deploy'){
  const previous=new Set(before.deployments.map(v=>v.id)),returnedId=acknowledged&&typeof response.json?.id==='string'?response.json.id:null;
  const candidates=after.deployments.filter(v=>returnedId?v.id===returnedId:!previous.has(v.id));
  const exactSource=candidates.filter(v=>after.resources.some(r=>r.kind===FLOWABLE_CMMN_SOURCE_KIND&&r.deploymentId===v.id&&r.filename===plan.source.filename&&r.bytes===plan.source.bytes&&r.sha256===plan.source.sha256));
  const archiveReceipt=returnedId&&isArchive(plan.source.filename)&&candidates.length===1&&after.resources.some(r=>r.kind===FLOWABLE_CMMN_SOURCE_KIND&&r.deploymentId===returnedId);
  if(returnedId&&(exactSource.length===1||archiveReceipt)){
   return finish('CONFIRMED','The exact returned native deployment and all of its original resource readback are retained.',{deploymentIds:[returnedId],definitionIds:after.definitions.filter(v=>v.deploymentId===returnedId).map(v=>v.id),sourceSha256:plan.source.sha256,exactSingleSource:exactSource.length===1,archiveUnpackedByNativeEngine:Boolean(archiveReceipt),confirmation:'ORIGINAL_NATIVE_DEPLOYMENT_RECEIPT_AND_READBACK',requestAttribution:'ORIGINAL_RESPONSE'});
  }
  if(!acknowledged&&!isArchive(plan.source.filename)&&exactSource.length===1){
   return finish('CONFIRMED','One new native deployment contains the complete exact selected CMMN source.',{deploymentIds:[exactSource[0].id],definitionIds:after.definitions.filter(v=>v.deploymentId===exactSource[0].id).map(v=>v.id),sourceSha256:plan.source.sha256,confirmation:'CURRENT_NEW_NATIVE_SOURCE_MATCH',requestAttribution:'CURRENT_STATE_ONLY'});
  }
  return pending(acknowledged?'The original deployment receipt is retained; complete matching source readback is pending.':'No unique new native deployment resolves the original request without another write.',{candidateDeploymentIds:candidates.map(v=>v.id),exactSourceDeploymentIds:exactSource.map(v=>v.id)});
 }
 if(plan.action==='startCase'){
  const previous=new Set(beforeCaseIds),records=new Map([...after.historicCases,...after.cases].map(v=>[v.id,v]));
  const matching=[...records.values()].filter(v=>caseMatches(plan,after,v)),returnedId=acknowledged&&typeof response.json?.id==='string'?response.json.id:null;
  if(returnedId&&matching.some(v=>v.id===returnedId))return finish('CONFIRMED','The original start receipt identifies the exact native case and its current or historic record.',{caseInstanceIds:[returnedId],confirmation:'ORIGINAL_NATIVE_CASE_START_RECEIPT_AND_READBACK',requestAttribution:'ORIGINAL_RESPONSE'});
  const fresh=matching.filter(v=>!previous.has(v.id));
  if(!acknowledged&&typeof plan.readback.businessKey==='string'&&plan.readback.businessKey.length&&fresh.length===1&&variablesCorrespond(plan,after,fresh[0].id))return finish('CONFIRMED','One new native case matches the selected business key, definition and exact retained initial variables.',{caseInstanceIds:[fresh[0].id],confirmation:'CURRENT_NEW_NATIVE_CASE_WITH_REVIEWED_BUSINESS_KEY',requestAttribution:'CURRENT_STATE_ONLY'});
  return pending(acknowledged?'The original case start was acknowledged; selected current or historic readback is pending.':'The original case start remains unresolved; no repeated start has been sent.',{candidateCaseInstanceIds:fresh.map(v=>v.id)});
 }
 if(['updateCase','evaluateCaseCriteria','terminateCase'].includes(plan.action)){
  const id=plan.readback.caseInstanceId,current=after.cases.find(v=>v.id===id),historic=after.historicCases.find(v=>v.id===id),prior=before.cases.find(v=>v.id===id);
  if(plan.action==='evaluateCaseCriteria'){
   if(acknowledged&&(current||historic))return finish('CONFIRMED','The native engine acknowledged criteria evaluation for the original selected case.',{caseInstanceIds:[id],confirmation:'ORIGINAL_NATIVE_CRITERIA_EVALUATION_RECEIPT',caseState:current?.state??historic?.state??null,requestAttribution:'ORIGINAL_RESPONSE'});
   return pending('Criteria evaluation has no unique request identifier in native history; the original response remains necessary.',{caseInstanceIds:[id],caseState:current?.state??historic?.state??null});
  }
  if(plan.action==='terminateCase'){
   if(prior&&!current&&historic?.state==='terminated'&&historic.endTime)return finish('CONFIRMED','The selected native case is absent from runtime and has its original terminated history.',{caseInstanceIds:[id],historicEndTime:historic.endTime,confirmation:acknowledged?'ORIGINAL_NATIVE_TERMINATION_RECEIPT_AND_READBACK':'CURRENT_NATIVE_CASE_TERMINATED',requestAttribution:acknowledged?'ORIGINAL_RESPONSE':'CURRENT_STATE_ONLY'});
   return pending('The selected case termination readback is not yet complete.',{caseInstanceIds:[id],caseState:current?.state??historic?.state??null});
  }
  const updates=plan.readback.updates??{},selected=current??historic,fields=Object.keys(updates);
  if(selected&&fields.length&&fields.every(key=>selected[key]===updates[key]))return finish('CONFIRMED','The selected native case has the exact requested nonempty name and business-key updates.',{caseInstanceIds:[id],updates,confirmation:acknowledged?'ORIGINAL_NATIVE_CASE_UPDATE_RECEIPT_AND_READBACK':'CURRENT_NATIVE_CASE_FIELDS_MATCH',requestAttribution:acknowledged?'ORIGINAL_RESPONSE':'CURRENT_STATE_ONLY'});
  if(acknowledged&&selected&&!fields.length)return finish('CONFIRMED','The native engine acknowledged the original empty-property update; no fields were requested to change.',{caseInstanceIds:[id],updates,confirmation:'ORIGINAL_NATIVE_NO_FIELD_UPDATE_RECEIPT',requestAttribution:'ORIGINAL_RESPONSE'});
  return pending('The selected case fields do not yet establish the requested native update.',{caseInstanceIds:[id],updates});
 }
 if(own(PLAN_ITEM_ACTIONS,plan.action)){
  const id=plan.readback.planItemInstanceId,current=after.planItems.find(v=>v.id===id),historic=after.historicPlanItems.find(v=>v.id===id),prior=before.planItems.find(v=>v.id===id),priorHistory=before.historicPlanItems.find(v=>v.id===id);
  const caseId=nativeCaseId(current)??nativeCaseId(historic),beforeCaseId=nativeCaseId(prior)??nativeCaseId(priorHistory),related=Boolean(caseId&&beforeCaseId===caseId&&(plan.readback.caseInstanceId===undefined||plan.readback.caseInstanceId===caseId));
  let matches=false;
  if(plan.action==='startPlanItem'||plan.action==='enablePlanItem')matches=related&&(current?.state==='active'||changedTime(priorHistory,historic,'lastStartedTime')&&['completed','terminated','failed'].includes(historic.state));
  else if(plan.action==='disablePlanItem')matches=related&&(current?.state==='disabled'||changedTime(priorHistory,historic,'lastDisabledTime'));
  else if(acknowledged)matches=related&&Boolean(current||historic);
  if(matches)return finish('CONFIRMED',plan.action==='enablePlanItem'?'The original ENABLE endpoint has performed its pinned native start behavior.':plan.action==='triggerPlanItem'?'The original native trigger receipt and selected plan-item readback are retained.':'The selected plan item has the expected native lifecycle state.',{planItemInstanceIds:[id],caseInstanceIds:[caseId],nativeAction:plan.readback.nativeAction,planItemState:current?.state??historic?.state??null,confirmation:acknowledged?'ORIGINAL_NATIVE_PLAN_ITEM_RECEIPT_AND_READBACK':'CURRENT_NATIVE_PLAN_ITEM_STATE_MATCH',requestAttribution:acknowledged?'ORIGINAL_RESPONSE':'CURRENT_STATE_ONLY'});
  return pending(plan.action==='triggerPlanItem'?'A generic trigger cannot be attributed from changed history alone; the original receipt remains necessary.':'The selected plan-item transition is not yet established by native readback.',{planItemInstanceIds:[id],caseInstanceIds:[caseId??beforeCaseId].filter(Boolean),nativeAction:plan.readback.nativeAction,planItemState:current?.state??historic?.state??null});
 }
 if(TASK_ACTIONS.includes(plan.action)){
  const id=plan.readback.taskId,current=after.tasks.find(v=>v.id===id),historic=after.historicTasks.find(v=>v.id===id),prior=before.tasks.find(v=>v.id===id),priorHistory=before.historicTasks.find(v=>v.id===id);
  const caseId=nativeCaseId(current)??nativeCaseId(historic),beforeCaseId=nativeCaseId(prior)??nativeCaseId(priorHistory),related=Boolean(caseId&&caseId===beforeCaseId&&(plan.readback.caseInstanceId===undefined||plan.readback.caseInstanceId===caseId));
  let matches=false;
  if(plan.action==='complete')matches=related&&Boolean(prior&&!current&&historic?.endTime&&[null,undefined,'completed'].includes(historic.deleteReason))&&(acknowledged||variablesCorrespond(plan,after,caseId));
  else if(plan.action==='claim'||plan.action==='unclaim')matches=related&&Boolean(current&&(current.assignee??null)===plan.readback.assignee);
  else if(plan.action==='delegate')matches=related&&Boolean(current&&current.assignee===plan.readback.assignee&&String(current.delegationState).toLowerCase()==='pending'&&(current.owner??null)===(prior?.owner??prior?.assignee??null));
  else matches=related&&Boolean(current&&String(current.delegationState).toLowerCase()==='resolved'&&prior?.owner&&current.assignee===prior.owner);
  if(matches)return finish('CONFIRMED',plan.action==='complete'?'The original case task completion is present in native history.':'The selected case task has the exact native assignment or delegation state.',{taskIds:[id],caseInstanceIds:[caseId],historicEndTime:historic?.endTime??null,confirmation:acknowledged?'ORIGINAL_NATIVE_CASE_TASK_RECEIPT_AND_READBACK':'CURRENT_NATIVE_CASE_TASK_STATE_MATCH',requestAttribution:acknowledged?'ORIGINAL_RESPONSE':'CURRENT_STATE_ONLY'});
  return pending('The selected case task outcome remains unresolved in the complete native readback.',{taskIds:[id],caseInstanceIds:[caseId??beforeCaseId].filter(Boolean)});
 }
 throw fail('FLOWABLE_INPUT_INVALID','Unknown original CMMN reconciliation action.');
}
