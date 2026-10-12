// MIT. Original client-runbook tool and prepared-request contract.
import {createHash} from 'node:crypto';
export const RUNBOOK_TOOL_PREFIX='merchant_accounting_runbooks_';
export const RUNBOOK_HOST_REQUEST_SCHEMA='stellar-forge.accounting-runbook-host-request.v1';
export const RUNBOOK_FILE_SELECTORS=['cycleId','fileId'];
export const RUNBOOK_ACTIONS=Object.freeze({
  save:{kind:'edition_saved',method:'save'},
  attach:{kind:'file_retained',method:'addFile'},
  create:{kind:'cycle_created',method:'createCycle'},
  work:{kind:'procedure_saved',method:'saveWork',target:true},
  submit:{kind:'preparation_submitted',method:'submit',target:true},
  review:{kind:'review_saved',method:'review',target:true},
  receive:{kind:'packet_received',method:'receive'},
});
export const RUNBOOK_INPUT_FIELDS=Object.freeze({
  save:['actor','runbookId','expectedEditionId','name','client','description','resources','steps'],
  attach:['actor','name','type'],
  create:['actor','runbookId','editionId','label','preparer','reviewer','dueDate','previousCycleId','sourceKind','handoffId','accountantRevisionId','periodCloseId','sourceLabel','sourceNote','sourceFileIds'],
  work:['actor','stepId','status','note','fileIds'],
  submit:['actor','note'],
  review:['actor','decision','note','acceptedExceptions'],
  receive:['actor'],
});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
function need(ok,message,code='RUNBOOK_HOST_REQUEST_CHANGED'){if(!ok)throw Object.assign(new Error(message),{code});}
function exact(value,fields){need(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),'Keep the declared original request fields.');}
/** Same ordinary-JSON representation as the native runbooks controller; no trailing newline. */
export function runbookWireCanonical(value){
  if(Array.isArray(value))return '['+value.map(runbookWireCanonical).join(',')+']';
  if(plain(value))return '{'+Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>JSON.stringify(key)+':'+runbookWireCanonical(value[key])).join(',')+'}';
  need(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value),'Use ordinary JSON request values.');
  return JSON.stringify(value);
}
export const runbookWireHash=value=>createHash('sha256').update(runbookWireCanonical(value)).digest('hex');
export function runbookHostBinding(value){
  const {wireSha256,...binding}=value;return binding;
}
export function runbookHostRequest(value){
  exact(value,['schema','action','kind','target','input','file','requestSha256','wireSha256']);
  need(value.schema===RUNBOOK_HOST_REQUEST_SCHEMA&&Object.hasOwn(RUNBOOK_ACTIONS,value.action),'Choose the original saved client-runbook request.');
  const route=RUNBOOK_ACTIONS[value.action],withFile=['attach','receive'].includes(value.action);
  need(value.kind===route.kind&&(route.target?UUID.test(value.target??''):value.target===null),'Keep the original action and period selection.');
  exact(value.input,['workspaceId','requestId','revision',...RUNBOOK_INPUT_FIELDS[value.action]]);
  need(SHA.test(value.input.workspaceId??'')&&UUID.test(value.input.requestId??'')&&
    Number.isSafeInteger(value.input.revision)&&value.input.revision>=1,'Keep the original workspace, request UUID and revision.');
  need(typeof value.input.actor==='string'&&value.input.actor.trim().length>0&&value.input.actor.length<=160&&!value.input.actor.includes('\0'),'Supply the responsible operator, up to160 characters.');
  need(SHA.test(value.requestSha256??'')&&SHA.test(value.wireSha256??''),'Keep both complete prepared-request hashes.');
  if(withFile){
    exact(value.file,['source','name','bytes','sha256']);
    need(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.file.source??'')&&
      typeof value.file.name==='string'&&value.file.name.trim()&&value.file.name.length<=160&&
      !/[\\/\r\n\0"]/.test(value.file.name)&&!['.','..'].includes(value.file.name),'Keep the original configured file alias and name.');
    const maximum=(value.action==='receive'?64:8)*1024*1024;
    need(Number.isSafeInteger(value.file.bytes)&&value.file.bytes>0&&value.file.bytes<=maximum&&SHA.test(value.file.sha256??''),'Keep the reviewed complete file size and SHA256.');
    if(value.action==='attach')need(value.input.name===value.file.name,'The retained filename differs from the reviewed original file.');
  }else{
    need(value.file===undefined,'This action does not select an uploaded file.');
    need(runbookWireHash({kind:value.kind,target:value.target,input:value.input})===value.requestSha256,'The original native request changed.');
  }
  need(runbookWireHash(runbookHostBinding(value))===value.wireSha256,'The complete saved request or file selection changed.');
  return value;
}
export function runbookOperationMatches(prepared,operation){
  runbookHostRequest(prepared);
  need(plain(operation)&&operation.id===prepared.input.requestId&&operation.kind===prepared.kind&&
    operation.target===prepared.target&&operation.requestSha256===prepared.requestSha256&&
    operation.result?.workspaceId===prepared.input.workspaceId&&operation.result?.requestId===prepared.input.requestId,
    'This request UUID belongs to different saved client work.','RUNBOOK_REQUEST_CONFLICT');
  return operation.result;
}
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const uuid={type:'string',pattern:'^[0-9a-f-]{36}$'},sha256={type:'string',pattern:'^[a-f0-9]{64}$'};
const revision={type:'integer',minimum:1};
const base={workspace:alias,workspaceId:sha256,expectedRevision:revision};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}};
const choice=values=>({type:'string',enum:values});
const nativeInput={type:'object',properties:{},additionalProperties:true};
const sourceFile={type:'object',properties:{source:alias,name:{type:'string',minLength:1,maxLength:160},sha256,bytes:{type:'integer',minimum:1,maximum:64*1024*1024}},required:['source','name'],additionalProperties:false};
const readOnly={readOnly:true,idempotent:true};
export const runbookDefinitions=[
  [RUNBOOK_TOOL_PREFIX+'status','Inspect the original client-runbook workspace. Page client books, periods, retained files or received packets; summary reports counts. Complete procedures and preparation history remain in their selected book and cycle views.',{...base,view:choice(['summary','books','cycles','files','received']),...page},['workspace'],readOnly],
  [RUNBOOK_TOOL_PREFIX+'sources','Inspect actual accountant handoffs and their retained return revisions, period closes or original client files. File-based periods select retained runbook file IDs. Handoff revisions require handoffId.',{...base,view:choice(['handoffs','revisions','closes','files']),handoffId:uuid,...page},['workspace'],readOnly],
  [RUNBOOK_TOOL_PREFIX+'book','Read an original client book and a selected immutable procedure edition. Page edition headers, full steps or complete supporting resources. Omitted editionId selects the current edition; later pages can pin expectedRevision.',{...base,runbookId:uuid,editionId:uuid,view:choice(['summary','editions','steps','resources']),...page},['workspace','runbookId'],readOnly],
  [RUNBOOK_TOOL_PREFIX+'cycle','Inspect a frozen client period with its actual close source. Page full procedures/current work, resources, original source-file metadata, preparation rounds, selected submission work, reviews or complete history. A received period stays read-only; its procedures can start a new local period.',{...base,cycleId:uuid,submissionId:uuid,view:choice(['summary','steps','resources','source_files','submissions','submission_work','reviews','history']),...page},['workspace','cycleId'],readOnly],
  [RUNBOOK_TOOL_PREFIX+'operation','Recover one original saved request by UUID, including its action, period target, native request digest and committed result.',{...base,requestId:uuid},['workspace','requestId'],readOnly],
  [RUNBOOK_TOOL_PREFIX+'prepare','Construct the complete original request for save, attach, create, work, submit, review or receive. input holds actor and native action fields; the tool supplies the current workspace/revision and a request UUID. attach/receive read one runbookInputs alias and pin its actual bytes. Save the complete returned request before execute. Preparation does not commit work.',{...base,action:choice(Object.keys(RUNBOOK_ACTIONS)),cycleId:uuid,requestId:uuid,input:nativeInput,file:sourceFile},['workspace','action','input'],{readOnly:true}],
  [RUNBOOK_TOOL_PREFIX+'execute','Execute the unchanged saved request through the original client-runbook writer. An already committed request recovers its original result before re-reading a source file. Changed UUID content conflicts; after a lost reply use reconcile or replay this exact request.',{workspace:alias,prepared:nativeInput},['workspace','prepared'],{idempotent:true}],
  [RUNBOOK_TOOL_PREFIX+'reconcile','Find the original committed result for the complete saved request without requiring its configured input file to survive. NOT_FOUND keeps the same request available for exact execution.',{workspace:alias,prepared:nativeInput},['workspace','prepared'],readOnly],
];

