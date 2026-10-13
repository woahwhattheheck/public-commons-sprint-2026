// MIT. Reviewed recurring World Bank work on the original Console workflow engine.
import { WORKFLOW_RECIPE_SCHEMA, sealWorkflowRecipe } from './workflow-recipes.mjs';
import { WORLDBANK_ALIAS, WORLDBANK_NAME, WORLDBANK_ID, plain, worldBankNeed as need } from '../worldbank-programme-contracts.mjs';
export const WORLDBANK_PROGRAMME_WORKFLOW_TOOLS=Object.freeze([
  'merchant_worldbank_programme_prepare','merchant_worldbank_programme_wait',
  'merchant_worldbank_programme_publish','merchant_worldbank_programme_export']);
const clone=value=>JSON.parse(JSON.stringify(value));
const binding=(target,from,pointer,stepId)=>({target,from,pointer,...(stepId?{stepId}:{})});
const input=(key,value,label,type=typeof value)=>({pointer:'/'+key,label,type,required:true,default:clone(value)});
function step(definitions,id,name,tool,args,bindings,expect=[],pauseAfter=false){
  return {id,name,tool,definition:definitions.get(tool),arguments:clone(args),bindings,expect,pauseAfter};
}
/** Every period supplies its actual newly approved source and original operation ID. */
export function createWorldBankProgrammeRecipe({definitions,workspace,programme,operationId,programmeRevision,
  source,reviewNote,columns={},name='Recurring World Bank customer delivery'}={}){
  need(typeof workspace==='string'&&WORLDBANK_ALIAS.test(workspace)&&typeof programme==='string'&&WORLDBANK_NAME.test(programme)&&typeof operationId==='string'&&WORLDBANK_ID.test(operationId)&&
    Number.isSafeInteger(programmeRevision)&&programmeRevision>0&&plain(source)&&
    typeof source.name==='string'&&WORLDBANK_NAME.test(source.name)&&Number.isSafeInteger(source.revision)&&source.revision>0&&
    typeof reviewNote==='string'&&reviewNote.trim()&&reviewNote.length<=8000&&plain(columns),
    'Supply the actual original programme/source edition, stable period operation ID, review note and explicit mapping choices.');
  need(Array.isArray(definitions),'Read the complete actual host tool definitions before preparing this workflow.');
  const byName=new Map(definitions.map(value=>[value.name,value])),originals=new Map();
  for(const tool of WORLDBANK_PROGRAMME_WORKFLOW_TOOLS){
    const definition=byName.get(tool);need(plain(definition?.inputSchema),'The original host does not advertise '+tool+'.');
    originals.set(tool,clone(definition));
  }
  const [prepare,wait,publish,exportTool]=WORLDBANK_PROGRAMME_WORKFLOW_TOOLS;
  const common=[binding('/workspace','inputs','/workspace'),binding('/programme','inputs','/programme')];
  const prepareRequest={id:operationId,expected_revision:programmeRevision,source:clone(source),resume:false};
  const publishRequest={id:operationId,review_sha256:'0'.repeat(64),note:reviewNote,columns:clone(columns),resume:false};
  const steps=[
    step(originals,'prepare','Prepare the original source comparison',prepare,{workspace,programme,request:prepareRequest},
      [...common,binding('/request/id','inputs','/operationId'),binding('/request/expected_revision','inputs','/programmeRevision'),
       binding('/request/source','inputs','/source')],[{pointer:'/operation/status',oneOf:['RUNNING','REVIEW_READY']}]),
    step(originals,'review','Receive and review the complete comparison',wait,{workspace,programme,operationId,timeoutMs:120000,pollMs:500},
      [...common,binding('/operationId','inputs','/operationId')],
      [{pointer:'/operation/status',equals:'REVIEW_READY'}],true),
    step(originals,'publish','Publish the reviewed customer report and workbook',publish,{workspace,programme,request:publishRequest,awaitCompletion:true,timeoutMs:120000,pollMs:500},
      [...common,binding('/request/id','inputs','/operationId'),binding('/request/review_sha256','step','/operation/review/review_sha256','review'),
       binding('/request/note','inputs','/reviewNote'),binding('/request/columns','inputs','/columns')],
      [{pointer:'/operation/status',equals:'COMPLETE'}]),
    step(originals,'export','Retain every original customer file',exportTool,{workspace,programme,operationId,expectedResultSha256:'0'.repeat(64)},
      [...common,binding('/operationId','inputs','/operationId'),binding('/expectedResultSha256','step','/resultSha256','publish')],
      [{pointer:'/state',equals:'EXPORTED'}])
  ];
  return sealWorkflowRecipe({schema:WORKFLOW_RECIPE_SCHEMA,name,
    description:'Prepare the approved source, pause for complete operator review, continue the same report/workbook and retain every original customer file. The existing series owns dates and period runs.',
    source:null,inputs:[
      input('workspace',workspace,'Original Analysis workspace'),input('programme',programme,'Original customer programme'),
      input('operationId',operationId,'Stable native period operation ID'),input('programmeRevision',programmeRevision,'Reviewed programme revision','integer'),
      input('source',source,'Complete approved source revision','object'),input('reviewNote',reviewNote,'Explicit source-selection note'),
      input('columns',columns,'Complete worksheet choices when required','object')
    ],steps});
}
export async function prepareWorldBankProgrammeWorkflow(client,{installationId,profileId,...input}){
  const definitions=await Promise.all(WORLDBANK_PROGRAMME_WORKFLOW_TOOLS.map(async tool=>(await client.console.json('tool/'+tool)).definition));
  const recipe=createWorldBankProgrammeRecipe({...input,definitions});
  return client.console.prepare({id:installationId,profileId,recipe});
}

/** Prepare an explicit original Console recovery draft. This performs reads only.
 * Save/dispatch it with the original draft_save/call_start controls, retain their
 * stable IDs, then resolve the waiting publish step with its completed call.
 */
export async function prepareWorldBankProgrammeRecovery(client,{runId,expectedRevision,draftId,columns}={}){
  const c=client.console??client,{run}=await c.run(runId);
  need(run.revision===expectedRevision&&!run.active&&['WAITING','PAUSED'].includes(run.state),
    'Reopen this exact inactive original period before preparing its native recovery.');
  const unfinished=run.steps.find(v=>!['COMPLETE','RECOVERED'].includes(v.state));
  need(unfinished?.id==='publish'&&typeof draftId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(draftId),
    'Select the original unfinished publish step and a stable recovery draft ID.');
  const call=await c.json('call/'+encodeURIComponent(unfinished.callId));
  need(call.profileId===run.profileId&&call.tool==='merchant_worldbank_programme_publish',
    'Recover the original programme publication call.');
  const args=JSON.parse(call.argumentsJson);
  need(args.awaitCompletion===true&&plain(args.request),'Keep the original bounded publish-and-receive request.');
  if(columns!==undefined){need(plain(columns),'Select the complete reviewed worksheet column choices.');args.request.columns=clone(columns);}
  args.request.resume=true;
  return {schema:'stellar-forge.worldbank-programme-recovery.v1',runId,stepId:unfinished.id,
    sourceRunRevision:run.revision,originalCallId:call.id,
    draft:{id:draftId,profileId:run.profileId,name:'Continue the original World Bank publication',
      tool:call.tool,arguments:args,recoveryOf:call.id},
    resolution:{id:run.id,stepId:unfinished.id},
    instruction:'Save this complete draft once, retain its accepted revision, and start it with one stable call ID. Only a COMPLETE native operation satisfies this same step; then use the current run revision and completed recovery call with workflow-resolve, followed by workflow-resume.'};
}
