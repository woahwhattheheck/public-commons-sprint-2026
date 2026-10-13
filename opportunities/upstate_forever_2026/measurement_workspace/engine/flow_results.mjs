/** Save and reopen observed-load calculations in the original Measurements export store. */
import {runFlowStudyLoads} from './flow_loads.mjs';
import {readFlowStudy} from './flow_workspace.mjs';
import {hash,stable} from './normalise.mjs';
import {InputError,csv} from './parse.mjs';
const KIND='flow-study-loads';
export function previewFlowLoadResult(workspace,input){
 const study=readFlowStudy(workspace,input.study_id),result=runFlowStudyLoads(study,input.contract);
 return {...result,id:hash(stable(result)),title:study.input.title};
}
export function saveFlowLoadResult(workspace,input){
 const result=previewFlowLoadResult(workspace,input);
 if(input.expected_id&&input.expected_id!==result.id)throw new InputError('The selected source or integration method changed. Inspect the current result.',409);
 const old=workspace.db.prepare('SELECT kind,content FROM exports WHERE id=?').get(result.id);
 if(old){if(old.kind!==KIND||stable(JSON.parse(old.content))!==stable(result))throw new InputError('Saved load calculation identity differs',409);return{id:result.id,duplicate:true,result};}
 workspace.atomic(()=>{
  workspace.db.prepare('INSERT INTO exports(id,created_at,revision,kind,content) VALUES(?,?,?,?,?)').run(result.id,new Date().toISOString(),workspace.revision(),KIND,JSON.stringify(result));
  workspace.event('flow-study-loads',result.id,{flow_study_id:result.flow_study_id,method_edition:result.integration.schema,contract_sha256:result.contract_sha256,counts:result.integration.counts});
 });
 return {id:result.id,duplicate:false,result};
}
export function readFlowLoadResult(workspace,id){
 const row=workspace.db.prepare('SELECT content FROM exports WHERE id=? AND kind=?').get(id,KIND);
 if(!row)throw new InputError('Saved concentration/discharge result not found',404);
 const result=JSON.parse(row.content),{id:identity,title,...calculation}=result;
 if(identity!==id||hash(stable(calculation))!==id)throw new InputError('Saved concentration/discharge result differs from its identity',409);
 return result;
}
export function flowLoadCatalogue(workspace){
 return {rows:workspace.db.prepare("SELECT id,created_at,json_extract(content,'$.flow_study_id') AS flow_study_id,json_extract(content,'$.title') AS title,json_extract(content,'$.integration.counts') AS counts,json_extract(content,'$.integration.schema') AS method_edition FROM exports WHERE kind=? ORDER BY created_at DESC,id").all(KIND).map(r=>({...r,counts:JSON.parse(r.counts)}))};
}
export function flowLoadCSV(value,kind){
 if(kind==='context')return value.observationExports.context_csv;
 if(kind==='annual')return value.observationExports.annual_csv;
 if(kind==='daily')return csv(value.integration.series.flatMap(s=>s.daily.map(d=>({...d,characteristic:s.characteristic,sample_fraction:s.sample_fraction,method_context:s.method_context,method_id:s.method_id}))),['station_id','gauge_id','characteristic','sample_fraction','method_context','method_id','date','concentration_basis','concentration_mg_l','concentration_lower_mg_l','concentration_upper_mg_l','discharge_m3_s','load_kg','load_lower_kg','load_upper_kg','censored','sample_ids','flow_ids','issues']);
 if(kind==='periods')return csv(value.integration.series.flatMap(s=>[...s.periods.map(p=>({...p,period_kind:'selected_or_season'})),...s.annual.map(p=>({...p,period_kind:'calendar_year'}))].map(p=>({...p,station_id:s.station_id,gauge_id:s.support.gauge_id,characteristic:s.characteristic,sample_fraction:s.sample_fraction,method_context:s.method_context,method_id:s.method_id}))),['station_id','gauge_id','characteristic','sample_fraction','method_context','method_id','period_kind','label','period_start','period_end','period_end_exclusive','expected_days','quantified_days','coverage_complete','whole_calendar_year','load_kg','load_lower_kg','load_upper_kg','quantified_flow_volume_m3','flow_weighted_concentration_mg_l','flow_weighted_concentration_lower_mg_l','flow_weighted_concentration_upper_mg_l','censored_days','sampled_days','interpolated_days','annualized','quantity_basis','missing_reasons']);
 throw new InputError('Choose daily, periods, context or annual CSV');
}
export async function flowLoadOperation(workspace,method,parts,input={}){
 if(method==='GET'&&parts.length===1&&parts[0]==='load-catalogue')return flowLoadCatalogue(workspace);
 if(method==='GET'&&parts.length===2&&parts[0]==='load-results')return readFlowLoadResult(workspace,parts[1]);
 if(method==='POST'&&parts.length===1){
  if(parts[0]==='load-preview')return previewFlowLoadResult(workspace,input);
  if(parts[0]==='load-save')return saveFlowLoadResult(workspace,input);
 }
 throw new InputError('Concentration/discharge operation not found',404);
}
