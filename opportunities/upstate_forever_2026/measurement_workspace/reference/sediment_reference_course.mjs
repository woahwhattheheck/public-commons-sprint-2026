/**
 * Complete, deterministic scientific calculations for the retained published USGS table.
 * Source intake is supplied by the maintained sediment reference adapter. This module
 * does not create a second workspace or grant approval to historical source records.
 */
import {fitSedimentSurrogate,predictSedimentSurrogate} from '../engine/sediment_surrogate.mjs';
import {InputError} from '../engine/parse.mjs';

const CUTOFF='2012-01-01';
const fail=message=>{throw new InputError(message);};
const counts=fit=>({selected:fit.counts.selected,training:fit.counts.training,validation:fit.counts.validation,excluded:fit.counts.excluded});
const descriptors=value=>JSON.parse(JSON.stringify(value));

/**
 * pair(input) and prediction(input) must be the original selected-source functions,
 * called by the adapter before this point. All retained original provenance travels
 * in pairing and prediction inputs; no numeric input is manufactured here.
 */
export function calculateSedimentReference({pairing,fullModel,temporalModel,predictionBlock,predictionFlag,source,provenance}){
 const retained=descriptors({pairing,fullModel,temporalModel,predictionBlock,predictionFlag,source,provenance});
 ({pairing,fullModel,temporalModel,predictionBlock,predictionFlag,source,provenance}=retained);
 if(pairing.rows.length!==120||pairing.target!=='SSC'||pairing.siteId!==provenance.station)fail('The reference needs all 120 original station SSC samples');
 if(new Set(pairing.rows.map(x=>x.id)).size!==120||new Set(pairing.rows.map(x=>x.sampledDate)).size!==115)fail('Published distinct sample/date population changed');
 for(const row of pairing.rows){
  if(row.support.precision!=='date'||row.sampledAt!==null||row.support.start!==row.sampledDate||row.support.end!==row.sampledDate)fail('The publication supplies dates only; no time or timezone may be invented');
  if(row.eventMeaning!=='sample')fail('The publication identifies samples, not independent hydrologic events');
 }
 if(fullModel.form!=='log-log'||!fullModel.includeDischarge||fullModel.confidence!==.95||fullModel.validationMode!=='held-out')fail('The declared full calibration selection changed');
 if(temporalModel.form!=='log-log'||!temporalModel.includeDischarge||temporalModel.confidence!==.95||temporalModel.validationMode!=='temporal')fail('The declared temporal selection changed');
 const all=new Map(fullModel.cohorts.map(x=>[x.pairId,x])),split=new Map(temporalModel.cohorts.map(x=>[x.pairId,x]));
 for(const row of pairing.rows){
  if(all.get(row.id)?.role!=='train'||split.get(row.id)?.role!==(row.sampledDate<CUTOFF?'train':'validate'))fail('Use the predeclared complete population and temporal cohort cut');
 }
 const fits={
  calibration:fitSedimentSurrogate(pairing,fullModel),
  temporalLogLog:fitSedimentSurrogate(pairing,temporalModel),
  temporalLinear:fitSedimentSurrogate(pairing,{...temporalModel,form:'linear',rationale:temporalModel.rationale+' Explicit raw-response/raw-predictor alternative; no automatic selection.'}),
  temporalLogLinear:fitSedimentSurrogate(pairing,{...temporalModel,form:'log-linear',rationale:temporalModel.rationale+' Explicit log10-response/raw-predictor alternative; no automatic selection.'})
 };
 const expectedLater=pairing.rows.filter(x=>x.sampledDate>=CUTOFF);
 for(const [kind,input] of [['block',predictionBlock],['flag',predictionFlag]]){
  if(input.extrapolation!==kind||input.rows.length!==52)fail('Retain every later actual source row under each explicit prediction policy');
  const expected=new Map(expectedLater.map(x=>[JSON.stringify(x.turbidity.sourceIds),x]));
  for(const row of input.rows){
   const original=expected.get(JSON.stringify(row.turbidity.sourceIds));
   if(!original||JSON.stringify(row.turbidity)!==JSON.stringify(original.turbidity)||JSON.stringify(row.discharge)!==JSON.stringify(original.discharge)||JSON.stringify(row.support)!==JSON.stringify(original.support))fail('Prediction must use the exact later source quantities/support');
   expected.delete(JSON.stringify(row.turbidity.sourceIds));
  }
  if(expected.size)fail('The complete selected prediction population changed');
 }
 const predictions={
  blocked:predictSedimentSurrogate(fits.temporalLogLog,predictionBlock),
  flagged:predictSedimentSurrogate(fits.temporalLogLog,predictionFlag)
 };
 if(counts(fits.calibration).training!==120||counts(fits.temporalLogLog).training!==68||counts(fits.temporalLogLog).validation!==52)fail('Reference cohorts differ from the predeclared 120/68/52 population');
 const beta=fits.calibration.model.coefficients,conversion=provenance.discharge_conversion.factor;
 const originalUnitsIntercept=beta[0].value+beta[2].value*Math.log10(conversion);
 const summary={
  schema:'upstate.sediment-reference-summary/v1',
  source,station:provenance.station,sensor:provenance.sensor,cutoff:CUTOFF,
  sourcePrecision:provenance.transcription.limitations,
  eventInterpretation:'Numbered samples preserve pairing; independent hydrologic event grouping is unknown.',
  publicationComparison:{
   published:{intercept:0.262,turbidity:0.933,discharge:0.0431,smearingFactor:1.02,dischargeUnit:'ft3/s'},
   reconstructed:{intercept:originalUnitsIntercept,turbidity:beta[1].value,discharge:beta[2].value,smearingFactor:fits.calibration.model.smearingFactor,dischargeUnit:'ft3/s'},
   roundedCoefficientsMatch:Math.round(originalUnitsIntercept*1000)===262&&Math.round(beta[1].value*1000)===933&&Math.round(beta[2].value*10000)===431&&Math.round(fits.calibration.model.smearingFactor*100)===102,
   interpretation:'Comparison is against published rounded coefficients using the raw columns at published precision; calibration agreement is not held-out validation.'
  },
  candidates:Object.fromEntries(Object.entries(fits).map(([name,fit])=>[name,{
   counts:counts(fit),coefficients:fit.model.coefficients,smearingFactor:fit.model.smearingFactor,
   training:fit.statistics.training,validation:fit.statistics.validation,
   trainingResponseScale:fit.statistics.trainingResponseScale,validationResponseScale:fit.statistics.validationResponseScale,
   trainingSupport:fit.cohorts.trainingSupport,validationSupport:fit.cohorts.validationSupport,
   hydrologicGroupingAssessed:fit.cohorts.hydrologicGroupingAssessed
  }])),
  predictionPolicies:{blocked:predictions.blocked.counts,flagged:predictions.flagged.counts,
   outsideTraining:predictions.flagged.rows.filter(x=>x.outside?.length).map(x=>({id:x.id,outside:x.outside})),
   interpretation:'Flagging retains an inspectable numerical estimate. It does not establish supported operation or scientific approval.'},
  modelSelection:'No automatic winner; comparing these candidates on one holdout is exploratory and does not create a second independent validation population.',
  uncertainty:fits.temporalLogLog.uncertainty,
  completeRowsRetained:true
 };
 return {schema:'upstate.sediment-reference-results/v1',input:retained,fits,predictions,summary};
}
