// MIT. Original DSpace schemas, independent of operator runtime loading.
import {MAX_RETAINED_CHUNK_BYTES} from '../retained-file-contracts.mjs';
export const DSPACE_DOWNLOAD_ID=/^dspace-download-[a-f0-9]{64}$/;
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id={type:'string',minLength:1,maxLength:160};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const request={type:'string',pattern:'^[A-Za-z0-9_.:-]{8,128}$'};
const uuid={type:'string',format:'uuid'};
const object={type:'object',additionalProperties:true};
const integer={type:'integer',minimum:0};
const page={offset:integer,limit:{type:'integer',minimum:1,maximum:100}};
const scope={type:'object',properties:{operatorId:id,instanceId:id,projectKey:id,workspaceId:id},
  required:['operatorId','instanceId','projectKey','workspaceId'],additionalProperties:false};
const mutation={operationId:request,expectedRevision:integer,actor:{type:'string',minLength:1,maxLength:256}};
const rights={type:'object',properties:{attribution:{type:'string',minLength:1,maxLength:16000},
  basis:{type:'string',minLength:1,maxLength:16000},reference:{type:'string',format:'uri'}},
  required:['attribution','basis'],additionalProperties:false};
const sourceChoice={type:'object',properties:{sourceId:id,uuid,objectSha256:hash},
  required:['sourceId','uuid','objectSha256'],additionalProperties:false};
const read={readOnly:true,idempotent:true};
const downloadKinds=['project','source','dataset','config','comparison','sources','editions','reviews','comparisons','publications'];


export function dspaceOperatorTools(tool){
  const scoped=values=>({operator:alias,scope,...values});
  const change=values=>scoped({...mutation,...values});
  return [
    tool('merchant_dspace_status','List declared original operators and source inputs, or page the state of an explicitly bound original project. All collections have total and nextOffset.',{operator:alias,scope,...page},[],read),
    tool('merchant_dspace_bind','Borrow the already running declared operator through its verified private launch. Return the actual persistent operator, running instance, project and workspace. Explicit reconnect replaces only this borrowed client.',{operator:alias,reconnect:{type:'boolean'}},['operator'],read),
    tool('merchant_dspace_select_project','Explicitly select a retained project using the supplied original scope. Return the new complete scope for later calls.',scoped({key:id}),['operator','scope','key'],{idempotent:true}),
    tool('merchant_dspace_record','Read a retained source, edition, review, comparison or publication. Original long arrays are paged with totals; complete original records remain available through download.',scoped({kind:{enum:['sources','editions','reviews','comparisons','publications']},id,...page}),['operator','scope','kind','id'],read),
    tool('merchant_dspace_items','Page the original source item variants and exact object hashes. Choose all retained objects or the original captured collection scope.',scoped({sourceId:id,selection:{enum:['all','collection']},search:{type:'string',maxLength:1024},...page}),['operator','scope','sourceId'],read),
    tool('merchant_dspace_item','Inspect an exact original item variant. Without field, list all metadata fields and value counts; with field, page its unmodified value/property arrays, including linked virtual values.',scoped({sourceId:id,uuid,objectSha256:hash,field:{type:'string',maxLength:256},...page}),['operator','scope','sourceId','uuid','objectSha256'],read),
    tool('merchant_dspace_operation','Inspect the same original committed request after an interrupted reply. The request fingerprint and input/result stay attached to its original project; long original input arrays are paged.',scoped({operationId:request,...page}),['operator','scope','operationId'],read),
    tool('merchant_dspace_inputs','List host-declared input aliases, or hash one complete original input before importing/receiving it. Model arguments never select filesystem paths.',{operator:alias,input:alias},['operator'],read),
    tool('merchant_dspace_import','Import the complete SHA-pinned host-declared source capture through the original HTTP action. Keep the same actor, revision, bytes and operation ID for a permitted retry.',change({input:alias,expectedSha256:hash}),['operator','scope','input','expectedSha256','operationId','expectedRevision','actor']),
    tool('merchant_dspace_save_edition','Create an immutable native dataset projection from exact original source/UUID/object-hash choices, selected metadata fields and explicit attribution/distribution basis. Original field/value arrays are preserved by the existing engine.',change({name:{type:'string',minLength:1,maxLength:128},mode:{enum:['items','metadata-values']},
      selection:{type:'array',minItems:1,maxItems:10000,items:sourceChoice},
      metadataFields:{type:'array',minItems:1,maxItems:256,items:{type:'string',minLength:1,maxLength:256}},rights,previousEditionId:id}),
      ['operator','scope','operationId','expectedRevision','actor','name','mode','selection','metadataFields','rights']),
    tool('merchant_dspace_review_edition','Save a named approval or requested correction of the exact retained edition SHA. The latest review governs its native merchant export.',change({editionId:id,editionSha256:hash,decision:{enum:['approved','needs-changes']},comment:{type:'string',minLength:1,maxLength:32000}}),
      ['operator','scope','operationId','expectedRevision','actor','editionId','editionSha256','decision','comment']),
    tool('merchant_dspace_select_edition','Select an exact edition with its latest matching approved review. Return the original dataset snapshot.',change({editionId:id,reviewId:id}),
      ['operator','scope','operationId','expectedRevision','actor','editionId','reviewId']),
    tool('merchant_dspace_compare','Retain the native before/after edition comparison, preserving substantive and source-provenance changes separately.',change({beforeId:id,afterId:id}),
      ['operator','scope','operationId','expectedRevision','actor','beforeId','afterId']),
    tool('merchant_dspace_query','Use the original native dataset query and cursor on a retained edition. Preserve dataset.snapshot and page.nextCursor across the original returned pages.',scoped({editionId:id,query:object}),['operator','scope','editionId'],read),
    tool('merchant_dspace_record_publication','Attach an actual original merchant publication receipt whose snapshot matches this edition. This records the supplied original receipt through the existing model.',change({editionId:id,publication:object}),
      ['operator','scope','operationId','expectedRevision','actor','editionId','publication']),
    tool('merchant_dspace_receive','Stream one complete SHA-pinned host-declared SQLite project through the original receiver. Preserve the receiving operation ID across lost replies; return the selected received project and its new binding.',scoped({input:alias,expectedSha256:hash,operationId:request}),
      ['operator','scope','input','expectedSha256','operationId']),
    tool('merchant_dspace_download','Retain a complete original export in host-owned private storage and return its immutable receiving manifest. Its exact file remains readable after project selection or operator restart.',scoped({kind:{enum:downloadKinds},id,expectedSha256:hash}),
      ['operator','scope','kind'],read),
    tool('merchant_dspace_download_read','Read the exact retained receiving manifest without opening or changing the original operator.',{operator:alias,downloadId:{type:'string',pattern:DSPACE_DOWNLOAD_ID.source}},
      ['operator','downloadId'],read),
    tool('merchant_dspace_file','Receive a retained original file in SHA-pinned chunks. Continue with readId and nextOffset; the host streams one immutable snapshot and returns exact complete-file metadata.',{
      operator:alias,downloadId:{type:'string',pattern:DSPACE_DOWNLOAD_ID.source},expectedSha256:hash,readId:uuid,offset:integer,
      limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['operator','downloadId','expectedSha256'],read),
    tool('merchant_dspace_file_release','Release one unfinished retained-file read while keeping its original complete export.',{operator:alias,downloadId:{type:'string',pattern:DSPACE_DOWNLOAD_ID.source},readId:uuid},
      ['operator','downloadId','readId'],{idempotent:true})
  ];
}
