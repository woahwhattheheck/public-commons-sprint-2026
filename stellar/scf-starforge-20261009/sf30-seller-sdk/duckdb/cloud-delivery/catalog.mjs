// MIT. One source-owned declaration for Cloud, DuckDB authoring and retained transfers.
import {MAX_RETAINED_CHUNK_BYTES} from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
export {MAX_RETAINED_CHUNK_BYTES};
export const CLOUD_TOOL_PREFIX='merchant_cloud_';
const string={type:'string'},object={type:'object'},array={type:'array'};
const id={type:'string',pattern:'^[a-z][a-z0-9-]{7,79}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const integer={type:'integer',minimum:0},uuid={type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'};
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const page={offset:integer,limit:{type:'integer',minimum:1,maximum:200}};
const common={workspace:alias,workspaceInstanceId:uuid};
const op={operationId:id,expectedRevision:integer};
export const CLOUD_ACTIONS=Object.freeze({
 intake:{native:'cloud.intake',properties:{...op,manifest:object,archive:object},required:['operationId','expectedRevision'],resume:true},
 commit:{native:'cloud.commit',properties:{editionId:string},required:['editionId'],resume:true},
 compare:{native:'cloud.compare',properties:{...op,leftEditionId:string,rightEditionId:string,leftRelationId:sha,rightRelationId:sha,
  family:string,keys:array,fields:array,omissions:array,note:string},required:['operationId','expectedRevision','leftEditionId','rightEditionId','leftRelationId','rightRelationId','family','keys','fields'],resume:true},
 review:{native:'cloud.review',properties:{...op,comparisonId:string,expectedReviewRevision:integer,decision:{enum:['accepted','changes-requested','reopened']},note:string},
  required:['operationId','expectedRevision','comparisonId','expectedReviewRevision','decision','note'],resume:true},
 select:{native:'cloud.select',properties:{...op,editionId:string,relationIds:{type:'array',items:sha,minItems:1,maxItems:32},comparisonId:string,note:string},
  required:['operationId','expectedRevision','editionId','relationIds'],resume:true},
 export:{native:'cloud.export',properties:{...op,editionIds:array,comparisonIds:array,packageId:id,note:string},required:['operationId','expectedRevision','editionIds'],resume:true},
 receive:{native:'cloud.receive',properties:{...op,intakeId:string},required:['operationId','expectedRevision','intakeId'],resume:true},
 draft_save:{native:'save',properties:{...op,sourceSha256:sha,plan:object,authoring:array},required:['operationId','expectedRevision','sourceSha256','plan'],resume:true},
 draft_adopt:{native:'adoptReceivedDraft',properties:{...op,sourceSha256:sha,plan:object,authoring:array,receivingId:id,originalDraftSha256:sha},
  required:['operationId','expectedRevision','sourceSha256','plan','receivingId','originalDraftSha256'],resume:true},
 prepare:{native:'prepare',properties:{operationId:id,revision:integer,reviewId:sha},required:['operationId','revision','reviewId'],resume:true},
 start:{native:'start',properties:{packageId:id,packageSha256:sha},required:['packageId','packageSha256'],resume:false},
 stop:{native:'stop',properties:{instanceId:string},required:['instanceId'],resume:false}
});
export const CLOUD_ARTIFACTS=Object.freeze(['source','comparison','delivery','package']);
const descriptions={
 intake:'Retain the explicit source manifest or complete archive intake in the original Cloud store.',
 commit:'Inspect every already-retained source file using the original native DuckDB operation.',
 compare:'Compare the two selected original relations with explicit row keys, exact types and tolerances.',
 review:'Append the next explicit comparison review against its original review revision.',
 select:'Select the retained edition and native relations for the same DuckDB merchant.',
 export:'Export the original sources, complete comparisons/reviews and optional editable merchant draft/package.',
 receive:'Receive the uploaded native handover; preserve original edition/comparison identities and require explicit source selection.',
 draft_save:'Save a reviewed editable merchant draft against the current source and draft revision.',
 draft_adopt:'Save an explicitly edited received draft with its exact original handover/draft binding.',
 prepare:'Prepare the already-reviewed original native merchant package once under its original operation ID.',
 start:'Start the inspected native merchant; its actual original runtime instance is retained.',
 stop:'Stop the exact original merchant instance returned by runtime.'
};
export function cloudWorkspaceTools(tool){
 const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
 const local={readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false};
 const values=[
  tool('merchant_cloud_workspaces','List host-configured original Cloud/DuckDB workspace aliases.',{},[],read),
  tool('merchant_cloud_open','Open one declared original workspace and its authenticated browser in the same owner.',{workspace:alias},['workspace'],local),
  tool('merchant_cloud_close','Drain and close the same workspace/browser owner. Does not change its saved source or package identities.',common,['workspace','workspaceInstanceId'],local),
  tool('merchant_cloud_status','Read current original workspace/source/runtime identity and retained record counts.',{workspace:alias},['workspace'],read),
  tool('merchant_cloud_operation','Inspect a retained operation or draft/package identity after a missing response.',{workspace:alias,operationId:id,kind:{enum:['cloud','draft','package']}},['workspace','operationId'],read),
  tool('merchant_cloud_records','Page the original editions, comparisons, deliveries, receivings, archive intakes or event history.',{workspace:alias,kind:{enum:['editions','comparisons','deliveries','receivings','archiveIntakes','events']},...page},['workspace','kind'],read),
  tool('merchant_cloud_edition','Read original edition metadata with bounded file and relation pages; source values remain native typed cells.',{workspace:alias,id:string,...page},['workspace','id'],read),
  tool('merchant_cloud_comparison','Read exact original comparison findings and review history by native page.',{workspace:alias,id:string,...page},['workspace','id'],read),
  tool('merchant_cloud_received_draft','Read the complete original editable draft retained in a received handover.',{workspace:alias,receivingId:id},['workspace','receivingId'],read),
  tool('merchant_cloud_upload_status','Inspect/reconcile the same immutable source/archive upload and its verified prefix.',{...common,editionId:string,fileId:string},['workspace','workspaceInstanceId','editionId','fileId'],local),
  tool('merchant_cloud_upload_chunk','Retain one bounded, SHA256-verified chunk at its exact original offset. Repeated bytes are compared before reuse.',{...common,editionId:string,fileId:string,offset:{type:'string',pattern:'^(0|[1-9][0-9]*)$'},data:{type:'string',maxLength:Math.ceil(MAX_RETAINED_CHUNK_BYTES/3)*4},sha256:sha},
    ['workspace','workspaceInstanceId','editionId','fileId','offset','data','sha256'],local),
  tool('merchant_cloud_catalog','Inspect original native relation catalog for the currently selected source.',{workspace:alias,sourceSha256:sha,cursor:object},['workspace','sourceSha256'],read),
  tool('merchant_cloud_author_review','Review exact native authoring choices against the current source.',{workspace:alias,entry:object,sourceSha256:sha},['workspace','entry','sourceSha256'],read),
  tool('merchant_cloud_author_reopen','Reopen the original query authoring entry against current relation metadata.',{workspace:alias,entry:object,sourceSha256:sha},['workspace','entry','sourceSha256'],read),
  tool('merchant_cloud_draft','Read a retained merchant draft revision; zero selects the current initial editor.',{workspace:alias,revision:integer},['workspace','revision'],read),
  tool('merchant_cloud_plan_review','Review an existing saved draft through the original merchant compiler.',{workspace:alias,revision:integer},['workspace','revision'],read),
  tool('merchant_cloud_preview','Run the original local typed query preview over the current retained source.',{workspace:alias,sourceSha256:sha,authoring:array,query:string,input:object},['workspace','sourceSha256','query'],read),
  tool('merchant_cloud_inspect','Verify an existing prepared native merchant package and original data files.',{workspace:alias,packageId:id},['workspace','packageId'],read),
  tool('merchant_cloud_runtime','Read the actual original seller and operations runtime status.',{workspace:alias},['workspace'],read),
  tool('merchant_cloud_artifact_read','Read a bounded range from one exact retained original source/report/archive/package artifact.',{workspace:alias,artifact:{enum:CLOUD_ARTIFACTS},id:string,file:string,kind:{enum:['summary','full']},expectedSha256:sha,readId:uuid,offset:integer,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},
    ['workspace','artifact','id','offset','limit'],read),
  tool('merchant_cloud_artifact_release','Release the original retained read descriptor; safe after an already completed range.',{workspace:alias,readId:uuid},['workspace','readId'],local)
 ];
 for(const [name,action]of Object.entries(CLOUD_ACTIONS))
  values.push(tool(CLOUD_TOOL_PREFIX+name,descriptions[name],{...common,...action.properties},
   ['workspace','workspaceInstanceId',...action.required],{...local,idempotentHint:action.resume}));
 return values;
}
