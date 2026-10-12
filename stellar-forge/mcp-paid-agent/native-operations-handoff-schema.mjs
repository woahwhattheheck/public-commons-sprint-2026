// SPDX-License-Identifier: MIT
// Pure schema for the original native buyer's retained Inbox-to-Operations handoff.
const id={type:'string',pattern:'^[A-Za-z0-9._:-]{1,128}$'};
const alias={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const integer={type:'integer',minimum:0};
const page={offset:integer,limit:{type:'integer',minimum:1,maximum:100}};
const range={byteOffset:integer,maxBytes:{type:'integer',minimum:1,maximum:65536}};
const spec=(required,properties,description)=>({required,properties,description});
export const nativeOperationsHandoffOperations=Object.freeze({
  inboxes:spec([],{},'List existing host-registered read-only SF88 Inbox aliases. Omit inbox_alias to select this native workspace’s own original Inbox. No queue is created.'),
  jobs:spec([],{inbox_alias:alias,...page},
    'Page current original job identities and their saved-result status in the selected existing Inbox. This is a read, not recovery, execution, or finalization.'),
  export:spec(['id','intent_ids'],{id,inbox_alias:alias,
    intent_ids:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:id},
    max_verify_bytes:{type:'integer',minimum:0,maximum:1073741824}},
    'Retain this exact selection before calling the original SF88 exporter once. A repeated ID must keep the same ordered intent IDs, alias and verification limit. A saved handoff is reopened unchanged after a lost reply; an incomplete capture can continue only under its retained source binding. Default retained-output verification bound is 256 MiB per original output.'),
  list:spec([],{...page},'Page this workspace’s retained handoff requests. Listed file/receipt presence is not current content verification; inspect verifies the selected original.'),
  inspect:spec(['id'],{id,sha256:hash},
    'Verify the exact saved original handoff and return its identity, outcome counts and receipt status without opening or recapturing its source Inbox. An optional SHA pins the expected saved source.'),
  rows:spec(['id','sha256'],{id,sha256:hash,...page},
    'Page the original SF88/SF52/SF36 interpreted rows from a SHA-pinned saved handoff. The tool response is bounded; an oversized row supplies its exact JSON byte identity for the row operation instead of truncating fields.'),
  row:spec(['id','sha256','row_index','row_sha256'],{id,sha256:hash,row_index:integer,row_sha256:hash,...range},
    'Read exact interpreted-row JSON bytes from a selected saved source, at most 64 KiB per call. Keep both the original source SHA and row SHA across ranges. The complete raw source remains available through read.'),
  read:spec(['id','sha256'],{id,sha256:hash,...range},
    'Read the complete unchanged original handoff JSON through the existing verified saved-file reader, at most 64 KiB per call. Keep its SHA across ranges. The resulting private file can be inspected and explicitly received by the original SF47 Operations workspace.')
});
export const nativeOperationsHandoffActions=Object.freeze(['operations-handoff']);
export const nativeOperationsHandoffSchema=Object.freeze({
  properties:{
    operationsHandoffOperation:{type:'string',enum:Object.keys(nativeOperationsHandoffOperations),
      description:'Original Inbox selection, one retained export, saved-source review and exact byte receiving. No payment or settlement operation.'},
    operationsHandoffRequest:{type:'object',description:'Exact fields for the selected handoff operation. Host paths are never model inputs; reuse the stable handoff ID after an uncertain response.'}
  },
  anyOf:Object.entries(nativeOperationsHandoffOperations).map(([operation,{required,properties,description}])=>({
    required:['action','operationsHandoffOperation',...(required.length?['operationsHandoffRequest']:[])],
    properties:{action:{const:'operations-handoff'},operationsHandoffOperation:{const:operation},
      operationsHandoffRequest:{type:'object',additionalProperties:false,required,properties,description}}
  }))
});
