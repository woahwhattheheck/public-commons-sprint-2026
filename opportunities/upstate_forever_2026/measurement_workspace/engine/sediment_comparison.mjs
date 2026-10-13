/**
 * Compare complete saved sediment study editions on explicitly chosen identical
 * held-out target observations. No fitting policy, winner, store or I/O is added.
 */
import {InputError} from './parse.mjs';
import {hash,stable} from './normalise.mjs';
import {rebuildSedimentStudy} from './sediment_workspace.mjs';

export const SEDIMENT_COMPARISON_SCHEMA='upstate.sediment-model-comparison/v1';
export const SEDIMENT_COMPARISON_SELECTION='upstate.sediment-model-comparison-selection/v1';
export const SEDIMENT_COMPARISON_LIMITS=Object.freeze({targets:100000,bytes:128*1024*1024-65536});
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function need(ok,message,status=400){if(!ok)throw new InputError(message,status);}
function text(v,label,max=8000,blank=false){need(typeof v==='string'&&v.length<=max&&!v.includes('\0')&&(blank||v.trim()),label+' must be bounded original text');return v;}
function exact(v,keys,label){need(object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>own(v,k)),label+' must retain exactly its declared fields');}
function snapshot(value,label){
 const seen=new Set();
 function walk(v){if(v===null||typeof v==='string'||typeof v==='boolean')return;if(typeof v==='number'){need(Number.isFinite(v),'Keep finite '+label+' numbers');return;}need(v&&typeof v==='object'&&!seen.has(v),'Keep acyclic complete '+label+' JSON');const proto=Object.getPrototypeOf(v);need(Array.isArray(v)||proto===Object.prototype||proto===null,'Keep plain '+label+' JSON');seen.add(v);if(Array.isArray(v)){for(let i=0;i<v.length;i++){need(own(v,i),'Keep every '+label+' array element');walk(v[i]);}}else for(const x of Object.values(v))walk(x);seen.delete(v);}
 walk(value);const raw=JSON.stringify(value);need(new TextEncoder().encode(raw).length<=SEDIMENT_COMPARISON_LIMITS.bytes,'Complete '+label+' exceeds the comparison capacity; retain originals and explicitly select a smaller population',413);return JSON.parse(raw);
}
const copy=v=>JSON.parse(JSON.stringify(v));
function targetIds(row){
 const ids=row.ssc?.sourceIds;need(Array.isArray(ids)&&ids.every(x=>typeof x==='string'&&x.trim())&&new Set(ids).size===ids.length,'Keep exact distinct original target-observation identities');
 return [...ids].sort();
}
export function sedimentTargetIdentity(sourceIds){
 need(Array.isArray(sourceIds)&&sourceIds.length&&sourceIds.every(x=>typeof x==='string'&&x.trim())&&new Set(sourceIds).size===sourceIds.length,'Select exact original target source identities');
 return hash(stable({kind:'sediment-target-observations',sourceIds:[...sourceIds].sort()}));
}
function binding(study){return study.result.fit.sourceBinding;}
function checkedStudies(input){
 const studies=snapshot(input,'saved studies');need(Array.isArray(studies)&&studies.length>=2,'Select at least two complete saved study editions within the declared whole-JSON capacity');
 const ids=new Set();for(const study of studies){need(study?.format==='upstate.sediment-surrogate-study/v1'&&SHA.test(study.id)&&!ids.has(study.id),'Choose distinct complete saved study identities');ids.add(study.id);const rebuilt=rebuildSedimentStudy(study.input);need(stable(rebuilt)===stable(study),'Saved candidate differs from its original sources, review context or maintained scientific result',409);}
 return studies;
}
function targetContext(originals,row){
 const original=originals.get(row.ssc.observationId);
 need(original&&original.recordId&&stable([...original.sourceIds].sort())===stable(targetIds(row)),'Retain the exact interpreted original target observation');
 need(original.value===row.ssc.value&&original.unit===row.ssc.unit&&original.analyte===row.ssc.analyte,'Target quantity differs from its interpreted original source');
 return {observationId:original.id,recordId:original.recordId,sourceIds:targetIds(row),value:original.value,unit:original.unit,analyte:original.analyte,siteId:original.siteId,method:original.method,censor:original.censor,rawValue:original.rawValue,sampledDate:original.sampledDate,sampledAt:original.sampledAt,support:copy(original.support),eventId:original.eventId,eventMeaning:row.eventMeaning||'unknown'};
}
function signature(target){const {observationId,recordId,sourceIds,rawValue,eventId,eventMeaning,...measured}=target;return stable(measured);}
function indexStudy(study){
 const pairing=study.result.pairing,fit=study.result.fit,decisions=new Map(fit.input.selection.cohorts.map(x=>[x.pairId,x])),results=new Map(fit.rows.map(x=>[x.id,x])),targets=new Map(),unidentified=[],originals=new Map((pairing.observations?.sediment||[]).map(x=>[x.id,x]));
 for(const pair of pairing.rows){
  const ids=targetIds(pair),choice=decisions.get(pair.id),outcome=results.get(pair.id);need(choice&&outcome,'Every saved pair needs its original cohort and outcome');
  if(!ids.length){unidentified.push({pairId:pair.id,role:choice.role,reason:choice.reason,issues:copy(pair.issues)});continue;}
  const targetId=sedimentTargetIdentity(ids),entry={pair,choice,outcome,target:targetContext(originals,pair)},items=targets.get(targetId)||[];items.push(entry);targets.set(targetId,items);
 }
 return {study,targets,unidentified};
}
function checked(input){
 const studies=checkedStudies(input),indexes=studies.map(indexStudy),universe=new Map();
 for(const item of indexes)for(const [targetId,entries]of item.targets)if(entries.some(x=>x.choice.role==='validate')){
  const previous=universe.get(targetId);if(!previous)universe.set(targetId,{targetId,sourceIds:copy(entries[0].target.sourceIds)});
 }
 need(universe.size<=SEDIMENT_COMPARISON_LIMITS.targets,'Complete common-cohort target capacity exceeded',413);
 return {studies,indexes,universe};
}
function modelDescriptor(index){
 const study=index.study,fit=study.result.fit;
 return {studyId:study.id,namedStudyId:study.study_id,parentId:study.parent_id,title:study.input.definition.title,actor:study.input.definition.actor,at:study.input.definition.at,workspaceRevision:study.input.workspace_revision,sourceBinding:copy(fit.sourceBinding),form:fit.model.form,includeDischarge:fit.input.selection.includeDischarge,confidence:fit.model.confidence,counts:copy(fit.counts),cohortSeparation:copy(fit.cohorts),coefficients:copy(fit.model.coefficients),predictors:copy(fit.model.predictors),responseTransform:fit.model.responseTransform,responseUnit:fit.model.responseUnit,coefficientBasis:fit.model.coefficientBasis,smearingFactor:fit.model.smearingFactor,smearingMethod:fit.model.smearingMethod,originalStatistics:copy(fit.statistics),uncertainty:copy(fit.uncertainty),guidance:copy(fit.guidance),unidentified:copy(index.unidentified)};
}
function catalogueFrom(value){
 return {schema:'upstate.sediment-model-comparison-catalogue/v1',models:value.indexes.map(modelDescriptor),targets:[...value.universe.values()].sort((a,b)=>a.targetId.localeCompare(b.targetId)).map(t=>({...t,models:value.indexes.map(i=>({studyId:i.study.id,entries:(i.targets.get(t.targetId)||[]).map(e=>({pairId:e.pair.id,role:e.choice.role,reason:e.choice.reason,target:copy(e.target),pairSupport:copy(e.pair.support),status:e.outcome.status,issues:copy(e.pair.issues)}))}))})),limits:SEDIMENT_COMPARISON_LIMITS};
}
export function catalogueSedimentComparison(studies){return snapshot(catalogueFrom(checked(studies)),'comparison catalogue');}
export const sedimentComparisonCatalogue=catalogueSedimentComparison;
function selection(value,context){
 const s=snapshot(value,'comparison selection');exact(s,['schema','id','title','actor','at','note','models','observations','rangePolicy','rationale'],'Comparison selection');
 need(s.schema===SEDIMENT_COMPARISON_SELECTION&&UUID.test(s.id),'Use the declared comparison selection and a canonical UUID');text(s.title,'Comparison title',240);text(s.actor,'Comparison author',240);text(s.note,'Comparison note',16000,true);text(s.rationale,'Comparison rationale',16000);
 need(typeof s.at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s.at)&&Number.isFinite(Date.parse(s.at)),'Retain an explicit zoned comparison authoring time');
 need(['include-flagged','in-range-only'].includes(s.rangePolicy),'Select all common observations with range flags, or the one common in-range population');
 need(Array.isArray(s.models)&&s.models.length===context.studies.length,'Retain every supplied candidate exactly once');
 const supplied=new Map(context.indexes.map(x=>[x.study.id,x])),used=new Set();
 for(const model of s.models){exact(model,['studyId','label','reason'],'Selected candidate');need(supplied.has(model.studyId)&&!used.has(model.studyId),'Comparison candidate identity is absent or repeated');used.add(model.studyId);text(model.label,'Candidate label',240);text(model.reason,'Candidate inclusion rationale');}
 need(Array.isArray(s.observations)&&s.observations.length===context.universe.size,'Choose include or exclude for every original target in the complete union of held-out populations');
 const chosen=new Set();for(const q of s.observations){exact(q,['targetId','action','reason'],'Observation selection');need(context.universe.has(q.targetId)&&!chosen.has(q.targetId),'Observation selection names an absent or duplicate original target');chosen.add(q.targetId);need(['include','exclude'].includes(q.action),'Choose include or exclude explicitly');text(q.reason,'Observation selection reason');}
 const order=s.models.map(m=>supplied.get(m.studyId)),first=binding(order[0].study);
 for(const index of order){const b=binding(index.study);need(b.target===first.target&&b.siteId===first.siteId&&stable(b.sensor)===stable(first.sensor)&&index.study.result.fit.model.responseUnit==='mg/L','Every compared model must retain the exact same target, site, sensor identity, turbidity unit and method, and target mg/L unit');need(Date.parse(s.at)>=Date.parse(index.study.input.definition.at),'Comparison cannot predate a selected saved model');}
 return {selection:s,indexes:order};
}
function rangeStatus(pair,model){
 const outside=[];for(const p of model.predictors){const q=pair[p.name];need(q&&typeof q.value==='number'&&Number.isFinite(q.value),'Retain the actual selected predictor for a calculated outcome');if(q.value<p.range.min||q.value>p.range.max)outside.push({predictor:p.name,value:q.value,unit:q.unit,range:copy(p.range),sourceIds:copy(q.sourceIds)});}
 return {status:outside.length?'outside-training-range':'inside-training-range',outside};
}
function outcome(index,targetId,label){
 const entries=index.targets.get(targetId)||[];
 if(entries.length!==1)return {studyId:index.study.id,label,status:entries.length?'ambiguous-target':'missing-target',entries:entries.map(e=>({pairId:e.pair.id,role:e.choice.role,target:copy(e.target),pairSupport:copy(e.pair.support),outcome:copy(e.outcome)})),target:null,role:null,prediction:null,range:null,problems:[entries.length?'multiple-pairs-use-original-target':'target-absent-from-candidate']};
 const e=entries[0],p=e.outcome.prediction||null,problems=[];
 if(e.choice.role!=='validate')problems.push(e.choice.role==='train'?'target-used-in-candidate-training':'target-excluded-by-candidate');
 if(e.pair.issues.length)problems.push(...e.pair.issues);
 if(!p||!Number.isFinite(p.mean)||p.unit!=='mg/L')problems.push('original-mean-prediction-unavailable');
 const meanError=p&&Number.isFinite(p.mean)?p.mean-e.target.value:null;
 const pi=p?.predictionInterval||null;
 const covered=pi&&Number.isFinite(pi.lower)&&Number.isFinite(pi.upper)?e.target.value>=pi.lower&&e.target.value<=pi.upper:null;
 const range=p?rangeStatus(e.pair,index.study.result.fit.model):null;
 return {studyId:index.study.id,label,pairId:e.pair.id,role:e.choice.role,cohortReason:e.choice.reason,status:e.outcome.status,target:copy(e.target),pairSupport:copy(e.pair.support),predictors:{turbidity:copy(e.pair.turbidity),discharge:copy(e.pair.discharge)},declaredEventIds:copy(e.pair.eventIds||[]),eventMeaning:e.pair.eventMeaning||'unknown',prediction:copy(p),range,meanError,absoluteMeanError:meanError===null?null:Math.abs(meanError),squaredMeanError:meanError===null||!Number.isFinite(meanError*meanError)?null:meanError*meanError,individualIntervalCovered:covered,intervalWidth:pi&&Number.isFinite(pi.upper-pi.lower)?pi.upper-pi.lower:null,problems:[...new Set(problems)]};
}
function sum(values){let result=0,c=0;for(const x of values){const t=result+x;c+=Math.abs(result)>=Math.abs(x)?(result-t)+x:(x-t)+result;result=t;}return result+c;}
function average(values){if(!values.length)return null;let scale=0;for(const x of values)scale=Math.max(scale,Math.abs(x));return scale===0?0:scale*sum(values.map(x=>x/scale))/values.length;}
function extrema(values){let min=Infinity,max=-Infinity;for(const x of values){if(x<min)min=x;if(x>max)max=x;}return {min,max};}
function metrics(rows,studyId){
 const selected=rows.filter(x=>x.common).map(row=>({targetId:row.targetId,outcome:row.models.find(x=>x.studyId===studyId)})),n=selected.length;
 if(!n)return {status:'UNAVAILABLE',count:0,targetIds:[],rmse:null,mae:null,bias:null,rSquared:null,intervalCoverage:null,meanIntervalWidth:null,nominalIntervalCoverage:null,reason:'No explicitly selected observation has complete common held-out support under this range policy',responseUnit:'mg/L'};
 const observed=selected.map(x=>x.outcome.target.value),errors=selected.map(x=>x.outcome.meanError),scale=extrema(errors.map(Math.abs)).max,rmse=scale===0?0:scale*Math.sqrt(sum(errors.map(x=>(x/scale)**2))/n),center=average(observed),deviations=observed.map(x=>x-center),dscale=extrema(deviations.map(Math.abs)).max;
 let rSquared=null,rSquaredReason=null;
 if(dscale===0)rSquaredReason='Observed common-cohort target has zero variation';
 else{const relative=scale/dscale,sse=scale===0?0:sum(errors.map(x=>(x/scale)**2)),sst=sum(deviations.map(x=>(x/dscale)**2)),value=1-relative*relative*sse/sst;if(Number.isFinite(value))rSquared=value;else rSquaredReason='Common-cohort squared-error ratio exceeds finite numerical capacity';}
 const covered=selected.filter(x=>x.outcome.individualIntervalCovered===true).length,validIntervals=selected.filter(x=>x.outcome.individualIntervalCovered!==null),widths=selected.map(x=>x.outcome.intervalWidth).filter(x=>x!==null);
 return {status:'CALCULATED',count:n,targetIds:selected.map(x=>x.targetId),rmse,mae:average(errors.map(Math.abs)),bias:average(errors),rSquared,rSquaredReason,intervalCoverage:validIntervals.length===n?covered/n:null,intervalCounts:{covered,available:validIntervals.length,requested:n},meanIntervalWidth:widths.length===n?average(widths):null,nominalIntervalCoverage:selected[0].outcome.prediction.predictionInterval.coverage,responseUnit:'mg/L',biasConvention:'predicted arithmetic mean minus observed target',rSquaredMeaning:'1 minus common-cohort squared prediction errors divided by common-cohort observed deviations from its mean',outsideTrainingRange:selected.filter(x=>x.outcome.range.outside.length).length,nonphysicalMeans:selected.filter(x=>x.outcome.prediction.nonphysical||x.outcome.prediction.mean<0).length};
}
function cohortRows(index,role){
 const rows=[];for(const [targetId,entries]of index.targets)for(const e of entries)if(e.choice.role===role)rows.push({targetId,pairId:e.pair.id,reason:e.choice.reason,target:copy(e.target),support:copy(e.pair.support),turbidity:copy(e.pair.turbidity),discharge:copy(e.pair.discharge),eventIds:copy(e.pair.eventIds||[]),eventMeaning:e.pair.eventMeaning||'unknown',issues:copy(e.pair.issues)});
 return rows;
}
export function compareSedimentStudies(studiesValue,selectionValue){
 const context=checked(studiesValue),selected=selection(selectionValue,context),s=selected.selection,indexes=selected.indexes,labels=new Map(s.models.map(x=>[x.studyId,x.label]));
 const rows=s.observations.map(choice=>{
  const target=context.universe.get(choice.targetId),models=indexes.map(i=>outcome(i,choice.targetId,labels.get(i.study.id))),reasons=[];
  for(const m of models)for(const problem of m.problems)reasons.push({studyId:m.studyId,reason:problem});
  const present=models.filter(m=>m.target);if(present.length&&present.some(m=>signature(m.target)!==signature(present[0].target)))reasons.push({studyId:null,reason:'same-target-identity-has-different-measured-value-or-original-support-interpretation'});
  const outside=models.filter(m=>m.range?.outside.length).map(m=>m.studyId);
  let status=choice.action==='exclude'?'EXCLUDED_BY_AUTHOR':reasons.length?'UNAVAILABLE':s.rangePolicy==='in-range-only'&&outside.length?'OUTSIDE_COMMON_RANGE':'COMMON';
  return {targetId:choice.targetId,sourceIds:copy(target.sourceIds),selection:copy(choice),common:status==='COMMON',status,reasons,outsideModelIds:outside,models};
 });
 const models=indexes.map(index=>({...modelDescriptor(index),label:labels.get(index.study.id),inclusion:s.models.find(m=>m.studyId===index.study.id).reason,comparisonMetrics:metrics(rows,index.study.id),calibrationPopulation:cohortRows(index,'train'),heldOutPopulation:cohortRows(index,'validate'),excludedPopulation:cohortRows(index,'exclude')}));
 const counts={models:models.length,unionHeldOutTargets:context.universe.size,explicitInclude:s.observations.filter(x=>x.action==='include').length,explicitExclude:s.observations.filter(x=>x.action==='exclude').length,common:rows.filter(x=>x.common).length,unavailable:rows.filter(x=>x.status==='UNAVAILABLE').length,outsideCommonRange:rows.filter(x=>x.status==='OUTSIDE_COMMON_RANGE').length};
 const nominal=new Set(models.map(x=>x.confidence)),warnings=[];
 if(nominal.size>1)warnings.push('Candidate intervals use different nominal coverage levels; their empirical coverages are not equivalent-coverage comparisons.');
 if(rows.some(r=>r.models.some(m=>m.prediction?.nonphysical||m.prediction?.mean<0)))warnings.push('A negative linear estimate is retained as calculated error evidence, without clamping; it is not an admissible deployed concentration.');
 if(rows.some(r=>r.outsideModelIds.length))warnings.push('Some original held-out predictors lie outside a candidate calibration range. The explicit common range policy governs metrics; every row and candidate range remains retained.');
 if(models.some(x=>!x.cohortSeparation.hydrologicGroupingAssessed))warnings.push('Original hydrologic grouping is unassessed for some samples. Source/event disjointness does not establish independent storms or statistical independence.');
 const input={studies:context.studies,selection:s},result={sourceBinding:{target:binding(indexes[0].study).target,siteId:binding(indexes[0].study).siteId,sensor:copy(binding(indexes[0].study).sensor),responseUnit:'mg/L'},counts,models,rows,warnings,interpretation:{status:'Exploratory comparison of scientist-selected saved candidates on an explicitly declared common held-out population',selectionUse:'Choosing or tuning a model using these observations consumes this holdout for selection; these same scores are not independent final validation of the resulting choice.',mean:'Scores use the original-scale arithmetic mean, including the original training-only Duan smearing factor for log-response candidates.',location:'Inverse-log fitted location is retained separately and is not substituted for the arithmetic mean.',intervals:'Coverage uses each original individual-observation prediction interval, not the location interval or an unclaimed arithmetic-mean confidence interval.',calibration:'Original training and fitted-scale statistics remain separately labeled; fitted-scale SSE, R-squared or unadjusted AIC do not rank models with different response transforms.',support:'The join is exact original target-observation identity and original target value/support, never row position or calendar date.',ranking:'No automatic winner, hypothesis test, p-value, independence conclusion, operational approval or target-load conversion.'}};
 return snapshot({schema:SEDIMENT_COMPARISON_SCHEMA,id:hash(stable(input)),input,result},'complete sediment comparison');
}
export function reopenSedimentComparison(value){
 need(value?.schema===SEDIMENT_COMPARISON_SCHEMA&&SHA.test(value.id),'Open the complete original comparison document');
 const rebuilt=compareSedimentStudies(value.input?.studies,value.input?.selection);need(stable(rebuilt)===stable(value),'Comparison differs from its complete saved candidates or original selection',409);return rebuilt;
}
