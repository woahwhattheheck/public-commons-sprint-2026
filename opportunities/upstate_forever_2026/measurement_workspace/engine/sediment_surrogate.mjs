/**
 * Source-bound suspended-sediment surrogate calculations for Measurements.
 * Pure deterministic calculations: no database, filesystem, clock or source fetching.
 * Pairing/interpretation owns original records; this module never reclassifies TSS.
 */
import {InputError} from './parse.mjs';

export const SEDIMENT_FIT_SCHEMA='upstate.sediment-surrogate-fit/v1';
export const SEDIMENT_PREDICTION_SCHEMA='upstate.sediment-surrogate-predictions/v1';
export const SEDIMENT_LIMITS=Object.freeze({rows:100000,bytes:64*1024*1024});
const SHA=/^[a-f0-9]{64}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function fail(message,status=400){throw new InputError(message,status);}
function object(x,label){if(!x||typeof x!=='object'||Array.isArray(x))fail(label+' must be an object');return x;}
function text(x,label,max=2000,blank=false){if(typeof x!=='string'||x.length>max||(!blank&&!x.trim()))fail(label+' must be '+(blank?'bounded':'nonempty bounded')+' text');return x;}
function number(x,label){if(typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1e100)fail(label+' must be a finite number within the numerical capacity');return x;}
function json(value){
 const seen=new Set();
 const visit=(v)=>{
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'){if(!Number.isFinite(v))fail('Retain finite JSON numbers');return;}
  if(!v||typeof v!=='object'||seen.has(v))fail('Retain an acyclic plain JSON input');
  const proto=Object.getPrototypeOf(v);if(!Array.isArray(v)&&proto!==Object.prototype&&proto!==null)fail('Retain plain JSON objects');
  seen.add(v);if(Array.isArray(v)){for(let i=0;i<v.length;i++){if(!own(v,i))fail('Retain complete JSON arrays');visit(v[i]);}}else for(const k of Object.keys(v))visit(v[k]);seen.delete(v);
 };
 visit(value);const raw=JSON.stringify(value);let bytes=0;
 for(const c of raw){const p=c.codePointAt(0);bytes+=p<128?1:p<2048?2:p<65536?3:4;}
 if(bytes>SEDIMENT_LIMITS.bytes)fail('The complete sediment result exceeds 64 MiB; narrow the explicit source population',413);
 return JSON.parse(raw);
}
function stable(value){return JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
function sum(values){let result=0,correction=0;for(const x of values){const t=result+x;correction+=Math.abs(result)>=Math.abs(x)?(result-t)+x:(x-t)+result;result=t;}return result+correction;}
function dot(a,b){return sum(a.map((x,i)=>x*b[i]));}
function mean(values){if(!values.length)return null;const first=values[0];return first+sum(values.map(x=>x-first))/values.length;}
function finite(x,label){if(!Number.isFinite(x))fail('Numerical capacity exceeded while calculating '+label);return Object.is(x,-0)?0:x;}
function squareSum(values){return finite(sum(values.map(x=>x*x)),'sum of squares');}
function range(values){let min=Infinity,max=-Infinity;for(const x of values){if(x<min)min=x;if(x>max)max=x;}return {min,max};}
function date(value){
 text(value,'Observation date',10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('Retain ISO observation dates');
 const n=Date.parse(value+'T00:00:00.000Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==value)fail('Invalid original observation date');
 return n;
}
function instant(value,label){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))fail(label+' needs an exact zoned ISO timestamp');
 date(value.slice(0,10));const clock=/T(\d{2}):(\d{2}):(\d{2})/.exec(value);
 if(+clock[1]>23||+clock[2]>59||+clock[3]>59)fail('Invalid original observation clock');
 const n=Date.parse(value);if(!Number.isFinite(n))fail('Invalid original observation timestamp');return n;
}
function support(row){
 date(row.sampledDate);
 if(row.sampledAt!==null&&row.sampledAt!==undefined)instant(row.sampledAt,'Original observation');
 const s=object(row.support,'Complete selected-observation support');
 if(!['instant','interval','date'].includes(s.precision))fail('Retain the original observation-support precision');
 const calendar=s.precision==='date',start=calendar?date(s.start):instant(s.start,'Support start'),end=calendar?date(s.end):instant(s.end,'Support end');
 if(end<start)fail('Original observation support ends before it starts');
 if(s.precision==='instant'&&start!==end)fail('Instant support must identify one actual instant');
 return {start,end,startLabel:s.start,endLabel:s.end,precision:s.precision,axis:calendar?'calendar':'instant'};
}
function declaredEvents(row){
 const ids=row.eventIds===undefined?(row.eventId?[row.eventId]:[]):row.eventIds;
 if(!Array.isArray(ids)||new Set(ids).size!==ids.length)fail('Retain unique original declared event identities');
 ids.forEach(id=>text(id,'Original event identity'));
 if(row.eventId&& !ids.includes(row.eventId))fail('The primary event must occur in the complete event identity list');
 return ids;
}
function eventMeaning(row){const value=row.eventMeaning||'unknown';if(!['sample','hydrologic-event','unknown'].includes(value))fail('Keep the original declared event meaning');return value;}
function sensor(value){
 object(value,'Sensor binding');text(value.id,'Sensor identity');text(value.method,'Sensor method',4000);
 if(!['FNU','NTU'].includes(value.unit))fail('Turbidity must retain its exact FNU or NTU unit; no interchange is performed');
 return value;
}
function quantity(q,label,unit,{nullable=false,unresolved=false}={}){
 object(q,label);text(q.unit,label+' original unit',200,true);if(q.unit!==unit&&!unresolved)fail(label+' has an incompatible source unit');
 if(q.value===null&&nullable){}else{number(q.value,label);if(q.value<0&&!unresolved)fail(label+' cannot be negative');}
 if(!Array.isArray(q.sourceIds)||(!q.sourceIds.length&&!(unresolved&&q.value===null))||new Set(q.sourceIds).size!==q.sourceIds.length)fail(label+' needs unique original observation identities');
 q.sourceIds.forEach(id=>text(id,label+' original observation ID'));
 return q;
}
function rows(value,unit,{training=false,target=null}={}){
 if(!Array.isArray(value)||!value.length||value.length>SEDIMENT_LIMITS.rows)fail('Select 1 to '+SEDIMENT_LIMITS.rows+' complete original rows',413);
 const ids=new Set();
 for(const row of value){
  object(row,'Original selected row');text(row.id,'Pair/observation identity');
  if(ids.has(row.id))fail('Original pair/observation identities must be unique');ids.add(row.id);
  if(row.eventId!==null&&row.eventId!==undefined)text(row.eventId,'Original event identity');
  if(!Array.isArray(row.issues)||row.issues.some(x=>typeof x!=='string'||!x.trim()))fail('Retain the complete row issue list');
  try{support(row);}catch(error){if(!row.issues.length)throw error;}
  declaredEvents(row);eventMeaning(row);
  quantity(row.turbidity,'Turbidity',unit,{nullable:true,unresolved:row.issues.length>0});
  if(training){quantity(row.ssc,'Selected sediment target concentration','mg/L',{nullable:true,unresolved:row.issues.length>0});if(row.ssc.analyte!==target)fail('The original target analyte differs from the selected SSC/TSS model');}
  if(row.discharge!==null&&row.discharge!==undefined)quantity(row.discharge,'Discharge','m3/s',{nullable:true,unresolved:row.issues.length>0});
 }
 return value;
}
function selection(value,pairing){
 object(value,'Model selection');
 if(!['linear','log-linear','log-log'].includes(value.form))fail('Choose linear, log-linear or log-log explicitly');
 if(typeof value.includeDischarge!=='boolean')fail('Choose explicitly whether to include discharge');
 if(!['temporal','held-out'].includes(value.validationMode))fail('Choose temporal or held-out validation explicitly');
 number(value.confidence,'Interval coverage');if(value.confidence<.5||value.confidence>.999)fail('Interval coverage must be between 0.5 and 0.999');
 text(value.rationale,'Scientific model/cohort rationale',16000);
 if(!Array.isArray(value.cohorts)||value.cohorts.length!==pairing.rows.length)fail('Assign every original pair exactly once to train, validate or exclude');
 const valid=new Set(pairing.rows.map(x=>x.id)),seen=new Set();
 for(const c of value.cohorts){
  object(c,'Cohort choice');if(!valid.has(c.pairId)||seen.has(c.pairId))fail('Cohort choices must select each original pair exactly once');seen.add(c.pairId);
  if(!['train','validate','exclude'].includes(c.role))fail('Unsupported cohort role');text(c.reason,'Cohort reason',8000,c.role!=='exclude');
 }
 return value;
}
function rawPredictors(row,selected){return selected.includeDischarge?[row.turbidity.value,row.discharge?.value]:[row.turbidity.value];}
function transformValues(row,selected,{response=true}={}){
 const values=rawPredictors(row,selected),reasons=[...row.issues];
 if(values.some(x=>typeof x!=='number'||!Number.isFinite(x)))reasons.push('missing-selected-predictor');
 if(selected.form==='log-log'&&values.some(x=>typeof x==='number'&&x<=0))reasons.push('nonpositive-log-predictor');
 if(response&&(typeof row.ssc.value!=='number'||!Number.isFinite(row.ssc.value)))reasons.push('missing-ssc');
 if(response&&selected.form!=='linear'&&typeof row.ssc.value==='number'&&row.ssc.value<=0)reasons.push('nonpositive-log-response');
 if(reasons.length)return {reasons:[...new Set(reasons)],x:null,y:null};
 return {reasons:[],x:values.map(x=>selected.form==='log-log'?Math.log10(x):x),y:response?(selected.form==='linear'?row.ssc.value:Math.log10(row.ssc.value)):null};
}
function repeatedObservations(values,selected){
 const uses=new Map(),events=new Map();
 for(const row of values){
  for(const q of [row.ssc,row.turbidity,...(selected.includeDischarge?[row.discharge]:[])])if(q)for(const id of q.sourceIds){const members=uses.get(id)||new Set();members.add(row.id);uses.set(id,members);}
  for(const id of declaredEvents(row)){const members=events.get(id)||[];members.push(row.id);events.set(id,members);}
 }
 return {observations:[...uses].filter(([,v])=>v.size>1).map(([id,v])=>({id,pairIds:[...v]})),events:[...events].filter(([,v])=>v.length>1).map(([id,pairIds])=>({id,pairIds}))};
}
function cohortSeparation(train,validate,selected){
 const mode=selected.validationMode;
 const seen=new Map(),events=new Set();
 for(const row of train){
  for(const [kind,q]of [['ssc',row.ssc],['turbidity',row.turbidity],...(selected.includeDischarge?[['discharge',row.discharge]]:[])])if(q)for(const id of q.sourceIds)seen.set(id,row.id);
  for(const id of declaredEvents(row))events.add(id);
 }
 for(const row of validate){
  for(const [kind,q]of [['ssc',row.ssc],['turbidity',row.turbidity],...(selected.includeDischarge?[['discharge',row.discharge]]:[])])if(q)for(const id of q.sourceIds)if(seen.has(id))fail('Training and validation reuse the same original '+kind+' observation: '+id);
  for(const id of declaredEvents(row))if(events.has(id))fail('Training and validation share the same declared sampling event: '+id);
 }
 const ts=train.map(support),vs=validate.map(support),axes=new Set([...ts,...vs].map(x=>x.axis));
 const extent=values=>{
  if(!values.length)return null;
  if(new Set(values.map(x=>x.axis)).size>1)return {axis:'mixed',start:null,end:null,supports:values.map(x=>({start:x.startLabel,end:x.endLabel,axis:x.axis,precision:x.precision}))};
  const first=values.reduce((a,b)=>a.start<=b.start?a:b),last=values.reduce((a,b)=>a.end>=b.end?a:b);
  return {axis:first.axis,start:first.startLabel,end:last.endLabel};
 };
 const trainSupport=extent(ts),validationSupport=extent(vs);
 const temporal=!!vs.length&&axes.size===1&&range(vs.map(x=>x.start)).min>range(ts.map(x=>x.end)).max;
 if(mode==='temporal'&&vs.length&&!temporal)fail('Temporal validation requires a common original calendar/instant axis and must lie strictly after the complete training support; no invented timezone, automatic split or dropped rows is permitted');
 const unassessed=[...train,...validate].filter(x=>eventMeaning(x)!=='hydrologic-event'||!declaredEvents(x).length).map(x=>x.id);
 return {mode,trainingSupport:trainSupport,validationSupport,temporalOrderConfirmed:temporal,sourceObservationsDisjoint:true,
  declaredEventsDisjoint:true,hydrologicGroupingAssessed:unassessed.length===0,hydrologicGroupingUnassessedIds:unassessed,
  reusedWithinTraining:repeatedObservations(train,selected),reusedWithinValidation:repeatedObservations(validate,selected),missingEventIds:[...train,...validate].filter(x=>!declaredEvents(x).length).map(x=>x.id),
  interpretation:(!vs.length?'No validation observations were selected.':mode==='temporal'?'Explicit later temporal validation; shared declared observations/events excluded by identity.':'Explicit source-disjoint held-out observations; no temporal or statistical-independence claim.')+' Published sample identity does not establish an independent hydrologic event. Event labels alone do not establish statistical independence.'};
}
// Log-gamma plus a convergent incomplete-beta continued fraction provide a
// Student-t quantile for the actual residual degrees of freedom (no normal shortcut).
function logGamma(z){
 const c=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
 if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);
 z-=1;let a=.99999999999980993;for(let i=0;i<c.length;i++)a+=c[i]/(z+i+1);
 const t=z+c.length-.5;return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(a);
}
function betaFraction(a,b,x){
 const tiny=1e-300,eps=2e-14;let c=1,d=1-(a+b)*x/(a+1);if(Math.abs(d)<tiny)d=tiny;d=1/d;let h=d;
 for(let m=1;m<=10000;m++){
  let aa=m*(b-m)*x/((a+2*m-1)*(a+2*m));
  d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;h*=d*c;
  aa=-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1));
  d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;const delta=d*c;h*=delta;
  if(Math.abs(delta-1)<eps)return h;
 }
 fail('The Student-t uncertainty calculation did not converge');
}
function regularizedBeta(x,a,b){
 if(x<=0)return 0;if(x>=1)return 1;
 const term=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
 return x<(a+1)/(a+b+2)?term*betaFraction(a,b,x)/a:1-term*betaFraction(b,a,1-x)/b;
}
function tCDF(x,df){if(x===0)return .5;const q=.5*regularizedBeta(df/(df+x*x),df/2,.5);return x>0?1-q:q;}
function tCritical(coverage,df){
 const target=(1+coverage)/2;let lo=0,hi=1;
 while(tCDF(hi,df)<target){hi*=2;if(hi>1e12)fail('The selected Student-t interval exceeds numerical capacity');}
 for(let i=0;i<90;i++){const mid=(lo+hi)/2;if(tCDF(mid,df)<target)lo=mid;else hi=mid;}
 return (lo+hi)/2;
}
function solveUpper(r,b){const x=Array(b.length).fill(0);for(let i=b.length-1;i>=0;i--)x[i]=(b[i]-sum(r[i].slice(i+1).map((v,k)=>v*x[i+k+1])))/r[i][i];return x;}
function qrFit(x,y,confidence){
 const n=y.length,k=x[0].length,p=k+1,df=n-p;if(df<1)fail('Training needs more observations than fitted parameters, including the intercept');
 const centers=Array.from({length:k},(_,j)=>mean(x.map(row=>row[j])));
 const scales=centers.map((center,j)=>Math.sqrt(squareSum(x.map(row=>row[j]-center))/n));
 if(scales.some(v=>!Number.isFinite(v)||v<=0))fail('A selected training predictor has no usable variation');
 const design=x.map(row=>[1,...row.map((v,j)=>(v-centers[j])/scales[j])]);
 const q=[],r=Array.from({length:p},()=>Array(p).fill(0));
 for(let j=0;j<p;j++){
  const col=design.map(row=>row[j]);
  for(let pass=0;pass<2;pass++)for(let i=0;i<j;i++){const coefficient=dot(q[i],col);r[i][j]+=coefficient;for(let v=0;v<n;v++)col[v]-=coefficient*q[i][v];}
  const length=Math.sqrt(squareSum(col));
  if(length<=1e-10*Math.sqrt(n))fail('The selected design is rank deficient or too close to singular; retain a different explicit model');
  r[j][j]=length;q.push(col.map(v=>v/length));
 }
 const b=solveUpper(r,q.map(column=>dot(column,y))),fitted=design.map(row=>dot(row,b)),residuals=y.map((v,i)=>v-fitted[i]);
 const sse=squareSum(residuals),variance=sse/df;
 const inverseR=Array.from({length:p},()=>Array(p).fill(0));
 for(let j=0;j<p;j++){const unit=Array(p).fill(0);unit[j]=1;const column=solveUpper(r,unit);for(let i=0;i<p;i++)inverseR[i][j]=column[i];}
 const informationInverse=Array.from({length:p},(_,i)=>Array.from({length:p},(_,j)=>dot(inverseR[i],inverseR[j])));
 const conversion=Array.from({length:p},()=>Array(p).fill(0));conversion[0][0]=1;
 for(let j=1;j<p;j++){conversion[0][j]=-centers[j-1]/scales[j-1];conversion[j][j]=1/scales[j-1];}
 const coefficients=conversion.map(row=>dot(row,b));
 const covariance=conversion.map(left=>conversion.map(right=>sum(left.flatMap((li,i)=>right.map((rj,j)=>li*rj*informationInverse[i][j]*variance)))));
 return {n,p,df,centers,scales,designCoefficients:b,coefficients,covariance,informationInverse,sse,variance,
  residualStandardError:Math.sqrt(variance),criticalT:tCritical(confidence,df),fitted,residuals,design,
  solver:{name:'centered-scaled modified Gram-Schmidt QR with reorthogonalization',rank:p,rankTolerance:1e-10,
   minDiagonal:Math.min(...r.map((row,i)=>row[i])),maxDiagonal:Math.max(...r.map((row,i)=>row[i]))}};
}
function leverage(v,inverse){return Math.max(0,finite(sum(v.flatMap((a,i)=>v.map((b,j)=>a*b*inverse[i][j]))),'leverage'));}
function power10(x){return finite(10**x,'inverse-log prediction');}
function predicted(x,model){
 const v=[1,...x.map((a,i)=>(a-model.centers[i])/model.scales[i])],location=dot(v,model.designCoefficients);
 const h=leverage(v,model.informationInverse),s=model.residualStandardError,t=model.criticalT;
 const meanDelta=t*s*Math.sqrt(h),predictionDelta=t*s*Math.sqrt(1+h),log=model.responseTransform==='log10';
 const inv=log?power10:x=>finite(x,'prediction');
 return {linearPredictor:finite(location,'linear predictor'),location:inv(location),mean:finite(inv(location)*model.smearingFactor,'bias-corrected mean'),
  locationInterval:{lower:inv(location-meanDelta),upper:inv(location+meanDelta),coverage:model.confidence,
   estimand:log?'inverse of the conditional mean on the log10 scale (conditional median under symmetric log errors)':'conditional arithmetic mean'},
  predictionInterval:{lower:inv(location-predictionDelta),upper:inv(location+predictionDelta),coverage:model.confidence,
   estimand:'individual '+model.target+' observation',method:'Student-t interval on fitted response scale, then inverse-transformed without a smearing multiplier'},
  leverage:h,unit:'mg/L',nonphysical:!log&&inv(location)<0};
}
function statistics(values,selected,scale='original'){
 if(!values.length)return {count:0,rmse:null,mae:null,bias:null,rSquared:null,intervalCoverage:null};
 const observed=values.map(x=>scale==='original'?x.observed:x.transformedObserved),estimate=values.map(x=>scale==='original'?x.prediction.mean:x.prediction.linearPredictor);
 const error=observed.map((x,i)=>x-estimate[i]),center=mean(observed),sst=squareSum(observed.map(x=>x-center));
 return {count:values.length,rmse:Math.sqrt(squareSum(error)/values.length),mae:mean(error.map(Math.abs)),
  bias:mean(estimate.map((x,i)=>x-observed[i])),rSquared:sst>0?1-squareSum(error)/sst:null,
  intervalCoverage:scale==='original'?values.filter(x=>x.observed>=x.prediction.predictionInterval.lower&&x.observed<=x.prediction.predictionInterval.upper).length/values.length:null,
  responseScale:scale==='original'?'mg/L':selected.form==='linear'?'mg/L':'log10(mg/L)',
  biasConvention:'predicted minus observed',rSquaredMeaning:'1 - sum squared prediction errors / sum squared deviations from this cohort mean'};
}
function diagnostics(train,model){
 const ordered=[...train].sort((a,b)=>support(a.source).start-support(b.source).start||a.id.localeCompare(b.id));
 const residuals=ordered.map(x=>x.residual),sse=squareSum(residuals),center=mean(residuals);
 const denominator=squareSum(residuals.map(x=>x-center));
 return {residualOrder:ordered.map(x=>x.id),durbinWatson:sse?sum(residuals.slice(1).map((x,i)=>(x-residuals[i])**2))/sse:null,
  lagOneCorrelation:denominator?sum(residuals.slice(1).map((x,i)=>(x-center)*(residuals[i]-center)))/denominator:null,
  temporalDiagnosticMeaning:'Descriptive adjacent residuals in retained observation-time order; irregular spacing, shared storms and missing event IDs prevent an automatic independence conclusion.',
  press:train.every(x=>x.deletedResidual!==null)?squareSum(train.map(x=>x.deletedResidual)):null,
  highLeverageIds:train.filter(x=>x.prediction.leverage>2*model.p/model.n).map(x=>x.id),
  cookDistanceOverOneIds:train.filter(x=>x.cooksDistance!==null&&x.cooksDistance>1).map(x=>x.id),
  studentizedOverThreeIds:train.filter(x=>x.studentizedResidual!==null&&Math.abs(x.studentizedResidual)>3).map(x=>x.id),
  outlierHandling:'No automatic exclusions or winsorization. All original selections and residuals remain retained.'};
}

/** Fit one explicitly selected candidate; every original pair remains in input and outcomes. */
export function fitSedimentSurrogate(pairingValue,selectionValue){
 const pairing=json(pairingValue),selected=json(selectionValue);object(pairing,'Source-bound pairing');
 if(pairing.schema!=='upstate.sediment-pairing/v1'||!SHA.test(pairing.id||''))fail('Select a complete source-bound sediment pairing');
 text(pairing.siteId,'Site identity');sensor(pairing.sensor);if(!['SSC','TSS'].includes(pairing.target))fail('Keep an explicit original SSC or TSS target');rows(pairing.rows,pairing.sensor.unit,{training:true,target:pairing.target});selection(selected,pairing);
 const chosen=new Map(selected.cohorts.map(c=>[c.pairId,c]));
 const training=pairing.rows.filter(row=>chosen.get(row.id).role==='train'),validation=pairing.rows.filter(row=>chosen.get(row.id).role==='validate');
 if(!training.length)fail('Select training observations explicitly');
 const transformed=new Map();
 for(const row of [...training,...validation]){
  const value=transformValues(row,selected);if(value.reasons.length)fail('Pair '+row.id+' cannot enter '+chosen.get(row.id).role+': '+value.reasons.join(', ')+'. Retain an explicit exclusion or repair the original source selection.');
  transformed.set(row.id,value);
 }
 const separation=cohortSeparation(training,validation,selected),fit=qrFit(training.map(x=>transformed.get(x.id).x),training.map(x=>transformed.get(x.id).y),selected.confidence);
 const smear=selected.form==='linear'?1:mean(fit.residuals.map(power10));
 const names=['intercept','turbidity',...(selected.includeDischarge?['discharge']:[])];
 const model={form:selected.form,target:pairing.target,response:pairing.target==='SSC'?'suspended-sediment concentration':'total suspended solids',responseUnit:'mg/L',responseTransform:selected.form==='linear'?'identity':'log10',
  predictors:names.slice(1).map((name,i)=>({name,unit:name==='turbidity'?pairing.sensor.unit:'m3/s',transform:selected.form==='log-log'?'log10':'identity',range:range(training.map(row=>rawPredictors(row,selected)[i]))})),
  n:fit.n,p:fit.p,df:fit.df,confidence:selected.confidence,criticalT:fit.criticalT,centers:fit.centers,scales:fit.scales,
  designCoefficients:fit.designCoefficients,informationInverse:fit.informationInverse,covariance:fit.covariance,
  coefficients:names.map((name,i)=>({name,value:fit.coefficients[i],standardError:Math.sqrt(Math.max(0,fit.covariance[i][i])),
   lower:fit.coefficients[i]-fit.criticalT*Math.sqrt(Math.max(0,fit.covariance[i][i])),upper:fit.coefficients[i]+fit.criticalT*Math.sqrt(Math.max(0,fit.covariance[i][i]))})),
  coefficientBasis:'original transformed predictor units; centering/scaling used only internally',residualStandardError:fit.residualStandardError,variance:fit.variance,
  smearingFactor:smear,smearingMethod:selected.form==='linear'?'none':'Duan arithmetic mean of 10^residual over training rows only',solver:fit.solver};
 const outcomes=[],trainDiagnostics=[];
 for(const row of pairing.rows){
  const choice=chosen.get(row.id);
  if(choice.role==='exclude'){outcomes.push({id:row.id,role:'exclude',reason:choice.reason,status:'excluded',issues:[...row.issues]});continue;}
  const t=transformed.get(row.id),prediction=predicted(t.x,model),residual=t.y-prediction.linearPredictor;
  const result={id:row.id,role:choice.role,reason:choice.reason,status:prediction.nonphysical?'nonphysical-estimate':'calculated',observed:row.ssc.value,transformedObserved:t.y,
   prediction,residual,originalMeanResidual:row.ssc.value-prediction.mean};
  if(choice.role==='train'){
   const remain=1-prediction.leverage,standard=fit.residualStandardError>0&&remain>1e-12?residual/(fit.residualStandardError*Math.sqrt(remain)):null;
   result.studentizedResidual=standard;result.studentizedResidualKind='internally studentized using the complete training residual variance';result.deletedResidual=remain>1e-12?residual/remain:null;
   result.cooksDistance=fit.variance>0&&remain>1e-12?residual*residual*prediction.leverage/(fit.p*fit.variance*remain*remain):null;
   trainDiagnostics.push({...result,source:row});
  }
  outcomes.push(result);
 }
 const trainRows=outcomes.filter(x=>x.role==='train'),validationRows=outcomes.filter(x=>x.role==='validate');
 const guidance=[];
 if(pairing.target==='TSS')guidance.push({code:'tss-is-separate-target',message:'This empirical model targets the actual TSS analytical result. TSS is not SSC; USGS SSC model-policy criteria and sediment-load equivalence are not asserted.'});
 const recommended=selected.includeDischarge?48:36;
 if(pairing.target==='SSC'&&training.length<recommended)guidance.push({code:'limited-calibration-population',message:'The 2016 USGS guidance recommends '+recommended+' samples for '+(selected.includeDischarge?'two':'one')+' explanatory variable(s); the operator must justify actual seasonal, hydrologic, method and event coverage. This is not an approval decision.'});
 if(!validation.length)guidance.push({code:'no-held-out-validation',message:'No held-out observations were selected; calibration fit is not validation evidence.'});
 if(separation.reusedWithinTraining.observations.length||separation.reusedWithinTraining.events.length)guidance.push({code:'within-training-dependence',message:'Training includes repeated original observations or declared events. OLS intervals assume independence; retained groups require scientific assessment and are not automatically aggregated or deleted.'});
 if(!separation.hydrologicGroupingAssessed)guidance.push({code:'event-grouping-unassessed',message:'Some original hydrologic event groupings are unavailable or identify samples only; absence of a declared event match does not establish storm or statistical independence.'});
 if(outcomes.some(x=>x.prediction?.nonphysical))guidance.push({code:'nonphysical-linear-estimate',message:'An untransformed linear model produced a negative concentration estimate. It is retained without clamping and is not an admissible deployed concentration.'});
 return json({schema:SEDIMENT_FIT_SCHEMA,input:{pairing,selection:selected},sourceBinding:{pairingId:pairing.id,target:pairing.target,siteId:pairing.siteId,sensor:pairing.sensor},
  model,cohorts:separation,counts:{selected:pairing.rows.length,training:training.length,validation:validation.length,excluded:outcomes.filter(x=>x.role==='exclude').length},
  statistics:{training:statistics(trainRows,selected),validation:statistics(validationRows,selected),trainingResponseScale:statistics(trainRows,selected,'response'),validationResponseScale:statistics(validationRows,selected,'response')},
  diagnostics:diagnostics(trainDiagnostics,model),guidance,rows:outcomes,
  uncertainty:{interpretation:'Pointwise conditional OLS intervals, not simultaneous bands or an unconditional environmental uncertainty budget.',
   assumptions:['Independent errors conditional on the selected predictors','Constant residual variance on the fitted response scale','Normally distributed fitted-scale errors for Student-t coverage','Correct model form and compatible source/sensor population'],
   excludedComponents:['Additional sensor or laboratory error beyond the fitted residual variation','Uncertain source pairing and censoring interpretation','Model-selection and coefficient nonstationarity uncertainty'],
   logMeanInterval:'No arithmetic-mean confidence interval is claimed for the estimated smearing factor; location intervals target the fitted transformed response.'},
  authority:{methodSources:['https://pubs.usgs.gov/tm/tm3c4/','https://water.usgs.gov/admin/memo/SW/sw.2016.07%2Bwq.2016.10.pdf','https://www.itl.nist.gov/div898/handbook/pmd/section5/pmd512.htm'],
   status:'Scientist-selected candidate; software calculation does not confer USGS approval or authority to publish operational data.'}});
}

/** Rebuild the exact original fit before applying it to separately source-bound surrogate observations. */
export function predictSedimentSurrogate(fitValue,inputValue){
 const fit=json(fitValue),input=json(inputValue);
 if(fit.schema!==SEDIMENT_FIT_SCHEMA||!fit.input)fail('Select a complete fitted sediment model');
 const rebuilt=fitSedimentSurrogate(fit.input.pairing,fit.input.selection);
 if(stable(rebuilt)!==stable(fit))fail('The fitted model differs from its original pairing or explicit scientific selection',409);
 if(input.schema!=='upstate.sediment-prediction-input/v1'||!SHA.test(input.id||''))fail('Select a complete source-bound prediction input');
 text(input.siteId,'Prediction site');sensor(input.sensor);
 if(input.target!==fit.sourceBinding.target||input.siteId!==fit.sourceBinding.siteId||stable(input.sensor)!==stable(fit.sourceBinding.sensor))fail('Prediction target, site, sensor identity, method and unit must match the fitted original binding');
 if(!['block','flag'].includes(input.extrapolation))fail('Choose explicit block or flag handling for out-of-range predictors');
 rows(input.rows,input.sensor.unit);
 const result=input.rows.map(row=>{
  const transformed=transformValues(row,fit.input.selection,{response:false});
  if(transformed.reasons.length)return {id:row.id,status:'unresolved',reasons:transformed.reasons,prediction:null};
  const raw=rawPredictors(row,fit.input.selection),outside=[];
  fit.model.predictors.forEach((p,i)=>{if(raw[i]<p.range.min||raw[i]>p.range.max)outside.push({predictor:p.name,value:raw[i],range:p.range});});
  if(outside.length&&input.extrapolation==='block')return {id:row.id,status:'outside-training-range',reasons:['explicit-extrapolation-block'],outside,prediction:null};
  const prediction=predicted(transformed.x,fit.model);
  return {id:row.id,status:prediction.nonphysical?'nonphysical-estimate':outside.length?'extrapolated':'calculated',outside,prediction,
   observedAt:row.sampledAt||null,observedDate:row.sampledDate,interpretation:'Estimated '+fit.model.target+' at this actual surrogate observation support; no interpolation or future surrogate forecast.'};
 });
 return json({schema:SEDIMENT_PREDICTION_SCHEMA,input,fitInput:fit.input,sourceBinding:fit.sourceBinding,
  counts:{selected:result.length,calculated:result.filter(x=>x.prediction&&!x.prediction.nonphysical).length,unresolved:result.filter(x=>!x.prediction||x.prediction.nonphysical).length},
  rows:result,unit:'mg/L',estimand:fit.model.response,target:fit.model.target,loadConversion:'none',
  extrapolation:{selection:input.extrapolation,interpretation:'Flagging permits an inspectable numerical estimate, not a deployment approval. Training-range and sensor-performance support remain distinct.'},
  uncertainty:fit.uncertainty});
}
