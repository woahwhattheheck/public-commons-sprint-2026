// MIT. Read-only analysis and exact report reopening on the existing workspace.
import {readFile} from 'node:fs/promises';
import {analyseFlowableHistory,readFlowableHistoryAnalysis,createFlowableHistoryBundle,inspectFlowableHistoryBundle} from './history-analysis.mjs';
import {renderFlowableHistoryOutputs} from './history-report.mjs';
import {exportFlowableHistoryXes} from './history-xes.mjs';
function output(bundle){return renderFlowableHistoryOutputs(bundle.text);}
export async function serveFlowableHistoryAnalysis({workspace,method,input}){
 if(method==='xes')return exportFlowableHistoryXes({bundleText:input?.bundleText,collection:input?.collection});
 if(method==='analyse')return output(createFlowableHistoryBundle(await readFlowableHistoryAnalysis({workspace,input})));
 if(method==='reopen'){
  const b=inspectFlowableHistoryBundle(input?.bundleText);
  return output({text:input.bundleText,bytes:b.bytes,sha256:b.sha256});
 }
 if(method==='example'){
  const original=JSON.parse(await readFile(new URL('./examples/history/authored-reference.json',import.meta.url),'utf8'));
  const inventory=JSON.parse(original.inventoryText),report=analyseFlowableHistory({...original,inventory});
  return output(createFlowableHistoryBundle({...original,inventory,report}));
 }
 throw Object.assign(new Error('Select analyse, reopen, example or xes.'),{code:'FLOWABLE_HISTORY_METHOD_REQUIRED',status:400});
}
