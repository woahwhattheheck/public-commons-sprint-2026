#!/usr/bin/env node
// MIT. Reproduce the retained reference with the original reporter.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(here,'../reference');
if(process.argv.length!==4||process.argv[2]!=='--out')throw Error('Use --out NEW_DIRECTORY.');
const out=path.resolve(process.argv[3]),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const raw=fs.readFileSync(path.join(source,'historical-response.json')),core=fs.readFileSync(path.join(source,'report-core.mjs'));
if(digest(raw)!=='2d2b011d5b4d6c34a7ca88f0a640ef3cac90975fac49a01c4b2372da32227778'||digest(core)!=='ca6b3de5ca4875c126ebd5d333208e07199dd2237bbf04bb0eade79dbe65a16a')throw Error('Original report source identity changed.');
const {buildFacilityReport,renderFacilityCsv,renderFacilityHtml}=await import(pathToFileURL(path.join(source,'report-core.mjs')).href);
const results={},identity=[];
const expected={"baseline":"c292d7de3a5450cb31fd34dcc9044a51618068f091136bf277d593a3226a7189","napa-radius-5km":"b4d07b6552d642c93585fbbd4ca956bd78c7c21e34f2a1cac1120b08f31b72d4","napa-radius-50km":"aab0c2e4d577d66f484390585ec754b61760932399e9aa3273db35c019621a9f"};
for(const name of ['baseline','napa-radius-5km','napa-radius-50km']){
 const input=JSON.parse(fs.readFileSync(path.join(source,name+'-facilities.json'),'utf8'));
 const report=buildFacilityReport([{name:'Original USGS South Napa response',sha256:digest(raw),document:JSON.parse(raw)}],input,{generatedAt:'2026-10-12T07:25:54.000Z'});
 const json=JSON.stringify(report,null,2)+'\n';
 if(digest(Buffer.from(json))!==expected[name])throw Error('The selected original reference result changed: '+name);
 results[name+'.json']=json;results[name+'.csv']=renderFacilityCsv(report);results[name+'.html']=renderFacilityHtml(report);results[name+'-facilities.json']=JSON.stringify(input,null,2)+'\n';
 identity.push({name,matches:report.counts.facilityEventMatches,sha256:expected[name]});
}
results['historical-response.json']=raw;results['report-core.mjs']=core;results['LICENSE.txt']=fs.readFileSync(path.join(source,'LICENSE.txt'));
results['REPRODUCTION.json']=JSON.stringify({schema:'tjlabs.facility-reference-reproduction.v1',createdAt:new Date().toISOString(),runtime:process.version,sourceSha256:digest(raw),coreSha256:digest(core),results:identity},null,2)+'\n';
fs.mkdirSync(out,{mode:0o700});for(const[name,bytes]of Object.entries(results))fs.writeFileSync(path.join(out,name),bytes,{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify({directory:out,files:Object.keys(results).length,results:identity},null,2)+'\n');
