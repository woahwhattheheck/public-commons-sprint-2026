// SPDX-License-Identifier: MIT
// Event operations join the existing native Analysis action and private service.
const id={type:'string',pattern:'^[a-f0-9]{32}$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const programme={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{0,23}$'};
const natural={type:'integer',minimum:0},positive={type:'integer',minimum:1};
const note={type:'string',minLength:1,maxLength:8000};
const range={byteOffset:natural,maxBytes:{type:'integer',minimum:1,maximum:65536}};
const file=maximum=>({type:'object',additionalProperties:false,required:['name','bytes','sha256'],
 properties:{name:{type:'string',minLength:1,maxLength:240},bytes:{type:'integer',minimum:0,maximum},sha256:hash}});
const mapping={type:'object',additionalProperties:false,required:['fields'],properties:{
 schema:{const:'stellar-forge.event-feed-analysis-mapping.v1'},
 fields:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['name','pointer'],
 properties:{name:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{0,47}$'},pointer:{type:'string',maxLength:2000}}}}}};
const common={programme,id,operation_id:id,resume:{type:'boolean'}};
const spec=(required,properties,description)=>({required,properties,description});
export const nativeEventOperations=Object.freeze({
 'event-overview':spec([],{actions_before:positive,inputs_before:positive,limit:{type:'integer',minimum:1,maximum:100},
 programme_offset:natural,programme_limit:{type:'integer',minimum:1,maximum:100}},
 'Read original event input/action history and programme metadata. Independent cursors remain native; complete response bytes are retained as an exact record.'),
 'event-input-create':spec(['id','files'],{id,files:{type:'object',additionalProperties:false,required:['ndjson','manifest'],
 properties:{ndjson:file(33554432),manifest:file(4194304)}}},'Retain one complete original NDJSON/manifest selection before sending its bytes. Repeating the same ID requires the same files.'),
 'event-input':spec(['id'],{id},'Read the original complete file identities and accepted offsets; resume this exact file pair.'),
 'event-input-fields':spec(['id'],{id,field_offset:natural,field_limit:{type:'integer',minimum:1,maximum:50}},
 'Inspect every actual payload path from one complete original source pair. Coverage is complete; concise examples are previews. Receive the exact complete record before selecting fields.'),
 'event-input-values':spec(['id','pointer'],{id,pointer:{type:'string',maxLength:2000},offset:natural,limit:{type:'integer',minimum:1,maximum:100}},
 'Read a complete original event-index page for one exact payload pointer, retaining missing/null/kinds and exact native text values in the immutable full record.'),
 'event-input-chunk':spec(['id','kind','offset','base64','sha256'],{id,kind:{enum:['ndjson','manifest']},offset:natural,
 base64:{type:'string',minLength:1,maxLength:87384},sha256:hash},'Receive up to64KiB original bytes at the retained offset; identical replay is accepted by the original SQLite receiver.'),
 'event-programme':spec(['programme'],{programme,offset:natural,limit:{type:'integer',minimum:1,maximum:100}},
 'Read the original customer programme and paged operation summaries. Read the full retained record for exact mappings, reviews and customer definitions.'),
 'event-review':spec(['programme','id','operation_id','input_id','mapping'],{...common,input_id:id,mapping},
 'Review the full received original event window through the existing native programme. The input, mapping and stable action are saved before dispatch.'),
 'event-apply':spec(['programme','id','operation_id','review_sha256','note'],{...common,review_sha256:hash,note,
 columns:{type:'object',description:'Complete existing workbook replacement-column arrays keyed by original sheet index. Original WorkbookRefresh validates every selected column.'}},
 'Apply the exact reviewed complete window and customer choices. Preserve this action ID and request across an uncertain reply.'),
 'event-refresh-review':spec(['programme','id','operation_id','review_sha256','note'],{...common,review_sha256:hash,note},
 'Review current customer edits for the same unfinished applied-source operation, retaining the preceding attempt.'),
 'event-deliver':spec(['programme','id','operation_id'],common,
 'Prepare a fresh linked whole-workspace delivery from an accepted result. The action ID becomes its retained delivery ID; reusing it retains its original snapshot.'),
 'event-action':spec(['id'],{id},'Read the saved original action, current progress and full result record; ERROR or INTERRUPTED continues only with the same request and explicit resume.'),
 'event-record-file':spec(['kind','record_id','sha256','bytes'],{kind:{enum:['overview','programme','action','fields','values']},
 record_id:{type:'string',minLength:1,maxLength:24+32},sha256:hash,bytes:{type:'integer',minimum:1,maximum:67108864},...range},
 'Read every exact byte of a retained native response, at most64KiB per call. Bind all ranges to the same selected digest and original workspace.'),
 'event-delivery-index':spec(['programme','delivery_id'],{programme,delivery_id:id},
 'Inspect the complete original16-file customer delivery and its immutable index before downloading.'),
 'event-delivery-file':spec(['programme','delivery_id','index_sha256','filename','sha256'],{programme,delivery_id:id,
 index_sha256:hash,filename:{type:'string',minLength:1,maxLength:120},sha256:hash,...range},
 'Read an exact original customer delivery file through the existing verified descriptor/cache. After restore prepare a fresh linked delivery first.')
});
