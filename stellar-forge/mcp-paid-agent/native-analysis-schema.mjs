// SPDX-License-Identifier: MIT
// Pure tool schema: safe to import without the local analytical host or filesystem.
const name={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^[a-f0-9]{32}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const integer={type:'integer',minimum:0};
const revision={type:'integer',minimum:1};
const text={type:'string'};
const parameters={type:'string',description:'JSON array/object TEXT. Retain signed 64-bit integers and decimal strings exactly; do not round them in JavaScript.'};
const views={type:'array',items:{type:'object',additionalProperties:false,
  required:['name','version_id','revision'],properties:{name,version_id:hash,revision}},
  description:'Copy the entire original state.views array after reviewing the selected data. The original transaction rejects changed selections.'};
const range={byteOffset:integer,maxBytes:{type:'integer',minimum:1,maximum:65536},sha256:hash};
const page={offset:integer,limit:{type:'integer',minimum:1,maximum:100}};
const mapping={type:'object',additionalProperties:false,required:['columns'],properties:{
  collection:{...text,description:'Original JSON Pointer to the row collection; empty means the root.'},
  sse_data:{enum:['text','json']},
  columns:{type:'array',minItems:1,maxItems:256,items:{type:'object',additionalProperties:false,
    required:['name','pointer'],properties:{name:text,pointer:text,
      type:{enum:['native','text','integer','number','boolean','json']},missing:{enum:['error','null']}}}}
}};
const query={sql:{type:'string',minLength:1,maxLength:131072},parameters_text:parameters,
  max_rows:{type:'integer',minimum:1,maximum:100000}};
const section={type:'object',additionalProperties:false,required:['title','query_name','query_revision'],
  properties:{title:{type:'string',minLength:1,maxLength:300},note:text,query_name:name,
    query_revision:revision,parameters_text:{anyOf:[parameters,{type:'null'}]}}};
const spec=(required,properties,description)=>({required,properties,description});
export const nativeAnalysisOperations=Object.freeze({
  workspaces:spec([],{},'List immutable host-registered original analysis workspace aliases.'),
  state:spec([],{},'Read the original selected views, source aliases, recipes, reports and recent jobs.'),
  sources:spec([],{...page},'Page host-registered native dataset/API/stream sources without exposing local paths.'),
  'attach-dataset':spec(['acquisition_id','name','expected_revision'],{
    acquisition_id:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,128}$'},name,expected_revision:integer},
    'Attach a COMPLETE original native dataset acquisition already retained by this MCP workspace. The host supplies and verifies its original session and SF100 room. No acquisition or payment.'),
  'response-source':spec(['name','revision'],{name,revision,collection:text,sse_data:{enum:['text','json']}},
    'Inspect a host-registered original response revision and discover row collections/field hints. Samples are explicitly partial; response-preview scans all projected rows.'),
  versions:spec([],{before:revision},'Page immutable imported data editions.'),
  version:spec(['version_id'],{version_id:hash},'Read one exact retained data edition and its original source identity.'),
  manifest:spec(['version_id'],{version_id:hash},'Read the original hash-verified retained source manifest as structured JSON.'),
  import:spec(['id','source','source_revision'],{id,source:name,source_revision:revision,columns_text:parameters},
    'Start the original dataset import. columns_text is an optional JSON object of original field-to-SQL-column mappings. Keep the request ID for recovery.'),
  'response-preview':spec(['id','source','source_revision','mapping'],{id,source:name,source_revision:revision,mapping},
    'Scan the entire explicitly mapped original response through the native projection and retain its exact preview digest.'),
  'response-import':spec(['id','preview_id','preview_sha256'],{id,preview_id:id,preview_sha256:hash,allow_incomplete:{type:'boolean'}},
    'Import the reviewed complete projection into the original database. Incomplete original streams require explicit allow_incomplete=true; their original status is retained.'),
  activate:spec(['name','version_id','expected_revision'],{name,version_id:hash,expected_revision:integer},
    'Select the exact reviewed immutable edition under a SQL view; compare-and-swap preserves the original view history.'),
  'save-query':spec(['name','sql','expected_revision'],{name,...query,expected_revision:integer},
    'Save a query recipe at the reviewed revision. On an uncertain reply, read saved-query before retrying; this original API has revision CAS, not a request ID.'),
  'saved-query':spec(['name'],{name,revision},'Read the current or exact historical query recipe.'),
  query:spec(['id','sql','expected_views'],{id,...query,expected_views:views},
    'Run original read-only SQL against the reviewed selection. The result is bounded by max_rows and explicitly reports truncation; use report jobs for retained multi-section reporting.'),
  job:spec(['id'],{id,...page},'Reopen the same original job, including after an uncertain reply or service restart. Page typed query rows.'),
  compare:spec(['id','view','expected_revision','base_version_id','candidate_version_id','keys'],{
    id,view:name,expected_revision:revision,base_version_id:hash,candidate_version_id:hash,
    keys:{type:'array',minItems:1,maxItems:16,uniqueItems:true,items:text}},
    'Compare complete retained editions using explicit non-null unique typed keys. Source queries may differ; preserve that interpretation when reviewing added/removed rows.'),
  comparisons:spec([],{before:revision},'Page original retained comparison history.'),
  comparison:spec(['id'],{id,kind:{enum:['all','added','removed','changed','moved']},after:integer,
    limit:{type:'integer',minimum:1,maximum:100}},'Read exact comparison rows, source scope, current selection and review identity. next_after is the original ordinal cursor.'),
  select:spec(['comparison_id','id','result_sha256'],{comparison_id:id,id,result_sha256:hash,note:text},
    'Record the exact comparison review and atomically select its candidate through the original view CAS. Repeating the same request returns its historical selection.'),
  'change-export':spec(['id','comparison_id','result_sha256','selection_sha256','format'],{
    id,comparison_id:id,result_sha256:hash,selection_sha256:hash,format:{enum:['json','csv']}},
    'Export a frozen comparison plus its selected-review identity. Read completed bytes with file.'),
  'save-report':spec(['name','id','expected_revision','title','sections'],{
    name,id,expected_revision:integer,title:{type:'string',minLength:1,maxLength:300},introduction:text,
    sections:{type:'array',minItems:1,maxItems:12,items:section}},
    'Retain a complete report definition pinned to original saved query revisions. Use a stable ID; one report execution reads all sections in the same SQLite snapshot.'),
  'report-definition':spec(['name'],{name,revision},'Read a report definition and its original definition SHA256.'),
  report:spec(['id','name','revision','definition_sha256','expected_views'],{
    id,name,revision,definition_sha256:hash,expected_views:views},
    'Run all pinned report sections in one original database snapshot. Complete rows and result identity are retained together.'),
  'report-runs':spec([],{name,before:revision},'Page original report executions.'),
  'report-read':spec(['id'],{id,section:integer,...page},
    'Read a completed report, typed section rows and original publication revision for review.'),
  publish:spec(['report_id','id','result_sha256','expected_revision'],{
    report_id:id,id,result_sha256:hash,expected_revision:integer,note:text},
    'Freeze the reviewed report under its original publication revision. The stable ID and result SHA protect replay; publication does not re-query data.'),
  publications:spec([],{name,before:revision},'Page original immutable publications, including their original SHA256.'),
  'report-export':spec(['id','publication_id','publication_sha256','format'],{
    id,publication_id:id,publication_sha256:hash,format:{enum:['json','html','csv']}},
    'Generate exact bytes from a retained publication; CSV format is the original multi-section ZIP. A restored database can regenerate with a new export job and no source re-query.'),
  'query-export':spec(['id','query_id','result_sha256'],{
    id,query_id:id,result_sha256:hash,label:{type:'string',maxLength:160},
    formats:{type:'array',minItems:1,maxItems:3,uniqueItems:true,items:{enum:['jsonl','csv','sqlite']}},
    timeout:{type:'number',exclusiveMinimum:0,maximum:86400},
    max_rows:{anyOf:[revision,{type:'null'}]},max_output_bytes:{anyOf:[revision,{type:'null'}]},
    spreadsheet_safe:{type:'boolean'}},
    'Use the original full-query export controller on a retained reviewed query result. It keeps the original SQL, exact parameters and selected views, and streams complete JSONL/CSV/SQLite with original cancellation and recovery.'),
  'query-exports':spec([],{before:revision},'Page original full-query exports and retained progress.'),
  'cancel-query-export':spec(['id'],{id},'Request cancellation from the original query-export worker. A published complete manifest remains complete.'),
  'query-export-file':spec(['id','filename'],{id,filename:{enum:['rows.jsonl','rows.csv','rows.sqlite3','manifest.json']},...range},
    'Read an original completed full-query export through the shared verified native descriptor/hash cache, at most 64 KiB per call. Native manifest and source query retain exact types and source bindings; no whole-file HTTP reread or new export.'),
  backup:spec(['id'],{id},'Create the original portable SQLite backup containing imported rows, recipes, histories, reports and publications. External native files/registrations remain host-side.'),
  file:spec(['id'],{id,...range},'Read a completed report-export/change-export/backup through the original verified descriptor, at most 64 KiB per call. Reuse sha256 across ranges.'),

});
export const nativeAnalysisActions=Object.freeze(['analysis']);
export const nativeAnalysisSchema=Object.freeze({
  properties:{
    analysisWorkspace:{...name,description:'Existing host-registered AnalysisWorkspace alias. Paths and capabilities are not model inputs.'},
    analysisOperation:{type:'string',enum:Object.keys(nativeAnalysisOperations),
      description:'Use the original customer data service: attach completed data, review/import, SQL, comparison, retained report/publication, files and backup.'},
    analysisRequest:{type:'object',description:'Operation-specific original fields. Stable IDs are 32 lowercase hex characters. Exact SQL values belong in parameters_text JSON.'}
  },
  anyOf:Object.entries(nativeAnalysisOperations).map(([operation,{required,properties,description}])=>({
    required:['action','analysisOperation',...(operation==='workspaces'?[]:['analysisWorkspace']),
      ...(required.length?['analysisRequest']:[])],
    properties:{action:{const:'analysis'},analysisOperation:{const:operation},
      analysisRequest:{type:'object',additionalProperties:false,required,properties,description}}
  }))
});
