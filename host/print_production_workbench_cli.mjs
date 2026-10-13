#!/usr/bin/env node
// MIT. Print-production project operations and complete editable delivery.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import E from './print_production_workbench.cjs';
import H from './connected_sha256.cjs';
import {buildPrintProductionBundle} from './print_production_workbench_bundle.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const need=(a,k)=>{if(!a[k])throw new Error('Supply --'+k);return a[k];};
function options(argv){const a={command:argv[0]||'help'};for(let i=1;i<argv.length;i++){if(!argv[i].startsWith('--')||argv[i+1]===undefined||argv[i+1].startsWith('--'))throw new Error('Use named options followed by values.');const k=argv[i].slice(2);if(k in a)throw new Error('Repeated option '+k);a[k]=argv[++i];}return a;}
export async function runPrintProductionCLI(argv=process.argv.slice(2)){
 const a=options(argv);
 if(a.command==='help')return {commands:['inspect --record RECORD.json','estimate --record RECORD.json --selection SELECTION.json','readiness --record RECORD.json --job JOB_ID','verify --record RECORD.json','apply --record RECORD.json --change EXACT_ACTION.json --out NEW_RECORD.json','build --record RECORD.json --out NEW_DIRECTORY']};
 const record=E.validateRecord(await read(need(a,'record')));
 for(const quote of record.quotes)E.verifyQuote(quote,H.sha256Utf8);
 if(a.command==='inspect')return {id:record.id,business:record.business,revision:record.revision,price_editions:record.price_editions.length,rates:record.rates.length,customers:record.customers.length,quotes:record.quotes.length,jobs:record.jobs.length,production_events:record.production_events.length,history:record.history.length};
 if(a.command==='estimate')return E.estimate(record,await read(need(a,'selection')));
 if(a.command==='readiness')return E.readiness(record,need(a,'job'));
 if(a.command==='verify')return {quotes:record.quotes.map(q=>({id:q.id,valid:E.verifyQuote(q,H.sha256Utf8)}))};
 if(a.command==='build')return buildPrintProductionBundle(record,{out:need(a,'out')});
 if(a.command==='apply'){const result=E.apply(record,await read(need(a,'change')),H.sha256Utf8),out=resolve(need(a,'out'));await writeFile(out,JSON.stringify(result.record,null,2)+'\n',{encoding:'utf8',flag:'wx'});return {path:out,changed:result.changed,revision:result.record.revision};}
 throw new Error('Unknown command. Use help.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runPrintProductionCLI().then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
