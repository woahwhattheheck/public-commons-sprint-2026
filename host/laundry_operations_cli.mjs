#!/usr/bin/env node
// MIT. Complete laundry source preparation, operating record and portable receiving.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import E from './laundry_operations.cjs';
import {buildLaundryOperationsBundle} from './laundry_operations_bundle.mjs';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
function options(argv){const out={command:argv[0]||'help'};for(let i=1;i<argv.length;i++){if(!argv[i].startsWith('--')||argv[i+1]===undefined)throw Error('Use named options and values.');const key=argv[i].slice(2);if(key in out)throw Error('Repeated option '+key);out[key]=argv[++i]}return out}
const required=(a,k)=>{if(!a[k])throw Error('Supply --'+k);return a[k]};
async function save(path,record){await writeFile(resolve(path),JSON.stringify(record,null,2)+'\n',{encoding:'utf8',flag:'wx'})}
export async function runLaundryOperationsCLI(argv=process.argv.slice(2)){
 const a=options(argv);let result;
 if(a.command==='create'){const r=E.create(await read(required(a,'source')));await save(required(a,'out'),r);result=E.summary(r)}
 else if(a.command==='inspect'){const r=E.validate(await read(required(a,'record')));result=E.summary(r)}
 else if(a.command==='apply'){const r=E.apply(await read(required(a,'record')),await read(required(a,'operation')));await save(required(a,'out'),r);result=E.summary(r)}
 else if(a.command==='quote'){result=E.quote(await read(required(a,'record')),await read(required(a,'input')))}
 else if(a.command==='order'){result=E.orderView(await read(required(a,'record')),required(a,'id'))}
 else if(a.command==='import-preview'){result=E.previewImport(await read(required(a,'record')),await read(required(a,'input')))}
 else if(a.command==='build'){result=await buildLaundryOperationsBundle(await read(required(a,'record')),{out:required(a,'out')})}
 else result={usage:['create --source SOURCE.json --out NEW_RECORD.json','inspect --record RECORD.json','apply --record RECORD.json --operation OPERATION.json --out NEW_RECORD.json','quote --record RECORD.json --input INPUT.json','order --record RECORD.json --id ORDER_ID','import-preview --record RECORD.json --input INPUT.json','build --record RECORD.json --out NEW_DIRECTORY'],note:'Original record is preserved. All writes require new files/directories.'};
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runLaundryOperationsCLI().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1});
