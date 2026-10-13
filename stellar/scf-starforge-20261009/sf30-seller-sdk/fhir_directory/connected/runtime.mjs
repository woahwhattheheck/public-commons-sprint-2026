// MIT. Native directory routes use the maintained complete Merchant workspace runtime.
import {createMerchantWorkspaceRuntime} from '../../fhir_eltss/connected/runtime.mjs';
import {gravityReferralNativeRoute,gravityReferralUploadRoute} from '../../fhir_referral/connected/runtime.mjs';
import {HumanServicesDirectoryConnection} from './connection.mjs';
import {humanServicesDirectoryMerchantTools,directoryBodyRoutes,directoryNativeContract,directorySourceContract,directoryConformanceContract,directoryOperatingPlansContract,directoryOperatingReturnsContract,directoryCorrectionsContract,directoryCorrectionWorksheetsContract,directoryWorksheetReconciliationContract,
  validateHumanServicesDirectoryArguments,nativeInputActions,directoryForeignKeyQueries} from './catalog.mjs';
import {EXPORT_SCHEMA,RESULT_SCHEMA,MANIFEST_NAME,parseHumanServicesDirectoryExport,checked,SHA} from './contracts.mjs';
export {humanServicesDirectoryMerchantTools} from './catalog.mjs';
const part=value=>encodeURIComponent(value),path=(...parts)=>'/api/directory/'+parts.map(part).join('/');
function query(target,values){
  const params=new URLSearchParams(Object.entries(values).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]));
  return target+(params.size?'?'+params:'');
}
function filename(member,fallback){
  const value=typeof member==='string'?member.split('/').at(-1):'';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(value)&&
    !['original-request.json','original-response.json','original-input.json','original-artifact.json',MANIFEST_NAME].includes(value)?
    value:fallback;
}
export function humanServicesDirectoryNativeRoute(action,args){
  if(action==='directory_correction_worksheet_reconciliation_catalogue')return {method:'GET',target:path('correction-worksheet-reconciliations','catalogue')};
  if(action==='directory_correction_worksheet_reconciliation_rows')return {method:'GET',
    target:query(path(args.collection,args.recordId,'rows'),{offset:args.offset,limit:args.limit,rowKey:args.rowKey,state:args.state})};
  if(action==='directory_correction_worksheet_reconciliation_file')return {method:'GET',
    target:path(args.collection,args.recordId,'files',args.fileKind),kind:'directory-export-file',
    filename:'Directory_Three_Way_Review_'+args.recordId+'_'+args.fileKind+(args.fileKind==='input'?'.json':'.jsonl')};

  if(action==='directory_correction_worksheet_rows')return {method:'GET',
    target:query(path(args.collection,args.recordId,'rows'),{offset:args.offset,limit:args.limit,rowKey:args.rowKey,state:args.state})};
  if(action==='directory_correction_worksheet_document')return {method:'GET',
    target:path('correctionWorksheets',args.worksheetId,'document')};
  if(action==='directory_correction_worksheet_file')return {method:'GET',
    target:path(args.collection,args.recordId,'files',args.fileKind),kind:'directory-export-file',
    filename:'Directory_Worksheet_'+args.recordId+'_'+args.fileKind+
      (['rows','changes','decisions'].includes(args.fileKind)?'.jsonl':'.json')};

  if(action==='directory_correction_rows')return {method:'GET',
    target:query(path(args.collection,args.recordId,'rows'),{offset:args.offset,limit:args.limit})};
  if(action==='directory_correction_file')return {method:'GET',
    target:path(args.collection,args.recordId,'files',args.fileKind),kind:'directory-export-file',
    filename:'Directory_Correction_'+args.recordId+'_'+args.fileKind+(args.fileKind==='changes'?'.jsonl':'.json')};
  if(action==='directory_state')return {method:'GET',target:'/api/state'};
  for(const kind of ['review','comparison','input'])if(action==='directory_operating_return_'+kind)
    return {method:'GET',target:path('operatingPlanReturns',args.recordId,kind)};
  if(action==='directory_operating_return_rows')return {method:'GET',
    target:query(path('operatingPlanReturns',args.recordId,'rows'),{
      offset:args.offset,limit:args.limit,kind:args.kind,conflict:args.conflict,unresolved:args.unresolved})};
  if(action==='directory_operating_return_file')return {method:'GET',
    target:path('operatingPlanReturns',args.recordId,'files',args.fileKind),kind:'directory-export-file',
    filename:'Operating_Return_'+args.fileKind+'_'+args.recordId+'.json'};
  if(action==='directory_operating_catalog')return {method:'GET',target:path('operating-plans','catalog')};
  for(const kind of ['document','draft','input','basis'])if(action==='directory_operating_'+kind)
    return {method:'GET',target:query(path('operatingPlans',args.recordId,kind),kind==='draft'?{revision:args.revision}:{})};
  const direct={directory_catalogue:'catalogue',directory_guidance:'guidance'};
  if(direct[action])return {method:'GET',target:path(direct[action])};
  const selected=directoryBodyRoutes.find(row=>row.action===action);
  if(selected)return {method:'POST',target:selected.target,input:args[selected.key]};
  if(action==='directory_records')return {method:'GET',target:query(path(args.collection),{
    offset:args.offset,limit:args.limit,query:args.query})};
  if(action==='directory_record')return {method:'GET',target:path(args.collection,args.recordId)};
  if(action==='directory_operation')return {method:'GET',target:path('operations',args.operationId)};
  if(['directory_advance','directory_pause','directory_resume'].includes(action))
    return {method:'POST',target:path('operations',args.operationId,action.slice('directory_'.length)),input:{}};
  if(action==='directory_source_rows')return {method:'GET',target:query(path('sources',args.sourceId,'rows'),{
    offset:args.offset,limit:args.limit,table:args.table,query:args.query})};
  if(action==='directory_source_row')return {method:'GET',target:path('sources',args.sourceId,'rows',args.recordId)};
  if(action==='directory_source_members')return {method:'GET',target:path('sources',args.sourceId,'members')};
  if(action==='directory_edition_rows')return {method:'GET',target:query(path('editions',args.editionId,'rows'),{
    offset:args.offset,limit:args.limit,table:args.table,query:args.query})};
  if(action==='directory_edition_row')return {method:'GET',target:path('editions',args.editionId,'rows',args.sourceId,args.recordId)};
  if(action==='directory_edition_links')return {method:'GET',target:query(path('editions',args.editionId,'links'),{record_id:args.recordId,offset:args.offset,limit:args.limit})};
  if(action==='directory_link_targets')return {method:'GET',
    target:query(path('editions',args.editionId,'links',args.sourceId,args.linkId,'targets'),{offset:args.offset,limit:args.limit})};
  if(action==='directory_capture_source')return {method:'POST',
    target:path('operations',args.operationId,'capture-source'),input:{}};
  if(action==='directory_comparison_changes')return {method:'GET',target:query(path('comparisons',args.comparisonId,'changes'),{
    offset:args.offset,limit:args.limit,state:args.state})};
  if(action==='directory_mapping_preview_details')return {method:'GET',
    target:query(path('mappingPreviews',args.mappingPreviewId,'details'),{group:args.group,offset:args.offset,limit:args.limit})};
  if(action==='directory_selection_candidates')return {method:'GET',
    target:query(path('selections',args.selectionId,'candidates'),{offset:args.offset,limit:args.limit,query:args.query})};
  if(action==='directory_conformance_findings')return {method:'GET',
    target:query(path('conformance','assessments',args.assessmentId,'findings'),{
      offset:args.offset,limit:args.limit,severity:args.severity,table:args.table,code:args.code,
      sourceId:args.sourceId,recordId:args.recordId})};
  if(action==='directory_conformance_finding')return {method:'GET',
    target:path('conformance','assessments',args.assessmentId,'findings',args.findingId)};
  if(action==='directory_conformance_rows')return {method:'GET',
    target:query(path('conformance','assessments',args.assessmentId,'rows'),{
      offset:args.offset,limit:args.limit,table:args.table})};
  const foreignKeyQuery=directoryForeignKeyQueries.find(row=>row.action===action);
  if(foreignKeyQuery)return {method:'GET',
    target:query(path('conformance','assessments',args.assessmentId,foreignKeyQuery.route),
      Object.fromEntries(Object.keys(foreignKeyQuery.schemaValue.properties).map(key=>[key,args[key]])))};
  if(action==='directory_conformance_file'){
    const extension={report:'html',findings:'jsonl',rows:'jsonl',index:'sqlite',rules:'json',summary:'json',package:'zip',
      foreignKeys:'jsonl',foreignKeyCandidates:'jsonl',foreignKeyMatches:'jsonl',foreignKeyCoverage:'json'}[args.fileKind];
    return {method:'GET',target:path('conformance',args.collection,args.recordId,'files',args.fileKind),
      kind:'directory-conformance-file',
      filename:'Directory_Conformance_'+args.collection+'_'+args.recordId.slice(0,12)+'_'+args.fileKind+'.'+extension};
  }
  if(['workspace_packet','referral_workspace_packet','directory_workspace_packet'].includes(action))
    return {method:'GET',target:path('workspace','file'),kind:'workspace-packet',filename:'Human_Services_Directory_Editable_Workspace.zip'};
  const files={
    directory_index_file:{target:path(args.collection,args.recordId,'index','file'),
      kind:'directory-export-file',filename:'Directory_Complete_Index.sqlite'},
    directory_source_record_file:{target:path('sources',args.sourceId,'rows',args.recordId,'file'),
      kind:'directory-source-file',filename:'Directory_Original_Record.json'},
    directory_comparison_changes_file:{target:path('comparisons',args.comparisonId,'changes','file'),
      kind:'directory-export-file',filename:'Directory_Complete_Changes.jsonl'},
    directory_capture_file:{target:path('operations',args.operationId,'file'),
      kind:'directory-source-file',filename:'Directory_Original_Capture.zip'},
    directory_guidance_file:{target:query(path('guidance','file'),{member:args.member}),
      kind:'directory-guidance-file',filename:filename(args.member,'Directory_Original_Guidance_Member.txt')},
    directory_source_file:{target:query(path('sources',args.sourceId,'file'),{member:args.member}),
      kind:'directory-source-file',filename:filename(args.member,'Directory_Original_Source.bin')},
    directory_handoff_file:{target:path('handoffs',args.handoffId,'file'),
      kind:'directory-handoff-packet',filename:'Human_Services_Directory_Handoff.zip'},
    directory_export_file:{target:path('exports',args.exportId,'file'),
      kind:'directory-export-file',filename:'Directory_Prepared_Export.bin'}
  };
  if(files[action])return {method:'GET',...files[action]};
  return gravityReferralNativeRoute(action,args);
}
export function humanServicesDirectoryUploadRoute(kind,args,upload,options){
  if(kind==='workspace')return {target:path('workspace','receive'),adoptWorkspace:true};
  if(kind==='directory-handoff')return {target:path('handoffs','receive'),adoptWorkspace:true};
  if(kind==='directory-source'){
    checked(args.importProfileId,SHA,'saved directory import profile');
    return {method:'PUT',target:path('imports',args.importProfileId,'content')};
  }
  if(kind==='directory-correction-worksheet-return'){
    checked(args.importId,SHA,'saved worksheet import');
    return {method:'PUT',target:path('correction-worksheets','imports',args.importId,'content')};
  }
  return gravityReferralUploadRoute(kind,args,upload,options);
}
export const MerchantHumanServicesDirectory=createMerchantWorkspaceRuntime({
  Connection:HumanServicesDirectoryConnection,tools:humanServicesDirectoryMerchantTools,
  validateArguments:validateHumanServicesDirectoryArguments,inputActions:nativeInputActions,
  nativeJsonInputLimits:Object.fromEntries(Object.keys(nativeInputActions).filter(action=>action.startsWith('directory_correction_')).map(action=>[action,33554432])),
  routeFor:humanServicesDirectoryNativeRoute,uploadRoute:humanServicesDirectoryUploadRoute,
  configKey:'humanServicesDirectory',exportNamespace:'human-services-directory',
  exportSchema:EXPORT_SCHEMA,resultSchema:RESULT_SCHEMA,manifestName:MANIFEST_NAME,
  parseExport:parseHumanServicesDirectoryExport,errorPrefix:'HUMAN_SERVICES_DIRECTORY',
  apiSchema:'stellar-forge.human-services-directory-merchant-api.v1',
  importActions:{source_import:'source',packet_import:'packet',workspace_import:'workspace',
    handoff_import:'handoff',artifact_import:'artifact',referral_workspace_import:'workspace',
    referral_handoff_import:'referral-handoff',referral_published_examples_import:'published-examples',
    directory_source_import:'directory-source',directory_workspace_import:'workspace',
    directory_handoff_import:'directory-handoff',directory_correction_worksheet_receive:'directory-correction-worksheet-return'},
  receivingKinds:{source:'source-packet',packet:'dataset-packet',workspace:'workspace-packet',
    handoff:'handoff-packet',artifact:'artifact-file','referral-handoff':'referral-handoff-packet',
    'directory-source':'directory-source-file','directory-handoff':'directory-handoff-packet',
    'directory-correction-worksheet-return':'directory-export-file'},
  schemaMetadata:{
    nativeDirectory:'stellar-forge.human-services-directory.v1',
    directory:directoryNativeContract,source:directorySourceContract,conformance:directoryConformanceContract,
    operatingPlans:directoryOperatingPlansContract,
    operatingReturns:directoryOperatingReturnsContract,
    corrections:directoryCorrectionsContract,
    correctionWorksheets:directoryCorrectionWorksheetsContract,
    worksheetReconciliation:directoryWorksheetReconciliationContract,
    worksheetReconciliationSemantics:"Every original worksheet row retains an explicit current-row binding. Typed base/proposal/current comparisons and all explicit decisions remain immutable. Reviewed plans use the selected current edition; preview and acceptance remain separate.",
    worksheetSemantics:'Original selected rows stay immutable. A complete returned file is retained before typed field comparison. Every change needs one explicit review decision; a prepared correction plan does not preview or accept itself. Omitted rows make no proposal. Full original files remain available above the page budget.',
    correctionSemantics:'Exact original HSDS row/resource/member hashes bind ordered JSON-pointer or physical CSV edits. Original bytes remain retained. Preview produces complete derived sources, an immutable candidate edition and full comparison; acceptance records that exact candidate without replacing a mutable head or writing to a provider.',
    foreignKeySemantics:'Only declarations in the selected immutable HSDS tabular edition are evaluated. Complete outcomes, candidates, matches and coverage remain retained. Existence can pass while resolution is ambiguous; original null markers, physical absence and values stay distinct. Earlier seven-file assessments remain exact and do not gain inferred relationships.',
    operatingPlanSemantics:'The unchanged original OperatingPlan owns full revisions, exact-prefix receiving, copy and registration comparison. Prepared records retain the original complete basis and command catalogue; accepting a preview saves its exact reviewed document. Steps record human procedures and do not execute native commands.',
    recovery:'Read the same directory acquisition after an uncertain response. Source import keeps its saved import profile and complete original file. Receiving retains the original directory UUID, source indices, reviewed mappings, service selection and Gravity records.',
    sourceSemantics:'Use the literal source edition and original mapping rows. HSDS3.3.1 input and HSD STU1 mappings from HSDS2.0.1 remain distinct. Service selection retains stated status, schedule, capacity units/times and the operator decision. Native Task and ServiceRequest changes require the exact reviewed resource binding.',
    fileLimits:'Connected complete-file receiving uses the maintained 512MiB limit. The native directory routes support larger selected archives within their declared 2GiB maximum; those files remain available directly from the original operator.'
  }
});
