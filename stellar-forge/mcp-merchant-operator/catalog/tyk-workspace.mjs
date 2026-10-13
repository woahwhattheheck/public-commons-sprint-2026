// MIT. Original Tyk workspace actions and complete source-file delivery.
import { TYK_WORKSPACE_ACTIONS } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/workspace/actions.mjs';
export const TYK_AGENT_METHODS=Object.freeze({
  merchant_tyk_status:'view',merchant_tyk_records:'listRecords',merchant_tyk_record:'getRecord',
  merchant_tyk_definition:'readDefinition',merchant_tyk_source:'readSource',merchant_tyk_adapt_definition:'adaptDefinition',merchant_tyk_review:'readReview',
  merchant_tyk_save_target:'saveConnection',merchant_tyk_capture:'capture',merchant_tyk_import_capture:'importCapture',
  merchant_tyk_save_cohort:'createCohort',merchant_tyk_prepare:'prepareRollout',merchant_tyk_dispatch:'dispatchRollout',
  merchant_tyk_create_commissioning:'createCommissioning',merchant_tyk_commissioning:'readCommissioning',
  merchant_tyk_prepare_commissioning_step:'prepareCommissioningStep',
  merchant_tyk_record_commissioning_review:'recordCommissioningReview',
  merchant_tyk_refresh_commissioning:'refreshCommissioning',
  merchant_tyk_reconcile:'reconcileRollout',merchant_tyk_export:'exportWorkspace',merchant_tyk_adopt_delivery:'adoptDelivery',
});
export const TYK_ALIAS=/^[a-z][a-z0-9_-]{0,79}$/;
export const TYK_SHA=/^[a-f0-9]{64}$/;
export const TYK_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const alias={type:'string',pattern:TYK_ALIAS.source},sha={type:'string',pattern:TYK_SHA.source},uuid={type:'string',pattern:TYK_UUID.source};
const workspace={workspace:alias},id={type:'string',pattern:'^[a-f0-9]{24}$'};
export function tykWorkspaceTools(tool){
  const declared=Object.entries(TYK_AGENT_METHODS).map(([name,method])=>{
    const action=TYK_WORKSPACE_ACTIONS[method];
    return tool(name,action.description,{...workspace,...action.inputSchema.properties},
      ['workspace',...action.inputSchema.required],
      {readOnly:!action.write,destructive:method==='dispatchRollout',idempotent:true,
        openWorld:['capture','prepareRollout','dispatchRollout','reconcileRollout','prepareCommissioningStep','refreshCommissioning'].includes(method)});
  });
  return [
    tool('merchant_tyk_workspaces','List original host-declared Tyk workspaces and handover files.',{},[],{readOnly:true,openWorld:false}),
    ...declared,
    tool('merchant_tyk_inspect_delivery','Upload and inspect one complete host-declared handover using its original file hash and request ID.',
      {...workspace,file:alias,requestId:uuid,label:{type:'string',maxLength:300}},['workspace','file','requestId'],
      {readOnly:false,idempotent:true,openWorld:false}),
    tool('merchant_tyk_download','Retain the complete original workspace handover or source blob as a downloadable agent export.',
      {...workspace,kind:{enum:['delivery','source']},id,reference:TYK_WORKSPACE_ACTIONS.readSource.inputSchema.properties.reference},
      ['workspace','kind'],{readOnly:true,idempotent:true,openWorld:false}),
    tool('merchant_tyk_export_manifest','Read the full manifest of one original retained agent export.',{exportId:sha},['exportId'],
      {readOnly:true,idempotent:true,openWorld:false}),
    tool('merchant_tyk_export_file','Read every original export byte in complete SHA-pinned ranges; retain readId until EOF or release.',
      {exportId:sha,file:{enum:['original','manifest']},expectedManifestSha256:sha,expectedSha256:sha,readId:uuid,
        offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:65536}},
      ['exportId','expectedManifestSha256','expectedSha256'],{readOnly:true,idempotent:true,openWorld:false}),
    tool('merchant_tyk_export_file_release','Release the original open export reader.',{exportId:sha,readId:uuid},['exportId','readId'],
      {readOnly:true,idempotent:true,openWorld:false}),
    tool('merchant_tyk_cancel_request','Stop this agent connection waiting on the original request ID; its saved native journal remains recoverable.',
      {...workspace,requestId:uuid},['workspace','requestId'],{readOnly:false,idempotent:true,openWorld:false}),
  ];
}
