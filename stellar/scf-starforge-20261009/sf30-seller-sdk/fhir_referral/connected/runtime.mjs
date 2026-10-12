// MIT. Gravity operations composed with the original complete Merchant workspace runtime.
import {createMerchantWorkspaceRuntime,eltssNativeRoute,eltssUploadRoute} from '../../fhir_eltss/connected/runtime.mjs';
import {GravityReferralConnection} from './connection.mjs';
import {gravityReferralMerchantTools,gravityReferralBodyRoutes,gravityReferralInputSchemas,gravityReferralNativeContract,
  validateGravityReferralArguments,nativeInputActions} from './catalog.mjs';
import {EXPORT_SCHEMA,RESULT_SCHEMA,MANIFEST_NAME,parseGravityReferralExport} from './contracts.mjs';
export {gravityReferralMerchantTools} from './catalog.mjs';
function originalFilename(member,fallback){
  const name=typeof member==='string'?member.split('/').at(-1):'';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(name)&&
    !['original-request.json','original-response.json','original-input.json','original-artifact.json','eltss-manifest.json','gravity-referral-manifest.json'].includes(name)
    ?name:fallback;
}
const p=value=>encodeURIComponent(value),path=(...parts)=>'/api/referrals/'+parts.map(p).join('/');
const query=(target,values)=>{
  const params=new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
  return target+(params.size?'?'+params:'');
};
export function gravityReferralNativeRoute(action,args){
  const direct={referral_catalogue:'catalogue',referral_state:'state',referral_profile:'profile',referral_guidance:'guidance'};
  if(direct[action])return {method:'GET',target:path(direct[action])};
  const selected=gravityReferralBodyRoutes.find(row=>row.action===action);
  if(selected)return {method:'POST',target:path(...selected.path.split('/')),input:args[selected.key]};
  if(action==='referral_records')return {method:'GET',target:query(path('records',args.collection),
    {offset:args.offset,limit:args.limit,query:args.query})};
  if(action==='referral_record')return {method:'GET',target:path('records',args.collection,args.recordId)};
  const assessment=action.match(/^referral_assessment_(tasks|findings|cells|decisions)$/);
  if(assessment)return {method:'GET',target:query(path('assessments',args.assessmentId,assessment[1]),
    {offset:args.offset,limit:args.limit,query:args.query,taskId:args.taskId})};
  if(action==='referral_edition_changes')return {method:'GET',
    target:query(path('edition-comparisons',args.comparisonId,'changes'),{offset:args.offset,limit:args.limit})};
  if(action==='referral_exchange_advance')return {method:'POST',
    target:path('exchange-requests',args.requestId,'advance'),input:{operationId:args.operationId}};
  if(action==='referral_exchange_operation')return {method:'GET',target:path('exchange-operations',args.operationId)};
  const files={
    referral_guidance_packet:{target:path('guidance','packet'),kind:'referral-guidance-packet',filename:'Gravity_Original_Guidance.json'},
    referral_guidance_file:{target:query(path('guidance','file'),{name:args.member}),kind:'referral-guidance-file',filename:originalFilename(args.member,'Gravity_Original_Guidance_Member.txt')},
    referral_assessment_file:{target:path('assessments',args.assessmentId,'file'),kind:'referral-assessment-file',filename:'Gravity_Complete_Assessment.json'},
    referral_edition_changes_file:{target:path('edition-comparisons',args.comparisonId,'file'),kind:'referral-edition-changes-file',filename:'Gravity_Complete_Edition_Changes.json'},
    referral_exchange_operation_file:{target:path('exchange-operations',args.operationId,'file'),kind:'referral-exchange-operation-file',filename:'Gravity_Original_Exchange_Operation.json'},
    referral_exchange_operation_packet:{target:path('exchange-operations',args.operationId,'packet'),kind:'referral-exchange-operation-packet',filename:'Gravity_Original_Exchange.zip'},
    referral_handoff_packet:{target:path('handoffs',args.handoffId,'packet'),kind:'referral-handoff-packet',filename:'Gravity_Complete_Referral_Handoff.zip'},
    referral_workspace_packet:{target:path('workspace','packet'),kind:'workspace-packet',filename:'Gravity_Complete_Editable_Workspace.zip'}
  };
  if(files[action])return {method:'GET',...files[action]};
  return eltssNativeRoute(action,args);
}
export function gravityReferralUploadRoute(kind,args,upload,options){
  if(kind==='workspace')return {target:path('workspace','packet'),adoptWorkspace:true};
  if(kind==='referral-handoff')return {target:path('handoffs','receive'),adoptWorkspace:true};
  if(kind==='published-examples'){
    const v=args.selection;
    return {target:path('published-examples'),headers:{
      'x-source-label':encodeURIComponent(v.label),'x-actor':encodeURIComponent(v.actor),
      'x-source-note':encodeURIComponent(v.note??''),'x-publication-url':encodeURIComponent(v.publicationUrl),
      'x-reference-base':encodeURIComponent(v.referenceBase)
    }};
  }
  return eltssUploadRoute(kind,args,upload,options);
}
export const MerchantGravityReferral=createMerchantWorkspaceRuntime({
  Connection:GravityReferralConnection,tools:gravityReferralMerchantTools,
  validateArguments:validateGravityReferralArguments,inputActions:nativeInputActions,
  routeFor:gravityReferralNativeRoute,uploadRoute:gravityReferralUploadRoute,
  configKey:'gravityReferrals',exportNamespace:'gravity-referrals',
  exportSchema:EXPORT_SCHEMA,resultSchema:RESULT_SCHEMA,manifestName:MANIFEST_NAME,
  parseExport:parseGravityReferralExport,errorPrefix:'GRAVITY_REFERRAL',
  apiSchema:'stellar-forge.gravity-referral-merchant-api.v1',
  importActions:{source_import:'source',packet_import:'packet',workspace_import:'workspace',
    handoff_import:'handoff',artifact_import:'artifact',referral_workspace_import:'workspace',
    referral_handoff_import:'referral-handoff',referral_published_examples_import:'published-examples'},
  receivingKinds:{source:'source-packet',packet:'dataset-packet',workspace:'workspace-packet',
    handoff:'handoff-packet',artifact:'artifact-file','referral-handoff':'referral-handoff-packet'},
  schemaMetadata:{nativeReferral:'stellar-forge.gravity-referral.v1',native:gravityReferralNativeContract,
    referralInputSchemas:gravityReferralInputSchemas,inheritedActionCount:77,
    originalRequirements:57,originalFieldReviews:24,
    recovery:'Advance the original saved exchange request with its original operationId. Native receiving reconciles the request hash, exact preimage, selected ETag and original GET readback before any repeat PUT. Whole workspace and Gravity handoff imports reconcile the outer archive in state.referral.receives and preserve the original UUID.',
    sourceSemantics:'Task.for may identify Patient, RelatedPerson or Group; ServiceRequest.subject may identify Patient, Group or Location. Original status, statusReason, businessStatus and actual outcome resources retain separate meanings. Endpoint capabilities and reviewed source/role decisions remain native.'}
});
