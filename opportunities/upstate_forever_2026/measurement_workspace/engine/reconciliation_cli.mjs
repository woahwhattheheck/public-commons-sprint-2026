/** Command-line entry for the original Measurements source-review workflow. */
import {reconciliationOperation,reconciliationReport,reconciliationCSV} from './source_reconciliation.mjs';
import {sourceReviewHTML} from '../web/source_reconciliation.mjs';
import {InputError} from './parse.mjs';

export async function runReconciliationCLI(command,options,workspace,{readText,output}){
  let input={};
  if(options.file){
    try{input=JSON.parse(await readText(options.file));}
    catch(error){if(error instanceof SyntaxError)throw new InputError('Source-review input must be a JSON object');throw error;}
    if(input===null||typeof input!=='object'||Array.isArray(input))throw new InputError('Source-review input must be a JSON object');
  }
  if(command==='catalogue')return output(reconciliationOperation(workspace,'GET',[]));
  if(command==='groups'){
    const query={...input};
    if(Object.hasOwn(query,'source_ids'))query.source_ids=JSON.stringify(query.source_ids);
    return output(reconciliationOperation(workspace,'GET',['groups'],query));
  }
  if(command==='group'){
    if(typeof options.id!=='string'||!options.id)throw new InputError('Choose the exact original-result group with --id');
    return output(reconciliationOperation(workspace,'GET',['groups',options.id]));
  }
  if(command==='decide')return output(reconciliationOperation(workspace,'POST',['decide'],{},input));
  if(command==='reports')return output(reconciliationOperation(workspace,'GET',['reports']));
  if(command==='save-report')return output(reconciliationOperation(workspace,'POST',['reports'],{},input));
  if(command==='report'){
    const report=reconciliationReport(workspace,options.id),format=options.format||'json';
    if(format==='json')return output(report);
    if(format==='csv')return output(reconciliationCSV(report));
    if(format==='html')return output(sourceReviewHTML(report));
    throw new InputError('Choose json, csv or html for the saved source-review report');
  }
  throw new InputError('Unknown source-review command');
}
