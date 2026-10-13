// SPDX-License-Identifier: MIT
import {GRAVITEE_WORKSPACE_ACTIONS} from '../../../products/gravitee-merchant/actions.mjs';
export const GRAVITEE_METHODS=Object.freeze({
 merchant_gravitee_status:'view',merchant_gravitee_records:'list',merchant_gravitee_record:'get',
 merchant_gravitee_object:'readObject',merchant_gravitee_source:'readSource',merchant_gravitee_draft:'readDraft',merchant_gravitee_capture_result:'readCapture',
 merchant_gravitee_save_connection:'saveConnection',merchant_gravitee_import_source:'importSource',merchant_gravitee_save_draft:'saveDraft',merchant_gravitee_capture:'capture',
 merchant_gravitee_prepare:'prepareOperation',merchant_gravitee_refresh_request:'refreshOperation',merchant_gravitee_execute:'executeOperation',merchant_gravitee_reconcile:'reconcileOperation',
 merchant_gravitee_commission:'commission',merchant_gravitee_probe:'probe',merchant_gravitee_note:'addNote',merchant_gravitee_handover:'exportHandover',
});
export const GRAVITEE_ALIAS=/^[a-z][a-z0-9_-]{0,79}$/,GRAVITEE_SHA=/^[a-f0-9]{64}$/,GRAVITEE_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const alias={type:'string',pattern:GRAVITEE_ALIAS.source},sha={type:'string',pattern:GRAVITEE_SHA.source},uuid={type:'string',pattern:GRAVITEE_UUID.source};
export function graviteeWorkspaceTools(tool){
 return [
  tool('merchant_gravitee_workspaces','List host-declared native Gravitee commissioning workspaces.',{},[],{readOnly:true,openWorld:false}),
  ...Object.entries(GRAVITEE_METHODS).map(([name,method])=>{
   const action=GRAVITEE_WORKSPACE_ACTIONS[method];return tool(name,action.description,{workspace:alias,...action.inputSchema.properties},['workspace',...action.inputSchema.required],
    {readOnly:!action.write,destructive:['executeOperation','commission'].includes(method),idempotent:true,openWorld:['capture','prepareOperation','refreshOperation','executeOperation','reconcileOperation','commission','probe'].includes(method)});
  }),
  tool('merchant_gravitee_download','Retain every byte of an original workspace object, provider response or handover as a complete host export.',
   {workspace:alias,reference:GRAVITEE_WORKSPACE_ACTIONS.readObject.inputSchema.properties.reference},['workspace','reference'],{readOnly:true,idempotent:true,openWorld:false}),
  tool('merchant_gravitee_export_manifest','Read the complete saved export manifest.',{exportId:sha},['exportId'],{readOnly:true,idempotent:true,openWorld:false}),
  tool('merchant_gravitee_export_file','Read the original file in complete SHA-bound ranges through EOF.',
   {exportId:sha,expectedSha256:sha,readId:uuid,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:65536}},
   ['exportId','expectedSha256'],{readOnly:true,idempotent:true,openWorld:false}),
  tool('merchant_gravitee_export_file_release','Release the original export reader.',{exportId:sha,readId:uuid},['exportId','readId'],{readOnly:true,idempotent:true,openWorld:false}),
 ];
}
