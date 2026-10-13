// SPDX-License-Identifier: MIT
// Exact original Staff API. Metadata does not create or start a workspace.
import {MAX_RETAINED_CHUNK_BYTES} from '../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
export const READ_ACTIONS=['workspace.get','request.get','records.list','project.get','edition.get','contract.get','binding.get','run.get','comparison.get','review.get','release.get','file.read','run.log','run.artifact','edition.diff','audit.list','runtime.get'];
export const MUTATIONS=['project.create','project.update','edition.save','contract.save','binding.save','run.execute','run.start','run.reconcile','run.cancel','run.retry','comparison.create','review.save','release.create'];
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'},sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const text=(maxLength,minLength=0)=>({type:'string',minLength,maxLength});
const object={type:'object'},read={readOnly:true,idempotent:true};
const selection={type:'object',additionalProperties:false,properties:{root:text(4096,1),receiving_id:text(200,1),workspace_id:id},required:['root','receiving_id','workspace_id']};
const envelope={workspace_id:id,expected_revision:integer(),request_id:id,selection};
const body={type:'object',additionalProperties:false,properties:{action:{type:'string',enum:MUTATIONS},payload:object,...envelope},required:['action','payload','workspace_id','expected_revision','request_id']};
const page={offset:integer(),limit:integer(1,100)},file={fileId:sha,expectedSha256:sha};
const input={sourceInput:alias,expectedSourceSha256:sha};
export function pipelineDeliveryTools(tool){
 const scope=p=>({workspace:alias,...p}),t=(suffix,description,p,required,annotations=read)=>tool('merchant_pipeline_'+suffix,description,scope(p),required,annotations);
 return [
 t('status','List declared original pipeline workspaces and complete input descriptors without starting an application.',{},[],read),
 t('connect','Attach to the host-declared original staff listener using its private capability. Applications owns the process.',{expectedLaunchId:text(200,1)},['workspace'],{idempotent:true}),
 t('disconnect','Close this attachment and its open retained reads; keep the application, accepted native jobs and all retained files.',{launchId:text(200,1)},['workspace','launchId'],{idempotent:true}),
 t('info','Retain the full managed source/runtime handshake and original staff state. Private capability is never returned.',{},['workspace']),
 t('state','Retain the complete original selected workspace snapshot with exact selection, global revision, projects and recent runs/releases. Use read records.list to page the entire inventory.',{},['workspace']),
 t('read','Invoke a documented original read and retain its complete response. Use records.list/audit.list pages, project and immutable edition/contract/binding/run/review/release, file.read, run.log, run.artifact, edition.diff, runtime.get or request.get. This never invents a run.',{action:{type:'string',enum:READ_ACTIONS},payload:object},['workspace','action','payload']),
 t('pending','Retain the original Staff active-request document, including its exact endpoint/body and selection. Resume the identical request; do not clear uncertainty with another ID.',{},['workspace']),
 t('requests','Page durable complete host-selected original mutation requests and each observed native HTTP outcome. HTTP_OBSERVED means a response was received, not that an error had no effects.',page,['workspace']),
 t('invoke','Retain and send the exact original action envelope. Global expected_revision and complete selection must come from this selected workspace. Replay the same request/body after uncertainty; native run.execute acceptance and Dagster run identity remain original.',{body},['workspace','body'],{idempotent:true,openWorld:true}),
 t('invoke_input','Send one complete SHA-bound host-declared JSON original action envelope, preserving large source editions within native limits. The entire exact input is retained before dispatch.',input,['workspace','sourceInput','expectedSourceSha256'],{idempotent:true,openWorld:true}),
 t('source_import','Inspect a complete declared dbt source ZIP through original read-only import/source. Retains all permitted paths and full original file bodies, skipped paths and exact archive identity; does not save an edition or execute dbt.',{...input,root:text(512)},['workspace','sourceInput','expectedSourceSha256']),
 t('received','Retain the complete original receiving catalogue and current selection. A received workspace keeps its native IDs and history.',{},['workspace']),
 t('receive','Receive a complete declared original workspace/release ZIP using an exact original selection, global revision and request ID. Reuses the native staged receiving and writer-switch procedure; native pipelines are never automatically rerun.',{...input,envelope:{type:'object',additionalProperties:false,properties:envelope,required:['workspace_id','expected_revision','request_id']}},['workspace','sourceInput','expectedSourceSha256','envelope'],{idempotent:true}),
 t('open','Switch the original Staff writer to original or one already-received workspace. Retain and replay the exact original body; native idle guards remain authoritative.',{body:{type:'object',additionalProperties:false,properties:{receiving_id:text(200,1),...envelope},required:['receiving_id','workspace_id','expected_revision','request_id']}},['workspace','body'],{idempotent:true}),
 t('archive','Retain a complete original workspace backup or selected release ZIP. A stable requestId selects the native immutable export; the result binds full observed bytes/SHA and original workspace/revision/receiving headers. No sample ZIP or guessed digest.',{kind:{type:'string',enum:['backup','release']},requestId:id,releaseId:id,expectedSha256:sha,expectedBytes:integer(0,512*1024*1024),filename:text(240,1)},['workspace','kind','requestId'],{idempotent:true}),
 t('files','Page complete retained original response/archive descriptors. Reconnect the same original staff authority before disclosure.',page,['workspace']),
 t('file','Read the exact retained complete file by SHA and maintained read ID, at most196608 bytes per page. Use the whole file for larger native source/log/artifact bodies.',{...file,readId:text(200,1),offset:integer(),limit:integer(1,MAX_RETAINED_CHUNK_BYTES)},['workspace','fileId','expectedSha256']),
 t('file_release','Close an unfinished read handle without deleting any retained source or outcome.',{readId:text(200,1)},['workspace','readId'],{idempotent:true}),
 t('inspect','Inspect an exact retained JSON pointer or page up to50 entries. Large values remain full saved bytes; small replies carry explicit same-file pointers.',{...file,pointer:text(4000),offset:integer(),limit:integer(1,50)},['workspace','fileId','expectedSha256']),
 t('browser','Return the original staff browser origin and private launch instructions without exposing its capability.',{},['workspace']),
 t('input','Retain one complete declared host input with exact bytes/SHA. Inspect a complete action request before dispatch or download the original selected source; no caller-selected local path.',input,['workspace','sourceInput','expectedSourceSha256'])
 ];
}
