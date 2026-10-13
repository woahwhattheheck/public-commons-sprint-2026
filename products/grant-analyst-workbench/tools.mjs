// SPDX-License-Identifier: MIT
// Each mutation forwards the original analyst's stable request ID and complete body.
import {MAX_RETAINED_CHUNK_BYTES} from '../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
export const ACTIONS=Object.freeze(['import','codebook','review','cycle-create','cycle-action','cycle-review','study-create','study-questions','study-scope','study-evidence','study-answer','study-release']);
export const READ_KINDS=Object.freeze(['state','source','report','studies','learning','compare','study-release']);
export const ARTIFACT_KINDS=Object.freeze(['source','report-json','report-csv','learning-json','learning-csv','learning-markdown','study-json','study-document','study-release-json','study-release-markdown','study-release-csv','handover']);
export function grantAnalystTools(tool){
 const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},sha={type:'string',pattern:'^[a-f0-9]{64}$'},id={type:'string',minLength:1,maxLength:500},requestId={type:'string',pattern:'^[A-Za-z0-9._:-]{1,180}$'},object={type:'object'},offset={type:'integer',minimum:0},write={readOnly:false,idempotent:false};
 const t=(name,description,properties={},required=['workspace'],annotations={readOnly:true,idempotent:true})=>tool('merchant_grant_analyst_'+name,description,{workspace:alias,...properties},required,annotations);
 const query={edition:id,study:id,evidence:id,number:{type:'integer',minimum:1},release:id,cycle:id,baseline:id,candidate:id,search:{type:'string',maxLength:4000},offset,limit:{type:'integer',minimum:1,maximum:200},format:{enum:['json','markdown','csv']}};
 const full={fileId:sha,expectedSha256:sha};
 return[
 t('connections','List declared original analyst attachments and complete input identities without starting the application.',{},[]),
 t('connect','Attach to the selected original managed analyst listener; retain its native authority.',{expectedLaunchId:id},['workspace'],write),
 t('disconnect','Close this attached client and its retained reads after selecting the current launch; the Applications owner controls the server.',{launchId:id},['workspace','launchId'],write),
 t('info','Retain complete managed source and original workspace identity.'),
 t('browser','Return the original analyst browser entry for the host operator. Its private token is never retained as an artifact.'),
 t('state','Retain the full original saved workspace, including all requests, audit, review, learning and study histories.'),
 t('read','Read an exact original analyst query, retaining its full raw response. Original report pages use limit200 and nextOffset.',{kind:{enum:READ_KINDS},query:object},['workspace','kind']),
 t('report','Retain the full exact-decimal original report or one explicit original paged/search view.',{edition:id,paged:{type:'boolean'},search:query.search,offset,limit:query.limit},['workspace','edition']),
 t('compare','Retain the complete original grant-ID comparison of two editions from the same dataset.',{baseline:id,candidate:id},['workspace','baseline','candidate']),
 t('learning','Retain complete learning snapshots, action revisions and reviews; optional cycle selects one.',{cycle:id}),
 t('studies','Retain complete commissioned-study scopes, evidence histories, current answers and immutable releases.',{study:id}),
 t('action','Save one of the12 original analyst mutations with its exact stable native requestId and payload. Native validation and revision rules remain authoritative.',{requestId,action:{enum:ACTIONS},payload:object},['workspace','requestId','action','payload'],write),
 t('action_input','Read a host-declared complete JSON mutation body, bind its full bytes and dispatch the original action with the chosen requestId.',{requestId,action:{enum:ACTIONS},sourceInput:alias,expectedSourceSha256:sha},['workspace','requestId','action','sourceInput','expectedSourceSha256'],write),
 t('import_source','Import a complete host-declared original360Giving JSON package without parsing or normalising its numeric tokens.',{requestId,sourceInput:alias,expectedSourceSha256:sha,dataset:{type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,99}$'},name:{type:'string'},sourceUrl:{type:'string'}},['workspace','requestId','sourceInput','expectedSourceSha256','dataset'],write),
 t('evidence_document','Attach complete host-declared original document bytes to one revision-bound study-evidence mutation, retaining its exact display name and MIME.',{requestId,sourceInput:alias,expectedSourceSha256:sha,payload:object},['workspace','requestId','sourceInput','expectedSourceSha256','payload'],write),
 t('receive','Receive a complete original handover into a separately declared fresh destination through the unchanged original reader; preserve uncertain acknowledgement.',{requestId,sourceInput:alias,expectedSourceSha256:sha,destination:alias},['workspace','requestId','sourceInput','expectedSourceSha256','destination'],write),
 t('artifact','Retain one complete original source, report, evidence document, release or full handover as immutable bytes. Internal/external reports remain separate selections.',{kind:{enum:ARTIFACT_KINDS},query:object,expectedSha256:sha,expectedBytes:{type:'integer',minimum:0,maximum:1140850688},filename:{type:'string',minLength:1,maxLength:240}},['workspace','kind']),
 t('files','Page full retained artifact descriptors belonging to this exact original workspace/source.',{offset,limit:{type:'integer',minimum:1,maximum:100}}),
 t('file','Read exact retained bytes; follow the original reader readId/offset/EOF until complete.',{...full,readId:id,offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','fileId','expectedSha256']),
 t('file_release','Release one selected retained range reader.',{readId:id},['workspace','readId'],write),
 t('file_inspect','Inspect a JSON pointer/page without losing the complete underlying file. Files larger than32MiB remain available through byte ranges.',{...full,pointer:{type:'string',maxLength:4000},offset,limit:{type:'integer',minimum:1,maximum:50}},['workspace','fileId','expectedSha256']),
 t('requests','Page full selected requests and all observed HTTP outcomes. HTTP_OBSERVED describes transport evidence; the original native request journal owns mutation replay.',{offset,limit:{type:'integer',minimum:1,maximum:100}})
 ];
}
