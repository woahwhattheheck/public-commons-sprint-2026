// MIT. Complete agent contract for the original Buyer receiving workspace.
export const BUYER_AGENT_SCHEMA='stellar-forge.buyer-runbook.agent.v1';
export const BUYER_AGENT_PREFIX='merchant_buyer_runbook_';
export const BUYER_AGENT_CONFIGURATION='stellar-forge.buyer-runbook.agent-connections.v1';
export const BUYER_AGENT_EXPORT='stellar-forge.buyer-runbook.agent-export.v1';
export const SHA=/^[a-f0-9]{64}$/;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const fail=(code,message,extra={})=>Object.assign(new Error(message),{code,buyerAgentPublic:true,...extra});
export function need(value,code,message){if(!value)throw fail(code,message);}
const text=(max=240)=>({type:'string',minLength:1,maxLength:max});
const matching=pattern=>({...text(200),pattern});
const hash=matching('^[a-f0-9]{64}$'),uuid=matching(UUID.source);
const alias=matching('^[a-z0-9][a-z0-9_-]{0,63}$');
const item=matching('^(draft-[a-f0-9-]{36}|import-[a-f0-9]{32})$');
const request=matching('^request-[a-f0-9]{64}$'),paid=matching('^file-[a-f0-9]{64}$');
const client=matching('^client-[a-f0-9]{64}$'),preset=matching('^preset-[a-f0-9]{64}$');
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const amount=matching('^(0|[1-9][0-9]{0,77})$');
const obj=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const free={type:'object',additionalProperties:true};
const arr=(items,maxItems=64)=>({type:'array',items,minItems:0,maxItems});
const optionalNote={type:'string',maxLength:1000};
const entry=obj({id:matching('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),label:text(240),config:text(4096),saveAs:text(160)},['id','label','config']);
const manifest=obj({schema:{const:'stellar-forge.buyer-runbook.v1'},id:matching('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),title:text(240),operations:{...arr(entry),minItems:1}},['schema','id','title','operations']);
export const SDK_FILES=Object.freeze(['client-export.json','seller-client.mjs','seller-client.d.mts','seller-openapi.json','package.json','README.md']);
export const FILE_SELECTION=obj({
 kind:{enum:['sdk','operator','request','paid-handoff','resource','paid-resource','report','accounting']},
 id:text(100),name:{enum:[...SDK_FILES,'body','handoff']},operation:matching('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
 format:{enum:['json','html']},expectedSha256:hash
},['kind','id']);
const defs=[];
function action(name,title,description,properties,required=[],{method='GET',path,mutating=false,replay=false,sourceKind}={}){
 const fields={workspace:alias,...properties,...(mutating?{requestId:uuid}:{})};
 defs.push(Object.freeze({name,title,description,method,path,mutating,replay,sourceKind,
  schema:obj(fields,['workspace',...required,...(mutating?['requestId']:[])])}));
}
action('open','Open Buyer application','Read and verify the original selected running application and its browser approval URL.',{},[],{path:'/api/launch'});
action('status','Buyer workspace status','Read original workspace identity, current execution and inventory counts. Use list and item reads for the complete selected records.',{},[],{path:'/api/state'});
action('list','List received Buyer work','Read a page of the original selected inventory. Repeat expectedStateSha256 for subsequent pages.',
 {collection:{enum:['drafts','acquisitions','configurations','requests','clients','paidFiles','recovery']},offset:integer(),limit:integer(1,200),expectedStateSha256:hash},['collection']);
action('operator','Read Local buyer setup','Read the selected original host setup, revisions and availability.',{},[],{path:'/api/operator'});
action('operator_revision','Read saved host version','Read one original saved Local buyer setup version.',{id:preset},['id'],{path:a=>'/api/operator/'+a.id});
for(const save of [false,true])action(save?'operator_save':'operator_review',save?'Save reviewed host setup':'Review host setup',
 'Use one hash-pinned host-declared settings file and the original exact current-state review. Values and signer environment selectors stay with the original host.',
 {settings:alias,expectedSettingsSha256:hash,expectedStateSha256:hash,note:optionalNote,sourceRevision:preset,...(save?{expectedReviewSha256:hash}:{})},
 ['settings','expectedSettingsSha256','expectedStateSha256',...(save?['expectedReviewSha256']:[])],
 {method:'POST',path:'/api/operator/'+(save?'save':'review'),mutating:save,replay:save,sourceKind:'settings'});
action('client','Read original SDK','Read the merchant customer SDK manifest, declared files and receiving status.',{id:client},['id'],{path:a=>'/api/clients/'+a.id});
action('receive_client','Receive original SDK manifest','Receive the complete original merchant client-export.json from a host-declared file.',{file:alias,expectedSha256:hash},['file','expectedSha256'],{method:'POST',path:'/api/clients/upload',mutating:true,replay:true,sourceKind:'sdk-manifest'});
action('client_file','Receive original SDK file','Receive one exact file named in the original SDK manifest. The original native digest check determines acceptance.',
 {id:client,file:alias,name:{enum:SDK_FILES.filter(n=>n!=='client-export.json')},expectedSha256:hash},['id','file','name','expectedSha256'],
 {method:'POST',path:'/api/clients/file',mutating:true,replay:true,sourceKind:'sdk-file'});
action('client_request','Compose SDK customer request','Compose a complete request through the original SDK receiver. Preserve declared path/query/body choices and the original merchant operation.',
 {id:client,expectedManifestSha256:hash,operationId:text(240),intentId:text(128),values:free,ticket:obj({file:alias,expectedSha256:hash,header:text(128)},['file','expectedSha256'])},['id','expectedManifestSha256','operationId','intentId','values'],
 {method:'POST',path:'/api/clients/request',mutating:true,replay:true});
for(const kind of ['request','paid_file']){
 const stem=kind==='request'?'requests':'paid-files',id=kind==='request'?request:paid;
 action(kind,'Read '+kind.replace('_',' '),'Read the complete original received item, retained review and preparation.',{id},['id'],{path:a=>'/api/'+stem+'/'+a.id});
 action('receive_'+kind,'Receive '+kind.replace('_',' '),'Import the exact original handoff from a hash-pinned host-declared file.',
  {file:alias,expectedSha256:hash,filename:text(180)},['file','expectedSha256','filename'],
  {method:'POST',path:'/api/'+stem+'/upload',mutating:true,replay:true,sourceKind:kind==='request'?'request-handoff':'paid-handoff'});
 action('review_'+kind,'Review '+kind.replace('_',' '),'Review the original item against the saved host settings and explicit payment option and budget.',
  kind==='request'?{id,acceptIndex:integer(),totalAtomic:amount,dailyAtomic:amount}:{id,expectedRevision:integer(0,10000),totalAtomic:amount,dailyAtomic:amount,filename:text(180),claimEnv:matching('^[A-Z][A-Z0-9_]{1,64}$')},
  kind==='request'?['id','acceptIndex','totalAtomic','dailyAtomic']:['id','expectedRevision','totalAtomic','dailyAtomic','filename','claimEnv'],
  {method:'POST',path:'/api/'+stem+'/review',mutating:true});
 action('prepare_'+kind,'Prepare reviewed '+kind.replace('_',' '),'Provision or resume the original retained operator, keys and config for this exact saved review.',
  {id,reviewSha256:hash},['id','reviewSha256'],{method:'POST',path:'/api/'+stem+'/prepare',mutating:true,replay:true});
}
action('draft','Read acquisition draft','Read one exact original acquisition draft or its retained revision.',{id:item,revision:integer(1,10000)},['id'],{path:a=>'/api/drafts/'+a.id+(a.revision===undefined?'':'/'+a.revision)});
action('save_draft','Save acquisition plan','Save the complete original acquisition manifest using the native revision check. Config paths remain inside the selected original configuration directory.',
 {id:item,expectedRevision:integer(0,9999),manifest},['expectedRevision','manifest'],{method:'POST',path:'/api/drafts/save',mutating:true});
action('initialize','Initialize saved acquisition','Initialize or resume this exact reviewed original draft without selecting another plan.',
 {id:item,expectedRevision:integer(1,10000),reviewSha256:hash},['id','expectedRevision','reviewSha256'],{method:'POST',path:'/api/drafts/initialize',mutating:true,replay:true});
action('run','Read original acquisition','Read original plan, buyer attempts, payment outcome, accounting, current execution and retained result files.',{id:item},['id'],{path:a=>'/api/runs/'+a.id});
for(const name of ['execute','finalize'])action(name,name==='execute'?'Start original buyer':'Finalize original accounting',
 name==='execute'?'Start the selected original acquisition. Its native host obtains live terms and waits for the operator at the existing approval panel.':'Finalize accounting for the original recorded attempt using its retained native operator.',
 {id:item,only:matching('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')},['id'],{method:'POST',path:'/api/runs/'+name,mutating:true});
action('cancel','Cancel current execution','Cancel the exact original active execution and retire its pending native browser review.',{id:item,executionId:uuid},['id','executionId'],{method:'POST',path:'/api/runs/cancel',mutating:true});
action('recover','Recover original acquisition','Reconcile the original retained execution and attempt without creating a new purchase.',{id:item},['id'],{method:'POST',path:'/api/runs/recover',mutating:true,replay:true});
action('unlock','Recover ended execution owner','Use the original owner-liveness check to release an ended owner. The native buyer rejects a live original owner.',{id:item,ownerPid:integer(1)},['id','ownerPid'],{method:'POST',path:'/api/runs/unlock',mutating:true});
action('bind_accounting','Bind original accounting workspace','Select a host-declared original operator workspace for native accounting.',
 {id:item,only:matching('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),operator:alias},['id','only','operator'],
 {method:'POST',path:'/api/runs/accounting-workspace',mutating:true,replay:true});
for(const reset of [false,true])action(reset?'reset_file':'retrieve_file',reset?'Reset original file transfer':'Retrieve original paid file',
 'Use the original paid-file transfer for the selected acquisition, configuration and handoff. This preserves its existing purchase.',
 {id:item,only:matching('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),configSha256:hash,handoffSha256:hash},['id','only','configSha256','handoffSha256'],
 {method:'POST',path:'/api/runs/'+(reset?'reset-file-transfer':'retrieve-file'),mutating:true});
action('approval','Read live operator review','Read the current original review and its run/execution/operation/intent binding. The existing browser panel records the operator decision.',{},[],{path:'/api/approval'});
action('resource_preview','Preview saved customer bytes','Read the original saved resource preview with exact complete-file byte count, SHA256 and explicit preview truncation.',
 {id:item,operation:matching('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')},['id','operation'],{path:a=>'/api/runs/'+a.id+'/resources/'+a.operation});
action('backup_review','Review complete recovery selection','Inspect one host-declared original recovery profile using the native workspace recovery engine.',{profile:alias,expectedProfileSha256:hash},['profile','expectedProfileSha256'],{method:'POST',path:'/api/recovery/review',sourceKind:'backup-profile'});
action('backup_start','Run original recovery operation','Start native snapshot or verification using the exact host-declared profile and reviewed digest.',
 {profile:alias,expectedProfileSha256:hash,kind:{enum:['SNAPSHOT','VERIFY']},expectedReviewSha256:hash,quiesced:{type:'boolean'}},['profile','expectedProfileSha256','kind'],
 {method:'POST',path:'/api/recovery/start',mutating:true,sourceKind:'backup-profile'});
action('backup_cancel','Cancel original recovery','Cancel the same original active backup operation.',{id:uuid},['id'],{method:'POST',path:'/api/recovery/cancel',mutating:true});
action('operation','Read retained agent action','Read the original agent request, response and uncertain-effect state by its saved request ID.',{requestId:uuid},['requestId']);
action('resume','Resume retained native action','Continue the exact original request. Completed replies replay locally; original idempotent native preparations reuse their retained identities. Uncertain non-idempotent writes require original state reconciliation.',
 {requestId:uuid},['requestId']);
action('reconcile','Reconcile original action result','Read the exact native item identified by the retained request and verify its intended state. No new operation is sent.',
 {requestId:uuid,id:text(100)},['requestId']);
action('capture','Capture complete original files','Retain selected full original SDK, handoff, customer, report or accounting files as one immutable receiving export.',
 {exportId:alias,files:{...arr(FILE_SELECTION,64),minItems:1}},['exportId','files']);
action('exports','List retained receiving exports','List complete immutable agent file exports.',{offset:integer(),limit:integer(1,200)});
action('manifest','Read complete export manifest','Read the complete immutable selected-file manifest and exact retained source binding.',{exportId:alias},['exportId']);
action('file','Read retained file bytes','Read the original exported file through the common retained-file reader. Continue with the same SHA256, readId and offset.',
 {exportId:alias,file:text(255),expectedManifestSha256:hash,expectedSha256:hash,readId:uuid,offset:integer(),limit:integer(1,196608)},['exportId','file','expectedManifestSha256']);
action('file_release','Release original file reader','Release the exact common retained-file descriptor after receiving or interruption.',{exportId:alias,readId:uuid},['exportId','readId']);
export const BUYER_AGENT_ACTIONS=Object.freeze(Object.fromEntries(defs.map(d=>[d.name,d])));
export function validate(schema,value,path='arguments'){
 if(schema.const!==undefined)need(value===schema.const,'INVALID_PARAMS',path+' has a different fixed value.');
 if(schema.enum)need(schema.enum.includes(value),'INVALID_PARAMS',path+' requires a declared value.');
 if(schema.type==='object'){
  need(plain(value),'INVALID_PARAMS',path+' must be an object.');
  const properties=schema.properties??{};
  need((schema.required??[]).every(k=>Object.hasOwn(value,k)),'INVALID_PARAMS',path+' is missing a required field.');
  if(schema.additionalProperties===false)need(Object.keys(value).every(k=>Object.hasOwn(properties,k)),'INVALID_PARAMS',path+' contains an undeclared field.');
  for(const [k,v]of Object.entries(value))if(properties[k])validate(properties[k],v,path+'.'+k);
 }else if(schema.type==='array'){
  need(Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??Number.MAX_SAFE_INTEGER),'INVALID_PARAMS',path+' has an invalid collection size.');
  value.forEach((v,i)=>validate(schema.items,v,path+'['+i+']'));
 }else if(schema.type==='string'){
  need(typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Number.MAX_SAFE_INTEGER)&&!value.includes('\0'),'INVALID_PARAMS',path+' must be valid text.');
  if(schema.pattern)need(new RegExp(schema.pattern).test(value),'INVALID_PARAMS',path+' has an invalid identifier or value.');
 }else if(schema.type==='integer')need(Number.isSafeInteger(value)&&value>=(schema.minimum??Number.MIN_SAFE_INTEGER)&&value<=(schema.maximum??Number.MAX_SAFE_INTEGER),'INVALID_PARAMS',path+' must be an integer in its declared range.');
 else if(schema.type==='boolean')need(typeof value==='boolean','INVALID_PARAMS',path+' must be boolean.');
}
export function buyerAgentArguments(name,input={}){
 name=name.startsWith(BUYER_AGENT_PREFIX)?name.slice(BUYER_AGENT_PREFIX.length):name;
 const definition=BUYER_AGENT_ACTIONS[name];need(definition,'TOOL_NOT_FOUND','Choose a declared Buyer workspace operation.');
 validate(definition.schema,input);return {definition,args:structuredClone(input)};
}
export function buyerRunbookWorkspaceTools(tool){
 return [tool(BUYER_AGENT_PREFIX+'workspaces','List configured original Buyer receiving workspaces.',{},[],{readOnly:true,idempotent:true}),
 ...defs.map(d=>tool(BUYER_AGENT_PREFIX+d.name,d.description,d.schema.properties,d.schema.required,
 {readOnly:!d.mutating&&!['capture','file','file_release','resume','reconcile'].includes(d.name),idempotent:!d.mutating||d.replay,openWorld:['execute','retrieve_file','finalize'].includes(d.name)}))];
}
