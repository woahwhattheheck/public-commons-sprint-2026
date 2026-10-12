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
const form=object({projectId:integer(1),formId:text(2000)},['projectId','formId']);
export const ODK_ACTION_TOOLS=Object.freeze({
  merchant_odk_projects:{action:'projects',readOnly:true,description:'Read projects through the selected original Central connection and its authorized Web User account.',properties:{connectionId:id},required:['connectionId']},
  merchant_odk_forms:{action:'forms',readOnly:true,description:'Read native published forms and exact form IDs for an authorized Central project.',properties:{connectionId:id,projectId:integer(1)},required:['connectionId','projectId']},
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
