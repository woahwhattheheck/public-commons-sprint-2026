/**
 * Authored historical source exercise for the complete model-comparison API.
 * The caller supplies a complete genuine USGS reference service-study envelope.
 * No SQLite workspace, native review, browser, winner or deployment is created.
 */
import {InputError} from '../engine/parse.mjs';
import {stable} from '../engine/normalise.mjs';
import {rebuildSedimentStudy} from '../engine/sediment_workspace.mjs';
import {compareSedimentStudies,sedimentTargetIdentity} from '../engine/sediment_comparison.mjs';

const IDS=['6ca71f6d-f8e5-4665-8872-283926d9db76','6ef1fe8a-f92d-465f-bf39-fd2123a4049f','183f1d4f-9f59-4193-b5f3-5454d9b7cdde'];
const FORMS=['log-log','linear','log-linear'];
const copy=v=>JSON.parse(JSON.stringify(v));
function need(ok,message){if(!ok)throw new InputError(message);}
function bounded(value,label,max){need(typeof value==='string'&&value.trim()&&value.length<=max&&!value.includes('\0'),label+' is required');return value;}
function summary(document){
 return {id:document.id,selectionId:document.input.selection.id,rangePolicy:document.input.selection.rangePolicy,counts:document.result.counts,
  candidates:document.result.models.map(x=>({studyId:x.studyId,form:x.form,counts:x.counts,coefficients:x.coefficients,smearingFactor:x.smearingFactor,metrics:x.comparisonMetrics})),
  warnings:document.result.warnings,interpretation:document.result.interpretation};
}
export function calculateSedimentComparisonReference(baseStudy,options){
 bounded(options.actor,'Exercise author',240);bounded(options.reason,'Exercise rationale',8000);
 need(typeof options.at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(options.at)&&Number.isFinite(Date.parse(options.at)),'Retain an explicit zoned exercise time');
 const reopened=rebuildSedimentStudy(baseStudy.input);need(stable(reopened)===stable(baseStudy),'Reference input differs from its complete maintained service rebuild');
 const p=baseStudy.result.pairing,f=baseStudy.result.fit;
 need(p.siteId==='07144100'&&p.target==='SSC'&&p.sensor.id==='YSI 6600 / 6136'&&p.sensor.unit==='FNU'&&p.rows.length===120,'Use the genuine complete published USGS07144100 reference study');
 need(f.counts.training===68&&f.counts.validation===52&&f.counts.excluded===0&&f.cohorts.mode==='temporal'&&f.input.selection.includeDischarge===true,'Keep the original68/52 temporal reference population and discharge predictor');
 need(p.rows.every(row=>row.support.precision==='date'&&row.eventMeaning==='sample'),'Preserve date-only sample support; no invented instant or hydrologic event');
 need(new Set(p.rows.map(row=>row.sampledDate)).size===115,'Preserve all115 actual dates including separate same-date samples');
 const studies=FORMS.map((form,i)=>{
  const input=copy(baseStudy.input);
  input.definition.study_id=IDS[i];input.definition.parent_id=null;
  input.definition.title='SOURCE EXERCISE — USGS07144100 common-holdout '+form;
  input.definition.actor=options.actor;input.definition.at=options.at;
  input.definition.note='Explicitly authored connected-source comparison candidate. Original import/source and review contexts below are retained exactly. This exercise does not save a native study or fabricate native review receipts. '+options.reason;
  input.definition.model.form=form;
  input.definition.model.rationale+=' Candidate '+form+' is retained for explicitly exploratory common-holdout comparison, not automatic selection. '+options.reason;
  input.definition.deployment=null;
  return rebuildSedimentStudy(input);
 });
 const choice=studies[0].result.fit.input.selection.cohorts.filter(x=>x.role==='validate'),pairs=new Map(studies[0].result.pairing.rows.map(x=>[x.id,x]));
 const selection={
  schema:'upstate.sediment-model-comparison-selection/v1',id:'39befa2c-f1a7-4e18-949e-a3e75be67a2c',
  title:'SOURCE EXERCISE — three original model forms on the same52 held-out observations',actor:options.actor,at:options.at,
  note:'Historical public-source exercise. Complete original source/review contexts remain in each study; no native save or rendered receiving is implied.',
  models:studies.map(x=>({studyId:x.id,label:x.result.fit.model.form,reason:'Keep all three specified forms on unchanged original68/52 populations, including poor-performing candidates. '+options.reason})),
  observations:choice.map(x=>({targetId:sedimentTargetIdentity(pairs.get(x.pairId).ssc.sourceIds),action:'include',reason:'Every later published observation is selected by exact original laboratory identity; no selection by model error.'})).sort((a,b)=>a.targetId.localeCompare(b.targetId)),
  rangePolicy:'include-flagged',rationale:'Exploratory comparison of all52 actual later samples, retaining model range flags. This holdout is consumed if used to select a model. '+options.reason
 };
 const all=compareSedimentStudies(studies,selection);
 const withinSelection={...copy(selection),id:'8975a210-543a-4d25-a0c8-4481f12b5a6d',title:'SOURCE EXERCISE — same candidates on their common in-range held-out population',rangePolicy:'in-range-only',rationale:'Apply the explicit all-candidate calibration-range intersection to the same52 original targets. Retain every removed target and its original candidate predictions. This is a different scoring population, not improved evidence on all52. '+options.reason};
 const inRange=compareSedimentStudies(studies,withinSelection);
 need(all.result.counts.common===52&&inRange.result.counts.common===37&&inRange.result.counts.outsideCommonRange===15,'Original published common-population counts changed; review complete original inputs before replacing an earlier result');
 return {schema:'upstate.sediment-comparison-reference/v1',
  sourceExercise:{sourceOnly:true,nativeStudySave:false,nativeReviewCommitted:false,browserRun:false,baseStudyId:baseStudy.id,actor:options.actor,at:options.at,reason:options.reason,
   interpretation:'Three complete source-derived saved-study-shaped editions are rebuilt by the actual service. They are authored reference inputs, not native saved-study receipts. Each complete comparison contains those studies exactly once.'},
  all,inRange,summary:{all:summary(all),inRange:summary(inRange)}};
}
function cell(value){let text=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);if(typeof value!=='number'&&/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
export function sedimentComparisonRowsCSV(document){
 const columns=['target_id','source_ids','selection','selection_reason','common_status','comparison_reasons','model_id','model_form','original_pair_id','original_cohort','original_target_mg_L','target_date','target_time','target_support','predictor_support','arithmetic_mean_mg_L','fitted_location_mg_L','mean_error_mg_L','absolute_mean_error_mg_L','individual_interval_lower_mg_L','individual_interval_upper_mg_L','nominal_interval_coverage','individual_interval_covered','range_status','outside_predictors','nonphysical','original_problems'];
 const records=[];
 for(const row of document.result.rows)for(const m of row.models)records.push([
  row.targetId,row.sourceIds,row.selection.action,row.selection.reason,row.status,row.reasons,m.studyId,document.result.models.find(x=>x.studyId===m.studyId).form,m.pairId||null,m.role,m.target?.value??null,m.target?.sampledDate??null,m.target?.sampledAt??null,m.target?.support??null,m.pairSupport??null,m.prediction?.mean??null,m.prediction?.location??null,m.meanError,m.absoluteMeanError,m.prediction?.predictionInterval?.lower??null,m.prediction?.predictionInterval?.upper??null,m.prediction?.predictionInterval?.coverage??null,m.individualIntervalCovered,m.range?.status??null,m.range?.outside??null,m.prediction?.nonphysical??null,m.problems]);
 return [columns.map(cell).join(','),...records.map(row=>row.map(cell).join(','))].join('\r\n')+'\r\n';
}
