import {InputError,clean,csv} from './parse.mjs';
import {hash,stable} from './normalise.mjs';

/** Export exact measured inputs for explicit downstream temporal/model binding, retaining all exclusions and their causes. */
export function calibrationExport(workspace,filters={}) {
  const value=workspace.readConsistent(()=>{
  const accepted=[],excluded=[];
  for(const row of workspace.iterate(filters)) {
    const reasons=[...row.eligible.reasons];
    const base={id:row.id,stationId:row.stationId,reachId:row.mapping?.reachId||'',sampledDate:row.sampledDate,sampledAt:row.sampledAt,timePrecision:row.timePrecision,
      parameter:row.parameter,unit:row.unit,value:row.value,censor:row.censor,lower:row.lower,upper:row.upper,basis:row.basis,fraction:row.fraction,method:row.method,
      sourceResultId:row.sourceResultId,logicalKey:row.logicalKey,sourceReferences:workspace.recordSources(row.id)};
    if(reasons.length)excluded.push({...base,reasons:[...new Set(reasons)]});
    else accepted.push(base);
  }
  const value={format:'upper-savannah-calibration-input',version:1,createdAt:new Date().toISOString(),workspaceRevision:workspace.revision(),filters,accepted,excluded,
    counts:{accepted:accepted.length,excluded:excluded.length},rules:{nondetectSubstitution:'none',replicateAggregation:'none',bod5ToUltimateBod:'not-performed',timeMatching:'not-performed',fractions:'preserved',nativeAnnualLoadBinding:'explicit downstream derivation required; PO4_KG/NH4_KG/NO3_KG are not concentration aliases'}};
  return value;});
  value.sha256=hash(stable(value));value.exportId=workspace.snapshot('calibration',value);return value;
}
export function calibrationCSV(value) {
  return csv(value.accepted,['id','stationId','reachId','sampledDate','sampledAt','timePrecision','parameter','basis','fraction','value','unit','method','sourceResultId']);
}
/** Discrete concentration × explicitly paired daily mean flow, never an annual load. */
export function pairedLoads(workspace,input) {
  const stationId=clean(input.stationId),flowStationId=clean(input.flowStationId),rationale=clean(input.rationale);
  if(!stationId||!flowStationId||!rationale)throw new InputError('Chemistry station, discharge station and pairing rationale are required');
  const parameter=clean(input.parameter);if(!['tn','tp'].includes(parameter))throw new InputError('Load calculations support explicitly total nitrogen or total phosphorus');
  const flowByDay=new Map();
  for(const row of workspace.iterate({stationId:flowStationId,parameter:'flow',from:input.from,to:input.to})) {
    if(row.sourceKind!=='usgs-daily'||!row.eligible.ok)continue;
    const values=flowByDay.get(row.sampledDate)||[];values.push(row);flowByDay.set(row.sampledDate,values);
  }
  const paired=[],unpaired=[];
  for(const row of workspace.iterate({stationId,parameter,from:input.from,to:input.to})) {
    const reasons=row.eligible.reasons.filter(x=>x!=='censored-result'&&x!=='missing-numeric-result');
    const flows=flowByDay.get(row.sampledDate)||[];
    if(flows.length!==1)reasons.push(flows.length?'ambiguous-daily-flow':'no-matching-daily-flow');
    if(row.censor==='none'&&row.value===null)reasons.push('missing-concentration');
    if(row.censor!=='none'&&row.lower===null&&row.upper===null)reasons.push('unresolved-censor-bound');
    if(reasons.length){unpaired.push({measurementId:row.id,date:row.sampledDate,reasons});continue;}
    const flow=flows[0],factor=flow.value*86.4;
    paired.push({measurementId:row.id,flowMeasurementId:flow.id,date:row.sampledDate,stationId,flowStationId,parameter,basis:row.basis,fraction:row.fraction,
      concentrationMgL:row.value,flowM3s:flow.value,estimatedKgPerDay:row.value===null?null:row.value*factor,
      lowerKgPerDay:row.lower===null?null:row.lower*factor,upperKgPerDay:row.upper===null?null:row.upper*factor,censor:row.censor,
      temporalSupport:'discrete concentration paired to source-calendar-date daily mean discharge',rationale,
      assumptions:['Daily flow date is the provider calendar date; no unknown sampling timezone conversion.','Concentration is a discrete sample, not a daily mean.','No interpolation, annualization, cross-station area scaling or regulatory inference.']});
  }
  const value={format:'upper-savannah-paired-loads',version:1,createdAt:new Date().toISOString(),workspaceRevision:workspace.revision(),paired,unpaired,input};
  value.exportId=workspace.snapshot('paired-loads',value);return value;
}
