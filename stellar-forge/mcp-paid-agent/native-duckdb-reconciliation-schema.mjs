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
const coefficient={type:'string',minLength:1,maxLength:256,
 pattern:'^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$'};
const affineSide={type:'object',additionalProperties:false,required:['unit','scale','offset'],
 properties:{unit:{type:'string',minLength:1,maxLength:240},scale:coefficient,offset:coefficient}};
const timeSide={oneOf:[
 {type:'object',additionalProperties:false,required:['format','offset'],
  properties:{format:{enum:['native','iso8601']},offset:{type:'string',pattern:'^(?:embedded|[+-][0-9]{2}:[0-9]{2})$'}}},
 {type:'object',additionalProperties:false,required:['format','offset'],
  properties:{format:{enum:['unix-seconds','unix-milliseconds','unix-microseconds','unix-nanoseconds']},offset:{const:'utc'}}}
]};
export const reconciliationNormalization=Object.freeze({oneOf:[
 {type:'object',additionalProperties:false,required:['mode','canonical_type','canonical_unit','source','target','basis'],
  properties:{mode:{const:'numeric-affine'},canonical_type:{type:'string',pattern:'^(?:BIGINT|HUGEINT|DECIMAL\\(([1-9]|[12][0-9]|3[0-8]),(0|[1-9]|[12][0-9]|3[0-8])\\))$'},
   canonical_unit:{type:'string',minLength:1,maxLength:240},source:affineSide,target:affineSide,
   basis:{type:'string',minLength:1,maxLength:4000}}},
 {type:'object',additionalProperties:false,required:['mode','canonical_type','source','target','basis'],
  properties:{mode:{const:'time-utc'},canonical_type:{const:'TIMESTAMPTZ'},source:timeSide,target:timeSide,
   basis:{type:'string',minLength:1,maxLength:4000}}}
],description:'Explicit lossless original source-unit or time conversion. Affine numeric VALUEs use exact scale and offset strings and a nonzero scale, preserving all source values. Canonical DECIMAL precision is <=38 with scale<=precision; no rounding. Time KEY/VALUEs require reviewed native/ISO/Unix representation and embedded/fixed offsets; exact UTC microseconds, no timezone guess. Failed conversions remain retained and quarantine their original row. No literal value maps on a converted field; tolerance unit must equal canonical_unit.'});
export const reconciliationNormalizationStates=Object.freeze(['CONVERTED','NULL_PRESERVED','NOT_NUMERIC','NON_FINITE',
 'OUT_OF_RANGE','PRECISION_LOSS','INVALID_TIME','OFFSET_REQUIRED','OFFSET_CONFLICT','SUBMICROSECOND','NUMERIC_LIMIT']);
export const reconciliationNumericRule=Object.freeze({
 type:'object',additionalProperties:false,required:['mode','absolute','relative','unit','nulls','basis'],
 properties:{mode:{const:'numeric-tolerance'},
  absolute:{type:'string',minLength:1,maxLength:256,pattern:'^[+]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$'},
  relative:{type:'string',minLength:1,maxLength:256,pattern:'^[+]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$'},
  unit:{type:'string',minLength:1,maxLength:240},nulls:{enum:['equal','uncomparable']},
  basis:{type:'string',minLength:1,maxLength:4000}},
 description:'Explicit native numeric VALUE rule only; finite nonnegative decimal strings, exponent magnitude<=256, relative<=1. Difference <= absolute + relative*max(abs(source),abs(target)); the unit is reviewed and must match canonical_unit when separate normalization is selected. Unique pairs only; duplicate multiplicities stay exact.'
});
export const reconciliationFieldStates=Object.freeze(['EXACT_EQUAL','EXACT_DIFFERENT','NULLS_EQUAL','WITHIN_TOLERANCE',
 'OUTSIDE_TOLERANCE','NULL_NOT_COMPARABLE','NON_FINITE_NOT_COMPARABLE','DUPLICATE_NOT_PAIRED','ONE_SIDED','QUARANTINED']);
export const reconciliationDefinition=Object.freeze({
 type:'object',additionalProperties:false,required:['name','label','source_edition','target_edition','columns'],
 properties:{name,label:{type:'string',minLength:1,maxLength:240},source_edition:id,target_edition:id,
  columns:{type:'array',minItems:1,maxItems:64,items:{type:'object',additionalProperties:false,
   required:['name','source','target','role'],properties:{name,source:text,target:text,role:{enum:['key','value']},
    meaning:text,source_map:map,target_map:map,comparison:reconciliationNumericRule,normalization:reconciliationNormalization}}},
  window_column:{anyOf:[name,{type:'null'}]},windows:{type:'array',maxItems:32,items:{type:'object',additionalProperties:false,
   required:['id','start','end','basis'],properties:{id:name,start:text,end:text,basis:{enum:['native','lexical']}}}},
  notes:text},
 description:'Reviewed source/target fields with at least one key. Native SQL types must match unless an explicit lossless normalization chooses a common canonical type. Empty value maps preserve identity; explicit VARCHAR maps quarantine unmapped values. Windows are nonoverlapping half-open canonical intervals with exact bounds. Numeric allowances require exact-string amounts, a reviewed source/canonical unit, null policy and basis. Every original value/conversion remains retained; no implicit rounding or timezone inference.'
});
const subject={oneOf:[
 {type:'object',additionalProperties:false,required:['kind','group_id'],properties:{kind:{const:'group'},group_id:{type:'integer',minimum:1}}},
 {type:'object',additionalProperties:false,required:['kind','side','row'],properties:{kind:{const:'row'},side:{enum:['source','target']},row:{type:'integer',minimum:1}}}
]};
export const reconciliationCarryStates=Object.freeze(['ELIGIBLE','PRIOR_OPEN','POLICY_CHANGED','GROUP_MISSING',
 'VALUES_CHANGED','ROW_MISSING','ROW_AMBIGUOUS','TARGET_REVIEWED']);
const candidateId={type:'integer',minimum:1,maximum:1000000000};
const spec=(required,properties,description)=>({required,properties,description});
export const nativeDuckDBReconciliationOperations=Object.freeze({
 'reconcile-status':spec([],{},'Read paired-workflow counts in the SAME original warehouse; no new service or capture.'),
 'reconcile-review':spec(['definition'],{definition:reconciliationDefinition},'Read and hash the complete mapping, native types, source meanings and window contracts before saving.'),
 'reconcile-normalization-preview':spec(['definition','side','column_name'],
  {definition:reconciliationDefinition,side:{enum:['source','target']},column_name:name,...page},
  'Read an exact page of original source values and reviewed unit/time conversions before saving. No new request, source, import or mutation; returned total is the full immutable edition.'),
 'reconcile-pairs':spec([],{...page},'Page retained pair definitions and current revisions.'),
 'reconcile-pair':spec(['pair_id'],{pair_id:id,revision:{type:'integer',minimum:1}},'Read a retained pair or an exact historical revision.'),
 'reconcile-save-pair':spec(['request_id','expected_revision','definition','review_sha256'],
  {request_id:requestId,expected_revision:revision,definition:reconciliationDefinition,review_sha256:id},
  'Save the reviewed pair under the original request journal and revision CAS; new pair expected_revision is0.'),
 'reconcile-runs':spec([],{...page,pair_id:id},'Page immutable complete reconciliation runs.'),
 'reconcile-run':spec(['run_id'],{run_id:id},'Read exact full row accounting, category totals and current engineer decision revision.'),
 'reconcile-execute':spec(['request_id','pair_id','expected_revision','definition_sha256'],
  {request_id:requestId,pair_id:id,expected_revision:{type:'integer',minimum:1},definition_sha256:id},
  'Account for EVERY row in the exact reviewed immutable pair; equal multiset multiplicity never chooses an arbitrary duplicate pairing. Explicit rules apply only to unique native numeric value pairs, retaining all raw values/differences.'),
 'reconcile-groups':spec(['run_id'],{run_id:id,...page,
  category:{enum:['MATCHED','SOURCE_ONLY','TARGET_ONLY','VALUE_DIFFERENCE','MULTISET_DIFFERENCE','NOT_COMPARABLE','TOLERANCE_MATCHED']},duplicates:{type:'boolean'}},
  'Page complete known-key group results with duplicate/quarantine counts and current engineer dispositions.'),
 'reconcile-rows':spec(['run_id'],{run_id:id,...page,side:{enum:['source','target']},
  status:{enum:['INCLUDED','QUARANTINED','EXCLUDED_WINDOW']},group_id:{type:'integer',minimum:1}},
  'Page every original observation, including quarantined and outside-window rows; offsets are display controls only.'),
 'reconcile-fields':spec(['run_id'],{run_id:id,...page,group_id:{type:'integer',minimum:1},column_name:name,
  state:{enum:reconciliationFieldStates}},'Page every retained per-field native value, exact signed/absolute difference and reviewed allowance for a rule- or normalization-enabled run. Raw values remain original; numeric arithmetic is canonical after an explicit conversion. No duplicate row pairing; old runs without recorded fields return FIELDS_NOT_RECORDED.'),
 'reconcile-normalizations':spec(['run_id'],{run_id:id,...page,side:{enum:['source','target']},
  group_id:{type:'integer',minimum:1},column_name:name,state:{enum:reconciliationNormalizationStates}},
  'Page every original conversion record, raw value, exact canonical candidate/result and failure state in the retained run. Failed values remain in full accounting.'),
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
 'reconcile-carry-reviews':spec([],{...page,target_run_id:id},'Page immutable prior-decision reviews for the original target run; reads do not resume.'),
 'reconcile-carry-review':spec(['review_id'],{review_id:id},'Read the full frozen source report, meaning/policy comparison, target revision and candidate checksum.'),
 'reconcile-prepare-carry':spec(['request_id','source_report_id','target_run_id','expected_revision','scope_basis'],
  {request_id:requestId,source_report_id:id,target_run_id:id,expected_revision:revision,
   scope_basis:{type:'string',minLength:1,maxLength:16000}},
  'Retain a complete reviewed carry-forward preview from one frozen prior report to a different run of the same pair. Native typed canonical AND original row multiplicities must match; meaning/policy changes, missing rows, duplicate ambiguity and existing target decisions stay visible. Free-text scope basis never overrides failed checks.'),
 'reconcile-carry-candidates':spec(['review_id'],{review_id:id,...page,state:{enum:reconciliationCarryStates},kind:{enum:['group','row']}},
  'Page every frozen candidate, with exact source/target subjects, full original decision and applicability reasons.'),
 'reconcile-carry-candidate':spec(['review_id','candidate_id'],{review_id:id,candidate_id:candidateId},
  'Read one exact candidate; candidate_id is its original prior decision sequence, not a display row number.'),
 'reconcile-apply-carry':spec(['request_id','review_id','review_sha256','expected_revision','candidate_ids','actor','reason'],
  {request_id:requestId,review_id:id,review_sha256:id,expected_revision:revision,
   candidate_ids:{type:'array',minItems:1,maxItems:10000,uniqueItems:true,items:candidateId},
   actor:{type:'string',minLength:1,maxLength:240},reason:{type:'string',minLength:1,maxLength:16000}},
  'Explicitly apply selected ELIGIBLE candidates once under the frozen review hash and target decision revision. Preserve original outcomes/reasons and full source lineage; record the new engineer and carry rationale. Never overwrite an existing target decision, including OPEN. Same request ID/body recovers its original result.'),
 'reconcile-carry-applications':spec([],{...page,target_run_id:id},'Page immutable selected-apply receipts and native decision sequence ranges.'),
 'reconcile-carry-application':spec(['application_id'],{application_id:id},'Read complete selected candidates, retained outcomes and exact new target decision sequences.'),
 'reconcile-operations':spec([],{...page},'Page original paired-workflow request bodies and actual outcomes. Reads never replay operations.'),
 'reconcile-request':spec(['request_id'],{request_id:requestId},'Read one original stable request. A genuinely absent ID returns REQUEST_NOT_FOUND.'),
 'reconcile-resume':spec(['request_id'],{request_id:requestId},'Explicitly resume exactly the retained original body under its native writer; never choose a replacement ID.'),
 'reconcile-export-manifest':spec(['export_id'],{export_id:id},'Read the small exact manifest descriptor for a complete reconciliation handoff, including packages whose full file list exceeds the tool response size. Read its original bytes with file.'),
 'reconcile-export':spec(['request_id','report_id'],{request_id:requestId,report_id:id},
  'Export complete CSV/Parquet for all frozen recipes (including fields and complete normalizations when reviewed), exact original sources (including decision lineage editions), guides/report, frozen prior reports/reviews/applications and original sparse warehouse handoff. Use original operation/resume for this export journal, and export-read/file for all declared bytes.')
});
