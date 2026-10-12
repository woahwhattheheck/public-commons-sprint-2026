// SPDX-License-Identifier: MIT
// Original DuckDB service operations for exact Timescale commissioning sources.
import {reconciliationDefinition} from './native-duckdb-reconciliation-schema.mjs';
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const requestId={type:'string',pattern:'^[a-f0-9]{32}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const alias={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const text={type:'string'};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const columns={type:'array',minItems:1,maxItems:512,items:{type:'object',additionalProperties:false,
 required:['source','name','type','nullable'],properties:{source:text,name:text,
 type:{type:'string',description:'Original reviewed DuckDB type. VARCHAR preserves native text. BOOLEAN accepts original t/f/true/false. Explicit DECIMAL(p,s), BIGINT/HUGEINT, DATE/TIMESTAMP/TIMESTAMPTZ and JSON use native validation; DOUBLE requires allow_approximate.'},
 nullable:{type:'boolean'}}}};
export const timescaleIntakeInterpretation=Object.freeze({
 type:'object',additionalProperties:false,required:['columns','scope_note','null_note','time_note'],
 properties:{columns:{type:'array',minItems:1,maxItems:512,items:{type:'object',additionalProperties:false,
  required:['source','role','meaning'],properties:{source:text,role:{enum:['tag','time','value','quality','attribute']},
   meaning:text,units:text,timezone:text,precision:text}}},
  scope_note:text,null_note:text,time_note:text,allow_approximate:{type:'boolean'}},
 description:'Every original source field exactly once; at least one tag and value, at most one time. Explicit reviewed scope/null/time meaning. Units and timezone are descriptions, never implicit conversions.'
});
const spec=(required,properties,description)=>({required,properties,description});
export const nativeDuckDBTimescaleOperations=Object.freeze({
 'timescale-intake-status':spec([],{},'Read original Timescale intake counts in the existing customer warehouse.'),
 'timescale-intake-registered-reports':spec([],{...page},'Page host-declared exact original commissioning report aliases. Paths and capability values are never returned.'),
 'timescale-intake-reports':spec([],{...page},'Page reports retained in the original warehouse file/chunk tables. No provider capture.'),
 'timescale-intake-report':spec(['report_id'],{report_id:hash},'Read the checked original report identities and all immutable source descriptors.'),
 'timescale-intake-source':spec(['report_id','source_id'],{report_id:hash,source_id:uuid,...page,q:text},
  'Page all original string/null source values and PostgreSQL OIDs where declared. Search changes display only, never the imported scope.'),
 'timescale-intake-retain':spec(['request_id','source','sha256'],{request_id:requestId,source:alias,sha256:hash},
  'Retain the selected host-configured original report bytes and its exact digest. This is an explicit Timescale source, never an SF88/SF100 receipt or acquisition.'),
 'timescale-intake-review':spec(['request_id','report_id','source_id','columns','interpretation'],
  {request_id:requestId,report_id:hash,source_id:uuid,columns,interpretation:timescaleIntakeInterpretation,
   keys:{type:'array',maxItems:0}},
  'Retain complete explicit field/type/tag/time/value/quality interpretation after every row passes native conversion. Empty keys preserve duplicate observations.'),
 'timescale-intake-import':spec(['request_id','review_id'],{request_id:requestId,review_id:hash},
  'Import the exact reviewed source through the original immutable edition transaction; same request/review reuses its original outcome.'),
 'timescale-intake-reviews':spec([],{...page},'Page all retained source reviews and their imported edition IDs.'),
 'timescale-intake-request':spec(['request_id'],{request_id:requestId},'Inspect one exact request/body/state without replay. Missing request is explicit.'),
 'timescale-intake-operations':spec([],{...page},'Page original intake request history. COMPLETE.result is the original native outcome.'),
 'timescale-intake-resume':spec(['request_id'],{request_id:requestId},
  'Explicitly resume the same original body with the registered workspace identity. An unreceived report needs the original registered retain call again; never choose a new ID.'),
 'timescale-intake-pair-review':spec(['definition'],{definition:reconciliationDefinition},
  'Review distinct BASELINE/OBSERVED Timescale editions through the existing paired engine, retaining scope and type semantics.'),
 'timescale-intake-save-pair':spec(['request_id','expected_revision','definition','review_sha256'],
  {request_id:requestId,expected_revision:{type:'integer',minimum:0},definition:reconciliationDefinition,review_sha256:hash},
  'Save the reviewed original pair. Continue run/decisions/saved reports/full portable export using the existing reconcile-* operations.'),
 'timescale-intake-manifest':spec(['report_id'],{report_id:hash},
  'Read the small exact original receiving manifest descriptor for this retained report and guide.'),
 'timescale-intake-file':spec(['report_id','filename','sha256'],
  {report_id:hash,filename:{enum:['original-commissioning.json','TIMESCALE_INTAKE.md','intake-receiving.json']},
   sha256:hash,byteOffset:{type:'integer',minimum:0},maxBytes:{type:'integer',minimum:1,maximum:65536}},
  'Read an exact authenticated HTTP range from an original retained file; strong whole-file ETag and SHA bind every chunk. No source recapture or SQL execution.')
});
