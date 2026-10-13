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
const text=renderFlowReport({...combined,dmr,geography});
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
