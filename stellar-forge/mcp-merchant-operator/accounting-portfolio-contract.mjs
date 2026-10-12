// MIT. Installed portfolio requests preserve the original runbook mutation and child command.
import {runbookWireCanonical,runbookWireHash} from './accounting-runbooks-contract.mjs';
export {runbookWireCanonical as portfolioWireCanonical,runbookWireHash as portfolioWireHash};
export const PORTFOLIO_TOOL_PREFIX='merchant_accounting_portfolio_';
export const PORTFOLIO_HOST_REQUEST_SCHEMA='stellar-forge.accounting-portfolio-host-request.v1';
export const PORTFOLIO_FILE_SELECTORS=['captureId','receivedId','clientId','cycleId','planId'];
export const PORTFOLIO_ACTIONS=Object.freeze({
  configure:{kind:'portfolio_configured',method:'configure'},
  commission:{kind:'portfolio_commissioned',method:'commission'},
  schedule:{kind:'portfolio_scheduled',method:'schedule'},
  command:{kind:'portfolio_command_prepared',method:'prepare'},
  capture:{kind:'portfolio_captured',method:'capture'},
  receive:{kind:'portfolio_received',method:'receive'},
  adopt:{kind:'portfolio_adopted',method:'adopt'},
});
export const PORTFOLIO_INPUT_FIELDS=Object.freeze({
  configure:['actor','expectedFirmEditionId','firm','staff'],
  commission:['actor','alias','clientWorkspaceId','clientRevision','runbookId','editionId','clientId','expectedCommissionId','preparerId','backupId','reviewerId','status','name','scope','sourceGaps','reportingInstructions','escalationInstructions','readinessNote','sourcePacketId','sourceClientId'],
  schedule:['actor','label','startDate','endDate','previousPlanId','rows','expectedPreviewSha256','capacityExceptions'],
  command:['actor','clientId','action','nativeRequestId','clientWorkspaceId','clientRevision','parameters','planId','rowId','replacesCommandId'],
  capture:['actor','label','clients'],
  receive:['actor'],
  adopt:['actor','receivedId','expectedPacketSha256','bindings','adoptFirm','expectedFirmEditionId'],
});
export const PORTFOLIO_PREVIEW_FIELDS=['label','startDate','endDate','previousPlanId','rows'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[a-f0-9]{64}$/;
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/,COMMAND_ALIAS=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
function need(ok,message,code='PORTFOLIO_HOST_REQUEST_CHANGED'){if(!ok)throw Object.assign(new Error(message),{code});}
function exact(value,fields){need(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),'Keep the declared original portfolio request fields.');}
export function portfolioHostBinding(value){const {wireSha256,...binding}=value;return binding;}
export function portfolioHostRequest(value){
  exact(value,['schema','action','kind','target','input','file','requestSha256','wireSha256']);
  need(value.schema===PORTFOLIO_HOST_REQUEST_SCHEMA&&Object.hasOwn(PORTFOLIO_ACTIONS,value.action),'Choose the original saved portfolio request.');
  need(value.kind===PORTFOLIO_ACTIONS[value.action].kind&&value.target===null,'Keep the original coordinator action.');
  exact(value.input,['workspaceId','requestId','revision',...PORTFOLIO_INPUT_FIELDS[value.action]]);
  need(SHA.test(value.input.workspaceId??'')&&UUID.test(value.input.requestId??'')&&Number.isSafeInteger(value.input.revision)&&value.input.revision>=1,
    'Keep the original coordinator workspace, request UUID and revision.');
  need(typeof value.input.actor==='string'&&value.input.actor.trim()&&value.input.actor.length<=160&&!value.input.actor.includes('\0'),
    'Supply the responsible operator, up to 160 characters.');
  need(SHA.test(value.requestSha256??'')&&SHA.test(value.wireSha256??''),'Keep both complete prepared-request hashes.');
  if(value.action==='receive'){
    exact(value.file,['source','name','bytes','sha256']);
    need(ALIAS.test(value.file.source??'')&&typeof value.file.name==='string'&&value.file.name.trim()&&value.file.name.length<=160&&
      !/[\\/\r\n\0"]/.test(value.file.name)&&!['.','..'].includes(value.file.name),'Keep the configured portfolioInputs alias and original filename.');
    need(Number.isSafeInteger(value.file.bytes)&&value.file.bytes>0&&value.file.bytes<=64*1024*1024&&SHA.test(value.file.sha256??''),
      'Keep the complete original portfolio packet byte count and SHA256.');
  }else{
    need(value.file===undefined,'Only receiving selects an uploaded portfolio packet.');
    need(runbookWireHash({kind:value.kind,target:null,input:value.input})===value.requestSha256,'The original native portfolio request changed.');
  }
  need(runbookWireHash(portfolioHostBinding(value))===value.wireSha256,'The complete saved request or file selection changed.');
  return value;
}
export function portfolioOperationMatches(prepared,operation){
  portfolioHostRequest(prepared);
  need(plain(operation)&&operation.id===prepared.input.requestId&&operation.kind===prepared.kind&&operation.target===null&&
    operation.requestSha256===prepared.requestSha256&&operation.result?.workspaceId===prepared.input.workspaceId&&
    operation.result?.requestId===prepared.input.requestId,'This request UUID belongs to different saved coordinator work.','PORTFOLIO_REQUEST_CONFLICT');
  return operation.result;
}
/** Validate the exact child command retained by PortfolioWorkspace, including its native UUID/digest. */
export function portfolioCommand(value){
  need(plain(value)&&UUID.test(value.id??'')&&UUID.test(value.clientId??'')&&SHA.test(value.originWorkspaceId??'')&&
    SHA.test(value.clientWorkspaceId??'')&&COMMAND_ALIAS.test(value.alias??'')&&plain(value.nativeRequest),'Keep the complete saved original client command.','PORTFOLIO_COMMAND_BINDING');
  const kinds={save:'edition_saved',create:'cycle_created',assign:'assignment_changed',work:'procedure_saved',submit:'preparation_submitted',review:'review_saved'};
  const targeted=['assign','work','submit','review'].includes(value.action);
  need(value.kind===kinds[value.action]&&(targeted?UUID.test(value.target??''):value.target===null)&&
    value.nativeRequest.workspaceId===value.clientWorkspaceId&&UUID.test(value.nativeRequest.requestId??'')&&
    Number.isSafeInteger(value.nativeRequest.revision)&&value.nativeRequest.revision>=1&&
    SHA.test(value.nativeRequestSha256??'')&&SHA.test(value.commandSha256??''),
    'Keep the selected client action, workspace, revision and original native request UUID.','PORTFOLIO_COMMAND_BINDING');
  need(runbookWireHash({kind:value.kind,target:value.target,input:value.nativeRequest})===value.nativeRequestSha256,
    'The retained original child request changed.','PORTFOLIO_COMMAND_BINDING');
  const {commandSha256,...binding}=value;
  need(runbookWireHash(binding)===commandSha256,'The complete retained child command changed.','PORTFOLIO_COMMAND_BINDING');
  return value;
}
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const uuid={type:'string',pattern:'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'};
const sha256={type:'string',pattern:'^[a-f0-9]{64}$'},revision={type:'integer',minimum:1};
const base={workspace:alias,workspaceId:sha256,expectedRevision:revision};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}};
const choice=values=>({type:'string',enum:values});
const nativeInput={type:'object',properties:{},additionalProperties:true};
const sourceFile={type:'object',properties:{source:alias,name:{type:'string',minLength:1,maxLength:160},sha256,bytes:{type:'integer',minimum:1,maximum:64*1024*1024}},required:['source','name'],additionalProperties:false};
const readOnly={readOnly:true,idempotent:true};
export const portfolioDefinitions=[
  [PORTFOLIO_TOOL_PREFIX+'status','Inspect the original coordinator. Summary returns current firm standards and complete counts. Page immutable firm editions, staff, commissioned clients, calendars, original child commands, captures or received portfolios.',{...base,view:choice(['summary','firm_editions','staff','clients','plans','commands','captures','received']),firmEditionId:uuid,...page},['workspace'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'source','Read a configured client through its original accounting admission. Page actual books, periods with their fixed procedure set, retained files, accountant handoffs, selected return revisions or closes. Pin clientWorkspaceId, expectedClientRevision and observationSha256 across pages.',{...base,alias,clientWorkspaceId:sha256,expectedClientRevision:revision,observationSha256:sha256,handoffId:uuid,view:choice(['summary','runbooks','cycles','files','handoffs','revisions','closes']),...page},['workspace','alias'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'live','Observe actual commissioned client work and original current phases. Page client summaries or one client’s cycles; observationSha256 pins the complete joined observation across pages. Unavailable clients report their original error code.',{...base,view:choice(['clients','cycles']),clientId:uuid,observationSha256:sha256,...page},['workspace'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'client','Read a commissioned client and page its original immutable commissioning editions. No child workspace is replaced.',{...base,clientId:uuid,view:choice(['summary','commissions']),...page},['workspace','clientId'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'plan','Read a saved close calendar. Page complete client rows including optional profileId/profileName/selectedStepCount, staff availability, allocations, daily capacity, conflicts or accepted capacity exceptions. The immutable preview digest and calendar series remain visible.',{...base,planId:uuid,view:choice(['summary','rows','staff','allocations','days','conflicts','capacity_exceptions']),...page},['workspace','planId'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'command','Read one complete retained native client command, including its original input and UUID. Keep the whole object before execute_command; historical commands remain readable.',{...base,commandId:uuid},['workspace','commandId'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'result','Reconcile one command against the original client’s operation UUID. A completed original result is returned before any attempt to dispatch.',{...base,commandId:uuid},['workspace','commandId'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'received','Read a received portable portfolio. Page its exact firm editions, clients, plans, commands or separately retained original client packet identities.',{...base,receivedId:uuid,view:choice(['summary','firm_editions','clients','plans','commands','packets']),...page},['workspace','receivedId'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'operation','Recover one original committed coordinator request by UUID and native request digest.',{...base,requestId:uuid},['workspace','requestId'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'preview','Calculate the complete close calendar against actual named capacity and selected client sources. input contains label, date range, optional previousPlanId and full rows. A row may select profileId from its commissioned procedure edition; an existing cycle keeps its frozen procedure set. Preserve preview.previewSha256 for schedule; this reads the original workspaces.',{...base,input:nativeInput},['workspace','input'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'prepare','Prepare a complete coordinator configure, commission, schedule, command, capture, receive or adopt request. command retains a separate original child UUID and full native parameters; save includes complete edition profiles, and create may select profileId. A calendar-bound create uses that row’s exact set. Preparation does not execute the child. receive selects one portfolioInputs alias. Persist the entire prepared object before execute.',{...base,action:choice(Object.keys(PORTFOLIO_ACTIONS)),requestId:uuid,input:nativeInput,file:sourceFile},['workspace','action','input'],{readOnly:true}],
  [PORTFOLIO_TOOL_PREFIX+'execute','Commit the unchanged prepared coordinator request through its original runbook writer. Existing committed UUIDs reconcile before any input-file read. Lost replies can use reconcile or exact replay.',{workspace:alias,prepared:nativeInput},['workspace','prepared'],{idempotent:true}],
  [PORTFOLIO_TOOL_PREFIX+'reconcile','Recover the original coordinator result using the complete saved request. The configured packet may be absent after a completed receive; its saved UUID and native digest remain the authority.',{workspace:alias,prepared:nativeInput},['workspace','prepared'],readOnly],
  [PORTFOLIO_TOOL_PREFIX+'execute_command','Execute the exact retained client command under its original child admission, or recover that child’s committed operation. The complete command SHA protects the original native UUID and content; superseded uncommitted commands cannot dispatch.',{...base,commandId:uuid,expectedCommandSha256:sha256},['workspace','workspaceId','commandId','expectedCommandSha256'],{idempotent:true}],
];
