import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseCsv} from '../flow-analysis/analyze-stream-flow.mjs';

const PREFIX='21SC60WQ_WQX-';
function json(value,label){try{return JSON.parse(value)}catch{throw Error('Invalid JSON: '+label)}}
function n(value){if(value===''||value==null)return null;const result=Number(value);if(!Number.isFinite(result))throw Error('Nonfinite source number');return result}
function bool(value){if(value==='true'||value===true)return true;if(value==='false'||value===false)return false;throw Error('Invalid source boolean')}
function csv(rows,fields=Object.keys(rows[0]||{})){
 const cell=v=>{let s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(typeof v==='string'&&/^\s*[=+@-]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
 return fields.map(cell).join(',')+'\n'+rows.map(r=>fields.map(f=>cell(r[f])).join(',')).join('\n')+(rows.length?'\n':'');
}
export function deriveMonitoringContext(input){
 const rows=parseCsv(input.stations),activities=parseCsv(input.activities),flows=parseCsv(input.flow).filter(r=>r.site==='02186702');
 if(rows.length!==4||activities.length!==153||flows.length!==2192)throw Error('Original source edition counts changed');
 const stations=rows.map(r=>({...r,network_station_source:'source/eighteenmile-stream-nutrients-20261013/'+r.network_station_source,longitude:n(r.longitude),latitude:n(r.latitude),station_network_measure:n(r.station_network_measure),activities:n(r.activities),records:n(r.records)}));
 const gauge={station_id:'USGS-02186702',station_name:'USGS 02186702',station_network_comid:rows[0].gauge_network_comid,station_network_reachcode:rows[0].gauge_network_reachcode,station_network_measure:n(rows[0].gauge_network_measure),network_station_source:'source/eighteenmile-stream-nutrients-20261013/original/eighteenmile-gauge-network-location.json',is_gauge:true};
 const nodes=[...stations,gauge],byId=new Map(nodes.map(s=>[s.station_id,s])),nav=new Map();
 for(const [anchor,raw] of Object.entries(input.navigation)){
  if(!byId.has(anchor))throw Error('Navigation anchor absent from original source');
  const fc=json(raw,anchor);if(fc.type!=='FeatureCollection'||!Array.isArray(fc.features))throw Error('Incomplete original navigation response');
  const features=new Map();for(const f of fc.features){const id=f.properties?.identifier;if(!id||features.has(id))throw Error('Ambiguous original indexed station');features.set(id,f)}
  nav.set(anchor,features);
 }
 const direct=[];
 for(const a of nodes)for(const b of nodes){
  if(a.station_id===b.station_id)continue;
  if(a.station_network_comid===b.station_network_comid&&a.station_network_reachcode===b.station_network_reachcode){
   if(a.station_network_measure>b.station_network_measure)direct.push({upstream:a.station_id,downstream:b.station_id,method:'same_reach_original_linear_measure',sources:[a.network_station_source,b.network_station_source],upstream_measure:a.station_network_measure,downstream_measure:b.station_network_measure});
  }else{
   const original=nav.get(b.station_id)?.get(a.station_id);
   if(original&&String(original.properties.comid)===a.station_network_comid)direct.push({upstream:a.station_id,downstream:b.station_id,method:'original_upstream_index_matching_hydrolocation',sources:[input.navigation_paths[b.station_id],a.network_station_source,b.network_station_source]});
  }
 }
 function path(a,b){
  const queue=[{id:a,edges:[]}],seen=new Set([a]);while(queue.length){const here=queue.shift();for(const e of direct.filter(e=>e.upstream===here.id)){if(e.downstream===b)return [...here.edges,e];if(!seen.has(e.downstream)){seen.add(e.downstream);queue.push({id:e.downstream,edges:[...here.edges,e]})}}}return null;
 }
 const relations=[];for(const a of nodes)for(const b of nodes){if(a.station_id===b.station_id)continue;const up=path(a.station_id,b.station_id),down=path(b.station_id,a.station_id);if(up&&down)throw Error('Original relations imply a cycle');
  const edges=up||down;relations.push({station_a:a.station_id,station_b:b.station_id,relation:up?'indexed_upstream':down?'indexed_downstream':'not_resolved',relation_basis:edges?.length===1?edges[0].method:edges?'transitive_original_network_relations':'no_positive_original_path',path:edges?.map(e=>e.upstream).concat(edges.at(-1).downstream)||[],source_paths:[...new Set((edges||[]).flatMap(e=>e.sources))],scope:'Indexed NHDPlus reach context; original station points and catchment support remain separate.'});
 }
 const relation=(a,b)=>relations.find(r=>r.station_a===a&&r.station_b===b);
 const contrasts=parseCsv(input.contrasts).map(r=>{
  const a=PREFIX+r.station_a,b=PREFIX+r.station_b,rel=relation(a,b);if(!rel)throw Error('Original paired station lacks topology');
  const upstream=rel.relation==='indexed_upstream'?a:rel.relation==='indexed_downstream'?b:null,sign=upstream===a?1:-1;
  const lo=n(r.difference_b_minus_a_lower),hi=n(r.difference_b_minus_a_upper);
  const lower=upstream?(sign===1?lo:-hi):null,upper=upstream?(sign===1?hi:-lo):null;
  const lowerOpen=upstream?(sign===1?bool(r.difference_lower_open):bool(r.difference_upper_open)):null,upperOpen=upstream?(sign===1?bool(r.difference_upper_open):bool(r.difference_lower_open)):null;
  const direction=lower===null?'unresolved':lower>0||(lower===0&&lowerOpen)?'downstream_higher':upper<0||(upper===0&&upperOpen)?'downstream_lower':lower===0&&upper===0?'equal':'unresolved_by_censor_intervals';
  return {...r,contrast_unit:'mg/L',downstream_direction:direction,station_a_id:a,station_b_id:b,network_relation_a_to_b:rel.relation,upstream_station_id:upstream,downstream_station_id:upstream?(upstream===a?b:a):null,downstream_minus_upstream_lower:upstream?(sign===1?lo:-hi):null,downstream_minus_upstream_upper:upstream?(sign===1?hi:-lo):null,downstream_difference_lower_open:upstream?(sign===1?bool(r.difference_lower_open):bool(r.difference_upper_open)):null,downstream_difference_upper_open:upstream?(sign===1?bool(r.difference_upper_open):bool(r.difference_lower_open)):null,network_source_paths:rel.source_paths,interpretation:'Same-date source concentration contrast with original sample clocks; transport travel time, intervening sources and mixing are unresolved.'};
 });
 const activityRows=activities.map(r=>({...r,characteristics:json(r.characteristics,'characteristics'),source_references:json(r.source_references,'source references'),result_rows:n(r.result_rows),censored_results:n(r.censored_results)}));
 const thresholds=parseCsv(input.thresholds);const q=new Map(thresholds.map(r=>[r.year,r]));
 const flowRows=flows.map(r=>{const mean=n(r.reported_mean_cfs),threshold=q.get(r.date.slice(0,4));if(mean==null||!threshold)throw Error('Missing complete source flow/threshold');return{date:r.date,mean_cfs:mean,qualifiers:r.qualifiers,method_id:r.method_id,source_id:r.source_id,source_values_index:r.source_values_index,source_record_index:r.source_record_index,p95_cfs:n(threshold.p95_cfs),at_or_above_annual_p95:mean>=n(threshold.p95_cfs)}});
 if(new Set(flowRows.map(r=>r.date)).size!==2192)throw Error('Duplicate original flow date');
 const episodes=parseCsv(input.episodes).map(r=>({...r,days:n(r.days),peak_cfs:n(r.peak_cfs),sampled_dates:n(r.sampled_dates),station_activities:n(r.station_activities),sampled_stations:json(r.sampled_stations,'sampled stations'),missing_stations:json(r.missing_stations,'missing stations'),daily_source_references:json(r.daily_source_references,'daily source references')}));
 const scope=['Daily mean discharge belongs to USGS 02186702 and supplies regional date context.','Original nutrient station IDs and activity IDs remain distinct; simultaneous calendar date does not establish the same water parcel.','Historical flow and sampling coverage are descriptive of 2020–2025; future saved calendar dates have no received historical observation.','Original below-quantification bounds and paired concentration intervals remain unreplaced.','NLDI navigation indexes whole catchments; same-reach direction uses original ReachCode measures, zero downstream and 100 upstream.','No monitoring objective, cost, campaign binding or selected plan is changed by this context.'];
 const result={schema:'upstate.monitoring-observed-source/v1',title:'Eighteenmile stream monitoring: original network and temporal support',source_edition:'eighteenmile-2020-2025-network-flow-v1',source_period:{start_inclusive:'2020-01-01',end_inclusive:'2025-12-31'},gauge,stations,relations,activities:activityRows,daily_flow:flowRows,annual_coverage:parseCsv(input.annual),station_year_coverage:parseCsv(input.station_year),monthly_coverage:parseCsv(input.monthly),high_flow_episodes:episodes,paired_contrasts:contrasts,source_inputs:input.source_inputs,interpretation:scope};
 const summary={schema:'upstate.monitoring-observed-source-summary/v1',stations:stations.length,activities:activities.length,flow_days:flowRows.length,relations:relations.length,paired_contrasts:contrasts.length,episodes:episodes.length,unsampled_episodes:episodes.filter(r=>r.sampled_dates===0).length,station_order:['21SC60WQ_WQX-SV-375','21SC60WQ_WQX-SV-245','21SC60WQ_WQX-SV-376','USGS-02186702','21SC60WQ_WQX-SV-233'],interpretation:scope};
 const points={type:'FeatureCollection',features:stations.map(s=>({type:'Feature',id:s.station_id,geometry:{type:'Point',coordinates:[s.longitude,s.latitude]},properties:{station_id:s.station_id,station_name:s.station_name,network_comid:s.station_network_comid,reachcode:s.station_network_reachcode,measure:s.station_network_measure,gauge_network_relation:s.gauge_network_relation,source:s.network_station_source}}))};
 return{source:result,summary,files:{'monitoring-context.json':JSON.stringify(result,null,2)+'\n','station-topology.csv':csv(relations),'paired-contrasts-network.csv':csv(contrasts),'original-station-points.geojson':JSON.stringify(points,null,2)+'\n','context-summary.json':JSON.stringify(summary,null,2)+'\n'}};
}
async function main(){
 const here=dirname(fileURLToPath(import.meta.url)),root=resolve(process.argv[2]||join(here,'../../..')),out=resolve(process.argv[3]||here);
 const manifest=JSON.parse(readFileSync(join(here,'input-manifest.json'),'utf8')),values={navigation:{},navigation_paths:{},source_inputs:manifest.inputs};
 for(const item of manifest.inputs){const raw=readFileSync(join(root,item.path));if(raw.length!==item.bytes||createHash('sha256').update(raw).digest('hex')!==item.sha256)throw Error('Original source hash differs: '+item.path);if(item.navigation_anchor){values.navigation[item.navigation_anchor]=raw.toString('utf8');values.navigation_paths[item.navigation_anchor]=item.path}else values[item.key]=raw.toString('utf8')}
 const result=deriveMonitoringContext(values);mkdirSync(out,{recursive:true});for(const[name,body]of Object.entries(result.files))writeFileSync(join(out,name),body,'utf8');console.log(JSON.stringify(result.summary,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
