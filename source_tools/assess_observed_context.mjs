#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv,assessObservedContext,contextCsv,renderContextMarkdown} from './observed_context.mjs';

const application=resolve(process.argv[2]||join(dirname(fileURLToPath(import.meta.url)),'..'));
const output=resolve(process.argv[3]||join(application,'observations/calibration_context_20261013'));
const paths={
  annual:'observations/observed_hydrology_20261013/derived/calendar_year_flow.csv',
  daily:'observations/observed_hydrology_20261013/derived/daily_flow.csv',
  dates:'observations/eighteenmile_2023/wqp/study_flow_dates.csv',
};
const input={},sources=[];
for(const [role,path]of Object.entries(paths)){
  const bytes=await readFile(join(application,path));
  sources.push({role,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  input[role]=parseCsv(bytes.toString('utf8'));
}
const result={...assessObservedContext(input),input_sources:sources};
const files={
  'assessment.json':JSON.stringify(result,null,2)+'\n',
  'station_year_context.csv':contextCsv(result.station_context),
  'README.md':renderContextMarkdown(result),
};
await mkdir(output,{recursive:true});
for(const [name,text]of Object.entries(files)){
  const destination=join(output,name),temporary=join(output,'.'+name+'.'+randomUUID()+'.tmp');
  await writeFile(temporary,text,{encoding:'utf8',flag:'wx'});
  await rename(temporary,destination);
}
process.stdout.write(JSON.stringify({output,files:Object.keys(files),gauges:result.station_context.length,study_dates:result.sampling_context.sampled_unique_dates})+'\n');
