/** Complete independent file products for the original saved studies. */
import {deflatedZipMembers} from './collection_zip.mjs';
import {hash} from './normalise.mjs';
import {readFlowStudy,flowCSV} from './flow_workspace.mjs';
import {readFlowLoadResult,flowLoadCSV} from './flow_results.mjs';
import {renderFlowStudy,renderFlowLoads} from './flow_reports.mjs';
const json=x=>JSON.stringify(x,null,2)+'\n';
function packageFiles(name,files){
 const members=Object.entries(files).map(([name,data])=>({name,data}));
 const manifest={schema:'upstate.complete-flow-product/v1',files:members.map(m=>({path:m.name,bytes:Buffer.byteLength(m.data),sha256:hash(m.data)}))};
 members.push({name:'manifest.json',data:Buffer.from(json(manifest))});
 const bytes=deflatedZipMembers(members);
 return {name,type:'application/zip',bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')};
}
export function flowStudyFiles(study){
 return {'report.html':renderFlowStudy(study),'flow-study.json':json(study),'flow-input.json':json(study.input),
 'daily-flow.csv':flowCSV(study,'daily'),'flow-periods.csv':flowCSV(study,'periods'),'sample-flow.csv':flowCSV(study,'samples'),
 'README.txt':'TJLabs · Upper Savannah · Original discharge study\n\nOpen report.html in a browser. Keep all files together. All original source responses, selected series, editable inputs, sampling records and spatial relationships are contained in flow-study.json. Receive that complete JSON through Measurements → Daily flow to reopen this edition. For source-native reconstruction, use: node source_tools/flow_editions.mjs build --input flow-input.json --output a-new-directory\n\nDaily means use original agency reporting dates. Full-calendar support and selected-window coverage are separate. Preserve all original provisional/estimated labels.\n'};
}
export function flowStudyBundle(workspace,id){
 return workspace.readConsistent(()=>packageFiles('daily-flow-'+id.slice(0,16)+'.zip',flowStudyFiles(readFlowStudy(workspace,id))));
}
export function flowLoadFiles(result,parent){
 if(parent.id!==result.flow_study_id)throw Error('Saved calculation parent differs');
 return {'report.html':renderFlowLoads(result),'flow-loads.json':json(result),'observed-loads.json':json(result.integration),
 'flow-study.json':json(parent),'flow-input.json':json(parent.input),'contract.json':json(result.integration.contract),
 'daily-loads.csv':flowLoadCSV(result,'daily'),'period-loads.csv':flowLoadCSV(result,'periods'),
 'concentration-context.csv':flowLoadCSV(result,'context'),'annual-loads.csv':flowLoadCSV(result,'annual'),
 'load-selection.json':json({study_id:parent.id,contract:result.integration.contract,expected_id:result.id}),
 'README.txt':'TJLabs · Upper Savannah · Concentration and discharge\n\nOpen report.html in a browser and keep these sibling files together. flow-loads.json contains the complete saved calculation, observed-loads.json the full scientific calculation, flow-study.json every original source and source-bound sampling relation, and contract.json the editable scientific method. Receive flow-study.json through Measurements → Daily flow. Open contract.json in its Concentration and discharge controls, then preview and save. The load-selection.json can also be used with: node measurement_workspace/engine/cli.mjs flow-load-save --workspace YOUR_EXISTING_MEASUREMENTS --file load-selection.json\n\nReopening the unchanged scientific engine reproduces the saved identity. A newer method edition is a new calculation. Its earlier full calculation remains here. The original regional-context sample series retains its own source support; catchment mass requires the explicitly justified matching support recorded by the scientist. CSV physical units, interval endpoints and censoring bounds remain explicit.\n'};
}
export function flowLoadBundle(workspace,id){
 return workspace.readConsistent(()=>{const result=readFlowLoadResult(workspace,id);return packageFiles('concentration-discharge-'+id.slice(0,16)+'.zip',flowLoadFiles(result,readFlowStudy(workspace,result.flow_study_id)));});
}
