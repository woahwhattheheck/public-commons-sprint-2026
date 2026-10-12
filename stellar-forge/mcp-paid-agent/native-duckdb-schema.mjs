// SPDX-License-Identifier: MIT
// Pure schema for the original DuckDB customer service, without runtime imports.
const alias={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const name={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{0,119}$'};
const id={type:'string',pattern:'^[a-f0-9]{64}$'};
const requestId={type:'string',pattern:'^[a-f0-9]{32}$'};
const hash=id;
const integer={type:'integer',minimum:0};
const revision={type:'integer',minimum:1};
const text={type:'string'};
const page={offset:integer,limit:{type:'integer',minimum:1,maximum:100}};
const views={type:'array',items:{type:'object',additionalProperties:false,
 required:['name','edition_id','revision'],properties:{name,edition_id:id,revision}},
 description:'The complete current original views list. Retain every name, exact edition and revision; the native transaction rejects a changed selection.'};
const parameters={type:'string',maxLength:524288,
 description:'JSON array/object text. Exact integer/decimal tokens are sent unchanged to Python; do not pre-round them in JavaScript.'};
const columns={type:'array',minItems:1,maxItems:1024,items:{type:'object',additionalProperties:false,
 required:['source','name','type','nullable'],properties:{
 source:text,name:text,type:{type:'string',description:'Original native supported type: VARCHAR, BOOLEAN, BIGINT, HUGEINT, DOUBLE, DATE, TIMESTAMP, TIMESTAMPTZ, JSON or DECIMAL(p,s).'},
 nullable:{type:'boolean'}}}};
const keys={type:'array',uniqueItems:true,items:text};
const sql={type:'string',minLength:1,maxLength:262144};
const exported={type:'string',pattern:'^(?:[a-f0-9]{64}|handoff-[a-f0-9]{32})$'};
const spec=(required,properties,description)=>({required,properties,description});
export const nativeDuckDBOperations=Object.freeze({
 workspaces:spec([],{},'List host-registered original DuckDB customer aliases. No service start or warehouse creation.'),
 state:spec([],{},'Read the selected original warehouse identity and current view selections. Original source/edition/query/export catalogs remain separately pageable.'),
 sources:spec([],{...page},'Page original host-registered, exact-hash SF100 report aliases. No local paths or source purchases.'),
 'inspect-source':spec(['source'],{source:alias},'Inspect all rows of an original retained SF100 delivery using the native DuckDB mapping inspector; preview rows remain explicitly partial.'),
 review:spec(['source','source_sha256','columns','keys'],{source:alias,source_sha256:hash,columns,keys},
  'Retain the complete reviewed native field/type/key mapping for this exact original source. The content-addressed review is safely reused.'),
 import:spec(['review_id'],{review_id:id},'Import the original reviewed delivery into its immutable DuckDB edition. Repeating this exact review returns the existing edition.'),
 editions:spec([],{before:revision,limit:{type:'integer',minimum:1,maximum:100}},'Page original immutable editions, with their original sequence cursor.'),
 edition:spec(['edition_id'],{edition_id:id},'Read one exact edition, original source identities and field/key mapping.'),
 reviews:spec([],{...page},'Page original retained review records.'),
 'review-read':spec(['review_id'],{review_id:id},'Read the exact original saved source mapping.'),
 views:spec([],{...page},'Page current original view selections. Assemble all pages when supplying expected_views.'),
 activate:spec(['name','edition_id','expected_revision'],{name,edition_id:id,expected_revision:integer},
  'Select an exact existing edition under the original native view CAS. An uncertain response requires reading the current view before any repeat.'),
 queries:spec([],{...page},'Page original saved SQL recipes and their revisions.'),
 'saved-query':spec(['query_id'],{query_id:id},'Read the current original saved recipe; this resolves an uncertain save before another CAS.'),
 'save-query':spec(['name','sql','expected_revision'],{name,sql,parameters_text:parameters,expected_revision:integer},
  'Save read-only native SQL with exact JSON parameters and original revision CAS. This does not execute the query.'),
 query:spec(['sql','expected_views'],{sql,parameters_text:parameters,expected_views:views,max_rows:{type:'integer',minimum:1,maximum:100}},
  'Read a native SQL preview against all reviewed view revisions. Native typed cells preserve large integers/decimals; truncation is explicit. Use a saved recipe and export for complete results.'),
 compare:spec(['before_id','after_id'],{before_id:id,after_id:id,keys,max_rows:{type:'integer',minimum:1,maximum:100}},
  'Compare the complete original immutable editions by compatible unique non-null keys. Totals are complete; change rows are a labeled preview.'),
 exports:spec([],{...page},'Page complete original query exports, retaining original SQL types, stored Parquet types and lossless representation declarations.'),
 'export-read':spec(['export_id'],{export_id:exported},'Read the exact complete export/handoff manifest and file identities.'),
 export:spec(['request_id','query_id','expected_revision','expected_views'],{request_id:requestId,query_id:id,expected_revision:revision,expected_views:views},
  'Run the original retained full-query export to complete Parquet/CSV. Keep this stable request ID; inspect operation/resume after an uncertain reply.'),
 'source-handoff':spec(['request_id','edition_id'],{request_id:requestId,edition_id:id},
  'Export all original verified files embedded in one selected edition. It never requests the provider again.'),
 handoff:spec(['request_id'],{request_id:requestId},
  'Create the original portable warehouse handoff, including retained editions, source bytes, selected views and saved recipes. Sparse logical database bytes remain exact.'),
 handoffs:spec([],{...page},'Page original complete source and warehouse handoffs.'),
 operations:spec([],{...page},'Page the original retained export/handoff operation journal.'),
 operation:spec(['request_id'],{request_id:requestId},'Read the exact native request and current outcome without resuming it.'),
 resume:spec(['request_id'],{request_id:requestId},
  'Explicitly resume the SAME original retained export/handoff request. The original native engine decides exact-existing reuse; no replacement ID or automatic retry.'),
 file:spec(['export_id','filename','sha256'],{export_id:exported,filename:{type:'string',minLength:1,maxLength:1024},sha256:hash,
 byteOffset:integer,maxBytes:{type:'integer',minimum:1,maximum:65536}},
  'Read one exact file declared by the selected completed native export, through the existing verified saved-file reader. Complete data is base64 in at most64KiB ranges; no SQL rerun or repeated whole-file HTTP download.')
});
export const nativeDuckDBActions=Object.freeze(['duckdb']);
export const nativeDuckDBSchema=Object.freeze({
 properties:{
  duckdbWorkspace:{...alias,description:'Existing host-registered original DuckDB customer alias; a warehouse path/URL is never a tool argument.'},
  duckdbOperation:{type:'string',enum:Object.keys(nativeDuckDBOperations)},
  duckdbRequest:{type:'object',description:'Original operation-specific fields. Stable request IDs are32 lowercase hex; edition/query IDs are64 lowercase hex.'}
 },
 anyOf:Object.entries(nativeDuckDBOperations).map(([operation,{required,properties,description}])=>({
  required:['action','duckdbOperation',...(operation==='workspaces'?[]:['duckdbWorkspace']),...(required.length?['duckdbRequest']:[])],
  properties:{action:{const:'duckdb'},duckdbOperation:{const:operation},
   duckdbRequest:{type:'object',additionalProperties:false,required,properties,description}}
 }))
});

