// MIT. Typed tools over the original Central workspace and original Stellar release store.
import {MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const text=(maximum=240,minimum=1)=>({type:'string',minLength:minimum,maxLength:maximum});
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const choice=values=>({type:'string',enum:values});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const array=(items,maximum=1000)=>({type:'array',items,maxItems:maximum});
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'};
const id=text(240),note=text(20000,0);
const indicator=object({name:text(240),tableId:id,field:text(2000),
  operation:choice(['rows','nonempty','sum','mean','minimum','maximum','distinct','frequency']),
  equals:{type:['string','number','boolean','null']}},['tableId','operation']);
const indicators=array(indicator,1000);
const findings=array({type:'object',additionalProperties:true},1000);
const scope=object({submittedFrom:text(100),submittedBefore:text(100),updatedSince:text(100),pageSize:integer(1,10000)});
const projectId={anyOf:[integer(1),text(240)]};
const form=object({projectId,formId:text(2000)},['projectId','formId']);
const jsonObject={type:'object',additionalProperties:true};
const sourceLocator={project_id:projectId,projectId,form_id:text(2000),formId:text(2000),xmlFormId:text(2000)};
const agreement={
  type:'object',additionalProperties:true,properties:{
    schema:{type:'string',enum:['stellar-forge.central-source-agreement.v1']},
    opportunity_id:text(500,0),name:text(500,0),
    commercial_scope:{type:'object',additionalProperties:true,properties:{
      max_existing_forms:integer(1,100),delivery_business_days:integer(1,260)}},
    customer_decisions:{type:'object',additionalProperties:true,properties:{
      accountable_project_owner:{type:['string','object','null']},technical_receiver:{type:['string','object','null']},
      authorized_central_origin:text(4096,0),project_id:{type:['integer','string','null']},
      selected_forms:array({anyOf:[text(2000),object(sourceLocator)]},100),
      reporting_timezone:text(240,0),
      periods:array(object({label:text(500,0),submitted_from:text(100,0),
        submitted_before_exclusive:text(100,0),updated_since:{type:['string','null']},page_size:integer(1,10000)}),2),
      late_edit_policy:{type:['string','object','array','null']},
      review_state_inclusion:{type:['string','object','array','null']},
      media_retention_selection:{type:['string','object','array','null']},
      metric_definitions:array({type:'object',additionalProperties:true,properties:{...sourceLocator,
        name:text(500,0),table:text(2000,0),field:text(2000,0),
        operation:choice(['rows','nonempty','sum','mean','minimum','maximum','distinct','frequency']),
        equals:{type:['string','number','boolean','null']}}},1000),
      cross_form_identity_rules:{type:['array','object','string','null']},
      approved_output_fields:array({type:'object',additionalProperties:true,properties:{...sourceLocator,
        table:text(2000,0),name:text(500,0),fields:array(text(2000),32)}},1000),
    }},
    processing:object({
      reviewStates:choice(['all']),lateEdits:choice(['current-state-at-capture']),
      portableSource:choice(['complete-selected-capture'])
    },['reviewStates','lateEdits','portableSource']),
    kickoff:object({status:choice(['proposed','agreed']),start:{type:['string','null']},
      weekdays:array(integer(0,6),7),excludedDates:array(text(10),4000),
      agreementReference:{type:['string','null']},inputsReadyReference:{type:['string','null']},
      capacityReference:{type:['string','null']}}),
  },
};
const hostHandover=object({
  schema:choice(['stellar-forge.odk-central-host.v1.handover']),operation_id:text(500),
  source:jsonObject,url:text(4096),mode:text(240),version:text(240),observed_at:text(100),
  compose_project:text(500),runtime:jsonObject,
  connection:object({id,name:text(240),url:text(4096),
    authEnv:{type:'string',pattern:'^[A-Z_][A-Z0-9_]{0,127}$'},allowLoopback:{type:'boolean'}},['url','authEnv']),
  container_states:array(jsonObject,1000),backup_count:integer(),restore:{type:['object','null']},
  receiving_operation:{type:['string','object','null']},
},['schema','operation_id','source','version','observed_at','connection','container_states']);

export const ODK_ACTION_TOOLS=Object.freeze({
  merchant_odk_publisher_capture:{action:'capturePublisher',description:'Capture one exact original publisher source selection into the existing workspace resource graph. Retain id and optional reviewed release generation; retries preserve complete and interrupted native source without substituting an empty publisher.',properties:{id,expectedGeneration:integer()},required:['id']},
  merchant_odk_publisher_receive:{action:'receivePublisher',description:'Receive the selected original publisher snapshot using the existing native dataset-version and release APIs. Keeps original-to-local IDs and digests; pending source remains explicit, and activation remains a separate reviewed generation transition.',properties:{id,snapshotId:id},required:['id','snapshotId']},
  merchant_odk_publisher_transfers:{action:'publisherTransfers',readOnly:true,description:'Read full original publisher snapshot and receiving state, source selections, pending items and original-to-local release mappings.',properties:{},required:[]},
  merchant_odk_commissioning_record_host:{namespace:'commissioning',action:'recordHost',description:'Retain the original Central host handover for this same selected source. Use its actual version/operation/container observation and environment alias; credential values stay on the host.',properties:{id,handover:hostHandover},required:['id','handover']},
  merchant_odk_commissioning_inspect:{namespace:'commissioning',action:'inspect',openWorld:true,description:'Retain an original Central actor/project/form observation under a stable inspection ID. An exact completed-ID repeat reuses those source receipts; a different project or fresh observation uses its own reviewed ID.',properties:{id,projectId},required:['id']},
  merchant_odk_commissioning_draft_save:{namespace:'commissioning',action:'saveDraft',description:'Save the complete source/report agreement at its exact draft revision using the original retained request ID. Incomplete definitions remain visible as readiness issues; no period plan or capture is dispatched.',properties:{id,requestId:id,expectedRevision:integer(),agreement},required:['id','requestId','expectedRevision','agreement']},
  merchant_odk_commissioning_readiness:{namespace:'commissioning',action:'readiness',inputKey:'agreement',readOnly:true,description:'Read required decisions in the complete agreement. The original interpretation retains all review states, current available source versions and complete selected-capture portability; approved CSV fields are a separate output projection.',properties:{agreement},required:['agreement']},
  merchant_odk_commissioning_prepare:{namespace:'commissioning',action:'prepare',description:'Freeze the exact agreement draft revision, retained source inspection, explicit field/indicator mapping and two original reporting periods. Optional existingPlanIds adopts the two matching native plans without recreating source acquisition.',properties:{id,draftId:id,draftRevision:integer(1),inspectionId:id,existingPlanIds:{...array(id,2),minItems:2,uniqueItems:true}},required:['id','draftId','draftRevision','inspectionId']},
  merchant_odk_commissioning_install:{namespace:'commissioning',action:'install',openWorld:true,description:'Install the two frozen original reporting plans in this same workspace, checking the retained Central actor and complete source selection. Reuse the original commission ID after an uncertain response.',properties:{id},required:['id']},
  merchant_odk_commissioning_capture_period:{namespace:'commissioning',action:'capturePeriod',openWorld:true,description:'Start one retained capture request for period 0 or 1 using its installed original plan. Preserve requestId; a repeated call returns the same native capture and never creates a replacement acquisition.',properties:{id,period:integer(0,1),requestId:id,label:text(500)},required:['id','period','requestId']},
  merchant_odk_commissioning_capture_resume:{namespace:'commissioning',action:'resumeCapture',openWorld:true,description:'Resume the exact retained capture belonging to this original commission, using the existing native owner and cursor.',properties:{id,captureId:id},required:['id','captureId']},
  merchant_odk_commissioning_deliver:{namespace:'commissioning',action:'deliver',description:'Produce or recover the original two-period handover under one retained request ID. Select the currently accepted capture/review for periods 0 then 1. Approved CSV fields remain distinct from complete rows.jsonl, original pages/media and the full portable archive; reports, source agreement and native file receipts stay together.',properties:{id,requestId:id,captures:{...array(object({period:integer(0,1),captureId:id,reviewId:id},['period','captureId','reviewId']),2),minItems:2}},required:['id','requestId','captures']},

  merchant_odk_projects:{action:'projects',readOnly:true,description:'Read projects through the selected original Central connection and its authorized Web User account.',properties:{connectionId:id},required:['connectionId']},
  merchant_odk_forms:{action:'forms',readOnly:true,description:'Read native published forms and exact form IDs for an authorized Central project.',properties:{connectionId:id,projectId},required:['connectionId','projectId']},
  merchant_odk_plan_create:{action:'createPlan',description:'Save the original reporting plan for selected Central forms and one exact time scope. Retain id before calling; pageSize is native continuation page size.',properties:{id:id,name:text(240),connectionId:id,forms:{...array(form,100),minItems:1},scope},required:['id','name','connectionId','forms','scope']},
  merchant_odk_capture_start:{action:'capture',openWorld:true,description:'Create or continue one original capture ID and its saved plan. The native owner captures all advertised root/repeat pages, form generations, submission versions and available media; inspect this same ID after a lost reply.',properties:{id:id,planId:id,label:text(240)},required:['id','planId']},
  merchant_odk_capture_resume:{action:'resume',openWorld:true,description:'Resume the original retained Central capture and its exact cursor. Reuses a running operation; inspect its current state after an interrupted reply.',properties:{id},required:['id']},
  merchant_odk_capture_pause:{action:'pause',description:'Request pause of the original capture owner, retaining all completed source and original cursors.',properties:{id},required:['id']},
  merchant_odk_edition:{action:'edition',readOnly:true,description:'Read the original reporting edition, captured form/table identities, coverage and retained review decisions.',properties:{id},required:['id']},
  merchant_odk_rows:{action:'rows',readOnly:true,description:'Read original rows from one retained root or repeat table. Continue the native opaque after cursor; structural repeat IDs retain their Central meaning.',properties:{id,tableId:id,after:text(4000,0),limit:integer(1,1000),search:text(2000,0)},required:['id','tableId']},
  merchant_odk_row:{action:'row',readOnly:true,description:'Read one exact original root/repeat row by its retained table and native row ID.',properties:{id,tableId:id,rowId:text(4000)},required:['id','tableId','rowId']},
  merchant_odk_resources:{action:'resources',readOnly:true,description:'List original page, form, submission-version and media receipts with their exact retained source hashes and byte counts.',properties:{id,after:integer(),limit:integer(1,1000),kind:text(100)},required:['id']},
  merchant_odk_source_file:{action:'sourceFile',readOnly:true,description:'Read the exact native descriptor for a retained source hash before streaming its original bytes.',properties:{hash},required:['hash']},
  merchant_odk_export_file:{action:'exportFile',readOnly:true,description:'Read the native descriptor for an original dataset, report or archive member before retaining its exact bytes.',properties:{id,path:text(4096)},required:['id','path']},
  merchant_odk_quality:{action:'quality',readOnly:true,description:'Read source coverage, field presence, native counts, repeat-parent gaps and retained version/media outcomes for this same capture.',properties:{id},required:['id']},
  merchant_odk_review:{action:'review',description:'Accept or revise the original reporting edition against its exact current revision, with the accountable reviewer, source interpretation, findings and native numeric indicator definitions.',properties:{id,expectedRevision:integer(),decision:choice(['accept','revise']),note,reviewer:text(240),findings,indicators},required:['id','expectedRevision','decision','note']},
  merchant_odk_compare:{action:'compare',readOnly:true,description:'Compare retained periods from the same original Central source and table, preserving native identity, added/removed/changed counts and repeat-identity limitations.',properties:{leftId:id,rightId:id,tableId:id,after:text(4000,0),limit:integer(1,1000)},required:['leftId','rightId','tableId']},
  merchant_odk_report:{action:'report',description:'Create or recover one original source-linked report ID with exact indicators and an optional baseline period. Its complete files remain in the same workspace.',properties:{id,reportId:id,baselineId:id,title:text(500),narrative:note,indicators},required:['id','reportId']},
  merchant_odk_backup:{action:'backup',description:'Create or recover a complete original archive ID containing retained source, rows, versions, media, reports, datasets and history. Credentials remain host environment aliases; the original archive importer reopens this workspace on the receiving host.',properties:{id:id},required:['id']},
  merchant_odk_release_status:{action:'releaseStatus',readOnly:true,description:'Inspect the original SF82 release store, current generation and retained Central dataset releases.',properties:{},required:[]},
  merchant_odk_release_activate:{action:'activateRelease',description:'Activate the selected original release at the reviewed current generation through the existing SF82 release lifecycle.',properties:{id,expectedGeneration:integer(),reason:note},required:['id','expectedGeneration','reason']},
  merchant_odk_release_rollback:{action:'rollbackRelease',description:'Roll back the existing SF82 release store to a selected retained release at its exact reviewed generation, preserving release history.',properties:{to:id,expectedGeneration:integer(),reason:note},required:['to','expectedGeneration','reason']},
});
export function odkWorkspaceTools(tool){
  const scoped=properties=>({workspace:alias,...properties}),read={readOnly:true,idempotent:true};
  const tools=[
    tool('merchant_odk_status','List configured original Central workspaces, source aliases, merchant terms and connected listener identities; optionally inspect one native workspace with paginated state.',{workspace:alias,offset:integer(),limit:integer(1,1000)},[],read),
    tool('merchant_odk_connect','Attach to the original Applications-owned Central listener. The host verifies its private connection, workspace UUID, current instance and authenticated native state.',scoped({expectedInstanceId:uuid}),['workspace'],{idempotent:true}),
    tool('merchant_odk_disconnect','Release this MCP attachment and its original file handles for the selected current instance. Applications retains the native listener, captures and original writer.',scoped({instanceId:uuid}),['workspace','instanceId'],{idempotent:true}),
    tool('merchant_odk_browser','Return the selected original authenticated local operator URL for this workspace.',scoped({}),['workspace'],read),
    tool('merchant_odk_commissioning_state','Read saved host/source observations, full agreements, immutable period plans and complete handover state from the original commissioned workspace. State arrays include explicit paging metadata.',scoped({offset:integer(),limit:integer(1,1000)}),['workspace'],read),
    tool('merchant_odk_commissioning_browser','Return the authenticated commissioning URL on this same Applications-owned listener after verifying its original workspace identity.',scoped({}),['workspace'],read),
    tool('merchant_odk_source_connect','Bind the selected host-declared Central source profile, existing authorization environment alias and stable native connection ID. The original source owner verifies its account; no credential value enters tool input.',scoped({profile:alias}),['workspace','profile'],{idempotent:true,openWorld:true}),
    tool('merchant_odk_capture_status','Read the exact original capture and its native background owner without starting another acquisition.',scoped({id}),['workspace','id'],read),
    tool('merchant_odk_dataset','Create or recover one accepted retained-table dataset using the host-declared publication terms and exact selected source fields. Keeps native field and parent keys and original semantic/source packages.',scoped({id,exportId:id,tableId:id,profile:alias,fields:array(text(2000),32),name:text(128),expectedSemanticSha256:hash}),['workspace','id','exportId','tableId','profile'],{idempotent:true}),
    tool('merchant_odk_release_prepare','Prepare an original SF82 release from the saved Central dataset export and optional host-declared runtime profile. Retains the original release ID and source package.',scoped({exportId:id,releaseId:id,label:text(240),runtime:alias}),['workspace','exportId','releaseId'],{idempotent:true}),
    tool('merchant_odk_file_retain','Stream a selected original source/export download into the maintained retained-file reader. Save requestId, exact relative downloadPath, SHA-256 and byte count first; retries preserve the same retained bytes and native workspace identity.',scoped({requestId:text(200),downloadPath:text(16384),expectedSha256:hash,expectedBytes:integer(0,8*1024*1024*1024)}),['workspace','requestId','downloadPath','expectedSha256','expectedBytes'],{idempotent:true}),
    tool('merchant_odk_files','List exact original downloads retained for this configured workspace, including files still readable after its Applications host stops.',scoped({offset:integer(),limit:integer(1,1000)}),['workspace'],read),
    tool('merchant_odk_file','Read a retained original file in SHA-bound chunks using the existing reader. Continue readId/nextOffset or reopen the same file and expected hash after restart; EOF closes the descriptor.',scoped({fileId:{type:'string',pattern:'^of_[a-f0-9]{64}$'},readId:uuid,expectedSha256:hash,offset:integer(),limit:integer(1,MAX_RETAINED_CHUNK_BYTES)}),['workspace','fileId'],read),
    tool('merchant_odk_file_release','Release one unfinished original read handle while its retained file remains available.',scoped({readId:uuid}),['workspace','readId'],{idempotent:true}),
  ];
  for(const [name,definition]of Object.entries(ODK_ACTION_TOOLS))
    tools.push(tool(name,definition.description,scoped(definition.properties),['workspace',...definition.required],
      definition.readOnly?read:{idempotent:true,...(definition.openWorld?{openWorld:true}:{})}));
  return tools;
}
