// SPDX-License-Identifier: MIT
import {
  canonical, copy, isObject, nonempty, objectDigest, requireValue, unique, verifyDocumentDigest,
} from '../vendor/dlt/vendor/sling/migration/common.mjs';
import { canonicalCell } from '../vendor/dlt/vendor/sling/migration/compare.mjs';
import { comparisonPlan, comparePipeline } from '../vendor/dlt/pipeline/plan.mjs';

const POLICIES = new Set(['required', 'reviewable']);
const EXAMPLES = 20;
const EXACT_DIGITS = 10000;
const SIDES = ['left', 'right'];
const seal = (body, key) => ({...body, [key]: objectDigest(body)});
function columns(value, label, allowEmpty = true) {
  requireValue(Array.isArray(value), 'ACCEPTANCE_COLUMNS', 'Select a literal array of business columns.', {label});
  value.forEach(name => nonempty(name, label));
  unique(value, 'ACCEPTANCE_COLUMN_DUPLICATE', 'Select every business column once.');
  requireValue(allowEmpty || value.length > 0, 'ACCEPTANCE_COLUMNS_EMPTY', 'Select at least one business column.', {label});
  return value.slice();
}
function exactFields(value, allowed, label) {
  requireValue(isObject(value), 'ACCEPTANCE_OBJECT', 'Supply the complete named object.', {label});
  requireValue(Object.keys(value).every(key => allowed.includes(key)), 'ACCEPTANCE_UNKNOWN_FIELD',
    'An unrecognized acceptance field cannot silently lose its meaning.', {label, fields: Object.keys(value).filter(key => !allowed.includes(key))});
}
function policy(value) {
  requireValue(POLICIES.has(value), 'ACCEPTANCE_POLICY', 'Declare required or reviewable for every relationship and control.');
  return value;
}
function declaredColumns(object, names, label) {
  requireValue(names.every(name => object.businessColumns.includes(name)), 'ACCEPTANCE_COLUMN_NOT_SELECTED',
    'Acceptance uses the original canonical business-column names.', {objectId: object.id, label, columns: names});
}
function inputBody(input) {
  exactFields(input, ['schema','title','pipelinePlan','objects','relationships','controls'], 'input');
  requireValue(input.schema === 'definian.acceptance-input.v1', 'ACCEPTANCE_INPUT', 'Select the full Definian acceptance input.');
  verifyDocumentDigest(input.pipelinePlan, 'planId');
  const nativePlan = comparisonPlan(input.pipelinePlan);
  requireValue(Array.isArray(input.objects) && input.objects.length > 0, 'ACCEPTANCE_OBJECTS', 'Select every original pipeline business object.');
  const objects = input.objects.map(raw => {
    exactFields(raw, ['id','streamId','key','required'], 'object');
    const id = nonempty(raw.id, 'object.id'), streamId = nonempty(raw.streamId, 'object.streamId');
    const stream = nativePlan.selectedStreams.find(item => item.id === streamId);
    requireValue(stream, 'ACCEPTANCE_STREAM', 'Select an original pipeline stream.', {streamId});
    const result = {id, streamId, key: columns(raw.key, 'key', false), required: columns(raw.required ?? [], 'required'),
      businessColumns: copy(stream.businessColumns), columnMaps: copy(stream.columnMaps), cellTypes: copy(stream.cellTypes)};
    declaredColumns(result, result.key, 'key'); declaredColumns(result, result.required, 'required');
    // A caller cannot weaken the primary key already selected for native parity.
    requireValue(stream.primaryKey.every(name => result.key.includes(name)), 'ACCEPTANCE_NATIVE_KEY',
      'The acceptance key must retain every original native primary-key column.', {objectId: id});
    return result;
  });
  unique(objects.map(item => item.id), 'ACCEPTANCE_OBJECT_DUPLICATE', 'Object IDs must be distinct.');
  unique(objects.map(item => item.streamId), 'ACCEPTANCE_STREAM_DUPLICATE', 'Each native business stream has one explicit acceptance object.');
  requireValue(objects.length === nativePlan.selectedStreams.length &&
    nativePlan.selectedStreams.every(stream => objects.some(item => item.streamId === stream.id)),
  'ACCEPTANCE_STREAM_CLOSURE', 'Retain every selected original business stream in the acceptance plan.');
  const selected = new Map(objects.map(item => [item.id, item]));
  requireValue(Array.isArray(input.relationships ?? []) && Array.isArray(input.controls ?? []),
    'ACCEPTANCE_RULES', 'Retain literal relationship and control arrays.');
  const relationships = (input.relationships ?? []).map(raw => {
    exactFields(raw, ['id','parentObjectId','childObjectId','parentColumns','childColumns','nulls','acceptance'], 'relationship');
    const id = nonempty(raw.id, 'relationship.id'), parent = selected.get(raw.parentObjectId), child = selected.get(raw.childObjectId);
    requireValue(parent && child, 'ACCEPTANCE_RELATION_OBJECT', 'Select original parent and child object IDs.', {id});
    const parentColumns = columns(raw.parentColumns, 'parentColumns', false), childColumns = columns(raw.childColumns, 'childColumns', false);
    requireValue(parentColumns.length === childColumns.length, 'ACCEPTANCE_RELATION_WIDTH', 'Parent and child keys must have the same arity.', {id});
    declaredColumns(parent, parentColumns, id); declaredColumns(child, childColumns, id);
    requireValue(parentColumns.every((name,index)=>parent.cellTypes[name]===child.cellTypes[childColumns[index]]),
      'ACCEPTANCE_RELATION_TYPE', 'Bind matching original comparison types on both ends of each relationship; no implicit cross-type join is introduced.', {id});
    requireValue(['forbid','allow-all-null'].includes(raw.nulls), 'ACCEPTANCE_RELATION_NULLS', 'Select the child-key null policy.', {id});
    return {id, parentObjectId: parent.id, childObjectId: child.id, parentColumns, childColumns, nulls: raw.nulls, acceptance: policy(raw.acceptance)};
  });
  unique(relationships.map(item => item.id), 'ACCEPTANCE_RELATION_DUPLICATE', 'Relationship IDs must be distinct.');
  const controls = (input.controls ?? []).map(raw => {
    exactFields(raw, ['id','objectId','groupBy','measure','nulls','acceptance'], 'control');
    const id = nonempty(raw.id, 'control.id'), object = selected.get(raw.objectId);
    requireValue(object, 'ACCEPTANCE_CONTROL_OBJECT', 'Select an original control object.', {id});
    const groupBy = columns(raw.groupBy ?? [], 'groupBy'); declaredColumns(object, groupBy, id);
    exactFields(raw.measure, ['kind','column','scale'], 'measure');
    requireValue(['count','sum'].includes(raw.measure.kind), 'ACCEPTANCE_MEASURE', 'Select row count or an exact numeric sum.', {id});
    const measure = {kind: raw.measure.kind};
    if (measure.kind === 'sum') {
      measure.column = nonempty(raw.measure.column, 'measure.column'); declaredColumns(object, [measure.column], id);
      requireValue(['integer','decimal'].includes(object.cellTypes[measure.column]), 'ACCEPTANCE_SUM_TYPE',
        'Sums require an original integer or decimal comparison binding; floating-point data is never coerced.', {id});
      if (raw.measure.scale !== undefined) {
        requireValue(Number.isSafeInteger(raw.measure.scale) && raw.measure.scale >= 0 && raw.measure.scale <= 38,
          'ACCEPTANCE_SCALE', 'An explicit exact decimal scale is an integer from zero to 38.', {id});
        measure.scale = raw.measure.scale;
      }
    } else requireValue(raw.measure.column === undefined && raw.measure.scale === undefined,
      'ACCEPTANCE_COUNT', 'Count measures every retained row, including repeated rows; it has no value column or scale.', {id});
    requireValue(['reject','ignore'].includes(raw.nulls), 'ACCEPTANCE_CONTROL_NULLS', 'Select reject or ignore for null measure cells.', {id});
    return {id, objectId: object.id, groupBy, measure, nulls: raw.nulls, acceptance: policy(raw.acceptance)};
  });
  unique(controls.map(item => item.id), 'ACCEPTANCE_CONTROL_DUPLICATE', 'Control IDs must be distinct.');
  return {schema: 'definian.acceptance-plan.v1', input: copy(input), inputDigest: objectDigest(input),
    pipelinePlanId: input.pipelinePlan.planId, comparisonPlanId: nativePlan.planId,
    comparisonPlan: nativePlan, objects, relationships, controls,
    limits: {displayedExamples: EXAMPLES, maximumExactDigits: EXACT_DIGITS}};
}

/** Pure compilation. No data, native process, workspace or decision is mutated. */
export function compileAcceptance(input) {
  return seal(inputBody(input), 'planId');
}
function validatePlan(plan) {
  verifyDocumentDigest(plan, 'planId');
  requireValue(plan.schema === 'definian.acceptance-plan.v1' &&
    canonical(compileAcceptance(plan.input)) === canonical(plan),
  'ACCEPTANCE_PLAN_CHANGED', 'Reopen the exact original input and compiled acceptance selection.');
}
function rowRef(object, side, observation, row, index) {
  return {objectId: object.id, streamId: object.streamId, side, rowIndex: index,
    rowDigest: objectDigest(row), sourceSha256: observation.source.sha256};
}
function observedObject(object, side, observation, findings) {
  const indexes = new Map(observation.columns.map((column, index) => [column.name, index]));
  const mappings = object.businessColumns.map(name => ({name, observed: object.columnMaps[side][name] ?? name}));
  const missing = mappings.filter(item => !indexes.has(item.observed));
  if (missing.length) findings.push({code:'OBJECT_COLUMN_MISSING', acceptance:'required', objectId:object.id, side,
    count: missing.length, columns:missing, rows:[], message:'The complete export lacks selected business columns.'});
  const rows = observation.rows.map((raw, index) => {
    const reference = rowRef(object, side, observation, raw, index), cells = new Map(), errors = [];
    for (const mapping of mappings) {
      if (!indexes.has(mapping.observed)) { errors.push({column:mapping.name,code:'COLUMN_MISSING'}); continue; }
      try { cells.set(mapping.name, canonicalCell(raw[indexes.get(mapping.observed)], object.cellTypes[mapping.name])); }
      catch(error) { errors.push({column:mapping.name,code:error.code ?? 'INVALID_CELL',message:error.message}); }
    }
    return {reference, cells, errors};
  });
  const invalid = rows.filter(row => row.errors.length);
  if (invalid.length) findings.push({code:'OBJECT_TYPED_ROW_INVALID',acceptance:'required',objectId:object.id,side,
    count:invalid.length,rows:invalid.map(row=>({...row.reference,errors:row.errors})),
    message:'Every retained row must have its original valid typed business cells.'});
  return {object, side, observation, rows};
}
const validFor = (row, names) => names.every(name => row.cells.has(name));
const valuesFor = (row, names) => names.map(name => row.cells.get(name));
const hasNull = values => values.some(cell => cell[0] === 'null');
function groupRows(rows, names, {skipNull = false} = {}) {
  const groups = new Map();
  for (const row of rows) {
    if (!validFor(row,names)) continue;
    const values=valuesFor(row,names); if(skipNull&&hasNull(values))continue;
    const key=canonical(values);let group=groups.get(key);
    if(!group){group={key,values,rows:[]};groups.set(key,group);}group.rows.push(row);
  }
  return groups;
}
function objectFindings(view, findings) {
  const {object,side,rows}=view;
  const nullKeys=rows.filter(row=>validFor(row,object.key)&&hasNull(valuesFor(row,object.key)));
  if(nullKeys.length)findings.push({code:'OBJECT_KEY_NULL',acceptance:'required',objectId:object.id,side,
    count:nullKeys.length,rows:nullKeys.map(row=>({...row.reference,key:valuesFor(row,object.key)})),
    message:'A required object key contains null.'});
  const groups=[...groupRows(rows,object.key,{skipNull:true}).values()].filter(group=>group.rows.length>1);
  if(groups.length)findings.push({code:'OBJECT_KEY_DUPLICATE',acceptance:'required',objectId:object.id,side,
    count:groups.reduce((sum,group)=>sum+group.rows.length,0),groupCount:groups.length,
    excessRows:groups.reduce((sum,group)=>sum+group.rows.length-1,0),
    rows:groups.flatMap(group=>group.rows.map(row=>({...row.reference,key:group.values}))),
    message:'The original object key selects more than one retained row.'});
  for(const column of object.required){
    const failed=rows.filter(row=>row.cells.has(column)&&row.cells.get(column)[0]==='null');
    if(failed.length)findings.push({code:'OBJECT_REQUIRED_NULL',acceptance:'required',objectId:object.id,side,column,
      count:failed.length,rows:failed.map(row=>row.reference),message:'An explicitly required field is null; empty text stays a distinct retained value.'});
  }
}
function relationResult(rule, side, parent, child, findings) {
  const parents=groupRows(parent.rows,rule.parentColumns,{skipNull:true});
  const missingParents=parent.rows.filter(row=>validFor(row,rule.parentColumns)&&hasNull(valuesFor(row,rule.parentColumns)));
  const duplicates=[...parents.values()].filter(group=>group.rows.length>1);
  const nullChildren=[],orphans=[],ambiguous=[],matched=[],allowedNull=[],invalid=[];
  for(const row of child.rows){
    if(!validFor(row,rule.childColumns)){invalid.push(row.reference);continue;}
    const key=valuesFor(row,rule.childColumns),nullCount=key.filter(cell=>cell[0]==='null').length;
    if(nullCount){
      const target=nullCount===key.length&&rule.nulls==='allow-all-null'?allowedNull:nullChildren;
      target.push({...row.reference,key});continue;
    }
    const selected=parents.get(canonical(key));
    if(!selected)orphans.push({...row.reference,key});
    else if(selected.rows.length!==1)ambiguous.push({...row.reference,key,parentRows:selected.rows.map(value=>value.reference)});
    else matched.push({child:row.reference,parent:selected.rows[0].reference,key});
  }
  for(const [code,failed,message] of [
    ['RELATION_PARENT_NULL',missingParents.map(row=>({...row.reference,key:valuesFor(row,rule.parentColumns)})),'A parent relation key is null.'],
    ['RELATION_PARENT_AMBIGUOUS',duplicates.flatMap(group=>group.rows.map(row=>({...row.reference,key:group.values}))),'The selected parent columns identify multiple original rows.'],
    ['RELATION_CHILD_NULL',nullChildren,'A child key violates the explicit null policy.'],
    ['RELATION_ORPHAN',orphans,'A non-null child key has no matching parent.'],
    ['RELATION_CHILD_AMBIGUOUS',ambiguous,'A child key has multiple matching parents.'],
  ])if(failed.length)findings.push({code,acceptance:rule.acceptance,relationshipId:rule.id,side,count:failed.length,rows:failed,message});
  return {relationshipId:rule.id,side,parentRows:parent.rows.length,childRows:child.rows.length,
    matchedRows:matched.length,allowedNullRows:allowedNull.length,invalidRows:invalid.length,
    orphanRows:orphans.length,ambiguousRows:ambiguous.length,disallowedNullRows:nullChildren.length,
    matched,allowedNull,invalid};
}
function decimalValue(cell) {
  requireValue(['integer','integer-decimal','decimal'].includes(cell[0]),'ACCEPTANCE_SUM_CELL','An exact sum accepts only the selected original integer/decimal identity.');
  if(cell[0]==='integer')return {coefficient:BigInt(cell[1]),exponent:0n};
  const match=/^(-?\d+)e(-?\d+)$/.exec(cell[1]);
  requireValue(match,'ACCEPTANCE_SUM_CELL','Retain the original canonical decimal identity.');
  return {coefficient:BigInt(match[1]),exponent:BigInt(match[2])};
}
function normalizedTotal(coefficient,exponent) {
  if(coefficient===0n)return {exact:'0e0',coefficient:'0',exponent:'0'};
  while(coefficient%10n===0n){coefficient/=10n;exponent+=1n;}
  return {exact:coefficient.toString()+'e'+exponent.toString(),coefficient:coefficient.toString(),exponent:exponent.toString()};
}
function exactTotal(values,scale) {
  if(!values.length)return normalizedTotal(0n,0n);
  const nonzero=values.filter(value=>value.coefficient!==0n);
  if(!nonzero.length)return normalizedTotal(0n,0n);
  const exponent=scale===undefined?nonzero.reduce((p,value)=>value.exponent<p?value.exponent:p,nonzero[0].exponent):-BigInt(scale);
  let total=0n;
  for(const value of nonzero){
    const shift=value.exponent-exponent;
    requireValue(shift>=0n,'ACCEPTANCE_SUM_SCALE','A measure exceeds the explicit decimal scale; no rounding is performed.');
    const digits=value.coefficient.toString().replace('-','').length;
    requireValue(shift+BigInt(digits)<=BigInt(EXACT_DIGITS),'ACCEPTANCE_SUM_RANGE',
      'The exact expanded sum exceeds its declared 10,000-digit processing boundary; retain the input and hold acceptance.');
    total+=value.coefficient*10n**shift;
    requireValue(total.toString().replace('-','').length<=EXACT_DIGITS,'ACCEPTANCE_SUM_RANGE','The exact total exceeds its processing boundary.');
  }
  return normalizedTotal(total,exponent);
}
function controlSide(rule,view,findings) {
  const groups=groupRows(view.rows,rule.groupBy),result=[];
  // An ungrouped count/sum includes the observed empty table and yields exact zero.
  if(!rule.groupBy.length&&!groups.size)groups.set('[]',{key:'[]',values:[],rows:[]});
  for(const group of groups.values()){
    const refs=group.rows.map(row=>row.reference),nulls=[],invalid=[],values=[];
    for(const row of group.rows){
      if(rule.measure.kind==='count')continue;
      const cell=row.cells.get(rule.measure.column);
      if(!cell){invalid.push({...row.reference,code:'MEASURE_CELL_INVALID'});continue;}
      if(cell[0]==='null'){nulls.push(row.reference);continue;}
      try{values.push(decimalValue(cell));}catch(error){invalid.push({...row.reference,code:error.code??'MEASURE_CELL_INVALID',message:error.message});}
    }
    let total=null,arithmeticError=null;
    try{total=rule.measure.kind==='count'?normalizedTotal(BigInt(group.rows.length),0n):exactTotal(values,rule.measure.scale);}
    catch(error){arithmeticError={code:error.code??'ACCEPTANCE_SUM_FAILED',message:error.message};}
    if(invalid.length||arithmeticError)findings.push({code:'CONTROL_EXACT_MEASURE_INVALID',acceptance:'required',controlId:rule.id,side:view.side,
      group:group.values,count:invalid.length,rows:invalid.length?invalid:refs,arithmeticError,
      message:'The selected complete measure cannot be represented exactly; the control remains held.'});
    if(nulls.length&&rule.nulls==='reject')findings.push({code:'CONTROL_NULL_REJECTED',acceptance:rule.acceptance,controlId:rule.id,side:view.side,
      group:group.values,count:nulls.length,rows:nulls,message:'Null measure values violate the selected control policy.'});
    result.push({group:group.values,key:group.key,present:true,rowCount:group.rows.length,rows:refs,
      measure:copy(rule.measure),total,measuredRows:rule.measure.kind==='count'?group.rows.length:values.length,
      nullRows:nulls.length,ignoredNullRows:rule.nulls==='ignore'?nulls.length:0,invalidRows:invalid.length,
      complete:invalid.length===0&&!arithmeticError&&!(nulls.length&&rule.nulls==='reject')});
  }
  return result.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
}
function controlResult(rule,views,findings) {
  const left=controlSide(rule,views.left,findings),right=controlSide(rule,views.right,findings);
  const a=new Map(left.map(row=>[row.key,row])),b=new Map(right.map(row=>[row.key,row]));
  const groups=[...new Set([...a.keys(),...b.keys()])].sort().map(key=>{
    const l=a.get(key)??null,r=b.get(key)??null,present=!!l&&!!r;
    const equal=present&&l.complete&&r.complete&&l.total?.exact===r.total?.exact;
    if(!present||l.total&&r.total&&l.total.exact!==r.total.exact){
      findings.push({code:present?'CONTROL_TOTAL_DIFFERENT':'CONTROL_GROUP_MISSING',acceptance:rule.acceptance,controlId:rule.id,
        group:(l??r).group,left:l?{present:true,rowCount:l.rowCount,total:l.total,complete:l.complete}:{present:false},
        right:r?{present:true,rowCount:r.rowCount,total:r.total,complete:r.complete}:{present:false},
        count:1,rows:[...(l?.rows??[]),...(r?.rows??[])],
        message:present?'The exact control totals differ.':'An absent group is distinct from a present group whose exact total is zero.'});
    }
    return {group:(l??r).group,left:l,right:r,equal};
  });
  return {controlId:rule.id,objectId:rule.objectId,groupBy:copy(rule.groupBy),measure:copy(rule.measure),groups,
    equal:groups.every(group=>group.equal)};
}
function finishFinding(body) {
  const result={...body,rows:body.rows??[]};
  result.examples=result.rows.slice(0,EXAMPLES);
  result.examplesTruncated=result.rows.length>EXAMPLES;
  return seal(result,'findingId');
}

/** Complete pure acceptance: native reports are verified and recomputed before any rule evaluates. */
export function evaluateAcceptance(plan,observations,{parity}={}) {
  validatePlan(plan);
  requireValue(observations?.schema==='slingdata.migration-observations.v1'&&
    observations.pipelinePlanId===plan.pipelinePlanId&&observations.planId===plan.comparisonPlanId,
  'ACCEPTANCE_OBSERVATION_BINDING','Select the exact complete observations of this original native plan.');
  requireValue(parity?.schema==='dlthub.pipeline-comparison.v1','ACCEPTANCE_PARITY','Supply the unchanged original dlt parity report.');
  verifyDocumentDigest(parity,'reportId');verifyDocumentDigest(parity.nativeReport,'comparisonId');
  requireValue(parity.planId===plan.pipelinePlanId&&parity.comparisonPlanId===plan.comparisonPlanId&&
    parity.nativeReport.planId===plan.comparisonPlanId&&parity.nativeReport.observationsDigest===objectDigest(observations),
  'ACCEPTANCE_PARITY_BINDING','Both original parity report identities must bind this exact complete observation and plan.');
  const recomputed=comparePipeline(plan.input.pipelinePlan,observations);
  requireValue(canonical(recomputed)===canonical(parity),'ACCEPTANCE_PARITY_CHANGED','The retained parity report differs from the original comparator on these exact observations.');
  const findings=[],views=new Map(),observed=new Map(observations.streams.map(item=>[item.streamId,item]));
  if(!parity.readyForCutover||!parity.equal||parity.errors.length)findings.push({
    code:'ORIGINAL_PARITY_HOLD',acceptance:'required',count:1,rows:[],errors:copy(parity.errors),
    parityReportId:parity.reportId,message:'The original complete native parity, load-package or table-coverage requirements remain unsatisfied.'});
  for(const object of plan.objects){
    const stream=observed.get(object.streamId);
    if(!stream){findings.push({code:'OBJECT_OBSERVATION_MISSING',acceptance:'required',objectId:object.id,streamId:object.streamId,count:1,rows:[],
      message:'The selected object has no complete native observations.'});continue;}
    const pair={};
    for(const side of SIDES){pair[side]=observedObject(object,side,stream[side],findings);objectFindings(pair[side],findings);}
    views.set(object.id,pair);
  }
  const relationships=[];
  for(const rule of plan.relationships){
    if(!views.has(rule.parentObjectId)||!views.has(rule.childObjectId))continue;
    for(const side of SIDES)relationships.push(relationResult(rule,side,views.get(rule.parentObjectId)[side],views.get(rule.childObjectId)[side],findings));
  }
  const controls=plan.controls.filter(rule=>views.has(rule.objectId)).map(rule=>controlResult(rule,views.get(rule.objectId),findings));
  const sealed=findings.map(finishFinding);
  unique(sealed.map(item=>item.findingId),'ACCEPTANCE_FINDING_DUPLICATE','Each measured finding must have a distinct exact identity.');
  const required=sealed.filter(item=>item.acceptance==='required').length,reviewable=sealed.length-required;
  return seal({schema:'definian.acceptance-report.v1',plan:copy(plan),planId:plan.planId,
    observations:copy(observations),observationsDigest:objectDigest(observations),parity:copy(parity),parityReportId:parity.reportId,
    originalReadyForCutover:parity.readyForCutover===true,relationships,controls,findings:sealed,
    counts:{findings:sealed.length,required,reviewable,accepted:0,remaining:sealed.length},
    readyForCutover:parity.readyForCutover===true&&sealed.length===0},'reportId');
}

/** Decisions are a separate immutable edition. They never rewrite measured facts or the native parity. */
export function decideAcceptance(report,decisions) {
  verifyDocumentDigest(report,'reportId');
  requireValue(report.schema==='definian.acceptance-report.v1','ACCEPTANCE_REPORT','Select the complete original acceptance report.');
  const original=evaluateAcceptance(report.plan,report.observations,{parity:report.parity});
  requireValue(canonical(original)===canonical(report),'ACCEPTANCE_REPORT_CHANGED','The saved measured report must reproduce from its original complete inputs.');
  requireValue(Array.isArray(decisions),'ACCEPTANCE_DECISIONS','Retain the exact ordered decision array.');
  const findings=new Map(report.findings.map(item=>[item.findingId,item])),seen=new Set();
  const retained=decisions.map(raw=>{
    exactFields(raw,['findingId','reportId','disposition','reason','actorId'],'decision');
    requireValue(raw.reportId===report.reportId&&findings.has(raw.findingId),'ACCEPTANCE_DECISION_BINDING','A decision must name one finding in this exact report edition.');
    requireValue(!seen.has(raw.findingId),'ACCEPTANCE_DECISION_DUPLICATE','The selected decision edition contains at most one disposition per finding; prior editions remain separate history.');
    seen.add(raw.findingId);
    requireValue(['acknowledged','accepted_exception'].includes(raw.disposition),'ACCEPTANCE_DISPOSITION','Choose acknowledge or explicitly accept a reviewable exception.');
    const reason=nonempty(raw.reason,'decision.reason'),actorId=nonempty(raw.actorId,'decision.actorId');
    requireValue(reason.trim().length>0&&actorId.trim().length>0,'ACCEPTANCE_DECISION_REASON','Retain a meaningful actor and reason.');
    requireValue(raw.disposition!=='accepted_exception'||findings.get(raw.findingId).acceptance==='reviewable',
      'ACCEPTANCE_REQUIRED_HOLD','Required key, typed-data and original parity findings cannot be accepted as exceptions.');
    return {...copy(raw),reason,actorId};
  });
  const byId=new Map(retained.map(item=>[item.findingId,item]));
  const resolution=report.findings.map(finding=>({findingId:finding.findingId,acceptance:finding.acceptance,
    disposition:byId.get(finding.findingId)?.disposition??null,
    resolved:finding.acceptance==='reviewable'&&byId.get(finding.findingId)?.disposition==='accepted_exception'}));
  const accepted=resolution.filter(item=>item.resolved).length,remaining=resolution.length-accepted;
  return seal({schema:'definian.acceptance-decision.v1',reportId:report.reportId,planId:report.planId,
    observationsDigest:report.observationsDigest,parityReportId:report.parityReportId,
    decisions:retained,resolution,counts:{findings:resolution.length,accepted,acknowledged:retained.filter(item=>item.disposition==='acknowledged').length,
      remaining,required:resolution.filter(item=>!item.resolved&&item.acceptance==='required').length,
      reviewable:resolution.filter(item=>!item.resolved&&item.acceptance==='reviewable').length},
    readyForCutover:report.originalReadyForCutover&&remaining===0},'decisionId');
}
