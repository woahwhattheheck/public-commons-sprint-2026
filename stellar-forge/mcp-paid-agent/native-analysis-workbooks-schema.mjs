// SPDX-License-Identifier: MIT
// Pure native-agent schema for the original customer workbook application.
const name={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^[a-f0-9]{32}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const integer={type:'integer',minimum:0};
const revision={type:'integer',minimum:1};
const text={type:'string'};
const source={type:'object',additionalProperties:false,required:['kind','id','sha256'],
  properties:{kind:{enum:['query-export','report']},id,sha256:hash,section:integer},
  description:'Copy the selected original complete source ID and SHA256. Reports require the original section ordinal. Query exports must retain typed JSONL.'};
const column={type:'object',additionalProperties:false,required:['source'],
  properties:{source:text,source_index:integer,header:text,
    type:{enum:['native','text','integer','number','decimal-text','boolean','date','datetime-utc','datetime-local','binary-base64']},
    null:{enum:['blank','text']},null_text:text,precision:{enum:['preserve','excel-number']}},
  description:'Original column projection. For report cells copy both source label and source_index, especially when labels repeat. Precision defaults to preserve; decimal-text retains decimal spelling and scale. Source strings remain literal text.'};
const sheets={type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,
  required:['name','source','columns'],properties:{
    name:{type:'string',minLength:1,maxLength:31},source,
    columns:{type:'array',minItems:1,maxItems:16384,items:column}}}};
const definition={type:'object',additionalProperties:false,required:['name','title','sheets'],
  properties:{name,title:{type:'string',minLength:1,maxLength:300},notes:{type:'string',maxLength:16000},sheets}};
const refresh={name,base_revision:revision,definition_sha256:hash,expected_revision:revision,
  reason:{type:'string',minLength:1,maxLength:8000},definition};
const refreshRequired=['name','base_revision','definition_sha256','expected_revision','reason','definition'];
const spec=(required,properties,description)=>({required,properties,description});
export const nativeWorkbookOperations=Object.freeze({
  workbooks:spec([],{offset:integer,limit:{type:'integer',minimum:1,maximum:100}},
    'Page saved workbook definitions in the same original AnalysisWorkspace. The current definition remains separate from its immutable historical revisions.'),
  'workbook-sources':spec([],{kind:{enum:['query-export','report']},before:revision,
    limit:{type:'integer',minimum:1,maximum:100}},
    'Discover complete original typed query exports or published report sections. Keep IDs, exact SHA256, source scope, column order and the original next_before cursor.'),
  'save-workbook':spec(['name','id','expected_revision','title','sheets'],{
    name,id,expected_revision:integer,title:definition.properties.title,notes:definition.properties.notes,sheets},
    'Save the complete source-bound workbook through its original stable request ID and revision compare-and-swap. This creates an immutable definition; it does not build, re-query, acquire or pay. Reuse the exact request after an uncertain reply.'),
  'workbook-definition':spec(['name'],{name,revision},
    'Read the current or exact historical original definition, definition SHA256 and saved revision history.'),
  'workbook-preview':spec(['name','revision','definition_sha256'],{
    name,revision,definition_sha256:hash,sheet:integer,limit:{type:'integer',minimum:1,maximum:100}},
    'Preview original projected cells for the exact saved definition. preview_only explicitly distinguishes a sample from a complete build. Source ordinals, types, null and precision choices remain original.'),
  workbook:spec(['id','name','revision','definition_sha256'],{id,name,revision,definition_sha256:hash},
    'Build the complete reviewed workbook through the original AnalysisWorkspace worker. Keep the request ID and reopen it with job; no bounded preview is substituted for full source rows.'),
  'workbook-runs':spec([],{before:revision,limit:{type:'integer',minimum:1,maximum:100}},
    'Page original workbook build history, status, progress and completed retained file identities.'),
  'cancel-workbook':spec(['id'],{id},
    'Ask the original workbook worker to cancel the selected build. A complete published delivery remains complete; reopen the original job to see its actual outcome.'),
  'workbook-file':spec(['id','filename','manifest_sha256','sha256'],{
    id,filename:{enum:['workbook.xlsx','handoff.zip','manifest.json']},manifest_sha256:hash,sha256:hash,
    byteOffset:integer,maxBytes:{type:'integer',minimum:1,maximum:65536}},
    'Read the exact completed workbook, full portable handoff or manifest through the original verified SavedFileReader. Reuse both manifest and file SHA256 across 64 KiB chunks and after restart. The handoff retains definitions and complete typed source files; no whole-file HTTP reread or alternate workbook writer.'),
  'workbook-candidates':spec(['name','revision','definition_sha256'],{
    name,revision,definition_sha256:hash,sheet:integer,before:revision,limit:{type:'integer',minimum:1,maximum:100}},
    'Discover newer complete results through the original workbook lineage matcher. Read exact SQL/parameters, source editions and duplicate or reordered labels; decide which sources and columns to keep, replace, remap or drop. The original cursor can be empty even when another page exists.'),
  'workbook-refresh-review':spec(refreshRequired,refresh,
    'Review a proposed recurring edition through the original workbook source and mapping review. Include every existing worksheet in order, preserve the original source for sheets being kept, and explicitly map report column ordinals. Retain the returned review_sha256 and inspect readiness, source changes and partial cell previews.'),
  'workbook-refresh-save':spec([...refreshRequired,'id','review_sha256'],{...refresh,id,review_sha256:hash},
    'Save the identical reviewed recurring edition using the original review digest, stable request ID and definition CAS. The complete handoff carries exact predecessor definitions and their original source files. Replaying a committed request recovers its historical saved revision.'),
});
