/**
 * Load integration over an existing, immutable Measurements daily-flow study.
 * Persistence, source acquisition and station matching stay with flow_workspace.
 */
import observedLoads from '../../source_tools/observed_loads.cjs';
import {canonicalWQPLoadSample,WQP_LOAD_MAPPING,WQP_SOLIDS_LOAD_MAPPING} from './flow_wqp_loads.mjs';
import {buildFlowEdition,joinSampleDates} from './flow_editions.mjs';
import {hash,stable} from './normalise.mjs';
import {InputError} from './parse.mjs';

export const FLOW_LOADS_SCHEMA='upstate.flow-study-loads/v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const text=value=>value==null?'':String(value).trim();
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const fail=message=>{throw new InputError(message);};
const same=(a,b)=>stable(a)===stable(b);
const DAY=86400000;
function nextDate(value){
 const stamp=Date.parse(value+'T00:00:00Z');
 if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==value)
  fail('The selected flow edition has an invalid reporting date.');
 return new Date(stamp+DAY).toISOString().slice(0,10);
}
function verifyStudy(study){
 if(study?.schema!=='upstate.daily-flow-study/v1'||!/^[a-f0-9]{64}$/.test(study.id||''))
  fail('Select a complete saved daily-flow study.');
 if(!study.input||hash(stable(study.input))!==study.id)
  fail('The original flow-study selection changed.');
 if(!Array.isArray(study.input.sources)||!Array.isArray(study.input.samples)||
    !Array.isArray(study.input.relations)||!Array.isArray(study.input.sample_sources))
  fail('Retain the complete original flow and sampling source selection.');
 for(const source of [...study.input.sources,...study.input.sample_sources]){
  if(typeof source.text!=='string'||hash(source.text)!==source.sha256)
   fail('A retained original flow or sampling source checksum differs.');
 }
 const expected=buildFlowEdition({
  id:study.id,title:study.input.title,start:study.input.start,end:study.input.end,
  series_by_station:study.input.series_by_station,
  sources:study.input.sources.map(source=>({...source,edition_id:study.id,body:source.text}))
 });
 if(!same(study.edition,expected))
  fail('The selected flow rows or candidates differ from their retained original sources. Reopen the matching flow-study source generation.');
 const context=joinSampleDates(study.edition,study.input.samples,study.input.relations);
 if(!same(study.sample_context,context))
  fail('The selected sample-date joins differ from the original samples, flow edition or station relationships.');
 return study;
}
function originalSamples(study){
 const fields=['station_id','date','characteristic','sample_fraction','value','unit',
  'detection_condition','limit_value','limit_unit','result_status','qualifier',
  'method_id','method_context'];
 const ids=new Set();
 return study.sample_context.rows.map(row=>{
  const sample=row.sample;
  if(!sample||typeof sample!=='object'||Array.isArray(sample))
   fail('Retain the complete original concentration sample: '+row.sample_id);
  if(sample.sourceKind==='wqp'){
   if(!text(row.sample_id)||ids.has(row.sample_id))
    fail('Every selected concentration row needs a distinct original sample identity.');
   ids.add(row.sample_id);
   return canonicalWQPLoadSample(sample,row);
  }
  const absent=fields.filter(field=>!own(sample,field));
  if(absent.length)
   fail('Unsupported concentration source mapping for '+row.sample_id+
    ': retain explicit derived nutrient fields ('+absent.join(', ')+
    '). Canonical Measurements values cannot supply missing fraction, method, status or censoring metadata by inference.');
  if(!text(row.sample_id)||ids.has(row.sample_id))
   fail('Every selected concentration row needs a distinct original sample identity.');
  ids.add(row.sample_id);
  if(sample.station_id!==row.station_id||sample.date!==row.date)
   fail('The original concentration station or date differs from its selected join.');
  // The parent join owns the selected row identity (for example source-SHA:CSV-row).
  // Keep the entire raw object, including any earlier ID, alongside that identity.
  return {...clone(sample),sample_id:row.sample_id,
   flow_study_original_sample:clone(sample)};
 });
}
function supportSelection(study,contract){
 if(!Array.isArray(contract?.support))
  fail('Provide an explicit original station/catchment support contract.');
 const relations=new Map(study.input.relations.map(row=>[row.station_id,row]));
 const stations=new Set(study.sample_context.rows.map(row=>row.station_id));
 const seen=new Set();
 for(const support of contract.support){
  if(!support||!stations.has(support.station_id)||seen.has(support.station_id))
   fail('Select each sampled station support once, using this flow study.');
  seen.add(support.station_id);
  const relation=relations.get(support.station_id);
  if(!relation){
   if(support.accepted===true||support.location_match===true||support.catchment_match===true)
    fail('An unassigned station relationship cannot admit load integration.');
   if(text(support.gauge_id)||!['','unassigned'].includes(text(support.gauge_relation)))
    fail('The load contract assigns a gauge absent from the saved flow study.');
   continue;
  }
  if(support.gauge_id!==relation.gauge_id||support.gauge_relation!==relation.gauge_relation)
   fail('The load contract must retain the saved station, gauge and relationship: '+support.station_id);
  if(own(support,'flow_location_role')&&support.flow_location_role!==relation.flow_location_role)
   fail('The load contract flow role differs from the saved relationship.');
  const matched=relation.gauge_relation==='co_located'&&
   relation.flow_location_role==='matched_catchment_discharge';
  if((support.accepted===true||support.location_match===true||support.catchment_match===true)&&!matched)
   fail('Regional or downstream flow context cannot be upgraded to matched catchment discharge: '+support.station_id);
  if(own(relation,'catchment_id')&&text(relation.catchment_id)!==text(support.catchment_id))
   fail('The original selected catchment identity differs from the load contract.');
  if(support.accepted===true){
   const evidence=Array.isArray(support.evidence)?support.evidence.map(text):[];
   const original=text(relation.source);
   const members=original.split(';').map(text).filter(Boolean);
   if(!original||(!evidence.includes(original)&&!members.every(member=>evidence.includes(member))))
    fail('Retain the original saved station/gauge relationship evidence in the admitted load contract.');
   const rows=study.sample_context.rows.filter(row=>row.station_id===support.station_id);
   if(rows.some(row=>row.annual_mass_spatial_support!==true))
    fail('The original sample-date context does not admit matched spatial support.');
  }
 }
}
function selectedFlows(study){
 const flows=[],ids=new Set();
 for(const selected of study.edition.rows){
  // Keep all original candidates. The kernel excludes ambiguous days; choosing
  // the first candidate here would silently change the retained flow selection.
  for(const flow of selected.candidates){
   if(!text(flow.observation_id)||ids.has(flow.observation_id))
    fail('Selected flow source-row identities must be unique across the complete edition.');
   ids.add(flow.observation_id);
   flows.push(clone(flow));
  }
 }
 return flows;
}

/**
 * Return calculations and existing observations-ingest exports without saving
 * or changing the selected study. The contract uses an exclusive end date.
 */
export function runFlowStudyLoads(study,contract){
 verifyStudy(study);
 supportSelection(study,contract);
 if(!contract.period||contract.period.start<study.edition.start||
    contract.period.end>nextDate(study.edition.end))
  fail('The load period must lie within the explicitly selected daily-flow calendar; its end date is exclusive.');
 const samples=originalSamples(study),flows=selectedFlows(study);
 const input={contract:clone(contract),samples,flows};
 const joined_rows=observedLoads.retainJoinedRows(input,study.sample_context.rows);
 const integration=observedLoads.integrate(input);
 const observationExports=observedLoads.observationExports(integration);
 return {
  schema:FLOW_LOADS_SCHEMA,flow_study_id:study.id,flow_edition_id:study.edition.id,
  contract_sha256:hash(stable(contract)),integration,observationExports,joined_rows,
  selected_flow_rows:clone(study.edition.rows),
  source_binding:{
   flow_study_input_sha256:study.id,flow_sources:clone(study.edition.sources),
   sample_sources:study.input.sample_sources.map(({text:body,...source})=>clone(source)),
   station_relationships:clone(study.input.relations),
   sample_mapping:samples.every(s=>s.source_mapping===WQP_LOAD_MAPPING)?WQP_LOAD_MAPPING:
    samples.every(s=>s.source_mapping===WQP_SOLIDS_LOAD_MAPPING)?WQP_SOLIDS_LOAD_MAPPING:
    samples.some(s=>[WQP_LOAD_MAPPING,WQP_SOLIDS_LOAD_MAPPING].includes(s.source_mapping))?'explicit-mixed-source-mappings/v1':'original-derived-nutrient-results/v1',
   ...(samples.some(s=>[WQP_LOAD_MAPPING,WQP_SOLIDS_LOAD_MAPPING].includes(s.source_mapping))?{sample_mappings:[...new Set(samples.map(s=>s.source_mapping||'original-derived-nutrient-results/v1'))]}:{}),
   sample_identity:'Unchanged selected sample_context.rows[].sample_id',
   flow_selection:'Every original selected candidate; ambiguous days remain excluded from quantified loads',
   reporting_calendar:{start:study.edition.start,end:study.edition.end,end_inclusive:true},
   input_unchanged:true
  }
 };
}
