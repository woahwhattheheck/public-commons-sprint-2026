#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv,assessObservedContext} from './observed_context.mjs';
import {renderFlowReport} from './observed_flow_report.mjs';

if(process.argv.length>3)throw Error('Usage: node source_tools/build_observed_flow_report.mjs [APPLICATION_ROOT]');
const application=resolve(process.argv[2]||join(dirname(fileURLToPath(import.meta.url)),'..'));
const paths={annual:'observations/observed_hydrology_20261013/derived/calendar_year_flow.csv',daily:'observations/observed_hydrology_20261013/derived/daily_flow.csv',dates:'observations/eighteenmile_2023/wqp/study_flow_dates.csv'};
const input={},input_sources=[];
for(const [role,path]of Object.entries(paths)){
 const bytes=await readFile(join(application,path));
 input_sources.push({role,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 input[role]=parseCsv(bytes.toString('utf8'));
}
const assessment={...assessObservedContext(input),input_sources};
const inputs=JSON.parse(await readFile(join(application,'observations/observed_hydrology_20261013/inputs.json'),'utf8'));
const dmrRoot=join(application,'observations/eighteenmile_2023/npdes/flow_context');
const dmrSummary=JSON.parse(await readFile(join(dmrRoot,'derived/summary.json'),'utf8'));
const monthly=parseCsv(await readFile(join(dmrRoot,'derived/upstream_monthly.csv'),'utf8'));
const dmr={annual:dmrSummary.annual,aggregate:monthly};
const text=renderFlowReport({annual:input.annual,daily:input.daily,samples:input.dates,assessment,inputs,dmr});
const output=join(application,'observations/calibration_context_20261013/observed-flow-report.html');
await mkdir(dirname(output),{recursive:true});
const temporary=join(dirname(output),'.flow-report.'+randomUUID()+'.tmp');
await writeFile(temporary,text,{encoding:'utf8',flag:'wx'});
await rename(temporary,output);
process.stdout.write(JSON.stringify({output,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),gauges:assessment.station_context.length,daily_records:input.daily.length,study_dates:input.dates.length})+'\n');
