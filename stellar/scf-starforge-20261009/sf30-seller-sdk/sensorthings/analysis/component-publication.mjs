// MIT. Source-bound component reporting in the existing publication operation.
import {plain,fault} from '../contract.mjs';
import {componentNumericEligibility,COMPONENT_MEANING} from './components.mjs';
import {componentEventFigure} from './component-report.mjs';

const PER_STREAM_PLOT=10000,TOTAL_PLOT=25000;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cell=x=>'"'+(x===null||x===undefined?'':typeof x==='string'?x:JSON.stringify(x)).replaceAll('"','""')+'"';
const line=x=>x.map(cell).join(',')+'\r\n';
function ns(value){if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{9}Z$/.test(value??''))return null;
  const ms=Date.parse(value.slice(0,19)+'Z');return Number.isFinite(ms)?BigInt(ms)*1000000n+BigInt(value.slice(20,29)):null;}
function seconds(value){const whole=value/1000000000n,fraction=String(value%1000000000n).padStart(9,'0').replace(/0+$/,'');return String(whole)+(fraction?'.'+fraction:'');}
function table(headers,rows){return '<div class="table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td><code>'+esc(x===null||x===undefined?'Not calculated':typeof x==='string'?x:JSON.stringify(x))+'</code></td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
export function createComponentPublication(summary,selection){
  if(!Array.isArray(selection.componentSelections))return null;
  if(summary.analysisKind!=='explicit-multidatastream-components')throw fault('ANALYSIS_COMPONENT_REPORT','Use the exact component summary.',409);
  return {summary,selection,total:0,plotted:0,streams:new Map(summary.streams.map(s=>[s.key,{summary:s,times:new Map(),plot:[],numeric:0,total:0}]))};
}
export function captureComponentPublication(state,{row,original,streamKey}){
  if(!state)return;
  const stream=state.streams.get(streamKey);
  if(!stream||row.component_binding_id!==stream.summary.componentBindingId)throw fault('ANALYSIS_COMPONENT_REPORT','The row differs from its saved positional binding.',409);
  state.total++;stream.total++;
  const reference={observationId:row.observation_id,observationIdType:row.observation_id_type,
    observationOccurrenceId:original.occurrenceId,componentOccurrenceId:original.componentOccurrenceId,
    sourceRef:original.sourceRef,componentSourceRef:original.componentSourceRef,
    phenomenonTime:row.phenomenon_time,value:row.result,resultState:row.result_state,resultType:row.result_type,
    qualityState:row.result_quality_state,quality:row.result_quality};
  if(row.phenomenon_time_kind==='explicit_instant'&&ns(row.phenomenon_start_utc)!==null){
    const values=stream.times.get(row.phenomenon_start_utc)??[];values.push(reference);stream.times.set(row.phenomenon_start_utc,values);
  }
  const numeric=componentNumericEligibility(row);
  if(numeric.eligible){
    stream.numeric++;
    if(stream.plot.length<PER_STREAM_PLOT&&state.plotted<TOTAL_PLOT){
      stream.plot.push({time:row.phenomenon_start_utc,timeLiteral:row.phenomenon_time,timeKind:row.phenomenon_time_kind,
        value:row.result,state:row.result_state,type:row.result_type,numericEligibility:numeric,
        observationId:row.observation_id,observationIdType:row.observation_id_type,
        sourceRef:original.componentSourceRef,quality:row.result_quality,qualityState:row.result_quality_state});
      state.plotted++;
    }
  }
}
export function finishComponentPublication(state,{version,edition,createdAt}){
  if(!state)return null;
  if(state.total!==state.summary.totalOccurrences)throw fault('ANALYSIS_COMPONENT_REPORT','The complete selected rows differ from their saved summary.',409);
  const streams=[],figures=[];
  for(const [key,value]of state.streams){
    const s=value.summary,ordered=[...value.times.keys()].sort(),duplicates=[],gaps=[];
    if(value.total!==s.rows||value.numeric!==s.numericEligibleRows)throw fault('ANALYSIS_COMPONENT_REPORT','Component row or browser eligibility counts changed.',409);
    for(const utc of ordered){const occurrences=value.times.get(utc);if(occurrences.length>1)duplicates.push({utc,occurrences});}
    for(let i=1;i<ordered.length;i++){
      const from=ordered[i-1],to=ordered[i],elapsed=ns(to)-ns(from);
      gaps.push({fromUtc:from,toUtc:to,seconds:seconds(elapsed),
        leftOccurrences:value.times.get(from),rightOccurrences:value.times.get(to)});
    }
    const detail={seriesKey:key,sourceStreamKey:s.sourceStreamKey,index:s.componentIndex,name:s.componentName??s.name,
      bindingId:s.componentBindingId,meaningId:s.componentMeaningId,unit:s.unit,declaredType:s.observationType,
      interpretation:s.interpretation,component:s.component,sourceRef:s.sourceRef,originalStreamJson:s.sourceJson,
      selectedOccurrences:s.rows,exactNumericSamples:s.exactNumericEligibleRows,browserNumericSamples:s.numericEligibleRows,
      numericSummary:s.numericSummary,days:s.days,qualityStates:s.qualityStates,qualityValues:s.qualityValues,
      distinctInstants:ordered.length,duplicateInstants:duplicates,adjacentGaps:gaps,
      figure:{includedPoints:value.plot.length,eligiblePoints:value.numeric,omittedPoints:value.numeric-value.plot.length,
        perStreamLimit:PER_STREAM_PLOT,totalLimit:TOTAL_PLOT,order:'original retained source order'},
      sourceTimeSupport:{continuousCoverage:null,expectedSampleCount:null,interpolation:null,timeWeightedMean:null}};
    let window=null;
    if(state.selection.period)window={start:state.selection.period.startUtc,endExclusive:state.selection.period.endUtc};
    else if(ordered.length){
      const first=Date.parse(ordered[0]),last=Date.parse(ordered.at(-1));
      // Padding affects only the drawing viewport. It is not source time support.
      window={start:new Date(first).toISOString(),endExclusive:new Date(last+1).toISOString()};
    }
    if(window){
      const figure=componentEventFigure({...detail,plot:value.plot},window);
      figures.push({...figure,filename:'component-'+s.componentIndex+'-'+key.slice(0,16)+'.svg',seriesKey:key});
    }
    streams.push(detail);
  }
  return {schema:'stellar-forge.sensorthings-component-publication-report.v1',versionId:version.id,editionId:edition.id,createdAt,
    selection:state.selection,source:{serviceUrl:edition.source.serviceUrl,scope:edition.scope,issues:edition.issues,
      license:edition.source.license,files:edition.sourceFiles},totalComponentOccurrences:state.total,streams,figures,
    meaning:{...COMPONENT_MEANING,source:'This report is derived from one actual saved native edition and analysis version. The complete selected row fields/vectors are in observations.csv and observations.ndjson.',
      figure:'Source-order point figures have declared rendering bounds. All selected observations and original citations remain in the complete CSV/NDJSON. A viewport margin does not supply source coverage.',
      summary:'Exact arithmetic is over eligible retained samples, preserving repeated instants as distinct observations; it is not a time-weighted mean.'}};
}
export function* componentPublicationCSV(report,kind){
  if(!report||report.schema!=='stellar-forge.sensorthings-component-publication-report.v1')throw fault('ANALYSIS_COMPONENT_REPORT','Use the complete native component report.',409);
  const base=s=>[report.editionId,report.versionId,s.sourceStreamKey,s.seriesKey,s.index,s.bindingId,JSON.stringify(s.unit)];
  if(kind==='summary'){
    yield line(['edition_id','version_id','source_stream_key','series_key','component_index','binding_id','original_unit','original_declaration','interpretation',
      'selected_occurrences','exact_samples','browser_samples','sum_exact','mean_numerator','mean_denominator','mean_decimal_half_even_12','minimum','maximum',
      'distinct_instants','repeated_instants','source_reference','continuous_coverage','time_weighted_mean']);
    for(const s of report.streams){const n=s.numericSummary;yield line([...base(s),s.declaredType,s.interpretation,s.selectedOccurrences,s.exactNumericSamples,s.browserNumericSamples,
      n.sumExact,n.mean?.exactNumerator,n.mean?.exactDenominator,n.mean?.decimal,n.minimum,n.maximum,s.distinctInstants,s.duplicateInstants.length,s.sourceRef,null,null]);}
  }else if(kind==='days'){
    yield line(['edition_id','version_id','source_stream_key','series_key','component_index','binding_id','original_unit','utc_day','instant_occurrences','exact_samples',
      'sum_exact','mean_numerator','mean_denominator','mean_decimal_half_even_12','minimum','maximum','quality_presence']);
    for(const s of report.streams)for(const day of s.days){const n=day.numericSummary;yield line([...base(s),day.day,day.events,n.count,n.sumExact,n.mean?.exactNumerator,n.mean?.exactDenominator,
      n.mean?.decimal,n.minimum,n.maximum,day.qualityStates]);}
  }else if(kind==='duplicates'){
    yield line(['edition_id','version_id','source_stream_key','series_key','component_index','binding_id','original_unit','utc_instant','occurrence_count','complete_original_occurrence_citations']);
    for(const s of report.streams)for(const d of s.duplicateInstants)yield line([...base(s),d.utc,d.occurrences.length,d.occurrences]);
  }else if(kind==='gaps'){
    yield line(['edition_id','version_id','source_stream_key','series_key','component_index','binding_id','original_unit','from_utc','to_utc','separation_seconds',
      'left_original_occurrences','right_original_occurrences','interval_support_inferred']);
    for(const s of report.streams)for(const g of s.adjacentGaps)yield line([...base(s),g.fromUtc,g.toUtc,g.seconds,g.leftOccurrences,g.rightOccurrences,false]);
  }else throw fault('ANALYSIS_COMPONENT_REPORT','Choose summary, days, duplicates or gaps.',400);
}
export function componentPublicationHTML(report){
  if(!report)return '';
  let html='<section id="components"><h2>Explicit original component positions</h2>'+
    '<p>Every selected position retains its original property, unit, declaration and complete result vector. Numeric JSON interpretation is attributed to the saved operator decision. Exact occurrence arithmetic and browser plotting are reported separately.</p>'+
    '<p>Repeated timestamps remain separate observations. Adjacent separations do not establish a missing sample, an interval average, a measurement schedule or continuous coverage. The complete component-report.json and four component CSV tables retain every calculated detail and source citation.</p>';
  for(const s of report.streams){
    const n=s.numericSummary;
    html+='<h3>'+esc(s.name)+' · original position '+s.index+'</h3>'+
      table(['Original unit','Original declaration','Interpretation','Metadata binding'],[[s.unit,s.declaredType,s.interpretation,s.bindingId]])+
      table(['Occurrences','Exact samples','Browser points','Exact total','Sample mean (half-even, 12 places)','Exact mean fraction','Minimum / maximum'],[[
        s.selectedOccurrences,s.exactNumericSamples,s.browserNumericSamples,n.sumExact,n.mean?.decimal,
        n.mean?n.mean.exactNumerator+' / '+n.mean.exactDenominator:null,n.minimum&&n.maximum?n.minimum.lexeme+' / '+n.maximum.lexeme:null]])+
      table(['Distinct instants','Repeated instants','Adjacent separations','Continuous coverage / time-weighted mean'],[[s.distinctInstants,s.duplicateInstants.length,s.adjacentGaps.length,null]])+
      '<details><summary>Complete original component metadata and source reference</summary><pre>'+esc(JSON.stringify({component:s.component,sourceRef:s.sourceRef,interpretation:s.interpretation},null,2))+'</pre></details>'+
      '<h4>UTC-day sample arithmetic</h4>'+table(['UTC day','Occurrences','Exact samples','Exact total','Sample mean','Quality-field presence'],s.days.map(d=>[
        d.day,d.events,d.numericSummary.count,d.numericSummary.sumExact,d.numericSummary.mean?.decimal,d.qualityStates]))+
      '<h4>Repeated source instants</h4>'+table(['Original normalized instant','Retained occurrences'],s.duplicateInstants.slice(0,100).map(d=>[d.utc,d.occurrences.length]))+
      '<p>'+s.duplicateInstants.length+' repeated instants; this readable section shows at most 100. Complete occurrence IDs and source pointers are in component-duplicates.csv.</p>'+
      '<h4>Observed separations</h4>'+table(['From UTC','To UTC','Separation seconds'],s.adjacentGaps.slice(0,100).map(g=>[g.fromUtc,g.toUtc,g.seconds]))+
      '<p>'+s.adjacentGaps.length+' adjacent separations; this readable section shows the first 100. The complete sequence and endpoint citations are in component-gaps.csv.</p>';
    const figure=report.figures.find(f=>f.seriesKey===s.seriesKey);
    if(figure)html+='<p>'+s.figure.includedPoints+' of '+s.figure.eligiblePoints+' eligible original points appear in this separate-unit figure; all original rows remain in the complete data files.</p>'+figure.svg;
  }
  return html+'</section>';
}
