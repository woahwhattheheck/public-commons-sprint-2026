#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv,assessObservedContext} from './observed_context.mjs';
import {combineObservedFlow} from './observed_flow_inputs.mjs';
import {renderFlowReport} from './observed_flow_report.mjs';
import {buildFlowGeography} from './observed_flow_map.mjs';

if(process.argv.length>3)throw Error('Usage: node source_tools/build_observed_flow_report.mjs [APPLICATION_ROOT]');
const application=resolve(process.argv[2]||join(dirname(fileURLToPath(import.meta.url)),'..'));
const paths={annual:'observations/observed_hydrology_20261013/derived/calendar_year_flow.csv',daily:'observations/observed_hydrology_20261013/derived/daily_flow.csv',dates:'observations/eighteenmile_2023/wqp/study_flow_dates.csv'};
const input={},input_sources=[];
async function retained(path,role,bindings){const bytes=await readFile(join(application,path));bindings.push({role,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});return bytes.toString('utf8');}
for(const [role,path]of Object.entries(paths))input[role]=parseCsv(await retained(path,role,input_sources));
const assessment={...assessObservedContext(input),input_sources};
const inputs=JSON.parse(await readFile(join(application,'observations/observed_hydrology_20261013/inputs.json'),'utf8'));
const expansion='source/hydrology-huc05-07-20261013/',sourceBindings=[];
const extensionAnnual=parseCsv(await retained(expansion+'derived/calendar_year_flow.csv','expanded_annual',sourceBindings));
const extensionReferences=parseCsv(await retained(expansion+'derived/2023_reference_flow_context.csv','expanded_reference',sourceBindings));
const extensionDaily=parseCsv(await retained(expansion+'derived/daily-discharge.csv','expanded_daily',sourceBindings));
const extensionCapture=JSON.parse(await retained(expansion+'source-manifest.json','expanded_source_manifest',sourceBindings));
const combined=combineObservedFlow({...input,assessment,inputs,extensionAnnual,extensionDaily,extensionReferences,extensionCapture,sourceBindings});
const dmrRoot=join(application,'observations/eighteenmile_2023/npdes/flow_context');
const dmrSummary=JSON.parse(await readFile(join(dmrRoot,'derived/summary.json'),'utf8'));
const monthly=parseCsv(await readFile(join(dmrRoot,'derived/upstream_monthly.csv'),'utf8'));
const dmr={annual:dmrSummary.annual,aggregate:monthly};
const geographySources=[],geographyInput={},geographyPaths={
 collection:expansion+'nldi/derived/upstream-whole-catchments.geojson',
 bindings:expansion+'nldi/derived/station-basin-bindings.json',
 applicability:expansion+'nldi/derived/gauge-catchment-applicability.json',
 eighteenmilePoint:'observations/observed_hydrology_20261013/original/eighteenmile_nldi_reference.json',
 eighteenmileBasin:'observations/observed_hydrology_20261013/original/eighteenmile_nldi_whole_basin.geojson'
};
for(const [role,path]of Object.entries(geographyPaths))geographyInput[role]=JSON.parse(await retained(path,role,geographySources));
const geography=buildFlowGeography({...geographyInput,sourceInputs:geographySources});
const seasonalRoot='observations/flow_seasonality_20261013/';
const seasonalManifest=JSON.parse(await readFile(join(application,'observed_flow_seasonality.sources.json'),'utf8'));
const seasonalMembers=seasonalManifest.entries.flatMap(entry=>[entry,...(entry.companions||[])]);
async function seasonalMember(name){
 const record=seasonalMembers.find(item=>item.path===seasonalRoot+name);
 if(!record)throw Error('Seasonal source member was not retained: '+name);
 const bytes=await readFile(join(application,record.path));
 if(bytes.length!==record.bytes||createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('Retained seasonal source identity differs: '+name);
 return JSON.parse(bytes.toString('utf8'));
}
const snapshot=await seasonalMember('original-flow-data.json'),seasonality=await seasonalMember('explorer-data.json');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const frozenDaily=Object.entries(snapshot.series).flatMap(([key,rows])=>rows.map(row=>[key,...row.slice(0,3),snapshot.source_ids[row[3]],...row.slice(4)]));
const currentDaily=combined.daily.map(row=>[row.site+'-'+row.date.slice(0,4),row.date,row.reported_mean_cfs,row.qualifiers,row.source_id,row.source_values_index===''?null:Number(row.source_values_index),row.source_record_index===''?null:Number(row.source_record_index),row.source_line?Number(row.source_line):null]);
const sortDaily=rows=>rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
const sortAnnual=rows=>[...rows].sort((a,b)=>a.site.localeCompare(b.site)||a.period_start.localeCompare(b.period_start));
if(!same(sortDaily(currentDaily),sortDaily(frozenDaily))||!same(sortAnnual(combined.annual),sortAnnual(snapshot.annual)))
 throw Error('The current daily or annual hydrology differs from the selected seasonal source edition; rebuild one corresponding original edition before joining them');
if(seasonality.schema!=='upstate.observed-flow-seasonality-explorer/v1')throw Error('Original seasonal comparison source has another schema');
const text=renderFlowReport({...combined,dmr,geography,seasonality});
const columns=Object.keys(combined.quality[0]),quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
const csv=[columns,...combined.quality.map(row=>columns.map(k=>row[k]))].map(row=>row.map(quote).join(',')).join('\n')+'\n';
const outputRoot=join(application,'observations/calibration_context_20261013'),outputs=[];
await mkdir(outputRoot,{recursive:true});
for(const [name,body]of [['observed-flow-report.html',text],['combined-flow-context.json',JSON.stringify(combined.summary,null,2)+'\n'],['combined-flow-quality.csv',csv]]){
 const output=join(outputRoot,name),temporary=join(outputRoot,'.flow-report.'+randomUUID()+'.tmp');
 await writeFile(temporary,body,{encoding:'utf8',flag:'wx'});await rename(temporary,output);
 outputs.push({path:output,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')});
}
process.stdout.write(JSON.stringify({outputs,gauges:combined.summary.gauge_count,daily_records:combined.daily.length,numeric_daily_records:combined.summary.numeric_daily_records,study_dates:input.dates.length,geographic_basins:geography.basins.length,source_point_catchment_pairs:geography.point_catchment_pair_count})+'\n');
