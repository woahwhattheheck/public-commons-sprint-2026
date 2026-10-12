// MIT. Typed wire contract for the existing API-pass customer workspace.
import {createHash} from 'node:crypto';
export const API_PASS_PREFIX='merchant_api_pass_';
export const API_PASS_CONNECTION_SCHEMA='stellar-forge.sf101.api-pass-mcp-connection.v1';
export const API_PASS_EXPORT_SCHEMA='stellar-forge.sf101.api-pass-mcp-export.v1';
export const API_PASS_EXPORT_MANIFEST='api-pass-export.json';
export const API_PASS_MAX_FILE_BYTES=128*1024*1024;
export const API_PASS_ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const API_PASS_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const API_PASS_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const API_PASS_SHA=/^[a-f0-9]{64}$/;
export const apiPassPlain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const apiPassFailure=(code,message,extra={})=>Object.assign(new Error(message),{code,apiPassPublic:true,...extra});
export const apiPassHash=value=>createHash('sha256').update(value).digest('hex');
export const apiPassCanonical=value=>Array.isArray(value)?value.map(apiPassCanonical):apiPassPlain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,apiPassCanonical(value[key])])):value;
export const apiPassFingerprint=value=>apiPassHash(JSON.stringify(apiPassCanonical(value)));
export function apiPassNeed(condition,message,code='INVALID_PARAMS'){if(!condition)throw apiPassFailure(code,message);}
export function apiPassExact(value,keys,required=[]){apiPassNeed(apiPassPlain(value)&&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key)),'Supply only the declared fields and every required field.');}
export function apiPassChecked(value,pattern,label){apiPassNeed(typeof value==='string'&&pattern.test(value),'Supply the exact '+label+'.');return value;}
export function apiPassInteger(value,minimum,maximum,label){apiPassNeed(Number.isSafeInteger(value)&&value>=minimum&&value<=maximum,'Supply '+label+' within its declared range.');return value;}
export function apiPassText(value,maximum,label,{empty=false}={}){apiPassNeed(typeof value==='string'&&(empty||value.trim().length>0)&&value.length<=maximum&&!/[\u0000-\u001f\u007f]/.test(value),'Supply the original '+label+'.');return value;}
const alias={type:'string',pattern:API_PASS_ALIAS.source},uuid={type:'string',pattern:API_PASS_UUID.source},sha={type:'string',pattern:API_PASS_SHA.source},identity={type:'string',pattern:API_PASS_ID.source};
const text=(max=160)=>({type:'string',minLength:1,maxLength:max});
const revision={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const page={offset:{type:'integer',minimum:0,maximum:10000},limit:{type:'integer',minimum:1,maximum:200},expectedRevision:revision};
const mutation={operationId:identity,expectedRevision:revision};
export const API_PASS_TASK_KINDS=Object.freeze(['refresh','call','recover','prepare-purchase','review-purchase','execute-purchase','recover-purchase','finalize-purchase','report-purchase','inspect-lost-output','recover-lost-output','read-lost-output','export-lost-output']);
const selectionSchema={type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['response','review','proof','report','history']},profileId:uuid,callId:uuid,taskId:uuid},required:['kind']};
const definitions=[];
function define(name,description,properties={},required=[],annotations={readOnly:true,idempotent:true}){definitions.push({name:API_PASS_PREFIX+name,description,properties,required,annotations});}
define('workspaces','List configured original API-pass workspace aliases, pinned public identities and declared input/purchase handles. Private launch capabilities and host paths remain on the host.');
define('open','Authenticate the existing private launch record and the original running workspace. Returns its current session and public launch identity.',{workspace:alias},['workspace']);
define('status','Read the original workspace revision, pass counts, claim environment names and recent task/history windows; includes complete-history and retained-export availability.',{workspace:alias},['workspace']);
define('passes','Page public pass summaries from one original workspace snapshot. Pin expectedRevision when continuing the same observed inventory.',{workspace:alias,...page},['workspace']);
define('pass','Read one original pass, purchased routes, allowance and a real page of saved calls. Native detail includes its latest 100 tasks; history reads all retained tasks.',{workspace:alias,profileId:uuid,...page},['workspace','profileId']);
define('call','Read an original saved request and retained result identity without dispatching it.',{workspace:alias,callId:uuid},['workspace','callId']);
define('call_preview','Read the original bounded UTF-8/binary response preview. Use capture and complete file download for the original bytes.',{workspace:alias,callId:uuid},['workspace','callId']);
define('body_preview','Read the original saved request-body preview and its explicit truncation/byte metadata.',{workspace:alias,callId:uuid},['workspace','callId']);
define('remote_calls','Read the original merchant call page and its exact nextAfter cursor. This does not adopt or execute a request.',{workspace:alias,profileId:uuid,after:text(256),limit:page.limit},['workspace','profileId']);
define('history','Page all saved calls or tasks from the original complete customer-history export. Pin expectedRevision across pages; use capture(kind=history) for the whole original file.',{workspace:alias,profileId:uuid,view:{type:'string',enum:['calls','tasks']},...page},['workspace','profileId','view']);
define('task','Find one exact retained task in the original complete profile history, including tasks outside the recent UI window.',{workspace:alias,profileId:uuid,taskId:uuid},['workspace','profileId','taskId']);
define('operation','Reopen one host-retained exact HTTP operation, its dispatch history and complete saved response before any retry. Original argument handles and native IDs remain bound.',{workspace:alias,operationId:identity},['workspace','operationId']);
define('approval','Read the original browser-broker approval envelope or original-terminal mode for this purchase.',{workspace:alias,profileId:uuid},['workspace','profileId']);
define('input','Inspect the complete byte count and SHA256 of one host-declared original handoff, request body or approved-request file.',{workspace:alias,file:alias},['workspace','file']);
define('connect','Connect an existing purchased pass through the original model. Keep operationId and all fields on an interrupted retry.',{workspace:alias,...mutation,label:text(),gatewayBaseUrl:text(2048),orderReference:identity,manifestSha256:sha,claimEnv:text(65)},['workspace','operationId','expectedRevision','label','gatewayBaseUrl','orderReference','manifestSha256','claimEnv'],{idempotent:true});
define('purchase_prepare','Retain an original purchase using a host-declared complete checkout handoff and its reviewed SHA. The original Buyer/Inbox perform later preparation, review and payment tasks.',{workspace:alias,...mutation,label:text(),gatewayBaseUrl:text(2048),intentId:identity,claimEnv:text(65),handoff:alias,expectedHandoffSha256:sha},['workspace','operationId','expectedRevision','label','gatewayBaseUrl','intentId','claimEnv','handoff','expectedHandoffSha256'],{idempotent:true});
define('purchase_attach','Adopt the host-declared existing original purchase directory with pinned customer metadata and original intent/order; the original workspace validates Buyer custody.',{workspace:alias,...mutation,label:text(),purchase:alias},['workspace','operationId','expectedRevision','label','purchase'],{idempotent:true});
define('update','Update an original pass label or archive state through its existing revision-guarded mutation.',{workspace:alias,...mutation,profileId:uuid,label:text(),archived:{type:'boolean'}},['workspace','operationId','expectedRevision','profileId','label','archived'],{idempotent:true});
define('prepare_request','Save the exact original request ID, purchased route, ordered query pairs and optional host-declared body bytes. This does not send the request.',{workspace:alias,...mutation,profileId:uuid,requestId:identity,routeId:identity,label:text(),query:{type:'array',maxItems:100,items:{type:'array',minItems:2,maxItems:2,items:{type:'string',maxLength:4096}}},contentType:text(255),bodyFile:alias,expectedBodySha256:sha},['workspace','operationId','expectedRevision','profileId','requestId','routeId','contentType'],{idempotent:true});
define('adopt_request','Adopt an existing merchant request into the original recovery-only client record using its exact request ID.',{workspace:alias,...mutation,profileId:uuid,requestId:identity},['workspace','operationId','expectedRevision','profileId','requestId'],{idempotent:true,openWorld:true});
define('enqueue','Queue an original pass/request/purchase/recovery task. Use the displayed exact reviewId for execution or lost-output recovery. Lost-output inspection reads a host-declared approved preimage. Returns QUEUED, not completed execution.',{workspace:alias,...mutation,profileId:uuid,kind:{type:'string',enum:API_PASS_TASK_KINDS},callId:uuid,reviewId:uuid,transaction:sha,approvedRequestFile:alias,expectedApprovedRequestSha256:sha},['workspace','operationId','expectedRevision','profileId','kind'],{idempotent:true,openWorld:true});
define('cancel','Request cancellation through the original task state machine. The original worker retires the attempt and retains its actual outcome.',{workspace:alias,...mutation,taskId:uuid},['workspace','operationId','expectedRevision','taskId'],{idempotent:true,destructive:true});
define('decide','Pass an exact original browser approval decision to the existing broker. The native approval ID, intent and request hash remain authoritative; terminal-mode approvals use the original terminal.',{workspace:alias,profileId:uuid,intent:identity,approvalId:identity,requestSha256:sha,decision:{type:'string',enum:['approve','reject']}},['workspace','profileId','intent','approvalId','requestSha256','decision'],{idempotent:true,openWorld:true});
define('capture','Retain one complete original response, review, proof, buyer report or customer-history file under a stable exportId. Existing completed IDs reopen identical bytes; selecting another source with that ID is rejected.',{workspace:alias,exportId:alias,selection:selectionSchema,expectedSha256:sha},['workspace','exportId','selection'],{idempotent:true});
define('exports','Page this host’s completed original-file exports for the selected pinned workspace.',{workspace:alias,offset:page.offset,limit:page.limit,expectedInventorySha256:sha},['workspace']);
define('manifest','Read the saved original-file export manifest identity. Works with a stopped original workspace because complete exported bytes already belong to this host.',{workspace:alias,exportId:alias},['workspace','exportId']);
define('file','Read a complete retained export file in bounded base64 chunks. Continue with the same manifest SHA, file SHA and readId; original RetainedFileReads owns the immutable snapshot.',{workspace:alias,exportId:alias,file:text(80),expectedManifestSha256:sha,expectedSha256:sha,readId:uuid,offset:{type:'integer',minimum:0,maximum:API_PASS_MAX_FILE_BYTES},limit:{type:'integer',minimum:1,maximum:196608}},['workspace','exportId','file','expectedManifestSha256','expectedSha256']);
define('file_release','Release one of this export’s retained file-read snapshots. Completed source files remain available for reopening.',{workspace:alias,exportId:alias,readId:uuid},['workspace','exportId','readId'],{idempotent:true});
export const API_PASS_DEFINITIONS=Object.freeze(definitions);
export function apiPassWorkspaceTools(tool){return definitions.map(d=>tool(d.name,d.description,structuredClone(d.properties),[...d.required],{...d.annotations}));}
export function apiPassSelection(value){
 apiPassExact(value,['kind','profileId','callId','taskId'],['kind']);
 const fields={response:['callId'],review:['profileId'],proof:['profileId','taskId'],report:['profileId','taskId'],history:['profileId']}[value.kind];
 apiPassNeed(fields,'Choose response, review, proof, report or history.');apiPassExact(value,['kind',...fields],['kind',...fields]);
 for(const key of fields)apiPassChecked(value[key],API_PASS_UUID,key);
 return structuredClone(value);
}
export function apiPassArguments(name,input={}){
 name=name.startsWith(API_PASS_PREFIX)?name:API_PASS_PREFIX+name;
 const definition=definitions.find(d=>d.name===name);apiPassNeed(definition,'Choose a declared API-pass operation.');
 apiPassExact(input,Object.keys(definition.properties),definition.required);
 const value=structuredClone(input),kind=name.slice(API_PASS_PREFIX.length);
 for(const [key,item]of Object.entries(value)){
  if(['workspace','file','handoff','bodyFile','approvedRequestFile','purchase','exportId'].includes(key)&&key!=='file'||key==='file'&&kind==='input')apiPassChecked(item,API_PASS_ALIAS,key);
  else if(['profileId','callId','taskId','readId','reviewId'].includes(key))apiPassChecked(item,API_PASS_UUID,key);
  else if(/Sha256$/.test(key)||['manifestSha256','transaction','requestSha256'].includes(key))apiPassChecked(item,API_PASS_SHA,key);
  else if(['operationId','intentId','requestId','routeId','orderReference','intent','approvalId'].includes(key))apiPassChecked(item,API_PASS_ID,key);
  else if(key==='expectedRevision')apiPassInteger(item,1,Number.MAX_SAFE_INTEGER,key);
  else if(key==='offset')apiPassInteger(item,0,kind==='file'?API_PASS_MAX_FILE_BYTES:10000,key);
  else if(key==='limit')apiPassInteger(item,1,kind==='file'?196608:200,key);
  else if(['label','gatewayBaseUrl','contentType','after','file'].includes(key))apiPassText(item,key==='gatewayBaseUrl'?2048:key==='contentType'?255:key==='after'?256:key==='file'?80:160,key);
  else if(key==='claimEnv')apiPassChecked(item,/^[A-Z][A-Z0-9_]{1,64}$/,key);
  else if(key==='archived')apiPassNeed(typeof item==='boolean','Supply the original archive choice.');
 }
 if(kind==='prepare_request'){
  value.query??=[];apiPassNeed(Array.isArray(value.query)&&value.query.length<=100&&value.query.every(row=>Array.isArray(row)&&row.length===2&&row.every(s=>typeof s==='string'&&s.length<=4096&&!s.includes('\0'))),'Supply ordered original query pairs.');
  apiPassNeed(Buffer.byteLength(JSON.stringify(value.query))<=32768,'The original query input exceeds 32 KiB.');
  apiPassNeed((value.bodyFile===undefined)===(value.expectedBodySha256===undefined),'Select both a body file handle and its original SHA, or omit both.');
 }
 if(kind==='enqueue'){
  apiPassNeed(API_PASS_TASK_KINDS.includes(value.kind),'Choose an original native task kind.');
  const call=['call','recover'].includes(value.kind),inspect=value.kind==='inspect-lost-output',review=['execute-purchase','recover-lost-output'].includes(value.kind),recover=value.kind==='recover-lost-output';
  apiPassNeed(call===(value.callId!==undefined),'Only call/recover tasks require their exact callId.');
  apiPassNeed(inspect===(value.approvedRequestFile!==undefined)&&inspect===(value.expectedApprovedRequestSha256!==undefined),'Only lost-output inspection requires its declared approved-request file and SHA.');
  apiPassNeed(review===(value.reviewId!==undefined),'Use the exact reviewId only for execute-purchase or recover-lost-output.');
  apiPassNeed(recover===(value.transaction!==undefined),'Only lost-output recovery requires the selected original transaction.');
 }
 if(kind==='history')apiPassNeed(['calls','tasks'].includes(value.view),'Choose calls or tasks.');
 if(kind==='decide')apiPassNeed(['approve','reject'].includes(value.decision),'Choose approve or reject.');
 if(kind==='capture')value.selection=apiPassSelection(value.selection);
 return value;
}
export const API_PASS_FILE_NAMES=Object.freeze({response:'response.bin',review:'purchase-review.json',proof:'payment-proof.json',report:'buyer-history.html',history:'customer-history.json'});
export function parseApiPassExport(bytes,expectedId){
 apiPassNeed(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=65000,'Read the complete export manifest.','API_PASS_EXPORT_INVALID');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw apiPassFailure('API_PASS_EXPORT_INVALID','The saved export manifest is invalid UTF-8 JSON.');}
 apiPassExact(value,['schema','exportId','createdAt','workspace','selection','source','requestSha256','files'],['schema','exportId','createdAt','workspace','selection','source','requestSha256','files']);
 apiPassNeed(value.schema===API_PASS_EXPORT_SCHEMA&&API_PASS_ALIAS.test(value.exportId??'')&&(!expectedId||value.exportId===expectedId)&&Number.isFinite(Date.parse(value.createdAt)),'The original export identity changed.','API_PASS_EXPORT_INVALID');
 apiPassExact(value.workspace,['alias','id'],['alias','id']);apiPassChecked(value.workspace.alias,API_PASS_ALIAS,'workspace alias');apiPassChecked(value.workspace.id,API_PASS_UUID,'workspace ID');
 apiPassSelection(value.selection);apiPassChecked(value.requestSha256,API_PASS_SHA,'export request SHA');
 apiPassExact(value.source,['instanceId','launchSha256','entrySha256','path','observedAt','nativeSha256','revision'],['instanceId','launchSha256','entrySha256','path','observedAt','nativeSha256','revision']);
 apiPassChecked(value.source.instanceId,API_PASS_UUID,'original instance ID');for(const key of ['launchSha256','entrySha256'])apiPassChecked(value.source[key],API_PASS_SHA,key);
 apiPassNeed(value.source.nativeSha256===null||API_PASS_SHA.test(value.source.nativeSha256),'Use the actual native digest or null.');
 apiPassNeed(value.source.revision===null||Number.isSafeInteger(value.source.revision)&&value.source.revision>=1,'Use the observed native revision or null.');
 apiPassNeed(typeof value.source.path==='string'&&/^\/api\//.test(value.source.path)&&Number.isFinite(Date.parse(value.source.observedAt)),'The native source observation is invalid.');
 apiPassNeed(Array.isArray(value.files)&&value.files.length===1,'An original-file export contains one complete file.','API_PASS_EXPORT_INVALID');
 const file=value.files[0];apiPassExact(file,['name','bytes','sha256','contentType'],['name','bytes','sha256','contentType']);
 apiPassNeed(file.name===API_PASS_FILE_NAMES[value.selection.kind]&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=API_PASS_MAX_FILE_BYTES&&API_PASS_SHA.test(file.sha256??'')&&typeof file.contentType==='string'&&file.contentType.length<=255&&!/[\r\n\0]/.test(file.contentType),'The complete original file metadata changed.','API_PASS_EXPORT_INVALID');
 if(value.source.nativeSha256!==null)apiPassNeed(value.source.nativeSha256===file.sha256,'The native original digest and retained file differ.','API_PASS_EXPORT_INVALID');
 return value;
}
