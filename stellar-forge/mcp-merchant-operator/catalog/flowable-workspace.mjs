// MIT. Original Flowable workspace actions and complete source-file delivery.
import { FLOWABLE_WORKSPACE_ACTIONS } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/actions.mjs';
export const FLOWABLE_AGENT_METHODS=Object.freeze({
  "merchant_flowable_status": "view",
  "merchant_flowable_programme": "readProgramme",
  "merchant_flowable_save_programme": "saveProgramme",
  "merchant_flowable_prepare_programme_step": "prepareProgrammeStep",
  "merchant_flowable_review_programme": "reviewProgramme",
  "merchant_flowable_records": "listRecords",
  "merchant_flowable_record": "getRecord",
  "merchant_flowable_portfolio": "readPortfolio",
  "merchant_flowable_definition": "readDefinition",
  "merchant_flowable_source": "readSource",
  "merchant_flowable_review": "readReview",
  "merchant_flowable_save_engine": "saveConnection",
  "merchant_flowable_capture": "capturePortfolio",
  "merchant_flowable_prepare_release": "prepareRelease",
  "merchant_flowable_dispatch_release": "dispatchRelease",
  "merchant_flowable_prepare_process": "prepareProcess",
  "merchant_flowable_dispatch_process": "dispatchProcess",
  "merchant_flowable_prepare_task": "prepareTask",
  "merchant_flowable_dispatch_task": "dispatchTask",
  "merchant_flowable_prepare_migration": "prepareMigration",
  "merchant_flowable_dispatch_migration": "dispatchMigration",
  "merchant_flowable_decision_portfolio": "readDecisionPortfolio",
  "merchant_flowable_decision_definition": "readDecisionDefinition",
  "merchant_flowable_decision_execution": "readDecisionExecution",
  "merchant_flowable_capture_decisions": "captureDecisionPortfolio",
  "merchant_flowable_prepare_decision_release": "prepareDecisionRelease",
  "merchant_flowable_dispatch_decision_release": "dispatchDecisionRelease",
  "merchant_flowable_prepare_decision_evaluation": "prepareDecisionEvaluation",
  "merchant_flowable_dispatch_decision_evaluation": "dispatchDecisionEvaluation",
  "merchant_flowable_case_portfolio": "readCasePortfolio",
  "merchant_flowable_case_definition": "readCaseDefinition",
  "merchant_flowable_case_instance": "readCaseInstance",
  "merchant_flowable_capture_cases": "captureCasePortfolio",
  "merchant_flowable_prepare_case_release": "prepareCaseRelease",
  "merchant_flowable_dispatch_case_release": "dispatchCaseRelease",
  "merchant_flowable_prepare_case_instance": "prepareCaseInstance",
  "merchant_flowable_dispatch_case_instance": "dispatchCaseInstance",
  "merchant_flowable_prepare_case_plan_item": "prepareCasePlanItem",
  "merchant_flowable_dispatch_case_plan_item": "dispatchCasePlanItem",
  "merchant_flowable_prepare_case_task": "prepareCaseTask",
  "merchant_flowable_dispatch_case_task": "dispatchCaseTask",
  "merchant_flowable_reconcile": "reconcileOperation",
  "merchant_flowable_export": "exportWorkspace",
  "merchant_flowable_adopt_delivery": "adoptDelivery"
});
export const FLOWABLE_ALIAS=/^[a-z][a-z0-9_-]{0,79}$/;
export const FLOWABLE_SHA=/^[a-f0-9]{64}$/;
export const FLOWABLE_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const alias={type:'string',pattern:FLOWABLE_ALIAS.source},sha={type:'string',pattern:FLOWABLE_SHA.source},uuid={type:'string',pattern:FLOWABLE_UUID.source};
const workspace={workspace:alias},id={type:'string',pattern:'^[a-f0-9]{24}$'};
export function flowableWorkspaceTools(tool){
  const declared=Object.entries(FLOWABLE_AGENT_METHODS).map(([name,method])=>{
    const action=FLOWABLE_WORKSPACE_ACTIONS[method];
    return tool(name,action.description,{...workspace,...action.inputSchema.properties},
      ['workspace',...action.inputSchema.required],
      {readOnly:!action.write,destructive:method.startsWith('dispatch'),idempotent:true,
        openWorld:method.startsWith('capture')||method.startsWith('prepare')||method.startsWith('dispatch')||method==='reconcileOperation'});
  });
  return [
    tool('merchant_flowable_workspaces','List original host-declared Flowable workspaces and handover files.',{},[],{readOnly:true,openWorld:false}),
    ...declared,
    tool('merchant_flowable_inspect_delivery','Upload and inspect one complete host-declared handover using its original file hash and request ID.',
      {...workspace,file:alias,requestId:uuid,label:{type:'string',maxLength:300}},['workspace','file','requestId'],
      {readOnly:false,idempotent:true,openWorld:false}),
    tool('merchant_flowable_download','Retain the complete original workspace handover or source blob as a downloadable agent export.',
      {...workspace,kind:{enum:['delivery','source']},id,reference:FLOWABLE_WORKSPACE_ACTIONS.readSource.inputSchema.properties.reference},
      ['workspace','kind'],{readOnly:true,idempotent:true,openWorld:false}),
    tool('merchant_flowable_export_manifest','Read the full manifest of one original retained agent export.',{exportId:sha},['exportId'],
      {readOnly:true,idempotent:true,openWorld:false}),
    tool('merchant_flowable_export_file','Read every original export byte in complete SHA-pinned ranges; retain readId until EOF or release.',
      {exportId:sha,file:{enum:['original','manifest']},expectedManifestSha256:sha,expectedSha256:sha,readId:uuid,
        offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:65536}},
      ['exportId','expectedManifestSha256','expectedSha256'],{readOnly:true,idempotent:true,openWorld:false}),
    tool('merchant_flowable_export_file_release','Release the original open export reader.',{exportId:sha,readId:uuid},['exportId','readId'],
      {readOnly:true,idempotent:true,openWorld:false}),
    tool('merchant_flowable_cancel_request','Stop this agent connection waiting on the original request ID; its saved native journal remains recoverable.',
      {...workspace,requestId:uuid},['workspace','requestId'],{readOnly:false,idempotent:true,openWorld:false}),
  ];
}
