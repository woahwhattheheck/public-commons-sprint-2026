// MIT. Shared action contract for Flowable's operator, installed SDK and agent tools.
export const FLOWABLE_WORKSPACE_SCHEMA='stellar-forge.flowable-workspace.v1';
export const FLOWABLE_MAX_JSON_BYTES=128*1024*1024;
/** Resolve only the original CMMN ownership fields from shared native collections. */
export function flowableCaseInstanceId(value){
  if(!value||typeof value!=='object')return undefined;
  if(value.scopeType!=null&&value.scopeType!==''&&value.scopeType!=='cmmn')return undefined;
  if(typeof value.caseInstanceId==='string'&&value.caseInstanceId.length)return value.caseInstanceId;
  if(value.scopeType==='cmmn'&&typeof value.scopeId==='string'&&value.scopeId.length)return value.scopeId;
  return undefined;
}
const text=maximum=>({type:'string',maxLength:maximum});
const id={type:'string',pattern:'^[a-f0-9]{24}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'};
const revision={type:'integer',minimum:1};
export const FLOWABLE_RECORD_KINDS=Object.freeze(['connection','portfolio','release','process','task','migration',
  'decisionPortfolio','decisionRelease','decisionEvaluation','casePortfolio','caseRelease','caseInstance','casePlanItem','caseTask','programme','delivery','receiving']);
export const FLOWABLE_OPERATION_KINDS=Object.freeze(['release','process','task','migration','decisionRelease','decisionEvaluation',
  'caseRelease','caseInstance','casePlanItem','caseTask']);
const kind={enum:FLOWABLE_RECORD_KINDS};
const operationKind={enum:FLOWABLE_OPERATION_KINDS};
const reference={type:'object',properties:{sha256:sha,bytes:{type:'integer',minimum:0},mediaType:text(200)},
  required:['sha256','bytes'],additionalProperties:false};
const paging={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:500}};
const connection={type:'object',properties:{
  schema:{enum:['stellar-forge.flowable-connection.v1']},id:text(128),label:text(300),
  baseUrl:text(4000),usernameEnv:{type:'string',pattern:'^[A-Za-z_][A-Za-z0-9_]*$'},
  passwordEnv:{type:'string',pattern:'^[A-Za-z_][A-Za-z0-9_]*$'},
},required:['id','baseUrl','usernameEnv','passwordEnv'],additionalProperties:false};
const preparation={connectionId:id,label:text(300),note:text(20000),selection:{type:'object'}};
const dispatch={id,expectedRevision:revision,planSha256:sha};
function action(title,description,write,properties,required=[]){
  return Object.freeze({title,description,write,inputSchema:{type:'object',
    properties:{...(write?{requestId:uuid}:{}),...properties},
    required:[...(write?['requestId']:[]),...required],additionalProperties:false}});
}
export const FLOWABLE_WORKSPACE_ACTIONS=Object.freeze({
  view:action('Workspace','Read saved engine connections, credential availability and record counts.',false,{}),
  listRecords:action('Saved records','Page the current saved record heads using the original list snapshot.',false,
    {kind,...paging,snapshot:sha}),
  getRecord:action('Saved operation','Read an exact saved revision, native request, response and current receiving result.',false,
    {kind,id,revision,...paging},['kind','id']),
  readPortfolio:action('Portfolio','Page one captured native collection and its complete original source references.',false,
    {id,revision,collection:text(100),...paging},['id','collection']),
  readDefinition:action('Process definition','Read the original captured BPMN resource and its definition identity.',false,
    {portfolioId:id,revision,definitionId:text(2000)},['portfolioId','definitionId']),
  readDecisionPortfolio:action('Decision portfolio','Page one complete captured native decision collection with its original response references.',false,
    {id,revision,collection:text(100),...paging},['id','collection']),
  readDecisionDefinition:action('Decision definition','Read the exact captured native decision definition and complete original DMN deployment resources.',false,
    {portfolioId:id,revision,definitionId:text(2000)},['portfolioId','definitionId']),
  readDecisionExecution:action('Decision execution','Read a captured native decision execution and its complete original audit data.',false,
    {portfolioId:id,revision,executionId:text(2000)},['portfolioId','executionId']),
  readSource:action('Original source','Read a complete saved source or native response by its immutable reference.',false,
    {reference},['reference']),
  readReview:action('Operation review','Read the saved request, native preimage, validation and complete response references.',false,
    {kind:operationKind,id,revision},['kind','id']),
  readProgramme:action('Commissioning programme','Read the complete saved programme, native step outcomes, sources and review history.',false,
    {id,revision},['id']),
  saveProgramme:action('Receive programme','Retain a complete commissioning plan and original sources against the selected native REST connection.',true,
    {connectionId:id,programmeText:text(16*1024*1024)},['connectionId','programmeText']),
  prepareProgrammeStep:action('Prepare programme step','Resolve native identifiers from confirmed original steps and prepare this exact saved operation.',true,
    {id,expectedRevision:revision,stepKey:text(120),renew:{type:'boolean'}},['id','expectedRevision','stepKey']),
  reviewProgramme:action('Review commissioning','Retain the operator decision against the complete current programme and native outcome edition.',true,
    {id,expectedRevision:revision,basisSha256:sha,decision:{enum:['accepted','changes-requested']},reviewer:text(300),note:text(20000)},
    ['id','expectedRevision','basisSha256','decision','reviewer','note']),
  saveConnection:action('Save engine','Save the engine URL and names of its credential environment variables.',true,
    {id,expectedRevision:{type:'integer',minimum:0},connection},['connection']),
  capturePortfolio:action('Refresh portfolio','Capture complete native definitions, deployments, active work and history with original source resources.',true,
    {connectionId:id,label:text(300)},['connectionId']),
  captureDecisionPortfolio:action('Refresh decisions','Capture native DMN deployments, definitions, complete execution history and original decision resources.',true,
    {connectionId:id,label:text(300)},['connectionId']),
  prepareDecisionRelease:action('Prepare decision release','Retain the original DMN resource and native deployment preimage for review.',true,
    preparation,['connectionId','selection']),
  dispatchDecisionRelease:action('Deploy reviewed decisions','Submit the saved native DMN deployment and receive its exact definitions and resources.',true,
    dispatch,['id','expectedRevision','planSha256']),
  prepareDecisionEvaluation:action('Prepare decision evaluation','Retain the complete native evaluation body and current decision definition selected by the engine.',true,
    preparation,['connectionId','selection']),
  dispatchDecisionEvaluation:action('Evaluate reviewed decisions','Submit the saved native DMN evaluation once and retain its complete result and available audit history.',true,
    dispatch,['id','expectedRevision','planSha256']),
  readCasePortfolio:action('Case portfolio','Page the captured native case definitions, work, milestones and history with their original source references.',false,
    {id,revision,collection:text(100),...paging},['id','collection']),
  readCaseDefinition:action('Case definition','Read the exact captured case definition and complete original CMMN deployment resources.',false,
    {portfolioId:id,revision,definitionId:text(2000)},['portfolioId','definitionId']),
  readCaseInstance:action('Case and work','Read one captured native case with its related work, milestones, variables and history.',false,
    {portfolioId:id,revision,caseInstanceId:text(2000)},['portfolioId','caseInstanceId']),
  captureCasePortfolio:action('Refresh cases','Capture complete native CMMN definitions, active cases, plan items, human work, milestones and history.',true,
    {connectionId:id,label:text(300)},['connectionId']),
  prepareCaseRelease:action('Prepare case release','Retain the complete original CMMN deployment and current native definition versions for review.',true,
    preparation,['connectionId','selection']),
  dispatchCaseRelease:action('Deploy reviewed case release','Submit the saved native CMMN deployment once and receive its original case definitions and resources.',true,
    dispatch,['id','expectedRevision','planSha256']),
  prepareCaseInstance:action('Prepare case action','Retain the exact native case start or lifecycle request and its current source and case state.',true,
    preparation,['connectionId','selection']),
  dispatchCaseInstance:action('Execute reviewed case action','Submit the saved native case request once and read the resulting case, work and history.',true,
    dispatch,['id','expectedRevision','planSha256']),
  prepareCasePlanItem:action('Prepare case work','Retain the selected native plan item or stage, its current state and complete requested action.',true,
    preparation,['connectionId','selection']),
  dispatchCasePlanItem:action('Execute reviewed case work','Submit the saved native plan-item or stage action once and read its resulting state and history.',true,
    dispatch,['id','expectedRevision','planSha256']),
  prepareCaseTask:action('Prepare case task action','Retain the native case task and complete claim, delegation, resolution or completion request.',true,
    preparation,['connectionId','selection']),
  dispatchCaseTask:action('Execute reviewed case task','Submit the saved native case human-task request once and retain its current and historic result.',true,
    dispatch,['id','expectedRevision','planSha256']),
  prepareRelease:action('Prepare release','Retain the exact original BPMN deployment request and current engine preimage for review.',true,
    preparation,['connectionId','selection']),
  dispatchRelease:action('Deploy reviewed release','Submit the saved deployment once and receive its native definitions and original resources.',true,
    dispatch,['id','expectedRevision','planSha256']),
  prepareProcess:action('Prepare process','Retain the selected definition, native variables and business identity before starting a process.',true,
    preparation,['connectionId','selection']),
  dispatchProcess:action('Start reviewed process','Start the saved native process request once and receive its current tasks and history.',true,
    dispatch,['id','expectedRevision','planSha256']),
  prepareTask:action('Prepare task action','Read the current native task and retain its complete claim, assignment or completion request.',true,
    preparation,['connectionId','selection']),
  dispatchTask:action('Execute reviewed task','Submit the saved human task request once and read its native current and historic state.',true,
    dispatch,['id','expectedRevision','planSha256']),
  prepareMigration:action('Validate migration','Retain the original migration document and run Flowable native migration validation for the selected process.',true,
    preparation,['connectionId','selection']),
  dispatchMigration:action('Migrate reviewed process','Submit the saved, natively validated migration once and receive the target definition and work state.',true,
    dispatch,['id','expectedRevision','planSha256']),
  reconcileOperation:action('Refresh saved operation','Read the original native request outcome from its retained response and current or historic engine state.',true,
    {kind:operationKind,id,expectedRevision:revision},['kind','id']),
  exportWorkspace:action('Export handover','Export complete saved record revisions, native requests, source resources and journals.',true,
    {label:text(300)}),
  inspectDelivery:action('Inspect handover','Inspect and retain a complete local NDJSON workspace archive.',true,
    {path:text(4000),label:text(300)},['path']),
  adoptDelivery:action('Receive handover','Adopt the original complete source and saved history into this workspace.',true,
    {id,expectedRevision:revision,manifestSha256:sha},['id','expectedRevision','manifestSha256']),
});
export const FLOWABLE_RECORD_STATES=Object.freeze([
  'SAVED','CAPTURING','CAPTURED','COMPLETED','PREPARING','PREPARED','INVALID','DISPATCHED','READBACK',
  'CONFIRMED','ACCEPTED','OBSERVED','REJECTED','UNKNOWN','STALE','PREPARE_FAILED','INTERRUPTED',
  'EXPORTED','INSPECTED','ADOPTING','ADOPTED','IN_PROGRESS',
]);
export function validateFlowableAction(method,args){
  const contract=FLOWABLE_WORKSPACE_ACTIONS[method];
  const invalid=message=>{throw Object.assign(new Error(message),{code:'FLOWABLE_ACTION_INPUT_INVALID',status:400});};
  if(!contract||!args||typeof args!=='object'||Array.isArray(args))invalid('Select a declared workspace action.');
  const check=(value,schema,path)=>{
    if(schema.enum&&!schema.enum.includes(value))invalid(path+' has an unsupported value.');
    if(schema.type==='object'){
      if(!value||typeof value!=='object'||Array.isArray(value))invalid(path+' must be an object.');
      for(const key of schema.required??[])if(!Object.hasOwn(value,key))invalid(path+'.'+key+' is required.');
      for(const[key,part]of Object.entries(value)){
        if(schema.additionalProperties===false&&!Object.hasOwn(schema.properties??{},key))invalid(path+'.'+key+' is not declared.');
        if(schema.properties?.[key])check(part,schema.properties[key],path+'.'+key);
      }
    }else if(schema.type==='string'){
      if(typeof value!=='string'||schema.maxLength!==undefined&&value.length>schema.maxLength||
        schema.pattern&&!(new RegExp(schema.pattern)).test(value))invalid(path+' must be valid text.');
    }else if(schema.type==='integer'){
      if(!Number.isSafeInteger(value)||schema.minimum!==undefined&&value<schema.minimum||
        schema.maximum!==undefined&&value>schema.maximum)invalid(path+' is outside its range.');
    }else if(schema.type==='boolean'&&typeof value!=='boolean')invalid(path+' must be true or false.');
    else if(schema.type==='array'){
      if(!Array.isArray(value)||schema.minItems!==undefined&&value.length<schema.minItems||
        schema.uniqueItems&&new Set(value.map(item=>JSON.stringify(item))).size!==value.length)invalid(path+' must be a valid selection.');
      value.forEach((item,index)=>check(item,schema.items,path+'['+index+']'));
    }
  };
  check(args,contract.inputSchema,method);return contract;
}
