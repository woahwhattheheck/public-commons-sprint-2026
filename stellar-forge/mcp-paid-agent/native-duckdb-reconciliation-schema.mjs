// SPDX-License-Identifier: MIT
// Pure additive contract for the ORIGINAL DuckDB warehouse reconciliation.
const id={type:'string',pattern:'^[a-f0-9]{64}$'};
const requestId={type:'string',pattern:'^[a-f0-9]{32}$'};
const revision={type:'integer',minimum:0};
const name={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{0,119}$'};
const text={type:'string'};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const map={type:'array',maxItems:10000,items:{type:'object',additionalProperties:false,required:['original','canonical'],
 properties:{original:{type:'string',maxLength:4096},canonical:{type:'string',maxLength:4096}}}};
export const reconciliationDefinition=Object.freeze({
 type:'object',additionalProperties:false,required:['name','label','source_edition','target_edition','columns'],
 properties:{name,label:{type:'string',minLength:1,maxLength:240},source_edition:id,target_edition:id,
  columns:{type:'array',minItems:1,maxItems:64,items:{type:'object',additionalProperties:false,
   required:['name','source','target','role'],properties:{name,source:text,target:text,role:{enum:['key','value']},
    meaning:text,source_map:map,target_map:map}}},
  window_column:{anyOf:[name,{type:'null'}]},windows:{type:'array',maxItems:32,items:{type:'object',additionalProperties:false,
   required:['id','start','end','basis'],properties:{id:name,start:text,end:text,basis:{enum:['native','lexical']}}}},
  notes:text},
 description:'Exact source/target field and SQL-type matching, at least one key. Empty value maps preserve identity; explicit VARCHAR maps quarantine every unmapped non-null value. Windows are nonoverlapping half-open intervals; no implicit trimming, rounding, units, timezone or tolerance conversion.'
});
const subject={oneOf:[
 {type:'object',additionalProperties:false,required:['kind','group_id'],properties:{kind:{const:'group'},group_id:{type:'integer',minimum:1}}},
 {type:'object',additionalProperties:false,required:['kind','side','row'],properties:{kind:{const:'row'},side:{enum:['source','target']},row:{type:'integer',minimum:1}}}
]};
const spec=(required,properties,description)=>({required,properties,description});
export const nativeDuckDBReconciliationOperations=Object.freeze({
 'reconcile-status':spec([],{},'Read paired-workflow counts in the SAME original warehouse; no new service or capture.'),
 'reconcile-review':spec(['definition'],{definition:reconciliationDefinition},'Read and hash the complete mapping, native types, source meanings and window contracts before saving.'),
 'reconcile-pairs':spec([],{...page},'Page retained pair definitions and current revisions.'),
 'reconcile-pair':spec(['pair_id'],{pair_id:id,revision:{type:'integer',minimum:1}},'Read a retained pair or an exact historical revision.'),
 'reconcile-save-pair':spec(['request_id','expected_revision','definition','review_sha256'],
  {request_id:requestId,expected_revision:revision,definition:reconciliationDefinition,review_sha256:id},
  'Save the reviewed pair under the original request journal and revision CAS; new pair expected_revision is0.'),
 'reconcile-runs':spec([],{...page,pair_id:id},'Page immutable complete reconciliation runs.'),
 'reconcile-run':spec(['run_id'],{run_id:id},'Read exact full row accounting, category totals and current engineer decision revision.'),
 'reconcile-execute':spec(['request_id','pair_id','expected_revision','definition_sha256'],
  {request_id:requestId,pair_id:id,expected_revision:{type:'integer',minimum:1},definition_sha256:id},
  'Account for EVERY row in the exact reviewed immutable pair; equal multiset multiplicity never chooses an arbitrary duplicate pairing.'),
 'reconcile-groups':spec(['run_id'],{run_id:id,...page,
  category:{enum:['MATCHED','SOURCE_ONLY','TARGET_ONLY','VALUE_DIFFERENCE','MULTISET_DIFFERENCE','NOT_COMPARABLE']},duplicates:{type:'boolean'}},
  'Page complete known-key group results with duplicate/quarantine counts and current engineer dispositions.'),
 'reconcile-rows':spec(['run_id'],{run_id:id,...page,side:{enum:['source','target']},
  status:{enum:['INCLUDED','QUARANTINED','EXCLUDED_WINDOW']},group_id:{type:'integer',minimum:1}},
  'Page every original observation, including quarantined and outside-window rows; offsets are display controls only.'),
 'reconcile-row':spec(['run_id','side','row'],{run_id:id,side:{enum:['source','target']},row:{type:'integer',minimum:1}},
  'Read the original retained native row and its exact canonical interpretation.'),
 'reconcile-decisions':spec(['run_id'],{run_id:id,...page},'Page append-only engineer decisions and their exact revision sequence.'),
 'reconcile-decide':spec(['request_id','run_id','expected_revision','subject','outcome','actor','reason'],
  {request_id:requestId,run_id:id,expected_revision:revision,subject,
   outcome:{enum:['OPEN','ACCEPTED_DIFFERENCE','REQUIRES_CORRECTION','DEFERRED']},actor:text,reason:text},
  'Append an explicit engineer disposition under the run review_revision CAS. Source rows and accounting never change.'),
 'reconcile-reports':spec([],{...page,run_id:id},'Page immutable reviewed report snapshots.'),
 'reconcile-report':spec(['report_id'],{report_id:id},'Read exact source bindings, frozen decisions, original saved query revisions and optional previous-run comparison.'),
 'reconcile-save-report':spec(['request_id','run_id','expected_revision'],
  {request_id:requestId,run_id:id,expected_revision:revision,before_run_id:id},
  'Snapshot this exact decision revision with the original saved SQL recipes; optional prior-run comparison checks complete native typed multiplicities. Absence is not a correction.'),
 'reconcile-changes':spec(['report_id'],{report_id:id,...page},'Page the complete retained earlier/later group comparison, including canonical-content changes.'),
 'reconcile-operations':spec([],{...page},'Page original paired-workflow request bodies and actual outcomes. Reads never replay operations.'),
 'reconcile-request':spec(['request_id'],{request_id:requestId},'Read one original stable request. A genuinely absent ID returns REQUEST_NOT_FOUND.'),
 'reconcile-resume':spec(['request_id'],{request_id:requestId},'Explicitly resume exactly the retained original body under its native writer; never choose a replacement ID.'),
 'reconcile-export-manifest':spec(['export_id'],{export_id:id},'Read the small exact manifest descriptor for a complete reconciliation handoff, including packages whose full file list exceeds the tool response size. Read its original bytes with file.'),
 'reconcile-export':spec(['request_id','report_id'],{request_id:requestId,report_id:id},
  'Export complete CSV/Parquet for all frozen recipes, exact original sources, guide/report and original sparse warehouse handoff. Use original operation/resume for this export journal, and export-read/file for all declared bytes.')
});
